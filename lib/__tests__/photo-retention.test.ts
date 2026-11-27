import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PHOTO_RETENTION_DAYS,
  EVIDENCE_PHOTO_RETENTION_DAYS,
  MAX_PHOTO_RETENTION_DAYS,
  computePhotoExpiryIso,
  getPhotoRetentionDays,
  isPhotoPurgeEligible,
} from '../photo-retention.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('photo-retention helpers', () => {
  it('assigns 180-day retention to meter_test and leak_repair and 30-day default otherwise', () => {
    assert.equal(getPhotoRetentionDays('meter_test'), EVIDENCE_PHOTO_RETENTION_DAYS);
    assert.equal(getPhotoRetentionDays('leak_repair'), EVIDENCE_PHOTO_RETENTION_DAYS);
    assert.equal(getPhotoRetentionDays('pump_monitoring'), DEFAULT_PHOTO_RETENTION_DAYS);

    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    assert.equal(
      Date.parse(computePhotoExpiryIso('meter_test', base)) - base,
      180 * DAY_MS,
    );
    assert.equal(
      Date.parse(computePhotoExpiryIso('pump_monitoring', base)) - base,
      30 * DAY_MS,
    );
  });

  it('exempts flagged and photo_hold logs under the 365-day ceiling and enforces the hard 365-day cap', () => {
    const now = Date.UTC(2026, 11, 1, 0, 0, 0);

    // Expired normal submitted log -> eligible
    assert.equal(
      isPhotoPurgeEligible(
        {
          activity_type: 'pump_monitoring',
          status: 'submitted',
          photo_hold: false,
          photos_expires_at: new Date(now - 2 * DAY_MS).toISOString(),
          created_at: new Date(now - 35 * DAY_MS).toISOString(),
        },
        now,
      ),
      true,
    );

    // Flagged log past photos_expires_at but under 365 days -> exempt
    assert.equal(
      isPhotoPurgeEligible(
        {
          activity_type: 'pump_monitoring',
          status: 'flagged',
          photo_hold: false,
          photos_expires_at: new Date(now - 10 * DAY_MS).toISOString(),
          created_at: new Date(now - 200 * DAY_MS).toISOString(),
        },
        now,
      ),
      false,
    );

    // Supervisor photo_hold past photos_expires_at but under 365 days -> exempt
    assert.equal(
      isPhotoPurgeEligible(
        {
          activity_type: 'meter_test',
          status: 'verified',
          photo_hold: true,
          photos_expires_at: new Date(now - 10 * DAY_MS).toISOString(),
          created_at: new Date(now - 200 * DAY_MS).toISOString(),
        },
        now,
      ),
      false,
    );

    // Null photos_expires_at respects 180d for meter_test/leak_repair vs 30d default
    assert.equal(
      isPhotoPurgeEligible(
        {
          activity_type: 'meter_test',
          status: 'verified',
          photo_hold: false,
          photos_expires_at: null,
          created_at: new Date(now - 60 * DAY_MS).toISOString(),
        },
        now,
      ),
      false,
    );
    assert.equal(
      isPhotoPurgeEligible(
        {
          activity_type: 'leak_repair',
          status: 'verified',
          photo_hold: false,
          photos_expires_at: null,
          created_at: new Date(now - 181 * DAY_MS).toISOString(),
        },
        now,
      ),
      true,
    );

    // Flagged / held log at or beyond 365 days -> purged under privacy ceiling
    assert.equal(
      isPhotoPurgeEligible(
        {
          activity_type: 'meter_test',
          status: 'flagged',
          photo_hold: true,
          photos_expires_at: new Date(now - 10 * DAY_MS).toISOString(),
          created_at: new Date(now - MAX_PHOTO_RETENTION_DAYS * DAY_MS).toISOString(),
        },
        now,
      ),
      true,
    );
  });
});
