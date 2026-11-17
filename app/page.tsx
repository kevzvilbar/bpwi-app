import { getProfile } from '@/lib/profile';
import { manilaToday } from '@/lib/date';
import Roster from '@/components/Roster';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const { sb, role, orgId, name } = await getProfile();
  const today = manilaToday();
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : today.slice(0, 7);
  const [y, mo] = month.split('-').map(Number);
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;

  const [ops, shifts, areas, rows, standby, pmTasks] = await Promise.all([
    sb.from('operators').select('id, full_name, position').eq('is_active', true).order('sort_order'),
    sb.from('shift_types').select('id, code, description, duration_hours, background_color, text_color, is_off').order('code'),
    sb.from('area_codes').select('id, code, name, category, background_color, text_color').order('code'),
    sb
      .from('schedule_assignments')
      .select('operator_id, schedule_date, shift_type_id, area_code_id')
      .gte('schedule_date', first)
      .lte('schedule_date', last),
    sb
      .from('standby_assignments')
      .select('operator_id, schedule_date, standby_type')
      .gte('schedule_date', first)
      .lte('schedule_date', last),
    sb
      .from('pm_tasks')
      .select('scheduled_date, assigned_operator_ids, status, title')
      .gte('scheduled_date', first)
      .lte('scheduled_date', last),
  ]);

  const errors = [ops.error, shifts.error, areas.error, rows.error, standby.error, pmTasks.error]
    .filter(Boolean)
    .map((e) => e!.message);

  return (
    <Roster
      key={month}
      month={month}
      today={today}
      operators={ops.data ?? []}
      shifts={shifts.data ?? []}
      areas={areas.data ?? []}
      rows={rows.data ?? []}
      standby={standby.data ?? []}
      pmTasks={pmTasks.data ?? []}
      orgId={orgId}
      role={role}
      userName={name}
      canEdit={role === 'admin' || role === 'scheduler'}
      initialError={errors[0] ?? ''}
    />
  );
}
