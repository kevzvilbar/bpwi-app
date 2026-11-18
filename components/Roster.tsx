'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import RosterMobileViews from '@/components/RosterMobileViews';

type Op = { id: string; full_name: string; position: string | null };
type Shift = {
  id: string;
  code: string;
  description: string | null;
  duration_hours: number;
  background_color: string;
  text_color: string;
  is_off: boolean;
};
type Area = {
  id: string;
  code: string;
  name: string | null;
  category: string;
  background_color: string;
  text_color: string;
};
type Row = {
  operator_id: string;
  schedule_date: string;
  shift_type_id: string | null;
  area_code_id: string | null;
};
type Standby = {
  operator_id: string;
  schedule_date: string;
  standby_type: string;
};
type PmMarkTask = {
  scheduled_date: string;
  assigned_operator_ids: string[];
  status: string;
  title: string;
};

type ShiftHistoryItem = { kind: 'shift'; opId: string; date: string; prev: Row | null; next: Row | null };
type StandbyHistoryItem = { kind: 'standby'; opId: string; date: string; prev: Standby | null; next: Standby | null };
type HistoryEntry = (ShiftHistoryItem | StandbyHistoryItem)[];

type ToolMode = 'paint' | 'erase' | 'standby';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function cellKey(opId: string, date: string) {
  return `${opId}:${date}`;
}

function isRestArea(a?: Area) {
  return Boolean(a && (a.category === 'rest' || a.code.toUpperCase() === 'RD'));
}

