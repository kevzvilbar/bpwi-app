'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/error-utils';
import { resolveActivityPhotoUrl } from '@/lib/activity-media';
import {
  ACTIVITY_BY_ID,
  ACTIVITY_TYPES,
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  parse12DigitAccount,
  type ActivityCategory,
  type DailyActivityRow,
  type JobOrderRow,
  type ShiftHandoverRow,
} from '@/lib/activity-types';
import ActivityLoggerModal, { type LinkedJobOrder } from '@/components/ActivityLoggerModal';
import PrintableActivityReport from '@/components/PrintableActivityReport';
import ActivitiesKpiTab from '@/components/ActivitiesKpiTab';
import { enqueueOfflineActivity, flushOfflineQueue, getOfflineQueue, type PendingOfflineActivity } from '@/lib/offline-queue';

type MonOp = { id: string; full_name: string; position: string | null; phone_number: string | null; default_station: string | null };
type MonShift = { id: string; code: string; description: string | null; duration_hours: number; start_time: string | null; end_time: string | null; background_color: string; text_color: string; is_off: boolean };
type MonArea = { id: string; code: string; name: string | null; category: string; background_color: string; text_color: string; sub_sites?: string[] };
type MonAsg = { operator_id: string; schedule_date: string; shift_type_id: string | null; area_code_id: string | null };
type MonStandby = { operator_id: string; standby_type: string };
type MonPm = { id: string; activity_type: string; title: string; scheduled_date: string; completed_at: string | null; status: string; assigned_operator_ids: string[] };

function addDays(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function fmtTimeManila(iso: string | null | undefined) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
  }).format(dt);
}

function fmtDateTimeManila(iso: string | null | undefined) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(dt);
}

