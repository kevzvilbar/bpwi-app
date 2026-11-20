import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateItem, emptySnapshot, cellKey, chunk } from '../change-request-conflicts.ts';

describe('change-request conflict evaluation (mirrors approve_change_request)', () => {
  const base = { target_table: 'schedule_assignments' as const, operator_id: 'op1', schedule_date: '2026-12-01' };

  it('treats null original_state as an empty cell', () => {
    const snap = emptySnapshot();
    assert.equal(evaluateItem({ ...base, original_state: null }, snap).conflict, false);
    snap.schedule.set(cellKey('op1', '2026-12-01'), { shift_type_id: 's2', area_code_id: null });
    const r = evaluateItem({ ...base, original_state: null }, snap);
    assert.equal(r.conflict, true);
    assert.equal(r.reason, 'changed');
    assert.deepEqual(r.live, { shift_type_id: 's2', area_code_id: null });
  });

  it('flags a cell that was cleared or changed after proposing', () => {
    const snap = emptySnapshot();
    const item = { ...base, original_state: { shift_type_id: 's1', area_code_id: null } };
    assert.equal(evaluateItem(item, snap).conflict, true); // cleared
    snap.schedule.set(cellKey('op1', '2026-12-01'), { shift_type_id: 's1', area_code_id: null });
    assert.equal(evaluateItem(item, snap).conflict, false); // matches again
  });

  it('standby follows the same empty-means-null rule', () => {
    const snap = emptySnapshot();
    const item = { target_table: 'standby_assignments' as const, operator_id: 'op1', schedule_date: '2026-12-01', original_state: null };
    assert.equal(evaluateItem(item, snap).conflict, false);
    snap.standby.set(cellKey('op1', '2026-12-01'), { standby_type: 'OC' });
    assert.equal(evaluateItem(item, snap).conflict, true);
  });

  it('PM task: deleted target (null id with recorded title, or missing row) is target_missing', () => {
    const snap = emptySnapshot();
    const orphan = { target_table: 'pm_tasks' as const, pm_task_id: null, original_state: { title: 'Orig' } };
    assert.equal(evaluateItem(orphan, snap).reason, 'target_missing');
    const newTask = { target_table: 'pm_tasks' as const, pm_task_id: null, original_state: null };
    assert.equal(evaluateItem(newTask, snap).conflict, false);
    const edit = { target_table: 'pm_tasks' as const, pm_task_id: 't1', original_state: { title: 'Orig', status: 'planned' } };
    assert.equal(evaluateItem(edit, snap).reason, 'target_missing');
    snap.pm.set('t1', { title: 'Orig', status: 'done', scheduled_date: null, assigned_operator_ids: null });
    assert.equal(evaluateItem(edit, snap).reason, 'changed');
  });

  it('leave: missing or edited record conflicts; new leave does not', () => {
    const snap = emptySnapshot();
    assert.equal(evaluateItem({ target_table: 'leave_records', target_id: null }, snap).conflict, false);
    const edit = { target_table: 'leave_records' as const, target_id: 'l1', original_state: { leave_code: 'VL', start_date: '2026-12-01', end_date: '2026-12-02' } };
    assert.equal(evaluateItem(edit, snap).reason, 'target_missing');
    snap.leave.set('l1', { leave_code: 'VL', start_date: '2026-12-01', end_date: '2026-12-03' });
    assert.equal(evaluateItem(edit, snap).reason, 'changed');
  });

  it('chunk splits evenly', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });
});