function isLeaveArea(a?: Area) {
  return Boolean(a && a.category === 'leave' && a.code.toUpperCase() !== 'RD');
}

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function friendlyError(raw: string, role?: string) {
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

export default function Roster(p: {
  month: string;
  today: string;
  operators: Op[];
  shifts: Shift[];
  areas: Area[];
  rows: Row[];
  standby: Standby[];
  pmTasks: PmMarkTask[];
  orgId: string;
  operatorId?: string | null;
  role: string;
  userName: string;
  canEdit: boolean;
  initialError?: string;
}) {
  const router = useRouter();
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
  const [focused, setFocused] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [clipboard, setClipboard] = useState<{ shift_type_id: string | null; area_code_id: string | null } | null>(null);

  // Drag-to-paint state
  const dragRef = useRef<{
    active: boolean;
    visited: Set<string>;
    entries: ShiftHistoryItem[];
    upserts: Row[];
    deletes: { opId: string; date: string }[];
  } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<HTMLTableElement | null>(null);

  useEffect(() => {
    setRows(p.rows);
  }, [p.rows]);

  useEffect(() => {
    setStandby(p.standby);
  }, [p.standby]);

  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`roster-sync-${p.month}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_assignments' }, (payload) => {
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
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'standby_assignments' }, (payload) => {
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
          setStandby((s) => [...s.filter((x) => !(x.operator_id === nextSb.operator_id && x.schedule_date === nextSb.schedule_date)), nextSb]);
        }
      })
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
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
    if (p.canEdit && localStorage.getItem('bpwi-roster-hint-dismissed') !== '1') {
      setShowHint(true);
    }
  }, [p.canEdit]);

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
          const matchesExpected =
            (cur?.shift_type_id ?? null) === (e.next?.shift_type_id ?? null) &&
            (cur?.area_code_id ?? null) === (e.next?.area_code_id ?? null);
          if (!matchesExpected) {
            skippedConcurrent += 1;
            continue;
          }
        }
        shiftAffected.add(k);
        const target = dir === 'undo' ? e.prev : e.next;
        const current = dir === 'undo' ? e.next : e.prev;
        shiftRollback.push({ opId: e.opId, date: e.date, prev: current });
        if (target) shiftUpserts.push(target);
        else shiftDeletes.push({ opId: e.opId, date: e.date });
      } else {
        if (dir === 'undo') {
          const curSb = standbyMap.get(k) ?? null;
          if ((curSb?.standby_type ?? null) !== (e.next?.standby_type ?? null)) {
            skippedConcurrent += 1;
            continue;
          }
        }
        sbAffected.add(k);
        const target = dir === 'undo' ? e.prev : e.next;
        const current = dir === 'undo' ? e.next : e.prev;
        sbRollback.push({ opId: e.opId, date: e.date, prev: current });
        if (target) sbUpserts.push(target);
        else sbDeletes.push({ opId: e.opId, date: e.date });
      }
    }

    if (skippedConcurrent > 0) {
      setMsg(`Skipped undo on ${skippedConcurrent} cell(s) modified by another user.`);
    }
    if (shiftAffected.size === 0 && sbAffected.size === 0) return;

    if (shiftAffected.size > 0) {
      setRows((r) => [...r.filter((x) => !shiftAffected.has(cellKey(x.operator_id, x.schedule_date))), ...shiftUpserts]);
    }
    if (sbAffected.size > 0) {
      setStandby((s) => [...s.filter((x) => !sbAffected.has(cellKey(x.operator_id, x.schedule_date))), ...sbUpserts]);
    }

    setSavingCount((c) => c + 1);
    const sb = supabaseBrowser();
    let errMsg = '';

    if (shiftUpserts.length > 0) {
      const { error } = await sb
        .from('schedule_assignments')
        .upsert(shiftUpserts.map((u) => ({ ...u, organization_id: p.orgId })), { onConflict: 'operator_id,schedule_date' });
      if (error) errMsg = error.message;
    }
    for (const d of shiftDeletes) {
      const { error } = await sb.from('schedule_assignments').delete().eq('operator_id', d.opId).eq('schedule_date', d.date);
      if (error && !errMsg) errMsg = error.message;
    }

    if (sbUpserts.length > 0) {
      const { error } = await sb
        .from('standby_assignments')
        .upsert(sbUpserts.map((u) => ({ ...u, organization_id: p.orgId })), { onConflict: 'operator_id,schedule_date' });
      if (error && !errMsg) errMsg = error.message;
    }
    for (const d of sbDeletes) {
      const { error } = await sb.from('standby_assignments').delete().eq('operator_id', d.opId).eq('schedule_date', d.date);
      if (error && !errMsg) errMsg = error.message;
    }

    setSavingCount((c) => c - 1);
    if (errMsg) {
      if (shiftRollback.length > 0) rollbackShiftKeys(shiftRollback);
      if (sbRollback.length > 0) rollbackStandbyKeys(sbRollback);
      setSaveState('error');
      setMsg(friendlyError(errMsg, p.role));
    }
  }

  function handleUndo() {
    if (!p.canEdit || undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, last]);
    void applyHistory(last, 'undo');
  }

  function handleRedo() {
    if (!p.canEdit || redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, last]);
    void applyHistory(last, 'redo');
  }

  useEffect(() => {
    if (!p.canEdit) return;
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
            setShiftId(shift.id);
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

  async function setStandbyValue(opId: string, date: string, nextType: string | null) {
    if (!p.canEdit) return;
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

    const query =
      nextType === null
        ? supabaseBrowser().from('standby_assignments').delete().eq('operator_id', opId).eq('schedule_date', date)
        : supabaseBrowser()
            .from('standby_assignments')
            .upsert(
              { organization_id: p.orgId, operator_id: opId, schedule_date: date, standby_type: nextType },
              { onConflict: 'operator_id,schedule_date' },
            );
    const { error } = await query;
    setSavingCount((c) => c - 1);
    if (error) {
      rollbackStandbyKeys([{ opId, date, prev: prevSb }]);
      setSaveState('error');
      setMsg(friendlyError(error.message, p.role));
    }
  }

  async function clearCell(opId: string, date: string) {
    if (!p.canEdit) return;
    setMsg('');
    const k = cellKey(opId, date);
    const existing = cell.get(k) ?? null;
    if (!existing) return;
    setRows((r) => r.filter((x) => cellKey(x.operator_id, x.schedule_date) !== k));
    setUndoStack((s) => [...s.slice(-29), [{ kind: 'shift', opId, date, prev: existing, next: null }]]);
    setRedoStack([]);
    setSavingCount((c) => c + 1);
    const { error } = await supabaseBrowser().from('schedule_assignments').delete().eq('operator_id', opId).eq('schedule_date', date);
    setSavingCount((c) => c - 1);
    if (error) {
      rollbackShiftKeys([{ opId, date, prev: existing }]);
      setSaveState('error');
      setMsg(friendlyError(error.message, p.role));
    }
  }

  async function fillRight(opId: string, fromDate: string) {
    if (!p.canEdit) return;
    const source = cell.get(cellKey(opId, fromDate));
    if (!source) {
      setMsg('Select a cell with an assignment before filling right.');
      return;
    }
    const targets = days.filter((d) => d.date >= fromDate).map((d) => d.date);
    const history: HistoryEntry = targets.map((date) => ({
      kind: 'shift',
      opId,
      date,
      prev: cell.get(cellKey(opId, date)) ?? null,
      next: { operator_id: opId, schedule_date: date, shift_type_id: source.shift_type_id, area_code_id: source.area_code_id },
    }));
    const payload = targets.map((date) => ({
      organization_id: p.orgId,
      operator_id: opId,
      schedule_date: date,
      shift_type_id: source.shift_type_id,
      area_code_id: source.area_code_id,
    }));
    const targetSet = new Set(targets);
    setRows((r) => [
      ...r.filter((x) => !(x.operator_id === opId && targetSet.has(x.schedule_date))),
      ...payload.map(({ operator_id, schedule_date, shift_type_id, area_code_id }) => ({
        operator_id,
        schedule_date,
        shift_type_id,
        area_code_id,
      })),
    ]);
    setUndoStack((s) => [...s.slice(-29), history]);
    setRedoStack([]);
    setSavingCount((c) => c + 1);
    const { error } = await supabaseBrowser()
      .from('schedule_assignments')
      .upsert(payload, { onConflict: 'operator_id,schedule_date' });
    setSavingCount((c) => c - 1);
    if (error) {
      rollbackShiftKeys(history.map((h) => ({ opId: h.opId, date: h.date, prev: (h as ShiftHistoryItem).prev })));
      setSaveState('error');
      setMsg(friendlyError(error.message, p.role));
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

    if (!shiftId) return;
    const nextRow: Row = { operator_id: opId, schedule_date: date, shift_type_id: shiftId, area_code_id: areaId };
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

    const sb = supabaseBrowser();
    let errMsg = '';
    if (batch.upserts.length > 0) {
      const { error } = await sb
        .from('schedule_assignments')
        .upsert(batch.upserts.map((u) => ({ ...u, organization_id: p.orgId })), { onConflict: 'operator_id,schedule_date' });
      if (error) errMsg = error.message;
    }
    for (const d of batch.deletes) {
      const { error } = await sb.from('schedule_assignments').delete().eq('operator_id', d.opId).eq('schedule_date', d.date);
      if (error && !errMsg) errMsg = error.message;
    }

    setSavingCount((c) => c - 1);
    if (errMsg) {
      rollbackShiftKeys(batch.entries.map((e) => ({ opId: e.opId, date: e.date, prev: e.prev })));
      setSaveState('error');
      setMsg(friendlyError(errMsg, p.role));
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
    if (!p.canEdit) return;
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
    if (!shiftId) return;
    const prevCell = cell.get(cellKey(opId, date)) ?? null;
    const row: Row = { operator_id: opId, schedule_date: date, shift_type_id: shiftId, area_code_id: areaId };
    setRows((r) => [...r.filter((x) => !(x.operator_id === opId && x.schedule_date === date)), row]);
    setUndoStack((s) => [...s.slice(-29), [{ kind: 'shift', opId, date, prev: prevCell, next: row }]]);
    setRedoStack([]);
    setSavingCount((c) => c + 1);
    const { error } = await supabaseBrowser()
      .from('schedule_assignments')
      .upsert({ ...row, organization_id: p.orgId }, { onConflict: 'operator_id,schedule_date' });
    setSavingCount((c) => c - 1);
    if (error) {
      rollbackShiftKeys([{ opId, date, prev: prevCell }]);
      setSaveState('error');
      setMsg(friendlyError(error.message, p.role));
    }
  }

  function handleCellKeyDown(e: React.KeyboardEvent<HTMLTableCellElement>, rIdx: number, cIdx: number, op: Op, date: string) {
    const maxR = filteredOperators.length - 1;
    const maxC = days.length - 1;
    let nr = rIdx;
    let nc = cIdx;
    if (e.key === 'ArrowRight') nc = Math.min(maxC, cIdx + 1);
    else if (e.key === 'ArrowLeft') nc = Math.max(0, cIdx - 1);
    else if (e.key === 'ArrowDown') nr = Math.min(maxR, rIdx + 1);
    else if (e.key === 'ArrowUp') nr = Math.max(0, rIdx - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void activateCell(op.id, date);
      return;
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      void clearCell(op.id, date);
      return;
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      const existing = cell.get(cellKey(op.id, date));
      setClipboard(existing ? { shift_type_id: existing.shift_type_id, area_code_id: existing.area_code_id } : { shift_type_id: null, area_code_id: null });
      return;
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      if (!clipboard || !p.canEdit) return;
      if (!clipboard.shift_type_id && !clipboard.area_code_id) {
        void clearCell(op.id, date);
        return;
      }
      const prevCell = cell.get(cellKey(op.id, date)) ?? null;
      const nextRow: Row = { operator_id: op.id, schedule_date: date, shift_type_id: clipboard.shift_type_id, area_code_id: clipboard.area_code_id };
      setRows((r) => [...r.filter((x) => !(x.operator_id === op.id && x.schedule_date === date)), nextRow]);
      setUndoStack((s) => [...s.slice(-29), [{ kind: 'shift', opId: op.id, date, prev: prevCell, next: nextRow }]]);
      setRedoStack([]);
      setSavingCount((c) => c + 1);
      void supabaseBrowser()
        .from('schedule_assignments')
        .upsert({ ...nextRow, organization_id: p.orgId }, { onConflict: 'operator_id,schedule_date' })
        .then(({ error }) => {
          setSavingCount((c) => c - 1);
          if (error) {
            rollbackShiftKeys([{ opId: op.id, date, prev: prevCell }]);
            setSaveState('error');
            setMsg(friendlyError(error.message, p.role));
          }
        });
      return;
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      setCtxMenu({ x: rect.left, y: rect.bottom + 2, opId: op.id, opName: op.full_name, date });
      return;
    } else {
      return;
    }

    e.preventDefault();
    setFocused({ r: nr, c: nc });
    const nextTd = gridRef.current?.querySelector<HTMLTableCellElement>(`td[data-rc="${nr}-${nc}"]`);
    nextTd?.focus();
  }

  function exportCsv() {
    const header = ['Operator', 'Position', ...days.map((d) => d.date), 'Duty', 'OC', 'Hours', 'Off', 'Leaves'];
    const lines = [header.map(csvEscape).join(',')];

    for (const o of filteredOperators) {
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
        if (sb) ocCount += 1;
        if (isLeaveArea(a)) leaves += 1;
        if (isRestArea(a) || s?.is_off) off += 1;
        else if (s && !isLeaveArea(a)) duty += 1;
        if (s) hrs += Number(s.duration_hours ?? 0);
        return [s?.code ?? '', a?.code ?? (s && !s.is_off ? 'PW' : ''), sb ? `(${sb.standby_type})` : ''].filter(Boolean).join(' ');
      });
      lines.push(
        [o.full_name, o.position ?? '', ...cols, String(duty), String(ocCount), String(hrs), String(off), String(leaves)]
          .map(csvEscape)
          .join(','),
      );
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
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
    } catch (err: any) {
      setImportStatus(`Error: ${err?.message ?? 'Failed to import file'}`);
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
          if (s && !s.is_off && !isLeaveArea(a) && !isRestArea(a)) count += 1;
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
      else if (isRestArea(a) || s?.is_off) off += 1;
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
        : `${selectedShift?.code ?? '—'} + ${selectedArea?.code ?? (selectedShift?.is_off ? 'none' : 'PW')}`;

  return (
    <div style={{ padding: '10px 14px 16px', maxWidth: '100%' }}>
      {/* Action & Filter Bar */}
      <div
        className="no-print card"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 8,
          padding: '8px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn" onClick={() => go(-1)} aria-label="Previous month">
            ‹
          </button>
          <input
            type="month"
            aria-label="Select month"
            value={p.month}
            onChange={(e) => e.target.value && startTransition(() => router.push(`/?m=${e.target.value}`))}
            className="input"
            style={{ width: 'auto', minHeight: 36, padding: '4px 8px', fontSize: 12.5, fontWeight: 600 }}
          />
          <button className="btn" onClick={() => go(1)} aria-label="Next month">
            ›
          </button>
          <button className="btn" onClick={() => startTransition(() => router.push(`/?m=${p.today.slice(0, 7)}`))}>
            {isPending ? 'Loading…' : 'Today'}
          </button>
        </div>

        <input
          id="filterInput"
          type="search"
          aria-label="Filter operators"
          placeholder="Filter operator…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
          style={{ width: 170, minHeight: 36, padding: '5px 10px', fontSize: 12.5 }}
        />

        {hasLinkedOp && (
          <button
            type="button"
            className={`btn ${onlyMe ? 'btn-primary' : ''}`}
            aria-pressed={onlyMe}
            onClick={() => setOnlyMe((v) => !v)}
            style={{ fontSize: 12.5, fontWeight: 700 }}
          >
            My Schedule
          </button>
        )}

        <div className="desktop-only" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5 }}>
          <strong style={{ color: 'var(--text)' }}>Today ({p.today}):</strong>
          <span style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
            {todayCoverage.duty} On Duty
          </span>
          <span style={{ background: 'rgba(124, 58, 237, 0.14)', color: 'var(--violet)', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
            {todayCoverage.sb} Standby
          </span>
          <span style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
            {todayCoverage.off} Off
          </span>
          <span style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
            {todayCoverage.leave} Leave
          </span>
        </div>

        <span
          aria-live="polite"
          style={{
            minWidth: 96,
            fontSize: 12,
            color: saveState === 'error' ? 'var(--danger)' : saveState === 'saved' ? '#15803d' : 'var(--accent)',
            fontWeight: 600,
            visibility: saveState === 'idle' ? 'hidden' : 'visible',
          }}
        >
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'error' ? 'Not saved' : ''}
        </span>

        {msg && (
          <span role="alert" style={{ fontSize: 12, color: '#b91c1c', fontWeight: 500 }}>
            {msg}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            className="btn mobile-only-block"
            style={{ display: undefined }}
            onClick={() => setMobileToolsOpen((o) => !o)}
            aria-expanded={mobileToolsOpen}
          >
            {mobileToolsOpen ? 'Hide Brush & Legend' : `Brush: ${brushLabel}`}
          </button>
          <button className="btn desktop-only" onClick={exportCsv}>
            Export CSV
          </button>
          <button className="btn desktop-only" onClick={() => window.print()}>
            Print
          </button>
          {p.role === 'admin' && (
            <button
              className="btn desktop-only"
              onClick={() => {
                setImportStatus('');
                setImportOpen(true);
              }}
            >
              Import JSON
            </button>
          )}
        </div>
      </div>

      {!p.orgId && (
        <div
          className="no-print"
          role="status"
          style={{
            marginBottom: 8,
            padding: '10px 14px',
            borderRadius: 8,
            background: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            fontSize: 12.5,
          }}
        >
          Your account is signed in and pending administrator activation / organization assignment.
        </div>
      )}

      {showHint && p.canEdit && (
        <div
          className="no-print"
          role="note"
          style={{
            marginBottom: 8,
            padding: '8px 12px',
            borderRadius: 8,
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            color: '#1e3a8a',
            fontSize: 12.5,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span>
            <b>Quick tips:</b> Click or drag across cells to paint. Use arrow keys + Enter for keyboard editing, <code>Ctrl+Z</code> to undo, and right-click (or long-press on mobile) for standby &amp; bulk fill actions.
          </span>
          <button
            className="btn"
            style={{ padding: '3px 10px', minHeight: 30, fontSize: 12 }}
            onClick={() => {
              localStorage.setItem('bpwi-roster-hint-dismissed', '1');
              setShowHint(false);
            }}
          >
            Got it
          </button>
        </div>
      )}

      {/* Shift Legend (for viewers, print, or mobile drawer toggle) */}
      {(!p.canEdit || mobileToolsOpen) && (
        <div
          className="card"
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: 8,
            padding: '6px 12px',
            fontSize: 11.5,
          }}
        >
          <strong style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', fontSize: 10.5 }}>Shift Legend:</strong>
          {p.shifts.map((s) => (
            <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  background: s.background_color,
                  color: s.text_color,
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '1px 6px',
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                {s.code}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>{s.description ?? (s.is_off ? 'Off' : 'Duty')}</span>
            </span>
          ))}
          <span style={{ color: 'var(--text-secondary)' }}>· Duty cells without an area code show <b>PW</b></span>
        </div>
      )}

      {/* Paint Palette Bar (Editors only; collapsible on mobile) */}
      {p.canEdit && (
        <div
          className={`no-print card ${mobileToolsOpen ? '' : 'desktop-only'}`}
          style={{
            display: 'flex',
            gap: 5,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: 8,
            padding: '7px 12px',
          }}
        >
          <span
            style={{
              padding: '3px 9px',
              borderRadius: 999,
              background: 'var(--primary)',
              color: 'var(--primary-fg)',
              fontSize: 11.5,
              fontWeight: 700,
              marginRight: 4,
            }}
          >
            Brush: {brushLabel}
          </span>

          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Shifts:</span>
          {p.shifts.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                setMode('paint');
                setShiftId(s.id);
              }}
              title={i < 9 ? `${s.description ?? s.code} (Key ${i + 1})` : (s.description ?? '')}
              style={{
                padding: '3px 8px',
                borderRadius: 5,
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
                background: s.background_color,
                color: s.text_color,
                border: mode === 'paint' && shiftId === s.id ? '2px solid #2563eb' : '1px solid var(--border)',
              }}
            >
              {s.code}
            </button>
          ))}

          <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 3px' }} />
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Area / Leave:</span>
          <button
            onClick={() => {
              setMode('paint');
              setAreaId(null);
            }}
            style={{
              padding: '3px 8px',
              borderRadius: 5,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
              background: 'var(--surface-muted)',
              color: 'var(--text)',
              border: mode === 'paint' && areaId === null ? '2px solid #2563eb' : '1px solid var(--border)',
            }}
          >
            PW (default)
          </button>
          {p.areas.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setMode('paint');
                setAreaId(a.id);
              }}
              title={a.name ?? ''}
              className={isLeaveArea(a) || isRestArea(a) ? 'cell-leave' : undefined}
              style={{
                padding: '3px 7px',
                borderRadius: 5,
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
                background: a.background_color,
                color: a.text_color,
                border: mode === 'paint' && areaId === a.id ? '2px solid #2563eb' : '1px solid #cbd5e1',
              }}
            >
              {a.code}
            </button>
          ))}

          <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 3px' }} />
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              className="btn"
              onClick={() => setMode(mode === 'standby' ? 'paint' : 'standby')}
              style={{
                padding: '3px 9px',
                fontSize: 11.5,
                border: mode === 'standby' ? '2px solid #7c3aed' : '1px solid var(--border)',
                background: mode === 'standby' ? 'rgba(124, 58, 237, 0.16)' : 'var(--surface-muted)',
                color: mode === 'standby' ? 'var(--violet)' : 'var(--text)',
                fontWeight: 700,
              }}
            >
              Standby ({standbyType})
            </button>
            {mode === 'standby' && (
              <select
                aria-label="Standby type"
                value={standbyType}
                onChange={(e) => setStandbyType(e.target.value as 'OC' | 'DWP' | 'ERP')}
                style={{
                  padding: '3px 6px',
                  borderRadius: 5,
                  border: '1px solid var(--violet)',
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--violet)',
                  background: 'var(--surface-muted)',
                }}
              >
                <option value="OC">OC · General</option>
                <option value="DWP">DWP · Deep Well</option>
                <option value="ERP">ERP · Electro-Mech</option>
              </select>
            )}
          </div>

          <button
            className="btn"
            onClick={() => setMode(mode === 'erase' ? 'paint' : 'erase')}
            style={{
              padding: '3px 9px',
              fontSize: 11.5,
              border: mode === 'erase' ? '2px solid #dc2626' : '1px solid var(--border)',
              background: mode === 'erase' ? 'rgba(220, 38, 38, 0.16)' : 'var(--surface-muted)',
              color: mode === 'erase' ? 'var(--danger)' : 'var(--text)',
              fontWeight: 600,
            }}
          >
            Clear Cell
          </button>

          <span style={{ width: 1, height: 18, background: '#e2e8f0', margin: '0 3px' }} />
          <button className="btn" onClick={handleUndo} disabled={undoStack.length === 0} style={{ padding: '3px 8px', fontSize: 11.5 }} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="btn" onClick={handleRedo} disabled={redoStack.length === 0} style={{ padding: '3px 8px', fontSize: 11.5 }} title="Redo (Ctrl+Y)">
            Redo
          </button>
          <div style={{ width: '100%', fontSize: 11.5, color: 'var(--text-secondary)', paddingTop: 2 }}>
            {mode === 'paint'
              ? `Paint mode: click or drag across cells to apply ${brushLabel}.`
              : mode === 'standby'
                ? `Standby mode: click a cell to toggle ${standbyType} standby status.`
                : 'Erase mode: click or drag across cells to clear shift assignments.'}
          </div>
        </div>
      )}

      {/* Mobile & Tablet Views (<= 1024px, defaults to Day View) */}
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
        canEdit={p.canEdit}
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

      {/* Desktop Spreadsheet Schedule Table (> 1024px only) */}
      <div
        className="schedule-container desktop-only-grid"
        style={{
          overflow: 'auto',
          maxHeight: '78vh',
          background: '#ffffff',
          borderRadius: 10,
          border: '1px solid #cbd5e1',
          boxShadow: '0 1px 4px rgba(15, 23, 42, 0.05)',
          touchAction: 'pan-x pan-y pinch-zoom',
        }}
      >
        <table ref={gridRef} className="schedule-table" role="grid" aria-label={`Monthly schedule for ${monthLabel}`}>
          <thead>
            <tr style={{ height: 26 }}>
              <th rowSpan={2} className="sticky-corner-idx" style={{ background: '#0f172a', color: '#cbd5e1', width: 36, minWidth: 36, textAlign: 'center', fontSize: 10 }}>
                #
              </th>
              <th rowSpan={2} className="sticky-corner-name" style={{ background: '#0f172a', color: '#ffffff', minWidth: 165, padding: '4px 8px', textAlign: 'left' }}>
                Operator ({filteredOperators.length})
              </th>
              <th
                colSpan={days.length}
                className="sticky-header-month"
                style={{ background: '#0f172a', color: '#f1f5f9', padding: '4px 8px', textAlign: 'center', fontSize: 11.5, letterSpacing: '0.03em', textTransform: 'uppercase' }}
              >
                {monthLabel}
              </th>
              <th rowSpan={2} className="sticky-corner-stat sticky-col-duty" style={{ background: '#0f172a', color: '#ffffff', width: 42, minWidth: 42, textAlign: 'center' }}>
                Duty
              </th>
              <th rowSpan={2} className="sticky-corner-stat sticky-col-oc" style={{ background: '#4c1d95', color: '#f5f3ff', width: 42, minWidth: 42, textAlign: 'center' }}>
                OC
              </th>
              <th rowSpan={2} className="sticky-corner-stat sticky-col-hours" style={{ background: '#0f172a', color: '#ffffff', width: 42, minWidth: 42, textAlign: 'center' }}>
                Hrs
              </th>
              <th rowSpan={2} className="sticky-corner-stat sticky-col-off" style={{ background: '#0f172a', color: '#cbd5e1', width: 42, minWidth: 42, textAlign: 'center' }}>
                Off
              </th>
              <th rowSpan={2} className="sticky-corner-stat sticky-col-leaves" style={{ background: '#0f172a', color: '#fde68a', width: 42, minWidth: 42, textAlign: 'center' }}>
                Lvs
              </th>
            </tr>

            <tr>
              {days.map((d) => {
                const isToday = d.date === p.today;
                return (
                  <th
                    key={d.date}
                    className="sticky-header-days"
                    style={{
                      background: isToday ? '#0369a1' : d.isWeekend ? '#1e293b' : '#0f172a',
                      color: '#ffffff',
                      minWidth: 58,
                      padding: '3px 4px',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <div style={{ lineHeight: 1.1 }}>{d.dayNum}</div>
                    <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.9 }}>{d.dowLabel}</div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {filteredOperators.length === 0 ? (
              <tr>
                <td colSpan={days.length + 7} style={{ padding: 28, textAlign: 'center', color: '#475569', background: '#fff' }}>
                  No operators found{p.operators.length === 0 ? '. Import data or add operators under Operators & Setup.' : '.'}
                </td>
              </tr>
            ) : (
              filteredOperators.map((o, rIdx) => {
                let duty = 0;
                let ocCount = 0;
                let hrs = 0;
                let off = 0;
                let leaves = 0;

                return (
                  <tr key={o.id} className="operator-row">
                    <td className="sticky-col-idx tabular-nums" style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)', textAlign: 'center', fontSize: 10.5, fontWeight: 600 }}>
                      {rIdx + 1}
                    </td>
                    <td className="sticky-col-name" style={{ background: o.id === p.operatorId ? 'rgba(3, 105, 161, 0.08)' : 'var(--surface)', padding: '3px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <div style={{ color: 'var(--text)' }}>
                        {o.full_name}
                        {o.id === p.operatorId && (
                          <span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 700, color: 'var(--accent)' }}>(Me)</span>
                        )}
                      </div>
                      {o.position && <div style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--text-secondary)' }}>{o.position}</div>}
                    </td>

                    {days.map((d, cIdx) => {
                      const k = cellKey(o.id, d.date);
                      const r = cell.get(k);
                      const s = r?.shift_type_id ? shiftBy.get(r.shift_type_id) : undefined;
                      const a = r?.area_code_id ? areaBy.get(r.area_code_id) : undefined;
                      const sb = standbyMap.get(k);
                      const pm = pmByCell.get(k);

                      const isLeave = isLeaveArea(a);
                      const isRest = isRestArea(a);
                      if (sb) ocCount += 1;
                      if (isLeave) leaves += 1;
                      if (isRest || s?.is_off) off += 1;
                      else if (s && !isLeave) duty += 1;
                      if (s) hrs += Number(s.duration_hours ?? 0);

                      const bg =
                        a && a.background_color !== '#f1f5f9' && (s?.is_off || !s)
                          ? a.background_color
                          : s?.background_color ?? (sb ? '#f5f3ff' : d.isWeekend ? '#f8fafc' : '#ffffff');
                      const fg = a && (s?.is_off || !s) ? a.text_color : s?.text_color ?? (sb ? '#5b21b6' : '#64748b');
                      const cellText =
                        s && !s.is_off
                          ? `${s.code}·${a?.code ?? 'PW'}`
                          : a?.code ?? s?.code ?? '';
                      const classes = [isLeave || isRest ? 'cell-leave' : '', sb ? 'cell-oncall-active' : ''].filter(Boolean).join(' ');
                      const isFocused = focused.r === rIdx && focused.c === cIdx;

                      return (
                        <td
                          key={d.date}
                          data-rc={`${rIdx}-${cIdx}`}
                          tabIndex={isFocused ? 0 : -1}
                          role="gridcell"
                          aria-label={`${o.full_name}, ${d.date}, ${s ? s.code : 'No shift'}, ${cellText || 'none'}${sb ? `, Standby ${sb.standby_type}` : ''}`}
                          className={classes || undefined}
                          onFocus={() => setFocused({ r: rIdx, c: cIdx })}
                          onKeyDown={(e) => handleCellKeyDown(e, rIdx, cIdx, o, d.date)}
                          onPointerDown={(e) => {
                            if (!p.canEdit || e.button !== 0) return;
                            setFocused({ r: rIdx, c: cIdx });
                            if (mode === 'standby') {
                              void activateCell(o.id, d.date);
                              return;
                            }
                            dragRef.current = { active: true, visited: new Set(), entries: [], upserts: [], deletes: [] };
                            applyBrushLocal(o.id, d.date);
                          }}
                          onPointerEnter={() => {
                            if (dragRef.current?.active && p.canEdit && mode !== 'standby') {
                              applyBrushLocal(o.id, d.date);
                            }
                          }}
                          onTouchStart={(e) => {
                            if (!p.canEdit) return;
                            const touch = e.touches[0];
                            longPressRef.current = setTimeout(() => {
                              setCtxMenu({ x: touch.clientX, y: touch.clientY, opId: o.id, opName: o.full_name, date: d.date });
                            }, 500);
                          }}
                          onTouchEnd={() => {
                            if (longPressRef.current) clearTimeout(longPressRef.current);
                          }}
                          onTouchMove={() => {
                            if (longPressRef.current) clearTimeout(longPressRef.current);
                          }}
                          onContextMenu={(e) => {
                            if (!p.canEdit) return;
                            e.preventDefault();
                            setCtxMenu({ x: e.clientX, y: e.clientY, opId: o.id, opName: o.full_name, date: d.date });
                          }}
                          title={[
                            `${o.full_name} • ${d.date}`,
                            s ? `${s.code}${s.description ? ` (${s.description})` : ''}` : null,
                            cellText ? `Area: ${a?.name ?? cellText}` : null,
                            sb ? `Standby: ${sb.standby_type}` : null,
                            pm ? `PM: ${pm.titles.join(', ')}` : null,
                          ]
                            .filter(Boolean)
                            .join('\n')}
                          style={{
                            position: 'relative',
                            textAlign: 'center',
                            cursor: p.canEdit ? 'pointer' : 'default',
                            height: 28,
                            padding: '0 4px',
                            whiteSpace: 'nowrap',
                            fontSize: 10.5,
                            background: bg,
                            color: fg,
                            fontWeight: 800,
                            outline: d.date === p.today ? '1.5px solid #0369a1' : undefined,
                            outlineOffset: -1.5,
                          }}
                        >
                          {cellText}
                          {sb && (
                            <>
                              <span className="oncall-corner-triangle" />
                              <span className="oncall-icon-mark">{sb.standby_type === 'OC' ? 'OC' : sb.standby_type[0]}</span>
                            </>
                          )}
                          {pm && <span className={`pm-mark${pm.warn ? ' warn' : ''}`} />}
                        </td>
                      );
                    })}

                    <td className="sticky-col-duty tabular-nums" style={{ background: 'var(--surface)', color: 'var(--text)', textAlign: 'center', fontWeight: 700 }}>
                      {duty}
                    </td>
                    <td
                      className="sticky-col-oc tabular-nums"
                      style={{
                        background: 'var(--surface)',
                        boxShadow: ocCount ? 'inset 0 0 0 999px rgba(124, 58, 237, 0.14)' : undefined,
                        color: ocCount ? 'var(--violet)' : 'var(--text-muted)',
                        textAlign: 'center',
                        fontWeight: 700,
                      }}
                    >
                      {ocCount}
                    </td>
                    <td className="sticky-col-hours tabular-nums" style={{ background: 'var(--surface)', color: 'var(--text)', textAlign: 'center', fontWeight: 600 }}>
                      {hrs}
                    </td>
                    <td className="sticky-col-off tabular-nums" style={{ background: 'var(--surface)', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      {off}
                    </td>
                    <td
                      className="sticky-col-leaves tabular-nums"
                      style={{
                        background: 'var(--surface)',
                        boxShadow: leaves ? 'inset 0 0 0 999px rgba(234, 179, 8, 0.16)' : undefined,
                        color: leaves ? '#ca8a04' : 'var(--text-muted)',
                        textAlign: 'center',
                        fontWeight: 700,
                      }}
                    >
                      {leaves}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {filteredOperators.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2} className="sticky-col-idx" style={{ position: 'sticky', bottom: 0, zIndex: 30, background: 'var(--surface-muted)', color: 'var(--text)', padding: '5px 8px', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  On Duty Count
                </td>
                {dailyWorkingCounts.map((cnt, idx) => (
                  <td
                    key={days[idx].date}
                    className="tabular-nums"
                    style={{
                      position: 'sticky',
                      bottom: 0,
                      zIndex: 20,
                      background: 'var(--surface-muted)',
                      textAlign: 'center',
                      fontWeight: 700,
                      color: cnt === 0 ? 'var(--text-muted)' : 'var(--text)',
                      borderTop: '2px solid var(--border)',
                      padding: '5px 2px',
                    }}
                  >
                    {cnt}
                  </td>
                ))}
                <td colSpan={5} style={{ position: 'sticky', bottom: 0, zIndex: 20, background: 'var(--surface-muted)', borderTop: '2px solid var(--border)' }} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Legend Strip */}
      <div className="no-print" style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: '#f5f3ff', boxShadow: 'inset 0 0 0 2px #7c3aed', display: 'inline-block' }} />
          Violet ring + corner = Standby (OC/DWP/ERP)
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span className="cell-leave" style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: '#fef3c7', border: '1px solid #cbd5e1', display: 'inline-block' }} />
          Diagonal stripe = Leave day
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#0f766e', display: 'inline-block' }} />
          Teal / Rose dot = PM scheduled / overdue
        </span>
        <span>
          <b>PW</b> Plant Works · <b>OC</b> On-Call · <b>DWP</b> Deep Well · <b>ERP</b> Electro-Mech · <b>Lvs</b> Leaves
        </span>
        {p.canEdit && <span>Tip: drag across cells to paint, arrow keys + Enter for keyboard, right-click or long-press for menu.</span>}
      </div>

      {/* Cell Actions Context Menu */}
      {ctxMenu && (
        <div
          className="no-print"
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: Math.min(ctxMenu.y, window.innerHeight - 250),
            left: Math.min(ctxMenu.x, window.innerWidth - 240),
            zIndex: 60,
            width: 230,
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 10px 25px rgba(15, 23, 42, 0.25)',
            padding: '4px 0',
            fontSize: 12.5,
          }}
        >
          <div style={{ padding: '5px 10px', borderBottom: '1px solid var(--border-light)', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
            <span>CELL ACTIONS</span>
            <span style={{ color: 'var(--accent)' }}>
              {ctxMenu.opName.split(' ')[0]} · {ctxMenu.date.slice(5)}
            </span>
          </div>
          {[
            { label: 'Set General On-Call (OC)', fn: () => setStandbyValue(ctxMenu.opId, ctxMenu.date, 'OC'), color: 'var(--violet)' },
            { label: 'Deep Well Standby (DWP)', fn: () => setStandbyValue(ctxMenu.opId, ctxMenu.date, 'DWP'), color: 'var(--violet)' },
            { label: 'Electro-Mech Repair (ERP)', fn: () => setStandbyValue(ctxMenu.opId, ctxMenu.date, 'ERP'), color: 'var(--violet)' },
            { label: 'Remove Standby', fn: () => setStandbyValue(ctxMenu.opId, ctxMenu.date, null), color: 'var(--text-secondary)' },
            {
              label: 'Fill Right to Month End',
              fn: () => {
                const count = days.filter((d) => d.date >= ctxMenu.date).length;
                setConfirmFill({ opId: ctxMenu.opId, opName: ctxMenu.opName, date: ctxMenu.date, count });
              },
              color: 'var(--text)',
            },
            { label: 'Clear Shift (No Duty)', fn: () => clearCell(ctxMenu.opId, ctxMenu.date), color: 'var(--danger)' },
          ].map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => {
                setCtxMenu(null);
                void item.fn();
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '7px 12px',
                border: 'none',
                background: 'transparent',
                color: item.color,
                cursor: 'pointer',
                fontWeight: 500,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* Fill Right Confirmation Dialog */}
      {confirmFill && (
        <div
          className="no-print modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fill-dialog-title"
          onClick={() => setConfirmFill(null)}
        >
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, display: 'grid', gap: 12 }}>
            <h2 id="fill-dialog-title" style={{ margin: 0, fontSize: 17 }}>
              Fill schedule to month end?
            </h2>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
              This will copy <b>{confirmFill.opName}</b>&apos;s assignment from <b>{confirmFill.date}</b> across{' '}
              <b>{confirmFill.count}</b> days through the end of {monthLabel}. You can undo this with <code>Ctrl+Z</code>.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmFill(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const target = confirmFill;
                  setConfirmFill(null);
                  void fillRight(target.opId, target.date);
                }}
              >
                Fill {confirmFill.count} days
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import JSON Modal (Bottom Sheet on mobile, Dialog on desktop) */}
      {importOpen && (
        <div
          className="no-print modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-dialog-title"
          onClick={() => !importing && setImportOpen(false)}
        >
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <h2 id="import-dialog-title" style={{ margin: '0 0 6px', fontSize: 17 }}>
              Import Legacy JSON Backup
            </h2>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#475569' }}>
              Select a JSON backup exported from the standalone HTML app. Existing records are safely upserted.
            </p>
            <input type="file" accept=".json,application/json" onChange={handleImportFile} disabled={importing} />
            {importing && <p style={{ fontSize: 13, color: '#0369a1', margin: '10px 0 0' }}>Importing…</p>}
            {importStatus && (
              <p style={{ fontSize: 13, margin: '10px 0 0', color: importStatus.startsWith('Error:') ? '#b91c1c' : '#166534' }}>
                {importStatus}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="btn" onClick={() => setImportOpen(false)} disabled={importing}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
