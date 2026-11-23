import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PM_MAX_OCCURRENCES,
  computeQuickEndDate,
  createInitialRecurrence,
  formatPmRecurrenceLabel,
  generatePmRepeatDates,
  getPmRepeatOptions,
  pmAnalyzeDate,
  syncRecurrenceForStartDate,
} from '../pm-recurrence.ts';

describe('pmAnalyzeDate & dynamic repeat options', () => {
  it('computes ordinal weekday, isLast, leap-year dates, and rejects invalid dates', () => {
    const fri2nd = pmAnalyzeDate('2026-11-13');
    assert.ok(fri2nd);
    assert.equal(fri2nd.weekdayName, 'Friday');
    assert.equal(fri2nd.nth, 2);
    assert.equal(fri2nd.ordinal, 'second');
    assert.equal(fri2nd.isLast, false);

    const fri4th = pmAnalyzeDate('2026-11-27');
    assert.ok(fri4th);
    assert.equal(fri4th.nth, 4);
    assert.equal(fri4th.isLast, true);

    const leap = pmAnalyzeDate('2028-02-29');
    assert.ok(leap);
    assert.equal(leap.nth, 5);
    assert.equal(leap.isLast, true);

    assert.equal(pmAnalyzeDate('2026-02-30'), null);
    assert.equal(pmAnalyzeDate('not-a-date'), null);
  });

  it('includes monthly_last and quarterly_last only when the start date is the last weekday of the month', () => {
    const optsNonLast = getPmRepeatOptions('2026-11-13');
    assert.ok(optsNonLast.some((o) => o.value === 'weekly' && o.label === 'Weekly on Friday'));
    assert.ok(optsNonLast.some((o) => o.value === 'monthly_nth' && o.label === 'Monthly on the second Friday'));
    assert.equal(optsNonLast.some((o) => o.value === 'monthly_last'), false);
    assert.equal(optsNonLast.some((o) => o.value === 'quarterly_last'), false);

    const optsLast = getPmRepeatOptions('2026-11-27');
    assert.ok(optsLast.some((o) => o.value === 'monthly_last' && o.label === 'Monthly on the last Friday'));
    assert.ok(optsLast.some((o) => o.value === 'quarterly_last' && o.label === 'Every 3 months on the last Friday'));
  });
});

describe('monthly nth-weekday, weekly, and N-day intervals', () => {
  it('generates every 2nd Friday of every month via preset and via custom nth/dow from a non-Friday start date', () => {
    const presetCfg = {
      ...createInitialRecurrence('2026-11-13'),
      mode: 'monthly_nth' as const,
      endMode: 'count' as const,
      count: 4,
    };
    assert.deepEqual(generatePmRepeatDates('2026-11-13', presetCfg), [
      '2026-11-13',
      '2026-12-11',
      '2027-01-08',
      '2027-02-12',
    ]);

    // Start on Tuesday Nov 24, 2026, targeting 2nd Friday (offset 0 Nov 13 < Nov 24 -> starts Dec 11)
    const customFromTue = {
      ...createInitialRecurrence('2026-11-24'),
      mode: 'custom' as const,
      endMode: 'count' as const,
      count: 4,
      customInterval: 1,
      customUnit: 'month' as const,
      customMonthMode: 'nth' as const,
      customMonthNth: 2 as const,
      customMonthDow: 5,
    };
    assert.equal(formatPmRecurrenceLabel('2026-11-24', customFromTue), 'Monthly on the second Friday');
    assert.deepEqual(generatePmRepeatDates('2026-11-24', customFromTue), [
      '2026-12-11',
      '2027-01-08',
      '2027-02-12',
      '2027-03-12',
    ]);

    // Bimonthly 2nd Friday starting Nov 24 should also start from Dec 11 then step +2 months -> Feb 12, Apr 9
    const customBimonthly = { ...customFromTue, customInterval: 2, count: 3 };
    assert.deepEqual(generatePmRepeatDates('2026-11-24', customBimonthly), [
      '2026-12-11',
      '2027-02-12',
      '2027-04-09',
    ]);
  });

  it('generates every Friday and custom multi-weekday intervals', () => {
    const weeklyFri = {
      ...createInitialRecurrence('2026-11-27'),
      mode: 'weekly' as const,
      endMode: 'count' as const,
      count: 4,
    };
    assert.deepEqual(generatePmRepeatDates('2026-11-27', weeklyFri), [
      '2026-11-27',
      '2026-12-04',
      '2026-12-11',
      '2026-12-18',
    ]);

    const multiDay = {
      ...createInitialRecurrence('2026-11-24'),
      mode: 'custom' as const,
      endMode: 'count' as const,
      count: 4,
      customInterval: 2,
      customUnit: 'week' as const,
      customWeekDays: [1, 5],
    };
    assert.equal(formatPmRecurrenceLabel('2026-11-24', multiDay), 'Every 2 weeks on Mon, Fri');
    assert.deepEqual(generatePmRepeatDates('2026-11-24', multiDay), [
      '2026-11-27',
      '2026-12-07',
      '2026-12-11',
      '2026-12-21',
    ]);
  });

  it('generates every 60 days accurately across year boundaries', () => {
    const every60 = {
      ...createInitialRecurrence('2026-11-24'),
      mode: 'custom' as const,
      endMode: 'count' as const,
      count: 4,
      customInterval: 60,
      customUnit: 'day' as const,
    };
    assert.equal(formatPmRecurrenceLabel('2026-11-24', every60), 'Every 60 days');
    assert.deepEqual(generatePmRepeatDates('2026-11-24', every60), [
      '2026-11-24',
      '2027-01-23',
      '2027-03-24',
      '2027-05-23',
    ]);
  });
});

