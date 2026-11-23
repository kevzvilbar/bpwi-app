'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { subscribeVisibilityAwareChannel } from '@/lib/supabase/realtime';
import { isMissingCompletedByColumnError } from '@/lib/pm-credit';
import { createInitialRecurrence, generatePmRepeatDates } from '@/lib/pm-recurrence';
import PmDayInspector from '@/components/PmDayInspector';

const PmExportModal = dynamic(() => import('@/components/PmExportModal'), { ssr: false });
const PmCompleteModal = dynamic(() => import('@/components/PmCompleteModal'), { ssr: false });
import PmPlannerModals, {
  addPmDays as addDays,
  buildPmCalendarIcs,
  diffPmDays as diffDays,
  formatPmDayHeading as formatDayHeading,
  formatPmShortDay as formatShortDay,
  pmActivityColor as activityColor,
  PM_PRESETS as PRESETS,
  type PmActivityChip,
  type PmActivityType,
  type PmConfirmDelete,
  type PmDraft,
  type PmOp,
  type PmTask,
} from '@/components/PmPlannerModals';

type Task = PmTask;
type Op = PmOp;
type Shift = { id: string; is_off: boolean };
type Area = { id: string; code: string; name: string | null; category: string };
type Asg = { operator_id: string; schedule_date: string; shift_type_id: string | null; area_code_id: string | null };
type Standby = { operator_id: string; schedule_date: string; standby_type: string };
type ActivityType = PmActivityType;

const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type Draft = PmDraft;

