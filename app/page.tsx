import { supabaseServer } from '@/lib/supabase/server';
import Roster from '@/components/Roster';

export const dynamic = 'force-dynamic';

function manilaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

export default async function Home({ searchParams }: { searchParams: { m?: string } }) {
  const sb = supabaseServer();
  const today = manilaToday();
  const month = /^\d{4}-\d{2}$/.test(searchParams.m ?? '') ? searchParams.m! : today.slice(0, 7);
  const [y, mo] = month.split('-').map(Number);
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;

  const [ops, shifts, areas, rows, standby, prof] = await Promise.all([
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
    sb.from('user_profiles').select('full_name, role, organization_id').maybeSingle(),
  ]);

  const errors = [ops.error, shifts.error, areas.error, rows.error, standby.error, prof.error]
    .filter(Boolean)
    .map((e) => e!.message);

  const role = prof.data?.role ?? 'viewer';

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
      orgId={prof.data?.organization_id ?? ''}
      role={role}
      userName={prof.data?.full_name ?? ''}
      canEdit={role === 'admin' || role === 'scheduler'}
      initialError={errors[0] ?? ''}
    />
  );
}
