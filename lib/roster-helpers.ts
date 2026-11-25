import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChangeRequestItem, ChangeRequestOriginalState } from '@/lib/profile';
import { csvEscape } from './csv.ts';

export { csvEscape };

export type Op = { id: string; full_name: string; position: string | null };

export type Shift = {
  id: string;
  code: string;
  description: string | null;
  duration_hours: number;
  background_color: string;
  text_color: string;
  is_off: boolean;
};

export type Area = {
  id: string;
  code: string;
  name: string | null;
  category: string;
  background_color: string;
  text_color: string;
};

export type Row = {
  operator_id: string;
  schedule_date: string;
  shift_type_id: string | null;
  area_code_id: string | null;
};

export type Standby = {
  operator_id: string;
  schedule_date: string;
  standby_type: string;
};

export type HolidayItem = {
  holiday_date: string;
  name: string;
  holiday_type: string;
};

export type PmMarkTask = {
  scheduled_date: string;
  assigned_operator_ids: string[];
  status: string;
  title: string;
};

export type RosterDay = {
  date: string;
  dayNum: number;
  dow: number;
  dowLabel: string;
  isWeekend: boolean;
};

export type PendingCellEntry = {
  shift_type_id?: string | null;
  area_code_id?: string | null;
  standby_type?: string | null;
  status: string;
  isDraft?: boolean;
  action?: string;
};

export type ShiftHistoryItem = {
  kind: 'shift';
  opId: string;
  date: string;
  prev: Row | null;
  next: Row | null;
};

export type StandbyHistoryItem = {
  kind: 'standby';
  opId: string;
  date: string;
  prev: Standby | null;
  next: Standby | null;
};

export type HistoryEntry = (ShiftHistoryItem | StandbyHistoryItem)[];

export type ToolMode = 'paint' | 'erase' | 'standby' | 'copy';

export type GridRect = {
  startR: number;
  startC: number;
  endR: number;
  endC: number;
};

export type CopiedScheduleCell = {
  dRow: number;
  dCol: number;
  shift_type_id: string | null;
  area_code_id: string | null;
};

export type CopiedScheduleBlock = {
  rows: number;
  cols: number;
  cells: CopiedScheduleCell[];
  label: string;
  sourceKeys: ReadonlySet<string>;
};

export type RosterDragBatch = {
  active: boolean;
  visited: Set<string>;
  entries: ShiftHistoryItem[];
  upserts: Row[];
  deletes: { opId: string; date: string }[];
};

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const DEFAULT_STATION_CODE = 'FD';

const LEGACY_STATION_MAP: Record<string, string> = {
  PW: 'PL',
  RM: 'FD',
  LD: 'FD',
  MR: 'FD',
  WM: 'FD',
};

export function normalizeLegacyStationCode(code: string): string {
  const trimmed = code.trim();
  return LEGACY_STATION_MAP[trimmed.toUpperCase()] ?? trimmed;
}

export function cellKey(opId: string, date: string) {
  return `${opId}:${date}`;
}

export function isRestArea(a?: Pick<Area, 'code' | 'category'>) {
  return Boolean(a && (a.category === 'rest' || a.code.toUpperCase() === 'RD'));
}

export function isLeaveArea(a?: Pick<Area, 'code' | 'category'>) {
  return Boolean(a && a.category === 'leave' && a.code.toUpperCase() !== 'RD');
}

export function isHolidayArea(a?: Pick<Area, 'code' | 'category'>) {
  return Boolean(a && (a.category === 'holiday' || a.code.toUpperCase() === 'H'));
}

export function isOffPartnerArea(a?: Pick<Area, 'code' | 'category'>) {
  return isLeaveArea(a) || isRestArea(a) || isHolidayArea(a);
}

export function findOffShift<T extends Pick<Shift, 'code' | 'is_off'>>(shifts: T[]): T | undefined {
  return shifts.find((s) => s.is_off) ?? shifts.find((s) => /^off\b/i.test(s.code.trim()));
}

