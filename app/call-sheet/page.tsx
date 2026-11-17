import { getProfile } from '@/lib/profile';
import CallSheet from '@/components/CallSheet';

export const dynamic = 'force-dynamic';

export default async function CallSheetPage() {
  const { sb } = await getProfile();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

  const [ops, shifts, areas, asg, standby] = await Promise.all([
    sb
      .from('operators')
      .select('id, full_name, position, phone_number, default_station')
      .eq('is_active', true)
      .order('sort_order'),
    sb.from('shift_types').select('id, code, description, background_color, text_color, is_off'),
    sb.from('area_codes').select('id, code, name'),
    sb.from('schedule_assignments').select('operator_id, shift_type_id, area_code_id').eq('schedule_date', today),
    sb.from('standby_assignments').select('operator_id, standby_type').eq('schedule_date', today),
  ]);

  const error = ops.error?.message || shifts.error?.message || areas.error?.message || asg.error?.message || standby.error?.message || '';

  return (
    <CallSheet
      today={today}
      operators={ops.data ?? []}
      shifts={shifts.data ?? []}
      areas={areas.data ?? []}
      assignments={asg.data ?? []}
      standby={standby.data ?? []}
      error={error}
    />
  );
}
