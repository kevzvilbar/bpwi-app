'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { subscribeVisibilityAwareChannel } from '@/lib/supabase/realtime';
import type { LinkedPmTask } from '@/components/ActivityLoggerModal';
import MobileActivitiesAndSchedule, {
  type MobileArea,
  type MobileOp,
  type MobileShift,
} from '@/components/MobileActivitiesAndSchedule';
import { ACTIVITY_BY_ID, type DailyActivityRow } from '@/lib/activity-types';
import { enqueueOfflineActivity, flushOfflineQueue, getOfflineQueue, type PendingOfflineActivity } from '@/lib/offline-queue';
import {
  buildPmActualPerformerIds,
  classifyPmCompletionRoles,
  isMissingCompletedByColumnError,
} from '@/lib/pm-credit';
import { AlertBanner, Badge, SegmentedTabs } from '@/components/ui';

const ActivityLoggerModal = dynamic(() => import('@/components/ActivityLoggerModal'), { ssr: false });
const PmCompleteModal = dynamic(() => import('@/components/PmCompleteModal'), { ssr: false });

type Op = MobileOp;
type Shift = MobileShift;
type Area = MobileArea;
type Asg = { operator_id: string; shift_type_id: string | null; area_code_id: string | null };
type Standby = { operator_id: string; standby_type: string };
type Task = {
  id: string;
  activity_type: string;
  title: string;
  locations: string[];
  asset: string | null;
  assigned_operator_ids: string[];
  completed_by_operator_ids?: string[];
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
  GENSET: '#b45309',
};

