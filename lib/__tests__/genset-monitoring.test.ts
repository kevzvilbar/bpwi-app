import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_GENSET_MONITORING_STATE,
  evaluateGensetDurationGuidance,
  evaluateGensetHealth,
  hasGensetChecklistDetails,
  hydrateGensetMonitoringDetails,
} from '../genset-monitoring.ts';
import {
  INITIAL_ACTIVITY_DETAIL_FIELDS,
  buildActivityDetailsPayload,
  hydrateActivityDetailFields,
} from '../activity-logger-details.ts';
import { formatTelemetrySummary } from '../activity-telemetry.ts';
import type { DailyActivityRow } from '../activity-types.ts';

const ZERO_METER_CALC = {
  err1: null,
  err2: null,
  err3: null,
  avgErr: null,
  verdict: null,
  recommendation: null,
};

function makeGensetRow(details: Record<string, unknown>): DailyActivityRow {
  return {
    id: 'genset-test-1',
    organization_id: 'org-1',
    activity_date: '2026-11-24',
    logged_by: null,
    lead_operator_id: null,
    crew_operator_ids: [],
    shift_type_id: null,
    area_code_id: null,
    site_or_well: 'Main Booster Genset',
    block_lot: null,
    activity_type: 'genset_monitoring',
    pm_task_id: null,
    status: 'submitted',
    started_at: '2026-11-24T01:00:00Z',
    completed_at: '2026-11-24T01:20:00Z',
    gps_lat: null,
    gps_lng: null,
    notes: null,
    details,
    photo_urls: [],
    photo_storage_paths: [],
    photos_expires_at: null,
    photos_purged_at: null,
    verified_by: null,
    verified_at: null,
    review_note: null,
    created_at: '2026-11-24T01:00:00Z',
    updated_at: '2026-11-24T01:20:00Z',
  };
}

describe('genset duration guidance', () => {
  it('guides 15–20 min weekly no-load window and warns on diesel wet stacking >30 min', () => {
    const emptyGuide = evaluateGensetDurationGuidance('no_load_pms', '', 'Diesel');
    assert.equal(emptyGuide?.tone, 'info');

    const shortGuide = evaluateGensetDurationGuidance('no_load_pms', '10', 'Diesel');
    assert.equal(shortGuide?.tone, 'warn');

    const ok15 = evaluateGensetDurationGuidance('no_load_pms', '15', 'Diesel');
    const ok20 = evaluateGensetDurationGuidance('no_load_pms', '20', 'Gasoline');
    assert.equal(ok15?.tone, 'ok');
    assert.equal(ok20?.tone, 'ok');

    const dieselWetStack = evaluateGensetDurationGuidance('no_load_pms', '35', 'Diesel');
    assert.equal(dieselWetStack?.tone, 'warn');
    assert.match(dieselWetStack?.message ?? '', /wet stacking/i);

    const gasExtended = evaluateGensetDurationGuidance('no_load_pms', '35', 'Gasoline');
    assert.equal(gasExtended?.tone, 'ok');
  });

  it('returns info banner when skipping no-load run due to prior outage run', () => {
    const skipped = evaluateGensetDurationGuidance('skipped_ran_outage', '20', 'Diesel');
    assert.equal(skipped?.tone, 'info');
    assert.match(skipped?.message ?? '', /outage/i);
  });
});

describe('genset standby health evaluation', () => {
  it('returns READY when all fluid, battery, and visual checks are nominal', () => {
    const res = evaluateGensetHealth(INITIAL_GENSET_MONITORING_STATE);
    assert.equal(res.verdict, 'READY');
    assert.deepEqual(res.findings, []);
  });

  it('returns NEEDS_ATTENTION for low oil, weak battery, minor vibration, or smoke', () => {
    const res = evaluateGensetHealth({
      ...INITIAL_GENSET_MONITORING_STATE,
      oilLevel: 'Low — Top-Up Needed',
      batteryStatus: 'Weak / Needs Charge',
      exhaustSmoke: 'Black',
    });
    assert.equal(res.verdict, 'NEEDS_ATTENTION');
    assert.equal(res.findings.length, 3);
  });

  it('returns CRITICAL for empty oil, dead battery, fuel leak, or abnormal knock', () => {
    const emptyOil = evaluateGensetHealth({
      ...INITIAL_GENSET_MONITORING_STATE,
      oilLevel: 'Critical / Empty',
    });
    assert.equal(emptyOil.verdict, 'CRITICAL');

    const fuelLeak = evaluateGensetHealth({
      ...INITIAL_GENSET_MONITORING_STATE,
      leaksObserved: 'Fuel Leak',
      coolantLevel: 'Low — Top-Up Needed',
    });
    assert.equal(fuelLeak.verdict, 'CRITICAL');
    assert.deepEqual(fuelLeak.findings, ['Fuel Leak', 'Coolant low — top-up needed']);
  });
});

