'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { subscribeVisibilityAwareChannel } from '@/lib/supabase/realtime';
import type { ChangeRequestItem, ChangeRequestOriginalState, EditGrant } from '@/lib/profile';
import { getErrorMessage } from '@/lib/error-utils';
import { isGrantActiveAt } from '@/lib/edit-grant';
import {
  buildRosterCsv,
  buildRosterPendingMap,
  cellKey,
  clearDraftItemsForCells,
  computeHistoryTransition,
  DEFAULT_STATION_CODE,
  findOffShift,
  friendlyError,
  isHolidayArea,
  isLeaveArea,
  isOffPartnerArea,
  isRestArea,
  MONTHS_FULL,
  normalizeShiftForArea,
  persistDirectShiftChanges,
  persistDirectStandbyChanges,
  replaceProposedDraftItems,
  resolveAreaSelection,
  resolveShiftSelection,
  WEEKDAYS,
  type Area,
  type HistoryEntry,
  type HolidayItem,
  type Op,
  type PendingCellEntry,
  type PmMarkTask,
  type ProposedChangeInput,
  type RosterDragBatch,
  type Row,
  type Shift,
  type ShiftHistoryItem,
  type Standby,
  type ToolMode,
} from '@/lib/roster-helpers';
import RosterMobileViews from '@/components/RosterMobileViews';
import RosterToolbar from '@/components/RosterToolbar';
import RosterGrid from '@/components/RosterGrid';
import {
  RosterContextMenu,
  RosterFillConfirmModal,
  RosterImportJsonModal,
  RosterProposeBar,
  RosterSubmitProposalModal,
} from '@/components/RosterModals';