function toMinutes(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function isShiftNow(todayShift: Shift | undefined, prevShift: Shift | undefined, prevIsLeave: boolean, nowMinutes: number) {
  if (todayShift && !todayShift.is_off) {
    const start = toMinutes(todayShift.start_time);
    const end = toMinutes(todayShift.end_time);
    if (start !== null && end !== null) {
      if (end > start && nowMinutes >= start && nowMinutes < end) return true;
      if (end <= start && nowMinutes >= start) return true;
    }
  }
  if (prevShift && !prevShift.is_off && !prevIsLeave) {
    const start = toMinutes(prevShift.start_time);
    const end = toMinutes(prevShift.end_time);
    if (start !== null && end !== null && end <= start && nowMinutes < end) return true;
  }
  return false;
}

function manilaClockMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

export default function MobileView(p: {
  date: string;
  today: string;
  nowMinutes: number;
  orgId?: string;
  userId?: string;
  role: string;
  operatorId: string | null;
  canClosePm: boolean;
  canLogActivity?: boolean;
  canVerifyActivity?: boolean;
  operators: Op[];
  shifts: Shift[];
  areas: Area[];
  assignments: Asg[];
  yesterdayAssignments: Asg[];
  standby: Standby[];
  tasks: Task[];
  activityTypes: ActType[];
  initialActivities?: DailyActivityRow[];
  error: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'tasks' | 'activities' | 'schedule'>('tasks');
  const [tasks, setTasks] = useState<Task[]>(p.tasks);
  const [activities, setActivities] = useState<DailyActivityRow[]>(p.initialActivities ?? []);
  const [offlineQueue, setOfflineQueue] = useState<PendingOfflineActivity[]>([]);
  const [loggerOpen, setLoggerOpen] = useState(false);
  const [linkedPmForLog, setLinkedPmForLog] = useState<LinkedPmTask | null>(null);
  const [editingActivity, setEditingActivity] = useState<DailyActivityRow | null>(null);
  const [taskFilter, setTaskFilter] = useState<'open' | 'done' | 'all'>('open');
  const [selectedOp, setSelectedOp] = useState<string>(p.operatorId ?? '');
  const [search, setSearch] = useState('');
  const [remarksDraft, setRemarksDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [msg, setMsg] = useState(p.error);
  const [nowMinutes, setNowMinutes] = useState(p.nowMinutes);
  const [undoToast, setUndoToast] = useState<{
    task: Task;
    prevStatus: Task['status'];
    prevCompletedAt: string | null;
    prevCompletedByIds: string[];
    prevRemarks: string | null;
  } | null>(null);
  const [completeModal, setCompleteModal] = useState<{ task: Task; mode: 'complete' | 'edit' } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setTasks(p.tasks), [p.tasks]);
  useEffect(() => setActivities(p.initialActivities ?? []), [p.initialActivities]);
  useEffect(() => {
    const sb = supabaseBrowser();
    return subscribeVisibilityAwareChannel({
      sb,
      channelName: 'pm-mobile-tasks',
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
              return exists
                ? prev.map((x) => (x.id === nextTask.id ? nextTask : x))
                : [...prev, nextTask].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
            });
          },
        },
        {
          table: 'daily_activities',
          onEvent: (payload) => {
            const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as unknown as DailyActivityRow;
            if (!rec?.id) return;
            if (payload.eventType === 'DELETE') {
              setActivities((prev) => prev.filter((x) => x.id !== rec.id));
              return;
            }
            if (rec.activity_date !== p.date) return;
            setActivities((prev) => {
              const exists = prev.some((x) => x.id === rec.id);
              return exists ? prev.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...prev];
            });
          },
        },
      ],
    });
  }, [p.date]);
  useEffect(() => {
    setNowMinutes(manilaClockMinutes());
    const id = setInterval(() => setNowMinutes(manilaClockMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    const syncPending = async () => {
      const q = await getOfflineQueue(p.userId);
      if (!active) return;
      setOfflineQueue(q);
      if (q.length > 0 && navigator.onLine) {
        const res = await flushOfflineQueue(supabaseBrowser(), p.userId);
        if (!active) return;
        if (res.synced.length > 0) {
          const todaySynced = res.synced.filter((a) => a.activity_date === p.date);
          if (todaySynced.length > 0) {
            setActivities((prev) => [...todaySynced, ...prev]);
          }
        }
        setOfflineQueue(await getOfflineQueue(p.userId));
      }
    };
    const onQueueChanged = async () => {
      const q = await getOfflineQueue(p.userId);
      if (active) setOfflineQueue(q);
    };
    void syncPending();
    window.addEventListener('online', syncPending);
    window.addEventListener('bpwi-offline-queue-changed', onQueueChanged);
    return () => {
      active = false;
      window.removeEventListener('online', syncPending);
      window.removeEventListener('bpwi-offline-queue-changed', onQueueChanged);
    };
  }, [p.date, p.userId]);

  const opBy = useMemo(() => new Map(p.operators.map((o) => [o.id, o])), [p.operators]);
  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);
  const asgBy = useMemo(() => new Map(p.assignments.map((a) => [a.operator_id, a])), [p.assignments]);
  const prevAsgBy = useMemo(() => new Map(p.yesterdayAssignments.map((a) => [a.operator_id, a])), [p.yesterdayAssignments]);
  const sbBy = useMemo(() => new Map(p.standby.map((s) => [s.operator_id, s.standby_type])), [p.standby]);
  const actBy = useMemo(() => new Map(p.activityTypes.map((a) => [a.code, a])), [p.activityTypes]);

  const scheduleList = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = p.operators
      .filter(
        (op) =>
          !q ||
          op.full_name.toLowerCase().includes(q) ||
          (op.position ?? '').toLowerCase().includes(q) ||
          (op.default_station ?? '').toLowerCase().includes(q),
      )
      .map((op, idx) => {
        const asg = asgBy.get(op.id);
        const shift = asg?.shift_type_id ? shiftBy.get(asg.shift_type_id) : undefined;
        const area = asg?.area_code_id ? areaBy.get(asg.area_code_id) : undefined;
        const prevAsg = prevAsgBy.get(op.id);
        const prevShift = prevAsg?.shift_type_id ? shiftBy.get(prevAsg.shift_type_id) : undefined;
        const prevArea = prevAsg?.area_code_id ? areaBy.get(prevAsg.area_code_id) : undefined;
        const standbyType = sbBy.get(op.id);
        const isRestDay = Boolean(area && (area.category === 'rest' || area.code.toUpperCase() === 'RD'));
        const isLeave = Boolean(area && area.category === 'leave' && area.code.toUpperCase() !== 'RD');
        const prevRestOrLeave = Boolean(
          prevArea && (prevArea.category === 'leave' || prevArea.category === 'rest' || prevArea.code.toUpperCase() === 'RD'),
        );
        const isOnDuty = Boolean(shift && !shift.is_off && !isLeave && !isRestDay);
        const isNow = p.date === p.today && isShiftNow(isLeave || isRestDay ? undefined : shift, prevShift, prevRestOrLeave, nowMinutes);
        const tier = standbyType ? 0 : isNow ? 1 : isOnDuty ? 2 : 3;
        return { op, idx, shift, area, standbyType, isLeave, isRestDay, isOnDuty, isNow, tier };
      });
    items.sort((a, b) => a.tier - b.tier || a.idx - b.idx);
    return items;
  }, [areaBy, asgBy, nowMinutes, p.date, p.operators, p.today, prevAsgBy, sbBy, search, shiftBy]);

  const scopedTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (
        selectedOp &&
        !t.assigned_operator_ids.includes(selectedOp) &&
        !(t.completed_by_operator_ids ?? []).includes(selectedOp)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.locations.some((l) => l.toLowerCase().includes(q)) ||
        (t.asset ?? '').toLowerCase().includes(q) ||
        (t.remarks ?? '').toLowerCase().includes(q)
      );
    });
  }, [search, selectedOp, tasks]);

  const delayedTasks = useMemo(
    () => scopedTasks.filter((t) => t.status !== 'done' && t.scheduled_date < p.today),
    [p.today, scopedTasks],
  );
  const upcomingTasks = useMemo(
    () => scopedTasks.filter((t) => t.status !== 'done' && t.scheduled_date >= p.today),
    [p.today, scopedTasks],
  );
  const completedTasks = useMemo(
    () => scopedTasks.filter((t) => t.status === 'done').sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)),
    [scopedTasks],
  );
  const dueTodayCount = useMemo(
    () => upcomingTasks.filter((t) => t.scheduled_date === p.today).length,
    [p.today, upcomingTasks],
  );

  const mobileFilteredTasks = useMemo(() => {
    if (taskFilter === 'open') return [...delayedTasks, ...upcomingTasks];
    if (taskFilter === 'done') return completedTasks;
    return scopedTasks;
  }, [completedTasks, delayedTasks, scopedTasks, taskFilter, upcomingTasks]);

  const scopedActivities = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activities.filter((a) => {
      if (!p.canVerifyActivity) {
        const isMine =
          (p.userId && a.logged_by === p.userId) ||
          (p.operatorId && (a.lead_operator_id === p.operatorId || (a.crew_operator_ids ?? []).includes(p.operatorId)));
        if (!isMine) return false;
      } else if (selectedOp) {
        const involved = a.lead_operator_id === selectedOp || (a.crew_operator_ids ?? []).includes(selectedOp);
        if (!involved) return false;
      }
      if (!q) return true;
      const metaLabel = (ACTIVITY_BY_ID[a.activity_type]?.label ?? a.activity_type).toLowerCase();
      const areaLabel = (a.area_code_id ? areaBy.get(a.area_code_id)?.code ?? '' : '').toLowerCase();
      return (
        metaLabel.includes(q) ||
        areaLabel.includes(q) ||
        (a.site_or_well ?? '').toLowerCase().includes(q) ||
        (a.block_lot ?? '').toLowerCase().includes(q) ||
        (a.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [activities, areaBy, search, selectedOp, p.canVerifyActivity, p.userId, p.operatorId]);

  async function toggleTaskStatus(
    t: Task,
    nextStatus: Task['status'],
    opts?: {
      completedAt?: string | null;
      completedByIds?: string[];
      remarks?: string | null;
      showUndo?: boolean;
    },
  ) {
    if (!p.canClosePm) return;
    setBusyId(t.id);
    setMsg('');
    const prevStatus = t.status;
    const prevCompletedAt = t.completed_at;
    const prevCompletedByIds = t.completed_by_operator_ids ?? [];
    const prevRemarks = t.remarks;
    const nextRemarks =
      opts?.remarks !== undefined
        ? opts.remarks
        : remarksDraft[t.id] !== undefined
          ? remarksDraft[t.id].trim() || null
          : t.remarks;
    const completedAt = opts?.completedAt !== undefined ? opts.completedAt : nextStatus === 'done' ? p.today : null;
    const nextCompletedByIds =
      nextStatus === 'done'
        ? (opts?.completedByIds ?? t.completed_by_operator_ids ?? [])
        : (opts?.completedByIds ?? []);

    const basePayload = { status: nextStatus, completed_at: completedAt, remarks: nextRemarks };
    const sb = supabaseBrowser();
    let { error } = await sb
      .from('pm_tasks')
      .update({ ...basePayload, completed_by_operator_ids: nextCompletedByIds })
      .eq('id', t.id);

    if (error && isMissingCompletedByColumnError(error)) {
      ({ error } = await sb.from('pm_tasks').update(basePayload).eq('id', t.id));
    }

    setBusyId('');
    if (error) {
      setMsg(error.message);
      return;
    }
    setCompleteModal(null);
    const updatedTask: Task = {
      ...t,
      status: nextStatus,
      completed_at: completedAt,
      completed_by_operator_ids: nextCompletedByIds,
      remarks: nextRemarks,
    };
    setTasks((list) => list.map((x) => (x.id === t.id ? updatedTask : x)));

    if (nextStatus === 'done' && opts?.showUndo !== false && p.role !== 'operator') {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoToast({ task: updatedTask, prevStatus, prevCompletedAt, prevCompletedByIds, prevRemarks });
      undoTimerRef.current = setTimeout(() => setUndoToast(null), 6000);
    } else if (opts?.showUndo === false) {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoToast(null);
    }
  }

  function renderTaskCard(t: Task) {
    const meta = actBy.get(t.activity_type);
    const color = meta?.color ?? PRESET_COLOR[t.activity_type] ?? '#7c3aed';
    const isDone = t.status === 'done';
    const isOverdue = !isDone && t.scheduled_date < p.today;
    const isToday = t.scheduled_date === p.today;
    const crew = t.assigned_operator_ids.map((id) => opBy.get(id)?.full_name).filter(Boolean);
    const roles = classifyPmCompletionRoles(t);
    const canCloseThis = p.canClosePm && (p.role !== 'operator' || Boolean(p.operatorId));
    const canModifyTask = canCloseThis && !(p.role === 'operator' && isDone);

    return (
      <div
        key={t.id}
        className="card"
        style={{
          padding: 12,
          display: 'grid',
          gap: 8,
          border: isOverdue ? '1.5px solid var(--danger)' : '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              background: color,
              color: '#ffffff',
              padding: '3px 10px',
              borderRadius: 999,
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            {meta?.label ?? t.title}
          </span>
          <Badge tone={isDone ? 'ok' : isOverdue ? 'danger' : isToday ? 'info' : 'neutral'} size="sm">
            {isDone ? `Done${t.completed_at ? ` · ${t.completed_at}` : ''}` : isOverdue ? `Delayed · ${t.scheduled_date}` : isToday ? 'Today' : t.scheduled_date}
          </Badge>
        </div>

        {t.locations.length > 0 && <div style={{ fontSize: 14, fontWeight: 700 }}>{t.locations.join(', ')}</div>}
        {t.asset && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Asset: {t.asset}</div>}
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
          {isDone ? 'Planned: ' : 'Assigned: '}
          <b>{crew.length ? crew.join(', ') : 'Unassigned'}</b>
        </div>
        {isDone && (
          <div style={{ fontSize: 12.5, display: 'grid', gap: 2 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Performed by:</span>
              {roles.creditedIds.length === 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>Not recorded</span>
              ) : (
                roles.creditedIds.map((id) => {
                  const name = opBy.get(id)?.full_name ?? 'Unknown';
                  const isSub = roles.substituteIds.includes(id);
                  return (
                    <span
                      key={id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: '1px 7px',
                        borderRadius: 999,
                        fontSize: 11.5,
                        fontWeight: 700,
                        background: isSub ? 'var(--warn-bg)' : 'var(--ok-bg)',
                        color: isSub ? 'var(--warn-fg)' : 'var(--ok-fg)',
                      }}
                    >
                      {name}
                      {isSub ? ' · Sub' : ''}
                    </span>
                  );
                })
              )}
            </div>
            {roles.absentPlannedIds.length > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Planned not participating: {roles.absentPlannedIds.map((id) => opBy.get(id)?.full_name ?? id).join(', ')}
              </div>
            )}
          </div>
        )}

        {canModifyTask ? (
          <>
            <input
              className="input"
              placeholder="Completion notes / remarks…"
              value={remarksDraft[t.id] ?? t.remarks ?? ''}
              onChange={(e) => setRemarksDraft((r) => ({ ...r, [t.id]: e.target.value }))}
              disabled={busyId === t.id}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {p.canLogActivity && !isDone && (
                <button
                  type="button"
                  className="btn"
                  disabled={busyId === t.id}
                  onClick={() => {
                    setLinkedPmForLog(t);
                    setLoggerOpen(true);
                  }}
                  style={{
                    flex: 1,
                    minHeight: 42,
                    fontSize: 13,
                    fontWeight: 700,
                    background: 'var(--primary)',
                    borderColor: 'var(--primary)',
                    color: 'var(--primary-fg)',
                  }}
                >
                  📋 Log &amp; Complete
                </button>
              )}
              {isDone && (
                <button
                  type="button"
                  className="btn"
                  disabled={busyId === t.id}
                  onClick={() => setCompleteModal({ task: t, mode: 'edit' })}
                  style={{ flex: 1, minHeight: 42, fontSize: 13, fontWeight: 700 }}
                >
                  Edit Crew
                </button>
              )}
              <button
                className="btn"
                disabled={busyId === t.id}
                onClick={() =>
                  isDone
                    ? void toggleTaskStatus(t, 'planned', { completedByIds: [] })
                    : setCompleteModal({ task: t, mode: 'complete' })
                }
                style={{
                  flex: 1,
                  minHeight: 42,
                  fontSize: 13,
                  fontWeight: 700,
                  background: isDone ? 'var(--surface-muted)' : '#0f766e',
                  borderColor: isDone ? 'var(--border)' : '#0f766e',
                  color: isDone ? 'var(--text)' : '#ffffff',
                }}
              >
                {busyId === t.id ? 'Updating…' : isDone ? 'Reopen Task' : '✓ Quick Done'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: 'grid', gap: 4 }}>
            {t.remarks && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Notes: {t.remarks}</div>}
            {p.role === 'operator' && isDone && (
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Completed · ask a supervisor to reopen or edit crew.
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tasks-shell">
      <h1 className="sr-only">Tasks, Field Logs and Schedule</h1>
      {/* Top Toolbar */}
      <div
        className="card"
        style={{
          padding: 10,
          marginBottom: 12,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <SegmentedTabs
          ariaLabel="Tasks and field views"
          fullWidth
          value={tab}
          onChange={setTab}
          items={[
            { id: 'tasks', label: `PM (${delayedTasks.length + upcomingTasks.length})` },
            { id: 'activities', label: `Logs (${scopedActivities.length})` },
            { id: 'schedule', label: 'Schedule' },
          ]}
        />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 260px', justifyContent: 'flex-end' }}>
          <input
            type="search"
            className="input"
            aria-label="Search tasks, logs, or operators"
            placeholder="Search site, activity, operator…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 160px', minWidth: 0 }}
          />
          {(tab === 'tasks' || (tab === 'activities' && p.canVerifyActivity)) && (
            <select
              className="input"
              aria-label="Filter by employee"
              value={selectedOp}
              onChange={(e) => setSelectedOp(e.target.value)}
              style={{ flex: '1 1 140px', minWidth: 0 }}
            >
              <option value="">{tab === 'tasks' ? 'All employees (incl. substitute coverage)' : 'All employees'}</option>
              {p.operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.full_name}
                  {o.id === p.operatorId ? ' (Me)' : ''}
                </option>
              ))}
            </select>
          )}
          {p.canLogActivity && p.orgId && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setLinkedPmForLog(null);
                setLoggerOpen(true);
              }}
              style={{ whiteSpace: 'nowrap', fontWeight: 700 }}
            >
              + Log Activity
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div style={{ marginBottom: 10 }}>
          <AlertBanner tone="danger">{msg}</AlertBanner>
        </div>
      )}

      {offlineQueue.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <AlertBanner
            tone="warn"
            action={
              <button
                type="button"
                className="btn"
                style={{ minHeight: 32, padding: '4px 10px', fontSize: 12 }}
                onClick={async () => {
                  const res = await flushOfflineQueue(supabaseBrowser(), p.userId);
                  setOfflineQueue(await getOfflineQueue(p.userId));
                  if (res.synced.length > 0) {
                    const todaySynced = res.synced.filter((a) => a.activity_date === p.date);
                    setActivities((prev) => [...todaySynced, ...prev]);
                  }
                }}
              >
                Sync Now
              </button>
            }
          >
            <b>{offlineQueue.length}</b> activity log{offlineQueue.length === 1 ? '' : 's'} queued offline.
          </AlertBanner>
        </div>
      )}

      {tab === 'tasks' && (
        <>
          {/* KPI Summary Chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, fontSize: 12.5, fontWeight: 700 }}>
            <span style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)', padding: '4px 10px', borderRadius: 999 }}>
              Delayed: {delayedTasks.length}
            </span>
            <span style={{ background: 'var(--info-bg)', color: 'var(--info-fg)', padding: '4px 10px', borderRadius: 999 }}>
              Due Today: {dueTodayCount}
            </span>
            <span style={{ background: 'var(--info-bg)', color: 'var(--info-fg)', padding: '4px 10px', borderRadius: 999 }}>
              Upcoming: {upcomingTasks.length}
            </span>
            <span style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)', padding: '4px 10px', borderRadius: 999 }}>
              Completed: {completedTasks.length}
            </span>
          </div>

          {!p.canClosePm && (
            <div className="card" style={{ padding: '8px 12px', marginBottom: 12, fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {p.role === 'manager' ? (
                <>Department heads can close tasks only while an admin has opened an edit window for them.</>
              ) : (
                <>Your role is <b>{p.role}</b> (read-only). Ask an admin to set your role to <b>operator</b> or <b>scheduler</b> to close tasks.</>
              )}
            </div>
          )}
          {p.role === 'operator' && !p.operatorId && (
            <div className="card" style={{ padding: '8px 12px', marginBottom: 12, fontSize: 12.5, color: 'var(--warn-fg)', background: 'var(--warn-bg)', borderColor: 'var(--warn-border)' }}>
              Your user account is not linked to an operator profile yet. Ask an admin to link your account under Operators &amp; Setup to close PM tasks.
            </div>
          )}

          {/* Desktop 3-Column Kanban Board (> 1024px) */}
          <div className="kanban-board desktop-only-kanban">
            <section className="kanban-col" aria-label="Delayed tasks">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px' }}>
                <strong style={{ fontSize: 14, color: 'var(--danger)' }}>Delayed / Overdue</strong>
                <span style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
                  {delayedTasks.length}
                </span>
              </div>
              {delayedTasks.length === 0 ? (
                <div className="card" style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                  No delayed tasks.
                </div>
              ) : (
                delayedTasks.map(renderTaskCard)
              )}
            </section>

            <section className="kanban-col" aria-label="Upcoming tasks">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px' }}>
                <strong style={{ fontSize: 14, color: 'var(--accent)' }}>Today &amp; Upcoming</strong>
                <span style={{ background: 'var(--info-bg)', color: 'var(--info-fg)', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
                  {upcomingTasks.length}
                </span>
              </div>
              {upcomingTasks.length === 0 ? (
                <div className="card" style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                  No upcoming tasks.
                </div>
              ) : (
                upcomingTasks.map(renderTaskCard)
              )}
            </section>

            <section className="kanban-col" aria-label="Completed tasks">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px' }}>
                <strong style={{ fontSize: 14, color: 'var(--ok-fg)' }}>Completed</strong>
                <span style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
                  {completedTasks.length}
                </span>
              </div>
              {completedTasks.length === 0 ? (
                <div className="card" style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                  No completed tasks in this window.
                </div>
              ) : (
                completedTasks.map(renderTaskCard)
              )}
            </section>
          </div>

          {/* Mobile Single-Column Task List (<= 1024px) */}
          <div className="mobile-only-block">
            <div style={{ display: 'flex', gap: 6 }}>
              {(['open', 'done', 'all'] as const).map((f) => (
                <button
                  key={f}
                  className="btn"
                  onClick={() => setTaskFilter(f)}
                  style={{
                    flex: 1,
                    fontWeight: 700,
                    background: taskFilter === f ? 'var(--primary)' : 'var(--surface)',
                    color: taskFilter === f ? 'var(--primary-fg)' : 'var(--text)',
                  }}
                >
                  {f === 'open' ? 'Open' : f === 'done' ? 'Completed' : 'All'}
                </button>
              ))}
            </div>

            {mobileFilteredTasks.length === 0 ? (
              <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13.5 }}>
                No PM tasks match the selected filter.
              </div>
            ) : (
              mobileFilteredTasks.map(renderTaskCard)
            )}
          </div>
        </>
      )}

      {(tab === 'activities' || tab === 'schedule') && (
        <MobileActivitiesAndSchedule
          tab={tab}
          date={p.date}
          today={p.today}
          role={p.role}
          userId={p.userId}
          canLogActivity={p.canLogActivity}
          scopedActivities={scopedActivities}
          scheduleList={scheduleList}
          opBy={opBy}
          areaBy={areaBy}
          onEditActivity={(act) => {
            setLinkedPmForLog(null);
            setEditingActivity(act);
            setLoggerOpen(true);
          }}
          onActivityDeleted={(actId) => setActivities((prev) => prev.filter((x) => x.id !== actId))}
          onNavigateDate={(nextDate) => router.push(`/mobile?d=${nextDate}`)}
          onError={setMsg}
        />
      )}

      {undoToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 'max(72px, calc(16px + env(safe-area-inset-bottom)))',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            background: 'var(--header-bg)',
            color: 'var(--header-fg)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '10px 14px',
            boxShadow: '0 10px 28px rgba(0, 0, 0, 0.28)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            maxWidth: 'calc(100vw - 24px)',
            fontSize: 13,
          }}
        >
          <span>
            <b>{undoToast.task.title}</b> marked done
          </span>
          <button
            type="button"
            className="btn"
            style={{ minHeight: 32, padding: '4px 10px', fontSize: 12.5, fontWeight: 700 }}
            onClick={() =>
              void toggleTaskStatus(undoToast.task, undoToast.prevStatus, {
                completedAt: undoToast.prevCompletedAt,
                completedByIds: undoToast.prevCompletedByIds,
                remarks: undoToast.prevRemarks,
                showUndo: false,
              })
            }
          >
            Undo
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setUndoToast(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 15,
              lineHeight: 1,
              padding: '2px 4px',
            }}
          >
            ✕
          </button>
        </div>
      )}
      {p.canLogActivity && p.orgId && loggerOpen && (
        <ActivityLoggerModal
          open={loggerOpen}
          onClose={() => {
            setLoggerOpen(false);
            setLinkedPmForLog(null);
            setEditingActivity(null);
          }}
          onQueuedOffline={async (payload) => {
            await enqueueOfflineActivity(payload, p.userId);
            setOfflineQueue(await getOfflineQueue(p.userId));
          }}
          onSaved={(act, opts) => {
            if (!opts?.offline) {
              setActivities((prev) =>
                prev.some((x) => x.id === act.id)
                  ? prev.map((x) => (x.id === act.id ? act : x))
                  : [act, ...prev],
              );
            }
            if (linkedPmForLog) {
              const performedByIds =
                opts?.completedByIds ??
                buildPmActualPerformerIds(act.lead_operator_id, act.crew_operator_ids);
              setTasks((prev) =>
                prev.map((x) =>
                  x.id === linkedPmForLog.id
                    ? {
                        ...x,
                        status: 'done',
                        completed_at: p.date,
                        completed_by_operator_ids: performedByIds,
                        remarks: act.notes || x.remarks,
                      }
                    : x,
                ),
              );
            }
          }}
          orgId={p.orgId}
          userId={p.userId ?? ''}
          role={p.role}
          operatorId={p.operatorId}
          date={p.date}
          operators={p.operators}
          areas={p.areas}
          shifts={p.shifts}
          assignments={p.assignments}
          linkedPmTask={linkedPmForLog}
          pmActivityTypes={p.activityTypes}
          editingActivity={editingActivity}
        />
      )}
      <PmCompleteModal
        open={Boolean(completeModal)}
        mode={completeModal?.mode ?? 'complete'}
        task={completeModal?.task ?? null}
        operators={p.operators}
        currentOperatorId={p.operatorId}
        requireCurrentOperator={p.role === 'operator'}
        initialRemarks={completeModal ? (remarksDraft[completeModal.task.id] ?? completeModal.task.remarks ?? '') : ''}
        busy={Boolean(completeModal && busyId === completeModal.task.id)}
        onCancel={() => setCompleteModal(null)}
        onConfirm={async ({ completedByIds, remarks }) => {
          if (!completeModal) return;
          const target = completeModal.task;
          await toggleTaskStatus(target, 'done', {
            completedAt: target.status === 'done' ? (target.completed_at ?? p.today) : p.today,
            completedByIds,
            remarks,
            showUndo: p.role !== 'operator' && completeModal.mode === 'complete',
          });
        }}
      />
    </div>
  );
}