describe('genset payload round-trip & hydration', () => {
  it('does not treat empty or legacy 4-key rows as structured checklists', () => {
    assert.equal(hasGensetChecklistDetails({}), false);
    assert.equal(
      hasGensetChecklistDetails({
        gensetInitialFuel: 80,
        gensetFinalFuel: 75,
        runningHours: 142.5,
        gensetCause: 'PMS',
      }),
      false,
    );
  });

  it('serializes and re-hydrates structured PMS fields including skipped_ran_outage duration clearing', () => {
    const state = {
      ...INITIAL_ACTIVITY_DETAIL_FIELDS,
      gensetInitialFuel: '65',
      gensetFinalFuel: '60',
      runningHours: '310.4',
      gensetCause: 'PMS' as const,
      genset: {
        ...INITIAL_GENSET_MONITORING_STATE,
        unitFuelType: 'Gasoline' as const,
        runMode: 'skipped_ran_outage' as const,
        runDurationMin: '25',
        coolantLevel: 'N/A (Air-Cooled)' as const,
        batteryStatus: 'Weak / Needs Charge' as const,
        batteryVoltageV: '11.9',
        exhaustSmoke: 'N/A (Not Run)' as const,
        standbyNote: 'Ran 45m during feeder trip; top up fuel tank',
      },
    };

    const payload = buildActivityDetailsPayload('genset_monitoring', state, ZERO_METER_CALC);
    assert.equal(hasGensetChecklistDetails(payload), true);
    assert.equal(payload.gensetRunDurationMin, null);
    assert.equal(payload.gensetStandbyVerdict, 'NEEDS_ATTENTION');

    const hydrated = hydrateActivityDetailFields(payload);
    assert.equal(hydrated.genset.unitFuelType, 'Gasoline');
    assert.equal(hydrated.genset.runMode, 'skipped_ran_outage');
    assert.equal(hydrated.genset.runDurationMin, '');
    assert.equal(hydrated.genset.batteryVoltageV, '11.9');
    assert.equal(hydrated.genset.standbyNote, 'Ran 45m during feeder trip; top up fuel tank');

    const directHydrated = hydrateGensetMonitoringDetails({ gensetCause: 'Power Outage' });
    assert.equal(directHydrated.runMode, 'power_outage');
  });
});

describe('genset telemetry summary formatting', () => {
  it('preserves legacy summary format and renders structured PMS findings', () => {
    const legacy = formatTelemetrySummary(
      makeGensetRow({
        gensetInitialFuel: 80,
        gensetFinalFuel: 70,
        runningHours: 0.3,
        gensetCause: 'Routine',
      }),
    );
    assert.deepEqual(legacy, ['Fuel: 80 → 70', 'Run: 0.3h', 'Cause: Routine']);

    const readySummary = formatTelemetrySummary(
      makeGensetRow(
        buildActivityDetailsPayload(
          'genset_monitoring',
          {
            ...INITIAL_ACTIVITY_DETAIL_FIELDS,
            gensetInitialFuel: '85',
            gensetFinalFuel: '80',
            runningHours: '210.5',
            gensetCause: 'PMS',
            genset: {
              ...INITIAL_GENSET_MONITORING_STATE,
              runDurationMin: '15',
            },
          },
          ZERO_METER_CALC,
        ),
      ),
    );
    assert.deepEqual(readySummary, [
      'Diesel · No-Load PMS (15m)',
      'Fuel: 85 → 80',
      'Hr: 210.5h',
      'Oil: Normal / Full',
      'Standby: Ready',
    ]);

    const issueSummary = formatTelemetrySummary(
      makeGensetRow(
        buildActivityDetailsPayload(
          'genset_monitoring',
          {
            ...INITIAL_ACTIVITY_DETAIL_FIELDS,
            gensetCause: 'PMS',
            genset: {
              ...INITIAL_GENSET_MONITORING_STATE,
              runDurationMin: '20',
              oilLevel: 'Low — Top-Up Needed',
              leaksObserved: 'Fuel Leak',
            },
          },
          ZERO_METER_CALC,
        ),
      ),
    );
    assert.ok(issueSummary.some((item) => item.startsWith('CRITICAL: Fuel Leak')));
  });
});
