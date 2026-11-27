export const CLIENT_TELEMETRY_EVENTS = ['offline_sync_failed', 'route_compute_503'] as const;

export type ClientTelemetryEvent = (typeof CLIENT_TELEMETRY_EVENTS)[number];

export interface ClientTelemetryPayload {
  event: ClientTelemetryEvent;
  category: string;
  message: string;
  httpStatus?: number;
  failedCount?: number;
  syncedCount?: number;
  route?: string;
}

export const MAX_TELEMETRY_BYTES = 4 * 1024;

const ALLOWED_EVENTS = new Set<string>(CLIENT_TELEMETRY_EVENTS);

function sanitizeRoute(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.trim().split('?')[0]?.split('#')[0]?.slice(0, 120) ?? '';
  return cleaned.startsWith('/') ? cleaned : undefined;
}

function sanitizeBoundedInt(raw: unknown, min: number, max: number): number | undefined {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return undefined;
  if (raw < min || raw > max) return undefined;
  return raw;
}

/** Validates and normalizes an untrusted client telemetry payload before server logging. */
export function sanitizeClientTelemetryPayload(raw: unknown): ClientTelemetryPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;

  if (typeof rec.event !== 'string' || !ALLOWED_EVENTS.has(rec.event)) return null;
  const category = typeof rec.category === 'string' ? rec.category.trim().slice(0, 48) : '';
  const message = typeof rec.message === 'string' ? rec.message.trim().slice(0, 300) : '';
  if (!category || !message) return null;

  const out: ClientTelemetryPayload = {
    event: rec.event as ClientTelemetryEvent,
    category,
    message,
  };

  const httpStatus = sanitizeBoundedInt(rec.httpStatus, 100, 599);
  if (httpStatus !== undefined) out.httpStatus = httpStatus;

  const failedCount = sanitizeBoundedInt(rec.failedCount, 0, 10_000);
  if (failedCount !== undefined) out.failedCount = failedCount;

  const syncedCount = sanitizeBoundedInt(rec.syncedCount, 0, 10_000);
  if (syncedCount !== undefined) out.syncedCount = syncedCount;

  const route = sanitizeRoute(rec.route);
  if (route) out.route = route;

  return out;
}

/** Deduplicates identical client telemetry reports within a time window so flaky networks do not loop. */
export class ClientTelemetryThrottle {
  private readonly lastSent = new Map<string, number>();
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(windowMs = 60_000, maxKeys = 64) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  shouldSend(key: string, now = Date.now()): boolean {
    const prev = this.lastSent.get(key);
    if (prev !== undefined && now - prev < this.windowMs) {
      return false;
    }
    if (this.lastSent.size >= this.maxKeys && !this.lastSent.has(key)) {
      for (const [k, ts] of this.lastSent) {
        if (now - ts >= this.windowMs) {
          this.lastSent.delete(k);
        }
      }
      if (this.lastSent.size >= this.maxKeys) {
        const oldest = this.lastSent.keys().next().value;
        if (oldest !== undefined) this.lastSent.delete(oldest);
      }
    }
    this.lastSent.delete(key);
    this.lastSent.set(key, now);
    return true;
  }
}

const clientThrottle = new ClientTelemetryThrottle(60_000, 64);

/** Best-effort client telemetry reporter; silent no-op during SSR, offline state, or transport failure. */
export function reportClientTelemetry(payload: ClientTelemetryPayload): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const sanitized = sanitizeClientTelemetryPayload(payload);
  if (!sanitized) return;

  const dedupeKey = `${sanitized.event}:${sanitized.category}:${sanitized.httpStatus ?? ''}`;
  if (!clientThrottle.shouldSend(dedupeKey)) return;

  try {
    void fetch('/api/telemetry/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitized),
      keepalive: true,
    }).catch(() => {
      /* ignore telemetry delivery failures */
    });
  } catch {
    /* ignore synchronous fetch construction errors */
  }
}
