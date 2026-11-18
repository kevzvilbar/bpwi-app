import { getProfile } from '@/lib/profile';
import { manilaNowMinutes, manilaToday } from '@/lib/date';
import CallSheet from '@/components/CallSheet';

export const dynamic = 'force-dynamic';

function addDays(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export default async function CallSheetPage() {
  const { sb } = await getProfile();
  const today = manilaToday();
  const yesterday = addDays(today, -1);
  const nowMinutes = manilaNowMinutes();

  const [ops, shifts, areas, asg, prevAsg, standby, heads] = await Promise.all([
    sb
      .from('operators')
      .select('id, full_name, position, phone_number, default_station')
      .eq('is_active', true)
      .order('sort_order'),
    sb.from('shift_types').select('id, code, description, start_time, end_time, background_color, text_color, is_off'),
    sb.from('area_codes').select('id, code, name, category'),
    sb.from('schedule_assignments').select('operator_id, shift_type_id, area_code_id').eq('schedule_date', today),
    sb.from('schedule_assignments').select('operator_id, shift_type_id, area_code_id').eq('schedule_date', yesterday),
    sb.from('standby_assignments').select('operator_id, standby_type').eq('schedule_date', today),
    sb.from('user_profiles').select('id, full_name, job_title, phone_number').eq('role', 'manager').eq('is_active', true).order('full_name'),
  ]);

  const error =
    ops.error?.message ||
    shifts.error?.message ||
    areas.error?.message ||
    asg.error?.message ||
    prevAsg.error?.message ||
    standby.error?.message ||
    '';

  return (
    <CallSheet
      today={today}
      nowMinutes={nowMinutes}
      operators={ops.data ?? []}
      shifts={shifts.data ?? []}
      areas={areas.data ?? []}
      assignments={asg.data ?? []}
      yesterdayAssignments={prevAsg.data ?? []}
      standby={standby.data ?? []}
      heads={heads.data ?? []}
      error={error}
    />
  );
}
