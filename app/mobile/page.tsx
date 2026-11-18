import { getProfile } from '@/lib/profile';
import { manilaNowMinutes, manilaToday } from '@/lib/date';
import MobileView from '@/components/MobileView';

export const dynamic = 'force-dynamic';

function addDays(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export default async function MobilePage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const sp = await searchParams;
  const { sb, user, orgId, role, operatorId, canClosePm, canLogActivity } = await getProfile();
  const today = manilaToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? '') ? sp.d! : today;
  const prevDate = addDays(date, -1);
  const nowMinutes = manilaNowMinutes();
  const pmFrom = addDays(date, -14);
  const pmTo = addDays(date, 30);

  const [ops, shifts, areas, asg, prevAsg, standby, tasks, actTypes, dailyActs] = await Promise.all([
    sb
      .from('operators')
      .select('id, full_name, position, phone_number, default_station')
      .eq('is_active', true)
      .order('sort_order'),
    sb.from('shift_types').select('id, code, description, start_time, end_time, background_color, text_color, is_off').order('code'),
    sb.from('area_codes').select('id, code, name, category'),
    sb.from('schedule_assignments').select('operator_id, shift_type_id, area_code_id').eq('schedule_date', date),
    sb.from('schedule_assignments').select('operator_id, shift_type_id, area_code_id').eq('schedule_date', prevDate),
    sb.from('standby_assignments').select('operator_id, standby_type').eq('schedule_date', date),
    sb.from('pm_tasks').select('*').gte('scheduled_date', pmFrom).lte('scheduled_date', pmTo).order('scheduled_date'),
    sb.from('pm_activity_types').select('code, label, short_label, color'),
    sb.from('daily_activities').select('*').eq('activity_date', date).order('created_at', { ascending: false }),
  ]);

  const error =
    ops.error?.message ||
    shifts.error?.message ||
    areas.error?.message ||
    asg.error?.message ||
    prevAsg.error?.message ||
    standby.error?.message ||
    tasks.error?.message ||
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
      operators={ops.data ?? []}
      shifts={shifts.data ?? []}
      areas={areas.data ?? []}
      assignments={asg.data ?? []}
      yesterdayAssignments={prevAsg.data ?? []}
      standby={standby.data ?? []}
      tasks={tasks.data ?? []}
      activityTypes={actTypes.error ? [] : (actTypes.data ?? [])}
      initialActivities={dailyActs.error ? [] : (dailyActs.data ?? [])}
      error={error}
    />
  );
}
