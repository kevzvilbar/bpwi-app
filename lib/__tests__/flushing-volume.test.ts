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
  computeFlushingVolume,
  hydrateFlushingSummaryFromDetails,
} from '../flushing-volume.ts';

const SAMPLE_METER_CALC: MeterTestCalculation = {
  err1: 0,
  err2: 0,
  err3: 0,
  avgErr: 0,
  verdict: 'Passed',
  recommendation: 'Retain',
};

describe('line flushing theoretical orifice & metered volume calculation', () => {
  it('computes single blow-off orifice flushing volume matching Torricelli formula (50mm, 30psi, 44min -> 63.26 m³)', () => {
    const res = computeFlushingVolume({
      meterStatus: 'unreadable',
      blowOffs: [
        {
          name: 'BO Phase 1',
          initialRead: '',
          finalRead: '',
          diameterMm: '50',
          pressurePsi: '30',
          dischargeCoeff: '0.6',
          durationMinutes: '44',
        },
      ],
    });

    assert.equal(res.basis, 'orifice_theoretical');
    assert.equal(res.computedPointCount, 1);
    assert.equal(res.totalVolumeM3, 63.26);
    assert.equal(res.hasHighPressureDropWarning, true);
    assert.equal(res.blowOffPoints[0]?.orifice?.flowM3PerSec.toFixed(4), '0.0240');
  });

  it('sums multiple blow-off points with different bores, discharge coefficients, and HH:MM ranges including midnight wrap', () => {
    const res = computeFlushingVolume({
      meterStatus: 'no_meter',
      blowOffs: [
        {
          name: 'BO North (2" open)',
          initialRead: '',
          finalRead: '',
          diameterMm: '50',
          pressurePsi: '25',
          dischargeCoeff: '0.8',
          startTime: '23:40',
          endTime: '00:10', // 30 min across midnight
        },
        {
          name: 'BO South (1" smooth nozzle)',
          initialRead: '',
          finalRead: '',
          diameterMm: '25',
          pressurePsi: '30',
          dischargeCoeff: '0.9',
          durationMinutes: '20',
        },
      ],
    });

    assert.equal(res.basis, 'orifice_theoretical');
    assert.equal(res.computedPointCount, 2);
    assert.equal(res.blowOffPoints[0]?.orifice?.durationMinutes, 30);
    assert.equal(res.blowOffPoints[1]?.orifice?.durationMinutes, 20);
    const p1 = res.blowOffPoints[0]?.volumeM3 ?? 0;
    const p2 = res.blowOffPoints[1]?.volumeM3 ?? 0;
    assert.ok(p1 > 0 && p2 > 0);
    assert.equal(res.totalVolumeM3, Number((p1 + p2).toFixed(2)));
  });

  it('computes metered mother-meter and blow-off differential safely without allowing negative volumes', () => {
    const mother = computeFlushingVolume({
      meterStatus: 'metered',
      flushingInitialRead: '1000',
      flushingFinalRead: '1045.5',
      blowOffs: [{ name: 'BO 1', initialRead: '10', finalRead: '25' }],
    });
    assert.equal(mother.basis, 'mother_meter');
    assert.equal(mother.motherMeterVolumeM3, 45.5);
    assert.equal(mother.totalVolumeM3, 45.5);

    const blowOffOnly = computeFlushingVolume({
      meterStatus: 'metered',
      flushingInitialRead: '',
      flushingFinalRead: '',
      blowOffs: [
        { name: 'BO 1', initialRead: '10', finalRead: '25' },
        { name: 'BO 2', initialRead: '50', finalRead: '62.5' },
      ],
    });
    assert.equal(blowOffOnly.basis, 'blowoff_meters');
    assert.equal(blowOffOnly.totalVolumeM3, 27.5);

    const invalidFinalLess = computeFlushingVolume({
      meterStatus: 'metered',
      flushingInitialRead: '500',
      flushingFinalRead: '400',
      blowOffs: [],
    });
    assert.equal(invalidFinalLess.basis, 'none');
    assert.equal(invalidFinalLess.totalVolumeM3, null);
  });

  it('round-trips orifice flushing payloads through hydrateActivityDetailFields and formatTelemetrySummary', () => {
    const payload = buildActivityDetailsPayload(
      'flushing',
      {
        ...INITIAL_ACTIVITY_DETAIL_FIELDS,
        flushingMeterStatus: 'no_meter',
        blowOffs: [
          {
            name: 'BO Mainline End',
            initialRead: '',
            finalRead: '',
            diameterMm: '50',
            pressurePsi: '30',
            dischargeCoeff: '0.6',
            startTime: '08:00',
            endTime: '08:44',
            durationMinutes: '44',
          },
        ],
      },
      SAMPLE_METER_CALC,
    );

    const hydrated = hydrateActivityDetailFields(payload);
    assert.equal(hydrated.flushingMeterStatus, 'no_meter');
    assert.equal(hydrated.blowOffs[0]?.diameterMm, '50');
    assert.equal(hydrated.blowOffs[0]?.durationMinutes, '44');

    const recomputed = hydrateFlushingSummaryFromDetails(payload);
    assert.equal(recomputed.totalVolumeM3, 63.26);

    const row: DailyActivityRow = {
      id: 'act-flush-1',
      organization_id: 'org-1',
      activity_date: '2026-11-23',
      logged_by: 'u1',
      lead_operator_id: 'op1',
      crew_operator_ids: [],
      shift_type_id: null,
      area_code_id: null,
      site_or_well: 'Mainline Phase 1',
      block_lot: null,
      activity_type: 'flushing',
      pm_task_id: null,
      job_order_id: null,
      status: 'submitted',
      started_at: null,
      completed_at: null,
      gps_lat: null,
      gps_lng: null,
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
    assert.deepEqual(summary, [
      'Meter: No Existing Mother Meter',
      'Est. Flushing Vol: 63.26 m³ (1 pt)',
      '1 blow-off point(s)',
    ]);
  });
});
