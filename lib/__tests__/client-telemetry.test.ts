import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClientTelemetryThrottle,
  sanitizeClientTelemetryPayload,
} from '../client-telemetry.ts';

describe('sanitizeClientTelemetryPayload', () => {
  it('accepts valid offline_sync_failed and route_compute_503 payloads and strips route query/hash', () => {
    const syncPayload = sanitizeClientTelemetryPayload({
      event: 'offline_sync_failed',
      category: 'conflict',
      message: 'Record modified on server',
      failedCount: 2,
      syncedCount: 1,
      route: '/field?tab=queue#top',
    });
    assert.deepEqual(syncPayload, {
      event: 'offline_sync_failed',
      category: 'conflict',
      message: 'Record modified on server',
      failedCount: 2,
      syncedCount: 1,
      route: '/field',
    });

    const routePayload = sanitizeClientTelemetryPayload({
      event: 'route_compute_503',
      category: 'shared_store_degraded',
      httpStatus: 503,
      route: '/activities',
      message: 'Store unavailable',
    });
    assert.deepEqual(routePayload, {
      event: 'route_compute_503',
      category: 'shared_store_degraded',
      httpStatus: 503,
      route: '/activities',
      message: 'Store unavailable',
    });
  });

  it('rejects unknown events, empty required fields, and non-object inputs, and drops out-of-range numbers', () => {
    assert.equal(sanitizeClientTelemetryPayload(null), null);
    assert.equal(sanitizeClientTelemetryPayload(['offline_sync_failed']), null);
    assert.equal(
      sanitizeClientTelemetryPayload({ event: 'arbitrary_event', category: 'err', message: 'msg' }),
      null,
    );
    assert.equal(
      sanitizeClientTelemetryPayload({ event: 'offline_sync_failed', category: '  ', message: 'msg' }),
      null,
    );

    const clamped = sanitizeClientTelemetryPayload({
      event: 'route_compute_503',
      category: 'c'.repeat(80),
      message: 'm'.repeat(400),
      httpStatus: 999,
      failedCount: -1,
      syncedCount: 1.5,
      route: 'https://evil.example/phish',
    });
    assert.ok(clamped);
    assert.equal(clamped.category.length, 48);
    assert.equal(clamped.message.length, 300);
    assert.equal(clamped.httpStatus, undefined);
    assert.equal(clamped.failedCount, undefined);
    assert.equal(clamped.syncedCount, undefined);
    assert.equal(clamped.route, undefined);
  });
});

describe('ClientTelemetryThrottle', () => {
  it('suppresses duplicate keys within window, allows after expiry, and caps tracked keys', () => {
    const throttle = new ClientTelemetryThrottle(60_000, 2);
    assert.equal(throttle.shouldSend('a', 1_000), true);
    assert.equal(throttle.shouldSend('a', 30_000), false);
    assert.equal(throttle.shouldSend('b', 30_000), true);
    assert.equal(throttle.shouldSend('a', 61_001), true);

    // Adding 'c' when full (maxKeys=2) evicts oldest ('b' at 30_000) so 'b' can re-fire
    assert.equal(throttle.shouldSend('c', 62_000), true);
    assert.equal(throttle.shouldSend('b', 62_000), true);
  });
});