describe('preset day filters, month clamping, 5th-weekday skipping, and yearly rules', () => {
  it('handles weekdays, mon_sat, and weekends presets', () => {
    const base = { ...createInitialRecurrence('2026-11-27'), endMode: 'count' as const, count: 4 };
    assert.deepEqual(
      generatePmRepeatDates('2026-11-27', { ...base, mode: 'weekdays' }),
      ['2026-11-27', '2026-11-30', '2026-12-01', '2026-12-02'],
    );
    assert.deepEqual(
      generatePmRepeatDates('2026-11-27', { ...base, mode: 'mon_sat' }),
      ['2026-11-27', '2026-11-28', '2026-11-30', '2026-12-01'],
    );
    assert.deepEqual(
      generatePmRepeatDates('2026-11-27', { ...base, mode: 'weekends' }),
      ['2026-11-28', '2026-11-29', '2026-12-05', '2026-12-06'],
    );
  });

  it('handles bimonthly, quarterly, semiannual, month-end clamping, lastday, 5th weekday, and annually', () => {
    const bimonthly = {
      ...createInitialRecurrence('2026-11-13'),
      mode: 'bimonthly_nth' as const,
      endMode: 'count' as const,
      count: 3,
    };
    assert.deepEqual(generatePmRepeatDates('2026-11-13', bimonthly), ['2026-11-13', '2027-01-08', '2027-03-12']);

    const quarterly = {
      ...createInitialRecurrence('2026-11-13'),
      mode: 'quarterly_nth' as const,
      endMode: 'count' as const,
      count: 3,
    };
    assert.deepEqual(generatePmRepeatDates('2026-11-13', quarterly), ['2026-11-13', '2027-02-12', '2027-05-14']);

    const semiannual = {
      ...createInitialRecurrence('2026-11-15'),
      mode: 'semiannual_date' as const,
      endMode: 'count' as const,
      count: 3,
    };
    assert.deepEqual(generatePmRepeatDates('2026-11-15', semiannual), ['2026-11-15', '2027-05-15', '2027-11-15']);

    // Day 31 clamping through Feb 2027 (28) and Feb 2028 (29)
    const monthly31 = {
      ...createInitialRecurrence('2027-01-31'),
      mode: 'monthly_date' as const,
      endMode: 'count' as const,
      count: 3,
    };
    assert.deepEqual(generatePmRepeatDates('2027-01-31', monthly31), ['2027-01-31', '2027-02-28', '2027-03-31']);

    const lastday = {
      ...createInitialRecurrence('2027-02-28'),
      mode: 'monthly_lastday' as const,
      endMode: 'count' as const,
      count: 3,
    };
    assert.deepEqual(generatePmRepeatDates('2027-02-28', lastday), ['2027-02-28', '2027-03-31', '2027-04-30']);

    // 5th Friday skips Feb & Mar 2027 cleanly to Apr 30, Jul 30
    const fifthFri = {
      ...createInitialRecurrence('2027-01-29'),
      mode: 'monthly_nth' as const,
      endMode: 'count' as const,
      count: 3,
    };
    assert.deepEqual(generatePmRepeatDates('2027-01-29', fifthFri), ['2027-01-29', '2027-04-30', '2027-07-30']);

    const annualLeap = {
      ...createInitialRecurrence('2028-02-29'),
      mode: 'annually' as const,
      endMode: 'count' as const,
      count: 2,
    };
    assert.deepEqual(generatePmRepeatDates('2028-02-29', annualLeap), ['2028-02-29', '2029-02-28']);
  });
});