export default function Roster(p: {
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
  pendingItems?: Array<{
    id: string; request_id?: string; target_table: string; action?: string;
    operator_id?: string | null; schedule_date?: string | null; shift_type_id?: string | null;
    area_code_id?: string | null; standby_type?: string | null; status: string;
    original_state?: ChangeRequestOriginalState | null;
  }>;
  initialDraftRequestId?: string | null;
  initialDraftItems?: ChangeRequestItem[];
  initialError?: string;
}) {
  const router = useRouter();
  const [grantExpired, setGrantExpired] = useState(false);
  useEffect(() => {
    setGrantExpired(false);
    if (p.role !== 'manager' || !p.editGrant) return;
    const ms = Date.parse(p.editGrant.ends_at) - Date.now();
    if (ms <= 0) {
      setGrantExpired(true);
      return;
    }
    const timer = setTimeout(() => setGrantExpired(true), Math.min(ms + 250, 2_000_000_000));
    return () => clearTimeout(timer);
  }, [p.role, p.editGrant]);

  const hasActiveEdit = p.canEdit && (p.role !== 'manager' || (!grantExpired && isGrantActiveAt(p.editGrant)));
  const isPropose = p.role === 'manager' && !hasActiveEdit;
  const canOperate = hasActiveEdit || Boolean(p.canPropose) || p.role === 'manager';
  const holidayByDate = useMemo(
    () => new Map((p.holidays ?? []).map((h) => [h.holiday_date, h])),
    [p.holidays],
  );

  const [draftReqId, setDraftReqId] = useState<string | null>(p.initialDraftRequestId ?? null);
  const [draftItems, setDraftItems] = useState<ChangeRequestItem[]>(p.initialDraftItems ?? []);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false);

  const pendingMap = useMemo(
    () => buildRosterPendingMap(p.pendingItems ?? [], hasActiveEdit ? [] : draftItems),
    [p.pendingItems, hasActiveEdit, draftItems],
  );

  async function ensureDraftRequestId(): Promise<string> {
    if (draftReqId) return draftReqId;
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('change_requests')
      .insert({
        organization_id: p.orgId,
        requester_id: p.userId,
        status: 'draft',
        title: `Schedule Proposal for ${p.month}`,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Could not create draft request');
    setDraftReqId(data.id);
    return data.id;
  }

  function mergeDraftItems(inserted: ChangeRequestItem[]) {
    if (inserted.length === 0) return;
    const keys = new Set(inserted.map((x) => `${x.operator_id ?? ''}:${x.schedule_date ?? ''}`));
    setDraftItems((prev) => [
      ...prev.filter((x) => !keys.has(`${x.operator_id ?? ''}:${x.schedule_date ?? ''}`)),
      ...inserted,
    ]);
  }

  async function saveDraftProposal(items: ProposedChangeInput[], onErrorRollback: () => void) {
    try {
      const reqId = await ensureDraftRequestId();
      const inserted = await replaceProposedDraftItems(supabaseBrowser(), reqId, p.orgId, items);
      mergeDraftItems(inserted);
    } catch (err: unknown) {
      onErrorRollback();
      setSaveState('error');
      setMsg(friendlyError(getErrorMessage(err), p.role));
    } finally {
      setSavingCount((c) => c - 1);
    }
  }

  async function submitDraftBatch() {
    if (!draftReqId || draftItems.length === 0) return;
    setIsSubmittingDraft(true);
    setMsg('');
    const sb = supabaseBrowser();

    try {
      const { error } = await sb.rpc('submit_change_request', {
        p_request_id: draftReqId,
        p_note: submitNote.trim() || null,
      });

      if (error) {
        setMsg('Could not submit changes: ' + error.message);
      } else {
        const count = draftItems.length;
        setDraftReqId(null);
        setDraftItems([]);
        setSubmitModalOpen(false);
        setSubmitNote('');
        setMsg(`✓ Successfully submitted ${count} change(s) for admin approval.`);
        startTransition(() => router.refresh());
      }
    } catch (e: unknown) {
      setMsg(getErrorMessage(e, 'Network error while submitting changes'));
    } finally {
      setIsSubmittingDraft(false);
    }
  }

  async function discardDraftBatch() {
    if (!draftReqId) {
      setDraftItems([]);
      return;
    }
    const sb = supabaseBrowser();
    await sb.from('change_requests').delete().eq('id', draftReqId);
    setDraftReqId(null);
    setDraftItems([]);
    setMsg('Draft proposal discarded.');
    startTransition(() => router.refresh());
  }

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
  const [clipboard, setClipboard] = useState<{ shift_type_id: string | null; area_code_id: string | null } | null>(null);

  const dragRef = useRef<RosterDragBatch | null>(null);

  useEffect(() => {
    setRows(p.rows);
  }, [p.rows]);

  useEffect(() => {
    setStandby(p.standby);
  }, [p.standby]);

  useEffect(() => {
    const sb = supabaseBrowser();
    return subscribeVisibilityAwareChannel({
      sb,
      channelName: `roster-sync-${p.month}`,
      listeners: [
        {
          table: 'schedule_assignments',
          onEvent: (payload) => {
            const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Partial<Row> | undefined;
            if (!rec?.operator_id || !rec?.schedule_date || !rec.schedule_date.startsWith(p.month)) return;
            if (payload.eventType === 'DELETE') {
              setRows((r) => r.filter((x) => !(x.operator_id === rec.operator_id && x.schedule_date === rec.schedule_date)));
            } else {
              const nextRow: Row = {
                operator_id: rec.operator_id,
                schedule_date: rec.schedule_date,
                shift_type_id: rec.shift_type_id ?? null,
                area_code_id: rec.area_code_id ?? null,
              };
              setRows((r) => [...r.filter((x) => !(x.operator_id === nextRow.operator_id && x.schedule_date === nextRow.schedule_date)), nextRow]);
            }
          },
        },
        {
          table: 'standby_assignments',
          onEvent: (payload) => {
            const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Partial<Standby> | undefined;
            if (!rec?.operator_id || !rec?.schedule_date || !rec.schedule_date.startsWith(p.month)) return;
            if (payload.eventType === 'DELETE') {
              setStandby((s) => s.filter((x) => !(x.operator_id === rec.operator_id && x.schedule_date === rec.schedule_date)));
            } else {
              const nextSb: Standby = {
                operator_id: rec.operator_id,
                schedule_date: rec.schedule_date,
                standby_type: rec.standby_type ?? 'OC',
              };
              setStandby((s) => [
                ...s.filter((x) => !(x.operator_id === nextSb.operator_id && x.schedule_date === nextSb.schedule_date)),
                nextSb,
              ]);
            }
          },
        },
      ],
    });
  }, [p.month]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (hasActiveEdit && localStorage.getItem('bpwi-roster-hint-dismissed') !== '1') {
      setShowHint(true);
    }
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
      if (e.key === 'Escape') {
        setCtxMenu(null);
        setConfirmFill(null);
        if (!importing) setImportOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [importing]);

  const [y, mo] = p.month.split('-').map(Number);
  const monthLabel = `${MONTHS_FULL[(mo - 1 + 12) % 12]} ${y}`;
  const dayCount = new Date(y, mo, 0).getDate();
  const days = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, i) => {
        const date = `${p.month}-${String(i + 1).padStart(2, '0')}`;
        const dow = new Date(y, mo - 1, i + 1).getDay();
        return { date, dayNum: i + 1, dow, dowLabel: WEEKDAYS[dow], isWeekend: dow === 0 || dow === 6 };
      }),
    [dayCount, mo, p.month, y],
  );

  const cell = useMemo(() => new Map(rows.map((r) => [cellKey(r.operator_id, r.schedule_date), r])), [rows]);
  const standbyMap = useMemo(() => new Map(standby.map((s) => [cellKey(s.operator_id, s.schedule_date), s])), [standby]);
  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);
  const offShift = useMemo(() => findOffShift(p.shifts), [p.shifts]);
  const lastDutyShiftIdRef = useRef<string | null>(p.shifts.find((s) => !s.is_off)?.id ?? p.shifts[0]?.id ?? null);

  function handleSelectShift(nextShiftId: string | null) {
    if (!nextShiftId) {
      setShiftId(null);
      return;
    }
    const { shiftId: nextS, areaId: nextA } = resolveShiftSelection(nextShiftId, areaId, shiftBy, areaBy);
    if (!shiftBy.get(nextS)?.is_off) lastDutyShiftIdRef.current = nextS;
    setShiftId(nextS);
    setAreaId(nextA);
  }

  function handleSelectArea(nextAreaId: string | null) {
    const { shiftId: nextS, areaId: nextA } = resolveAreaSelection(
      nextAreaId,
      shiftId,
      lastDutyShiftIdRef.current,
      shiftBy,
      areaBy,
      offShift,
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
        if (cur) {
          cur.titles.push(t.title);
          if (warn) cur.warn = true;
        } else {
          m.set(k, { titles: [t.title], warn });
        }
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
    startTransition(() => {
      router.push(`/?m=${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`);
    });
  };

  function rollbackShiftKeys(keys: { opId: string; date: string; prev: Row | null }[]) {
    const keySet = new Set(keys.map((k) => cellKey(k.opId, k.date)));
    const restore = keys.map((k) => k.prev).filter((x): x is Row => Boolean(x));
    setRows((r) => [...r.filter((x) => !keySet.has(cellKey(x.operator_id, x.schedule_date))), ...restore]);
  }

  function rollbackStandbyKeys(keys: { opId: string; date: string; prev: Standby | null }[]) {
    const keySet = new Set(keys.map((k) => cellKey(k.opId, k.date)));
    const restore = keys.map((k) => k.prev).filter((x): x is Standby => Boolean(x));
    setStandby((s) => [...s.filter((x) => !keySet.has(cellKey(x.operator_id, x.schedule_date))), ...restore]);
  }

  async function applyHistory(entries: HistoryEntry, dir: 'undo' | 'redo') {
    const {
      shiftUpserts,
      shiftDeletes,
      shiftAffected,
      shiftRollback,
      sbUpserts,
      sbDeletes,
      sbAffected,
      sbRollback,
      skippedConcurrent,
    } = computeHistoryTransition(entries, dir, cell, standbyMap);

    if (skippedConcurrent > 0) setMsg(`Skipped undo on ${skippedConcurrent} cell(s) modified by another user.`);
    if (shiftAffected.size === 0 && sbAffected.size === 0) return;

    if (shiftAffected.size > 0) {
      setRows((r) => [...r.filter((x) => !shiftAffected.has(cellKey(x.operator_id, x.schedule_date))), ...shiftUpserts]);
    }
    if (sbAffected.size > 0) {
      setStandby((s) => [...s.filter((x) => !sbAffected.has(cellKey(x.operator_id, x.schedule_date))), ...sbUpserts]);
    }

    setSavingCount((c) => c + 1);
    const sb = supabaseBrowser();
    const shiftErr = await persistDirectShiftChanges(sb, p.orgId, shiftUpserts, shiftDeletes);
    const sbErr = await persistDirectStandbyChanges(sb, p.orgId, sbUpserts, sbDeletes);
    const errMsg = shiftErr || sbErr;

    setSavingCount((c) => c - 1);
    if (errMsg) {
      if (shiftRollback.length > 0) rollbackShiftKeys(shiftRollback);
      if (sbRollback.length > 0) rollbackStandbyKeys(sbRollback);
      setSaveState('error');
      setMsg(friendlyError(errMsg, p.role));
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

  useEffect(() => {
    if (!canOperate) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (importOpen || confirmFill || ctxMenu || document.querySelector('[role="dialog"]')) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        handleRedo();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key >= '1' && e.key <= '9') {
          const shift = p.shifts[Number(e.key) - 1];
          if (shift) {
            setMode('paint');
            handleSelectShift(shift.id);
          }
        } else if (e.key === '0') {
          setMode('paint');
          setAreaId(null);
        } else if (e.key.toLowerCase() === 's') {
          setMode((m) => (m === 'standby' ? 'paint' : 'standby'));
        } else if (e.key.toLowerCase() === 'e') {
          setMode((m) => (m === 'erase' ? 'paint' : 'erase'));
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  async function saveShiftCell(opId: string, date: string, nextRow: Row | null, prevCell: Row | null) {
    if (nextRow) {
      setRows((r) => [...r.filter((x) => !(x.operator_id === opId && x.schedule_date === date)), nextRow]);
    } else {
      setRows((r) => r.filter((x) => cellKey(x.operator_id, x.schedule_date) !== cellKey(opId, date)));
    }
    setUndoStack((s) => [...s.slice(-29), [{ kind: 'shift', opId, date, prev: prevCell, next: nextRow }]]);
    setRedoStack([]);
    setSavingCount((c) => c + 1);

    const rollback = () => rollbackShiftKeys([{ opId, date, prev: prevCell }]);
    if (isPropose) {
      await saveDraftProposal(
        [
          {
            target_table: 'schedule_assignments',
            action: nextRow ? 'upsert' : 'delete',
            operator_id: opId,
            schedule_date: date,
            ...(nextRow ? { shift_type_id: nextRow.shift_type_id, area_code_id: nextRow.area_code_id } : {}),
            original_state: prevCell ? { shift_type_id: prevCell.shift_type_id, area_code_id: prevCell.area_code_id } : { shift_type_id: null, area_code_id: null },
          },
        ],
        rollback,
      );
      return;
    }

    const errMsg = await persistDirectShiftChanges(
      supabaseBrowser(),
      p.orgId,
      nextRow ? [nextRow] : [],
      nextRow ? [] : [{ opId, date }],
    );
    setSavingCount((c) => c - 1);
    if (errMsg) {
      rollback();
      setSaveState('error');
      setMsg(friendlyError(errMsg, p.role));
    } else if (draftReqId && draftItems.length > 0) {
      const nextDraft = await clearDraftItemsForCells(supabaseBrowser(), draftReqId, draftItems, [{ opId, date }]);
      if (nextDraft !== draftItems) setDraftItems(nextDraft);
    }
  }

  async function setStandbyValue(opId: string, date: string, nextType: string | null) {
    if (!canOperate) return;
    setMsg('');
    const k = cellKey(opId, date);
    const prevSb = standbyMap.get(k) ?? null;
    const nextSb: Standby | null = nextType ? { operator_id: opId, schedule_date: date, standby_type: nextType } : null;

    if (nextSb === null) {
      setStandby((s) => s.filter((x) => cellKey(x.operator_id, x.schedule_date) !== k));
    } else {
      setStandby((s) => [...s.filter((x) => cellKey(x.operator_id, x.schedule_date) !== k), nextSb]);
    }
    setUndoStack((s) => [...s.slice(-29), [{ kind: 'standby', opId, date, prev: prevSb, next: nextSb }]]);
    setRedoStack([]);
    setSavingCount((c) => c + 1);

    const rollback = () => rollbackStandbyKeys([{ opId, date, prev: prevSb }]);
    if (isPropose) {
      await saveDraftProposal(
        [
          {
            target_table: 'standby_assignments',
            action: nextType === null ? 'delete' : 'upsert',
            operator_id: opId,
            schedule_date: date,
            standby_type: nextType,
            original_state: prevSb ? { standby_type: prevSb.standby_type } : { standby_type: null },
          },
        ],
        rollback,
      );
      return;
    }

    const errMsg = await persistDirectStandbyChanges(
      supabaseBrowser(),
      p.orgId,
      nextSb ? [nextSb] : [],
      nextSb ? [] : [{ opId, date }],
    );
    setSavingCount((c) => c - 1);
    if (errMsg) {
      rollback();
      setSaveState('error');
      setMsg(friendlyError(errMsg, p.role));
    } else if (draftReqId && draftItems.length > 0) {
      const nextDraft = await clearDraftItemsForCells(supabaseBrowser(), draftReqId, draftItems, [{ opId, date }]);
      if (nextDraft !== draftItems) setDraftItems(nextDraft);
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
    if (!source) {
      setMsg('Select a cell with an assignment before filling right.');
      return;
    }
    const normalizedShiftId = normalizeShiftForArea(source.shift_type_id, source.area_code_id, areaBy, offShift);
    const targets = days.filter((d) => d.date >= fromDate).map((d) => d.date);
    const history: ShiftHistoryItem[] = targets.map((date) => ({
      kind: 'shift',
      opId,
      date,
      prev: cell.get(cellKey(opId, date)) ?? null,
      next: { operator_id: opId, schedule_date: date, shift_type_id: normalizedShiftId, area_code_id: source.area_code_id },
    }));
    const upserts: Row[] = history.map((h) => h.next!);
    const targetSet = new Set(targets);
    setRows((r) => [...r.filter((x) => !(x.operator_id === opId && targetSet.has(x.schedule_date))), ...upserts]);
    setUndoStack((s) => [...s.slice(-29), history]);
    setRedoStack([]);
    setSavingCount((c) => c + 1);

    const rollback = () => rollbackShiftKeys(history.map((h) => ({ opId: h.opId, date: h.date, prev: h.prev })));
    if (isPropose) {
      await saveDraftProposal(
        history.map((h) => ({
          target_table: 'schedule_assignments',
          action: 'upsert',
          operator_id: h.opId,
          schedule_date: h.date,
          shift_type_id: normalizedShiftId,
          area_code_id: source.area_code_id,
          original_state: h.prev ? { shift_type_id: h.prev.shift_type_id, area_code_id: h.prev.area_code_id } : { shift_type_id: null, area_code_id: null },
        })),
        rollback,
      );
      return;
    }

    const errMsg = await persistDirectShiftChanges(supabaseBrowser(), p.orgId, upserts, []);
    setSavingCount((c) => c - 1);
    if (errMsg) {
      rollback();
      setSaveState('error');
      setMsg(friendlyError(errMsg, p.role));
    } else if (draftReqId && draftItems.length > 0) {
      const nextDraft = await clearDraftItemsForCells(supabaseBrowser(), draftReqId, draftItems, targets.map((date) => ({ opId, date })));
      if (nextDraft !== draftItems) setDraftItems(nextDraft);
    }
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
      setRows((r) => r.filter((x) => cellKey(x.operator_id, x.schedule_date) !== k));
      return;
    }

    const effShiftId = normalizeShiftForArea(shiftId, areaId, areaBy, offShift);
    if (!effShiftId && !areaId) return;
    const nextRow: Row = { operator_id: opId, schedule_date: date, shift_type_id: effShiftId, area_code_id: areaId };
    batch.entries.push({ kind: 'shift', opId, date, prev: prevCell, next: nextRow });
    batch.upserts.push(nextRow);
    setRows((r) => [...r.filter((x) => !(x.operator_id === opId && x.schedule_date === date)), nextRow]);
  }

  async function commitDragBatch() {
    const batch = dragRef.current;
    dragRef.current = null;
    if (!batch || batch.entries.length === 0) return;

    setUndoStack((s) => [...s.slice(-29), batch.entries]);
    setRedoStack([]);
    setSavingCount((c) => c + 1);

    const rollback = () => rollbackShiftKeys(batch.entries.map((e) => ({ opId: e.opId, date: e.date, prev: e.prev })));
    if (isPropose) {
      const proposalItems: ProposedChangeInput[] = [
        ...batch.upserts.map((u) => {
          const prevEntry = batch.entries.find((e) => e.opId === u.operator_id && e.date === u.schedule_date);
          return {
            target_table: 'schedule_assignments' as const,
            action: 'upsert' as const,
            operator_id: u.operator_id,
            schedule_date: u.schedule_date,
            shift_type_id: u.shift_type_id,
            area_code_id: u.area_code_id,
            original_state: prevEntry?.prev ? { shift_type_id: prevEntry.prev.shift_type_id, area_code_id: prevEntry.prev.area_code_id } : { shift_type_id: null, area_code_id: null },
          };
        }),
        ...batch.deletes.map((d) => {
          const prevEntry = batch.entries.find((e) => e.opId === d.opId && e.date === d.date);
          return {
            target_table: 'schedule_assignments' as const,
            action: 'delete' as const,
            operator_id: d.opId,
            schedule_date: d.date,
            original_state: prevEntry?.prev ? { shift_type_id: prevEntry.prev.shift_type_id, area_code_id: prevEntry.prev.area_code_id } : { shift_type_id: null, area_code_id: null },
          };
        }),
      ];
      await saveDraftProposal(proposalItems, rollback);
      return;
    }

    const errMsg = await persistDirectShiftChanges(supabaseBrowser(), p.orgId, batch.upserts, batch.deletes);
    setSavingCount((c) => c - 1);
    if (errMsg) {
      rollback();
      setSaveState('error');
      setMsg(friendlyError(errMsg, p.role));
    } else if (draftReqId && draftItems.length > 0) {
      const cells = batch.entries.map((e) => ({ opId: e.opId, date: e.date }));
      const nextDraft = await clearDraftItemsForCells(supabaseBrowser(), draftReqId, draftItems, cells);
      if (nextDraft !== draftItems) setDraftItems(nextDraft);
    }
  }

  useEffect(() => {
    const onPointerUp = () => {
      if (dragRef.current?.active) void commitDragBatch();
    };
    window.addEventListener('pointerup', onPointerUp);
    return () => window.removeEventListener('pointerup', onPointerUp);
  });

  async function activateCell(opId: string, date: string) {
    if (!canOperate) return;
    setMsg('');
    if (mode === 'standby') {
      const existing = standbyMap.get(cellKey(opId, date));
      await setStandbyValue(opId, date, existing?.standby_type === standbyType ? null : standbyType);
      return;
    }
    if (mode === 'erase') {
      await clearCell(opId, date);
      return;
    }
    const effShiftId = normalizeShiftForArea(shiftId, areaId, areaBy, offShift);
    if (!effShiftId && !areaId) return;
    const prevCell = cell.get(cellKey(opId, date)) ?? null;
    await saveShiftCell(opId, date, { operator_id: opId, schedule_date: date, shift_type_id: effShiftId, area_code_id: areaId }, prevCell);
  }

  function copyCell(opId: string, date: string) {
    const existing = cell.get(cellKey(opId, date));
    setClipboard(existing ? { shift_type_id: existing.shift_type_id, area_code_id: existing.area_code_id } : { shift_type_id: null, area_code_id: null });
  }

  function pasteCell(opId: string, date: string) {
    if (!clipboard || !canOperate) return;
    const effShiftId = normalizeShiftForArea(clipboard.shift_type_id, clipboard.area_code_id, areaBy, offShift);
    if (!effShiftId && !clipboard.area_code_id) {
      void clearCell(opId, date);
      return;
    }
    const prevCell = cell.get(cellKey(opId, date)) ?? null;
    void saveShiftCell(opId, date, { operator_id: opId, schedule_date: date, shift_type_id: effShiftId, area_code_id: clipboard.area_code_id }, prevCell);
  }

  function exportCsv() {
    const csv = buildRosterCsv({ days, operators: filteredOperators, cell, shiftBy, areaBy, standbyMap });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
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
      const text = await file.text();
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });
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
    () =>
      days.map((d) => {
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
    let duty = 0;
    let sb = 0;
    let off = 0;
    let leave = 0;
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
  const brushLabel =
    mode === 'erase'
      ? 'Clear Cell'
      : mode === 'standby'
        ? `Standby (${standbyType})`
        : `${selectedShift?.code ?? '—'} + ${selectedArea?.code ?? (selectedShift?.is_off ? 'none' : DEFAULT_STATION_CODE)}`;

  return (
    <div style={{ padding: '10px 14px 16px', maxWidth: '100%' }}>
      <RosterToolbar
        month={p.month}
        today={p.today}
        orgId={p.orgId}
        role={p.role}
        canEdit={hasActiveEdit}
        canOperate={canOperate}
        isPropose={isPropose}
        hasLinkedOp={hasLinkedOp}
        onlyMe={onlyMe}
        onToggleOnlyMe={() => setOnlyMe((v) => !v)}
        search={search}
        onSearchChange={setSearch}
        isPending={isPending}
        onGoMonth={go}
        onSelectMonth={(m) => startTransition(() => router.push(`/?m=${m}`))}
        onGoToday={() => startTransition(() => router.push(`/?m=${p.today.slice(0, 7)}`))}
        todayCoverage={todayCoverage}
        saveState={saveState}
        msg={msg}
        mobileToolsOpen={mobileToolsOpen}
        onToggleMobileTools={() => setMobileToolsOpen((o) => !o)}
        brushLabel={brushLabel}
        onExportCsv={exportCsv}
        onPrint={() => window.print()}
        onOpenImport={() => {
          setImportStatus('');
          setImportOpen(true);
        }}
        showHint={showHint}
        onDismissHint={() => {
          localStorage.setItem('bpwi-roster-hint-dismissed', '1');
          setShowHint(false);
        }}
        shifts={p.shifts}
        areas={p.areas}
        mode={mode}
        setMode={setMode}
        shiftId={shiftId}
        setShiftId={handleSelectShift}
        areaId={areaId}
        setAreaId={handleSelectArea}
        standbyType={standbyType}
        setStandbyType={setStandbyType}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        draftItems={draftItems}
        onDiscardDrafts={() => void discardDraftBatch()}
      />

      <RosterMobileViews
        month={p.month}
        today={p.today}
        days={days}
        operators={filteredOperators}
        operatorId={p.operatorId}
        cell={cell}
        standbyMap={standbyMap}
        shiftBy={shiftBy}
        areaBy={areaBy}
        canEdit={canOperate}
        onCellTap={(opId, date) => void activateCell(opId, date)}
        onCellMenu={(op, date, coords) =>
          setCtxMenu({
            x: coords?.clientX ?? 16,
            y: coords?.clientY ?? 200,
            opId: op.id,
            opName: op.full_name,
            date,
          })
        }
      />

      <RosterGrid
        monthLabel={monthLabel}
        today={p.today}
        days={days}
        operators={filteredOperators}
        totalOperatorsCount={p.operators.length}
        operatorId={p.operatorId}
        canEdit={hasActiveEdit}
        canOperate={canOperate}
        mode={mode}
        cell={cell}
        pendingMap={pendingMap}
        standbyMap={standbyMap}
        shiftBy={shiftBy}
        areaBy={areaBy}
        pmByCell={pmByCell}
        holidayByDate={holidayByDate}
        dailyWorkingCounts={dailyWorkingCounts}
        dragRef={dragRef}
        onApplyBrushLocal={applyBrushLocal}
        onActivateCell={(opId, date) => void activateCell(opId, date)}
        onClearCell={(opId, date) => void clearCell(opId, date)}
        onCopyCell={copyCell}
        onPasteCell={pasteCell}
        onOpenContextMenu={setCtxMenu}
      />

      {ctxMenu && (
        <RosterContextMenu
          ctxMenu={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onSetStandby={setStandbyValue}
          onRequestFillRight={(opId, opName, date) => {
            const count = days.filter((d) => d.date >= date).length;
            setConfirmFill({ opId, opName, date, count });
          }}
          onClearCell={clearCell}
        />
      )}

      {confirmFill && (
        <RosterFillConfirmModal
          confirmFill={confirmFill}
          monthLabel={monthLabel}
          onCancel={() => setConfirmFill(null)}
          onConfirm={() => {
            const target = confirmFill;
            setConfirmFill(null);
            void fillRight(target.opId, target.date);
          }}
        />
      )}

      {importOpen && (
        <RosterImportJsonModal
          importing={importing}
          importStatus={importStatus}
          onFileChange={handleImportFile}
          onClose={() => setImportOpen(false)}
        />
      )}

      {isPropose && draftItems.length > 0 && (
        <RosterProposeBar
          count={draftItems.length}
          onOpenSubmit={() => setSubmitModalOpen(true)}
          onDiscard={() => void discardDraftBatch()}
        />
      )}

      {submitModalOpen && (
        <RosterSubmitProposalModal
          count={draftItems.length}
          submitNote={submitNote}
          isSubmitting={isSubmittingDraft}
          onChangeNote={setSubmitNote}
          onCancel={() => setSubmitModalOpen(false)}
          onSubmit={() => void submitDraftBatch()}
        />
      )}
    </div>
  );
}
