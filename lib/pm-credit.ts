/**
 * Pure helpers for Preventive Maintenance (PM) actual-performer attribution and KPI credit.
 * Keeps planned assignees (`assigned_operator_ids`) separate from actual performers
 * (`completed_by_operator_ids`), falling back to planned assignees only for legacy done rows.
 */

export interface PmCreditTask {
  status: string;
  assigned_operator_ids?: readonly string[] | null;
  completed_by_operator_ids?: readonly string[] | null;
}

export interface PmCompletionRoles {
  creditedIds: string[];
  plannedIds: string[];
  plannedCompletedIds: string[];
  substituteIds: string[];
  absentPlannedIds: string[];
  hasSubstitution: boolean;
}

export interface OperatorPmKpiStats {
  assignedCount: number;
  doneCount: number;
  plannedDoneCount: number;
  substituteDoneCount: number;
  missedAssignedCount: number;
  compliancePct: number | null;
}

/** Deduplicates non-empty operator UUID strings while preserving order. */
export function uniqueOperatorIds(
  ids: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  if (!ids || ids.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Combines lead and crew operator IDs into a deduplicated actual-performer array. */
export function buildPmActualPerformerIds(
  leadOperatorId: string | null | undefined,
  crewOperatorIds: readonly string[] | null | undefined,
): string[] {
  return uniqueOperatorIds([leadOperatorId, ...(crewOperatorIds ?? [])]);
}

/**
 * Returns the operator IDs credited with completing a PM task:
 * - Non-done tasks credit nobody (`[]`).
 * - Done tasks with explicit `completed_by_operator_ids` credit strictly those actual performers.
 * - Legacy done tasks (with empty `completed_by_operator_ids`) fall back to `assigned_operator_ids`.
 */
export function resolvePmCreditedOperators(task: PmCreditTask): string[] {
  if (task.status !== 'done') return [];
  const completed = uniqueOperatorIds(task.completed_by_operator_ids);
  if (completed.length > 0) return completed;
  return uniqueOperatorIds(task.assigned_operator_ids);
}

/**
 * Computes default pre-selected performers when completing an open PM task:
 * - Planned operator closing: keeps planned team with current operator listed first.
 * - Unlisted substitute closing: pre-selects ONLY the current operator so absentees are not credited.
 * - Supervisor/admin without linked operator ID: pre-selects planned assignees.
 */
export function getDefaultPmPerformers(
  task: Pick<PmCreditTask, 'assigned_operator_ids' | 'completed_by_operator_ids'>,
  currentOperatorId?: string | null,
): string[] {
  const assigned = uniqueOperatorIds(task.assigned_operator_ids);
  const current = typeof currentOperatorId === 'string' ? currentOperatorId.trim() : '';
  if (current) {
    if (assigned.includes(current)) {
      return [current, ...assigned.filter((id) => id !== current)];
    }
    return [current];
  }
  return assigned;
}

/** Classifies operators on a PM task into planned-who-performed, unlisted substitutes, and absentees. */
export function classifyPmCompletionRoles(task: PmCreditTask): PmCompletionRoles {
  const plannedIds = uniqueOperatorIds(task.assigned_operator_ids);
  const creditedIds = resolvePmCreditedOperators(task);
  const plannedSet = new Set(plannedIds);
  const creditedSet = new Set(creditedIds);

  const plannedCompletedIds = creditedIds.filter((id) => plannedSet.has(id));
  const substituteIds = creditedIds.filter((id) => !plannedSet.has(id));
  const absentPlannedIds = task.status === 'done'
    ? plannedIds.filter((id) => !creditedSet.has(id))
    : [];

  return {
    creditedIds,
    plannedIds,
    plannedCompletedIds,
    substituteIds,
    absentPlannedIds,
    hasSubstitution: substituteIds.length > 0 || absentPlannedIds.length > 0,
  };
}

/** Computes PM scorecard counts for one operator using strict actual-performer credit. */
export function computeOperatorPmKpis(
  operatorId: string,
  tasks: readonly PmCreditTask[],
): OperatorPmKpiStats {
  let assignedCount = 0;
  let doneCount = 0;
  let plannedDoneCount = 0;
  let substituteDoneCount = 0;
  let missedAssignedCount = 0;

  for (const task of tasks) {
    const plannedSet = new Set(uniqueOperatorIds(task.assigned_operator_ids));
    const creditedSet = new Set(resolvePmCreditedOperators(task));
    const isAssigned = plannedSet.has(operatorId);
    const isCredited = creditedSet.has(operatorId);

    if (isAssigned) assignedCount += 1;
    if (isCredited) {
      doneCount += 1;
      if (isAssigned) plannedDoneCount += 1;
      else substituteDoneCount += 1;
    } else if (isAssigned && task.status === 'done') {
      missedAssignedCount += 1;
    }
  }

  return {
    assignedCount,
    doneCount,
    plannedDoneCount,
    substituteDoneCount,
    missedAssignedCount,
    compliancePct: assignedCount > 0 ? Math.round((doneCount / assignedCount) * 100) : null,
  };
}

/** Detects a PostgREST/Postgres missing-column error before migration 024 has been applied. */
export function isMissingCompletedByColumnError(
  err: { message?: string | null } | null | undefined,
): boolean {
  return Boolean(err?.message && /completed_by_operator_ids/i.test(err.message));
}
