'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { subscribeVisibilityAwareChannel } from '@/lib/supabase/realtime';
import { isMissingCompletedByColumnError } from '@/lib/pm-credit';
import { createInitialRecurrence, generatePmRepeatDates } from '@/lib/pm-recurrence';
import {
  buildPmSeriesPrefix,
  buildSavedLocationCatalog,
  expandPmTaskGroups,
  validateSelectedLocations,
  type PmLocationRow,
} from '@/lib/pm-locations';
import { resolveTaskAssetForLocations, type GensetRow } from '@/lib/gensets';
import {
  addPmDays as addDays,
  buildPmCalendarIcs,
  diffPmDays as diffDays,
  pmActivityColor as activityColor,
  PM_PRESETS as PRESETS,
  type PmActivityChip,
  type PmActivityType,
  type PmConfirmDelete,
  type PmDraft,
  type PmOp,
  type PmTask,
} from '@/components/PmPlannerModals';

export type PmShift = { id: string; is_off: boolean };
export type PmArea = { id: string; code: string; name: string | null; category: string; sub_sites?: string[] | null };
export type PmAsg = { operator_id: string; schedule_date: string; shift_type_id: string | null; area_code_id: string | null };
export type PmStandby = { operator_id: string; schedule_date: string; standby_type: string };

export const PM_WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export const PM_MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export interface PmPlannerProps {
  month: string;
  today: string;
  tasks: PmTask[];
  activityTypes: PmActivityType[];
  operators: PmOp[];
  shifts: PmShift[];
  areas: PmArea[];
  assignments: PmAsg[];
  standby: PmStandby[];
  holidays?: Array<{ holiday_date: string; name: string; holiday_type: string }>;
  savedLocations?: PmLocationRow[];
  pmLocationsTableReady?: boolean;
  gensets?: GensetRow[];
  gensetsTableReady?: boolean;
  orgId: string;
  operatorId?: string | null;
  canEdit: boolean;
  canExportCsv?: boolean;
  error: string;
}

