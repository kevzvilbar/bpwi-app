import { getProfile } from '@/lib/profile';
import Setup from '@/components/Setup';

export const dynamic = 'force-dynamic';

export default async function OperatorsPage() {
  const { sb, user, orgId, isAdmin } = await getProfile();
  const areasPrimary = await sb.from('area_codes').select('id, code, name, category, background_color, text_color, sub_sites').order('code');
  const areas = areasPrimary.error
    ? await sb.from('area_codes').select('id, code, name, category, background_color, text_color').order('code')
    : areasPrimary;

  const opsPrimary = await sb.from('operators').select('id, full_name, position, phone_number, default_station, sort_order, is_active, department_head_id').order('sort_order');
  const opsFallback = opsPrimary.error
    ? await sb.from('operators').select('id, full_name, position, phone_number, default_station, sort_order, is_active').order('sort_order')
    : opsPrimary;

  const [shifts, users, logs, people, grants, holidaysRes, orgPosRes] = await Promise.all([
    sb.from('shift_types').select('id, code, description, start_time, end_time, duration_hours, is_off, background_color, text_color').order('code'),
    isAdmin
      ? sb.from('user_profiles').select('id, full_name, role, is_active, operator_id').order('role').order('full_name')
      : Promise.resolve({ data: [], error: null }),
    isAdmin
      ? sb.from('audit_logs').select('id, user_id, action, table_name, record_id, old_value, new_value, created_at').order('created_at', { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    isAdmin
      ? sb.from('user_profiles').select('id, full_name, role, is_active, phone_number, job_title, can_approve').order('full_name')
      : Promise.resolve({ data: [], error: null }),
    isAdmin
      ? sb.from('edit_grants').select('id, user_id, starts_at, ends_at, date_from, date_to, note, revoked_at, created_at').order('starts_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: [], error: null }),
    sb.from('holidays').select('id, holiday_date, name, holiday_type').order('holiday_date'),
    isAdmin
      ? sb.from('org_positions').select('id, title, department_group, tier, holder_user_id, is_vacant').eq('is_active', true).order('sort_order')
      : Promise.resolve({ data: [], error: null }),
  ]);
  const ops = opsFallback;

  return (
    <Setup
      operators={ops.data ?? []}
      shifts={shifts.data ?? []}
      areas={areas.data ?? []}
      users={users.data ?? []}
      auditLogs={logs.data ?? []}
      people={people.data ?? []}
      grants={grants.data ?? []}
      holidays={holidaysRes.error ? [] : (holidaysRes.data ?? [])}
      holidaysError={holidaysRes.error?.message ?? ''}
      orgPositions={orgPosRes.error ? [] : (orgPosRes.data ?? [])}
      headsError={people.error?.message ?? grants.error?.message ?? ''}
      orgId={orgId}
      currentUserId={user?.id ?? ''}
      isAdmin={isAdmin}
      error={ops.error?.message ?? shifts.error?.message ?? areas.error?.message ?? users.error?.message ?? logs.error?.message ?? ''}
    />
  );
}
