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
import { AlertBanner, SegmentedTabs, StatCard } from '@/components/ui';
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

function subtractDays(ymd: string, n: number) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
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
            .gte('activity_date', fetchStart)
            .lte('activity_date', p.anchorDate)
            .order('activity_date', { ascending: false })
            .range(from, to),
        ),
        sb
          .from('daily_activities')
          .select(DAILY_ACTIVITY_GENSET_COLUMNS)
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

      const firstErr =
        actsRes.error ||
        gensetRes.error?.message ||
        asgRes.error ||
        pmRes.error ||
        joRes.error ||
        '';
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

  // Per-operator scorecard
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
      const assignedPmsCount = pmStats.assignedCount;
      const donePms = pmStats.doneCount;
      const pmCompliance = pmStats.compliancePct;

      const opJos = periodJos.filter((j) => (j.assigned_operator_ids ?? []).includes(op.id));
      const doneJos = opJos.filter((j) => j.status === 'completed');
      let avgTatHours: number | null = null;
      let onTimeCount = 0;
      let deadlineChecked = 0;
      if (doneJos.length > 0) {
        let sumHrs = 0;
        let tatCount = 0;
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
            if (new Date(j.completed_at).getTime() <= new Date(j.deadline).getTime()) {
              onTimeCount += 1;
            }
          }
        }
        if (tatCount > 0) avgTatHours = Math.round((sumHrs / tatCount) * 10) / 10;
      }
      const onTimePct = deadlineChecked > 0 ? Math.round((onTimeCount / deadlineChecked) * 100) : null;

      const totalOutput = opActs.length + donePms + doneJos.length;
      return {
        op,
        dutyDays,
        dutyHours,
        actCount: opActs.length,
        verifiedActs,
        donePms,
        assignedPms: assignedPmsCount,
        plannedDonePms: pmStats.plannedDoneCount,
        substituteDonePms: pmStats.substituteDoneCount,
        missedAssignedPms: pmStats.missedAssignedCount,
        pmCompliance,
        doneJos: doneJos.length,
        assignedJos: opJos.length,
        avgTatHours,
        onTimePct,
        totalOutput,
      };
    });

    rows.sort((a, b) => b.totalOutput - a.totalOutput || b.dutyDays - a.dutyDays || a.op.full_name.localeCompare(b.op.full_name));
    return rows;
  }, [p.operators, periodAsgs, periodActs, periodPms, periodJos, shiftBy, nonWorkingAreaIds]);

  // Overall totals
  const summary = useMemo(() => {
    const totalActs = periodActs.length;
    const verified = periodActs.filter((a) => a.status === 'verified').length;
    const verifiedRate = totalActs > 0 ? Math.round((verified / totalActs) * 100) : 0;
    const pmsDone = periodPms.filter((t) => t.status === 'done').length;
    const josDone = periodJos.filter((j) => j.status === 'completed');
    let avgJoTat: number | null = null;
    let joSlaChecked = 0;
    let joSlaMet = 0;
    if (josDone.length > 0) {
      let sum = 0;
      let cnt = 0;
      for (const j of josDone) {
        if (j.created_at && j.completed_at) {
          const hrs = (new Date(j.completed_at).getTime() - new Date(j.created_at).getTime()) / (1000 * 60 * 60);
          if (Number.isFinite(hrs) && hrs >= 0) {
            sum += hrs;
            cnt += 1;
          }
        }
        if (j.deadline && j.completed_at) {
          joSlaChecked += 1;
          if (new Date(j.completed_at).getTime() <= new Date(j.deadline).getTime()) {
            joSlaMet += 1;
          }
        }
      }
      if (cnt > 0) avgJoTat = Math.round((sum / cnt) * 10) / 10;
    }
    const joSlaCompliancePct = joSlaChecked > 0 ? Math.round((joSlaMet / joSlaChecked) * 100) : null;
    return { totalActs, verified, verifiedRate, pmsDone, pmsTotal: periodPms.length, josDone: josDone.length, avgJoTat, joSlaCompliancePct };
  }, [periodActs, periodPms, periodJos]);

  // Breakdown by category
  const categoryCounts = useMemo(() => {
    const counts: Record<ActivityCategory, number> = { plant: 0, network: 0, metering: 0, grounds: 0 };
    for (const a of periodActs) {
      const cat = ACTIVITY_BY_ID[a.activity_type]?.category ?? 'grounds';
      counts[cat] += 1;
    }
    const maxCount = Math.max(1, ...Object.values(counts));
    return ACTIVITY_CATEGORIES.map((cat) => ({
      cat,
      label: ACTIVITY_CATEGORY_LABELS[cat],
      count: counts[cat],
      pct: Math.round((counts[cat] / maxCount) * 100),
    }));
  }, [periodActs]);

  // Breakdown by Station / Area
  const stationCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of periodActs) {
      const label = a.area_code_id ? (areaBy.get(a.area_code_id)?.code ?? 'Station') : 'Unassigned';
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    const list = Array.from(map.entries()).map(([code, count]) => ({ code, count }));
    list.sort((a, b) => b.count - a.count);
    const maxCount = Math.max(1, ...list.map((x) => x.count));
    return list.slice(0, 8).map((x) => ({ ...x, pct: Math.round((x.count / maxCount) * 100) }));
  }, [periodActs, areaBy]);

  // Genset Fuel & PMS Inspection Telemetry logs
  const gensetLogs = useMemo(() => {
    const prim = (v: unknown): string | number | null =>
      typeof v === 'string' || typeof v === 'number' ? v : null;
    return (dataset?.gensetActs ?? [])
      .filter((a) => a.activity_date >= startDate && a.activity_date <= p.anchorDate)
      .slice(0, 12)
      .map((a) => {
        const d = a.details ?? {};
        const isRefill = a.activity_type === 'genset_fuel_refill';
        const hasChecklist = !isRefill && hasGensetChecklistDetails(d);
        const gState = hasChecklist ? hydrateGensetMonitoringDetails(d) : null;
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
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Period Selector & Top KPI Summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <strong style={{ fontSize: 15 }}>Performance &amp; Telemetry Scorecards</strong>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Window: <b>{startDate}</b> to <b>{p.anchorDate}</b>
            {loading && <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 600 }}>Loading window…</span>}
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

      {errMsg && (
        <AlertBanner tone="danger">
          Could not load KPI metrics: {errMsg}
        </AlertBanner>
      )}

      {loading && !dataset && (
        <div className="card" style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
          Loading {periodDays}-day KPI metrics…
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <StatCard
          label="Activities Logged"
          value={<span style={{ color: 'var(--accent)' }}>{summary.totalActs}</span>}
          subtitle={`${summary.verified} verified (${summary.verifiedRate}%)`}
        />
        <StatCard
          label="PM Compliance"
          value={<span style={{ color: 'var(--teal)' }}>{summary.pmsDone}/{summary.pmsTotal}</span>}
          subtitle={`${summary.pmsTotal > 0 ? Math.round((summary.pmsDone / summary.pmsTotal) * 100) : 100}% closed in window`}
        />
        <StatCard
          label="Job Orders Closed"
          value={<span style={{ color: 'var(--violet)' }}>{summary.josDone}</span>}
          subtitle={`Avg TAT: ${summary.avgJoTat !== null ? `${summary.avgJoTat} hrs` : '—'}${summary.joSlaCompliancePct !== null ? ` · ${summary.joSlaCompliancePct}% within SLA` : ''}`}
        />
      </div>

      {/* Breakdown Bars */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 13.5 }}>Activities by Operational Category</strong>
          {categoryCounts.map((c) => (
            <div key={c.cat} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>{c.label}</span>
                <span className="tabular-nums" style={{ fontWeight: 700 }}>{c.count}</span>
              </div>
              <div style={{ height: 8, background: 'var(--surface-muted)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ width: `${c.pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 13.5 }}>Station / Area Activity Coverage</strong>
          {stationCounts.length === 0 ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>No activities recorded in this period yet.</span>
          ) : (
            stationCounts.map((s) => (
              <div key={s.code} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{s.code}</span>
                  <span className="tabular-nums" style={{ fontWeight: 700 }}>{s.count}</span>
                </div>
                <div style={{ height: 8, background: 'var(--surface-muted)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${s.pct}%`, height: '100%', background: 'var(--teal)', borderRadius: 999 }} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Employee Performance Scorecard Table */}
      <div className="card" style={{ overflow: 'auto' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-light)' }}>
          <strong style={{ fontSize: 14 }}>Employee Performance Leaderboard ({periodDays}-Day Window)</strong>
        </div>
        <table className="data-table">
          <thead>
            <tr style={{ background: 'var(--surface-muted)', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              <th style={{ padding: '8px 12px' }}>Operator</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>Duty Days / Hrs</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>Activities (Verified)</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>PM Done / Compliance</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>JOs Closed</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' }}>Avg JO TAT / On-Time</th>
            </tr>
          </thead>
          <tbody>
            {operatorRows.map((r) => (
              <tr key={r.op.id}>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ fontWeight: 700 }}>{r.op.full_name}</div>
                  {r.op.position && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.op.position}</div>}
                </td>
                <td className="tabular-nums" style={{ padding: '8px 10px', textAlign: 'right' }}>
                  {r.dutyDays}d / {r.dutyHours}h
                </td>
                <td className="tabular-nums" style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>
                  {r.actCount} <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>({r.verifiedActs} ✓)</span>
                </td>
                <td
                  className="tabular-nums"
                  style={{ padding: '8px 10px', textAlign: 'right' }}
                  title={`Planned & Done: ${r.plannedDonePms} · Unlisted Substitute Done: ${r.substituteDonePms} · Assigned Not Participating: ${r.missedAssignedPms}`}
                >
                  {r.donePms}/{r.assignedPms}{' '}
                  {r.pmCompliance !== null && (
                    <span
                      style={{
                        marginLeft: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        color: r.pmCompliance >= 80 ? 'var(--ok-fg)' : 'var(--warn-fg)',
                      }}
                    >
                      ({r.pmCompliance}%)
                    </span>
                  )}
                  {r.substituteDonePms > 0 && (
                    <span
                      style={{
                        marginLeft: 4,
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 999,
                        background: 'var(--warn-bg)',
                        color: 'var(--warn-fg)',
                      }}
                    >
                      +{r.substituteDonePms} sub
                    </span>
                  )}
                </td>
                <td className="tabular-nums" style={{ padding: '8px 10px', textAlign: 'right' }}>
                  {r.doneJos}/{r.assignedJos}
                </td>
                <td className="tabular-nums" style={{ padding: '8px 12px', textAlign: 'right' }}>
                  {r.avgTatHours !== null ? `${r.avgTatHours}h` : '—'}
                  {r.onTimePct !== null && (
                    <span style={{ marginLeft: 4, fontSize: 11, color: r.onTimePct >= 80 ? 'var(--ok-fg)' : 'var(--danger)', fontWeight: 700 }}>
                      ({r.onTimePct}%)
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Genset Fuel & Weekly PMS Health Table */}
      {gensetLogs.length > 0 && (
        <div className="card" style={{ overflow: 'auto' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ fontSize: 14 }}>Recent Genset Fuel &amp; PMS Logs</strong>
            {gensetHealthCounts.totalChecklist > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11.5, fontWeight: 700 }}>
                <span style={{ padding: '2px 8px', borderRadius: 999, background: 'var(--ok-bg)', color: 'var(--ok-fg)', border: '1px solid var(--ok-border)' }}>
                  Ready: {gensetHealthCounts.ready}
                </span>
                {gensetHealthCounts.attention > 0 && (
                  <span style={{ padding: '2px 8px', borderRadius: 999, background: 'var(--warn-bg)', color: 'var(--warn-fg)', border: '1px solid var(--warn-border)' }}>
                    Attention: {gensetHealthCounts.attention}
                  </span>
                )}
                {gensetHealthCounts.critical > 0 && (
                  <span style={{ padding: '2px 8px', borderRadius: 999, background: 'var(--danger-bg)', color: 'var(--danger-fg)', border: '1px solid var(--danger-border)' }}>
                    Critical: {gensetHealthCounts.critical}
                  </span>
                )}
              </div>
            )}
          </div>
          <table className="data-table">
            <thead>
              <tr style={{ background: 'var(--surface-muted)', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)' }}>Date</th>
                <th style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)' }}>Station / Unit</th>
                <th style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)' }}>Cause / Mode</th>
                <th style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Initial Fuel</th>
                <th style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Refilled (L)</th>
                <th style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Final Fuel</th>
                <th style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)' }}>Run / Oil</th>
                <th style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Hr Meter</th>
                <th style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)' }}>Standby Health</th>
              </tr>
            </thead>
            <tbody>
              {gensetLogs.map((g) => (
                <tr key={g.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '7px 12px' }}>{g.date}</td>
                  <td style={{ padding: '7px 10px', fontWeight: 600 }}>{g.station} · {g.site}</td>
                  <td style={{ padding: '7px 10px' }}>{g.cause}</td>
                  <td className="tabular-nums" style={{ padding: '7px 10px', textAlign: 'right' }}>{g.initialFuel ?? '—'}</td>
                  <td className="tabular-nums" style={{ padding: '7px 10px', textAlign: 'right', color: g.refilledLiters !== null ? 'var(--ok-fg)' : undefined, fontWeight: g.refilledLiters !== null ? 700 : undefined }}>
                    {g.refilledLiters !== null ? `+${g.refilledLiters}` : '—'}
                  </td>
                  <td className="tabular-nums" style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>{g.finalFuel ?? '—'}</td>
                  <td style={{ padding: '7px 10px', fontSize: 12 }}>
                    {g.runSummary || g.oilLevel ? (
                      <>
                        {g.runSummary && <span>{g.runSummary}</span>}
                        {g.runSummary && g.oilLevel && <span> · </span>}
                        {g.oilLevel && (
                          <span
                            style={{
                              color:
                                g.oilLevel === 'Critical / Empty'
                                  ? 'var(--danger-fg)'
                                  : g.oilLevel !== 'Normal / Full'
                                    ? 'var(--warn-fg)'
                                    : undefined,
                              fontWeight: g.oilLevel !== 'Normal / Full' ? 700 : undefined,
                            }}
                          >
                            {g.oilLevel}
                          </span>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="tabular-nums" style={{ padding: '7px 10px', textAlign: 'right' }}>{g.runningHours ?? '—'}</td>
                  <td style={{ padding: '7px 12px' }} title={g.findingsText || undefined}>
                    {g.standbyLabel ? (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background:
                            g.standbyVerdict === 'READY'
                              ? 'var(--ok-bg)'
                              : g.standbyVerdict === 'NEEDS_ATTENTION'
                                ? 'var(--warn-bg)'
                                : 'var(--danger-bg)',
                          color:
                            g.standbyVerdict === 'READY'
                              ? 'var(--ok-fg)'
                              : g.standbyVerdict === 'NEEDS_ATTENTION'
                                ? 'var(--warn-fg)'
                                : 'var(--danger-fg)',
                          border:
                            g.standbyVerdict === 'READY'
                              ? '1px solid var(--ok-border)'
                              : g.standbyVerdict === 'NEEDS_ATTENTION'
                                ? '1px solid var(--warn-border)'
                                : '1px solid var(--danger-border)',
                        }}
                      >
                        {g.standbyLabel}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
