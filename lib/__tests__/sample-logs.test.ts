import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canEditLogRow, describeSampleCleanupHealth, excludeSamples, formatSampleRemaining, isActiveSample } from '../sample-logs.ts';
import { isSamplePhotoPath, isStoragePathOwnedByOrg, isValidActivityStoragePath, samplePhotoStem } from '../activity-media.ts';

describe('sample-logs helpers', () => {
  it('checks sample activity and formats remaining 24h window', () => {
    const now = Date.UTC(2026, 10, 24, 12, 0, 0);
    const in5h = new Date(now + (5 * 60 + 15) * 60_000).toISOString();
    const in40m = new Date(now + 40 * 60_000).toISOString();
    const expired = new Date(now - 60_000).toISOString();

    assert.equal(isActiveSample({ is_sample: false }, now), false);
    assert.equal(isActiveSample({ is_sample: true, sample_expires_at: in5h }, now), true);
    assert.equal(isActiveSample({ is_sample: true, sample_expires_at: expired }, now), false);

    assert.equal(formatSampleRemaining(in5h, now), '5h 15m left');
    assert.equal(formatSampleRemaining(in40m, now), '40m left');
    assert.equal(formatSampleRemaining(expired, now), 'Expired');
  });

  it('filters sample rows out via excludeSamples', () => {
    const rows = [
      { id: '1', is_sample: false },
      { id: '2', is_sample: true },
      { id: '3' },
    ];
    assert.deepEqual(
      excludeSamples(rows).map((r) => r.id),
      ['1', '3'],
    );
  });

  it('excludes sample rows in every KPI, badge, and report aggregate query', () => {
    const kpiSrc = fs.readFileSync(path.resolve(process.cwd(), 'components/ActivitiesKpiTab.tsx'), 'utf8');
    const isSampleFilterCount = (kpiSrc.match(/\.eq\('is_sample',\s*false\)/g) ?? []).length;
    assert.equal(isSampleFilterCount, 3, 'ActivitiesKpiTab must filter is_sample=false on acts, gensetActs, and jobOrders queries');

    const profileSrc = fs.readFileSync(path.resolve(process.cwd(), 'lib/profile.ts'), 'utf8');
    assert.match(profileSrc, /from\('accomplishment_reports'\)[\s\S]*?\.eq\('is_sample',\s*false\)/);

    const reportsPageSrc = fs.readFileSync(path.resolve(process.cwd(), 'app/reports/page.tsx'), 'utf8');
    assert.match(reportsPageSrc, /from\('daily_activities'\)[\s\S]*?\.eq\('is_sample',\s*false\)/);

    const reportsCompSrc = fs.readFileSync(path.resolve(process.cwd(), 'components/AccomplishmentReports.tsx'), 'utf8');
    const repSampleCount = (reportsCompSrc.match(/\.eq\('is_sample',\s*false\)/g) ?? []).length;
    assert.equal(repSampleCount, 2, 'AccomplishmentReports must filter is_sample=false when loading activities');
  });

  it('queues sample photo paths before deleting expired samples, so deletion never waits for the cron route', () => {
    const sql35 = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/035_dept_head_sample_only_edits.sql'), 'utf8');
    const queueIdx = sql35.indexOf('insert into sample_photo_cleanup');
    const deleteIdx = sql35.indexOf('delete from daily_activities where is_sample = true');
    assert.ok(queueIdx > 0 && deleteIdx > queueIdx, 'photo paths must be queued before the sample rows are deleted');
    assert.doesNotMatch(sql35, /cardinality\(photo_storage_paths\)/, 'row deletion must not be gated on photos');

    const routeSrc = fs.readFileSync(path.resolve(process.cwd(), 'app/api/activities/purge-photos/route.ts'), 'utf8');
    assert.match(routeSrc, /executeSamplePurge[\s\S]*purge_expired_sample_records[\s\S]*drainSamplePhotoQueue/);
    assert.match(routeSrc, /sample_photo_cleanup[\s\S]*removeStoragePathsInChunks[\s\S]*failedPaths/);
  });

  it('only lets department heads change sample rows (UI mirrors the database guard)', () => {
    assert.equal(canEditLogRow('manager', { is_sample: true }), true);
    assert.equal(canEditLogRow('manager', { is_sample: false }), false);
    assert.equal(canEditLogRow('manager', {}), false);
    for (const role of ['admin', 'scheduler', 'operator']) {
      assert.equal(canEditLogRow(role, { is_sample: false }), true, role);
    }
  });

  it('names sample photos with the sample- prefix that the Storage policy keys on', () => {
    assert.equal(samplePhotoStem('123-abc', true), 'sample-123-abc');
    assert.equal(samplePhotoStem('123-abc', false), '123-abc');
    const org = '11111111-1111-4111-8111-111111111111';
    assert.equal(isSamplePhotoPath(`${org}/2026-11-25/sample-123-abc.webp`), true);
    assert.equal(isSamplePhotoPath(`${org}/2026-11-25/123-abc.webp`), false);
    assert.equal(isValidActivityStoragePath(`${org}/2026-11-25/sample-123-abc.webp`), true);
    assert.equal(isStoragePathOwnedByOrg(`${org}/2026-11-25/sample-123-abc.webp`, org), true);
  });

  it('warns admins only when sample cleanup is actually behind', () => {
    assert.equal(describeSampleCleanupHealth(null), null);
    assert.equal(
      describeSampleCleanupHealth({ overdue_samples: 0, queued_photos: 3, oldest_queued_hours: 5, pg_cron_scheduled: true }),
      null,
    );
    assert.match(
      describeSampleCleanupHealth({ overdue_samples: 4, queued_photos: 0, oldest_queued_hours: 0, pg_cron_scheduled: false }) ?? '',
      /pg_cron cleanup is not scheduled/,
    );
    assert.match(
      describeSampleCleanupHealth({ overdue_samples: 4, queued_photos: 0, oldest_queued_hours: 0, pg_cron_scheduled: true }) ?? '',
      /Check the hourly Supabase pg_cron job/,
    );
    assert.match(
      describeSampleCleanupHealth({ overdue_samples: 0, queued_photos: 9, oldest_queued_hours: 60, pg_cron_scheduled: true }) ?? '',
      /waiting 60h/,
    );
  });

  it('threads the sample flag through every photo upload path', () => {
    const modal = fs.readFileSync(path.resolve(process.cwd(), 'components/ActivityLoggerModal.tsx'), 'utf8');
    assert.match(modal, /uploadActivityPhoto\(sb, p\.orgId, file, \{ sample:/);
    const sync = fs.readFileSync(path.resolve(process.cwd(), 'lib/offline-sync-core.ts'), 'utf8');
    assert.match(sync, /sample: body\.is_sample === true/);
  });
});
