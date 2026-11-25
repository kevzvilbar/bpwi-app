'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { subscribeVisibilityAwareChannel } from '@/lib/supabase/realtime';
import { DAILY_ACTIVITY_LIST_COLUMNS } from '@/lib/query-columns';
import { getErrorMessage } from '@/lib/error-utils';
import { addIsoDays as addDays, fmtTimeManila } from '@/lib/date';
import { isValidCoordinate } from '@/lib/route-footprints';
import { resolvePmCreditedOperators } from '@/lib/pm-credit';
import { ACTIVITY_TYPES, type DailyActivityRow, type JobOrderRow, type ShiftHandoverRow } from '@/lib/activity-types';
import type { LinkedJobOrder } from '@/components/ActivityLoggerModal';
import ActivityFeedCard, { type PrintPreviewMode } from '@/components/ActivityFeedCard';
import { AlertBanner, Badge, SegmentedTabs } from '@/components/ui';
import { DEFAULT_STATION_CODE } from '@/lib/roster-helpers';
import ConfirmDialog from '@/components/ConfirmDialog';
import SampleCleanupHealth from '@/components/SampleCleanupHealth';
import { enqueueOfflineActivity } from '@/lib/offline-queue';

const ActivityLoggerModal = dynamic(() => import('@/components/ActivityLoggerModal'), { ssr: false });
const PrintableActivityReport = dynamic(() => import('@/components/PrintableActivityReport'), { ssr: false });
const ActivitiesKpiTab = dynamic(() => import('@/components/ActivitiesKpiTab'), { ssr: false });
const ActivitiesRoutesTab = dynamic(() => import('@/components/ActivitiesRoutesTab'), { ssr: false });
const JobOrdersTab = dynamic(() => import('@/components/JobOrdersTab'), { ssr: false });
const ShiftHandoversTab = dynamic(() => import('@/components/ShiftHandoversTab'), { ssr: false });

type MonOp = { id: string; full_name: string; position: string | null; phone_number: string | null; default_station: string | null };
type MonShift = { id: string; code: string; description: string | null; duration_hours: number; start_time: string | null; end_time: string | null; background_color: string; text_color: string; is_off: boolean };
type MonArea = { id: string; code: string; name: string | null; category: string; background_color: string; text_color: string; sub_sites?: string[] };
type MonAsg = { operator_id: string; schedule_date: string; shift_type_id: string | null; area_code_id: string | null };
type MonStandby = { operator_id: string; standby_type: string };
type MonPm = { id: string; activity_type: string; title: string; scheduled_date: string; completed_at: string | null; status: string; assigned_operator_ids: string[]; completed_by_operator_ids?: string[] | null };

function applyRealtimeRecord<T extends { id: string }>(
  setList: React.Dispatch<React.SetStateAction<T[]>>,
  payload: { eventType: string; old: Record<string, unknown>; new: Record<string, unknown> },
  acceptNew?: (rec: T) => boolean,
) {
  const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as unknown as T;
  if (!rec?.id) return;
  if (payload.eventType === 'DELETE') {
    setList((prev) => prev.filter((x) => x.id !== rec.id));
    return;
  }
  if (acceptNew && !acceptNew(rec)) return;
  setList((prev) => (prev.some((x) => x.id === rec.id) ? prev.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...prev]));
}

