'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Task = {
  id: string;
  legacy_key: string | null;
  activity_type: string;
  title: string;
  locations: string[];
  asset: string | null;
  assigned_operator_ids: string[];
  scheduled_date: string;
  status: 'planned' | 'done' | 'postponed';
  completed_at: string | null;
  remarks: string | null;
};
type Op = { id: string; full_name: string; phone_number: string | null };
type Shift = { id: string; is_off: boolean };
type Area = { id: string; code: string; name: string | null; category: string };
type Asg = { operator_id: string; schedule_date: string; shift_type_id: string | null; area_code_id: string | null };
type Standby = { operator_id: string; schedule_date: string; standby_type: string };
type ActivityType = { id?: string; code: string; label: string; short_label: string; color: string; sort_order: number };

const PRESETS: Record<string, { label: string; short: string; color: string }> = {
  FLUSH: { label: 'Line Flushing', short: 'Flushing', color: '#0284c7' },
  TANK: { label: 'Tank Cleaning', short: 'Tank Cleaning', color: '#0d9488' },
  PULL: { label: 'Deep Well Pump & Motor Pull-out', short: 'Pull-out', color: '#db2777' },
  THERM: { label: 'Thermal Scanning', short: 'Thermal Scan', color: '#ea580c' },
  LEVEL: { label: 'Water Level Monitoring', short: 'SWL&PWL', color: '#ca8a04' },
};

const CUSTOM_PALETTE = ['#7c3aed', '#4f46e5', '#059669', '#be185d', '#0369a1'];
const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function activityColor(type: string, title?: string) {
  if (PRESETS[type]) return PRESETS[type].color;
  if (/mmf|backwash/i.test(type) || /mmf|backwash/i.test(title ?? '')) return '#7c3aed';
  let h = 0;
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0;
  return CUSTOM_PALETTE[h % CUSTOM_PALETTE.length];
}

function addDays(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function addMonths(d: string, n: number) {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const max = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, max));
  return t.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function formatDayHeading(date: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date + 'T00:00:00Z'));
}

function formatShortDay(date: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date + 'T00:00:00Z'));
}

