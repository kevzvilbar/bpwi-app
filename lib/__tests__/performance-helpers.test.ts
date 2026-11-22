import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOwnActivityOrFilter,
  DAILY_ACTIVITY_KPI_COLUMNS,
  DAILY_ACTIVITY_LIST_COLUMNS,
} from '../query-columns.ts';
import { shouldRefreshNotifications } from '../notification-helpers.ts';

describe('query column selection & own-activity filtering', () => {
  it('omits base64 signature_data from DAILY_ACTIVITY_LIST_COLUMNS', () => {
    const cols = DAILY_ACTIVITY_LIST_COLUMNS.split(',').map((c) => c.trim());
    assert.equal(cols.includes('signature_data'), false);
    assert.equal(cols.includes('activity_date'), true);
    assert.equal(cols.includes('photo_urls'), true);
  });

  it('omits heavy payloads from DAILY_ACTIVITY_KPI_COLUMNS', () => {
    const cols = DAILY_ACTIVITY_KPI_COLUMNS.split(',').map((c) => c.trim());
    assert.equal(cols.includes('signature_data'), false);
    assert.equal(cols.includes('details'), false);
    assert.equal(cols.includes('photo_urls'), false);
    assert.equal(cols.includes('notes'), false);
    assert.equal(cols.includes('activity_type'), true);
    assert.equal(cols.includes('status'), true);
  });

  it('builds validated PostgREST .or() filters from valid UUIDs and rejects malformed ids', () => {
    const uid = '11111111-1111-4111-8111-111111111111';
    const oid = '22222222-2222-4222-8222-222222222222';

    assert.equal(
      buildOwnActivityOrFilter(uid, oid),
      `logged_by.eq.${uid},lead_operator_id.eq.${oid},crew_operator_ids.cs.{${oid}}`,
    );
    assert.equal(buildOwnActivityOrFilter(uid, null), `logged_by.eq.${uid}`);
    assert.equal(
      buildOwnActivityOrFilter(null, oid),
      `lead_operator_id.eq.${oid},crew_operator_ids.cs.{${oid}}`,
    );
    assert.equal(buildOwnActivityOrFilter(null, null), null);
    assert.equal(buildOwnActivityOrFilter('bad-id,status.eq.verified', 'not-a-uuid'), null);
  });
});

describe('shouldRefreshNotifications', () => {
  const COOLDOWN = 180_000;

  it('skips refresh when tab is hidden', () => {
    assert.equal(shouldRefreshNotifications(0, 1000, COOLDOWN, false), false);
    assert.equal(shouldRefreshNotifications(1000, 999_999, COOLDOWN, false), false);
  });

  it('allows initial load or refresh after cooldown expires on visible tab', () => {
    assert.equal(shouldRefreshNotifications(0, 10_000, COOLDOWN, true), true);
    assert.equal(shouldRefreshNotifications(10_000, 10_000 + COOLDOWN, COOLDOWN, true), true);
  });

  it('blocks rapid alt-tab focus storms within the cooldown window', () => {
    assert.equal(shouldRefreshNotifications(100_000, 150_000, COOLDOWN, true), false);
    assert.equal(shouldRefreshNotifications(100_000, 279_999, COOLDOWN, true), false);
  });
});
