'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  DAILY_ACTIVITY_GENSET_COLUMNS,
  DAILY_ACTIVITY_KPI_COLUMNS,
  JOB_ORDER_KPI_COLUMNS,
  PM_TASK_KPI_COLUMNS,
  PM_TASK_KPI_COLUMNS_LEGACY,
} from '@/lib/query-columns';
import { computeOperatorPmKpis, isMissingCompletedByColumnError } from '@/lib/pm-credit';
import {
  ACTIVITY_BY_ID,
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  type ActivityCategory,
} from '@/lib/activity-types';
import { AlertBanner, Badge, SegmentedTabs, type BadgeTone } from '@/components/ui';
import {
  evaluateGensetHealth,
  formatGensetRunModeShort,
  hasGensetChecklistDetails,
  hydrateGensetMonitoringDetails,
  type GensetStandbyVerdict,
} from '@/lib/genset-monitoring';

type KpiOp = { id: string; full_name: string; position: string | null };
type KpiArea = { id: string; code: string; name: string | null; category: string };
type KpiShift = { id: string; code: string; duration_hours: number; is_off: boolean };
type KpiAsg = { operator_id: string; schedule_date: string; shift_type_id: string | null; area_code_id: string | null };
type KpiPm = {
  id: string;
  scheduled_date: string;
  completed_at: string | null;
  status: string;
  assigned_operator_ids: string[];
  completed_by_operator_ids?: string[] | null;
};
type KpiAct = {
  id: string;
  activity_date: string;
  activity_type: string;
  status: string;
  lead_operator_id: string | null;
  crew_operator_ids: string[] | null;
  area_code_id: string | null;
};
type KpiGensetAct = {
  id: string;
  activity_date: string;
  activity_type?: string;
  area_code_id: string | null;
  site_or_well: string | null;
  details: Record<string, unknown> | null;
};
type KpiJo = {
  id: string;
  assigned_operator_ids: string[] | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  deadline: string | null;
};
type KpiDataset = {
  fetchedDays: 7 | 30 | 90;
  acts: KpiAct[];
  gensetActs: KpiGensetAct[];
  assignments: KpiAsg[];
  pmTasks: KpiPm[];
  jobOrders: KpiJo[];
};

const STANDBY_TONES: Record<GensetStandbyVerdict, BadgeTone> = {
  READY: 'ok',
  NEEDS_ATTENTION: 'warn',
  CRITICAL: 'danger',
};
const CARD_HEADER_BORDER = { borderBottom: '1px solid var(--border-light)' };
const BAR_TRACK_STYLE = { height: 8, background: 'var(--surface-muted)', borderRadius: 999, overflow: 'hidden' };

function subtractDays(ymd: string, n: number) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function computeJoSlaStats(doneJos: KpiJo[]): { avgTatHours: number | null; onTimePct: number | null } {
  if (doneJos.length === 0) return { avgTatHours: null, onTimePct: null };
  let sumHrs = 0;
  let tatCount = 0;
  let onTimeCount = 0;
  let deadlineChecked = 0;
  for (const j of doneJos) {
    if (j.created_at && j.completed_at) {
      const hrs = (new Date(j.completed_at).getTime() - new Date(j.created_at).getTime()) / (1000 * 60 * 60);
      if (Number.isFinite(hrs) && hrs >= 0) {
        sumHrs += hrs;
        tatCount += 1;
      }
    }
    if (j.deadline && j.completed_at) {
      deadlineChecked += 1;
      if (new Date(j.completed_at).getTime() <= new Date(j.deadline).getTime()) onTimeCount += 1;
    }
  }
  return {
    avgTatHours: tatCount > 0 ? Math.round((sumHrs / tatCount) * 10) / 10 : null,
    onTimePct: deadlineChecked > 0 ? Math.round((onTimeCount / deadlineChecked) * 100) : null,
  };
}

async function fetchAllClient<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: string }> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) return { data: out, error: error.message };
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: '' };
}