/** Manages PM calendar state, realtime sync, activity type config, locations, recurring saves, and day inspector stats. */
export function usePmPlannerState(p: PmPlannerProps) {
  const router = useRouter();
  const holidayByDate = useMemo(
    () => new Map((p.holidays ?? []).map((h) => [h.holiday_date, h])),
    [p.holidays],
  );
  const [tasks, setTasks] = useState<PmTask[]>(p.tasks);
  const [actTypes, setActTypes] = useState<PmActivityType[]>(p.activityTypes);
  const [editActsOpen, setEditActsOpen] = useState(false);
  const [actDraft, setActDraft] = useState<PmActivityType[]>([]);
  const [savingActs, setSavingActs] = useState(false);
  const [view, setView] = useState<'month' | 'week'>('month');
  const [selectedDate, setSelectedDate] = useState(() =>
    p.today.startsWith(p.month) ? p.today : `${p.month}-01`,
  );
  const [draft, setDraft] = useState<PmDraft | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [msg, setMsg] = useState(p.error);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportCsvOpen, setExportCsvOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<PmConfirmDelete | null>(null);
  const [completeModal, setCompleteModal] = useState<{ task: PmTask; mode: 'complete' | 'edit' } | null>(null);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [pmLocations, setPmLocations] = useState<PmLocationRow[]>(p.savedLocations ?? []);
  const [manageLocsOpen, setManageLocsOpen] = useState(false);
  const [gensets, setGensets] = useState<GensetRow[]>(p.gensets ?? []);
  const [manageGensetsOpen, setManageGensetsOpen] = useState(false);

  useEffect(() => setTasks(p.tasks), [p.tasks]);
  useEffect(() => setActTypes(p.activityTypes), [p.activityTypes]);
  useEffect(() => setPmLocations(p.savedLocations ?? []), [p.savedLocations]);
  useEffect(() => setGensets(p.gensets ?? []), [p.gensets]);

  useEffect(() => {
    const sb = supabaseBrowser();
    return subscribeVisibilityAwareChannel({
      sb,
      channelName: `pm-plan-${p.month}`,
      listeners: [
        {
          table: 'pm_tasks',
          onEvent: (payload) => {
            const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Partial<PmTask> & { id?: string };
            if (!rec?.id) return;
            if (payload.eventType === 'DELETE') {
              setTasks((prev) => prev.filter((x) => x.id !== rec.id));
              return;
            }
            const nextTask: PmTask = {
              id: rec.id,
              legacy_key: rec.legacy_key ?? null,
              activity_type: rec.activity_type ?? 'FLUSH',
              title: rec.title ?? '',
              locations: rec.locations ?? [],
              asset: rec.asset ?? null,
              assigned_operator_ids: rec.assigned_operator_ids ?? [],
              completed_by_operator_ids: rec.completed_by_operator_ids ?? [],
              scheduled_date: rec.scheduled_date ?? '',
              status: (rec.status as PmTask['status']) ?? 'planned',
              completed_at: rec.completed_at ?? null,
              remarks: rec.remarks ?? null,
            };
            setTasks((prev) => {
              const exists = prev.some((x) => x.id === nextTask.id);
              if (exists) return prev.map((x) => (x.id === nextTask.id ? nextTask : x));
              if (nextTask.scheduled_date.startsWith(p.month)) {
                return [...prev, nextTask].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
              }
              return prev;
            });
          },
        },
      ],
    });
  }, [p.month]);

  useEffect(() => {
    if ((!draft && !editActsOpen) || manageLocsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !savingActs) {
        setDraft(null);
        setEditActsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, draft, editActsOpen, manageLocsOpen, savingActs]);

  const [y, mo] = p.month.split('-').map(Number);
  const monthLabel = `${PM_MONTHS_FULL[(mo - 1 + 12) % 12]} ${y}`;

  const opBy = useMemo(() => new Map(p.operators.map((o) => [o.id, o])), [p.operators]);
  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);

  const savedLocationCatalog = useMemo(() => buildSavedLocationCatalog(pmLocations, p.areas), [pmLocations, p.areas]);

  const allLocations = useMemo(() => {
    const s = new Set<string>();
    savedLocationCatalog.forEach((l) => s.add(l.name));
    tasks.forEach((t) => t.locations.forEach((l) => s.add(l)));
    return Array.from(s).sort();
  }, [savedLocationCatalog, tasks]);

  const activityChips = useMemo(() => {
    const map = new Map<string, PmActivityChip>();
    let idx = 0;
    for (const [k, v] of Object.entries(PRESETS)) {
      map.set(k, { type: k, label: v.label, short: v.short, color: v.color, count: 0, sort: idx++ });
    }
    for (const a of actTypes) {
      map.set(a.code, {
        type: a.code,
        label: a.label,
        short: a.short_label,
        color: a.color,
        count: 0,
        sort: a.sort_order ?? idx++,
      });
    }
    for (const t of tasks) {
      if (!map.has(t.activity_type)) {
        map.set(t.activity_type, {
          type: t.activity_type,
          label: t.title,
          short: t.title,
          color: activityColor(t.activity_type, t.title),
          count: 0,
          sort: idx++,
        });
      }
      const entry = map.get(t.activity_type);
      if (entry && t.scheduled_date.startsWith(p.month)) {
        entry.count += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.sort - b.sort);
  }, [actTypes, p.month, tasks]);

  const activityMeta = useMemo(() => new Map(activityChips.map((c) => [c.type, c])), [activityChips]);

  const asgByDateOp = useMemo(() => {
    const m = new Map<string, PmAsg>();
    p.assignments.forEach((a) => m.set(`${a.schedule_date}:${a.operator_id}`, a));
    return m;
  }, [p.assignments]);

  const standbyByDate = useMemo(() => {
    const m = new Map<string, PmStandby[]>();
    p.standby.forEach((s) => m.set(s.schedule_date, [...(m.get(s.schedule_date) ?? []), s]));
    return m;
  }, [p.standby]);

  const visible = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (!typeFilter || t.activity_type === typeFilter) &&
          (!statusFilter || t.status === statusFilter) &&
          (!areaFilter || t.locations.includes(areaFilter)),
      ),
    [areaFilter, statusFilter, tasks, typeFilter],
  );

  const byDate = useMemo(() => {
    const m = new Map<string, PmTask[]>();
    visible.forEach((t) => m.set(t.scheduled_date, [...(m.get(t.scheduled_date) ?? []), t]));
    return m;
  }, [visible]);

  const gridDays = useMemo(() => {
    if (view === 'week') {
      const dow = new Date(selectedDate + 'T00:00:00Z').getUTCDay();
      const start = addDays(selectedDate, -dow);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const firstOfMonth = new Date(Date.UTC(y, mo - 1, 1));
    const lastOfMonth = new Date(Date.UTC(y, mo, 0));
    const start = addDays(`${p.month}-01`, -firstOfMonth.getUTCDay());
    const total = firstOfMonth.getUTCDay() + lastOfMonth.getUTCDate() + (6 - lastOfMonth.getUTCDay());
    return Array.from({ length: total }, (_, i) => addDays(start, i));
  }, [mo, p.month, selectedDate, view, y]);

  const go = (d: number) => {
    if (view === 'week') {
      const next = addDays(selectedDate, d * 7);
      setSelectedDate(next);
      if (!next.startsWith(p.month)) startTransition(() => router.push(`/pm?m=${next.slice(0, 7)}`));
      return;
    }
    const t = new Date(y, mo - 1 + d, 1);
    startTransition(() => router.push(`/pm?m=${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`));
  };

  const goToday = () => {
    setSelectedDate(p.today);
    startTransition(() => router.push(`/pm?m=${p.today.slice(0, 7)}`));
  };

  const selectMonth = (m: string) => {
    if (m) router.push(`/pm?m=${m}`);
  };

  function getOperatorConflict(date: string, opId: string): string | null {
    const a = asgByDateOp.get(`${date}:${opId}`);
    const area = a?.area_code_id ? areaBy.get(a.area_code_id) : undefined;
    if (area && (area.category === 'leave' || area.category === 'rest' || area.category === 'holiday' || area.code.toUpperCase() === 'RD')) {
      return area.code.toUpperCase();
    }
    if (a?.shift_type_id && shiftBy.get(a.shift_type_id)?.is_off) {
      return 'Off';
    }
    return null;
  }

  function hasConflict(t: PmTask) {
    if (t.status === 'done') return false;
    for (const opId of t.assigned_operator_ids ?? []) {
      if (getOperatorConflict(t.scheduled_date, opId)) return true;
    }
    return false;
  }

  const openDraft = (next: PmDraft) => {
    setMsg('');
    setDraft(next);
  };

  const blank = (date: string): PmDraft => ({
    typeKey: 'FLUSH',
    custom: '',
    locations: [],
    locationQuery: '',
    splitLocations: false,
    asset: '',
    assignees: [],
    completedBy: [],
    date,
    status: 'planned',
    remarks: '',
    recurrence: createInitialRecurrence(date),
  });

  const edit = (t: PmTask): PmDraft => ({
    id: t.id,
    legacy_key: t.legacy_key,
    typeKey: activityMeta.has(t.activity_type) ? t.activity_type : '__custom',
    custom: activityMeta.has(t.activity_type) ? '' : t.title,
    locations: t.locations,
    locationQuery: '',
    splitLocations: false,
    originalLocations: t.locations,
    asset: t.asset ?? '',
    assignees: t.assigned_operator_ids,
    completedBy: t.completed_by_operator_ids ?? [],
    date: t.scheduled_date,
    status: t.status,
    remarks: t.remarks ?? '',
    recurrence: createInitialRecurrence(t.scheduled_date),
  });

  async function save() {
    if (!draft) return;
    const isCustom = draft.typeKey === '__custom';
    if (isCustom && !draft.custom.trim()) {
      setMsg('Enter a name for the custom activity.');
      return;
    }
    const locCheck = validateSelectedLocations(
      draft.locations,
      savedLocationCatalog,
      draft.locationQuery,
      draft.originalLocations,
    );
    if (!locCheck.ok) {
      setMsg(locCheck.error);
      return;
    }
    const repeatDates = draft.id ? [draft.date] : generatePmRepeatDates(draft.date, draft.recurrence);
    if (!draft.id && repeatDates.length === 0) {
      setMsg('No valid dates generated — check your repeat settings and end date.');
      return;
    }
    const activity_type = isCustom
      ? draft.custom.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30)
      : draft.typeKey;
    const title = isCustom ? draft.custom.trim() : (activityMeta.get(draft.typeKey)?.label ?? draft.typeKey);
    const completedBy =
      draft.status === 'done' ? (draft.completedBy.length > 0 ? draft.completedBy : draft.assignees) : [];
    const base = {
      organization_id: p.orgId,
      activity_type,
      title,
      locations: locCheck.locations,
      asset: resolveTaskAssetForLocations(activity_type, locCheck.locations, gensets, draft.asset),
      assigned_operator_ids: draft.assignees,
      status: draft.status,
      remarks: draft.remarks.trim() || null,
      completed_at: draft.status === 'done' ? p.today : null,
    };
    const writeTask = async (withCompletedBy: boolean) => {
      const sb = supabaseBrowser();
      const body = withCompletedBy ? { ...base, completed_by_operator_ids: completedBy } : base;
      if (draft.id) return sb.from('pm_tasks').update({ ...body, scheduled_date: draft.date }).eq('id', draft.id);
      const locationGroups = expandPmTaskGroups(locCheck.locations, draft.splitLocations);
      const ts = Date.now().toString(36);
      const rows = locationGroups.flatMap((locs, locIdx) => {
        const series = buildPmSeriesPrefix(ts, locIdx, locationGroups.length);
        const groupAsset = resolveTaskAssetForLocations(activity_type, locs, gensets, draft.asset);
        return repeatDates.map((d, i) => ({
          ...body,
          locations: locs,
          asset: groupAsset,
          ...(i > 0
            ? {
                status: 'planned' as const,
                completed_at: null,
                ...(withCompletedBy ? { completed_by_operator_ids: [] as string[] } : {}),
              }
            : {}),
          legacy_key: repeatDates.length > 1 ? `${series}-${i}` : null,
          scheduled_date: d,
        }));
      });
      return sb.from('pm_tasks').insert(rows);
    };
    setBusy(true);
    setMsg('');
    let { error } = await writeTask(true);
    if (error && isMissingCompletedByColumnError(error)) ({ error } = await writeTask(false));
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setDraft(null);
    router.refresh();
  }

  async function executeRemove() {
    if (!confirmDel) return;
    const { scope, target } = confirmDel;
    setConfirmDel(null);
    const t = target ?? (draft?.id ? { id: draft.id, legacy_key: draft.legacy_key ?? null, date: draft.date } : null);
    if (!t) return;
    const sb = supabaseBrowser();
    const series = t.legacy_key?.split('-')[0];
    let q = sb.from('pm_tasks').delete();
    if (scope === 'one' || !series) q = q.eq('id', t.id);
    else {
      q = q.like('legacy_key', `${series}-%`);
      if (scope === 'following') q = q.gte('scheduled_date', t.date);
    }
    const { error } = await q;
    if (error) {
      setMsg(error.message);
      return;
    }
    setDraft(null);
    router.refresh();
  }

  function remove(scope: 'one' | 'series' | 'following', target?: { id: string; legacy_key: string | null; date: string }) {
    setConfirmDel({ scope, target });
  }

  async function updateTask(
    t: PmTask,
    patch: Partial<Pick<PmTask, 'status' | 'assigned_operator_ids' | 'completed_by_operator_ids' | 'remarks'>>,
  ): Promise<boolean> {
    const nextCompleted =
      patch.status !== undefined ? (patch.status === 'done' ? (t.completed_at ?? p.today) : null) : t.completed_at;
    const nextPerformed =
      patch.completed_by_operator_ids !== undefined
        ? patch.completed_by_operator_ids
        : patch.status !== undefined && patch.status !== 'done'
          ? []
          : t.completed_by_operator_ids;
    const fullPatch = { ...patch, completed_at: nextCompleted, ...(nextPerformed !== undefined ? { completed_by_operator_ids: nextPerformed } : {}) };
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, ...fullPatch } : x)));
    const sb = supabaseBrowser();
    let { error } = await sb.from('pm_tasks').update(fullPatch).eq('id', t.id);
    if (error && isMissingCompletedByColumnError(error)) {
      const { completed_by_operator_ids: _drop, ...legacyPatch } = fullPatch;
      void _drop;
      ({ error } = await sb.from('pm_tasks').update(legacyPatch).eq('id', t.id));
    }
    if (error) {
      setMsg(error.message);
      router.refresh();
      return false;
    }
    return true;
  }

  async function rescheduleTask(taskId: string, newDate: string) {
    if (!p.canEdit) return;
    setTasks((ts) => ts.map((x) => (x.id === taskId ? { ...x, scheduled_date: newDate } : x)));
    const { error } = await supabaseBrowser().from('pm_tasks').update({ scheduled_date: newDate }).eq('id', taskId);
    if (error) {
      setMsg(error.message);
      router.refresh();
    }
  }

  async function confirmComplete(payload: { completedByIds: string[]; remarks: string | null }) {
    if (!completeModal) return;
    setCompleteBusy(true);
    const ok = await updateTask(completeModal.task, {
      status: 'done',
      completed_by_operator_ids: payload.completedByIds,
      remarks: payload.remarks,
    });
    setCompleteBusy(false);
    if (ok) setCompleteModal(null);
  }

  function exportIcs() {
    const ics = buildPmCalendarIcs(visible, opBy);
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `bpwi-pm-${p.month}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openEditActivities() {
    setActDraft(
      activityChips.map((c, idx) => ({
        code: c.type,
        label: c.label,
        short_label: c.short,
        color: c.color,
        sort_order: idx,
      })),
    );
    setEditActsOpen(true);
  }

  async function saveActivities() {
    const cleaned = actDraft
      .map((a, idx) => ({
        organization_id: p.orgId,
        code: a.code.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').slice(0, 30),
        label: a.label.trim() || a.code,
        short_label: a.short_label.trim() || a.label.trim() || a.code,
        color: a.color || '#0284c7',
        sort_order: idx,
      }))
      .filter((a) => a.code.length > 0);
    if (cleaned.length === 0) return;

    setSavingActs(true);
    setMsg('');
    const sb = supabaseBrowser();
    const { error } = await sb.from('pm_activity_types').upsert(cleaned, { onConflict: 'organization_id,code' });
    setSavingActs(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setActTypes(cleaned);
    setEditActsOpen(false);
    router.refresh();
  }

  const monthTasks = visible.filter((t) => t.scheduled_date.startsWith(p.month));
  const counts = {
    total: monthTasks.length,
    planned: monthTasks.filter((t) => t.status === 'planned').length,
    done: monthTasks.filter((t) => t.status === 'done').length,
  };
  const nextTask = visible.find((t) => t.status === 'planned' && t.scheduled_date >= p.today);

  const dayTasks = byDate.get(selectedDate) ?? [];
  const dayStandby = standbyByDate.get(selectedDate) ?? [];
  let onDuty = 0;
  let onRest = 0;
  let onLeave = 0;
  for (const op of p.operators) {
    const a = asgByDateOp.get(`${selectedDate}:${op.id}`);
    const s = a?.shift_type_id ? shiftBy.get(a.shift_type_id) : undefined;
    const ar = a?.area_code_id ? areaBy.get(a.area_code_id) : undefined;
    const isRest = Boolean(ar && (ar.category === 'rest' || ar.code.toUpperCase() === 'RD'));
    const isLeave = Boolean(ar && ar.category === 'leave' && ar.code.toUpperCase() !== 'RD');
    if (isLeave) onLeave += 1;
    else if (isRest || s?.is_off) onRest += 1;
    else if (s && !s.is_off) onDuty += 1;
  }
  const dayDelta = diffDays(p.today, selectedDate);
  const dayRel = dayDelta === 0 ? 'Today' : dayDelta > 0 ? `in ${dayDelta} d` : `${Math.abs(dayDelta)} d ago`;

  return {
    holidayByDate,
    editActsOpen,
    setEditActsOpen,
    actDraft,
    setActDraft,
    savingActs,
    view,
    setView,
    selectedDate,
    setSelectedDate,
    draft,
    setDraft,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    areaFilter,
    setAreaFilter,
    msg,
    busy,
    isPending,
    filtersOpen,
    setFiltersOpen,
    exportCsvOpen,
    setExportCsvOpen,
    confirmDel,
    setConfirmDel,
    completeModal,
    setCompleteModal,
    completeBusy,
    pmLocations,
    setPmLocations,
    manageLocsOpen,
    setManageLocsOpen,
    gensets,
    setGensets,
    manageGensetsOpen,
    setManageGensetsOpen,
    monthLabel,
    opBy,
    savedLocationCatalog,
    allLocations,
    activityChips,
    activityMeta,
    byDate,
    gridDays,
    counts,
    nextTask,
    dayTasks,
    dayStandby,
    onDuty,
    onRest,
    onLeave,
    dayRel,
    go,
    goToday,
    selectMonth,
    getOperatorConflict,
    hasConflict,
    openDraft,
    blank,
    edit,
    save,
    executeRemove,
    remove,
    updateTask,
    rescheduleTask,
    confirmComplete,
    exportIcs,
    openEditActivities,
    saveActivities,
  };
}
