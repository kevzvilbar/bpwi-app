import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_BY_ID,
  ACTIVITY_CATEGORY_LABELS,
  resolveActivityTypeFromPm,
  type DailyActivityRow,
  type MeterTestCalculation,
} from '../activity-types.ts';
import { mapActivityToFormColumn } from '../accomplishment-form.ts';
import {
  INITIAL_ACTIVITY_DETAIL_FIELDS,
  buildActivityDetailsPayload,
  hydrateActivityDetailFields,
} from '../activity-logger-details.ts';
import { formatTelemetrySummary } from '../activity-telemetry.ts';
import {
  INITIAL_FUEL_ACTIVITIES_STATE,
  computeTotalDistributedLiters,
  isFuelActivityType,
} from '../fuel-activities.ts';

const SAMPLE_METER_CALC: MeterTestCalculation = {
  err1: 0,
  err2: 0,
  err3: 0,
  avgErr: 0,
  verdict: 'Passed',
  recommendation: 'Retain',
};

function makeActivity(activity_type: string, details: Record<string, unknown>): DailyActivityRow {
  return {
    id: 'act-fuel-1',
    organization_id: 'org-1',
    activity_date: '2026-11-23',
    logged_by: 'u1',
    lead_operator_id: 'op1',
    crew_operator_ids: [],
    shift_type_id: null,
    area_code_id: null,
    site_or_well: 'Pavia Base / Well 3',
    block_lot: null,
    activity_type,
    pm_task_id: null,
    job_order_id: null,
    status: 'submitted',
    started_at: null,
    completed_at: null,
    gps_lat: null,
    gps_lng: null,
    notes: null,
    details,
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
}

describe('fuel activities catalog, BPEMS-F-002 mapping, serialization & telemetry', () => {
  it('registers all 4 fuel activities under the agreed categories and maps to BPEMS-F-002 codes', () => {
    assert.equal(ACTIVITY_CATEGORY_LABELS.grounds, 'Grounds, Fleet & General');
    assert.equal(ACTIVITY_BY_ID.genset_fuel_refill?.category, 'plant');
    assert.equal(ACTIVITY_BY_ID.genset_fuel_purchase?.category, 'plant');
    assert.equal(ACTIVITY_BY_ID.genset_fuel_distribution?.category, 'plant');
    assert.equal(ACTIVITY_BY_ID.vehicle_fueling?.category, 'grounds');

    for (const id of ['genset_fuel_refill', 'genset_fuel_purchase', 'genset_fuel_distribution', 'vehicle_fueling']) {
      assert.equal(isFuelActivityType(id), true);
    }
    assert.equal(isFuelActivityType('genset_monitoring'), false);

    assert.deepEqual(mapActivityToFormColumn('genset_fuel_refill'), { column_id: null, others_specify: 'GENSET REFILL' });
    assert.deepEqual(mapActivityToFormColumn('genset_fuel_purchase'), { column_id: null, others_specify: 'FUEL PURCH' });
    assert.deepEqual(mapActivityToFormColumn('genset_fuel_distribution'), { column_id: null, others_specify: 'FUEL DIST' });
    assert.deepEqual(mapActivityToFormColumn('vehicle_fueling'), { column_id: null, others_specify: 'VEHICLE FUEL' });
  });

  it('resolves PM task titles accurately without colliding with genset_monitoring', () => {
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'CUSTOM', title: 'Genset Fuel Refilling - Well 2' }), 'genset_fuel_refill');
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'CUSTOM', title: 'Fuel Distribution to Pump Stations' }), 'genset_fuel_distribution');
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'CUSTOM', title: 'Genset Fuel Purchase (Diesel)' }), 'genset_fuel_purchase');
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'CUSTOM', title: 'Service Vehicle Refueling' }), 'vehicle_fueling');
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'GENSET', title: 'Genset Monitoring' }), 'genset_monitoring');
  });

  it('computes total distributed liters across multi-area stops accurately', () => {
    const res = computeTotalDistributedLiters([
      { destinationSite: 'Well 1 Genset', liters: '40.5', containerNote: '2 jerrycans' },
      { destinationSite: 'Site 2 Booster', liters: '60', containerNote: '3 jerrycans' },
      { destinationSite: '', liters: 'bad', containerNote: '' },
    ]);
    assert.deepEqual(res, { totalLiters: 100.5, validStopCount: 2 });
  });

  it('round-trips Vehicle Refueling, Genset Fuel Purchase, Distribution, and Refilling payloads and summaries', () => {
    const vfPayload = buildActivityDetailsPayload(
      'vehicle_fueling',
      {
        ...INITIAL_ACTIVITY_DETAIL_FIELDS,
        vehicleType: 'Service Pickup',
        plateNumber: 'FAD-4102',
        fuel: {
          ...INITIAL_FUEL_ACTIVITIES_STATE,
          fuelType: 'Diesel',
          litersAmount: '42.5',
          odometerKm: '51200',
          supplierStation: 'Petron Pavia',
          receiptNumber: 'OR-9910',
          totalCostPhp: '2550',
        },
      },
      SAMPLE_METER_CALC,
    );
    const vfHydrated = hydrateActivityDetailFields(vfPayload);
    assert.equal(vfHydrated.vehicleType, 'Service Pickup');
    assert.equal(vfHydrated.plateNumber, 'FAD-4102');
    assert.equal(vfHydrated.fuel.litersAmount, '42.5');
    assert.equal(vfHydrated.fuel.receiptNumber, 'OR-9910');
    const vfSummary = formatTelemetrySummary(makeActivity('vehicle_fueling', vfPayload));
    assert.ok(vfSummary.some((s) => s.includes('Service Pickup') && s.includes('FAD-4102')));
    assert.ok(vfSummary.some((s) => s.includes('+42.5 L Diesel')));
    assert.ok(vfSummary.some((s) => s.includes('OR #OR-9910')));

    const gpPayload = buildActivityDetailsPayload(
      'genset_fuel_purchase',
      {
        ...INITIAL_ACTIVITY_DETAIL_FIELDS,
        fuel: {
          ...INITIAL_FUEL_ACTIVITIES_STATE,
          fuelType: 'Diesel',
          litersAmount: '200',
          containerDescription: '1 drum',
          supplierStation: 'Shell',
          receiptNumber: 'PO-12',
          totalCostPhp: '11600',
        },
      },
      SAMPLE_METER_CALC,
    );
    assert.equal(hydrateActivityDetailFields(gpPayload).fuel.litersAmount, '200');
    const gpSummary = formatTelemetrySummary(makeActivity('genset_fuel_purchase', gpPayload));
    assert.ok(gpSummary.some((s) => s.includes('+200 L Diesel')));
    assert.ok(gpSummary.some((s) => s.includes('1 drum')));

    const gdPayload = buildActivityDetailsPayload(
      'genset_fuel_distribution',
      {
        ...INITIAL_ACTIVITY_DETAIL_FIELDS,
        vehicleType: 'Elf Truck',
        plateNumber: 'XYZ-123',
        fuel: {
          ...INITIAL_FUEL_ACTIVITIES_STATE,
          fuelType: 'Diesel',
          fuelDistributions: [
            { destinationSite: 'Well 1', liters: '50', containerNote: 'J. Doe' },
            { destinationSite: 'Well 3', liters: '75', containerNote: 'R. Santos' },
          ],
        },
      },
      SAMPLE_METER_CALC,
    );
    const gdSummary = formatTelemetrySummary(makeActivity('genset_fuel_distribution', gdPayload));
    assert.ok(gdSummary.some((s) => s.includes('Total Distributed: 125 L Diesel (2 site(s))')));
    assert.ok(gdSummary.some((s) => s.includes('Well 1: 50L')));

    const grPayload = buildActivityDetailsPayload(
      'genset_fuel_refill',
      {
        ...INITIAL_ACTIVITY_DETAIL_FIELDS,
        fuel: {
          ...INITIAL_FUEL_ACTIVITIES_STATE,
          fuelType: 'Diesel',
          fuelSource: 'Stock Drum / Container',
          fuelBefore: '20',
          litersAmount: '60',
          fuelAfter: '80',
          hourMeterReading: '1420.5',
        },
      },
      SAMPLE_METER_CALC,
    );
    const grHydrated = hydrateActivityDetailFields(grPayload);
    assert.equal(grHydrated.fuel.fuelBefore, '20');
    assert.equal(grHydrated.fuel.litersAmount, '60');
    assert.equal(grHydrated.fuel.fuelAfter, '80');
    assert.equal(grHydrated.fuel.hourMeterReading, '1420.5');
    const grSummary = formatTelemetrySummary(makeActivity('genset_fuel_refill', grPayload));
    assert.ok(grSummary.some((s) => s.includes('Refilled: +60 L Diesel')));
    assert.ok(grSummary.some((s) => s.includes('Level: 20 → 80')));
  });
});
