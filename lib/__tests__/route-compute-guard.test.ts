import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DegradedStoreAlertGate,
  RouteResultCache,
  SlidingWindowRateLimiter,
  buildOrgScopedRouteCacheKey,
  formatSharedStoreDegradedNotice,
  isCacheableRoutePayload,
  resolveRoutingPolicy,
  shouldUseRemainingBudget,
} from '../route-compute-guard.ts';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to limit within window, returns retryAfterSeconds when exceeded, and resets after window', () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 3, windowMs: 10_000 });
    assert.deepEqual(limiter.check('user-1', 1000), { allowed: true, remaining: 2, retryAfterSeconds: 0 });
    assert.deepEqual(limiter.check('user-1', 2000), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
    assert.deepEqual(limiter.check('user-1', 3000), { allowed: true, remaining: 0, retryAfterSeconds: 0 });

    const blocked = limiter.check('user-1', 4000);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.retryAfterSeconds >= 7);

    // Another user has an independent bucket
    assert.equal(limiter.check('user-2', 4000).allowed, true);

    // After earliest hit ages out past 10_000ms, request is allowed again
    assert.equal(limiter.check('user-1', 11_001).allowed, true);
  });
});

describe('RouteResultCache', () => {
  it('supports hits, misses, TTL expiration, and bounded LRU eviction', () => {
    const cache = new RouteResultCache<string>({ maxEntries: 2, ttlMs: 5_000 });
    assert.equal(cache.get('k1', 1000), null);

    cache.set('k1', 'v1', 1000);
    cache.set('k2', 'v2', 1100);
    assert.equal(cache.size, 2);

    // Touch k1 so k2 becomes least-recently-used
    assert.equal(cache.get('k1', 1200), 'v1');
    cache.set('k3', 'v3', 1300);
    assert.equal(cache.size, 2);
    assert.equal(cache.get('k2', 1300), null);
    assert.equal(cache.get('k1', 1300), 'v1');
    assert.equal(cache.get('k3', 1300), 'v3');

    // Expire k1 after 1000 + 5000 = 6000ms
    assert.equal(cache.get('k1', 6001), null);
  });
});

describe('resolveRoutingPolicy', () => {
  it('prefers OSRM_BASE_URL without falling back to public demo servers', () => {
    assert.deepEqual(
      resolveRoutingPolicy({ osrmBaseUrl: ' https://osrm.internal.org/ ', nodeEnv: 'production' }),
      { customBaseUrl: 'https://osrm.internal.org/', allowPublicFallback: false },
    );
  });

  it('blocks public OSRM servers by default in production unless explicitly enabled', () => {
    assert.deepEqual(resolveRoutingPolicy({ nodeEnv: 'production' }), { allowPublicFallback: false });
    assert.deepEqual(
      resolveRoutingPolicy({ nodeEnv: 'production', allowPublicFallback: 'true' }),
      { allowPublicFallback: true },
    );
    assert.deepEqual(resolveRoutingPolicy({ nodeEnv: 'development' }), { allowPublicFallback: true });
  });
});

describe('shouldUseRemainingBudget', () => {
  it('caps attempt duration to remaining request budget and stops below 500ms', () => {
    assert.equal(shouldUseRemainingBudget(1000, 12_000, 4_500, 1000), 4_500);
    assert.equal(shouldUseRemainingBudget(1000, 12_000, 4_500, 10_000), 3_000);
    assert.equal(shouldUseRemainingBudget(1000, 12_000, 4_500, 12_600), 0);
  });
});

describe('org-scoped keys, payload caps, and degraded-store alerting', () => {
  it('isolates cache keys by organization ID and rejects empty org IDs', () => {
    const k1 = buildOrgScopedRouteCacheKey('org-a', ['https://osrm.local'], 'DRIVE:10,122');
    const k2 = buildOrgScopedRouteCacheKey('org-b', ['https://osrm.local'], 'DRIVE:10,122');
    assert.notEqual(k1, k2);
    assert.throws(() => buildOrgScopedRouteCacheKey('   ', ['https://osrm.local'], 'DRIVE:10,122'));
  });

  it('enforces element-count and byte-size caps on cached route payloads', () => {
    assert.equal(
      isCacheableRoutePayload('valid-key', [{ distanceMeters: 100, durationSeconds: 20 }], ['_p~iF~ps|U']),
      true,
    );
    assert.equal(isCacheableRoutePayload('', [{ distanceMeters: 100, durationSeconds: 20 }], []), false);

    const tooManyLegs = Array.from({ length: 61 }, () => ({ distanceMeters: 10, durationSeconds: 2 }));
    assert.equal(isCacheableRoutePayload('valid-key', tooManyLegs, []), false);

    const tooManyPolylines = Array.from({ length: 11 }, () => 'abc');
    assert.equal(isCacheableRoutePayload('valid-key', [], tooManyPolylines), false);

    const hugePolyline = ['x'.repeat(140_000)];
    assert.equal(isCacheableRoutePayload('valid-key', [], hugePolyline), false);
  });

  it('throttles repeated degraded-store warnings per reason and formats admin notices', () => {
    const gate = new DegradedStoreAlertGate(60_000);
    assert.equal(gate.shouldAlert('missing_service_key', 1_000), true);
    assert.equal(gate.shouldAlert('missing_service_key', 30_000), false);
    assert.equal(gate.shouldAlert('rpc_unavailable', 30_000), true);
    assert.equal(gate.shouldAlert('missing_service_key', 61_001), true);

    assert.match(formatSharedStoreDegradedNotice('missing_service_key'), /SUPABASE_SECRET_KEY/);
    assert.match(formatSharedStoreDegradedNotice('rpc_unavailable'), /029_harden_route_compute_store\.sql/);
  });
});
