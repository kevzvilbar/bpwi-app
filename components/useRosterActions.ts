'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { ChangeRequestItem, ChangeRequestOriginalState, EditGrant } from '@/lib/profile';
import { getErrorMessage } from '@/lib/error-utils';
import { canManagerDirectEditDate, isGrantActiveAt } from '@/lib/edit-grant';
import { buildShiftProposalInput, useRosterDrafts } from '@/components/useRosterDrafts';
import { useRosterRealtime } from '@/components/useRosterRealtime';
import { useRosterClipboard } from '@/components/useRosterClipboard';
import {
  buildRosterCsv, buildRosterPendingMap, cellKey, computeHistoryTransition,
  DEFAULT_STATION_CODE, findOffShift, friendlyError, isHolidayArea, isLeaveArea,
  isOffPartnerArea, isRestArea, MONTHS_FULL, normalizeShiftForArea, persistDirectShiftChanges,
  persistDirectStandbyChanges, resolveAreaSelection, resolveShiftSelection, WEEKDAYS,
  type Area, type HistoryEntry, type HolidayItem, type Op,
  type PmMarkTask, type RosterDragBatch, type Row, type Shift, type ShiftHistoryItem, type Standby, type ToolMode,
} from '@/lib/roster-helpers';

export interface RosterPendingItem {
  id: string;
  request_id?: string;
  target_table: string;
  action?: string;
  operator_id?: string | null;
  schedule_date?: string | null;
  shift_type_id?: string | null;
  area_code_id?: string | null;
  standby_type?: string | null;
  status: string;
  original_state?: ChangeRequestOriginalState | null;
}

export interface RosterProps {
  month: string;
  today: string;
  operators: Op[];
  shifts: Shift[];
  areas: Area[];
  rows: Row[];
  standby: Standby[];
  pmTasks: PmMarkTask[];
  holidays?: HolidayItem[];
  orgId: string;
  operatorId?: string | null;
  role: string;
  userName: string;
  canEdit: boolean;
  canPropose?: boolean;
  editGrant?: EditGrant | null;
  userId?: string;
  pendingItems?: RosterPendingItem[];
  initialDraftRequestId?: string | null;
  initialDraftItems?: ChangeRequestItem[];
  initialError?: string;
}

function replaceCellInState<T extends { operator_id: string; schedule_date: string }>(
  setter: Dispatch<SetStateAction<T[]>>,
  opId: string,
  date: string,
  nextVal: T | null,
) {
  const k = cellKey(opId, date);
  setter((prev) => {
    const rest = prev.filter((x) => cellKey(x.operator_id, x.schedule_date) !== k);
    return nextVal ? [...rest, nextVal] : rest;
  });
}

function restoreCellsInState<T extends { operator_id: string; schedule_date: string }>(
  setter: Dispatch<SetStateAction<T[]>>,
  keys: { opId: string; date: string; prev: T | null }[],
) {
  const keySet = new Set(keys.map((k) => cellKey(k.opId, k.date)));
  const restore = keys.map((k) => k.prev).filter((x): x is T => Boolean(x));
  setter((prev) => [...prev.filter((x) => !keySet.has(cellKey(x.operator_id, x.schedule_date))), ...restore]);
}

