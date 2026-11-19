import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldBypassSessionAuth } from '../middleware-rules.ts';

describe('middleware session bypass rules', () => {
  it('allows Vercel Cron GET requests to /api/activities/purge-photos without session cookie', () => {
    assert.equal(shouldBypassSessionAuth('/api/activities/purge-photos', 'GET'), true);
    assert.equal(shouldBypassSessionAuth('/api/activities/purge-photos', 'get'), true);
  });

  it('requires session authentication for POST /api/activities/purge-photos and all other routes', () => {
    assert.equal(shouldBypassSessionAuth('/api/activities/purge-photos', 'POST'), false);
    assert.equal(shouldBypassSessionAuth('/api/import', 'GET'), false);
    assert.equal(shouldBypassSessionAuth('/api/pm/export', 'GET'), false);
    assert.equal(shouldBypassSessionAuth('/api/reports/leave-export', 'GET'), false);
    assert.equal(shouldBypassSessionAuth('/', 'GET'), false);
  });
});