export default function PmPlanner(p: {
  month: string;
  today: string;
  tasks: Task[];
  activityTypes: ActivityType[];
  operators: Op[];
  shifts: Shift[];
  areas: Area[];
  assignments: Asg[];
  standby: Standby[];
  holidays?: Array<{ holiday_date: string; name: string; holiday_type: string }>;
  orgId: string;
  operatorId?: string | null;
  canEdit: boolean;
  canExportCsv?: boolean;
  error: string;
}) {
  const router = useRouter();
  const holidayByDate = useMemo(
    () => new Map((p.holidays ?? []).map((h) => [h.holiday_date, h])),
    [p.holidays],
  );
  const [tasks, setTasks] = useState(p.tasks);
  const [actTypes, setActTypes] = useState<ActivityType[]>(p.activityTypes);
  const [editActsOpen, setEditActsOpen] = useState(false);
  const [actDraft, setActDraft] = useState<ActivityType[]>([]);
  const [savingActs, setSavingActs] = useState(false);
  const [view, setView] = useState<'month' | 'week'>('month');
  const [selectedDate, setSelectedDate] = useState(() =>
    p.today.startsWith(p.month) ? p.today : `${p.month}-01`,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [msg, setMsg] = useState(p.error);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportCsvOpen, setExportCsvOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<PmConfirmDelete | null>(null);
  const [completeModal, setCompleteModal] = useState<{ task: Task; mode: 'complete' | 'edit' } | null>(null);
  const [completeBusy, setCompleteBusy] = useState(false);

  useEffect(() => setTasks(p.tasks), [p.tasks]);
  useEffect(() => setActTypes(p.activityTypes), [p.activityTypes]);
  useEffect(() => {
    const sb = supabaseBrowser();
    return subscribeVisibilityAwareChannel({
      sb,
      channelName: `pm-plan-${p.month}`,
      listeners: [
        {
          table: 'pm_tasks',
          onEvent: (payload) => {
            const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Partial<Task> & { id?: string };
            if (!rec?.id) return;
            if (payload.eventType === 'DELETE') {
              setTasks((prev) => prev.filter((x) => x.id !== rec.id));
              return;
            }
            const nextTask: Task = {
              id: rec.id,
              legacy_key: rec.legacy_key ?? null,
              activity_type: rec.activity_type ?? 'FLUSH',
              title: rec.title ?? '',
              locations: rec.locations ?? [],
              asset: rec.asset ?? null,
              assigned_operator_ids: rec.assigned_operator_ids ?? [],
              completed_by_operator_ids: rec.completed_by_operator_ids ?? [],
              scheduled_date: rec.scheduled_date ?? '',
              status: (rec.status as Task['status']) ?? 'planned',
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

  const [y, mo] = p.month.split('-').map(Number);
  const monthLabel = `${MONTHS_FULL[(mo - 1 + 12) % 12]} ${y}`;

  const opBy = useMemo(() => new Map(p.operators.map((o) => [o.id, o])), [p.operators]);
  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);

  const allLocations = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach((t) => t.locations.forEach((l) => s.add(l)));
    return Array.from(s).sort();
  }, [tasks]);

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
      if (t.scheduled_date.startsWith(p.month)) {
        map.get(t.activity_type)!.count += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.sort - b.sort);
  }, [actTypes, p.month, tasks]);

  const activityMeta = useMemo(() => new Map(activityChips.map((c) => [c.type, c])), [activityChips]);

  const asgByDateOp = useMemo(() => {
    const m = new Map<string, Asg>();
    p.assignments.forEach((a) => m.set(`${a.schedule_date}:${a.operator_id}`, a));
    return m;
  }, [p.assignments]);

  const standbyByDate = useMemo(() => {
    const m = new Map<string, Standby[]>();
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
    const m = new Map<string, Task[]>();
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

  function hasConflict(t: Task) {
    if (t.status === 'done') return false;
    for (const opId of t.assigned_operator_ids ?? []) {
      if (getOperatorConflict(t.scheduled_date, opId)) return true;
    }
    return false;
  }

  const blank = (date: string): Draft => ({
    typeKey: 'FLUSH',
    custom: '',
    locations: '',
    asset: '',
    assignees: [],
    completedBy: [],
    date,
    status: 'planned',
    remarks: '',
    recurrence: createInitialRecurrence(date),
  });

  const edit = (t: Task): Draft => ({
    id: t.id,
    legacy_key: t.legacy_key,
    typeKey: activityMeta.has(t.activity_type) ? t.activity_type : '__custom',
    custom: activityMeta.has(t.activity_type) ? '' : t.title,
    locations: t.locations.join(', '),
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
      locations: draft.locations.split(',').map((s) => s.trim()).filter(Boolean),
      asset: draft.asset.trim() || null,
      assigned_operator_ids: draft.assignees,
      status: draft.status,
      remarks: draft.remarks.trim() || null,
      completed_at: draft.status === 'done' ? p.today : null,
    };
    const repeatDates = draft.id ? [draft.date] : generatePmRepeatDates(draft.date, draft.recurrence);
    if (!draft.id && repeatDates.length === 0) {
      setMsg('No valid dates generated — check your repeat settings and end date.');
      return;
    }
    const writeTask = async (withCompletedBy: boolean) => {
      const sb = supabaseBrowser();
      const body = withCompletedBy ? { ...base, completed_by_operator_ids: completedBy } : base;
      if (draft.id) return sb.from('pm_tasks').update({ ...body, scheduled_date: draft.date }).eq('id', draft.id);
      const series = `S${Date.now().toString(36)}`;
      const rows = repeatDates.map((d, i) => ({
        ...body,
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
    t: Task,
    patch: Partial<Pick<Task, 'status' | 'assigned_operator_ids' | 'completed_by_operator_ids' | 'remarks'>>,
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

  function exportIcs() {
    const ics = buildPmCalendarIcs(visible, opBy);
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `bpwi-pm-${p.month}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (!draft && !editActsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !savingActs) {
        setDraft(null);
        setEditActsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, draft, editActsOpen, savingActs]);

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

  // Selected Day Inspector stats
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

  return (
    <div style={{ padding: '10px 14px 16px', maxWidth: '100%' }}>
      {/* Top Toolbar */}
      <div
        className="no-print card"
        style={{
          padding: '10px 14px',
          marginBottom: 8,
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn"
            onClick={() => {
              setSelectedDate(p.today);
              startTransition(() => router.push(`/pm?m=${p.today.slice(0, 7)}`));
            }}
          >
            {isPending ? 'Loading…' : 'Today'}
          </button>
          <button className="btn" onClick={() => go(-1)} title="Previous">
            ‹
          </button>
          <button className="btn" onClick={() => go(1)} title="Next">
            ›
          </button>
          <h1 className="page-title desktop-only" style={{ fontSize: 16, margin: '0 4px' }}>{monthLabel}</h1>
          <input
            type="month"
            aria-label="Select month"
            value={p.month}
            onChange={(e) => e.target.value && router.push(`/pm?m=${e.target.value}`)}
            className="input"
            style={{ width: 'auto', minHeight: 36, padding: '4px 6px', fontSize: 12.5, fontWeight: 600 }}
          />

          <div
            style={{
              display: 'inline-flex',
              padding: 2,
              background: 'var(--surface-muted)',
              borderRadius: 7,
              marginLeft: 4,
            }}
          >
            {(['month', 'week'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 5,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: view === v ? 'var(--surface)' : 'transparent',
                  color: view === v ? 'var(--text)' : 'var(--text-secondary)',
                  boxShadow: view === v ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {v === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>

          {/* Activity Filter Pills */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginLeft: 4 }}>
            {activityChips.map((c) => {
              const active = typeFilter === c.type;
              return (
                <button
                  key={c.type}
                  onClick={() => setTypeFilter(active ? '' : c.type)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: active ? '2px solid var(--text)' : '1px solid transparent',
                    background: c.color,
                    color: '#ffffff',
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    opacity: typeFilter && !active ? 0.5 : 1,
                  }}
                >
                  <span>{c.short}</span>
                  <span
                    style={{
                      background: 'rgba(255,255,255,0.25)',
                      borderRadius: 999,
                      padding: '0 6px',
                      fontSize: 10.5,
                    }}
                  >
                    {c.count}
                  </span>
                </button>
              );
            })}
            {p.canEdit && (
              <button className="btn" onClick={openEditActivities} title="Edit activity names & colors">
                ✎ Edit
              </button>
            )}
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              className="btn mobile-only-block"
              style={{ display: undefined }}
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
            >
              {filtersOpen ? 'Hide Filters' : 'Filters'}
            </button>
            <div className={filtersOpen ? '' : 'desktop-only'} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="btn" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="planned">Planned</option>
                <option value="done">Done</option>
                <option value="postponed">Postponed</option>
              </select>
              <select className="btn" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
                <option value="">All areas</option>
                {allLocations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => window.print()}>
                Print
              </button>
              <button className="btn" onClick={exportIcs}>
                Export .ics
              </button>
              {p.canExportCsv && (
                <button className="btn" onClick={() => setExportCsvOpen(true)} title="Choose timeframe (Month, Quarter, Full Year, Custom) and export PM Schedule as CSV">
                  Export CSV
                </button>
              )}
            </div>
            {p.canEdit && (
              <button
                className="btn btn-add"
                onClick={() => setDraft(blank(selectedDate))}
              >
                + Schedule PM
              </button>
            )}
          </div>
        </div>

        {/* Summary Strip */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
          <span>
            <strong style={{ color: 'var(--teal)' }}>●</strong> <b>{counts.total}</b> scheduled this month
          </span>
          <span>
            <strong style={{ color: 'var(--primary)' }}>●</strong> <b>{counts.planned}</b> planned
          </span>
          <span>
            <strong style={{ color: 'var(--ok-fg)' }}>●</strong> <b>{counts.done}</b> done
          </span>
          {nextTask && (
            <span>
              <strong style={{ color: 'var(--accent)' }}>●</strong> Next: <b>{formatShortDay(nextTask.scheduled_date)}</b>{' '}
              {PRESETS[nextTask.activity_type]?.short ?? nextTask.title}
              {nextTask.locations.length ? ` · ${nextTask.locations.join(', ')}` : ''}
            </span>
          )}
          {msg && (
            <span role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {msg}
            </span>
          )}
        </div>
      </div>

      {/* Main Split: Calendar Grid + Day Inspector Sidebar */}
      <div className="pm-layout">
        {/* Calendar Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gap: 1,
            background: 'var(--border)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          {WD.map((d) => (
            <div
              key={d}
              style={{
                background: 'var(--surface-muted)',
                color: 'var(--text-secondary)',
                textAlign: 'center',
                padding: '6px 4px',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              {d}
            </div>
          ))}

          {gridDays.map((d) => {
            const inMonth = d.startsWith(p.month);
            const isToday = d === p.today;
            const isSelected = d === selectedDate;
            const dow = new Date(d + 'T00:00:00Z').getUTCDay();
            const isWeekend = dow === 0 || dow === 6;
            const dayNum = +d.slice(8);
            const list = byDate.get(d) ?? [];
            const hol = holidayByDate.get(d);

            return (
              <div
                key={d}
                className="pm-day-cell"
                role="button"
                tabIndex={0}
                aria-label={`${d}${hol ? `, Holiday: ${hol.name}` : ''}, ${list.length} PM ${list.length === 1 ? 'task' : 'tasks'}${isToday ? ', Today' : ''}`}
                aria-pressed={isSelected}
                onClick={() => setSelectedDate(d)}
                onDoubleClick={() => p.canEdit && setDraft(blank(d))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedDate(d);
                  } else if (e.key.toLowerCase() === 'n' && p.canEdit) {
                    e.preventDefault();
                    setDraft(blank(d));
                  }
                }}
                onDragOver={(e) => {
                  if (p.canEdit) e.preventDefault();
                }}
                onDrop={(e) => {
                  if (!p.canEdit) return;
                  const taskId = e.dataTransfer.getData('text/plain');
                  if (taskId) void rescheduleTask(taskId, d);
                }}
                style={{
                  background: isToday
                    ? 'var(--surface-muted)'
                    : hol
                      ? 'rgba(225, 29, 72, 0.06)'
                      : inMonth
                        ? 'var(--surface)'
                        : 'var(--bg)',
                  minHeight: view === 'week' ? 320 : undefined,
                  padding: 4,
                  cursor: 'pointer',
                  outline: isSelected ? '2px solid var(--teal)' : 'none',
                  outlineOffset: -2,
                  opacity: inMonth ? 1 : 0.65,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 22,
                      height: 20,
                      padding: '0 5px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: isToday ? '#0369a1' : hol ? '#be123c' : 'transparent',
                      color: isToday || hol ? '#ffffff' : inMonth ? 'var(--text)' : 'var(--text-muted)',
                    }}
                    title={hol ? hol.name : undefined}
                  >
                    {dayNum === 1 ? `${MONTHS_FULL[+d.slice(5, 7) - 1].slice(0, 3)} 1` : dayNum}
                  </span>
                </div>

                {hol && (
                  <div
                    className="pm-desktop-pill"
                    title={`${hol.name} (${hol.holiday_type.replace(/_/g, ' ')})`}
                    style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger-fg)', background: 'var(--danger-bg)', borderRadius: 4, padding: '1px 5px', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}
                  >
                    ★ {hol.name}
                  </div>
                )}

                {/* Mobile compact dots (<= 640px) */}
                {list.length > 0 && (
                  <div className="pm-mobile-dots" aria-hidden="true">
                    {list.map((t) => {
                      const meta = activityMeta.get(t.activity_type);
                      const color = meta?.color ?? activityColor(t.activity_type, t.title);
                      return <span key={t.id} style={{ width: 8, height: 8, borderRadius: '50%', background: t.status === 'done' ? 'transparent' : color, border: `2px solid ${color}` }} />;
                    })}
                  </div>
                )}

                {list.map((t) => {
                  const meta = activityMeta.get(t.activity_type);
                  const color = meta?.color ?? activityColor(t.activity_type, t.title);
                  const isDone = t.status === 'done';
                  const conflict = hasConflict(t);
                  const shortTitle = meta?.short ?? t.title;
                  const fullTitle = meta?.label ?? t.title;
                  const chipText = t.locations.length ? `${shortTitle} - ${t.locations[0]}` : shortTitle;

                  return (
                    <div
                      key={t.id}
                      className="pm-desktop-pill"
                      draggable={p.canEdit}
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDate(d);
                        if (p.canEdit) setDraft(edit(t));
                      }}
                      title={`${fullTitle}\n${t.locations.join(', ')}${t.asset ? '\n' + t.asset : ''}\n${t.assigned_operator_ids
                        .map((id) => opBy.get(id)?.full_name)
                        .filter(Boolean)
                        .join(', ')}${conflict ? '\n⚠ Crew conflict (RD/off/leave)' : ''}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, background: isDone ? 'var(--surface)' : color, color: isDone ? color : '#ffffff', border: `1.5px solid ${color}`, borderRadius: 999, padding: '2px 6px', margin: '2px 0', fontSize: 10.5, fontWeight: 700, lineHeight: 1.25, cursor: 'pointer', overflow: 'hidden' }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!p.canEdit) return;
                          if (isDone) void updateTask(t, { status: 'planned' });
                          else setCompleteModal({ task: t, mode: 'complete' });
                        }}
                        title={isDone ? 'Mark as planned' : 'Mark as done'}
                        style={{
                          width: 13,
                          height: 13,
                          minWidth: 13,
                          borderRadius: '50%',
                          border: `1.5px solid ${isDone ? color : '#ffffff'}`,
                          background: isDone ? color : 'transparent',
                          color: '#ffffff',
                          fontSize: 8.5,
                          lineHeight: 1,
                          padding: 0,
                          display: 'grid',
                          placeItems: 'center',
                          cursor: p.canEdit ? 'pointer' : 'default',
                        }}
                      >
                        {isDone ? '✓' : ''}
                      </button>
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                          textDecoration: isDone ? 'line-through' : 'none',
                          opacity: isDone ? 0.85 : 1,
                        }}
                      >
                        {chipText}
                      </span>
                      {conflict && (
                        <span
                          title="Crew conflict"
                          style={{
                            background: '#f59e0b',
                            color: '#451a03',
                            borderRadius: 3,
                            padding: '0 4px',
                            fontSize: 9.5,
                            fontWeight: 900,
                          }}
                        >
                          ⚠
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Right-Hand Day Inspector Sidebar */}
        <PmDayInspector
          selectedDate={selectedDate}
          heading={formatDayHeading(selectedDate)}
          dayRel={dayRel}
          holiday={holidayByDate.get(selectedDate)}
          onDuty={onDuty}
          onRest={onRest}
          onLeave={onLeave}
          dayStandby={dayStandby}
          dayTasks={dayTasks}
          operators={p.operators}
          opBy={opBy}
          activityMeta={activityMeta}
          fallbackColor={activityColor}
          getOperatorConflict={getOperatorConflict}
          canEdit={p.canEdit}
          onUpdateTask={(t, patch) => void updateTask(t, patch)}
          onRequestComplete={(t, mode) => setCompleteModal({ task: t, mode })}
          onEditTask={(t) => setDraft(edit(t))}
          onRemoveTask={(target) => remove('one', target)}
          onCreateNewTask={() => setDraft(blank(selectedDate))}
        />
      </div>

      <PmPlannerModals
        canEdit={p.canEdit}
        draft={draft}
        setDraft={setDraft}
        busy={busy}
        onSave={() => void save()}
        onRequestRemove={remove}
        confirmDel={confirmDel}
        onCancelDelete={() => setConfirmDel(null)}
        onExecuteDelete={() => void executeRemove()}
        editActsOpen={editActsOpen}
        setEditActsOpen={setEditActsOpen}
        actDraft={actDraft}
        setActDraft={setActDraft}
        savingActs={savingActs}
        onSaveActivities={() => void saveActivities()}
        activityChips={activityChips}
        operators={p.operators}
        holidayByDate={holidayByDate}
        getOperatorConflict={getOperatorConflict}
      />

      {exportCsvOpen && p.canExportCsv && (
        <PmExportModal
          currentMonth={p.month}
          typeFilter={typeFilter}
          statusFilter={statusFilter}
          areaFilter={areaFilter}
          onClose={() => setExportCsvOpen(false)}
        />
      )}
      {completeModal && (
        <PmCompleteModal
          open
          mode={completeModal.mode}
          task={completeModal.task}
          operators={p.operators}
          currentOperatorId={p.operatorId}
          busy={completeBusy}
          onCancel={() => setCompleteModal(null)}
          onConfirm={async ({ completedByIds, remarks }) => {
            setCompleteBusy(true);
            const ok = await updateTask(completeModal.task, { status: 'done', completed_by_operator_ids: completedByIds, remarks });
            setCompleteBusy(false);
            if (ok) setCompleteModal(null);
          }}
        />
      )}
    </div>
  );
}