/** Manages roster grid state, realtime updates, history undo/redo, direct saves, and manager draft proposals. */
export function useRosterActions(p: RosterProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  const [rows, setRows] = useState<Row[]>(p.rows);
  const [standby, setStandby] = useState<Standby[]>(p.standby);
  const [onlyMe, setOnlyMe] = useState(false);
  const [mode, setMode] = useState<ToolMode>('paint');
  const [standbyType, setStandbyType] = useState<'OC' | 'DWP' | 'ERP'>('OC');
  const [shiftId, setShiftId] = useState<string | null>(p.shifts[0]?.id ?? null);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [isPending, startTransition] = useTransition();
  const [savingCount, setSavingCount] = useState(0);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [msg, setMsg] = useState(p.initialError ?? '');
  const [showHint, setShowHint] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [confirmFill, setConfirmFill] = useState<{ opId: string; opName: string; date: string; count: number } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; opId: string; opName: string; date: string } | null>(null);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const dragRef = useRef<RosterDragBatch | null>(null);

  const grantExpired = useRosterRealtime({
    month: p.month, role: p.role, editGrant: p.editGrant, routerRef, startTransition, setRows, setStandby,
  });

  const hasActiveEdit = p.canEdit && (p.role !== 'manager' || (!grantExpired && isGrantActiveAt(p.editGrant)));
  const isPropose = p.role === 'manager' && !hasActiveEdit;
  const canOperate = hasActiveEdit || Boolean(p.canPropose) || p.role === 'manager';
  const shouldProposeDate = useCallback(
    (date: string) => p.role === 'manager' && (!hasActiveEdit || !canManagerDirectEditDate(p.editGrant, date)),
    [hasActiveEdit, p.editGrant, p.role],
  );
  const holidayByDate = useMemo(() => new Map((p.holidays ?? []).map((h) => [h.holiday_date, h])), [p.holidays]);

  const drafts = useRosterDrafts({
    orgId: p.orgId, userId: p.userId, month: p.month, role: p.role,
    initialDraftRequestId: p.initialDraftRequestId, initialDraftItems: p.initialDraftItems,
    shouldProposeDate, setSaveState, setMsg, startTransition, router,
  });

  const pendingMap = useMemo(
    () => buildRosterPendingMap(p.pendingItems ?? [], drafts.proposedDraftItems),
    [p.pendingItems, drafts.proposedDraftItems],
  );

  useEffect(() => { setRows(p.rows); }, [p.rows]);
  useEffect(() => { setStandby(p.standby); }, [p.standby]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); };
  }, [ctxMenu]);

  useEffect(() => {
    if (hasActiveEdit && localStorage.getItem('bpwi-roster-hint-dismissed') !== '1') setShowHint(true);
  }, [hasActiveEdit]);

  useEffect(() => {
    if (savingCount > 0) {
      setSaveState('saving');
    } else if (saveState === 'saving') {
      setSaveState('saved');
      const t = setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2000);
      return () => clearTimeout(t);
    }
  }, [saveState, savingCount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setCtxMenu(null);
      setConfirmFill(null);
      if (!importing) setImportOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [importing]);

  const [y, mo] = p.month.split('-').map(Number);
  const monthLabel = `${MONTHS_FULL[(mo - 1 + 12) % 12]} ${y}`;
  const dayCount = new Date(y, mo, 0).getDate();
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => {
      const date = `${p.month}-${String(i + 1).padStart(2, '0')}`;
      const dow = new Date(y, mo - 1, i + 1).getDay();
      return { date, dayNum: i + 1, dow, dowLabel: WEEKDAYS[dow], isWeekend: dow === 0 || dow === 6 };
    }),
    [dayCount, mo, p.month, y],
  );

  const baseRowByKey = useMemo(() => new Map(p.rows.map((r) => [cellKey(r.operator_id, r.schedule_date), r])), [p.rows]);
  const baseStandbyByKey = useMemo(() => new Map(p.standby.map((s) => [cellKey(s.operator_id, s.schedule_date), s])), [p.standby]);
  const cell = useMemo(() => new Map(rows.map((r) => [cellKey(r.operator_id, r.schedule_date), r])), [rows]);
  const standbyMap = useMemo(() => new Map(standby.map((s) => [cellKey(s.operator_id, s.schedule_date), s])), [standby]);
  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);
  const offShift = useMemo(() => findOffShift(p.shifts), [p.shifts]);
  const lastDutyShiftIdRef = useRef<string | null>(p.shifts.find((s) => !s.is_off)?.id ?? p.shifts[0]?.id ?? null);

  function handleSelectShift(nextShiftId: string | null) {
    if (!nextShiftId) { setShiftId(null); return; }
    const { shiftId: nextS, areaId: nextA } = resolveShiftSelection(nextShiftId, areaId, shiftBy, areaBy);
    if (!shiftBy.get(nextS)?.is_off) lastDutyShiftIdRef.current = nextS;
    setShiftId(nextS);
    setAreaId(nextA);
  }

  function handleSelectArea(nextAreaId: string | null) {
    const { shiftId: nextS, areaId: nextA } = resolveAreaSelection(
      nextAreaId, shiftId, lastDutyShiftIdRef.current, shiftBy, areaBy, offShift,
    );
    setShiftId(nextS);
    setAreaId(nextA);
  }

  const pmByCell = useMemo(() => {
    const m = new Map<string, { titles: string[]; warn: boolean }>();
    for (const t of p.pmTasks) {
      const warn = t.status === 'planned' && t.scheduled_date < p.today;
      for (const opId of t.assigned_operator_ids ?? []) {
        const k = cellKey(opId, t.scheduled_date);
        const cur = m.get(k);
        if (cur) { cur.titles.push(t.title); if (warn) cur.warn = true; }
        else m.set(k, { titles: [t.title], warn });
      }
    }
    return m;
  }, [p.pmTasks, p.today]);

  const hasLinkedOp = Boolean(p.operatorId && p.operators.some((o) => o.id === p.operatorId));

  const filteredOperators = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return p.operators.filter((o) => {
      if (onlyMe && p.operatorId && o.id !== p.operatorId) return false;
      if (!q) return true;
      return o.full_name.toLowerCase().includes(q) || (o.position ?? '').toLowerCase().includes(q);
    });
  }, [deferredSearch, onlyMe, p.operatorId, p.operators]);

  const go = (d: number) => {
    const t = new Date(y, mo - 1 + d, 1);
    startTransition(() => router.push(`/?m=${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`));
  };
  const selectMonth = (m: string) => startTransition(() => router.push(`/?m=${m}`));
  const goToday = () => startTransition(() => router.push(`/?m=${p.today.slice(0, 7)}`));

  const rollbackShiftKeys = (keys: { opId: string; date: string; prev: Row | null }[]) => restoreCellsInState(setRows, keys);
  const rollbackStandbyKeys = (keys: { opId: string; date: string; prev: Standby | null }[]) => restoreCellsInState(setStandby, keys);

  async function runDirectSave(
    persist: () => Promise<string>,
    cells: { opId: string; date: string }[],
    targetTable: 'schedule_assignments' | 'standby_assignments',
    rollback: () => void,
  ) {
    const errMsg = await persist();
    if (errMsg) {
      rollback();
      setSaveState('error');
      setMsg(friendlyError(errMsg, p.role));
    } else {
      await drafts.clearDraftOverlap(cells, targetTable);
    }
  }

  async function applyHistory(entries: HistoryEntry, dir: 'undo' | 'redo') {
    const tr = computeHistoryTransition(entries, dir, cell, standbyMap);
    if (tr.skippedConcurrent > 0) setMsg(`Skipped undo on ${tr.skippedConcurrent} cell(s) modified by another user.`);
    if (tr.shiftAffected.size === 0 && tr.sbAffected.size === 0) return;

    if (tr.shiftAffected.size > 0) {
      setRows((r) => [...r.filter((x) => !tr.shiftAffected.has(cellKey(x.operator_id, x.schedule_date))), ...tr.shiftUpserts]);
    }
    if (tr.sbAffected.size > 0) {
      setStandby((s) => [...s.filter((x) => !tr.sbAffected.has(cellKey(x.operator_id, x.schedule_date))), ...tr.sbUpserts]);
    }

    const directShiftUpserts = tr.shiftUpserts.filter((u) => !shouldProposeDate(u.schedule_date));
    const directShiftDeletes = tr.shiftDeletes.filter((d) => !shouldProposeDate(d.date));
    const directShiftRollback = tr.shiftRollback.filter((r) => !shouldProposeDate(r.date));
    const directSbUpserts = tr.sbUpserts.filter((u) => !shouldProposeDate(u.schedule_date));
    const directSbDeletes = tr.sbDeletes.filter((d) => !shouldProposeDate(d.date));
    const directSbRollback = tr.sbRollback.filter((r) => !shouldProposeDate(r.date));

    setSavingCount((c) => c + 1);
    const sb = supabaseBrowser();
    try {
      if (directShiftUpserts.length > 0 || directShiftDeletes.length > 0) {
        await runDirectSave(
          () => persistDirectShiftChanges(sb, p.orgId, directShiftUpserts, directShiftDeletes),
          [...directShiftUpserts.map((u) => ({ opId: u.operator_id, date: u.schedule_date })), ...directShiftDeletes],
          'schedule_assignments',
          () => { if (directShiftRollback.length > 0) rollbackShiftKeys(directShiftRollback); },
        );
      }
      if (directSbUpserts.length > 0 || directSbDeletes.length > 0) {
        await runDirectSave(
          () => persistDirectStandbyChanges(sb, p.orgId, directSbUpserts, directSbDeletes),
          [...directSbUpserts.map((u) => ({ opId: u.operator_id, date: u.schedule_date })), ...directSbDeletes],
          'standby_assignments',
          () => { if (directSbRollback.length > 0) rollbackStandbyKeys(directSbRollback); },
        );
      }
      await drafts.syncProposedHistoryChanges({
        shiftUpserts: tr.shiftUpserts, shiftDeletes: tr.shiftDeletes, shiftRollback: tr.shiftRollback,
        sbUpserts: tr.sbUpserts, sbDeletes: tr.sbDeletes, sbRollback: tr.sbRollback,
        baseRowByKey, baseStandbyByKey, rollbackShiftKeys, rollbackStandbyKeys,
      });
    } finally {
      setSavingCount((c) => c - 1);
    }
  }

  function handleUndo() {
    if (!canOperate || undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, last]);
    void applyHistory(last, 'undo');
  }

  function handleRedo() {
    if (!canOperate || redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, last]);
    void applyHistory(last, 'redo');
  }

  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (importOpen || confirmFill || ctxMenu || document.querySelector('[role="dialog"]')) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape' && mode === 'copy') {
      clip.handleCopyEscape();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      handleUndo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      handleRedo();
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key >= '1' && e.key <= '9') {
        const shift = p.shifts[Number(e.key) - 1];
        if (shift) { setMode('paint'); handleSelectShift(shift.id); }
      } else if (e.key === '0') {
        setMode('paint'); setAreaId(null);
      } else if (e.key.toLowerCase() === 's') {
        setMode((m) => (m === 'standby' ? 'paint' : 'standby'));
      } else if (e.key.toLowerCase() === 'e') {
        setMode((m) => (m === 'erase' ? 'paint' : 'erase'));
      }
    }
  };

  useEffect(() => {
    if (!canOperate) return;
    const onKeyDown = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canOperate]);

  async function persistShiftEntries(entries: ShiftHistoryItem[]) {
    if (entries.length === 0) return;
    const directEntries = entries.filter((e) => !shouldProposeDate(e.date));
    const proposedEntries = entries.filter((e) => shouldProposeDate(e.date));
    setSavingCount((c) => c + 1);
    try {
      if (directEntries.length > 0) {
        const upserts = directEntries.map((e) => e.next).filter((x): x is Row => Boolean(x));
        const deletes = directEntries.filter((e) => !e.next).map((e) => ({ opId: e.opId, date: e.date }));
        await runDirectSave(
          () => persistDirectShiftChanges(supabaseBrowser(), p.orgId, upserts, deletes),
          directEntries.map((e) => ({ opId: e.opId, date: e.date })),
          'schedule_assignments',
          () => rollbackShiftKeys(directEntries.map((e) => ({ opId: e.opId, date: e.date, prev: e.prev }))),
        );
      }
      if (proposedEntries.length > 0) {
        await drafts.saveDraftProposal(
          proposedEntries.map(buildShiftProposalInput),
          () => rollbackShiftKeys(proposedEntries.map((e) => ({ opId: e.opId, date: e.date, prev: e.prev }))),
        );
      }
    } finally {
      setSavingCount((c) => c - 1);
    }
  }

  async function saveShiftCell(opId: string, date: string, nextRow: Row | null, prevCell: Row | null) {
    replaceCellInState(setRows, opId, date, nextRow);
    const entry: ShiftHistoryItem = { kind: 'shift', opId, date, prev: prevCell, next: nextRow };
    setUndoStack((s) => [...s.slice(-29), [entry]]);
    setRedoStack([]);
    await persistShiftEntries([entry]);
  }

  async function setStandbyValue(opId: string, date: string, nextType: string | null) {
    if (!canOperate) return;
    setMsg('');
    const prevSb = standbyMap.get(cellKey(opId, date)) ?? null;
    const nextSb: Standby | null = nextType ? { operator_id: opId, schedule_date: date, standby_type: nextType } : null;
    replaceCellInState(setStandby, opId, date, nextSb);
    setUndoStack((s) => [...s.slice(-29), [{ kind: 'standby', opId, date, prev: prevSb, next: nextSb }]]);
    setRedoStack([]);
    setSavingCount((c) => c + 1);

    const rollback = () => rollbackStandbyKeys([{ opId, date, prev: prevSb }]);
    try {
      if (shouldProposeDate(date)) {
        await drafts.saveDraftProposal([{
          target_table: 'standby_assignments',
          action: nextType === null ? 'delete' : 'upsert',
          operator_id: opId, schedule_date: date, standby_type: nextType,
          original_state: prevSb ? { standby_type: prevSb.standby_type } : { standby_type: null },
        }], rollback);
        return;
      }
      await runDirectSave(
        () => persistDirectStandbyChanges(supabaseBrowser(), p.orgId, nextSb ? [nextSb] : [], nextSb ? [] : [{ opId, date }]),
        [{ opId, date }],
        'standby_assignments',
        rollback,
      );
    } finally {
      setSavingCount((c) => c - 1);
    }
  }

  async function clearCell(opId: string, date: string) {
    if (!canOperate) return;
    setMsg('');
    const existing = cell.get(cellKey(opId, date)) ?? null;
    if (!existing) return;
    await saveShiftCell(opId, date, null, existing);
  }

  async function fillRight(opId: string, fromDate: string) {
    if (!canOperate) return;
    const source = cell.get(cellKey(opId, fromDate));
    if (!source) { setMsg('Select a cell with an assignment before filling right.'); return; }
    const normalizedShiftId = normalizeShiftForArea(source.shift_type_id, source.area_code_id, areaBy, offShift);
    const targets = days.filter((d) => d.date >= fromDate).map((d) => d.date);
    const upserts: Row[] = targets.map((date) => ({
      operator_id: opId, schedule_date: date, shift_type_id: normalizedShiftId, area_code_id: source.area_code_id,
    }));
    const history: ShiftHistoryItem[] = upserts.map((next) => ({
      kind: 'shift', opId, date: next.schedule_date, prev: cell.get(cellKey(opId, next.schedule_date)) ?? null, next,
    }));
    const targetSet = new Set(targets);
    setRows((r) => [...r.filter((x) => !(x.operator_id === opId && targetSet.has(x.schedule_date))), ...upserts]);
    setUndoStack((s) => [...s.slice(-29), history]);
    setRedoStack([]);
    await persistShiftEntries(history);
  }

  function applyBrushLocal(opId: string, date: string) {
    const batch = dragRef.current;
    if (!batch) return;
    const k = cellKey(opId, date);
    if (batch.visited.has(k)) return;
    batch.visited.add(k);

    const prevCell = cell.get(k) ?? null;
    if (mode === 'erase') {
      if (!prevCell) return;
      batch.entries.push({ kind: 'shift', opId, date, prev: prevCell, next: null });
      batch.deletes.push({ opId, date });
      replaceCellInState(setRows, opId, date, null);
      return;
    }

    const effShiftId = normalizeShiftForArea(shiftId, areaId, areaBy, offShift);
    if (!effShiftId && !areaId) return;
    const nextRow: Row = { operator_id: opId, schedule_date: date, shift_type_id: effShiftId, area_code_id: areaId };
    batch.entries.push({ kind: 'shift', opId, date, prev: prevCell, next: nextRow });
    batch.upserts.push(nextRow);
    replaceCellInState(setRows, opId, date, nextRow);
  }

  async function commitDragBatch() {
    const batch = dragRef.current;
    dragRef.current = null;
    if (!batch || batch.entries.length === 0) return;
    setUndoStack((s) => [...s.slice(-29), batch.entries]);
    setRedoStack([]);
    await persistShiftEntries(batch.entries);
  }

  const clip = useRosterClipboard({
    canOperate,
    filteredOperators,
    days,
    cell,
    shiftBy,
    areaBy,
    offShift,
    setMode,
    setMsg,
    setRows,
    setUndoStack,
    setRedoStack,
    persistShiftEntries,
    saveShiftCell,
    clearCell,
  });

  const pointerUpRef = useRef<() => void>(() => {});
  pointerUpRef.current = () => {
    if (dragRef.current?.active) void commitDragBatch();
    if (clip.hasActiveCopyDrag()) clip.commitCopySelection();
  };

  useEffect(() => {
    const onPointerUp = () => pointerUpRef.current();
    window.addEventListener('pointerup', onPointerUp);
    return () => window.removeEventListener('pointerup', onPointerUp);
  }, []);

  async function activateCell(opId: string, date: string) {
    if (!canOperate) return;
    setMsg('');
    if (mode === 'copy') {
      await clip.activateCopyCell(opId, date);
      return;
    }
    if (mode === 'standby') {
      const existing = standbyMap.get(cellKey(opId, date));
      await setStandbyValue(opId, date, existing?.standby_type === standbyType ? null : standbyType);
      return;
    }
    if (mode === 'erase') { await clearCell(opId, date); return; }
    const effShiftId = normalizeShiftForArea(shiftId, areaId, areaBy, offShift);
    if (!effShiftId && !areaId) return;
    const prevCell = cell.get(cellKey(opId, date)) ?? null;
    await saveShiftCell(opId, date, { operator_id: opId, schedule_date: date, shift_type_id: effShiftId, area_code_id: areaId }, prevCell);
  }

  function exportCsv() {
    const csv = buildRosterCsv({ days, operators: filteredOperators, cell, shiftBy, areaBy, standbyMap });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `bpwi-roster-${p.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportStatus('');
    try {
      const res = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await file.text() });
      const json = await res.json();
      if (!res.ok) {
        setImportStatus(`Error: ${json.error ?? res.statusText}`);
      } else {
        setImportStatus(
          `Imported ${json.operators} operators, ${json.shifts} shifts, ${json.areas} areas, ${json.assignments} assignments, ${json.standby} standby, ${json.pm_tasks} PM tasks.`,
        );
        router.refresh();
      }
    } catch (err: unknown) {
      setImportStatus(`Error: ${getErrorMessage(err, 'Failed to import file')}`);
    } finally {
      setImporting(false);
    }
  }

  const dailyWorkingCounts = useMemo(
    () => days.map((d) => {
      let count = 0;
      for (const o of filteredOperators) {
        const r = cell.get(cellKey(o.id, d.date));
        const s = r?.shift_type_id ? shiftBy.get(r.shift_type_id) : undefined;
        const a = r?.area_code_id ? areaBy.get(r.area_code_id) : undefined;
        if (s && !s.is_off && !isOffPartnerArea(a)) count += 1;
      }
      return count;
    }),
    [areaBy, cell, days, filteredOperators, shiftBy],
  );

  const todayCoverage = useMemo(() => {
    let duty = 0, sb = 0, off = 0, leave = 0;
    for (const o of p.operators) {
      const k = cellKey(o.id, p.today);
      const r = cell.get(k);
      const s = r?.shift_type_id ? shiftBy.get(r.shift_type_id) : undefined;
      const a = r?.area_code_id ? areaBy.get(r.area_code_id) : undefined;
      if (standbyMap.has(k)) sb += 1;
      if (isLeaveArea(a)) leave += 1;
      else if (isRestArea(a) || isHolidayArea(a) || s?.is_off) off += 1;
      else if (s && !s.is_off) duty += 1;
    }
    return { duty, sb, off, leave };
  }, [areaBy, cell, p.operators, p.today, shiftBy, standbyMap]);

  const selectedShift = shiftId ? shiftBy.get(shiftId) : undefined;
  const selectedArea = areaId ? areaBy.get(areaId) : undefined;
  const brushLabel = mode === 'copy'
    ? (clip.copiedBlock ? `Copied: ${clip.copiedBlock.label}` : 'Copy & Paste: Select cells')
    : mode === 'erase' ? 'Clear Cell'
    : mode === 'standby' ? `Standby (${standbyType})`
    : `${selectedShift?.code ?? '—'} + ${selectedArea?.code ?? (selectedShift?.is_off ? 'none' : DEFAULT_STATION_CODE)}`;

  return {
    hasActiveEdit, isPropose, canOperate, holidayByDate,
    draftItems: drafts.draftItems, proposedDraftItems: drafts.proposedDraftItems,
    submitModalOpen: drafts.submitModalOpen, setSubmitModalOpen: drafts.setSubmitModalOpen,
    submitNote: drafts.submitNote, setSubmitNote: drafts.setSubmitNote,
    isSubmittingDraft: drafts.isSubmittingDraft,
    pendingMap, onlyMe, setOnlyMe, mode, setMode, standbyType, setStandbyType,
    copyStep: clip.copyStep,
    copiedBlock: clip.copiedBlock,
    copySelection: clip.copySelection,
    enterCopyMode: clip.enterCopyMode,
    resetCopySource: clip.resetCopySource,
    startCopySelection: clip.startCopySelection,
    updateCopySelection: clip.updateCopySelection,
    pasteCopiedBlockAt: clip.pasteCopiedBlockAt,
    shiftId, areaId, search, setSearch, isPending, saveState, msg,
    showHint, setShowHint, mobileToolsOpen, setMobileToolsOpen,
    confirmFill, setConfirmFill, importOpen, setImportOpen, importing, importStatus, setImportStatus,
    ctxMenu, setCtxMenu, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0,
    dragRef, monthLabel, days, cell, standbyMap, shiftBy, areaBy, pmByCell,
    hasLinkedOp, filteredOperators, dailyWorkingCounts, todayCoverage, brushLabel,
    go, selectMonth, goToday, handleSelectShift, handleSelectArea, handleUndo, handleRedo,
    applyBrushLocal, activateCell, clearCell, setStandbyValue, fillRight,
    copyCell: clip.copyCell,
    pasteCell: clip.pasteCell,
    exportCsv, handleImportFile,
    submitDraftBatch: drafts.submitDraftBatch,
    discardDraftBatch: drafts.discardDraftBatch,
  };
}