export function normalizeShiftForArea(
  shiftId: string | null,
  areaId: string | null,
  areaBy: ReadonlyMap<string, Pick<Area, 'code' | 'category'>>,
  offShift?: Pick<Shift, 'id'>,
): string | null {
  const area = areaId ? areaBy.get(areaId) : undefined;
  if (isOffPartnerArea(area)) return offShift?.id ?? null;
  return shiftId;
}

export function resolveAreaSelection(
  nextAreaId: string | null,
  currentShiftId: string | null,
  lastDutyShiftId: string | null,
  shiftBy: ReadonlyMap<string, Pick<Shift, 'id' | 'is_off'>>,
  areaBy: ReadonlyMap<string, Pick<Area, 'code' | 'category'>>,
  offShift?: Pick<Shift, 'id'>,
): { shiftId: string | null; areaId: string | null } {
  const nextArea = nextAreaId ? areaBy.get(nextAreaId) : undefined;
  if (isOffPartnerArea(nextArea)) {
    return { shiftId: offShift?.id ?? null, areaId: nextAreaId };
  }
  if (nextArea) {
    const curShift = currentShiftId ? shiftBy.get(currentShiftId) : undefined;
    if ((!curShift || curShift.is_off) && lastDutyShiftId) {
      return { shiftId: lastDutyShiftId, areaId: nextAreaId };
    }
  }
  return { shiftId: currentShiftId, areaId: nextAreaId };
}

export function resolveShiftSelection(
  nextShiftId: string,
  currentAreaId: string | null,
  shiftBy: ReadonlyMap<string, Pick<Shift, 'id' | 'is_off'>>,
  areaBy: ReadonlyMap<string, Pick<Area, 'code' | 'category'>>,
): { shiftId: string; areaId: string | null } {
  const nextShift = shiftBy.get(nextShiftId);
  const curArea = currentAreaId ? areaBy.get(currentAreaId) : undefined;
  if (nextShift && !nextShift.is_off && isOffPartnerArea(curArea)) {
    return { shiftId: nextShiftId, areaId: null };
  }
  if (nextShift?.is_off && curArea && !isOffPartnerArea(curArea)) {
    return { shiftId: nextShiftId, areaId: null };
  }
  return { shiftId: nextShiftId, areaId: currentAreaId };
}



export function friendlyError(raw: string, role?: string) {
  if (/permission denied|row-level security|42501/i.test(raw)) {
    return role === 'manager'
      ? 'Not saved: your edit window has ended, or this date is outside the dates an admin allowed.'
      : 'You do not have permission to modify this schedule.';
  }
  if (/network|fetch|timeout/i.test(raw)) {
    return 'Connection issue — your change was reverted. Please try again.';
  }
  return 'Could not save change — reverted to previous value.';
}

export function buildRosterCsv(params: {
  days: RosterDay[];
  operators: Op[];
  cell: Map<string, Row>;
  shiftBy: Map<string, Shift>;
  areaBy: Map<string, Area>;
  standbyMap: Map<string, Standby>;
}): string {
  const { days, operators, cell, shiftBy, areaBy, standbyMap } = params;
  const offShift = findOffShift(Array.from(shiftBy.values()));
  const header = ['Operator', 'Position', ...days.map((d) => d.date), 'Duty', 'OC', 'Hours', 'Off', 'Leaves'];
  const lines = [header.map(csvEscape).join(',')];

  for (const o of operators) {
    let duty = 0;
    let ocCount = 0;
    let off = 0;
    let leaves = 0;
    let hrs = 0;
    const cols = days.map((d) => {
      const k = cellKey(o.id, d.date);
      const r = cell.get(k);
      const s = r?.shift_type_id ? shiftBy.get(r.shift_type_id) : undefined;
      const a = r?.area_code_id ? areaBy.get(r.area_code_id) : undefined;
      const sb = standbyMap.get(k);
      const isLeave = isLeaveArea(a);
      const isRest = isRestArea(a);
      const isHoliday = isHolidayArea(a);
      const isOffArea = isLeave || isRest || isHoliday;
      const effShift = isOffArea ? (offShift ?? s) : s;
      if (sb) ocCount += 1;
      if (isLeave) leaves += 1;
      if (isRest || isHoliday || effShift?.is_off) off += 1;
      else if (effShift && !isLeave) duty += 1;
      if (effShift && !isOffArea) hrs += Number(effShift.duration_hours ?? 0);
      const label =
        !isOffArea && effShift && !effShift.is_off
          ? [effShift.code, a?.code ?? DEFAULT_STATION_CODE]
          : [a?.code ?? effShift?.code ?? ''];
      return [...label, sb ? `(${sb.standby_type})` : ''].filter(Boolean).join(' ');
    });
    lines.push(
      [o.full_name, o.position ?? '', ...cols, String(duty), String(ocCount), String(hrs), String(off), String(leaves)]
        .map(csvEscape)
        .join(','),
    );
  }

  return lines.join('\n');
}