export default function ActivitiesMonitor(p: {
  date: string;
  today: string;
  orgId: string;
  orgName: string;
  userId: string;
  role: string;
  operatorId: string | null;
  canLogActivity: boolean;
  canLogSampleActivity?: boolean;
  canVerifyActivity: boolean;
  isAdmin: boolean;
  operators: MonOp[];
  shifts: MonShift[];
  areas: MonArea[];
  assignments: MonAsg[];
  standby: MonStandby[];
  pmTasks: MonPm[];
  activities: DailyActivityRow[];
  jobOrders: JobOrderRow[];
  handovers: ShiftHandoverRow[];
  schemaWarning: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'monitor' | 'routes' | 'job-orders' | 'handovers' | 'kpis'>('monitor');
  const [activities, setActivities] = useState<DailyActivityRow[]>(p.activities);
  const [jobOrders, setJobOrders] = useState<JobOrderRow[]>(p.jobOrders);
  const [handovers, setHandovers] = useState<ShiftHandoverRow[]>(p.handovers);

  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterOpId, setFilterOpId] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'submitted' | 'verified' | 'flagged'>('all');

  const [loggerOpen, setLoggerOpen] = useState(false);
  const [loggerLeadOpId, setLoggerLeadOpId] = useState<string | null>(null);
  const [linkedJoForLog, setLinkedJoForLog] = useState<LinkedJobOrder | null>(null);
  const [editingActivity, setEditingActivity] = useState<DailyActivityRow | null>(null);

  const [printState, setPrintState] = useState<{ mode: PrintPreviewMode; activity?: DailyActivityRow | null; jobOrder?: JobOrderRow | null } | null>(null);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState('');
  const [pendingDeleteAct, setPendingDeleteAct] = useState<DailyActivityRow | null>(null);
  const [deletingAct, setDeletingAct] = useState(false);
  const [purging, setPurging] = useState(false);
  const [bannerMsg, setBannerMsg] = useState('');

  const canManageJo = p.isAdmin || p.role === 'scheduler' || p.role === 'manager';
  const [joFilter, setJoFilter] = useState<'open' | 'completed' | 'all'>('open');
  const canLogHandover = p.canLogActivity || p.canVerifyActivity;

  useEffect(() => setActivities(p.activities), [p.activities]);
  useEffect(() => setJobOrders(p.jobOrders), [p.jobOrders]);
  useEffect(() => setHandovers(p.handovers), [p.handovers]);

  useEffect(() => {
    return subscribeVisibilityAwareChannel({
      sb: supabaseBrowser(),
      channelName: 'bpwi-activities-hub',
      onReconnect: () => router.refresh(),
      listeners: [
        { table: 'daily_activities', onEvent: (pl) => applyRealtimeRecord(setActivities, pl, (rec) => rec.activity_date === p.date) },
        { table: 'job_orders', onEvent: (pl) => applyRealtimeRecord(setJobOrders, pl) },
        { table: 'shift_handovers', onEvent: (pl) => applyRealtimeRecord(setHandovers, pl) },
      ],
    });
  }, [p.date, router]);

  useEffect(() => {
    const onSynced = (ev: Event) => {
      const rows = (ev as CustomEvent<{ rows?: DailyActivityRow[] }>).detail?.rows;
      if (!Array.isArray(rows) || rows.length === 0) return;
      const forDate = rows.filter((r) => r.activity_date === p.date);
      if (forDate.length === 0) return;
      setActivities((prev) => {
        let next = prev;
        for (const row of forDate) {
          next = next.some((x) => x.id === row.id) ? next.map((x) => (x.id === row.id ? row : x)) : [row, ...next];
        }
        return next;
      });
      setBannerMsg(`✓ Synced ${forDate.length} offline activity log${forDate.length === 1 ? '' : 's'}.`);
    };
    window.addEventListener('bpwi-offline-activity-synced', onSynced);
    return () => window.removeEventListener('bpwi-offline-activity-synced', onSynced);
  }, [p.date]);

  const opBy = useMemo(() => new Map(p.operators.map((o) => [o.id, o])), [p.operators]);
  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);
  const standbyByOp = useMemo(() => new Map(p.standby.map((s) => [s.operator_id, s.standby_type])), [p.standby]);
  const stationAreas = useMemo(() => {
    const st = p.areas.filter((a) => a.category === 'station');
    return st.length > 0 ? st : p.areas.filter((a) => a.category !== 'leave' && a.category !== 'rest' && a.category !== 'holiday');
  }, [p.areas]);

  const dateAssignments = useMemo(() => p.assignments.filter((a) => a.schedule_date === p.date), [p.assignments, p.date]);
  const dateAsgByOp = useMemo(() => new Map(dateAssignments.map((a) => [a.operator_id, a])), [dateAssignments]);

  const dateActivities = useMemo(() => {
    const onDate = activities.filter((a) => a.activity_date === p.date);
    if (p.canVerifyActivity) return onDate;
    return onDate.filter(
      (a) =>
        (p.userId && a.logged_by === p.userId) ||
        (p.operatorId && (a.lead_operator_id === p.operatorId || (a.crew_operator_ids ?? []).includes(p.operatorId))),
    );
  }, [activities, p.date, p.canVerifyActivity, p.userId, p.operatorId]);

  const dutyMatrix = useMemo(() => {
    return p.operators
      .map((op) => {
        const asg = dateAsgByOp.get(op.id);
        const shift = asg?.shift_type_id ? shiftBy.get(asg.shift_type_id) : undefined;
        const area = asg?.area_code_id ? areaBy.get(asg.area_code_id) : undefined;
        const standbyType = standbyByOp.get(op.id);
        const isLeaveOrRest = Boolean(area && (area.category === 'leave' || area.category === 'rest' || area.category === 'holiday'));
        const isOnDuty = Boolean(shift && !shift.is_off && !isLeaveOrRest);
        const opActs = dateActivities.filter(
          (a) => !a.is_sample && (a.lead_operator_id === op.id || (a.crew_operator_ids ?? []).includes(op.id)),
        );
        const pmsClosedToday = p.pmTasks.filter(
          (t) => t.status === 'done' && t.completed_at === p.date && resolvePmCreditedOperators(t).includes(op.id),
        ).length;
        return { op, shift, area, standbyType, isOnDuty, isLeaveOrRest, logsCount: opActs.length, pmsClosedToday, lastTimestamp: opActs[0]?.completed_at ?? opActs[0]?.created_at ?? null };
      })
      .filter((row) => row.isOnDuty || row.standbyType || row.logsCount > 0 || row.pmsClosedToday > 0)
      .sort((a, b) => Number(b.isOnDuty) - Number(a.isOnDuty) || b.logsCount - a.logsCount || a.op.full_name.localeCompare(b.op.full_name));
  }, [p.operators, dateAsgByOp, shiftBy, areaBy, standbyByOp, dateActivities, p.pmTasks, p.date]);

  const idleOnDutyCount = useMemo(
    () => dutyMatrix.filter((d) => d.isOnDuty && d.logsCount === 0 && d.pmsClosedToday === 0).length,
    [dutyMatrix],
  );

  const filteredActivities = useMemo(() => {
    return dateActivities.filter((a) => {
      if (filterAreaId && a.area_code_id !== filterAreaId) return false;
      if (filterType && a.activity_type !== filterType) return false;
      if (filterStatus !== 'all' && a.status !== filterStatus) return false;
      if (filterOpId && a.lead_operator_id !== filterOpId && !(a.crew_operator_ids ?? []).includes(filterOpId)) return false;
      return true;
    });
  }, [dateActivities, filterAreaId, filterType, filterStatus, filterOpId]);

  const photoRetention = useMemo(() => {
    const nowMs = Date.now();
    let activeWithPhotos = 0;
    let expiredCount = 0;
    for (const a of activities) {
      if (!a.photos_purged_at && Array.isArray(a.photo_urls) && a.photo_urls.length > 0) {
        activeWithPhotos += 1;
        if (a.photos_expires_at && new Date(a.photos_expires_at).getTime() < nowMs) expiredCount += 1;
      }
    }
    return { activeWithPhotos, expiredCount };
  }, [activities]);

  const filteredJobOrders = useMemo(() => {
    const scoped = p.canVerifyActivity
      ? jobOrders
      : jobOrders.filter(
          (j) => (j.assigned_operator_ids ?? []).length === 0 || (p.operatorId && (j.assigned_operator_ids ?? []).includes(p.operatorId)),
        );
    if (joFilter === 'open') return scoped.filter((j) => j.status === 'pending' || j.status === 'in_progress');
    if (joFilter === 'completed') return scoped.filter((j) => j.status === 'completed' || j.status === 'cancelled');
    return scoped;
  }, [jobOrders, joFilter, p.canVerifyActivity, p.operatorId]);

  async function handlePurgeExpiredPhotos() {
    setPurging(true);
    setBannerMsg('');
    try {
      const res = await fetch('/api/activities/purge-photos', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) setBannerMsg(`Purge error: ${json.error ?? res.statusText}`);
      else {
        setBannerMsg(`✓ Purged expired photos from ${json.purgedCount} record(s) (${json.filesRemoved} file(s) removed).`);
        if (json.purgedCount > 0) router.refresh();
      }
    } catch (err: unknown) {
      setBannerMsg(`Purge error: ${getErrorMessage(err, 'failed')}`);
    } finally {
      setPurging(false);
    }
  }

  async function updateActivityVerification(act: DailyActivityRow, nextStatus: 'verified' | 'flagged', note?: string) {
    if (!p.canVerifyActivity) return;
    const { data, error } = await supabaseBrowser()
      .from('daily_activities')
      .update({ status: nextStatus, verified_by: p.userId, verified_at: new Date().toISOString(), review_note: note?.trim() || null })
      .eq('id', act.id)
      .select(DAILY_ACTIVITY_LIST_COLUMNS)
      .single();
    if (error) {
      setBannerMsg(`Could not update verification: ${error.message}`);
      return;
    }
    setActivities((prev) => prev.map((x) => (x.id === act.id ? (data as unknown as DailyActivityRow) : x)));
    setFlaggingId(null);
    setFlagReason('');
  }

  async function handleDeleteActivity(act: DailyActivityRow) {
    setDeletingAct(true);
    try {
      const { error } = await supabaseBrowser().from('daily_activities').delete().eq('id', act.id);
      if (error) {
        setBannerMsg(`Could not delete activity: ${error.message}`);
        return;
      }
      setActivities((prev) => prev.filter((x) => x.id !== act.id));
      setBannerMsg('✓ Activity deleted.');
    } finally {
      setDeletingAct(false);
      setPendingDeleteAct(null);
    }
  }

  const openHighJos = jobOrders.filter((j) => !j.is_sample && (j.status === 'pending' || j.status === 'in_progress') && j.priority === 'high').length;
  const overduePms = p.pmTasks.filter((t) => t.status !== 'done' && t.scheduled_date < p.date).length;

  return (
    <div className="stack-md" style={{ maxWidth: 1440, margin: '0 auto', padding: '12px 16px 40px' }}>
      <div className="card card-pad-sm row-between-wrap">
        <div className="row-wrap">
          <div>
            <h1 className="page-title">Daily Employee Activity Monitor</h1>
            <p className="page-subtitle">Schedule-linked field logs, Job Orders, Shift Huddle &amp; Performance KPIs</p>
          </div>
          <div className="row-xs">
            <button type="button" className="btn" onClick={() => router.push(`/activities?d=${addDays(p.date, -1)}`)} aria-label="Previous day">‹</button>
            <input type="date" className="input" aria-label="Monitoring date" value={p.date} onChange={(e) => e.target.value && router.push(`/activities?d=${e.target.value}`)} style={{ width: 150 }} />
            <button type="button" className="btn" onClick={() => router.push(`/activities?d=${addDays(p.date, 1)}`)} aria-label="Next day">›</button>
            {p.date !== p.today && (
              <button type="button" className="btn btn-primary" onClick={() => router.push(`/activities?d=${p.today}`)}>Today</button>
            )}
          </div>
        </div>

        <div className="row-wrap">
          <Badge tone="neutral" title="Photos uploaded to Supabase Storage auto-expire after 30 days to stay within storage limits.">
            30d Photo Retention ({photoRetention.activeWithPhotos} active)
          </Badge>
          {p.canVerifyActivity && (
            <button type="button" className="btn btn-sm" disabled={purging} onClick={handlePurgeExpiredPhotos}>
              {purging ? 'Purging…' : `Purge Expired Photos${photoRetention.expiredCount > 0 ? ` (${photoRetention.expiredCount})` : ''}`}
            </button>
          )}
          {(p.canLogActivity || p.canLogSampleActivity) && (
            <button
              type="button"
              className="btn btn-primary font-bold"
              onClick={() => { setLinkedJoForLog(null); setLoggerLeadOpId(p.operatorId); setLoggerOpen(true); }}
            >
              {p.canLogActivity ? '+ Log Activity' : '+ Log Sample'}
            </button>
          )}
        </div>
      </div>

      {p.isAdmin && <SampleCleanupHealth />}
      {p.schemaWarning && <AlertBanner tone="warn"><b>Setup Notice:</b> {p.schemaWarning}</AlertBanner>}
      {bannerMsg && <AlertBanner tone={bannerMsg.startsWith('✓') ? 'ok' : 'danger'} onDismiss={() => setBannerMsg('')}>{bannerMsg}</AlertBanner>}

      <SegmentedTabs
        ariaLabel="Activity monitoring sections"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'monitor', label: `${p.canVerifyActivity ? 'Duty & Activity Feed' : 'My Activity Logs'} (${dateActivities.length})` },
          { id: 'routes', label: `Routes & Distance (${dateActivities.filter((a) => isValidCoordinate(a.gps_lat, a.gps_lng)).length} GPS)` },
          { id: 'job-orders', label: `Job Orders (${filteredJobOrders.filter((j) => !j.is_sample && (j.status === 'pending' || j.status === 'in_progress')).length} open)` },
          { id: 'handovers', label: `Shift Handover & Huddle (${handovers.filter((h) => !h.is_sample && h.handover_date === p.date).length})` },
          ...(p.canVerifyActivity ? [{ id: 'kpis' as const, label: 'Employee KPIs & Fuel' }] : []),
        ]}
      />

      {tab === 'monitor' && (
        <div className="stack-md">
          {!p.canLogActivity && (
            <div className="card card-pad-xs text-secondary-sm">
              Real activity submission is restricted to <b>operator</b> and <b>admin</b> logins.
              {p.canLogSampleActivity ? ' As department head, you can log 24h auto-expiring sample activities via + Log Sample.' : ` Your role (${p.role}) has monitoring${p.canVerifyActivity ? ' & verification' : ''} access.`}
            </div>
          )}

          {p.canVerifyActivity && (
            <div className="card card-pad stack-sm">
              <div className="row-between-wrap">
                <div>
                  <strong style={{ fontSize: 14.5 }}>On-Duty Operator Activity Matrix ({p.date})</strong>
                  <div className="text-secondary-xs">Reconciles today&apos;s scheduled roster crew against logged activities and closed PM tasks.</div>
                </div>
                {idleOnDutyCount > 0 && (
                  <Badge tone="warn">⚠️ {idleOnDutyCount} on-duty operator{idleOnDutyCount === 1 ? '' : 's'} with 0 logs yet</Badge>
                )}
              </div>

              {dutyMatrix.length === 0 ? (
                <div className="text-secondary-sm">No operators scheduled on duty or standby for {p.date}.</div>
              ) : (
                <div className="grid-auto-md" style={{ gap: 8 }}>
                  {dutyMatrix.map((row) => {
                    const hasOutput = row.logsCount > 0 || row.pmsClosedToday > 0;
                    const canLogForThisOp = p.isAdmin || (p.canLogActivity && p.operatorId === row.op.id);
                    const isFiltered = filterOpId === row.op.id;
                    return (
                      <div
                        key={row.op.id}
                        className="card card-pad-sm stack-xs"
                        style={{
                          background: isFiltered ? 'var(--info-bg)' : 'var(--surface-muted)',
                          borderColor: isFiltered ? 'var(--accent)' : hasOutput ? 'var(--ok-border)' : row.isOnDuty ? 'var(--warn-border)' : 'var(--border)',
                        }}
                      >
                        <div className="row-between" style={{ alignItems: 'start' }}>
                          <div>
                            <div className="font-bold" style={{ fontSize: 13.5 }}>{row.op.full_name}</div>
                            <div className="text-secondary-xs">
                              {row.shift ? row.shift.code : 'Unscheduled'} · {row.area ? row.area.code : row.isOnDuty ? DEFAULT_STATION_CODE : '—'}
                              {row.standbyType && <span className="font-bold" style={{ marginLeft: 5, color: 'var(--violet)' }}>· {row.standbyType}</span>}
                            </div>
                          </div>
                          <Badge size="sm" tone={hasOutput ? 'ok' : 'warn'}>
                            {hasOutput ? `✓ ${row.logsCount} log${row.logsCount === 1 ? '' : 's'}${row.pmsClosedToday ? ` + ${row.pmsClosedToday} PM` : ''}` : '⚠️ 0 logs'}
                          </Badge>
                        </div>
                        <div className="row-between text-secondary-xs">
                          <span>Last: {row.lastTimestamp ? fmtTimeManila(row.lastTimestamp) : '—'}</span>
                          <div className="row-xs">
                            <button type="button" className="btn btn-xs" onClick={() => setFilterOpId(isFiltered ? '' : row.op.id)}>
                              {isFiltered ? 'Clear Filter' : 'Filter Feed'}
                            </button>
                            {canLogForThisOp && (
                              <button type="button" className="btn btn-primary btn-xs" onClick={() => { setLinkedJoForLog(null); setLoggerLeadOpId(row.op.id); setLoggerOpen(true); }}>
                                + Log
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="card card-pad-sm row-wrap">
            <strong className="section-eyebrow">Filter Logs:</strong>
            <select className="input" value={filterAreaId} onChange={(e) => setFilterAreaId(e.target.value)} style={{ width: 'auto', minWidth: 150 }}>
              <option value="">All Stations / Areas</option>
              {stationAreas.map((a) => <option key={a.id} value={a.id}>{a.code}{a.name ? ` · ${a.name}` : ''}</option>)}
            </select>
            <select className="input" value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: 'auto', minWidth: 170 }}>
              <option value="">All Activity Types</option>
              {ACTIVITY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {p.canVerifyActivity && (
              <select className="input" value={filterOpId} onChange={(e) => setFilterOpId(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
                <option value="">All Operators</option>
                {p.operators.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
              </select>
            )}
            <select className="input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'all' | 'submitted' | 'verified' | 'flagged')} style={{ width: 'auto', minWidth: 130 }}>
              <option value="all">All Statuses</option>
              <option value="submitted">Submitted</option>
              <option value="verified">Verified</option>
              <option value="flagged">Flagged</option>
            </select>
            {(filterAreaId || filterType || filterOpId || filterStatus !== 'all') && (
              <button type="button" className="btn btn-sm" onClick={() => { setFilterAreaId(''); setFilterType(''); setFilterOpId(''); setFilterStatus('all'); }}>
                Reset
              </button>
            )}
          </div>

          {filteredActivities.length === 0 ? (
            <div className="card card-pad-lg text-center text-secondary-sm">
              No field activities match the current filter for <b>{p.date}</b>.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
              {filteredActivities.map((act) => (
                <ActivityFeedCard
                  key={act.id} act={act}
                  area={act.area_code_id ? areaBy.get(act.area_code_id) : undefined}
                  leadName={act.lead_operator_id ? opBy.get(act.lead_operator_id)?.full_name : undefined}
                  crewNames={(act.crew_operator_ids ?? []).map((id) => opBy.get(id)?.full_name).filter(Boolean) as string[]}
                  canVerifyActivity={p.canVerifyActivity}
                  canEditOrDelete={(p.isAdmin || act.logged_by === p.userId) && act.status !== 'verified'}
                  isFlagging={flaggingId === act.id} flagReason={flagReason}
                  onFlagReasonChange={setFlagReason}
                  onToggleFlag={() => { setFlaggingId(flaggingId === act.id ? null : act.id); setFlagReason(''); }}
                  onVerify={() => void updateActivityVerification(act, 'verified')}
                  onConfirmFlag={() => void updateActivityVerification(act, 'flagged', flagReason)}
                  onPrint={(mode) => setPrintState({ mode, activity: act })}
                  onEdit={() => { setLinkedJoForLog(null); setEditingActivity(act); setLoggerOpen(true); }}
                  onDelete={() => setPendingDeleteAct(act)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'routes' && (
        <ActivitiesRoutesTab date={p.date} canVerifyActivity={p.canVerifyActivity} isAdmin={p.isAdmin} operatorId={p.operatorId} operators={p.operators} areas={p.areas} activities={activities} />
      )}

      {tab === 'job-orders' && (
        <JobOrdersTab
          orgId={p.orgId} userId={p.userId} canManageJo={canManageJo} canLogActivity={p.canLogActivity} canLogSample={p.canLogSampleActivity} role={p.role}
          joFilter={joFilter} onChangeJoFilter={setJoFilter} filteredJobOrders={filteredJobOrders} operators={p.operators} stationAreas={stationAreas} opBy={opBy} areaBy={areaBy}
          onJobOrderCreated={(jo) => setJobOrders((prev) => [jo, ...prev])}
          onJobOrderUpdated={(jo) => setJobOrders((prev) => prev.map((x) => (x.id === jo.id ? jo : x)))}
          onFulfillJobOrder={(jo) => { setLinkedJoForLog(jo); setLoggerLeadOpId(jo.assigned_operator_ids?.[0] ?? p.operatorId); setLoggerOpen(true); }}
          onPrintJobOrder={(jo) => setPrintState({ mode: 'activity', jobOrder: jo })} onBannerMsg={setBannerMsg}
        />
      )}

      {tab === 'handovers' && (
        <ShiftHandoversTab
          orgId={p.orgId} userId={p.userId} operatorId={p.operatorId} date={p.date} canLogHandover={canLogHandover} canLogSample={p.canLogSampleActivity}
          dateActivities={dateActivities} idleOnDutyCount={idleOnDutyCount} openHighJos={openHighJos} overduePms={overduePms}
          handovers={handovers} operators={p.operators} stationAreas={stationAreas} opBy={opBy} areaBy={areaBy}
          onHandoverCreated={(ho) => setHandovers((prev) => [ho, ...prev])} onBannerMsg={setBannerMsg}
        />
      )}

      {tab === 'kpis' && p.canVerifyActivity && (
        <ActivitiesKpiTab anchorDate={p.date} operators={p.operators} areas={p.areas} shifts={p.shifts} />
      )}

      {(p.canLogActivity || p.canLogSampleActivity) && loggerOpen && (
        <ActivityLoggerModal
          open={loggerOpen} role={p.role} sampleOnly={!p.canLogActivity} canLogSample={Boolean(p.canLogSampleActivity)}
          onClose={() => { setLoggerOpen(false); setLinkedJoForLog(null); setEditingActivity(null); }}
          onQueuedOffline={async (payload: Record<string, unknown>, opts?: { editingId?: string | null }) => { await enqueueOfflineActivity(payload, p.userId, opts); }}
          onSaved={(act, opts) => {
            if (!opts?.offline) {
              setActivities((prev) => (prev.some((x) => x.id === act.id) ? prev.map((x) => (x.id === act.id ? act : x)) : [act, ...prev]));
              setBannerMsg(opts?.linkedWarning ?? (editingActivity ? '✓ Activity updated.' : '✓ Activity logged.'));
            } else if (opts?.linkedWarning) {
              setBannerMsg(opts.linkedWarning);
            }
            if (linkedJoForLog && !act.is_sample && !opts?.offline) {
              setJobOrders((prev) => prev.map((j) => (j.id === linkedJoForLog.id ? { ...j, status: 'completed', completed_at: new Date().toISOString(), ...(opts?.tatJustification ? { tat_justification: opts.tatJustification } : {}) } : j)));
            }
          }}
          orgId={p.orgId} userId={p.userId} operatorId={p.operatorId} date={p.date} operators={p.operators} areas={p.areas}
          shifts={p.shifts} assignments={dateAssignments} initialLeadOperatorId={loggerLeadOpId} linkedJobOrder={linkedJoForLog} editingActivity={editingActivity}
        />
      )}

      {printState && (
        <PrintableActivityReport mode={printState.mode} orgName={p.orgName} activity={printState.activity} jobOrder={printState.jobOrder} operators={p.operators} areas={p.areas} shifts={p.shifts} onClose={() => setPrintState(null)} />
      )}

      <ConfirmDialog
        open={pendingDeleteAct !== null} title="Delete activity log?"
        description="This permanently removes the activity log from the feed. This action cannot be undone."
        confirmLabel={deletingAct ? 'Deleting…' : 'Delete log'} tone="danger" busy={deletingAct}
        onCancel={() => setPendingDeleteAct(null)}
        onConfirm={() => { if (pendingDeleteAct) void handleDeleteActivity(pendingDeleteAct); }}
      />
    </div>
  );
}
