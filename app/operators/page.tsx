import { getProfile } from '@/lib/profile';
import Setup from '@/components/Setup';

export const dynamic = 'force-dynamic';

export default async function OperatorsPage() {
  const { sb, user, orgId, isAdmin } = await getProfile();
  const [ops, shifts, areas, users, logs] = await Promise.all([
    sb.from('operators').select('id, full_name, position, phone_number, default_station, sort_order, is_active').order('sort_order'),
    sb.from('shift_types').select('id, code, description, start_time, end_time, duration_hours, is_off, background_color, text_color').order('code'),
    sb.from('area_codes').select('id, code, name, category, background_color, text_color').order('code'),
    isAdmin
      ? sb.from('user_profiles').select('id, full_name, role, is_active, operator_id').order('role').order('full_name')
      : Promise.resolve({ data: [], error: null }),
    isAdmin
      ? sb.from('audit_logs').select('id, user_id, action, table_name, record_id, old_value, new_value, created_at').order('created_at', { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);

  return (
    <Setup
      operators={ops.data ?? []}
      shifts={shifts.data ?? []}
      areas={areas.data ?? []}
      users={users.data ?? []}
      auditLogs={logs.data ?? []}
      orgId={orgId}
      currentUserId={user?.id ?? ''}
      isAdmin={isAdmin}
      error={ops.error?.message ?? shifts.error?.message ?? areas.error?.message ?? users.error?.message ?? logs.error?.message ?? ''}
    />
  );
}