export interface ProposedChangeInput {
  target_table: 'schedule_assignments' | 'standby_assignments';
  action: 'upsert' | 'delete';
  operator_id: string;
  schedule_date: string;
  shift_type_id?: string | null;
  area_code_id?: string | null;
  standby_type?: string | null;
  original_state: ChangeRequestOriginalState | null;
}

export async function replaceProposedDraftItems(
  sb: SupabaseClient,
  reqId: string,
  orgId: string,
  items: ProposedChangeInput[],
): Promise<ChangeRequestItem[]> {
  const inserted: ChangeRequestItem[] = [];
  for (const item of items) {
    await sb
      .from('change_request_items')
      .delete()
      .eq('request_id', reqId)
      .eq('operator_id', item.operator_id)
      .eq('schedule_date', item.schedule_date);
    const { data, error } = await sb
      .from('change_request_items')
      .insert({
        request_id: reqId,
        organization_id: orgId,
        status: 'pending',
        ...item,
      })
      .select();
    if (error) throw error;
    if (data?.[0]) inserted.push(data[0] as ChangeRequestItem);
  }
  return inserted;
}

export async function clearDraftItemsForCells(
  sb: SupabaseClient,
  reqId: string | null,
  draftItems: ChangeRequestItem[],
  cells: { opId: string; date: string }[],
): Promise<ChangeRequestItem[]> {
  if (!reqId || draftItems.length === 0 || cells.length === 0) return draftItems;
  const keySet = new Set(cells.map((c) => cellKey(c.opId, c.date)));
  const overlapping = draftItems.filter((x) => x.operator_id && x.schedule_date && keySet.has(cellKey(x.operator_id, x.schedule_date)));
  if (overlapping.length === 0) return draftItems;
  for (const item of overlapping) {
    await sb.from('change_request_items').delete().eq('id', item.id);
  }
  const dropIds = new Set(overlapping.map((x) => x.id));
  return draftItems.filter((x) => !dropIds.has(x.id));
}

export async function persistDirectShiftChanges(
  sb: SupabaseClient,
  orgId: string,
  upserts: Row[],
  deletes: { opId: string; date: string }[],
): Promise<string> {
  let errMsg = '';
  if (upserts.length > 0) {
    const { error } = await sb
      .from('schedule_assignments')
      .upsert(
        upserts.map((u) => ({ ...u, organization_id: orgId })),
        { onConflict: 'operator_id,schedule_date' },
      );
    if (error) errMsg = error.message;
  }
  for (const d of deletes) {
    const { error } = await sb
      .from('schedule_assignments')
      .delete()
      .eq('operator_id', d.opId)
      .eq('schedule_date', d.date);
    if (error && !errMsg) errMsg = error.message;
  }
  return errMsg;
}

export function buildRosterPendingMap(
  pendingItems: Array<{
    operator_id?: string | null;
    schedule_date?: string | null;
    shift_type_id?: string | null;
    area_code_id?: string | null;
    standby_type?: string | null;
    status: string;
    action?: string;
  }>,
  draftItems: ChangeRequestItem[],
): Map<string, PendingCellEntry> {
  const map = new Map<string, PendingCellEntry>();
  for (const item of pendingItems) {
    if (item.operator_id && item.schedule_date) {
      map.set(cellKey(item.operator_id, item.schedule_date), {
        shift_type_id: item.shift_type_id,
        area_code_id: item.area_code_id,
        standby_type: item.standby_type,
        status: item.status,
        action: item.action,
        isDraft: false,
      });
    }
  }
  for (const item of draftItems) {
    if (item.operator_id && item.schedule_date) {
      map.set(cellKey(item.operator_id, item.schedule_date), {
        shift_type_id: item.shift_type_id,
        area_code_id: item.area_code_id,
        standby_type: item.standby_type,
        status: 'draft',
        action: item.action,
        isDraft: true,
      });
    }
  }
  return map;
}

