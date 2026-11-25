'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { subscribeVisibilityAwareChannel } from '@/lib/supabase/realtime';
import type { LinkedPmTask } from '@/components/ActivityLoggerModal';
import MobileActivitiesAndSchedule, { type MobileArea, type MobileOp, type MobileShift } from '@/components/MobileActivitiesAndSchedule';
import MobileTaskCard, { type MobileActType, type MobileTask } from '@/components/MobileTaskCard';
import { ACTIVITY_BY_ID, type DailyActivityRow } from '@/lib/activity-types';
import { enqueueOfflineActivity, flushOfflineQueue, getOfflineQueue, type PendingOfflineActivity } from '@/lib/offline-queue';
import { buildPmActualPerformerIds, isMissingCompletedByColumnError } from '@/lib/pm-credit';
import { AlertBanner, Badge, SegmentedTabs } from '@/components/ui';

const ActivityLoggerModal = dynamic(() => import('@/components/ActivityLoggerModal'), { ssr: false });
const PmCompleteModal = dynamic(() => import('@/components/PmCompleteModal'), { ssr: false });

type Asg = { operator_id: string; shift_type_id: string | null; area_code_id: string | null };
type Standby = { operator_id: string; standby_type: string };

function toMinutes(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function isShiftNow(todayShift: MobileShift | undefined, prevShift: MobileShift | undefined, prevIsLeave: boolean, nowMinutes: number) {
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
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

function toMobileTask(rec: Partial<MobileTask> & { id: string }): MobileTask {
  return {
    id: rec.id,
    activity_type: rec.activity_type ?? 'FLUSH',
    title: rec.title ?? '',
    locations: rec.locations ?? [],
    asset: rec.asset ?? null,
    assigned_operator_ids: rec.assigned_operator_ids ?? [],
    completed_by_operator_ids: rec.completed_by_operator_ids ?? [],
    scheduled_date: rec.scheduled_date ?? '',
    status: (rec.status as MobileTask['status']) ?? 'planned',
    completed_at: rec.completed_at ?? null,
    remarks: rec.remarks ?? null,
  };
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
  canLogSampleActivity?: boolean;
  canVerifyActivity?: boolean;
  operators: MobileOp[];
  shifts: MobileShift[];
  areas: MobileArea[];
  assignments: Asg[];
  yesterdayAssignments: Asg[];
  standby: Standby[];
  tasks: MobileTask[];
  activityTypes: MobileActType[];
  initialActivities?: DailyActivityRow[];
  error: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'tasks' | 'activities' | 'schedule'>('tasks');
  const [tasks, setTasks] = useState<MobileTask[]>(p.tasks);
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
    task: MobileTask;
    prevStatus: MobileTask['status'];
    prevCompletedAt: string | null;
    prevCompletedByIds: string[];
    prevRemarks: string | null;
  } | null>(null);
  const [completeModal, setCompleteModal] = useState<{ task: MobileTask; mode: 'complete' | 'edit' } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setTasks(p.tasks), [p.tasks]);
  useEffect(() => setActivities(p.initialActivities ?? []), [p.initialActivities]);

  useEffect(() => {
    return subscribeVisibilityAwareChannel({
      sb: supabaseBrowser(),
      channelName: 'pm-mobile-tasks',
      listeners: [
        {
          table: 'pm_tasks',
          onEvent: (payload) => {
            const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Partial<MobileTask> & { id?: string };
            if (!rec?.id) return;
            if (payload.eventType === 'DELETE') {
              setTasks((prev) => prev.filter((x) => x.id !== rec.id));
              return;
            }
            const nextTask = toMobileTask(rec as Partial<MobileTask> & { id: string });
            setTasks((prev) =>
              prev.some((x) => x.id === nextTask.id)
                ? prev.map((x) => (x.id === nextTask.id ? nextTask : x))
                : [...prev, nextTask].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)),
            );
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
            setActivities((prev) => (prev.some((x) => x.id === rec.id) ? prev.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...prev]));
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

  useEffect(() => () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }, []);

  const flushPendingQueue = useCallback(async () => {
    const res = await flushOfflineQueue(supabaseBrowser(), p.userId);
    setOfflineQueue(await getOfflineQueue(p.userId));
    if (res.synced.length > 0) {
      const todaySynced = res.synced.filter((a) => a.activity_date === p.date);
      if (todaySynced.length > 0) setActivities((prev) => [...todaySynced, ...prev]);
    }
  }, [p.date, p.userId]);

  useEffect(() => {
    let active = true;
    const syncPending = async () => {
      const q = await getOfflineQueue(p.userId);
      if (!active) return;
      setOfflineQueue(q);
      if (q.length > 0 && navigator.onLine) await flushPendingQueue();
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
  }, [p.userId, flushPendingQueue]);

  const opBy = useMemo(() => new Map(p.operators.map((o) => [o.id, o])), [p.operators]);
  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);
  const asgBy = useMemo(() => new Map(p.assignments.map((a) => [a.operator_id, a])), [p.assignments]);
  const prevAsgBy = useMemo(() => new Map(p.yesterdayAssignments.map((a) => [a.operator_id, a])), [p.yesterdayAssignments]);
  const sbBy = useMemo(() => new Map(p.standby.map((s) => [s.operator_id, s.standby_type])), [p.standby]);
  const actBy = useMemo(() => new Map(p.activityTypes.map((a) => [a.code, a])), [p.activityTypes]);

  const scheduleList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return p.operators
      .filter((op) => !q || op.full_name.toLowerCase().includes(q) || (op.position ?? '').toLowerCase().includes(q) || (op.default_station ?? '').toLowerCase().includes(q))
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
        const prevRestOrLeave = Boolean(prevArea && (prevArea.category === 'leave' || prevArea.category === 'rest' || prevArea.code.toUpperCase() === 'RD'));
        const isOnDuty = Boolean(shift && !shift.is_off && !isLeave && !isRestDay);
        const isNow = p.date === p.today && isShiftNow(isLeave || isRestDay ? undefined : shift, prevShift, prevRestOrLeave, nowMinutes);
        const tier = standbyType ? 0 : isNow ? 1 : isOnDuty ? 2 : 3;
        return { op, idx, shift, area, standbyType, isLeave, isRestDay, isOnDuty, isNow, tier };
      })
      .sort((a, b) => a.tier - b.tier || a.idx - b.idx);
  }, [areaBy, asgBy, nowMinutes, p.date, p.operators, p.today, prevAsgBy, sbBy, search, shiftBy]);

  const scopedTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (selectedOp && !t.assigned_operator_ids.includes(selectedOp) && !(t.completed_by_operator_ids ?? []).includes(selectedOp)) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.locations.some((l) => l.toLowerCase().includes(q)) ||
        (t.asset ?? '').toLowerCase().includes(q) ||
        (t.remarks ?? '').toLowerCase().includes(q)
      );
    });
  }, [search, selectedOp, tasks]);

  const delayedTasks = useMemo(() => scopedTasks.filter((t) => t.status !== 'done' && t.scheduled_date < p.today), [p.today, scopedTasks]);
  const upcomingTasks = useMemo(() => scopedTasks.filter((t) => t.status !== 'done' && t.scheduled_date >= p.today), [p.today, scopedTasks]);
  const completedTasks = useMemo(() => scopedTasks.filter((t) => t.status === 'done').sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)), [scopedTasks]);
  const dueTodayCount = useMemo(() => upcomingTasks.filter((t) => t.scheduled_date === p.today).length, [p.today, upcomingTasks]);

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
        if (a.lead_operator_id !== selectedOp && !(a.crew_operator_ids ?? []).includes(selectedOp)) return false;
      }
      if (!q) return true;
      const metaLabel = (ACTIVITY_BY_ID[a.activity_type]?.label ?? a.activity_type).toLowerCase();
      const areaLabel = (a.area_code_id ? areaBy.get(a.area_code_id)?.code ?? '' : '').toLowerCase();
      return metaLabel.includes(q) || areaLabel.includes(q) || (a.site_or_well ?? '').toLowerCase().includes(q) || (a.block_lot ?? '').toLowerCase().includes(q) || (a.notes ?? '').toLowerCase().includes(q);
    });
  }, [activities, areaBy, search, selectedOp, p.canVerifyActivity, p.userId, p.operatorId]);

  async function toggleTaskStatus(
    t: MobileTask,
    nextStatus: MobileTask['status'],
    opts?: { completedAt?: string | null; completedByIds?: string[]; remarks?: string | null; showUndo?: boolean },
  ) {
    if (!p.canClosePm) return;
    setBusyId(t.id);
    setMsg('');
    const prevStatus = t.status;
    const prevCompletedAt = t.completed_at;
    const prevCompletedByIds = t.completed_by_operator_ids ?? [];
    const prevRemarks = t.remarks;
    const nextRemarks = opts?.remarks !== undefined ? opts.remarks : remarksDraft[t.id] !== undefined ? remarksDraft[t.id].trim() || null : t.remarks;
    const completedAt = opts?.completedAt !== undefined ? opts.completedAt : nextStatus === 'done' ? p.today : null;
    const nextCompletedByIds = nextStatus === 'done' ? (opts?.completedByIds ?? t.completed_by_operator_ids ?? []) : (opts?.completedByIds ?? []);

    const basePayload = { status: nextStatus, completed_at: completedAt, remarks: nextRemarks };
    const sb = supabaseBrowser();
    let { error } = await sb.from('pm_tasks').update({ ...basePayload, completed_by_operator_ids: nextCompletedByIds }).eq('id', t.id);
    if (error && isMissingCompletedByColumnError(error)) {
      ({ error } = await sb.from('pm_tasks').update(basePayload).eq('id', t.id));
    }

    setBusyId('');
    if (error) { setMsg(error.message); return; }
    setCompleteModal(null);
    const updatedTask: MobileTask = { ...t, status: nextStatus, completed_at: completedAt, completed_by_operator_ids: nextCompletedByIds, remarks: nextRemarks };
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

  function renderTaskCard(t: MobileTask) {
    return (
      <MobileTaskCard
        key={t.id}
        task={t}
        today={p.today}
        role={p.role}
        operatorId={p.operatorId}
        canClosePm={p.canClosePm}
        canLogActivity={p.canLogActivity}
        actTypeMeta={actBy.get(t.activity_type)}
        opBy={opBy}
        remarksValue={remarksDraft[t.id] ?? t.remarks ?? ''}
        onRemarksChange={(val) => setRemarksDraft((r) => ({ ...r, [t.id]: val }))}
        busy={busyId === t.id}
        onOpenLogger={(task) => { setLinkedPmForLog(task); setLoggerOpen(true); }}
        onOpenCompleteModal={(task, mode) => setCompleteModal({ task, mode })}
        onReopenTask={(task) => void toggleTaskStatus(task, 'planned', { completedByIds: [] })}
      />
    );
  }

  const kanbanColumns = [
    { ariaLabel: 'Delayed tasks', title: 'Delayed / Overdue', titleColor: 'var(--danger)', tone: 'danger' as const, items: delayedTasks, emptyText: 'No delayed tasks.' },
    { ariaLabel: 'Upcoming tasks', title: 'Today & Upcoming', titleColor: 'var(--accent)', tone: 'info' as const, items: upcomingTasks, emptyText: 'No upcoming tasks.' },
    { ariaLabel: 'Completed tasks', title: 'Completed', titleColor: 'var(--ok-fg)', tone: 'ok' as const, items: completedTasks, emptyText: 'No completed tasks in this window.' },
  ];

  return (
    <div className="tasks-shell stack-md">
      <h1 className="sr-only">Tasks, Field Logs and Schedule</h1>

      <div className="card card-pad-sm row-between-wrap">
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

        <div className="row-wrap row-end" style={{ flex: '1 1 260px' }}>
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
                <option key={o.id} value={o.id}>{o.full_name}{o.id === p.operatorId ? ' (Me)' : ''}</option>
              ))}
            </select>
          )}
          {(p.canLogActivity || p.canLogSampleActivity) && p.orgId && (
            <button
              type="button"
              className="btn btn-primary font-bold"
              onClick={() => { setLinkedPmForLog(null); setLoggerOpen(true); }}
              style={{ whiteSpace: 'nowrap' }}
            >
              {p.canLogActivity ? '+ Log Activity' : '+ Log Sample'}
            </button>
          )}
        </div>
      </div>

      {msg && <AlertBanner tone="danger">{msg}</AlertBanner>}

      {offlineQueue.length > 0 && (
        <AlertBanner tone="warn" action={<button type="button" className="btn btn-sm" onClick={() => void flushPendingQueue()}>Sync Now</button>}>
          <b>{offlineQueue.length}</b> activity log{offlineQueue.length === 1 ? '' : 's'} queued offline.
        </AlertBanner>
      )}

      {tab === 'tasks' && (
        <>
          <div className="row-wrap text-sm font-bold">
            <Badge tone="danger">Delayed: {delayedTasks.length}</Badge>
            <Badge tone="info">Due Today: {dueTodayCount}</Badge>
            <Badge tone="info">Upcoming: {upcomingTasks.length}</Badge>
            <Badge tone="ok">Completed: {completedTasks.length}</Badge>
          </div>

          {!p.canClosePm && (
            <div className="card card-pad-xs text-secondary-sm">
              {p.role === 'manager'
                ? 'Department heads can close tasks only while an admin has opened an edit window for them.'
                : <>Your role is <b>{p.role}</b> (read-only). Ask an admin to set your role to <b>operator</b> or <b>scheduler</b> to close tasks.</>}
            </div>
          )}

          {p.role === 'operator' && !p.operatorId && (
            <AlertBanner tone="warn">
              Your user account is not linked to an operator profile yet. Ask an admin to link your account under Operators &amp; Setup to close PM tasks.
            </AlertBanner>
          )}

          <div className="kanban-board desktop-only-kanban">
            {kanbanColumns.map((col) => (
              <section key={col.ariaLabel} className="kanban-col" aria-label={col.ariaLabel}>
                <div className="row-between" style={{ padding: '4px 6px' }}>
                  <strong style={{ fontSize: 14, color: col.titleColor }}>{col.title}</strong>
                  <Badge tone={col.tone} size="sm">{col.items.length}</Badge>
                </div>
                {col.items.length === 0 ? <div className="card card-pad-lg text-center text-secondary-sm">{col.emptyText}</div> : col.items.map(renderTaskCard)}
              </section>
            ))}
          </div>

          <div className="mobile-only-block">
            <div className="row-sm" style={{ gap: 6 }}>
              {(['open', 'done', 'all'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={taskFilter === f ? 'btn btn-primary flex-1 font-bold' : 'btn flex-1 font-bold'}
                  onClick={() => setTaskFilter(f)}
                >
                  {f === 'open' ? 'Open' : f === 'done' ? 'Completed' : 'All'}
                </button>
              ))}
            </div>
            {mobileFilteredTasks.length === 0
              ? <div className="card card-pad-lg text-center text-secondary-sm">No PM tasks match the selected filter.</div>
              : mobileFilteredTasks.map(renderTaskCard)}
          </div>
        </>
      )}

      {(tab === 'activities' || tab === 'schedule') && (
        <MobileActivitiesAndSchedule
          tab={tab} date={p.date} today={p.today} role={p.role} userId={p.userId}
          canLogActivity={p.canLogActivity} canLogSampleActivity={p.canLogSampleActivity}
          scopedActivities={scopedActivities} scheduleList={scheduleList} opBy={opBy} areaBy={areaBy}
          onEditActivity={(act) => { setLinkedPmForLog(null); setEditingActivity(act); setLoggerOpen(true); }}
          onActivityDeleted={(actId) => setActivities((prev) => prev.filter((x) => x.id !== actId))}
          onNavigateDate={(nextDate) => router.push(`/mobile?d=${nextDate}`)} onError={setMsg}
        />
      )}

      {undoToast && (
        <div
          role="status"
          aria-live="polite"
          className="row-md"
          style={{
            position: 'fixed', bottom: 'max(72px, calc(16px + env(safe-area-inset-bottom)))', left: '50%', transform: 'translateX(-50%)', zIndex: 60,
            background: 'var(--header-bg)', color: 'var(--header-fg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px',
            boxShadow: '0 10px 28px rgba(0, 0, 0, 0.28)', maxWidth: 'calc(100vw - 24px)', fontSize: 13,
          }}
        >
          <span><b>{undoToast.task.title}</b> marked done</span>
          <button
            type="button"
            className="btn btn-sm font-bold"
            onClick={() => void toggleTaskStatus(undoToast.task, undoToast.prevStatus, { completedAt: undoToast.prevCompletedAt, completedByIds: undoToast.prevCompletedByIds, remarks: undoToast.prevRemarks, showUndo: false })}
          >
            Undo
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setUndoToast(null)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px' }}
          >
            ✕
          </button>
        </div>
      )}

      {(p.canLogActivity || p.canLogSampleActivity) && p.orgId && loggerOpen && (
        <ActivityLoggerModal
          open={loggerOpen} sampleOnly={!p.canLogActivity} canLogSample={Boolean(p.canLogSampleActivity)}
          onClose={() => { setLoggerOpen(false); setLinkedPmForLog(null); setEditingActivity(null); }}
          onQueuedOffline={async (payload) => { await enqueueOfflineActivity(payload, p.userId); setOfflineQueue(await getOfflineQueue(p.userId)); }}
          onSaved={(act, opts) => {
            if (!opts?.offline) {
              setActivities((prev) => (prev.some((x) => x.id === act.id) ? prev.map((x) => (x.id === act.id ? act : x)) : [act, ...prev]));
            }
            if (linkedPmForLog && !act.is_sample) {
              const performedByIds = opts?.completedByIds ?? buildPmActualPerformerIds(act.lead_operator_id, act.crew_operator_ids);
              setTasks((prev) =>
                prev.map((x) =>
                  x.id === linkedPmForLog.id
                    ? { ...x, status: 'done', completed_at: p.date, completed_by_operator_ids: performedByIds, remarks: act.notes || x.remarks }
                    : x,
                ),
              );
            }
          }}
          orgId={p.orgId} userId={p.userId ?? ''} role={p.role} operatorId={p.operatorId} date={p.date}
          operators={p.operators} areas={p.areas} shifts={p.shifts} assignments={p.assignments}
          linkedPmTask={linkedPmForLog} pmActivityTypes={p.activityTypes} editingActivity={editingActivity}
        />
      )}

      <PmCompleteModal
        open={Boolean(completeModal)} mode={completeModal?.mode ?? 'complete'} task={completeModal?.task ?? null}
        operators={p.operators} currentOperatorId={p.operatorId} requireCurrentOperator={p.role === 'operator'}
        initialRemarks={completeModal ? (remarksDraft[completeModal.task.id] ?? completeModal.task.remarks ?? '') : ''}
        busy={Boolean(completeModal && busyId === completeModal.task.id)}
        onCancel={() => setCompleteModal(null)}
        onConfirm={async ({ completedByIds, remarks }) => {
          if (!completeModal) return;
          const target = completeModal.task;
          await toggleTaskStatus(target, 'done', {
            completedAt: target.status === 'done' ? (target.completed_at ?? p.today) : p.today,
            completedByIds, remarks, showUndo: p.role !== 'operator' && completeModal.mode === 'complete',
          });
        }}
      />
    </div>
  );
}