function daysUntil(iso: string | null | undefined) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function formatTelemetrySummary(act: DailyActivityRow): string[] {
  const d = act.details ?? {};
  const parts: string[] = [];
  if (act.activity_type === 'genset_monitoring') {
    if (d.gensetInitialFuel !== undefined || d.gensetFinalFuel !== undefined) {
      parts.push(`Fuel: ${d.gensetInitialFuel ?? '—'} → ${d.gensetFinalFuel ?? '—'}`);
    }
    if (d.runningHours !== undefined && d.runningHours !== null) parts.push(`Run: ${d.runningHours}h`);
    if (d.gensetCause) parts.push(`Cause: ${d.gensetCause}`);
  } else if (act.activity_type === 'pump_monitoring') {
    if (d.pressurePsi !== undefined && d.pressurePsi !== null) parts.push(`${d.pressurePsi} PSI`);
    if (d.flowLps !== undefined && d.flowLps !== null) parts.push(`${d.flowLps} LPS`);
    if (d.totalizerReading !== undefined && d.totalizerReading !== null) parts.push(`Totalizer: ${d.totalizerReading} m³`);
    if (d.chlorineResidual !== undefined && d.chlorineResidual !== null) parts.push(`Cl₂: ${d.chlorineResidual} mg/L`);
  } else if (act.activity_type === 'flushing') {
    if (d.flushingInitialRead !== undefined || d.flushingFinalRead !== undefined) {
      parts.push(`Main Read: ${d.flushingInitialRead ?? '—'} → ${d.flushingFinalRead ?? '—'}`);
    }
    if (Array.isArray(d.blowOffs) && d.blowOffs.length > 0) {
      parts.push(`${d.blowOffs.length} blow-off point(s)`);
    }
  } else if (act.activity_type === 'meter_test') {
    if (d.accountNumber) parts.push(`Acct: ${d.accountNumber}`);
    if (d.accountName) parts.push(d.accountName);
    if (d.avgErr !== undefined && d.avgErr !== null) {
      parts.push(`Avg Err: ${d.avgErr}% (${d.verdict ?? ''} · ${d.recommendation ?? ''})`);
    }
  } else if (d.accountNumber || d.accountName) {
    parts.push(`Acct: ${[d.accountNumber, d.accountName].filter(Boolean).join(' · ')}`);
  }
  if (act.activity_type === 'leak_repair' || act.activity_type === 'leak_detection') {
    if (d.pipeSize) parts.push(`Pipe: ${d.pipeSize}`);
    if (d.leakType) parts.push(`Cause: ${d.leakType}`);
    if (Array.isArray(d.usedMaterials) && d.usedMaterials.length > 0) {
      const mats = d.usedMaterials as Array<{ item?: unknown; qty?: unknown }>;
      parts.push(`Materials: ${mats.map((m) => `${String(m.item ?? '')} (${String(m.qty ?? '')})`).join(', ')}`);
    }
  }
  if (act.activity_type === 'tankering' && Array.isArray(d.haulingCycles)) {
    const cycles = d.haulingCycles as Array<{ volumeM3?: unknown }>;
    const totalVol = cycles.reduce((acc: number, c) => acc + (Number(c.volumeM3) || 0), 0);
    parts.push(`${cycles.length} trip(s) · ${totalVol} m³`);
    if (d.plateNumber) parts.push(`Plate: ${d.plateNumber}`);
  }
  if (act.activity_type === 'water_sampling') {
    if (d.chlorineResidual !== undefined && d.chlorineResidual !== null) parts.push(`Cl₂: ${d.chlorineResidual} mg/L`);
    if (d.turbidityNtu !== undefined && d.turbidityNtu !== null) parts.push(`Turb: ${d.turbidityNtu} NTU`);
    if (d.phLevel !== undefined && d.phLevel !== null) parts.push(`pH: ${d.phLevel}`);
  }
  if (act.activity_type === 'backwash') {
    if (d.filterUnit) parts.push(`Unit: ${d.filterUnit}`);
    if (d.backwashDurationMin !== undefined && d.backwashDurationMin !== null) parts.push(`${d.backwashDurationMin} mins`);
    if (d.pressurePsi !== undefined && d.pressurePsi !== null) parts.push(`${d.pressurePsi} PSI`);
    if (d.waterClarity) parts.push(`Clarity: ${d.waterClarity}`);
  }
  if (act.activity_type === 'thermal_scanning') {
    if (d.scannedEquipment) parts.push(`Equip: ${d.scannedEquipment}`);
    if (d.maxTempC !== undefined && d.maxTempC !== null) parts.push(`Max: ${d.maxTempC}°C`);
    if (d.hotspotFound) parts.push(`Hotspot: ${d.hotspotFound}`);
  }
  if (act.activity_type === 'water_level_monitoring') {
    if (d.swlMeters !== undefined && d.swlMeters !== null) parts.push(`SWL: ${d.swlMeters}m`);
    if (d.pwlMeters !== undefined && d.pwlMeters !== null) parts.push(`PWL: ${d.pwlMeters}m`);
    if (d.drawdownMeters !== undefined && d.drawdownMeters !== null) parts.push(`Drawdown: ${d.drawdownMeters}m`);
  }
  return parts;
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
  const [tab, setTab] = useState<'monitor' | 'job-orders' | 'handovers' | 'kpis'>('monitor');
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
    mode: 'activity' | 'meter_test';
    activity?: DailyActivityRow | null;
    jobOrder?: JobOrderRow | null;
  } | null>(null);

  // Flag review inline state
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState('');

  // Storage purge feedback
  const [purging, setPurging] = useState(false);
  const [bannerMsg, setBannerMsg] = useState('');

  // Job Orders tab state
  const canManageJo = p.isAdmin || p.role === 'scheduler' || p.role === 'manager';
  const [joFilter, setJoFilter] = useState<'open' | 'completed' | 'all'>('open');
  const [joModalOpen, setJoModalOpen] = useState(false);
  const [joTitle, setJoTitle] = useState('');
  const [joActivityType, setJoActivityType] = useState('leak_repair');
  const [joPriority, setJoPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [joAreaId, setJoAreaId] = useState('');
  const [joSite, setJoSite] = useState('');
  const [joBlockLot, setJoBlockLot] = useState('');
  const [joAccountNo, setJoAccountNo] = useState('');
  const [joAccountName, setJoAccountName] = useState('');
  const [joContactNo, setJoContactNo] = useState('');
  const [joDesc, setJoDesc] = useState('');
  const [joDeadline, setJoDeadline] = useState('');
  const [joEstHours, setJoEstHours] = useState('2');
  const [joAssignedOps, setJoAssignedOps] = useState<string[]>([]);
  const [savingJo, setSavingJo] = useState(false);

  // Shift Handover tab state
  const canLogHandover = p.canLogActivity || p.canVerifyActivity;
  const [hoAreaId, setHoAreaId] = useState('');
  const [hoShiftId, setHoShiftId] = useState('');
  const [hoOutOpId, setHoOutOpId] = useState(p.operatorId ?? '');
  const [hoInOpId, setHoInOpId] = useState('');
  const [hoPlantStatus, setHoPlantStatus] = useState<'normal' | 'watch' | 'critical'>('normal');
  const [hoSummary, setHoSummary] = useState('');
  const [hoPending, setHoPending] = useState('');
  const [hoChemFuel, setHoChemFuel] = useState('');
  const [savingHo, setSavingHo] = useState(false);

  useEffect(() => setActivities(p.activities), [p.activities]);
  useEffect(() => setJobOrders(p.jobOrders), [p.jobOrders]);
  useEffect(() => setHandovers(p.handovers), [p.handovers]);

  // Realtime sync
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb
      .channel('bpwi-activities-hub')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_activities' }, (payload) => {
        const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as DailyActivityRow;
        if (!rec?.id) return;
        if (payload.eventType === 'DELETE') {
          setActivities((prev) => prev.filter((x) => x.id !== rec.id));
        } else {
          setActivities((prev) => (prev.some((x) => x.id === rec.id) ? prev.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...prev]));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_orders' }, (payload) => {
        const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as JobOrderRow;
        if (!rec?.id) return;
        if (payload.eventType === 'DELETE') {
          setJobOrders((prev) => prev.filter((x) => x.id !== rec.id));
        } else {
          setJobOrders((prev) => (prev.some((x) => x.id === rec.id) ? prev.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...prev]));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_handovers' }, (payload) => {
        const rec = (payload.eventType === 'DELETE' ? payload.old : payload.new) as ShiftHandoverRow;
        if (!rec?.id) return;
        if (payload.eventType === 'DELETE') {
          setHandovers((prev) => prev.filter((x) => x.id !== rec.id));
        } else {
          setHandovers((prev) => (prev.some((x) => x.id === rec.id) ? prev.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...prev]));
        }
      })
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, []);

  // Offline queue listener & auto-flush
  useEffect(() => {
    let active = true;
    const syncNow = async () => {
      const q = await getOfflineQueue();
      if (!active) return;
      setOfflineQueue(q);
      if (q.length > 0 && navigator.onLine) {
        const res = await flushOfflineQueue(supabaseBrowser());
        if (!active) return;
        if (res.synced.length > 0) {
          setActivities((prev) => [...res.synced, ...prev]);
          setBannerMsg(`✓ Synced ${res.synced.length} offline activity log(s).`);
        }
        setOfflineQueue(await getOfflineQueue());
      }
    };
    void syncNow();
    window.addEventListener('online', syncNow);
    return () => {
      active = false;
      window.removeEventListener('online', syncNow);
    };
  }, []);

  // Lookup maps
  const opBy = useMemo(() => new Map(p.operators.map((o) => [o.id, o])), [p.operators]);
  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);
  const standbyByOp = useMemo(() => new Map(p.standby.map((s) => [s.operator_id, s.standby_type])), [p.standby]);
  const stationAreas = useMemo(() => {
    const st = p.areas.filter((a) => a.category === 'station');
    return st.length > 0 ? st : p.areas.filter((a) => a.category !== 'leave' && a.category !== 'rest' && a.category !== 'holiday');
  }, [p.areas]);

  const dateAssignments = useMemo(
    () => p.assignments.filter((a) => a.schedule_date === p.date),
    [p.assignments, p.date],
  );
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
      .select('*')
      .single();

    if (error) {
      setBannerMsg(`Could not update verification: ${error.message}`);
      return;
    }
    setActivities((prev) => prev.map((x) => (x.id === act.id ? (data as DailyActivityRow) : x)));
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

  async function handleCreateJobOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!joTitle.trim()) return;
    setSavingJo(true);
    const parsedAcct = parse12DigitAccount(joAccountNo);

    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('job_orders')
      .insert({
        organization_id: p.orgId,
        jo_number: 'AUTO',
        title: joTitle.trim(),
        activity_type: joActivityType || null,
        priority: joPriority,
        area_code_id: joAreaId || null,
        site_or_well: joSite.trim() || (parsedAcct ? `Phase ${parsedAcct.phaseCode}` : null),
        block_lot: joBlockLot.trim() || parsedAcct?.blockLotFormatted || null,
        account_number: joAccountNo.trim() || null,
        account_name: joAccountName.trim() || null,
        contact_number: joContactNo.trim() || null,
        description: joDesc.trim() || null,
        assigned_operator_ids: joAssignedOps,
        deadline: joDeadline ? new Date(`${joDeadline}:00+08:00`).toISOString() : null,
        estimated_hours: Number(joEstHours) || 2,
        status: 'pending',
        created_by: p.userId,
      })
      .select('*')
      .single();

    setSavingJo(false);
    if (error) {
      setBannerMsg(`Job order error: ${error.message}`);
      return;
    }
    setJobOrders((prev) => [data as JobOrderRow, ...prev]);
    setJoModalOpen(false);
    setJoTitle('');
    setJoAccountNo('');
    setJoAccountName('');
    setJoContactNo('');
    setJoBlockLot('');
    setJoSite('');
    setJoDesc('');
    setJoAssignedOps([]);
    setBannerMsg(`✓ Dispatched ${(data as JobOrderRow).jo_number}.`);
  }

  async function updateJobOrderStatus(jo: JobOrderRow, nextStatus: JobOrderRow['status']) {
    const sb = supabaseBrowser();
    const updates: Record<string, unknown> = {
      status: nextStatus,
      completed_at: nextStatus === 'completed' ? new Date().toISOString() : null,
    };
    const { data, error } = await sb.from('job_orders').update(updates).eq('id', jo.id).select('*').single();
    if (error) {
      setBannerMsg(`Update failed: ${error.message}`);
      return;
    }
    setJobOrders((prev) => prev.map((x) => (x.id === jo.id ? (data as JobOrderRow) : x)));
  }

  async function handleSaveHandover(e: React.FormEvent) {
    e.preventDefault();
    if (!hoSummary.trim()) return;
    setSavingHo(true);
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('shift_handovers')
      .insert({
        organization_id: p.orgId,
        handover_date: p.date,
        shift_type_id: hoShiftId || null,
        area_code_id: hoAreaId || null,
        outgoing_operator_id: hoOutOpId || null,
        incoming_operator_id: hoInOpId || null,
        plant_status: hoPlantStatus,
        summary: hoSummary.trim(),
        pending_items: hoPending.trim() || null,
        chemical_fuel_notes: hoChemFuel.trim() || null,
        created_by: p.userId,
      })
      .select('*')
      .single();

    setSavingHo(false);
    if (error) {
      setBannerMsg(`Handover save error: ${error.message}`);
      return;
    }
    setHandovers((prev) => [data as ShiftHandoverRow, ...prev]);
    setHoSummary('');
    setHoPending('');
    setHoChemFuel('');
    setBannerMsg('✓ Shift handover recorded.');
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
            <h1 style={{ margin: 0, fontSize: 18 }}>Daily Employee Activity Monitor</h1>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Schedule-linked field logs, Job Orders, Shift Huddle &amp; Performance KPIs
            </div>
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
          <span
            style={{
              fontSize: 11.5,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'var(--surface-muted)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
            title="Photos uploaded to Supabase Storage auto-expire after 30 days to stay within storage limits."
          >
            30d Photo Retention ({photoRetention.activeWithPhotos} active)
          </span>

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
        <div role="alert" style={{ padding: '10px 14px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12.5 }}>
          <b>Setup Notice:</b> {p.schemaWarning}
        </div>
      )}

      {bannerMsg && (
        <div
          role="status"
          style={{
            padding: '9px 14px',
            borderRadius: 8,
            background: bannerMsg.startsWith('✓') ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${bannerMsg.startsWith('✓') ? '#bbf7d0' : '#fecaca'}`,
            color: bannerMsg.startsWith('✓') ? '#166534' : '#991b1b',
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{bannerMsg}</span>
          <button type="button" onClick={() => setBannerMsg('')} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700 }}>
            ✕
          </button>
        </div>
      )}

      {offlineQueue.length > 0 && (
        <div className="card" style={{ padding: '9px 14px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            <b>{offlineQueue.length}</b> field activity log{offlineQueue.length === 1 ? '' : 's'} queued in browser IndexedDB (offline mode).
          </span>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const res = await flushOfflineQueue(supabaseBrowser());
              setOfflineQueue(await getOfflineQueue());
              if (res.synced.length > 0) {
                setActivities((prev) => [...res.synced, ...prev]);
                setBannerMsg(`✓ Synced ${res.synced.length} offline item(s).`);
              }
            }}
          >
            Sync Now
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(
          [
            { id: 'monitor', label: `${p.canVerifyActivity ? 'Duty & Activity Feed' : 'My Activity Logs'} (${dateActivities.length})` },
            { id: 'job-orders', label: `Job Orders (${filteredJobOrders.filter((j) => j.status === 'pending' || j.status === 'in_progress').length} open)` },
            { id: 'handovers', label: `Shift Handover & Huddle (${handovers.filter((h) => h.handover_date === p.date).length})` },
            ...(p.canVerifyActivity ? [{ id: 'kpis' as const, label: 'Employee KPIs & Fuel' }] : []),
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn ${tab === t.id ? 'btn-primary' : ''}`}
            onClick={() => setTab(t.id)}
            style={{ fontWeight: 700 }}
          >
            {t.label}
          </button>
        ))}
      </div>

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
                <span style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
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
                        background: isFiltered ? 'rgba(3, 105, 161, 0.08)' : 'var(--surface-muted)',
                        borderColor: isFiltered ? 'var(--accent)' : hasOutput ? '#bbf7d0' : row.isOnDuty ? '#fde68a' : 'var(--border)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 6 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{row.op.full_name}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                            {row.shift ? `${row.shift.code}` : 'Unscheduled'} · {row.area ? row.area.code : row.isOnDuty ? 'PW' : '—'}
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
                            background: hasOutput ? '#dcfce7' : '#fef3c7',
                            color: hasOutput ? '#166534' : '#92400e',
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
                          background: act.status === 'verified' ? '#dcfce7' : act.status === 'flagged' ? '#fee2e2' : '#dbeafe',
                          color: act.status === 'verified' ? '#166534' : act.status === 'flagged' ? '#991b1b' : '#1e40af',
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
                      <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', padding: '5px 8px', borderRadius: 6 }}>
                        <b>Supervisor Note:</b> {act.review_note}
                      </div>
                    )}

                    {act.gps_lat !== null && act.gps_lng !== null && (
                      <div style={{ fontSize: 11.5 }}>
                        <a
                          href={`https://maps.google.com/?q=${act.gps_lat},${act.gps_lng}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--accent)', fontWeight: 600 }}
                        >
                          📍 GPS: {act.gps_lat}, {act.gps_lng}
                        </a>
                      </div>
                    )}

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
                          <span style={{ fontSize: 10.5, color: expDays <= 5 ? '#b45309' : 'var(--text-secondary)' }}>
                            {expDays > 0 ? `Storage auto-expires in ${expDays}d` : 'Photo retention expired — ready to purge'}
                          </span>
                        )}
                      </div>
                    ) : null}

                    {/* Action Bar */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, borderTop: '1px solid var(--border-light)', paddingTop: 8 }}>
                      {p.canVerifyActivity && act.status !== 'verified' && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void updateActivityVerification(act, 'verified')}
                          style={{ fontSize: 11.5, background: '#dcfce7', color: '#166534', borderColor: '#bbf7d0', fontWeight: 700 }}
                        >
                          ✓ Verify
                        </button>
                      )}
                      {p.canVerifyActivity && act.status !== 'flagged' && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setFlaggingId(flaggingId === act.id ? null : act.id);
                            setFlagReason('');
                          }}
                          style={{ fontSize: 11.5, color: '#b91c1c' }}
                        >
                          ⚠ Flag
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setPrintState({ mode: 'activity', activity: act })}
                        style={{ fontSize: 11.5 }}
                      >
                        🖨 Print Report
                      </button>
                      {act.activity_type === 'meter_test' && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setPrintState({ mode: 'meter_test', activity: act })}
                          style={{ fontSize: 11.5, color: 'var(--violet)', fontWeight: 700 }}
                        >
                          🖨 Meter Certificate
                        </button>
                      )}
                      {(p.isAdmin || act.logged_by === p.userId) && act.status !== 'verified' && (
                        <>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setLinkedJoForLog(null);
                              setEditingActivity(act);
                              setLoggerOpen(true);
                            }}
                            style={{ fontSize: 11.5 }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void handleDeleteActivity(act)}
                            style={{ fontSize: 11.5, color: 'var(--danger)' }}
                          >
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

      {/* TAB 2: DISPATCHED JOB ORDERS */}
      {tab === 'job-orders' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['open', 'completed', 'all'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`btn ${joFilter === f ? 'btn-primary' : ''}`}
                  onClick={() => setJoFilter(f)}
                  style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'capitalize' }}
                >
                  {f}
                </button>
              ))}
            </div>
            {canManageJo && (
              <button type="button" className="btn btn-primary" onClick={() => setJoModalOpen(true)} style={{ fontWeight: 700 }}>
                + Dispatch Job Order
              </button>
            )}
          </div>

          {filteredJobOrders.length === 0 ? (
            <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)' }}>
              No job orders in this filter.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 12 }}>
              {filteredJobOrders.map((jo) => {
                const area = jo.area_code_id ? areaBy.get(jo.area_code_id) : undefined;
                const crew = (jo.assigned_operator_ids ?? []).map((id) => opBy.get(id)?.full_name).filter(Boolean);
                const isOverdue = Boolean(jo.deadline && jo.status !== 'completed' && jo.status !== 'cancelled' && new Date(jo.deadline).getTime() < Date.now());
                const tatHours =
                  jo.completed_at && jo.created_at
                    ? ((new Date(jo.completed_at).getTime() - new Date(jo.created_at).getTime()) / (1000 * 60 * 60)).toFixed(1)
                    : null;

                return (
                  <div
                    key={jo.id}
                    className="card"
                    style={{
                      padding: 14,
                      display: 'grid',
                      gap: 8,
                      borderLeft: `4px solid ${jo.priority === 'high' ? '#dc2626' : jo.priority === 'medium' ? '#f59e0b' : '#0284c7'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 13.5 }}>{jo.jo_number}</strong>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            background: jo.priority === 'high' ? '#fee2e2' : jo.priority === 'medium' ? '#fef3c7' : '#e0f2fe',
                            color: jo.priority === 'high' ? '#991b1b' : jo.priority === 'medium' ? '#92400e' : '#0369a1',
                          }}
                        >
                          {jo.priority}
                        </span>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            background: jo.status === 'completed' ? '#dcfce7' : isOverdue ? '#ffe4e6' : 'var(--surface-muted)',
                            color: jo.status === 'completed' ? '#166534' : isOverdue ? '#9f1239' : 'var(--text)',
                          }}
                        >
                          {isOverdue ? 'SLA Breach' : jo.status.replace('_', ' ')}
                        </span>
                      </div>
                    </div>

                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{jo.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {area ? `${area.code}${area.name ? ` · ${area.name}` : ''}` : 'General'}
                      {jo.site_or_well ? ` · ${jo.site_or_well}` : ''}
                      {jo.block_lot ? ` · ${jo.block_lot}` : ''}
                    </div>
                    {(jo.account_number || jo.account_name) && (
                      <div style={{ fontSize: 12 }}>
                        Customer: <b>{[jo.account_number, jo.account_name].filter(Boolean).join(' · ')}</b>
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Assigned: <b>{crew.length > 0 ? crew.join(', ') : 'Unassigned'}</b>
                    </div>
                    {jo.description && <div style={{ fontSize: 12.5 }}>{jo.description}</div>}
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                      <span>Deadline: {jo.deadline ? fmtDateTimeManila(jo.deadline) : 'None'}</span>
                      {tatHours && <span>TAT: <b>{tatHours} hrs</b></span>}
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--border-light)', paddingTop: 8 }}>
                      {p.canLogActivity && (jo.status === 'pending' || jo.status === 'in_progress') && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => {
                            setLinkedJoForLog(jo);
                            setLoggerLeadOpId(jo.assigned_operator_ids?.[0] ?? p.operatorId);
                            setLoggerOpen(true);
                          }}
                          style={{ fontSize: 12, fontWeight: 700 }}
                        >
                          Fulfill &amp; Log Activity
                        </button>
                      )}
                      {jo.status === 'pending' && (
                        <button type="button" className="btn" onClick={() => void updateJobOrderStatus(jo, 'in_progress')} style={{ fontSize: 12 }}>
                          Start Work
                        </button>
                      )}
                      <button type="button" className="btn" onClick={() => setPrintState({ mode: 'activity', jobOrder: jo })} style={{ fontSize: 12 }}>
                        🖨 Print JO
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: SHIFT HANDOVER & DAILY HUDDLE */}
      {tab === 'handovers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 12 }}>
            {/* Daily Huddle Brief Card */}
            <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
              <strong style={{ fontSize: 15 }}>Daily Operations Huddle Brief ({p.date})</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--surface-muted)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Field Activities Today</div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>
                    {dateActivities.length}{' '}
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#16a34a' }}>
                      ({dateActivities.filter((a) => a.status === 'verified').length} verified)
                    </span>
                  </div>
                </div>
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--surface-muted)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Open Alerts</div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
                    <div>{idleOnDutyCount} idle on-duty ops</div>
                    <div>{openHighJos} high-prio JO · {overduePms} overdue PM</div>
                  </div>
                </div>
              </div>
            </div>

            {canLogHandover && (
              <form className="card" onSubmit={handleSaveHandover} style={{ padding: 14, display: 'grid', gap: 10 }}>
                <strong style={{ fontSize: 14.5 }}>Log Shift Handover Note</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                    Station / Area
                    <select className="input" value={hoAreaId} onChange={(e) => setHoAreaId(e.target.value)}>
                      <option value="">All / General</option>
                      {stationAreas.map((a) => (
                        <option key={a.id} value={a.id}>{a.code}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                    Plant Status
                    <select className="input" value={hoPlantStatus} onChange={(e) => setHoPlantStatus(e.target.value as 'normal' | 'watch' | 'critical')}>
                      <option value="normal">Normal</option>
                      <option value="watch">Watch / Caution</option>
                      <option value="critical">Critical Alert</option>
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                    Outgoing Operator
                    <select className="input" value={hoOutOpId} onChange={(e) => setHoOutOpId(e.target.value)}>
                      <option value="">— Select —</option>
                      {p.operators.map((o) => (
                        <option key={o.id} value={o.id}>{o.full_name}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                    Incoming Operator
                    <select className="input" value={hoInOpId} onChange={(e) => setHoInOpId(e.target.value)}>
                      <option value="">— Select —</option>
                      {p.operators.map((o) => (
                        <option key={o.id} value={o.id}>{o.full_name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                  Shift Summary *
                  <textarea
                    className="input"
                    required
                    rows={2}
                    placeholder="Pump run status, tank levels, major actions completed…"
                    value={hoSummary}
                    onChange={(e) => setHoSummary(e.target.value)}
                    style={{ minHeight: 56 }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                  Pending / Follow-up Items
                  <input className="input" value={hoPending} onChange={(e) => setHoPending(e.target.value)} placeholder="Items for incoming shift" />
                </label>
                <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                  Chemical / Fuel Notes
                  <input className="input" value={hoChemFuel} onChange={(e) => setHoChemFuel(e.target.value)} placeholder="Chlorine stock, diesel level, etc." />
                </label>
                <button type="submit" className="btn btn-primary" disabled={savingHo}>
                  {savingHo ? 'Saving Handover…' : 'Save Handover Entry'}
                </button>
              </form>
            )}
          </div>

          <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
            <strong style={{ fontSize: 14.5 }}>Recent Shift Handovers (Last 14 Days)</strong>
            {handovers.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No handover entries logged yet.</div>
            ) : (
              handovers.map((h) => {
                const area = h.area_code_id ? areaBy.get(h.area_code_id) : undefined;
                const outOp = h.outgoing_operator_id ? opBy.get(h.outgoing_operator_id) : undefined;
                const inOp = h.incoming_operator_id ? opBy.get(h.incoming_operator_id) : undefined;
                return (
                  <div
                    key={h.id}
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      borderLeft: `4px solid ${h.plant_status === 'critical' ? '#dc2626' : h.plant_status === 'watch' ? '#f59e0b' : '#16a34a'}`,
                      display: 'grid',
                      gap: 4,
                      fontSize: 12.5,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <b>{h.handover_date} · {area ? area.code : 'All Stations'}</b>
                      <span style={{ textTransform: 'uppercase', fontSize: 11, fontWeight: 800, color: h.plant_status === 'critical' ? '#dc2626' : h.plant_status === 'watch' ? '#b45309' : '#166534' }}>
                        {h.plant_status}
                      </span>
                    </div>
                    {(outOp || inOp) && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {outOp?.full_name ?? 'Outgoing'} → {inOp?.full_name ?? 'Incoming'}
                      </div>
                    )}
                    <div>{h.summary}</div>
                    {h.pending_items && <div style={{ color: '#b45309' }}><b>Pending:</b> {h.pending_items}</div>}
                    {h.chemical_fuel_notes && <div style={{ color: 'var(--text-secondary)' }}><b>Chem/Fuel:</b> {h.chemical_fuel_notes}</div>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 4: EMPLOYEE KPIs & FUEL TELEMETRY (Supervisors only) */}
      {tab === 'kpis' && p.canVerifyActivity && (
        <ActivitiesKpiTab
          anchorDate={p.date}
          operators={p.operators}
          areas={p.areas}
          shifts={p.shifts}
          assignments={p.assignments}
          activities={activities}
          pmTasks={p.pmTasks}
          jobOrders={jobOrders}
        />
      )}

      {/* Activity Logger Modal */}
      {p.canLogActivity && (
        <ActivityLoggerModal
          open={loggerOpen}
          onClose={() => {
            setLoggerOpen(false);
            setLinkedJoForLog(null);
            setEditingActivity(null);
          }}
          onQueuedOffline={async (payload) => {
            await enqueueOfflineActivity(payload);
            setOfflineQueue(await getOfflineQueue());
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
                  j.id === linkedJoForLog.id ? { ...j, status: 'completed', completed_at: new Date().toISOString() } : j,
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

      {/* Dispatch Job Order Modal */}
      {joModalOpen && (
        <div className="modal-overlay no-print" role="dialog" aria-modal="true" onClick={() => !savingJo && setJoModalOpen(false)}>
          <form className="modal-sheet" onClick={(e) => e.stopPropagation()} onSubmit={handleCreateJobOrder} style={{ maxWidth: 580, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 17 }}>Dispatch Field Job Order</h2>
              <button type="button" className="btn" onClick={() => setJoModalOpen(false)}>✕</button>
            </div>
            <label style={{ display: 'grid', gap: 3, fontSize: 12.5, fontWeight: 600 }}>
              Job Title *
              <input className="input" required value={joTitle} onChange={(e) => setJoTitle(e.target.value)} placeholder="e.g. Service line leak repair at Block 4 Lot 9" />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Linked Activity Type
                <select className="input" value={joActivityType} onChange={(e) => setJoActivityType(e.target.value)}>
                  {ACTIVITY_CATEGORIES.map((cat: ActivityCategory) => (
                    <optgroup key={cat} label={ACTIVITY_CATEGORY_LABELS[cat]}>
                      {ACTIVITY_TYPES.filter((a) => a.category === cat).map((a) => (
                        <option key={a.id} value={a.id}>{a.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Priority
                <select className="input" value={joPriority} onChange={(e) => setJoPriority(e.target.value as 'low' | 'medium' | 'high')}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High (Urgent)</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Account # (12-char auto-parse)
                <input
                  className="input"
                  value={joAccountNo}
                  onChange={(e) => {
                    setJoAccountNo(e.target.value);
                    const parsed = parse12DigitAccount(e.target.value);
                    if (parsed) {
                      if (!joBlockLot) setJoBlockLot(parsed.blockLotFormatted);
                      if (!joSite) setJoSite(`Phase ${parsed.phaseCode}`);
                    }
                  }}
                  placeholder="Optional 12-char account #"
                />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Account Name
                <input className="input" value={joAccountName} onChange={(e) => setJoAccountName(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Area / Station
                <select className="input" value={joAreaId} onChange={(e) => setJoAreaId(e.target.value)}>
                  <option value="">— Select Station —</option>
                  {stationAreas.map((a) => (
                    <option key={a.id} value={a.id}>{a.code}{a.name ? ` · ${a.name}` : ''}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Block &amp; Lot / Site
                <input className="input" value={joBlockLot} onChange={(e) => setJoBlockLot(e.target.value)} placeholder="e.g. Block 004 Lot 009" />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Deadline (Manila Time)
                <input className="input" type="datetime-local" value={joDeadline} onChange={(e) => setJoDeadline(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Est. SLA Hours
                <input className="input" type="number" step="0.5" value={joEstHours} onChange={(e) => setJoEstHours(e.target.value)} />
              </label>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Assign Crew Operators:</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxHeight: 110, overflow: 'auto' }}>
                {p.operators.map((op) => {
                  const sel = joAssignedOps.includes(op.id);
                  return (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => setJoAssignedOps((prev) => (sel ? prev.filter((x) => x !== op.id) : [...prev, op.id]))}
                      style={{
                        padding: '3px 9px',
                        borderRadius: 999,
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: sel ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                        background: sel ? 'var(--primary)' : 'var(--surface-muted)',
                        color: sel ? 'var(--primary-fg)' : 'var(--text)',
                      }}
                    >
                      {sel ? '✓ ' : '+ '}{op.full_name}
                    </button>
                  );
                })}
              </div>
            </div>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
              Instructions / Description
              <textarea className="input" rows={2} value={joDesc} onChange={(e) => setJoDesc(e.target.value)} style={{ minHeight: 54 }} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setJoModalOpen(false)} disabled={savingJo}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={savingJo}>{savingJo ? 'Dispatching…' : 'Dispatch JO'}</button>
            </div>
          </form>
        </div>
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
