import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeJobOrderSlaStatus,
  computeSlaDeadlineManilaLocal,
  findJobOrderSlaByActivityType,
  formatSlaDurationLabel,
  JOB_ORDER_SLA_BY_ID,
  JOB_ORDER_SLA_STANDARDS,
} from '../job-order-sla.ts';
import { mapActivityToFormColumn } from '../accomplishment-form.ts';

describe('BPWI Job Order SLA Standards', () => {
  it('defines all 9 official SLA standards with exact durations and urgent priority for 24h complaints/leaks', () => {
    assert.equal(JOB_ORDER_SLA_STANDARDS.length, 9);

    const expected: Array<[string, number, number, 'high' | 'medium', string]> = [
      ['new_connection', 5, 120, 'medium', 'meter_inst'],
      ['leakage', 1, 24, 'high', 'leak_repair'],
      ['meter_relocation', 5, 120, 'medium', 'meter_relocation'],
      ['water_quality_complaint', 1, 24, 'high', 'water_sampling'],
      ['low_pressure_complaint', 1, 24, 'high', 'low_pressure'],
      ['no_water_supply_complaint', 1, 24, 'high', 'no_water_supply'],
      ['meter_replacement', 3, 72, 'medium', 'meter_replacement'],
      ['valve_replacement', 3, 72, 'medium', 'valve_replacement'],
      ['meter_testing', 5, 120, 'medium', 'meter_test'],
    ];

    for (const [id, days, hours, priority, activityType] of expected) {
      const def = JOB_ORDER_SLA_BY_ID[id];
      assert.ok(def, `Missing SLA standard ${id}`);
      assert.equal(def.slaDays, days);
      assert.equal(def.slaHours, hours);
      assert.equal(def.defaultPriority, priority);
      assert.equal(def.activityType, activityType);
    }
  });

  it('matches all 9 activity types (plus leak_detection) via findJobOrderSlaByActivityType', () => {
    assert.equal(findJobOrderSlaByActivityType('leak_repair')?.slaHours, 24);
    assert.equal(findJobOrderSlaByActivityType('leak_detection')?.id, 'leakage');
    assert.equal(findJobOrderSlaByActivityType('low_pressure')?.slaDays, 1);
    assert.equal(findJobOrderSlaByActivityType('no_water_supply')?.slaDays, 1);
    assert.equal(findJobOrderSlaByActivityType('water_sampling')?.slaDays, 1);
    assert.equal(findJobOrderSlaByActivityType('meter_replacement')?.slaDays, 3);
    assert.equal(findJobOrderSlaByActivityType('valve_replacement')?.slaDays, 3);
    assert.equal(findJobOrderSlaByActivityType('meter_inst')?.slaDays, 5);
    assert.equal(findJobOrderSlaByActivityType('meter_relocation')?.slaDays, 5);
    assert.equal(findJobOrderSlaByActivityType('meter_test')?.slaDays, 5);
    assert.equal(findJobOrderSlaByActivityType('pump_monitoring'), null);
  });

  it('formats SLA hours into clear calendar day labels', () => {
    assert.equal(formatSlaDurationLabel(24), '1 day (24 hrs)');
    assert.equal(formatSlaDurationLabel(72), '3 days (72 hrs)');
    assert.equal(formatSlaDurationLabel(120), '5 days (120 hrs)');
    assert.equal(formatSlaDurationLabel(4), '4 hrs');
    assert.equal(formatSlaDurationLabel(null), 'Custom');
  });

  it('calculates exact calendar deadlines in Asia/Manila for 24h, 3d, and 5d SLAs', () => {
    // 2026-11-23 13:30 Manila = 2026-11-23T05:30:00Z
    const base = new Date('2026-11-23T05:30:00Z');
    assert.equal(computeSlaDeadlineManilaLocal(24, base), '2026-11-24T13:30');
    assert.equal(computeSlaDeadlineManilaLocal(72, base), '2026-11-26T13:30');
    assert.equal(computeSlaDeadlineManilaLocal(120, base), '2026-11-28T13:30');
  });

  it('computes open on_track, at_risk, breached_open, met, breached_closed, and none statuses', () => {
    const created = '2026-11-20T00:00:00Z';
    const deadline = '2026-11-21T00:00:00Z';

    assert.equal(
      computeJobOrderSlaStatus(
        { status: 'pending', created_at: created, deadline, completed_at: null, estimated_hours: 24 },
        new Date('2026-11-20T10:00:00Z').getTime(),
      ).state,
      'on_track',
    );

    assert.equal(
      computeJobOrderSlaStatus(
        { status: 'in_progress', created_at: created, deadline, completed_at: null, estimated_hours: 24 },
        new Date('2026-11-20T21:00:00Z').getTime(),
      ).state,
      'at_risk',
    );

    const openBreach = computeJobOrderSlaStatus(
      { status: 'pending', created_at: created, deadline, completed_at: null, estimated_hours: 24 },
      new Date('2026-11-21T03:00:00Z').getTime(),
    );
    assert.equal(openBreach.state, 'breached_open');
    assert.equal(openBreach.isOverdue, true);
    assert.equal(openBreach.badgeLabel, 'SLA BREACH');

    const met = computeJobOrderSlaStatus({
      status: 'completed',
      created_at: created,
      deadline,
      completed_at: '2026-11-20T22:00:00Z',
    });
    assert.equal(met.state, 'met');
    assert.equal(met.badgeLabel, 'MET SLA');

    const breachedClosed = computeJobOrderSlaStatus({
      status: 'completed',
      created_at: created,
      deadline,
      completed_at: '2026-11-21T05:00:00Z',
    });
    assert.equal(breachedClosed.state, 'breached_closed');
    assert.equal(breachedClosed.badgeLabel, 'BREACHED SLA');

    assert.equal(
      computeJobOrderSlaStatus({ status: 'pending', created_at: created, deadline: null, completed_at: null }).state,
      'none',
    );
  });

  it('maps the new field activity types cleanly to BPEMS-F-002 columns', () => {
    assert.deepEqual(mapActivityToFormColumn('low_pressure'), { column_id: 'lp_insp', others_specify: '' });
    assert.deepEqual(mapActivityToFormColumn('no_water_supply'), { column_id: 'nw_insp', others_specify: '' });
    assert.deepEqual(mapActivityToFormColumn('meter_relocation'), { column_id: null, others_specify: 'METER RELOC' });
    assert.deepEqual(mapActivityToFormColumn('valve_replacement'), { column_id: null, others_specify: 'VALVE REPL' });
  });
});
