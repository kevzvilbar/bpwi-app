import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPmActualPerformerIds,
  classifyPmCompletionRoles,
  computeOperatorPmKpis,
  getDefaultPmPerformers,
  isMissingCompletedByColumnError,
  resolvePmCreditedOperators,
  uniqueOperatorIds,
} from '../pm-credit.ts';

describe('PM actual-performer credit helpers', () => {
  it('deduplicates and trims operator IDs while preserving order', () => {
    assert.deepEqual(uniqueOperatorIds([' op1 ', 'op2', 'op1', '', null, undefined, 'op3']), [
      'op1',
      'op2',
      'op3',
    ]);
    assert.deepEqual(buildPmActualPerformerIds('op1', ['op2', 'op1', 'op3']), ['op1', 'op2', 'op3']);
    assert.deepEqual(buildPmActualPerformerIds(null, ['op2']), ['op2']);
  });

  it('credits strictly actual performers on done tasks and falls back only on legacy done rows', () => {
    assert.deepEqual(
      resolvePmCreditedOperators({
        status: 'planned',
        assigned_operator_ids: ['opA'],
        completed_by_operator_ids: ['opB'],
      }),
      [],
    );
    assert.deepEqual(
      resolvePmCreditedOperators({
        status: 'postponed',
        assigned_operator_ids: ['opA'],
        completed_by_operator_ids: ['opB'],
      }),
      [],
    );
    // Explicit actual performer overrides planned assignee
    assert.deepEqual(
      resolvePmCreditedOperators({
        status: 'done',
        assigned_operator_ids: ['opA', 'opB'],
        completed_by_operator_ids: ['opB', 'opC'],
      }),
      ['opB', 'opC'],
    );
    // Legacy done row with empty completed_by_operator_ids falls back to assigned_operator_ids
    assert.deepEqual(
      resolvePmCreditedOperators({
        status: 'done',
        assigned_operator_ids: ['opA', 'opB'],
        completed_by_operator_ids: [],
      }),
      ['opA', 'opB'],
    );
  });

  it('pre-selects sensible default performers based on who is closing the PM task', () => {
    const task = { assigned_operator_ids: ['opA', 'opB'], completed_by_operator_ids: [] };
    // Planned operator closing: put self first and keep teammates checked
    assert.deepEqual(getDefaultPmPerformers(task, 'opB'), ['opB', 'opA']);
    // Unlisted substitute closing: pre-select only themselves so absentees are not credited
    assert.deepEqual(getDefaultPmPerformers(task, 'opC'), ['opC']);
    // Supervisor/admin without linked operatorId: pre-select planned assignees
    assert.deepEqual(getDefaultPmPerformers(task, null), ['opA', 'opB']);
  });

  it('classifies planned-done, unlisted substitutes, and non-participating planned assignees', () => {
    const mixed = classifyPmCompletionRoles({
      status: 'done',
      assigned_operator_ids: ['opA', 'opB'],
      completed_by_operator_ids: ['opB', 'opC'],
    });
    assert.deepEqual(mixed.creditedIds, ['opB', 'opC']);
    assert.deepEqual(mixed.plannedCompletedIds, ['opB']);
    assert.deepEqual(mixed.substituteIds, ['opC']);
    assert.deepEqual(mixed.absentPlannedIds, ['opA']);
    assert.equal(mixed.hasSubstitution, true);

    const exact = classifyPmCompletionRoles({
      status: 'done',
      assigned_operator_ids: ['opA'],
      completed_by_operator_ids: ['opA'],
    });
    assert.deepEqual(exact.substituteIds, []);
    assert.deepEqual(exact.absentPlannedIds, []);
    assert.equal(exact.hasSubstitution, false);
  });

  it('awards KPI Done credit strictly to actual performers, not absent assignees', () => {
    const tasks = [
      // opA & opB planned; actually done by opB & substitute opC -> opA gets 0 Done
      { status: 'done', assigned_operator_ids: ['opA', 'opB'], completed_by_operator_ids: ['opB', 'opC'] },
      // Legacy done assigned to opA
      { status: 'done', assigned_operator_ids: ['opA'], completed_by_operator_ids: [] },
      // Still planned for opA
      { status: 'planned', assigned_operator_ids: ['opA'], completed_by_operator_ids: [] },
    ];

    assert.deepEqual(computeOperatorPmKpis('opA', tasks), {
      assignedCount: 3,
      doneCount: 1,
      plannedDoneCount: 1,
      substituteDoneCount: 0,
      missedAssignedCount: 1,
      compliancePct: 33,
    });
    assert.deepEqual(computeOperatorPmKpis('opB', tasks), {
      assignedCount: 1,
      doneCount: 1,
      plannedDoneCount: 1,
      substituteDoneCount: 0,
      missedAssignedCount: 0,
      compliancePct: 100,
    });
    assert.deepEqual(computeOperatorPmKpis('opC', tasks), {
      assignedCount: 0,
      doneCount: 1,
      plannedDoneCount: 0,
      substituteDoneCount: 1,
      missedAssignedCount: 0,
      compliancePct: null,
    });
  });

  it('detects missing completed_by_operator_ids column errors for pre-migration fallback', () => {
    assert.equal(
      isMissingCompletedByColumnError({ message: 'column pm_tasks.completed_by_operator_ids does not exist' }),
      true,
    );
    assert.equal(isMissingCompletedByColumnError({ message: 'permission denied' }), false);
    assert.equal(isMissingCompletedByColumnError(null), false);
  });
});
