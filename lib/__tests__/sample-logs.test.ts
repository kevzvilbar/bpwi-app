import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { excludeSamples, formatSampleRemaining, isActiveSample } from '../sample-logs.ts';

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

  it('guards expired sample activity deletion until storage photos are safely removed', () => {
    const sql34 = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/034_sample_logs.sql'), 'utf8');
    assert.match(sql34, /coalesce\(cardinality\(photo_storage_paths\),\s*0\)\s*=\s*0/);
    assert.match(sql34, /coalesce\(cardinality\(photo_urls\),\s*0\)\s*=\s*0/);

    const routeSrc = fs.readFileSync(path.resolve(process.cwd(), 'app/api/activities/purge-photos/route.ts'), 'utf8');
    assert.match(routeSrc, /executeSamplePurge[\s\S]*failedPaths[\s\S]*clearedRowIds[\s\S]*purge_expired_sample_records/);
  });
});
