import { fetchAll, getProfile } from '@/lib/profile';
import { manilaToday } from '@/lib/date';
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
  const kpiFrom = addDays(date, -89);
  const hoFrom = addDays(date, -14);
  const pmTo = addDays(date, 7);

  const areasPrimary = await p.sb
    .from('area_codes')
    .select('id, code, name, category, background_color, text_color, sub_sites')
    .order('code');
  const areasRes = areasPrimary.error
    ? await p.sb
        .from('area_codes')
        .select('id, code, name, category, background_color, text_color')
        .order('code')
    : areasPrimary;

  const [opsRes, shiftsRes, asgRes, standbyRes, pmRes, actRes, joRes, hoRes] = await Promise.all([
    p.sb
      .from('operators')
      .select('id, full_name, position, phone_number, default_station')
      .eq('is_active', true)
      .order('sort_order'),
    p.sb
      .from('shift_types')
      .select('id, code, description, duration_hours, start_time, end_time, background_color, text_color, is_off')
      .order('code'),
    fetchAll<{ operator_id: string; schedule_date: string; shift_type_id: string | null; area_code_id: string | null }>((from, to) =>
      p.sb
        .from('schedule_assignments')
        .select('operator_id, schedule_date, shift_type_id, area_code_id')
        .gte('schedule_date', kpiFrom)
        .lte('schedule_date', date)
        .order('schedule_date')
        .range(from, to),
    ),
    p.sb.from('standby_assignments').select('operator_id, standby_type').eq('schedule_date', date),
    fetchAll<{ id: string; activity_type: string; title: string; scheduled_date: string; completed_at: string | null; status: string; assigned_operator_ids: string[] }>((from, to) =>
      p.sb
        .from('pm_tasks')
        .select('id, activity_type, title, scheduled_date, completed_at, status, assigned_operator_ids')
        .gte('scheduled_date', kpiFrom)
        .lte('scheduled_date', pmTo)
        .order('scheduled_date')
        .range(from, to),
    ),
    fetchAll<DailyActivityRow>((from, to) =>
      p.sb
        .from('daily_activities')
        .select('*')
        .gte('activity_date', kpiFrom)
        .lte('activity_date', date)
        .order('created_at', { ascending: false })
        .range(from, to),
    ),
    p.sb
      .from('job_orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500),
    p.sb
      .from('shift_handovers')
      .select('*')
      .gte('handover_date', hoFrom)
      .lte('handover_date', date)
      .order('created_at', { ascending: false }),
  ]);

  const missing010 = actRes.error && /daily_activities/i.test(actRes.error);
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
      asgRes.error ||
      standbyRes.error?.message ||
      pmRes.error ||
      actRes.error ||
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
      assignments={asgRes.data}
      standby={standbyRes.data ?? []}
      pmTasks={pmRes.data}
      activities={actRes.error ? [] : actRes.data}
      jobOrders={joRes.error ? [] : ((joRes.data ?? []) as JobOrderRow[])}
      handovers={hoRes.error ? [] : ((hoRes.data ?? []) as ShiftHandoverRow[])}
      schemaWarning={schemaWarning}
      googleMapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''}
    />
  );
}
