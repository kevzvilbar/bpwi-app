import { getProfile } from '@/lib/profile';
import { manilaToday } from '@/lib/date';
import {
  buildOwnActivityOrFilter,
  DAILY_ACTIVITY_LIST_COLUMNS,
  JOB_ORDER_COLUMNS,
  SHIFT_HANDOVER_COLUMNS,
} from '@/lib/query-columns';
import type { DailyActivityRow, JobOrderRow, ShiftHandoverRow } from '@/lib/activity-types';
import ActivitiesMonitor from '@/components/ActivitiesMonitor';

export const dynamic = 'force-dynamic';

function addDays(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const sp = await searchParams;
  const p = await getProfile();
  const today = manilaToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? '') ? sp.d! : today;
  const hoFrom = addDays(date, -14);
  const joFrom = addDays(date, -30);
  const ownActFilter = !p.canVerifyActivity ? buildOwnActivityOrFilter(p.user?.id, p.operatorId) : null;

  const [areasPrimary, opsRes, shiftsRes, asgRes, standbyRes, pmRes, actRes, joRes, hoRes] = await Promise.all([
    p.sb
      .from('area_codes')
      .select('id, code, name, category, background_color, text_color, sub_sites')
      .order('code'),
    p.sb
      .from('operators')
      .select('id, full_name, position, phone_number, default_station')
      .eq('is_active', true)
      .order('sort_order'),
    p.sb
      .from('shift_types')
      .select('id, code, description, duration_hours, start_time, end_time, background_color, text_color, is_off')
      .order('code'),
    p.sb
      .from('schedule_assignments')
      .select('operator_id, schedule_date, shift_type_id, area_code_id')
      .eq('schedule_date', date),
    p.sb.from('standby_assignments').select('operator_id, standby_type').eq('schedule_date', date),
    p.sb
      .from('pm_tasks')
      .select('id, activity_type, title, scheduled_date, completed_at, status, assigned_operator_ids')
      .or(`completed_at.eq.${date},and(status.neq.done,scheduled_date.lt.${date})`)
      .order('scheduled_date'),
    (() => {
      let q = p.sb
        .from('daily_activities')
        .select(DAILY_ACTIVITY_LIST_COLUMNS)
        .eq('activity_date', date)
        .order('created_at', { ascending: false });
      if (ownActFilter) q = q.or(ownActFilter);
      return q;
    })(),
    p.sb
      .from('job_orders')
      .select(JOB_ORDER_COLUMNS)
      .or(`status.in.(pending,in_progress),created_at.gte.${joFrom}T00:00:00Z`)
      .order('created_at', { ascending: false })
      .limit(150),
    p.sb
      .from('shift_handovers')
      .select(SHIFT_HANDOVER_COLUMNS)
      .gte('handover_date', hoFrom)
      .lte('handover_date', date)
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  const areasRes = areasPrimary.error
    ? await p.sb
        .from('area_codes')
        .select('id, code, name, category, background_color, text_color')
        .order('code')
    : areasPrimary;

  const missing010 = actRes.error && /daily_activities/i.test(actRes.error.message);
  const missing011 =
    (joRes.error && /job_orders/i.test(joRes.error.message)) ||
    (hoRes.error && /shift_handovers/i.test(hoRes.error.message));

  let schemaWarning = '';
  if (missing010 || missing011) {
    const missingList = [
      missing010 ? '010_daily_activities.sql' : null,
      missing011 ? '011_job_orders_and_handovers.sql' : null,
    ].filter(Boolean);
    schemaWarning = `Database migrations required: run ${missingList.join(' and ')} in Supabase SQL Editor to enable full activity logging, job orders, and shift handovers.`;
  } else {
    schemaWarning =
      opsRes.error?.message ||
      shiftsRes.error?.message ||
      areasRes.error?.message ||
      asgRes.error?.message ||
      standbyRes.error?.message ||
      pmRes.error?.message ||
      actRes.error?.message ||
      joRes.error?.message ||
      hoRes.error?.message ||
      '';
  }

  return (
    <ActivitiesMonitor
      key={date}
      date={date}
      today={today}
      orgId={p.orgId}
      orgName={p.orgName}
      userId={p.user?.id ?? ''}
      role={p.role}
      operatorId={p.operatorId}
      canLogActivity={p.canLogActivity}
      canVerifyActivity={p.canVerifyActivity}
      isAdmin={p.isAdmin}
      operators={opsRes.data ?? []}
      shifts={shiftsRes.data ?? []}
      areas={areasRes.data ?? []}
      assignments={asgRes.data ?? []}
      standby={standbyRes.data ?? []}
      pmTasks={pmRes.data ?? []}
      activities={actRes.error ? [] : ((actRes.data ?? []) as DailyActivityRow[])}
      jobOrders={joRes.error ? [] : ((joRes.data ?? []) as JobOrderRow[])}
      handovers={hoRes.error ? [] : ((hoRes.data ?? []) as ShiftHandoverRow[])}
      schemaWarning={schemaWarning}
    />
  );
}