describe('end limits, Sunday handling, and start-date synchronization', () => {
  it('respects On date, quick-end presets, invalid until < start, and PM_MAX_OCCURRENCES', () => {
    assert.equal(computeQuickEndDate('2026-11-24', '3m'), '2027-02-24');
    assert.equal(computeQuickEndDate('2026-11-24', '6m'), '2027-05-24');
    assert.equal(computeQuickEndDate('2026-11-24', 'eoy'), '2026-12-31');
    assert.equal(computeQuickEndDate('2026-11-24', '1y'), '2027-11-24');

    const badEnd = {
      ...createInitialRecurrence('2026-11-24'),
      mode: 'weekly' as const,
      endMode: 'date' as const,
      until: '2026-11-01',
    };
    assert.deepEqual(generatePmRepeatDates('2026-11-24', badEnd), []);

    const capped = {
      ...createInitialRecurrence('2026-11-24'),
      mode: 'daily' as const,
      endMode: 'count' as const,
      count: 500,
    };
    assert.equal(generatePmRepeatDates('2026-11-24', capped).length, PM_MAX_OCCURRENCES);
  });

  it('applies keep, next_mon (with deduplication & until cap), and skip (without hanging)', () => {
    // 2026-11-28 is Sat, 2026-11-29 is Sun, 2026-11-30 is Mon
    const dailyBase = {
      ...createInitialRecurrence('2026-11-28'),
      mode: 'daily' as const,
      endMode: 'date' as const,
      until: '2026-12-01',
    };
    assert.deepEqual(generatePmRepeatDates('2026-11-28', { ...dailyBase, sundayRule: 'keep' }), [
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
    ]);
    assert.deepEqual(generatePmRepeatDates('2026-11-28', { ...dailyBase, sundayRule: 'next_mon' }), [
      '2026-11-28',
      '2026-11-30',
      '2026-12-01',
    ]);
    assert.deepEqual(
      generatePmRepeatDates('2026-11-28', { ...dailyBase, until: '2026-11-29', sundayRule: 'next_mon' }),
      ['2026-11-28'],
    );

    const weeklySunSkip = {
      ...createInitialRecurrence('2026-11-29'),
      mode: 'weekly' as const,
      endMode: 'count' as const,
      count: 4,
      sundayRule: 'skip' as const,
    };
    assert.deepEqual(generatePmRepeatDates('2026-11-29', weeklySunSkip), []);
  });

  it('syncs defaults when start date changes while preserving explicit custom overrides', () => {
    const initial = { ...createInitialRecurrence('2026-11-27'), mode: 'monthly_last' as const };
    const syncedDowngrade = syncRecurrenceForStartDate(initial, '2026-11-27', '2026-12-11');
    assert.equal(syncedDowngrade.mode, 'monthly_nth');
    assert.deepEqual(syncedDowngrade.customWeekDays, [5]);
    assert.equal(syncedDowngrade.customMonthNth, 2);

    const withOverrides = {
      ...createInitialRecurrence('2026-11-24'),
      mode: 'custom' as const,
      customUnit: 'month' as const,
      customWeekDays: [1, 5],
      customMonthNth: 2 as const,
      customMonthDow: 5,
    };
    const syncedOverride = syncRecurrenceForStartDate(withOverrides, '2026-11-24', '2026-11-25');
    assert.deepEqual(syncedOverride.customWeekDays, [1, 5]);
    assert.equal(syncedOverride.customMonthNth, 2);
    assert.equal(syncedOverride.customMonthDow, 5);
  });
});
