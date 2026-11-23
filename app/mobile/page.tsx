import { getProfile } from '@/lib/profile';
import { manilaNowMinutes, manilaToday } from '@/lib/date';
import {
  buildOwnActivityOrFilter,
  DAILY_ACTIVITY_LIST_COLUMNS,
  PM_TASK_COLUMNS,
  PM_TASK_COLUMNS_LEGACY,
} from '@/lib/query-columns';
import { isMissingCompletedByColumnError } from '@/lib/pm-credit';
import type { DailyActivityRow } from '@/lib/activity-types';
import MobileView from '@/components/MobileView';

export const dynamic = 'force-dynamic';

function addDays(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export default async function MobilePage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const sp = await searchParams;
  const { sb, user, orgId, role, operatorId, canClosePm, canLogActivity, canVerifyActivity } = await getProfile();
  const today = manilaToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? '') ? sp.d! : today;
  const prevDate = addDays(date, -1);
  const nowMinutes = manilaNowMinutes();
  const pmFrom = addDays(date, -14);
  const pmTo = addDays(date, 30);
  const ownActFilter = !canVerifyActivity ? buildOwnActivityOrFilter(user?.id, operatorId) : null;

  const [areasPrimary, ops, shifts, allAsg, standby, tasksPrimary, actTypes, dailyActs] = await Promise.all([
    sb.from('area_codes').select('id, code, name, category, sub_sites'),
    sb
      .from('operators')
      .select('id, full_name, position, phone_number, default_station')
      .eq('is_active', true)
      .order('sort_order'),
    sb.from('shift_types').select('id, code, description, start_time, end_time, background_color, text_color, is_off').order('code'),
    sb
      .from('schedule_assignments')
      .select('operator_id, schedule_date, shift_type_id, area_code_id')
      .in('schedule_date', [date, prevDate]),
    sb.from('standby_assignments').select('operator_id, standby_type').eq('schedule_date', date),
    sb.from('pm_tasks').select(PM_TASK_COLUMNS).gte('scheduled_date', pmFrom).lte('scheduled_date', pmTo).order('scheduled_date'),
    sb.from('pm_activity_types').select('code, label, short_label, color'),
    (() => {
      let q = sb
        .from('daily_activities')
        .select(DAILY_ACTIVITY_LIST_COLUMNS)
        .eq('activity_date', date)
        .order('created_at', { ascending: false });
      if (ownActFilter) q = q.or(ownActFilter);
      return q;
    })(),
  ]);

  let tasksData = tasksPrimary.data ?? [];
  let tasksError = tasksPrimary.error;
  if (isMissingCompletedByColumnError(tasksPrimary.error)) {
    const legacyRes = await sb
      .from('pm_tasks')
      .select(PM_TASK_COLUMNS_LEGACY)
      .gte('scheduled_date', pmFrom)
      .lte('scheduled_date', pmTo)
      .order('scheduled_date');
    tasksData = (legacyRes.data ?? []).map((t) => ({ ...t, completed_by_operator_ids: [] as string[] }));
    tasksError = legacyRes.error;
  }

  const areas = areasPrimary.error
    ? await sb.from('area_codes').select('id, code, name, category')
    : areasPrimary;

  const asgRows = allAsg.data ?? [];
  const todayAsg = asgRows
    .filter((r) => r.schedule_date === date)
    .map(({ operator_id, shift_type_id, area_code_id }) => ({ operator_id, shift_type_id, area_code_id }));
  const prevAsg = asgRows
    .filter((r) => r.schedule_date === prevDate)
    .map(({ operator_id, shift_type_id, area_code_id }) => ({ operator_id, shift_type_id, area_code_id }));

  const error =
    ops.error?.message ||
    shifts.error?.message ||
    areas.error?.message ||
    allAsg.error?.message ||
    standby.error?.message ||
    tasksError?.message ||
    '';

  return (
    <MobileView
      key={date}
      date={date}
      today={today}
      nowMinutes={nowMinutes}
      orgId={orgId}
      userId={user?.id ?? ''}
      role={role}
      operatorId={operatorId}
      canClosePm={canClosePm}
      canLogActivity={canLogActivity}
      canVerifyActivity={canVerifyActivity}
      operators={ops.data ?? []}
      shifts={shifts.data ?? []}
      areas={areas.data ?? []}
      assignments={todayAsg}
      yesterdayAssignments={prevAsg}
      standby={standby.data ?? []}
      tasks={tasksData}
      activityTypes={actTypes.error ? [] : (actTypes.data ?? [])}
      initialActivities={dailyActs.error ? [] : ((dailyActs.data ?? []) as DailyActivityRow[])}
      error={error}
    />
  );
}