function BreakdownCard({
  title,
  emptyText,
  barColor,
  items,
}: {
  title: string;
  emptyText?: string;
  barColor: string;
  items: Array<{ key: string; label: string; count: number; pct: number }>;
}) {
  return (
    <div className="card card-pad stack-sm">
      <strong style={{ fontSize: 13.5 }}>{title}</strong>
      {items.length === 0 ? (
        <span className="text-secondary-sm">{emptyText}</span>
      ) : (
        items.map((item) => (
          <div key={item.key} className="stack-xs">
            <div className="row-between" style={{ fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{item.label}</span>
              <span className="tabular-nums font-bold">{item.count}</span>
            </div>
            <div style={BAR_TRACK_STYLE}>
              <div style={{ width: `${item.pct}%`, height: '100%', background: barColor, borderRadius: 999 }} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function ActivitiesKpiTab(p: {
  anchorDate: string;
  operators: KpiOp[];
  areas: KpiArea[];
  shifts: KpiShift[];
}) {
  const [periodDays, setPeriodDays] = useState<7 | 30 | 90>(30);
  const [dataset, setDataset] = useState<KpiDataset | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errMsg, setErrMsg] = useState<string>('');
  const cacheRef = useRef<{ anchorDate: string; dataset: KpiDataset } | null>(null);

  const startDate = useMemo(() => subtractDays(p.anchorDate, periodDays - 1), [p.anchorDate, periodDays]);

  useEffect(() => {
    const cached = cacheRef.current;
    if (cached && cached.anchorDate === p.anchorDate && periodDays <= cached.dataset.fetchedDays) {
      setDataset(cached.dataset);
      setLoading(false);
      setErrMsg('');
      return;
    }

    let active = true;
    const loadKpis = async () => {
      setLoading(true);
      setErrMsg('');
      const fetchStart = subtractDays(p.anchorDate, periodDays - 1);
      const sb = supabaseBrowser();

      const fetchPmTasks = (withCompletedBy: boolean) =>
        fetchAllClient<KpiPm>(async (from, to) => {
          const base = withCompletedBy
            ? sb.from('pm_tasks').select(PM_TASK_KPI_COLUMNS)
            : sb.from('pm_tasks').select(PM_TASK_KPI_COLUMNS_LEGACY);
          const { data, error } = await base
            .gte('scheduled_date', fetchStart)
            .lte('scheduled_date', p.anchorDate)
            .order('scheduled_date')
            .range(from, to);
          return { data: data as KpiPm[] | null, error };
        });

      const [actsRes, gensetRes, asgRes, pmPrimaryRes, joRes] = await Promise.all([
        fetchAllClient<KpiAct>((from, to) =>
          sb
            .from('daily_activities')
            .select(DAILY_ACTIVITY_KPI_COLUMNS)
            .eq('is_sample', false)
            .gte('activity_date', fetchStart)
            .lte('activity_date', p.anchorDate)
            .order('activity_date', { ascending: false })
            .range(from, to),
        ),
        sb
          .from('daily_activities')
          .select(DAILY_ACTIVITY_GENSET_COLUMNS)
          .eq('is_sample', false)
          .in('activity_type', ['genset_monitoring', 'genset_fuel_refill'])
          .gte('activity_date', fetchStart)
          .lte('activity_date', p.anchorDate)
          .order('activity_date', { ascending: false })
          .limit(36),
        fetchAllClient<KpiAsg>((from, to) =>
          sb
            .from('schedule_assignments')
            .select('operator_id, schedule_date, shift_type_id, area_code_id')
            .gte('schedule_date', fetchStart)
            .lte('schedule_date', p.anchorDate)
            .order('schedule_date')
            .range(from, to),
        ),
        fetchPmTasks(true),
        fetchAllClient<KpiJo>((from, to) =>
          sb
            .from('job_orders')
            .select(JOB_ORDER_KPI_COLUMNS)
            .eq('is_sample', false)
            .or(`completed_at.gte.${fetchStart}T00:00:00Z,created_at.gte.${fetchStart}T00:00:00Z`)
            .order('created_at', { ascending: false })
            .range(from, to),
        ),
      ]);

      const pmRes =
        pmPrimaryRes.error && isMissingCompletedByColumnError({ message: pmPrimaryRes.error })
          ? await fetchPmTasks(false)
          : pmPrimaryRes;

      if (!active) return;

      const firstErr = actsRes.error || gensetRes.error?.message || asgRes.error || pmRes.error || joRes.error || '';
      if (firstErr) {
        setErrMsg(firstErr);
        setLoading(false);
        return;
      }

      const nextData: KpiDataset = {
        fetchedDays: periodDays,
        acts: actsRes.data,
        gensetActs: (gensetRes.data ?? []) as KpiGensetAct[],
        assignments: asgRes.data,
        pmTasks: pmRes.data,
        jobOrders: joRes.data,
      };
      cacheRef.current = { anchorDate: p.anchorDate, dataset: nextData };
      setDataset(nextData);
      setLoading(false);
    };

    void loadKpis();
    return () => {
      active = false;
    };
  }, [p.anchorDate, periodDays]);

  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);
  const nonWorkingAreaIds = useMemo(
    () => new Set(p.areas.filter((a) => a.category === 'leave' || a.category === 'rest' || a.category === 'holiday').map((a) => a.id)),
    [p.areas],
  );

  const periodActs = useMemo(
    () => (dataset?.acts ?? []).filter((a) => a.activity_date >= startDate && a.activity_date <= p.anchorDate),
    [dataset, startDate, p.anchorDate],
  );
  const periodPms = useMemo(
    () => (dataset?.pmTasks ?? []).filter((t) => t.scheduled_date >= startDate && t.scheduled_date <= p.anchorDate),
    [dataset, startDate, p.anchorDate],
  );
  const periodJos = useMemo(
    () =>
      (dataset?.jobOrders ?? []).filter((j) => {
        const d = (j.completed_at ?? j.created_at).slice(0, 10);
        return d >= startDate && d <= p.anchorDate;
      }),
    [dataset, startDate, p.anchorDate],
  );
  const periodAsgs = useMemo(
    () => (dataset?.assignments ?? []).filter((a) => a.schedule_date >= startDate && a.schedule_date <= p.anchorDate),
    [dataset, startDate, p.anchorDate],
  );

  const operatorRows = useMemo(() => {
    const rows = p.operators.map((op) => {
      let dutyDays = 0;
      let dutyHours = 0;
      for (const a of periodAsgs) {
        if (a.operator_id !== op.id) continue;
        const s = a.shift_type_id ? shiftBy.get(a.shift_type_id) : undefined;
        const isLeaveOrRest = Boolean(a.area_code_id && nonWorkingAreaIds.has(a.area_code_id));
        if (s && !s.is_off && !isLeaveOrRest) {
          dutyDays += 1;
          dutyHours += Number(s.duration_hours ?? 0);
        }
      }

      const opActs = periodActs.filter(
        (act) => act.lead_operator_id === op.id || (act.crew_operator_ids ?? []).includes(op.id),
      );
      const verifiedActs = opActs.filter((a) => a.status === 'verified').length;
      const pmStats = computeOperatorPmKpis(op.id, periodPms);
      const opJos = periodJos.filter((j) => (j.assigned_operator_ids ?? []).includes(op.id));
      const doneJos = opJos.filter((j) => j.status === 'completed');
      const { avgTatHours, onTimePct } = computeJoSlaStats(doneJos);

      return {
        op,
        dutyDays,
        dutyHours,
        actCount: opActs.length,
        verifiedActs,
        donePms: pmStats.doneCount,
        assignedPms: pmStats.assignedCount,
        plannedDonePms: pmStats.plannedDoneCount,
        substituteDonePms: pmStats.substituteDoneCount,
        missedAssignedPms: pmStats.missedAssignedCount,
        pmCompliance: pmStats.compliancePct,
        doneJos: doneJos.length,
        assignedJos: opJos.length,
        avgTatHours,
        onTimePct,
        totalOutput: opActs.length + pmStats.doneCount + doneJos.length,
      };
    });

    rows.sort((a, b) => b.totalOutput - a.totalOutput || b.dutyDays - a.dutyDays || a.op.full_name.localeCompare(b.op.full_name));
    return rows;
  }, [p.operators, periodAsgs, periodActs, periodPms, periodJos, shiftBy, nonWorkingAreaIds]);

  const summary = useMemo(() => {
    const totalActs = periodActs.length;
    const verified = periodActs.filter((a) => a.status === 'verified').length;
    const verifiedRate = totalActs > 0 ? Math.round((verified / totalActs) * 100) : 0;
    const pmsDone = periodPms.filter((t) => t.status === 'done').length;
    const josDone = periodJos.filter((j) => j.status === 'completed');
    const { avgTatHours: avgJoTat, onTimePct: joSlaCompliancePct } = computeJoSlaStats(josDone);
    return { totalActs, verified, verifiedRate, pmsDone, pmsTotal: periodPms.length, josDone: josDone.length, avgJoTat, joSlaCompliancePct };
  }, [periodActs, periodPms, periodJos]);

  const categoryCounts = useMemo(() => {
    const counts: Record<ActivityCategory, number> = { plant: 0, network: 0, metering: 0, grounds: 0 };
    for (const a of periodActs) {
      const cat = ACTIVITY_BY_ID[a.activity_type]?.category ?? 'grounds';
      counts[cat] += 1;
    }
    const maxCount = Math.max(1, ...Object.values(counts));
    return ACTIVITY_CATEGORIES.map((cat) => ({
      key: cat,
      label: ACTIVITY_CATEGORY_LABELS[cat],
      count: counts[cat],
      pct: Math.round((counts[cat] / maxCount) * 100),
    }));
  }, [periodActs]);

  const stationCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of periodActs) {
      const label = a.area_code_id ? (areaBy.get(a.area_code_id)?.code ?? 'Station') : 'Unassigned';
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    const list = Array.from(map.entries()).map(([code, count]) => ({ code, count }));
    list.sort((a, b) => b.count - a.count);
    const maxCount = Math.max(1, ...list.map((x) => x.count));
    return list.slice(0, 8).map((x) => ({ key: x.code, label: x.code, count: x.count, pct: Math.round((x.count / maxCount) * 100) }));
  }, [periodActs, areaBy]);

  const gensetLogs = useMemo(() => {
    const prim = (v: unknown): string | number | null => (typeof v === 'string' || typeof v === 'number' ? v : null);
    return (dataset?.gensetActs ?? [])
      .filter((a) => a.activity_date >= startDate && a.activity_date <= p.anchorDate)
      .slice(0, 12)
      .map((a) => {
        const d = a.details ?? {};
        const isRefill = a.activity_type === 'genset_fuel_refill';
        const gState = !isRefill && hasGensetChecklistDetails(d) ? hydrateGensetMonitoringDetails(d) : null;
        const health = gState ? evaluateGensetHealth(gState) : null;
        const runSummary = gState
          ? gState.runMode === 'skipped_ran_outage'
            ? 'Insp. only'
            : gState.runDurationMin
              ? `${gState.runDurationMin}m`
              : formatGensetRunModeShort(gState.runMode)
          : null;
        const standbyLabel =
          health?.verdict === 'READY'
            ? 'Ready'
            : health?.verdict === 'NEEDS_ATTENTION'
              ? 'Attention'
              : health?.verdict === 'CRITICAL'
                ? 'Critical'
                : null;
        return {
          id: a.id,
          date: a.activity_date,
          station: a.area_code_id ? (areaBy.get(a.area_code_id)?.code ?? '—') : '—',
          site: a.site_or_well ?? 'Main Genset',
          initialFuel: isRefill ? prim(d.fuelBefore) : prim(d.gensetInitialFuel),
          refilledLiters: isRefill ? prim(d.litersAdded) : null,
          finalFuel: isRefill ? prim(d.fuelAfter) : prim(d.gensetFinalFuel),
          runningHours: isRefill ? prim(d.hourMeterReading) : prim(d.runningHours),
          cause: isRefill
            ? `Refill (${typeof d.fuelSource === 'string' && d.fuelSource ? d.fuelSource : 'Fuel'})`
            : gState
              ? `${gState.unitFuelType} · ${formatGensetRunModeShort(gState.runMode)}`
              : typeof d.gensetCause === 'string'
                ? d.gensetCause
                : 'Routine',
          runSummary,
          oilLevel: gState ? gState.oilLevel : null,
          standbyVerdict: (health?.verdict ?? null) as GensetStandbyVerdict | null,
          standbyLabel,
          findingsText: health?.findings.join(', ') ?? '',
        };
      });
  }, [dataset, startDate, p.anchorDate, areaBy]);

  const gensetHealthCounts = useMemo(() => {
    let ready = 0;
    let attention = 0;
    let critical = 0;
    for (const row of gensetLogs) {
      if (row.standbyVerdict === 'READY') ready += 1;
      else if (row.standbyVerdict === 'NEEDS_ATTENTION') attention += 1;
      else if (row.standbyVerdict === 'CRITICAL') critical += 1;
    }
    return { ready, attention, critical, totalChecklist: ready + attention + critical };
  }, [gensetLogs]);

  return (
    <div className="stack-md">
      <div className="row-between-wrap">
        <div>
          <strong style={{ fontSize: 15 }}>Performance &amp; Telemetry Scorecards</strong>
          <div className="text-secondary-sm">
            Window: <b>{startDate}</b> to <b>{p.anchorDate}</b>
            {loading && <span className="font-bold" style={{ marginLeft: 8, color: 'var(--accent)' }}>Loading window…</span>}
          </div>
        </div>
        <SegmentedTabs
          ariaLabel="KPI time window"
          size="sm"
          value={String(periodDays) as '7' | '30' | '90'}
          onChange={(v) => setPeriodDays(Number(v) as 7 | 30 | 90)}
          items={[
            { id: '7', label: '7 Days' },
            { id: '30', label: '30 Days' },
            { id: '90', label: '90 Days' },
          ]}
        />
      </div>

      {errMsg && <AlertBanner tone="danger">Could not load KPI metrics: {errMsg}</AlertBanner>}

      {loading && !dataset && (
        <div className="card card-pad-lg text-center text-secondary-sm">Loading {periodDays}-day KPI metrics…</div>
      )}

      <div className="grid-auto-md">
        <div className="card kpi-stat-card">
          <span className="stat-label">Activities Logged</span>
          <strong className="kpi-stat-value" style={{ color: 'var(--accent)' }}>{summary.totalActs}</strong>
          <span className="stat-sub">{summary.verified} verified ({summary.verifiedRate}%)</span>
        </div>
        <div className="card kpi-stat-card">
          <span className="stat-label">PM Compliance</span>
          <strong className="kpi-stat-value" style={{ color: 'var(--teal)' }}>{summary.pmsDone}/{summary.pmsTotal}</strong>
          <span className="stat-sub">
            {summary.pmsTotal > 0 ? Math.round((summary.pmsDone / summary.pmsTotal) * 100) : 100}% closed in window
          </span>
        </div>
        <div className="card kpi-stat-card">
          <span className="stat-label">Job Orders Closed</span>
          <strong className="kpi-stat-value" style={{ color: 'var(--violet)' }}>{summary.josDone}</strong>
          <span className="stat-sub">
            Avg TAT: {summary.avgJoTat !== null ? `${summary.avgJoTat} hrs` : '—'}
            {summary.joSlaCompliancePct !== null ? ` · ${summary.joSlaCompliancePct}% within SLA` : ''}
          </span>
        </div>
      </div>

      <div className="grid-auto-md">
        <BreakdownCard title="Activities by Operational Category" barColor="var(--accent)" items={categoryCounts} />
        <BreakdownCard
          title="Station / Area Activity Coverage"
          emptyText="No activities recorded in this period yet."
          barColor="var(--teal)"
          items={stationCounts}
        />
      </div>

      {/* Employee Performance Scorecard Table */}
      <div className="card">
        <div className="card-pad-sm" style={CARD_HEADER_BORDER}>
          <strong style={{ fontSize: 14 }}>Employee Performance Leaderboard ({periodDays}-Day Window)</strong>
        </div>
        <div className="responsive-table-wrap scroll-x">
          <table className="data-table">
            <thead>
              <tr style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                <th>Operator</th>
                <th className="text-right">Duty Days / Hrs</th>
                <th className="text-right">Activities (Verified)</th>
                <th className="text-right">PM Done / Compliance</th>
                <th className="text-right">JOs Closed</th>
                <th className="text-right">Avg JO TAT / On-Time</th>
              </tr>
            </thead>
            <tbody>
              {operatorRows.map((r) => (
                <tr key={r.op.id}>
                  <td>
                    <div className="font-bold">{r.op.full_name}</div>
                    {r.op.position && <div className="text-secondary-xs">{r.op.position}</div>}
                  </td>
                  <td className="tabular-nums text-right">{r.dutyDays}d / {r.dutyHours}h</td>
                  <td className="tabular-nums text-right font-bold">
                    {r.actCount} <span className="text-secondary-xs" style={{ fontWeight: 400 }}>({r.verifiedActs} ✓)</span>
                  </td>
                  <td
                    className="tabular-nums text-right"
                    title={`Planned & Done: ${r.plannedDonePms} · Unlisted Substitute Done: ${r.substituteDonePms} · Assigned Not Participating: ${r.missedAssignedPms}`}
                  >
                    {r.donePms}/{r.assignedPms}{' '}
                    {r.pmCompliance !== null && (
                      <span className="font-bold" style={{ marginLeft: 4, fontSize: 11, color: r.pmCompliance >= 80 ? 'var(--ok-fg)' : 'var(--warn-fg)' }}>
                        ({r.pmCompliance}%)
                      </span>
                    )}
                    {r.substituteDonePms > 0 && (
                      <span style={{ marginLeft: 4 }}><Badge tone="warn" size="sm">+{r.substituteDonePms} sub</Badge></span>
                    )}
                  </td>
                  <td className="tabular-nums text-right">{r.doneJos}/{r.assignedJos}</td>
                  <td className="tabular-nums text-right">
                    {r.avgTatHours !== null ? `${r.avgTatHours}h` : '—'}
                    {r.onTimePct !== null && (
                      <span className="font-bold" style={{ marginLeft: 4, fontSize: 11, color: r.onTimePct >= 80 ? 'var(--ok-fg)' : 'var(--danger)' }}>
                        ({r.onTimePct}%)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="responsive-cards" style={{ padding: 12 }}>
          {operatorRows.map((r) => (
            <div
              key={r.op.id}
              className="card"
              style={{ padding: 10, display: 'grid', gap: 6, background: 'var(--surface-muted)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                <div>
                  <div className="font-bold" style={{ fontSize: 13.5 }}>{r.op.full_name}</div>
                  {r.op.position && <div className="text-secondary-xs">{r.op.position}</div>}
                </div>
                <div className="tabular-nums text-right" style={{ fontSize: 12.5 }}>
                  <span className="font-bold">{r.actCount}</span>{' '}
                  <span className="text-secondary-xs">({r.verifiedActs} ✓)</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: 6, fontSize: 12 }}>
                <div>
                  <div className="text-secondary-xs">Duty Days / Hrs</div>
                  <div className="font-bold tabular-nums">{r.dutyDays}d / {r.dutyHours}h</div>
                </div>
                <div>
                  <div className="text-secondary-xs">PM Done / Compliance</div>
                  <div className="font-bold tabular-nums">
                    {r.donePms}/{r.assignedPms}
                    {r.pmCompliance !== null && (
                      <span style={{ marginLeft: 4, fontSize: 11, color: r.pmCompliance >= 80 ? 'var(--ok-fg)' : 'var(--warn-fg)' }}>
                        ({r.pmCompliance}%)
                      </span>
                    )}
                    {r.substituteDonePms > 0 && (
                      <span style={{ marginLeft: 4 }}><Badge tone="warn" size="sm">+{r.substituteDonePms} sub</Badge></span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-secondary-xs">JOs Closed</div>
                  <div className="font-bold tabular-nums">{r.doneJos}/{r.assignedJos}</div>
                </div>
                <div>
                  <div className="text-secondary-xs">Avg JO TAT / On-Time</div>
                  <div className="font-bold tabular-nums">
                    {r.avgTatHours !== null ? `${r.avgTatHours}h` : '—'}
                    {r.onTimePct !== null && (
                      <span style={{ marginLeft: 4, fontSize: 11, color: r.onTimePct >= 80 ? 'var(--ok-fg)' : 'var(--danger)' }}>
                        ({r.onTimePct}%)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Genset Fuel & Weekly PMS Health Table */}
      {gensetLogs.length > 0 && (
        <div className="card">
          <div className="card-pad-sm row-between-wrap" style={CARD_HEADER_BORDER}>
            <strong style={{ fontSize: 14 }}>Recent Genset Fuel &amp; PMS Logs</strong>
            {gensetHealthCounts.totalChecklist > 0 && (
              <div className="row-wrap" style={{ gap: 6 }}>
                <Badge tone="ok" size="sm">Ready: {gensetHealthCounts.ready}</Badge>
                {gensetHealthCounts.attention > 0 && <Badge tone="warn" size="sm">Attention: {gensetHealthCounts.attention}</Badge>}
                {gensetHealthCounts.critical > 0 && <Badge tone="danger" size="sm">Critical: {gensetHealthCounts.critical}</Badge>}
              </div>
            )}
          </div>
          <div className="responsive-table-wrap scroll-x">
            <table className="data-table">
              <thead>
                <tr style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                  <th>Date</th>
                  <th>Station / Unit</th>
                  <th>Cause / Mode</th>
                  <th className="text-right">Initial Fuel</th>
                  <th className="text-right">Refilled (L)</th>
                  <th className="text-right">Final Fuel</th>
                  <th>Run / Oil</th>
                  <th className="text-right">Hr Meter</th>
                  <th>Standby Health</th>
                </tr>
              </thead>
              <tbody>
                {gensetLogs.map((g) => (
                  <tr key={g.id}>
                    <td>{g.date}</td>
                    <td style={{ fontWeight: 600 }}>{g.station} · {g.site}</td>
                    <td>{g.cause}</td>
                    <td className="tabular-nums text-right">{g.initialFuel ?? '—'}</td>
                    <td
                      className="tabular-nums text-right"
                      style={{ color: g.refilledLiters !== null ? 'var(--ok-fg)' : undefined, fontWeight: g.refilledLiters !== null ? 700 : undefined }}
                    >
                      {g.refilledLiters !== null ? `+${g.refilledLiters}` : '—'}
                    </td>
                    <td className="tabular-nums text-right font-bold">{g.finalFuel ?? '—'}</td>
                    <td className="text-xs">
                      {g.runSummary || g.oilLevel ? (
                        <>
                          {g.runSummary && <span>{g.runSummary}</span>}
                          {g.runSummary && g.oilLevel && <span> · </span>}
                          {g.oilLevel && (
                            <span
                              style={{
                                color: g.oilLevel === 'Critical / Empty' ? 'var(--danger-fg)' : g.oilLevel !== 'Normal / Full' ? 'var(--warn-fg)' : undefined,
                                fontWeight: g.oilLevel !== 'Normal / Full' ? 700 : undefined,
                              }}
                            >
                              {g.oilLevel}
                            </span>
                          )}
                        </>
                      ) : '—'}
                    </td>
                    <td className="tabular-nums text-right">{g.runningHours ?? '—'}</td>
                    <td title={g.findingsText || undefined}>
                      {g.standbyLabel && g.standbyVerdict ? (
                        <Badge tone={STANDBY_TONES[g.standbyVerdict]} size="sm">{g.standbyLabel}</Badge>
                      ) : <span className="text-muted-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="responsive-cards" style={{ padding: 12 }}>
            {gensetLogs.map((g) => (
              <div
                key={g.id}
                className="card"
                style={{ padding: 10, display: 'grid', gap: 6, background: 'var(--surface-muted)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                  <div>
                    <div className="font-bold" style={{ fontSize: 13 }}>{g.station} · {g.site}</div>
                    <div className="text-secondary-xs">{g.date} · {g.cause}</div>
                  </div>
                  {g.standbyLabel && g.standbyVerdict && (
                    <Badge tone={STANDBY_TONES[g.standbyVerdict]} size="sm">{g.standbyLabel}</Badge>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, fontSize: 12 }}>
                  <div>
                    <div className="text-secondary-xs">Fuel (Init → Final)</div>
                    <div className="font-bold tabular-nums">{g.initialFuel ?? '—'} → {g.finalFuel ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-secondary-xs">Refilled (L)</div>
                    <div
                      className="font-bold tabular-nums"
                      style={{ color: g.refilledLiters !== null ? 'var(--ok-fg)' : undefined }}
                    >
                      {g.refilledLiters !== null ? `+${g.refilledLiters}` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-secondary-xs">Hr Meter</div>
                    <div className="font-bold tabular-nums">{g.runningHours ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-secondary-xs">Run / Oil</div>
                    <div>
                      {g.runSummary || g.oilLevel ? (
                        <>
                          {g.runSummary && <span>{g.runSummary}</span>}
                          {g.runSummary && g.oilLevel && <span> · </span>}
                          {g.oilLevel && (
                            <span
                              style={{
                                color: g.oilLevel === 'Critical / Empty' ? 'var(--danger-fg)' : g.oilLevel !== 'Normal / Full' ? 'var(--warn-fg)' : undefined,
                                fontWeight: g.oilLevel !== 'Normal / Full' ? 700 : undefined,
                              }}
                            >
                              {g.oilLevel}
                            </span>
                          )}
                        </>
                      ) : '—'}
                    </div>
                  </div>
                </div>
                {g.findingsText && (
                  <div className="text-secondary-xs">{g.findingsText}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
