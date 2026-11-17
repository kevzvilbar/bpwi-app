'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Op = { id: string; full_name: string; position: string | null; phone_number: string | null; default_station: string | null };
type Shift = {
  id: string;
  code: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  background_color: string;
  text_color: string;
  is_off: boolean;
};
type Area = { id: string; code: string; name: string | null; category: string };
type Asg = { operator_id: string; shift_type_id: string | null; area_code_id: string | null };
type Standby = { operator_id: string; standby_type: string };
type Task = {
  id: string;
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
type ActType = { code: string; label: string; short_label: string; color: string };

const PRESET_COLOR: Record<string, string> = {
  FLUSH: '#0284c7',
  TANK: '#0d9488',
  PULL: '#db2777',
  THERM: '#ea580c',
  LEVEL: '#ca8a04',
};

function addDays(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function toMinutes(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function isShiftNow(s: Shift | undefined, nowMinutes: number) {
  if (!s || s.is_off) return false;
  const start = toMinutes(s.start_time);
  const end = toMinutes(s.end_time);
  if (start === null || end === null) return false;
  if (end > start) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end;
}

export default function MobileView(p: {
  date: string;
  today: string;
  nowMinutes: number;
  role: string;
  operatorId: string | null;
  canClosePm: boolean;
  operators: Op[];
  shifts: Shift[];
  areas: Area[];
  assignments: Asg[];
  standby: Standby[];
  tasks: Task[];
  activityTypes: ActType[];
  error: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'schedule' | 'tasks'>('tasks');
  const [tasks, setTasks] = useState<Task[]>(p.tasks);
  const [taskFilter, setTaskFilter] = useState<'open' | 'done' | 'all'>('open');
  const [selectedOp, setSelectedOp] = useState<string>(p.operatorId ?? '');
  const [remarksDraft, setRemarksDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [msg, setMsg] = useState(p.error);

  useEffect(() => setTasks(p.tasks), [p.tasks]);

  const opBy = useMemo(() => new Map(p.operators.map((o) => [o.id, o])), [p.operators]);
  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);
  const asgBy = useMemo(() => new Map(p.assignments.map((a) => [a.operator_id, a])), [p.assignments]);
  const sbBy = useMemo(() => new Map(p.standby.map((s) => [s.operator_id, s.standby_type])), [p.standby]);
  const actBy = useMemo(() => new Map(p.activityTypes.map((a) => [a.code, a])), [p.activityTypes]);

  const scheduleList = useMemo(() => {
    const items = p.operators.map((op, idx) => {
      const asg = asgBy.get(op.id);
      const shift = asg?.shift_type_id ? shiftBy.get(asg.shift_type_id) : undefined;
      const area = asg?.area_code_id ? areaBy.get(asg.area_code_id) : undefined;
      const standbyType = sbBy.get(op.id);
      const isLeave = area?.category === 'leave';
      const isOnDuty = Boolean(shift && !shift.is_off && !isLeave);
      const isNow = p.date === p.today && isOnDuty && isShiftNow(shift, p.nowMinutes);
      const tier = standbyType ? 0 : isNow ? 1 : isOnDuty ? 2 : 3;
      return { op, idx, shift, area, standbyType, isLeave, isOnDuty, isNow, tier };
    });
    items.sort((a, b) => a.tier - b.tier || a.idx - b.idx);
    return items;
  }, [areaBy, asgBy, p.date, p.nowMinutes, p.operators, p.today, sbBy, shiftBy]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (taskFilter === 'open' && t.status === 'done') return false;
      if (taskFilter === 'done' && t.status !== 'done') return false;
      if (selectedOp && !t.assigned_operator_ids.includes(selectedOp)) return false;
      return true;
    });
  }, [selectedOp, taskFilter, tasks]);

  const openCount = useMemo(
    () => tasks.filter((t) => t.status !== 'done' && (!selectedOp || t.assigned_operator_ids.includes(selectedOp))).length,
    [selectedOp, tasks],
  );

  async function toggleTaskStatus(t: Task, nextStatus: 'done' | 'planned') {
    if (!p.canClosePm) return;
    setBusyId(t.id);
    setMsg('');
    const nextRemarks = remarksDraft[t.id] !== undefined ? remarksDraft[t.id].trim() || null : t.remarks;
    const completedAt = nextStatus === 'done' ? p.today : null;

    const { error } = await supabaseBrowser()
      .from('pm_tasks')
      .update({ status: nextStatus, completed_at: completedAt, remarks: nextRemarks })
      .eq('id', t.id);

    setBusyId('');
    if (error) {
      setMsg(error.message);
      return;
    }
    setTasks((list) =>
      list.map((x) => (x.id === t.id ? { ...x, status: nextStatus, completed_at: completedAt, remarks: nextRemarks } : x)),
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '10px 12px 32px' }}>
      {/* Mobile Tab Switcher */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          padding: 4,
          background: '#e2e8f0',
          borderRadius: 10,
          marginBottom: 12,
        }}
      >
        <button
          onClick={() => setTab('tasks')}
          style={{
            minHeight: 42,
            borderRadius: 8,
            border: 'none',
            fontWeight: 700,
            fontSize: 13.5,
            cursor: 'pointer',
            background: tab === 'tasks' ? '#ffffff' : 'transparent',
            color: tab === 'tasks' ? '#0f172a' : '#475569',
            boxShadow: tab === 'tasks' ? '0 1px 3px rgba(15,23,42,0.1)' : 'none',
          }}
        >
          PM Tasks ({openCount})
        </button>
        <button
          onClick={() => setTab('schedule')}
          style={{
            minHeight: 42,
            borderRadius: 8,
            border: 'none',
            fontWeight: 700,
            fontSize: 13.5,
            cursor: 'pointer',
            background: tab === 'schedule' ? '#ffffff' : 'transparent',
            color: tab === 'schedule' ? '#0f172a' : '#475569',
            boxShadow: tab === 'schedule' ? '0 1px 3px rgba(15,23,42,0.1)' : 'none',
          }}
        >
          Daily Schedule
        </button>
      </div>

      {msg && (
        <div
          role="alert"
          style={{
            marginBottom: 10,
            padding: '10px 12px',
            borderRadius: 8,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            fontSize: 13,
          }}
        >
          {msg}
        </div>
      )}

      {tab === 'schedule' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 10,
              padding: 8,
            }}
          >
            <button className="btn" style={{ minHeight: 38 }} onClick={() => router.push(`/mobile?d=${addDays(p.date, -1)}`)}>
              ‹
            </button>
            <input
              type="date"
              className="input"
              value={p.date}
              onChange={(e) => e.target.value && router.push(`/mobile?d=${e.target.value}`)}
              style={{ flex: 1, minHeight: 38 }}
            />
            <button className="btn" style={{ minHeight: 38 }} onClick={() => router.push(`/mobile?d=${addDays(p.date, 1)}`)}>
              ›
            </button>
            {p.date !== p.today && (
              <button className="btn btn-primary" style={{ minHeight: 38 }} onClick={() => router.push(`/mobile?d=${p.today}`)}>
                Today
              </button>
            )}
          </div>

          {scheduleList.map(({ op, shift, area, standbyType, isLeave, isOnDuty, isNow }) => (
            <div
              key={op.id}
              style={{
                background: standbyType ? '#faf5ff' : '#ffffff',
                border: standbyType ? '1.5px solid #7c3aed' : '1px solid #cbd5e1',
                borderRadius: 10,
                padding: 12,
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>{op.full_name}</div>
                  {op.position && <div style={{ fontSize: 12, color: '#475569' }}>{op.position}</div>}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {standbyType && (
                    <span style={{ background: '#6d28d9', color: '#fff', padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                      STANDBY · {standbyType}
                    </span>
                  )}
                  {isLeave ? (
                    <span style={{ background: '#ffe4e6', color: '#9f1239', padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                      LEAVE · {area?.code}
                    </span>
                  ) : isOnDuty && shift ? (
                    <span
                      style={{
                        background: shift.background_color,
                        color: shift.text_color,
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      {isNow ? 'ON DUTY NOW' : 'DUTY'} · {shift.code}
                    </span>
                  ) : shift?.is_off ? (
                    <span style={{ background: '#f1f5f9', color: '#475569', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                      OFF · {shift.code}
                    </span>
                  ) : (
                    <span style={{ color: '#64748b', fontSize: 11.5 }}>Unassigned</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: '#475569' }}>
                <span>Station: <b>{area?.code ?? (isOnDuty ? 'PW' : op.default_station ?? '—')}</b></span>
                {op.phone_number && (
                  <a
                    href={`tel:${op.phone_number}`}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      background: '#0369a1',
                      color: '#ffffff',
                      textDecoration: 'none',
                      fontWeight: 700,
                      fontSize: 12.5,
                    }}
                  >
                    Call
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'tasks' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {/* Filters */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 10,
              padding: 10,
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              {(['open', 'done', 'all'] as const).map((f) => (
                <button
                  key={f}
                  className="btn"
                  onClick={() => setTaskFilter(f)}
                  style={{
                    flex: 1,
                    minHeight: 38,
                    fontWeight: 700,
                    background: taskFilter === f ? '#0f172a' : '#ffffff',
                    color: taskFilter === f ? '#ffffff' : '#0f172a',
                  }}
                >
                  {f === 'open' ? 'Open' : f === 'done' ? 'Completed' : 'All'}
                </button>
              ))}
            </div>

            <select
              className="input"
              aria-label="Filter by assigned employee"
              value={selectedOp}
              onChange={(e) => setSelectedOp(e.target.value)}
            >
              <option value="">All employees</option>
              {p.operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.full_name}
                  {o.id === p.operatorId ? ' (Me)' : ''}
                </option>
              ))}
            </select>
          </div>

          {!p.canClosePm && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #cbd5e1', fontSize: 12.5, color: '#475569' }}>
              Your role is <b>{p.role}</b> (read-only). Ask an admin to set your role to <b>operator</b> or <b>scheduler</b> to close tasks.
            </div>
          )}

          {filteredTasks.length === 0 ? (
            <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 10, padding: 24, textAlign: 'center', color: '#475569', fontSize: 13.5 }}>
              No PM tasks match the selected filter.
            </div>
          ) : (
            filteredTasks.map((t) => {
              const meta = actBy.get(t.activity_type);
              const color = meta?.color ?? PRESET_COLOR[t.activity_type] ?? '#7c3aed';
              const isDone = t.status === 'done';
              const isOverdue = !isDone && t.scheduled_date < p.today;
              const isToday = t.scheduled_date === p.today;
              const crew = t.assigned_operator_ids.map((id) => opBy.get(id)?.full_name).filter(Boolean);
              const canCloseThis =
                p.canClosePm &&
                (p.role !== 'operator' || !p.operatorId || t.assigned_operator_ids.includes(p.operatorId));

              return (
                <div
                  key={t.id}
                  style={{
                    background: '#ffffff',
                    border: isOverdue ? '1.5px solid #e11d48' : '1px solid #cbd5e1',
                    borderRadius: 12,
                    padding: 14,
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        background: color,
                        color: '#ffffff',
                        padding: '3px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {meta?.label ?? t.title}
                    </span>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: isDone ? '#dcfce7' : isOverdue ? '#ffe4e6' : isToday ? '#dbeafe' : '#f1f5f9',
                        color: isDone ? '#166534' : isOverdue ? '#9f1239' : isToday ? '#1e40af' : '#475569',
                      }}
                    >
                      {isDone ? 'Done' : isOverdue ? `Overdue · ${t.scheduled_date}` : isToday ? 'Today' : t.scheduled_date}
                    </span>
                  </div>

                  {t.locations.length > 0 && (
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{t.locations.join(', ')}</div>
                  )}
                  {t.asset && <div style={{ fontSize: 12.5, color: '#475569' }}>Asset: {t.asset}</div>}
                  <div style={{ fontSize: 12.5, color: '#475569' }}>
                    Assigned: <b>{crew.length ? crew.join(', ') : 'Unassigned'}</b>
                  </div>

                  {canCloseThis && (
                    <>
                      <input
                        className="input"
                        placeholder="Completion notes / remarks…"
                        value={remarksDraft[t.id] ?? t.remarks ?? ''}
                        onChange={(e) => setRemarksDraft((r) => ({ ...r, [t.id]: e.target.value }))}
                        disabled={busyId === t.id}
                      />
                      <button
                        className="btn"
                        disabled={busyId === t.id}
                        onClick={() => toggleTaskStatus(t, isDone ? 'planned' : 'done')}
                        style={{
                          minHeight: 44,
                          fontSize: 14,
                          fontWeight: 700,
                          background: isDone ? '#f1f5f9' : '#0f766e',
                          borderColor: isDone ? '#cbd5e1' : '#0f766e',
                          color: isDone ? '#0f172a' : '#ffffff',
                        }}
                      >
                        {busyId === t.id ? 'Updating…' : isDone ? 'Reopen Task' : '✓ Mark Task Done'}
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
