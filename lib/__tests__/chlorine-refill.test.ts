import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_CHLORINE_REFILL_STATE,
  describeChlorineRefill,
  expectedChlorineUnit,
  isDrumLevelLowerAfterRefill,
  validateChlorineRefill,
  type ChlorineRefillFormState,
} from '../chlorine-refill.ts';
import {
  INITIAL_ACTIVITY_DETAIL_FIELDS,
  buildActivityDetailsPayload,
  hydrateActivityDetailFields,
} from '../activity-logger-details.ts';
import { computeMeterTestResult, resolveActivityTypeFromPm, ACTIVITY_BY_ID } from '../activity-types.ts';
import { formatTelemetrySummary } from '../activity-telemetry.ts';
import { buildActivityRemarks, mapActivityToFormColumn } from '../accomplishment-form.ts';

const filled: ChlorineRefillFormState = {
  ...INITIAL_CHLORINE_REFILL_STATE,
  chemicalType: 'Calcium Hypochlorite 70% (granules)',
  drumLevelBefore: '20',
  drumLevelAfter: '60',
  amountAdded: '2.5',
  amountUnit: 'kg',
  waterAddedLiters: '40',
  pumpStrokePct: '50',
  pumpSpeedPct: '70',
  newPumpStrokePct: '60',
};

const payloadOf = (chlorine: ChlorineRefillFormState, residual = '0.8') =>
  buildActivityDetailsPayload(
    'chlorine_refill',
    { ...INITIAL_ACTIVITY_DETAIL_FIELDS, chlorine, chlorineResidual: residual },
    computeMeterTestResult(null, null, null, null),
  );

describe('chlorine refill activity', () => {
  it('is a plant activity', () => {
    assert.equal(ACTIVITY_BY_ID.chlorine_refill?.category, 'plant');
  });

  it('saves numbers and restores them when the log is edited', () => {
    const details = payloadOf(filled);
    assert.equal(details.amountAdded, 2.5);
    assert.equal(details.amountUnit, 'kg');
    assert.equal(details.newPumpSpeedPct, null);
    const hydrated = hydrateActivityDetailFields(details);
    assert.deepEqual(hydrated.chlorine, filled);
    assert.equal(hydrated.chlorineResidual, '0.8');
  });

  it('keeps zero readings, such as an empty drum', () => {
    const details = payloadOf({ ...filled, drumLevelBefore: '0' });
    assert.equal(details.drumLevelBefore, 0);
    assert.equal(hydrateActivityDetailFields(details).chlorine.drumLevelBefore, '0');
  });

  it('requires drum level, amount and one current dosing setting', () => {
    const check = (patch: Partial<ChlorineRefillFormState>, residual = '') =>
      validateChlorineRefill({ ...filled, ...patch }, residual);
    assert.equal(check({}), null);
    assert.match(check({ drumLevelBefore: '' })!, /before refilling/);
    assert.match(check({ chemicalType: '' })!, /chlorine chemical type/i);
    assert.match(
      check({ chemicalType: 'Sodium Hypochlorite 12.5% (liquid)', amountUnit: 'kg' })!,
      /must be measured in liters \(L\)/,
    );
    assert.match(
      check({ chemicalType: 'Calcium Hypochlorite 70% (granules)', amountUnit: 'L' })!,
      /must be measured in kilograms \(kg\)/,
    );
    assert.equal(expectedChlorineUnit('Sodium Hypochlorite 12.5% (liquid)'), 'L');
    assert.equal(expectedChlorineUnit('Calcium Hypochlorite 70% (granules)'), 'kg');
    assert.equal(expectedChlorineUnit('Unrecognized chemical'), null);
    assert.match(check({ amountAdded: '' })!, /how much chlorine/);
    assert.match(check({ amountAdded: '0' })!, /how much chlorine/);
    assert.match(check({ pumpStrokePct: '', pumpSpeedPct: '' })!, /current dosing setting/);
    assert.equal(check({ pumpStrokePct: '' }), null);
    assert.match(check({ amountAdded: '-1' })!, /0 or more/);
    assert.match(check({ newPumpStrokePct: '101' })!, /more than 100%/);
    assert.match(check({ drumLevelUnit: '%', drumLevelAfter: '120' })!, /more than 100%/);
    assert.equal(check({ drumLevelUnit: 'L', drumLevelAfter: '120' }), null);
    assert.match(check({}, '-0.2')!, /Residual chlorine/);
  });

  it('flags a drum that reads lower after refilling', () => {
    assert.equal(isDrumLevelLowerAfterRefill(filled), false);
    assert.equal(isDrumLevelLowerAfterRefill({ ...filled, drumLevelAfter: '10' }), true);
    assert.equal(isDrumLevelLowerAfterRefill({ ...filled, drumLevelAfter: '' }), false);
  });

  it('shows old and new dosing settings only where they changed', () => {
    const rows = Object.fromEntries(describeChlorineRefill(payloadOf(filled)).map((r) => [r.label, r.value]));
    assert.equal(rows['Drum level (before → after)'], '20 L → 60 L');
    assert.equal(rows['Chlorine added'], '2.5 kg');
    assert.equal(rows['Dosing pump stroke'], '50% → 60%');
    assert.equal(rows['Dosing pump speed'], '70%');
    assert.equal(rows['Residual Cl₂'], '0.8 mg/L');
  });

  it('appears in the activity feed and accomplishment report', () => {
    const act = { activity_type: 'chlorine_refill', details: payloadOf(filled), site_or_well: null, notes: null } as never;
    assert.ok(formatTelemetrySummary(act).includes('Chlorine added: 2.5 kg'));
    assert.match(buildActivityRemarks(act), /Chlorine added: 2\.5 kg/);
    assert.deepEqual(mapActivityToFormColumn('chlorine_refill'), { column_id: null, others_specify: 'CHLORINE' });
  });

  it('matches refill tasks without taking over sampling tasks', () => {
    for (const title of ['Chlorine Refill', 'Chlorine refilling - PL', 'Refill hypochlorite', 'Check dosing drum']) {
      assert.equal(resolveActivityTypeFromPm({ activity_type: 'CHLOR', title }), 'chlorine_refill', title);
    }
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'CHLREF', title: 'Weekly' }), 'chlorine_refill');
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'CHLOR', title: 'Chlorination' }), 'water_sampling');
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'X', title: 'Chlorine residual sampling' }), 'water_sampling');
    assert.equal(resolveActivityTypeFromPm({ activity_type: 'X', title: 'Genset fuel refill' }), 'genset_fuel_refill');
  });
});
