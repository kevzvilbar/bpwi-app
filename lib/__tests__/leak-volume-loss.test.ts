import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_ACTIVITY_DETAIL_FIELDS,
  buildActivityDetailsPayload,
  hydrateActivityDetailFields,
} from '../activity-logger-details.ts';
import { formatTelemetrySummary } from '../activity-telemetry.ts';
import type { DailyActivityRow, MeterTestCalculation } from '../activity-types.ts';
import {
  INITIAL_LEAK_LOSS_STATE,
  calcLeakDurationMinutesFromTimes,
  computeLeakVolumeLoss,
  hydrateLeakLossDetails,
} from '../leak-volume-loss.ts';

const SAMPLE_METER_CALC: MeterTestCalculation = {
  err1: 0,
  err2: 0,
  err3: 0,
  avgErr: 0,
  verdict: 'Passed',
  recommendation: 'Retain',
};

describe('leak repair theoretical water loss computation', () => {
  it('reproduces BPWI Computation of Volume Loss Excel values accurately (50mm, 30psi, 44min -> 63.26 m³)', () => {
    const calc = computeLeakVolumeLoss({
      openingShape: 'circular',
      diameterMm: '50',
      pressurePsi: '30',
      dischargeCoeff: '0.6',
      durationMinutes: '44',
    });

    assert.ok(calc);
    assert.equal(calc.areaM2.toFixed(4), '0.0020');
    assert.equal(calc.deltaPa.toFixed(4), '206842.7188');
    assert.equal(calc.flowM3PerSec.toFixed(4), '0.0240');
    assert.equal(calc.durationHours, 0.73);
    assert.equal(calc.totalVolumeM3, 63.26);
    assert.equal(calc.formulaAreaText, 'A = π(d/2)²');
    assert.equal(calc.highPressureDropWarning, true);
  });

  it('supports slit/crack geometry without overestimating area as a circular bore', () => {
    const slit = computeLeakVolumeLoss({
      openingShape: 'slit',
      slitLengthMm: '30',
      slitWidthMm: '2',
      pressurePsi: '30',
      dischargeCoeff: '0.6',
      durationMinutes: '44',
    });

    assert.ok(slit);
    assert.equal(slit.areaM2, 0.00006); // 60 mm² vs circular ~707 mm²
    assert.equal(slit.formulaAreaText, 'A = L × W');
    assert.equal(slit.highPressureDropWarning, false);
    assert.ok(slit.totalVolumeM3 > 1 && slit.totalVolumeM3 < 3);
  });

  it('derives duration from HH:MM timestamps including midnight wrap', () => {
    assert.equal(calcLeakDurationMinutesFromTimes('08:00', '08:44'), 44);
    assert.equal(calcLeakDurationMinutesFromTimes('23:40', '00:24'), 44);
    assert.equal(calcLeakDurationMinutesFromTimes('08:00', '08:00'), null);
    assert.equal(calcLeakDurationMinutesFromTimes('', '08:44'), null);

    const viaTimes = computeLeakVolumeLoss({
      openingShape: 'circular',
      diameterMm: '25',
      pressurePsi: '30',
      dischargeCoeff: '0.8',
      leakReportedAt: '23:40',
      valveIsolatedAt: '00:24',
      durationMinutes: '',
    });
    assert.ok(viaTimes);
    assert.equal(viaTimes.durationMinutes, 44);
    assert.equal(viaTimes.dischargeCoeff, 0.8);
  });

  it('returns null for invalid, zero, or incomplete inputs', () => {
    assert.equal(computeLeakVolumeLoss(INITIAL_LEAK_LOSS_STATE), null);
    assert.equal(computeLeakVolumeLoss({ diameterMm: '50', pressurePsi: '0', durationMinutes: '30' }), null);
    assert.equal(computeLeakVolumeLoss({ diameterMm: '50', pressurePsi: '30', dischargeCoeff: '1.5', durationMinutes: '30' }), null);
  });

  it('round-trips leakLoss, fault attribution, and unit-aware materials cleanly through activity payload & summary', () => {
    const payload = buildActivityDetailsPayload(
      'leak_repair',
      {
        ...INITIAL_ACTIVITY_DETAIL_FIELDS,
        pipeSize: '2" Stand Pipe',
        leakType: 'Hit by CAR',
        usedMaterials: [{ item: '2" GI Coupling', qty: '2', unit: 'pcs' }],
        leakLoss: {
          ...INITIAL_LEAK_LOSS_STATE,
          openingShape: 'circular',
          diameterMm: '50',
          pressurePsi: '30',
          dischargeCoeff: '0.6',
          durationMinutes: '44',
          faultAttribution: 'third_party',
          responsibleParty: 'Juan Dela Cruz',
          responsibleAccountNo: 'ABC-1234',
        },
      },
      SAMPLE_METER_CALC,
    );

    const hydrated = hydrateActivityDetailFields(payload);
    assert.equal(hydrated.leakLoss.diameterMm, '50');
    assert.equal(hydrated.leakLoss.faultAttribution, 'third_party');
    assert.equal(hydrated.leakLoss.responsibleParty, 'Juan Dela Cruz');
    assert.deepEqual(hydrated.usedMaterials, [{ item: '2" GI Coupling', qty: '2', unit: 'pcs' }]);

    const row: DailyActivityRow = {
      id: 'act-leak-1',
      organization_id: 'org-1',
      activity_date: '2026-11-23',
      logged_by: 'u1',
      lead_operator_id: 'op1',
      crew_operator_ids: [],
      shift_type_id: null,
      area_code_id: null,
      site_or_well: 'Site 2',
      block_lot: null,
      activity_type: 'leak_repair',
      pm_task_id: null,
      job_order_id: null,
      status: 'submitted',
      started_at: null,
      completed_at: null,
      gps_lat: 10.779313,
      gps_lng: 122.592218,
      notes: null,
      details: payload,
      photo_urls: [],
      photo_storage_paths: [],
      photos_expires_at: null,
      photos_purged_at: null,
      signature_data: null,
      verified_by: null,
      verified_at: null,
      review_note: null,
      created_at: '2026-11-23T00:00:00Z',
      updated_at: '2026-11-23T00:00:00Z',
    };

    const summary = formatTelemetrySummary(row);
    assert.ok(summary.some((s) => s.includes('63.26 m³')));
    assert.ok(summary.some((s) => s.includes('Fault: Customer / 3rd-Party (Juan Dela Cruz)')));
    assert.ok(summary.some((s) => s.includes('2" GI Coupling (2 pcs)')));
    assert.equal(hydrateLeakLossDetails({}).faultAttribution, 'natural_nrw');
  });
});