type Draft = {
  id?: string;
  legacy_key?: string | null;
  typeKey: string;
  custom: string;
  locations: string;
  asset: string;
  assignees: string[];
  date: string;
  status: Task['status'];
  remarks: string;
  repeat: 'none' | 'weekly' | 'monthly';
  count: number;
};

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
  orgId: string;
  canEdit: boolean;
  error: string;
}) {
  const router = useRouter();
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
  const [confirmDel, setConfirmDel] = useState<{
    scope: 'one' | 'series' | 'following';
    target?: { id: string; legacy_key: string | null; date: string };
  } | null>(null);

  useEffect(() => setTasks(p.tasks), [p.tasks]);
  useEffect(() => setActTypes(p.activityTypes), [p.activityTypes]);

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
    const map = new Map<string, { type: string; label: string; short: string; color: string; count: number; sort: number }>();
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

  function hasConflict(t: Task) {
    if (t.status === 'done') return false;
    const sbList = new Set((standbyByDate.get(t.scheduled_date) ?? []).map((s) => s.operator_id));
    for (const opId of t.assigned_operator_ids ?? []) {
      if (sbList.has(opId)) return true;
      const a = asgByDateOp.get(`${t.scheduled_date}:${opId}`);
      if (a?.shift_type_id && shiftBy.get(a.shift_type_id)?.is_off) return true;
      const area = a?.area_code_id ? areaBy.get(a.area_code_id) : undefined;
      if (area && (area.category === 'leave' || area.category === 'rest' || area.category === 'holiday' || area.code.toUpperCase() === 'RD')) {
        return true;
      }
    }
    return false;
  }

  const blank = (date: string): Draft => ({
    typeKey: 'FLUSH',
    custom: '',
    locations: '',
    asset: '',
    assignees: [],
    date,
    status: 'planned',
    remarks: '',
    repeat: 'none',
    count: 4,
  });

  const edit = (t: Task): Draft => ({
    id: t.id,
    legacy_key: t.legacy_key,
    typeKey: activityMeta.has(t.activity_type) ? t.activity_type : '__custom',
    custom: activityMeta.has(t.activity_type) ? '' : t.title,
    locations: t.locations.join(', '),
    asset: t.asset ?? '',
    assignees: t.assigned_operator_ids,
    date: t.scheduled_date,
    status: t.status,
    remarks: t.remarks ?? '',
    repeat: 'none',
    count: 1,
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
    setBusy(true);
    setMsg('');
    const sb = supabaseBrowser();
    let error;
    if (draft.id) {
      ({ error } = await sb.from('pm_tasks').update({ ...base, scheduled_date: draft.date }).eq('id', draft.id));
    } else {
      const series = `S${Date.now().toString(36)}`;
      const n = draft.repeat === 'none' ? 1 : Math.min(Math.max(draft.count, 1), 60);
      const rows = Array.from({ length: n }, (_, i) => ({
        ...base,
        legacy_key: `${series}-${i}`,
        scheduled_date:
          draft.repeat === 'weekly'
            ? addDays(draft.date, 7 * i)
            : draft.repeat === 'monthly'
              ? addMonths(draft.date, i)
              : draft.date,
      }));
      ({ error } = await sb.from('pm_tasks').insert(rows));
    }
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

  async function updateTask(t: Task, patch: Partial<Pick<Task, 'status' | 'assigned_operator_ids'>>) {
    const nextCompleted =
      patch.status !== undefined ? (patch.status === 'done' ? p.today : null) : t.completed_at;
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, ...patch, completed_at: nextCompleted } : x)));
    const { error } = await supabaseBrowser()
      .from('pm_tasks')
      .update({ ...patch, completed_at: nextCompleted })
      .eq('id', t.id);
    if (error) {
      setMsg(error.message);
      router.refresh();
    }
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
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BP Waterworks//PM Calendar//EN'];
    for (const t of visible) {
      const dt = t.scheduled_date.replace(/-/g, '');
      const nextDt = addDays(t.scheduled_date, 1).replace(/-/g, '');
      const crew = t.assigned_operator_ids.map((id) => opBy.get(id)?.full_name).filter(Boolean).join(', ');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${t.id}@bpwi`,
        `DTSTART;VALUE=DATE:${dt}`,
        `DTEND;VALUE=DATE:${nextDt}`,
        `SUMMARY:${t.title}${t.locations.length ? ' - ' + t.locations.join(', ') : ''}`,
        `DESCRIPTION:${[crew ? 'Crew: ' + crew : '', t.asset ? 'Asset: ' + t.asset : '', t.remarks ?? ''].filter(Boolean).join(' | ')}`,
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
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
          <strong className="desktop-only" style={{ fontSize: 16, margin: '0 4px', color: 'var(--text)' }}>{monthLabel}</strong>
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
                    border: active ? '2px solid #0f172a' : '1px solid transparent',
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
            </div>
            {p.canEdit && (
              <button
                className="btn"
                style={{ background: '#0f766e', borderColor: '#0f766e', color: '#ffffff', fontWeight: 700 }}
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
            <strong style={{ color: '#0f766e' }}>●</strong> <b>{counts.total}</b> scheduled this month
          </span>
          <span>
            <strong style={{ color: '#2563eb' }}>●</strong> <b>{counts.planned}</b> planned
          </span>
          <span>
            <strong style={{ color: '#16a34a' }}>●</strong> <b>{counts.done}</b> done
          </span>
          {nextTask && (
            <span>
              <strong style={{ color: '#0284c7' }}>●</strong> Next: <b>{formatShortDay(nextTask.scheduled_date)}</b>{' '}
              {PRESETS[nextTask.activity_type]?.short ?? nextTask.title}
              {nextTask.locations.length ? ` · ${nextTask.locations.join(', ')}` : ''}
            </span>
          )}
          {msg && (
            <span role="alert" style={{ color: '#b91c1c', fontWeight: 600 }}>
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

            return (
              <div
                key={d}
                className="pm-day-cell"
                role="button"
                tabIndex={0}
                aria-label={`${d}, ${list.length} PM ${list.length === 1 ? 'task' : 'tasks'}${isToday ? ', Today' : ''}`}
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
                  background: isToday ? 'var(--surface-muted)' : inMonth ? 'var(--surface)' : 'var(--bg)',
                  minHeight: view === 'week' ? 320 : undefined,
                  padding: 4,
                  cursor: 'pointer',
                  outline: isSelected ? '2px solid #0f766e' : 'none',
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
                      background: isToday ? '#0369a1' : 'transparent',
                      color: isToday ? '#ffffff' : inMonth ? 'var(--text)' : 'var(--text-muted)',
                    }}
                  >
                    {dayNum === 1 ? `${MONTHS_FULL[+d.slice(5, 7) - 1].slice(0, 3)} 1` : dayNum}
                  </span>
                </div>

                {/* Mobile compact dots (<= 640px) */}
                {list.length > 0 && (
                  <div className="pm-mobile-dots" aria-hidden="true">
                    {list.map((t) => {
                      const meta = activityMeta.get(t.activity_type);
                      const color = meta?.color ?? activityColor(t.activity_type, t.title);
                      return (
                        <span
                          key={t.id}
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: t.status === 'done' ? 'transparent' : color,
                            border: `2px solid ${color}`,
                          }}
                        />
                      );
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
                        .join(', ')}${conflict ? '\n⚠ Crew conflict (off/leave/standby)' : ''}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        background: isDone ? '#ffffff' : color,
                        color: isDone ? color : '#ffffff',
                        border: `1.5px solid ${color}`,
                        borderRadius: 999,
                        padding: '2px 6px',
                        margin: '2px 0',
                        fontSize: 10.5,
                        fontWeight: 700,
                        lineHeight: 1.25,
                        cursor: 'pointer',
                        overflow: 'hidden',
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (p.canEdit) updateTask(t, { status: isDone ? 'planned' : 'done' });
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
        <aside
          className="no-print card"
          style={{
            padding: 14,
            position: 'sticky',
            top: 12,
            display: 'grid',
            gap: 10,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text)' }}>{formatDayHeading(selectedDate)}</h3>
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
              {dayTasks.length} PM {dayTasks.length === 1 ? 'task' : 'tasks'} · {dayRel}
            </div>
          </div>

          {/* Crew & Standby Summary */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', fontSize: 11, fontWeight: 700 }}>
            <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 7px', borderRadius: 999 }}>
              {onDuty} on duty
            </span>
            <span style={{ background: '#fef9c3', color: '#854d0e', padding: '2px 7px', borderRadius: 999 }}>
              {onRest} rest
            </span>
            <span style={{ background: '#ffe4e6', color: '#9f1239', padding: '2px 7px', borderRadius: 999 }}>
              {onLeave} leave
            </span>
            <span style={{ background: '#f3e8ff', color: '#6b21a8', padding: '2px 7px', borderRadius: 999 }}>
              ⚡ {dayStandby.length} standby
            </span>
          </div>

          {dayStandby.length > 0 && (
            <div style={{ display: 'grid', gap: 4 }}>
              {dayStandby.map((sb) => {
                const op = opBy.get(sb.operator_id);
                if (!op) return null;
                return (
                  <div
                    key={sb.operator_id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'rgba(124, 58, 237, 0.12)',
                      border: '1px solid rgba(124, 58, 237, 0.35)',
                      borderRadius: 6,
                      padding: '4px 8px',
                      fontSize: 11.5,
                    }}
                  >
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{op.full_name}</span>
                    <span style={{ color: 'var(--violet)', fontFamily: 'ui-monospace, monospace', fontSize: 10.5, fontWeight: 600 }}>
                      {sb.standby_type}
                      {op.phone_number ? ` · ${op.phone_number}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', letterSpacing: '0.05em' }}>
              MAINTENANCE TASKS
            </div>

            {dayTasks.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>No maintenance tasks scheduled for this day.</p>
            ) : (
              dayTasks.map((t) => {
                const meta = activityMeta.get(t.activity_type);
                const color = meta?.color ?? activityColor(t.activity_type, t.title);
                const availableOps = p.operators.filter((o) => !t.assigned_operator_ids.includes(o.id));
                return (
                  <div
                    key={t.id}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 10,
                      display: 'grid',
                      gap: 6,
                      background: 'var(--surface-muted)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, fontSize: 12.5, color: 'var(--text)' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
                        {meta?.label ?? t.title}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 999,
                          background: t.status === 'done' ? '#dcfce7' : t.status === 'postponed' ? '#fef3c7' : '#e2e8f0',
                          color: t.status === 'done' ? '#166534' : t.status === 'postponed' ? '#92400e' : '#334155',
                        }}
                      >
                        {t.status}
                      </span>
                    </div>

                    {t.locations.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.locations.join(', ')}</div>
                    )}

                    {/* Crew Chips */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {t.assigned_operator_ids.map((id) => {
                        const op = opBy.get(id);
                        if (!op) return null;
                        return (
                          <span
                            key={id}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: '#dcfce7',
                              color: '#166534',
                              padding: '2px 7px',
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {op.full_name}
                            {p.canEdit && (
                              <button
                                type="button"
                                onClick={() =>
                                  updateTask(t, {
                                    assigned_operator_ids: t.assigned_operator_ids.filter((x) => x !== id),
                                  })
                                }
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: '#166534',
                                  cursor: 'pointer',
                                  padding: 0,
                                  fontWeight: 800,
                                }}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>

                    {p.canEdit && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <select
                          className="btn"
                          style={{ padding: '3px 6px', fontSize: 11 }}
                          value={t.status}
                          onChange={(e) => updateTask(t, { status: e.target.value as Task['status'] })}
                        >
                          <option value="planned">Planned</option>
                          <option value="done">Done</option>
                          <option value="postponed">Postponed</option>
                        </select>
                        <select
                          className="btn"
                          style={{ padding: '3px 6px', fontSize: 11, flex: 1 }}
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              updateTask(t, { assigned_operator_ids: [...t.assigned_operator_ids, e.target.value] });
                            }
                          }}
                        >
                          <option value="">+ Add crew…</option>
                          {availableOps.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.full_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {p.canEdit && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setDraft(edit(t))}>
                          Edit
                        </button>
                        <button
                          className="btn"
                          style={{ padding: '2px 8px', fontSize: 11, color: '#b91c1c' }}
                          onClick={() => remove('one', { id: t.id, legacy_key: t.legacy_key, date: t.scheduled_date })}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {p.canEdit && (
            <button
              className="btn"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 999,
                background: '#0f766e',
                borderColor: '#0f766e',
                color: '#ffffff',
                fontWeight: 700,
              }}
              onClick={() => setDraft(blank(selectedDate))}
            >
              + Schedule PM on this day
            </button>
          )}
        </aside>
      </div>

      {/* Create / Edit Modal (Bottom Sheet on mobile, Dialog on desktop) */}
      {draft && (
        <div
          className="no-print modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pm-dialog-title"
          onClick={() => !busy && setDraft(null)}
        >
          <div
            className="modal-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'grid', gap: 10 }}
          >
            <h2 id="pm-dialog-title" style={{ margin: 0, fontSize: 17 }}>
              {draft.id ? 'Edit task' : 'Schedule PM task'}
            </h2>
            <label style={{ fontSize: 13 }}>
              Activity
              <select className="input" value={draft.typeKey} onChange={(e) => setDraft({ ...draft, typeKey: e.target.value })}>
                {activityChips.map((c) => (
                  <option key={c.type} value={c.type}>
                    {c.label}
                  </option>
                ))}
                <option value="__custom">+ Custom activity…</option>
              </select>
            </label>
            {draft.typeKey === '__custom' && (
              <input
                className="input"
                placeholder="Custom activity name (e.g. MMF Backwashing)"
                value={draft.custom}
                onChange={(e) => setDraft({ ...draft, custom: e.target.value })}
              />
            )}
            <label style={{ fontSize: 13 }}>
              Locations / sites (comma-separated)
              <input className="input" value={draft.locations} onChange={(e) => setDraft({ ...draft, locations: e.target.value })} />
            </label>
            <label style={{ fontSize: 13 }}>
              Asset <input className="input" value={draft.asset} onChange={(e) => setDraft({ ...draft, asset: e.target.value })} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ fontSize: 13, flex: 1 }}>
                Date <input type="date" className="input" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
              </label>
              <label style={{ fontSize: 13, flex: 1 }}>
                Status
                <select
                  className="input"
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as Task['status'] })}
                >
                  <option value="planned">Planned</option>
                  <option value="done">Done</option>
                  <option value="postponed">Postponed</option>
                </select>
              </label>
            </div>
            <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: 120, overflow: 'auto', fontSize: 12 }}>
              <legend>Assignees</legend>
              {p.operators.map((o) => (
                <label key={o.id} style={{ display: 'inline-flex', gap: 4, margin: '2px 10px 2px 0' }}>
                  <input
                    type="checkbox"
                    checked={draft.assignees.includes(o.id)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        assignees: e.target.checked
                          ? [...draft.assignees, o.id]
                          : draft.assignees.filter((x) => x !== o.id),
                      })
                    }
                  />
                  {o.full_name}
                </label>
              ))}
            </fieldset>
            <label style={{ fontSize: 13 }}>
              Remarks <input className="input" value={draft.remarks} onChange={(e) => setDraft({ ...draft, remarks: e.target.value })} />
            </label>
            {!draft.id && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                <label style={{ fontSize: 13, flex: 1 }}>
                  Repeat
                  <select
                    className="input"
                    value={draft.repeat}
                    onChange={(e) => setDraft({ ...draft, repeat: e.target.value as Draft['repeat'] })}
                  >
                    <option value="none">Once</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                {draft.repeat !== 'none' && (
                  <label style={{ fontSize: 13, width: 120 }}>
                    Occurrences
                    <input
                      type="number"
                      min={2}
                      max={60}
                      className="input"
                      value={draft.count}
                      onChange={(e) => setDraft({ ...draft, count: +e.target.value })}
                    />
                  </label>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {draft.id && (
                  <button className="btn" style={{ color: '#b91c1c' }} onClick={() => remove('one')}>
                    Delete
                  </button>
                )}
                {draft.id && draft.legacy_key?.startsWith('S') && (
                  <>
                    <button className="btn" style={{ color: '#b91c1c' }} onClick={() => remove('following')}>
                      Delete this &amp; following
                    </button>
                    <button className="btn" style={{ color: '#b91c1c' }} onClick={() => remove('series')}>
                      Delete series
                    </button>
                  </>
                )}
              </span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn" onClick={() => setDraft(null)} disabled={busy}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDel && (
        <div
          className="no-print modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pm-del-title"
          onClick={() => setConfirmDel(null)}
        >
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, display: 'grid', gap: 12 }}>
            <h2 id="pm-del-title" style={{ margin: 0, fontSize: 16 }}>
              {confirmDel.scope === 'one'
                ? 'Delete this task?'
                : confirmDel.scope === 'series'
                  ? 'Delete the entire series?'
                  : 'Delete this and following tasks?'}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmDel(null)}>
                Cancel
              </button>
              <button className="btn" style={{ background: '#b91c1c', borderColor: '#b91c1c', color: '#fff' }} onClick={executeRemove}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit PM Activities & Colors Modal */}
      {editActsOpen && (
        <div
          className="no-print modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-acts-title"
          onClick={() => !savingActs && setEditActsOpen(false)}
        >
          <div
            className="modal-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 640, display: 'grid', gap: 12 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 id="edit-acts-title" style={{ margin: 0, fontSize: 17 }}>
                Edit PM Activity Names &amp; Colors
              </h2>
              <button
                className="btn"
                onClick={() =>
                  setActDraft((a) => [
                    ...a,
                    {
                      code: `CUSTOM_${a.length + 1}`,
                      label: 'New Activity',
                      short_label: 'New Activity',
                      color: '#0284c7',
                      sort_order: a.length,
                    },
                  ])
                }
              >
                + Add activity
              </button>
            </div>

            <div style={{ display: 'grid', gap: 8, maxHeight: '58vh', overflow: 'auto', paddingRight: 4 }}>
              {actDraft.map((a, i) => (
                <div
                  key={`${a.code}-${i}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '40px 1fr 1fr 110px',
                    gap: 8,
                    alignItems: 'center',
                    padding: '6px 8px',
                    background: '#f8fafc',
                    borderRadius: 8,
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <input
                    type="color"
                    aria-label={`Color for ${a.label}`}
                    value={a.color}
                    onChange={(e) =>
                      setActDraft((list) => list.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))
                    }
                    style={{ width: 36, height: 30, padding: 0, border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer' }}
                  />
                  <input
                    className="input"
                    aria-label="Full activity name"
                    placeholder="Full name (e.g. Line Flushing)"
                    value={a.label}
                    onChange={(e) =>
                      setActDraft((list) => list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                  />
                  <input
                    className="input"
                    aria-label="Short pill label"
                    placeholder="Pill label (e.g. Flushing)"
                    value={a.short_label}
                    onChange={(e) =>
                      setActDraft((list) => list.map((x, j) => (j === i ? { ...x, short_label: e.target.value } : x)))
                    }
                  />
                  <span
                    style={{
                      background: a.color,
                      color: '#ffffff',
                      borderRadius: 999,
                      padding: '4px 10px',
                      fontSize: 11.5,
                      fontWeight: 700,
                      textAlign: 'center',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {a.short_label || a.label || a.code}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setEditActsOpen(false)} disabled={savingActs}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveActivities} disabled={savingActs}>
                {savingActs ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