export async function persistDirectStandbyChanges(
  sb: SupabaseClient,
  orgId: string,
  upserts: Standby[],
  deletes: { opId: string; date: string }[],
): Promise<string> {
  let errMsg = '';
  if (upserts.length > 0) {
    const { error } = await sb
      .from('standby_assignments')
      .upsert(
        upserts.map((u) => ({ ...u, organization_id: orgId })),
        { onConflict: 'operator_id,schedule_date' },
      );
    if (error) errMsg = error.message;
  }
  for (const d of deletes) {
    const { error } = await sb
      .from('standby_assignments')
      .delete()
      .eq('operator_id', d.opId)
      .eq('schedule_date', d.date);
    if (error && !errMsg) errMsg = error.message;
  }
  return errMsg;
}

export function computeHistoryTransition(
  entries: HistoryEntry,
  dir: 'undo' | 'redo',
  cell: ReadonlyMap<string, Row>,
  standbyMap: ReadonlyMap<string, Standby>,
) {
  const shiftUpserts: Row[] = [];
  const shiftDeletes: { opId: string; date: string }[] = [];
  const shiftAffected = new Set<string>();
  const shiftRollback: { opId: string; date: string; prev: Row | null }[] = [];
  const sbUpserts: Standby[] = [];
  const sbDeletes: { opId: string; date: string }[] = [];
  const sbAffected = new Set<string>();
  const sbRollback: { opId: string; date: string; prev: Standby | null }[] = [];
  let skippedConcurrent = 0;

  for (const e of entries) {
    const k = cellKey(e.opId, e.date);
    if (e.kind === 'shift') {
      if (dir === 'undo') {
        const cur = cell.get(k) ?? null;
        if (
          (cur?.shift_type_id ?? null) !== (e.next?.shift_type_id ?? null) ||
          (cur?.area_code_id ?? null) !== (e.next?.area_code_id ?? null)
        ) {
          skippedConcurrent += 1;
          continue;
        }
      }
      shiftAffected.add(k);
      const target = dir === 'undo' ? e.prev : e.next;
      shiftRollback.push({ opId: e.opId, date: e.date, prev: dir === 'undo' ? e.next : e.prev });
      if (target) shiftUpserts.push(target);
      else shiftDeletes.push({ opId: e.opId, date: e.date });
    } else {
      if (dir === 'undo' && (standbyMap.get(k)?.standby_type ?? null) !== (e.next?.standby_type ?? null)) {
        skippedConcurrent += 1;
        continue;
      }
      sbAffected.add(k);
      const target = dir === 'undo' ? e.prev : e.next;
      sbRollback.push({ opId: e.opId, date: e.date, prev: dir === 'undo' ? e.next : e.prev });
      if (target) sbUpserts.push(target);
      else sbDeletes.push({ opId: e.opId, date: e.date });
    }
  }

  return { shiftUpserts, shiftDeletes, shiftAffected, shiftRollback, sbUpserts, sbDeletes, sbAffected, sbRollback, skippedConcurrent };
}

export function normalizeGridRect(rect: GridRect): { rMin: number; rMax: number; cMin: number; cMax: number } {
  return {
    rMin: Math.min(rect.startR, rect.endR),
    rMax: Math.max(rect.startR, rect.endR),
    cMin: Math.min(rect.startC, rect.endC),
    cMax: Math.max(rect.startC, rect.endC),
  };
}

export function isCellInRect(r: number, c: number, rect: GridRect | null): boolean {
  if (!rect) return false;
  const { rMin, rMax, cMin, cMax } = normalizeGridRect(rect);
  return r >= rMin && r <= rMax && c >= cMin && c <= cMax;
}

