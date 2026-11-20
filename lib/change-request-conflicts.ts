/**
 * Live-conflict evaluation for change-request items.
 *
 * Mirrors the rules in `approve_change_request` (migration 023) so the approvals screen shows the same
 * conflicts the server will enforce. The server stays authoritative; this only drives the display.
 *
 * Known gap: leave-overlap conflicts (a proposed leave range overlapping another leave record) are
 * only detected server-side at approval time.
 */

export type ConflictReason = 'changed' | 'target_missing';

export type ConflictItem = {
  target_table: 'schedule_assignments' | 'standby_assignments' | 'pm_tasks' | 'leave_records';
  target_id?: string | null;
  action?: string | null;
  operator_id?: string | null;
  schedule_date?: string | null;
  pm_task_id?: string | null;
  original_state?: Record<string, unknown> | null;
};

export type LiveSnapshot = {
  schedule: Map<string, { shift_type_id: string | null; area_code_id: string | null }>;
  standby: Map<string, { standby_type: string | null }>;
  pm: Map<string, { title: string | null; status: string | null; scheduled_date: string | null; assigned_operator_ids: string[] | null }>;
  leave: Map<string, { leave_code: string | null; start_date: string | null; end_date: string | null }>;
};

export type ConflictResult = {
  conflict: boolean;
  reason: ConflictReason | null;
  /** What the target looks like right now (null when the target no longer exists). */
  live: Record<string, unknown> | null;
};

export const cellKey = (operatorId: string | null | undefined, date: string | null | undefined) => `${operatorId ?? ''}:${date ?? ''}`;

export function emptySnapshot(): LiveSnapshot {
  return { schedule: new Map(), standby: new Map(), pm: new Map(), leave: new Map() };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const nn = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));
const has = (o: Record<string, unknown> | null | undefined, k: string) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const sameList = (a: string[] | null | undefined, b: unknown) => {
  const x = a ?? [];
  const y = Array.isArray(b) ? (b as unknown[]).map(String) : [];
  return x.length === y.length && x.every((v, i) => v === y[i]); // order-sensitive, like the SQL array compare
};

export function evaluateItem(item: ConflictItem, snap: LiveSnapshot): ConflictResult {
  const orig = item.original_state ?? null;

  if (item.target_table === 'schedule_assignments') {
    const live = snap.schedule.get(cellKey(item.operator_id, item.schedule_date)) ?? { shift_type_id: null, area_code_id: null };
    // original_state === null means "the cell was empty when proposed"
    const changed = nn(live.shift_type_id) !== nn(orig?.shift_type_id) || nn(live.area_code_id) !== nn(orig?.area_code_id);
    return { conflict: changed, reason: changed ? 'changed' : null, live };
  }

  if (item.target_table === 'standby_assignments') {
    const live = snap.standby.get(cellKey(item.operator_id, item.schedule_date)) ?? { standby_type: null };
    const changed = nn(live.standby_type) !== nn(orig?.standby_type);
    return { conflict: changed, reason: changed ? 'changed' : null, live };
  }

  if (item.target_table === 'pm_tasks') {
    if (!item.pm_task_id) {
      // FK is ON DELETE SET NULL: an edit (has a recorded title) with no task id means the task was deleted.
      const gone = has(orig, 'title');
      return { conflict: gone, reason: gone ? 'target_missing' : null, live: null };
    }
    const live = snap.pm.get(item.pm_task_id);
    if (!live) return { conflict: true, reason: 'target_missing', live: null };
    const changed =
      (has(orig, 'title') && nn(live.title) !== nn(orig?.title)) ||
      (has(orig, 'status') && nn(live.status) !== nn(orig?.status)) ||
      (has(orig, 'scheduled_date') && nn(live.scheduled_date) !== nn(orig?.scheduled_date)) ||
      (has(orig, 'assigned_operator_ids') && Array.isArray(orig?.assigned_operator_ids) && !sameList(live.assigned_operator_ids, orig?.assigned_operator_ids));
    return { conflict: changed, reason: changed ? 'changed' : null, live };
  }

  // leave_records
  if (!item.target_id) return { conflict: false, reason: null, live: null };
  const live = snap.leave.get(item.target_id);
  if (!live) return { conflict: true, reason: 'target_missing', live: null };
  const changed =
    (has(orig, 'leave_code') && nn(live.leave_code) !== nn(orig?.leave_code)) ||
    (has(orig, 'start_date') && nn(live.start_date) !== nn(orig?.start_date)) ||
    (has(orig, 'end_date') && nn(live.end_date) !== nn(orig?.end_date));
  return { conflict: changed, reason: changed ? 'changed' : null, live };
}
