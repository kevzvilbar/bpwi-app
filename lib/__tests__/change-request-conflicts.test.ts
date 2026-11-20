import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateItem,
  emptySnapshot,
  cellKey,
  chunk,
  conflictLabel,
  describeReviewResult,
  overrideExplanation,
  toggleAllSelection,
} from '../change-request-conflicts.ts';

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

describe('toggleAllSelection', () => {
  it('selects every open item, then clears on the next toggle', () => {
    const open = ['a', 'b', 'c'];
    const selected = toggleAllSelection(undefined, open);
    assert.deepEqual([...selected].sort(), open);
    assert.equal(toggleAllSelection(selected, open).size, 0);
  });

  it('is not fooled by leftover ticks on items that are no longer open', () => {
    // 2 of 3 open items ticked + 1 stale id: the raw set size (3) equals the open count, but the selection is partial.
    const current = new Set(['a', 'b', 'closed-earlier']);
    assert.deepEqual([...toggleAllSelection(current, ['a', 'b', 'c'])].sort(), ['a', 'b', 'c']);
  });

  it('does nothing useful with no open items', () => {
    assert.equal(toggleAllSelection(new Set(['x']), []).size, 0);
  });
});

describe('describeReviewResult', () => {
  it('reports what was applied, rejected and skipped', () => {
    assert.deepEqual(describeReviewResult({ approved_count: 2 }), { type: 'ok', text: '2 applied' });
    assert.deepEqual(describeReviewResult({ approved_count: 1, rejected_count: 1 }), { type: 'ok', text: '1 applied · 1 rejected' });
    const mixed = describeReviewResult({ approved_count: 3, conflict_count: 1 });
    assert.equal(mixed.type, 'warn');
    assert.match(mixed.text, /^3 applied · 1 skipped: conflict with live data/);
  });

  it('does not describe a skipped conflict as "changed since proposed" (leave overlaps have no change)', () => {
    assert.doesNotMatch(describeReviewResult({ conflict_count: 1 }).text, /changed since proposed/i);
  });

  it('treats a no-op as a warning, e.g. a stale screen after another approver already reviewed the items', () => {
    for (const res of [null, undefined, {}, { approved_count: 0, rejected_count: 0, conflict_count: 0 }]) {
      const out = describeReviewResult(res);
      assert.equal(out.type, 'warn');
      assert.match(out.text, /^Nothing was changed/);
    }
  });
});

describe('conflict wording', () => {
  it('labels each known reason, and says so when only the server knows why', () => {
    assert.equal(conflictLabel('target_missing'), 'Target no longer exists');
    assert.equal(conflictLabel('changed'), 'Changed since proposed');
    assert.equal(conflictLabel(undefined), 'Conflict flagged by server');
    assert.equal(conflictLabel(null), 'Conflict flagged by server');
  });

  it('override explanation matches the reason, and does not claim a live value changed when it is unknown', () => {
    assert.match(overrideExplanation('target_missing'), /cannot be recreated/);
    assert.match(overrideExplanation('changed'), /was changed after this was proposed/);
    const unknown = overrideExplanation(undefined);
    assert.match(unknown, /overlap/i);
    assert.doesNotMatch(unknown, /was changed after this was proposed/);
  });
});
