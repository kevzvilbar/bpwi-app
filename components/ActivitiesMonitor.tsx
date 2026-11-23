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
import { extractGpsMetadata, formatGpsBadgeLabel } from '@/lib/gps-accuracy';
import { resolveActivityPhotoUrl } from '@/lib/activity-media';
import {
  ACTIVITY_BY_ID,
  ACTIVITY_TYPES,
  type DailyActivityRow,
  type JobOrderRow,
  type ShiftHandoverRow,
} from '@/lib/activity-types';
import { formatTelemetrySummary } from '@/lib/activity-telemetry';
import type { LinkedJobOrder } from '@/components/ActivityLoggerModal';
import { AlertBanner, Badge, SegmentedTabs } from '@/components/ui';
import { DEFAULT_STATION_CODE } from '@/lib/roster-helpers';
import { enqueueOfflineActivity, flushOfflineQueue, getOfflineQueue, type PendingOfflineActivity } from '@/lib/offline-queue';

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
type MonPm = { id: string; activity_type: string; title: string; scheduled_date: string; completed_at: string | null; status: string; assigned_operator_ids: string[] };

function daysUntil(iso: string | null | undefined) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
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
  const [offlineQueue, setOfflineQueue] = useState<PendingOfflineActivity[]>([]);

  // Filters on Monitor tab
  const [filterAreaId, setFilterAreaId] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterOpId, setFilterOpId] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'submitted' | 'verified' | 'flagged'>('all');

  // Logger Modal state
  const [loggerOpen, setLoggerOpen] = useState(false);
  const [loggerLeadOpId, setLoggerLeadOpId] = useState<string | null>(null);
  const [linkedJoForLog, setLinkedJoForLog] = useState<LinkedJobOrder | null>(null);
  const [editingActivity, setEditingActivity] = useState<DailyActivityRow | null>(null);

  // Printable preview state
  const [printState, setPrintState] = useState<{
    mode: 'activity' | 'meter_test' | 'well_pull_out' | 'tank_cleaning';
    activity?: DailyActivityRow | null;
    jobOrder?: JobOrderRow | null;
  } | null>(null);

  // Flag review inline state
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState('');

  // Storage purge feedback
  const [purging, setPurging] = useState(false);
  const [bannerMsg, setBannerMsg] = useState('');

  // Job Orders & Shift Handover tab permissions/filters
  const canManageJo = p.isAdmin || p.role === 'scheduler' || p.role === 'manager';
  const [joFilter, setJoFilter] = useState<'open' | 'completed' | 'all'>('open');
  const canLogHandover = p.canLogActivity || p.canVerifyActivity;

  useEffect(() => setActivities(p.activities), [p.activities]);
  useEffect(() => setJobOrders(p.jobOrders), [p.jobOrders]);
  useEffect(() => setHandovers(p.handovers), [p.handovers]);

  // Visibility-aware Realtime sync
  useEffect(() => {
    const sb = supabaseBrowser();
    return subscribeVisibilityAwareChannel({
      sb,
      channelName: 'bpwi-activities-hub',
      listeners: [
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
            setActivities((prev) =>
              prev.some((x) => x.id === rec.id) ? prev.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...prev],
            );
          },
        },
        {
          table: 'job_orders',
          onEvent: (payload) => {
            const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as unknown as JobOrderRow;
            if (!rec?.id) return;
            if (payload.eventType === 'DELETE') {
              setJobOrders((prev) => prev.filter((x) => x.id !== rec.id));
            } else {
              setJobOrders((prev) =>
                prev.some((x) => x.id === rec.id) ? prev.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...prev],
              );
            }
          },
        },
        {
          table: 'shift_handovers',
          onEvent: (payload) => {
            const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as unknown as ShiftHandoverRow;
            if (!rec?.id) return;
            if (payload.eventType === 'DELETE') {
              setHandovers((prev) => prev.filter((x) => x.id !== rec.id));
            } else {
              setHandovers((prev) =>
                prev.some((x) => x.id === rec.id) ? prev.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...prev],
              );
            }
          },
        },
      ],
    });
  }, [p.date]);

  // Offline queue listener & auto-flush
  useEffect(() => {
    let active = true;
    const syncNow = async () => {
      const q = await getOfflineQueue(p.userId);
      if (!active) return;
      setOfflineQueue(q);
      if (q.length > 0 && navigator.onLine) {
        const res = await flushOfflineQueue(supabaseBrowser(), p.userId);
        if (!active) return;
        if (res.synced.length > 0) {
          setActivities((prev) => [...res.synced, ...prev]);
          setBannerMsg(
            res.failed > 0
              ? `Synced ${res.synced.length} offline log(s); ${res.failed} failed — inspect queue above.`
              : `✓ Synced ${res.synced.length} offline activity log(s).`,
          );
        }
        setOfflineQueue(await getOfflineQueue(p.userId));
      }
    };
    const onQueueChanged = async () => {
      const q = await getOfflineQueue(p.userId);
      if (active) setOfflineQueue(q);
    };
    void syncNow();
    window.addEventListener('online', syncNow);
    window.addEventListener('bpwi-offline-queue-changed', onQueueChanged);
    return () => {
      active = false;
      window.removeEventListener('online', syncNow);
      window.removeEventListener('bpwi-offline-queue-changed', onQueueChanged);
    };
  }, [p.userId]);

  // Lookup maps
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

  // Daily Duty-vs-Activity Matrix
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
          (a) => a.lead_operator_id === op.id || (a.crew_operator_ids ?? []).includes(op.id),
        );
        const pmsClosedToday = p.pmTasks.filter(
          (t) => t.status === 'done' && t.completed_at === p.date && (t.assigned_operator_ids ?? []).includes(op.id),
        ).length;
        const lastTimestamp = opActs[0]?.completed_at ?? opActs[0]?.created_at ?? null;

        return {
          op,
          shift,
          area,
          standbyType,
          isOnDuty,
          isLeaveOrRest,
          logsCount: opActs.length,
          pmsClosedToday,
          lastTimestamp,
        };
      })
      .filter((row) => row.isOnDuty || row.standbyType || row.logsCount > 0 || row.pmsClosedToday > 0)
      .sort((a, b) => Number(b.isOnDuty) - Number(a.isOnDuty) || b.logsCount - a.logsCount || a.op.full_name.localeCompare(b.op.full_name));
  }, [p.operators, dateAsgByOp, shiftBy, areaBy, standbyByOp, dateActivities, p.pmTasks, p.date]);

  const idleOnDutyCount = useMemo(
    () => dutyMatrix.filter((d) => d.isOnDuty && d.logsCount === 0 && d.pmsClosedToday === 0).length,
    [dutyMatrix],
  );

  // Filtered Activity Feed for p.date
  const filteredActivities = useMemo(() => {
    return dateActivities.filter((a) => {
      if (filterAreaId && a.area_code_id !== filterAreaId) return false;
      if (filterType && a.activity_type !== filterType) return false;
      if (filterStatus !== 'all' && a.status !== filterStatus) return false;
      if (filterOpId) {
        const involved = a.lead_operator_id === filterOpId || (a.crew_operator_ids ?? []).includes(filterOpId);
        if (!involved) return false;
      }
      return true;
    });
  }, [dateActivities, filterAreaId, filterType, filterStatus, filterOpId]);

  // Photo retention stats across loaded activities
  const photoRetention = useMemo(() => {
    const nowMs = Date.now();
    let activeWithPhotos = 0;
    let expiredCount = 0;
    for (const a of activities) {
      if (!a.photos_purged_at && Array.isArray(a.photo_urls) && a.photo_urls.length > 0) {
        activeWithPhotos += 1;
        if (a.photos_expires_at && new Date(a.photos_expires_at).getTime() < nowMs) {
          expiredCount += 1;
        }
      }
    }
    return { activeWithPhotos, expiredCount };
  }, [activities]);

  // Filtered Job Orders (non-supervisors only see JOs assigned to them or unassigned)
  const filteredJobOrders = useMemo(() => {
    const scoped = p.canVerifyActivity
      ? jobOrders
      : jobOrders.filter(
          (j) =>
            (j.assigned_operator_ids ?? []).length === 0 ||
            (p.operatorId && (j.assigned_operator_ids ?? []).includes(p.operatorId)),
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
      if (!res.ok) {
        setBannerMsg(`Purge error: ${json.error ?? res.statusText}`);
      } else {
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
    const sb = supabaseBrowser();
    const nowIso = new Date().toISOString();
    const { data, error } = await sb
      .from('daily_activities')
      .update({
        status: nextStatus,
        verified_by: p.userId,
        verified_at: nowIso,
        review_note: note?.trim() || null,
      })
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
    if (!window.confirm('Delete this activity log?')) return;
    const sb = supabaseBrowser();
    const { error } = await sb.from('daily_activities').delete().eq('id', act.id);
    if (error) {
      setBannerMsg(`Could not delete activity: ${error.message}`);
      return;
    }
    setActivities((prev) => prev.filter((x) => x.id !== act.id));
    setBannerMsg('✓ Activity deleted.');
  }

  // Huddle summary numbers for p.date
  const openHighJos = jobOrders.filter((j) => (j.status === 'pending' || j.status === 'in_progress') && j.priority === 'high').length;
  const overduePms = p.pmTasks.filter((t) => t.status !== 'done' && t.scheduled_date < p.date).length;

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '12px 16px 40px', display: 'grid', gap: 12 }}>
      {/* Top Action & Date Toolbar */}
      <div className="card" style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">Daily Employee Activity Monitor</h1>
            <p className="page-subtitle">
              Schedule-linked field logs, Job Orders, Shift Huddle &amp; Performance KPIs
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button type="button" className="btn" onClick={() => router.push(`/activities?d=${addDays(p.date, -1)}`)} aria-label="Previous day">
              ‹
            </button>
            <input
              type="date"
              className="input"
              aria-label="Monitoring date"
              value={p.date}
              onChange={(e) => e.target.value && router.push(`/activities?d=${e.target.value}`)}
              style={{ width: 150 }}
            />
            <button type="button" className="btn" onClick={() => router.push(`/activities?d=${addDays(p.date, 1)}`)} aria-label="Next day">
              ›
            </button>
            {p.date !== p.today && (
              <button type="button" className="btn btn-primary" onClick={() => router.push(`/activities?d=${p.today}`)}>
                Today
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge
            tone="neutral"
            title="Photos uploaded to Supabase Storage auto-expire after 30 days to stay within storage limits."
          >
            30d Photo Retention ({photoRetention.activeWithPhotos} active)
          </Badge>

          {p.canVerifyActivity && (
            <button
              type="button"
              className="btn"
              disabled={purging}
              onClick={handlePurgeExpiredPhotos}
              style={{ fontSize: 12 }}
            >
              {purging ? 'Purging…' : `Purge Expired Photos${photoRetention.expiredCount > 0 ? ` (${photoRetention.expiredCount})` : ''}`}
            </button>
          )}

          {p.canLogActivity && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setLinkedJoForLog(null);
                setLoggerLeadOpId(p.operatorId);
                setLoggerOpen(true);
              }}
              style={{ fontWeight: 700 }}
            >
              + Log Activity
            </button>
          )}
        </div>
      </div>

      {p.schemaWarning && (
        <AlertBanner tone="warn">
          <b>Setup Notice:</b> {p.schemaWarning}
        </AlertBanner>
      )}

      {bannerMsg && (
        <AlertBanner tone={bannerMsg.startsWith('✓') ? 'ok' : 'danger'} onDismiss={() => setBannerMsg('')}>
          {bannerMsg}
        </AlertBanner>
      )}

      {offlineQueue.length > 0 && (
        <AlertBanner
          tone="warn"
          action={
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const res = await flushOfflineQueue(supabaseBrowser(), p.userId);
                setOfflineQueue(await getOfflineQueue(p.userId));
                if (res.synced.length > 0) {
                  setActivities((prev) => [...res.synced, ...prev]);
                  setBannerMsg(
                    res.failed > 0
                      ? `Synced ${res.synced.length} item(s); ${res.failed} failed — use Inspect Queue above.`
                      : `✓ Synced ${res.synced.length} offline item(s).`,
                  );
                } else if (res.failed > 0) {
                  setBannerMsg(`Sync failed for ${res.failed} item(s): ${res.errors[0]?.message ?? 'Check connection'}`);
                }
              }}
            >
              Sync Now
            </button>
          }
        >
          <b>{offlineQueue.length}</b> field activity log{offlineQueue.length === 1 ? '' : 's'} queued in browser IndexedDB (offline mode).
        </AlertBanner>
      )}

      {/* Navigation Tabs */}
      <SegmentedTabs
        ariaLabel="Activity monitoring sections"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'monitor', label: `${p.canVerifyActivity ? 'Duty & Activity Feed' : 'My Activity Logs'} (${dateActivities.length})` },
          { id: 'routes', label: `Routes & Distance (${dateActivities.filter((a) => isValidCoordinate(a.gps_lat, a.gps_lng)).length} GPS)` },
          { id: 'job-orders', label: `Job Orders (${filteredJobOrders.filter((j) => j.status === 'pending' || j.status === 'in_progress').length} open)` },
          { id: 'handovers', label: `Shift Handover & Huddle (${handovers.filter((h) => h.handover_date === p.date).length})` },
          ...(p.canVerifyActivity ? [{ id: 'kpis' as const, label: 'Employee KPIs & Fuel' }] : []),
        ]}
      />

      {/* TAB 1: DAILY DUTY & ACTIVITY FEED */}
      {tab === 'monitor' && (
        <div style={{ display: 'grid', gap: 14 }}>
          {!p.canLogActivity && (
            <div className="card" style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Activity submission is restricted to <b>operator</b> and <b>admin</b> logins. Your role (<b>{p.role === 'manager' ? 'dept head' : p.role}</b>) has monitoring{p.canVerifyActivity ? ' & verification' : ''} access.
            </div>
          )}

          {/* On-Duty Operator Activity Matrix (Supervisors / Admins / Dept Heads only) */}
          {p.canVerifyActivity && (
          <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong style={{ fontSize: 14.5 }}>On-Duty Operator Activity Matrix ({p.date})</strong>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Reconciles today&apos;s scheduled roster crew against logged activities and closed PM tasks.
                </div>
              </div>
              {idleOnDutyCount > 0 && (
                <span style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)', border: '1px solid var(--warn-border)', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                  ⚠️ {idleOnDutyCount} on-duty operator{idleOnDutyCount === 1 ? '' : 's'} with 0 logs yet
                </span>
              )}
            </div>

            {dutyMatrix.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                No operators scheduled on duty or standby for {p.date}.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(255px, 1fr))', gap: 8 }}>
                {dutyMatrix.map((row) => {
                  const hasOutput = row.logsCount > 0 || row.pmsClosedToday > 0;
                  const canLogForThisOp = p.isAdmin || (p.canLogActivity && p.operatorId === row.op.id);
                  const isFiltered = filterOpId === row.op.id;

                  return (
                    <div
                      key={row.op.id}
                      className="card"
                      style={{
                        padding: 10,
                        display: 'grid',
                        gap: 6,
                        background: isFiltered ? 'var(--info-bg)' : 'var(--surface-muted)',
                        borderColor: isFiltered ? 'var(--accent)' : hasOutput ? 'var(--ok-border)' : row.isOnDuty ? 'var(--warn-border)' : 'var(--border)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 6 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{row.op.full_name}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                            {row.shift ? `${row.shift.code}` : 'Unscheduled'} · {row.area ? row.area.code : row.isOnDuty ? DEFAULT_STATION_CODE : '—'}
                            {row.standbyType && (
                              <span style={{ marginLeft: 5, color: 'var(--violet)', fontWeight: 700 }}>· {row.standbyType}</span>
                            )}
                          </div>
                        </div>
                        <span
                          style={{
                            padding: '2px 7px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            background: hasOutput ? 'var(--ok-bg)' : 'var(--warn-bg)',
                            color: hasOutput ? 'var(--ok-fg)' : 'var(--warn-fg)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {hasOutput ? `✓ ${row.logsCount} log${row.logsCount === 1 ? '' : 's'}${row.pmsClosedToday ? ` + ${row.pmsClosedToday} PM` : ''}` : '⚠️ 0 logs'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        <span>Last: {row.lastTimestamp ? fmtTimeManila(row.lastTimestamp) : '—'}</span>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setFilterOpId(isFiltered ? '' : row.op.id)}
                            style={{ minHeight: 26, padding: '2px 8px', fontSize: 11 }}
                          >
                            {isFiltered ? 'Clear Filter' : 'Filter Feed'}
                          </button>
                          {canLogForThisOp && (
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => {
                                setLinkedJoForLog(null);
                                setLoggerLeadOpId(row.op.id);
                                setLoggerOpen(true);
                              }}
                              style={{ minHeight: 26, padding: '2px 8px', fontSize: 11 }}
                            >
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

          {/* Filter Bar for Feed */}
          <div className="card" style={{ padding: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Filter Logs:</strong>
            <select className="input" value={filterAreaId} onChange={(e) => setFilterAreaId(e.target.value)} style={{ width: 'auto', minWidth: 150 }}>
              <option value="">All Stations / Areas</option>
              {stationAreas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code}{a.name ? ` · ${a.name}` : ''}
                </option>
              ))}
            </select>
            <select className="input" value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: 'auto', minWidth: 170 }}>
              <option value="">All Activity Types</option>
              {ACTIVITY_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            {p.canVerifyActivity && (
              <select className="input" value={filterOpId} onChange={(e) => setFilterOpId(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
                <option value="">All Operators</option>
                {p.operators.map((o) => (
                  <option key={o.id} value={o.id}>{o.full_name}</option>
                ))}
              </select>
            )}
            <select className="input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'all' | 'submitted' | 'verified' | 'flagged')} style={{ width: 'auto', minWidth: 130 }}>
              <option value="all">All Statuses</option>
              <option value="submitted">Submitted</option>
              <option value="verified">Verified</option>
              <option value="flagged">Flagged</option>
            </select>
            {(filterAreaId || filterType || filterOpId || filterStatus !== 'all') && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setFilterAreaId('');
                  setFilterType('');
                  setFilterOpId('');
                  setFilterStatus('all');
                }}
                style={{ fontSize: 12 }}
              >
                Reset
              </button>
            )}
          </div>

          {/* Live Activity Feed Cards */}
          {filteredActivities.length === 0 ? (
            <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13.5 }}>
              No field activities match the current filter for <b>{p.date}</b>.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
              {filteredActivities.map((act) => {
                const def = ACTIVITY_BY_ID[act.activity_type];
                const area = act.area_code_id ? areaBy.get(act.area_code_id) : undefined;
                const lead = act.lead_operator_id ? opBy.get(act.lead_operator_id) : undefined;
                const crew = (act.crew_operator_ids ?? []).map((id) => opBy.get(id)?.full_name).filter(Boolean) as string[];
                const telemetry = formatTelemetrySummary(act);
                const expDays = daysUntil(act.photos_expires_at);

                return (
                  <div
                    key={act.id}
                    className="card"
                    style={{
                      padding: 14,
                      display: 'grid',
                      gap: 8,
                      borderLeft: `4px solid ${def?.color ?? 'var(--accent)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ background: def?.color ?? 'var(--primary)', color: '#ffffff', padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700 }}>
                        {def?.label ?? act.activity_type}
                      </span>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: act.status === 'verified' ? 'var(--ok-bg)' : act.status === 'flagged' ? 'var(--danger-bg)' : 'var(--info-bg)',
                          color: act.status === 'verified' ? 'var(--ok-fg)' : act.status === 'flagged' ? 'var(--danger-fg)' : 'var(--info-fg)',
                        }}
                      >
                        {act.status}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 700 }}>
                      <span>
                        {area ? `${area.code}${area.name ? ` · ${area.name}` : ''}` : 'Unassigned Area'}
                        {act.site_or_well ? ` — ${act.site_or_well}` : ''}
                      </span>
                      <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-secondary)' }}>
                        {fmtTimeManila(act.completed_at ?? act.created_at)}
                      </span>
                    </div>

                    {act.block_lot && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Location: {act.block_lot}</div>}

                    <div style={{ fontSize: 12.5 }}>
                      Lead: <b>{lead?.full_name ?? 'Unspecified'}</b>
                      {crew.length > 0 && (
                        <span style={{ color: 'var(--text-secondary)' }}> · Crew: {crew.join(', ')}</span>
                      )}
                    </div>

                    {telemetry.length > 0 && (
                      <div style={{ padding: '6px 9px', borderRadius: 6, background: 'var(--surface-muted)', fontSize: 12, display: 'grid', gap: 2 }}>
                        {telemetry.map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    )}

                    {act.notes && <div style={{ fontSize: 12.5 }}>{act.notes}</div>}

                    {act.review_note && (
                      <div style={{ fontSize: 12, color: 'var(--danger-fg)', background: 'var(--danger-bg)', padding: '5px 8px', borderRadius: 6 }}>
                        <b>Supervisor Note:</b> {act.review_note}
                      </div>
                    )}

                    {act.gps_lat != null && act.gps_lng != null && (() => {
                      const gpsMeta = extractGpsMetadata(act.details);
                      const gpsLabel = formatGpsBadgeLabel(act.details);
                      const gpsTone =
                        gpsMeta.gpsSource === 'map_pin'
                          ? 'warn'
                          : (gpsMeta.gpsAccuracyM ?? 99) <= 5
                            ? 'ok'
                            : 'info';
                      return (
                        <div style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <a
                            href={`https://maps.google.com/?q=${act.gps_lat},${act.gps_lng}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: 'var(--accent)', fontWeight: 600 }}
                          >
                            📍 GPS: {act.gps_lat}, {act.gps_lng}
                          </a>
                          {gpsLabel && <Badge size="sm" tone={gpsTone}>{gpsLabel}</Badge>}
                        </div>
                      );
                    })()}

                    {/* Photo thumbnails or purged notice */}
                    {act.photos_purged_at ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Photos auto-purged after 30-day storage retention ({act.photos_purged_at.slice(0, 10)}).
                      </div>
                    ) : Array.isArray(act.photo_urls) && act.photo_urls.length > 0 ? (
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {act.photo_urls.map((u, idx) => {
                            const photoSrc = resolveActivityPhotoUrl(u, act.photo_storage_paths?.[idx]);
                            return (
                              <a key={idx} href={photoSrc} target="_blank" rel="noreferrer">
                                <img
                                  src={photoSrc}
                                  alt={`Photo ${idx + 1}`}
                                  style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }}
                                />
                              </a>
                            );
                          })}
                        </div>
                        {expDays !== null && (
                          <span style={{ fontSize: 10.5, color: expDays <= 5 ? 'var(--warn-fg)' : 'var(--text-secondary)' }}>
                            {expDays > 0 ? `Storage auto-expires in ${expDays}d` : 'Photo retention expired — ready to purge'}
                          </span>
                        )}
                      </div>
                    ) : null}

                    {/* Action Bar */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, borderTop: '1px solid var(--border-light)', paddingTop: 8 }}>
                      {p.canVerifyActivity && act.status !== 'verified' && (
                        <button type="button" className="btn" onClick={() => void updateActivityVerification(act, 'verified')} style={{ fontSize: 11.5, background: 'var(--ok-bg)', color: 'var(--ok-fg)', borderColor: 'var(--ok-border)', fontWeight: 700 }}>
                          ✓ Verify
                        </button>
                      )}
                      {p.canVerifyActivity && act.status !== 'flagged' && (
                        <button type="button" className="btn" onClick={() => { setFlaggingId(flaggingId === act.id ? null : act.id); setFlagReason(''); }} style={{ fontSize: 11.5, color: 'var(--danger)' }}>
                          ⚠ Flag
                        </button>
                      )}
                      <button type="button" className="btn" onClick={() => setPrintState({ mode: 'activity', activity: act })} style={{ fontSize: 11.5 }}>
                        🖨 Print Report
                      </button>
                      {act.activity_type === 'meter_test' && (
                        <button type="button" className="btn" onClick={() => setPrintState({ mode: 'meter_test', activity: act })} style={{ fontSize: 11.5, color: 'var(--violet)', fontWeight: 700 }}>
                          🖨 Meter Certificate
                        </button>
                      )}
                      {act.activity_type === 'well_pull_out' && (
                        <button type="button" className="btn" onClick={() => setPrintState({ mode: 'well_pull_out', activity: act })} style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 700 }}>
                          🖨 Pull-Out Form
                        </button>
                      )}
                      {act.activity_type === 'tank_cleaning' && (
                        <button type="button" className="btn" onClick={() => setPrintState({ mode: 'tank_cleaning', activity: act })} style={{ fontSize: 11.5, color: 'var(--ok-fg)', fontWeight: 700 }}>
                          🖨 Tank Cleaning Report
                        </button>
                      )}
                      {(p.isAdmin || act.logged_by === p.userId) && act.status !== 'verified' && (
                        <>
                          <button type="button" className="btn" onClick={() => { setLinkedJoForLog(null); setEditingActivity(act); setLoggerOpen(true); }} style={{ fontSize: 11.5 }}>
                            Edit
                          </button>
                          <button type="button" className="btn" onClick={() => void handleDeleteActivity(act)} style={{ fontSize: 11.5, color: 'var(--danger)' }}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>

                    {flaggingId === act.id && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <input
                          className="input"
                          placeholder="Reason for flagging…"
                          value={flagReason}
                          onChange={(e) => setFlagReason(e.target.value)}
                          style={{ flex: 1, minHeight: 34, fontSize: 12 }}
                        />
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => void updateActivityVerification(act, 'flagged', flagReason)}
                          style={{ minHeight: 34, fontSize: 12 }}
                        >
                          Confirm
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 1B: DAILY FOOTPRINTS, ROUTES & DISTANCE */}
      {tab === 'routes' && (
        <ActivitiesRoutesTab
          date={p.date}
          canVerifyActivity={p.canVerifyActivity}
          operatorId={p.operatorId}
          operators={p.operators}
          areas={p.areas}
          activities={activities}
        />
      )}

      {/* TAB 2: DISPATCHED JOB ORDERS */}
      {tab === 'job-orders' && (
        <JobOrdersTab
          orgId={p.orgId}
          userId={p.userId}
          canManageJo={canManageJo}
          canLogActivity={p.canLogActivity}
          joFilter={joFilter}
          onChangeJoFilter={setJoFilter}
          filteredJobOrders={filteredJobOrders}
          operators={p.operators}
          stationAreas={stationAreas}
          opBy={opBy}
          areaBy={areaBy}
          onJobOrderCreated={(jo) => setJobOrders((prev) => [jo, ...prev])}
          onJobOrderUpdated={(jo) => setJobOrders((prev) => prev.map((x) => (x.id === jo.id ? jo : x)))}
          onFulfillJobOrder={(jo) => {
            setLinkedJoForLog(jo);
            setLoggerLeadOpId(jo.assigned_operator_ids?.[0] ?? p.operatorId);
            setLoggerOpen(true);
          }}
          onPrintJobOrder={(jo) => setPrintState({ mode: 'activity', jobOrder: jo })}
          onBannerMsg={setBannerMsg}
        />
      )}

      {/* TAB 3: SHIFT HANDOVER & DAILY HUDDLE */}
      {tab === 'handovers' && (
        <ShiftHandoversTab
          orgId={p.orgId}
          userId={p.userId}
          operatorId={p.operatorId}
          date={p.date}
          canLogHandover={canLogHandover}
          dateActivities={dateActivities}
          idleOnDutyCount={idleOnDutyCount}
          openHighJos={openHighJos}
          overduePms={overduePms}
          handovers={handovers}
          operators={p.operators}
          stationAreas={stationAreas}
          opBy={opBy}
          areaBy={areaBy}
          onHandoverCreated={(ho) => setHandovers((prev) => [ho, ...prev])}
          onBannerMsg={setBannerMsg}
        />
      )}

      {/* TAB 4: EMPLOYEE KPIs & FUEL TELEMETRY (Supervisors only) */}
      {tab === 'kpis' && p.canVerifyActivity && (
        <ActivitiesKpiTab
          anchorDate={p.date}
          operators={p.operators}
          areas={p.areas}
          shifts={p.shifts}
        />
      )}

      {/* Activity Logger Modal */}
      {p.canLogActivity && loggerOpen && (
        <ActivityLoggerModal
          open={loggerOpen}
          onClose={() => {
            setLoggerOpen(false);
            setLinkedJoForLog(null);
            setEditingActivity(null);
          }}
          onQueuedOffline={async (payload) => {
            await enqueueOfflineActivity(payload, p.userId);
            setOfflineQueue(await getOfflineQueue(p.userId));
            setBannerMsg('Saved to offline queue. It will auto-sync when online.');
          }}
          onSaved={(act, opts) => {
            if (!opts?.offline) {
              setActivities((prev) =>
                prev.some((x) => x.id === act.id)
                  ? prev.map((x) => (x.id === act.id ? act : x))
                  : [act, ...prev],
              );
              setBannerMsg(editingActivity ? '✓ Activity updated.' : '✓ Activity logged.');
            }
            if (linkedJoForLog) {
              setJobOrders((prev) =>
                prev.map((j) =>
                  j.id === linkedJoForLog.id
                    ? {
                        ...j,
                        status: 'completed',
                        completed_at: new Date().toISOString(),
                        ...(opts?.tatJustification ? { tat_justification: opts.tatJustification } : {}),
                      }
                    : j,
                ),
              );
            }
          }}
          orgId={p.orgId}
          userId={p.userId}
          operatorId={p.operatorId}
          date={p.date}
          operators={p.operators}
          areas={p.areas}
          shifts={p.shifts}
          assignments={dateAssignments}
          initialLeadOperatorId={loggerLeadOpId}
          linkedJobOrder={linkedJoForLog}
          editingActivity={editingActivity}
        />
      )}

      {/* Printable Certificate / Report Preview */}
      {printState && (
        <PrintableActivityReport
          mode={printState.mode}
          orgName={p.orgName}
          activity={printState.activity}
          jobOrder={printState.jobOrder}
          operators={p.operators}
          areas={p.areas}
          shifts={p.shifts}
          onClose={() => setPrintState(null)}
        />
      )}
    </div>
  );
}