export function extractCopiedBlock(params: {
  rect: GridRect;
  operators: Pick<Op, 'id'>[];
  days: Pick<RosterDay, 'date'>[];
  cell: ReadonlyMap<string, Row>;
  shiftBy: ReadonlyMap<string, Pick<Shift, 'id' | 'code' | 'is_off'>>;
  areaBy: ReadonlyMap<string, Pick<Area, 'id' | 'code' | 'category'>>;
}): CopiedScheduleBlock | null {
  const { rect, operators, days, cell, shiftBy, areaBy } = params;
  if (operators.length === 0 || days.length === 0) return null;
  const norm = normalizeGridRect(rect);
  const rMin = Math.max(0, norm.rMin);
  const rMax = Math.min(operators.length - 1, norm.rMax);
  const cMin = Math.max(0, norm.cMin);
  const cMax = Math.min(days.length - 1, norm.cMax);
  if (rMin > rMax || cMin > cMax) return null;

  const cells: CopiedScheduleCell[] = [];
  const sourceKeys = new Set<string>();
  for (let r = rMin; r <= rMax; r += 1) {
    const op = operators[r];
    for (let c = cMin; c <= cMax; c += 1) {
      const day = days[c];
      const k = cellKey(op.id, day.date);
      sourceKeys.add(k);
      const existing = cell.get(k);
      cells.push({
        dRow: r - rMin,
        dCol: c - cMin,
        shift_type_id: existing?.shift_type_id ?? null,
        area_code_id: existing?.area_code_id ?? null,
      });
    }
  }

  const rows = rMax - rMin + 1;
  const cols = cMax - cMin + 1;
  let label: string;
  if (rows === 1 && cols === 1) {
    const only = cells[0];
    const s = only.shift_type_id ? shiftBy.get(only.shift_type_id) : undefined;
    const a = only.area_code_id ? areaBy.get(only.area_code_id) : undefined;
    if (isOffPartnerArea(a)) label = a?.code ?? 'OFF';
    else if (s && !s.is_off) label = `${s.code} · ${a?.code ?? DEFAULT_STATION_CODE}`;
    else if (s?.is_off) label = a?.code ?? s.code;
    else if (a) label = a.code;
    else label = 'Empty cell';
  } else if (rows === 1) {
    label = `1×${cols} (${cols} days)`;
  } else {
    label = `${rows}×${cols} (${rows * cols} cells)`;
  }

  return { rows, cols, cells, label, sourceKeys };
}

export function buildPasteShiftEntries(params: {
  block: CopiedScheduleBlock;
  originR: number;
  originC: number;
  operators: Pick<Op, 'id'>[];
  days: Pick<RosterDay, 'date'>[];
  cell: ReadonlyMap<string, Row>;
  areaBy: ReadonlyMap<string, Pick<Area, 'code' | 'category'>>;
  offShift?: Pick<Shift, 'id'>;
}): { entries: ShiftHistoryItem[]; nextRows: Map<string, Row | null> } {
  const { block, originR, originC, operators, days, cell, areaBy, offShift } = params;
  const entries: ShiftHistoryItem[] = [];
  const nextRows = new Map<string, Row | null>();

  for (const c of block.cells) {
    const targetR = originR + c.dRow;
    const targetC = originC + c.dCol;
    if (targetR < 0 || targetR >= operators.length || targetC < 0 || targetC >= days.length) continue;

    const opId = operators[targetR].id;
    const date = days[targetC].date;
    const k = cellKey(opId, date);
    const prev = cell.get(k) ?? null;
    const effShiftId = normalizeShiftForArea(c.shift_type_id, c.area_code_id, areaBy, offShift);
    const next: Row | null = !effShiftId && !c.area_code_id
      ? null
      : { operator_id: opId, schedule_date: date, shift_type_id: effShiftId, area_code_id: c.area_code_id };

    if (
      (prev?.shift_type_id ?? null) === (next?.shift_type_id ?? null) &&
      (prev?.area_code_id ?? null) === (next?.area_code_id ?? null)
    ) {
      continue;
    }

    entries.push({ kind: 'shift', opId, date, prev, next });
    nextRows.set(k, next);
  }

  return { entries, nextRows };
}
