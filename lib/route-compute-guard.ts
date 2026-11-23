/**
 * Server-side rate limiting, bounded LRU/TTL route caching, OSRM routing policy,
 * and timeout budget helpers for `/api/routes/compute`.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * In-memory per-user sliding-window rate limiter with bounded map growth.
 */
export class SlidingWindowRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxTrackedUsers: number;
  private readonly hits = new Map<string, number[]>();

  constructor(opts: { limit: number; windowMs: number; maxTrackedUsers?: number }) {
    this.limit = Math.max(1, Math.floor(opts.limit));
    this.windowMs = Math.max(1, Math.floor(opts.windowMs));
    this.maxTrackedUsers = Math.max(10, Math.floor(opts.maxTrackedUsers ?? 2000));
  }

  check(userId: string, nowMs = Date.now()): RateLimitResult {
    const cutoff = nowMs - this.windowMs;
    const prev = this.hits.get(userId);
    const active = prev ? prev.filter((ts) => ts > cutoff) : [];

    if (active.length >= this.limit) {
      const oldest = active[0];
      const retryMs = Math.max(1000, oldest + this.windowMs - nowMs);
      this.hits.delete(userId);
      this.hits.set(userId, active);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryMs / 1000),
      };
    }

    active.push(nowMs);
    this.hits.delete(userId);
    this.hits.set(userId, active);

    if (this.hits.size > this.maxTrackedUsers) {
      this.prune(cutoff);
    }

    return {
      allowed: true,
      remaining: Math.max(0, this.limit - active.length),
      retryAfterSeconds: 0,
    };
  }

  private prune(cutoff: number) {
    for (const [key, timestamps] of this.hits.entries()) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
        this.hits.delete(key);
      }
    }
    while (this.hits.size > this.maxTrackedUsers) {
      const oldestKey = this.hits.keys().next().value;
      if (oldestKey === undefined) break;
      this.hits.delete(oldestKey);
    }
  }
}

/**
 * Bounded LRU + TTL cache backed by insertion order of a standard Map.
 */
export class RouteResultCache<T> {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(opts: { maxEntries: number; ttlMs: number }) {
    this.maxEntries = Math.max(1, Math.floor(opts.maxEntries));
    this.ttlMs = Math.max(1, Math.floor(opts.ttlMs));
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string, nowMs = Date.now()): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= nowMs) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, nowMs = Date.now()): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      for (const [k, v] of this.entries.entries()) {
        if (v.expiresAt <= nowMs) this.entries.delete(k);
      }
    }
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, { value, expiresAt: nowMs + this.ttlMs });
  }
}

export interface RoutingPolicy {
  customBaseUrl?: string;
  allowPublicFallback: boolean;
}

/**
 * Resolves OSRM upstream routing policy:
 * - When `OSRM_BASE_URL` is configured, exclusively routes through that self-hosted server.
 * - Otherwise permits public demo servers in non-production environments, or in production only
 *   when `ALLOW_PUBLIC_OSRM_FALLBACK=true` is explicitly opted in.
 */
export function resolveRoutingPolicy(env: {
  osrmBaseUrl?: string;
  allowPublicFallback?: string;
  nodeEnv?: string;
}): RoutingPolicy {
  const customBaseUrl = env.osrmBaseUrl?.trim() || undefined;
  if (customBaseUrl) {
    return { customBaseUrl, allowPublicFallback: false };
  }
  const explicitOptIn = env.allowPublicFallback?.trim().toLowerCase() === 'true';
  const isProd = env.nodeEnv === 'production';
  return {
    allowPublicFallback: explicitOptIn || !isProd,
  };
}

/**
 * Computes the timeout budget remaining for the next upstream OSRM call,
 * returning 0 when less than 500 ms remains so handlers return cleanly before timing out.
 */
export function shouldUseRemainingBudget(
  startedAtMs: number,
  budgetMs: number,
  attemptCapMs: number,
  nowMs = Date.now(),
): number {
  const elapsed = Math.max(0, nowMs - startedAtMs);
  const remaining = budgetMs - elapsed;
  if (remaining < 500) return 0;
  return Math.min(attemptCapMs, Math.floor(remaining));
}
