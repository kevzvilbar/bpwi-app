import { getProfile } from '@/lib/profile';
import Setup from '@/components/Setup';
import type { Person } from '@/components/DepartmentHeads';
import type { SetupUserProfile } from '@/components/SetupUsersAndAudit';

export const dynamic = 'force-dynamic';

export default async function OperatorsPage() {
  const { sb, user, orgId, isAdmin } = await getProfile();

  const [areasPrimary, opsPrimary, shifts, usersRes, grants, holidaysRes, orgPosRes, orgRes] = await Promise.all([
    sb.from('area_codes').select('id, code, name, category, background_color, text_color, sub_sites').order('code'),
    sb.from('operators').select('id, full_name, position, phone_number, default_station, sort_order, is_active, department_head_id').order('sort_order'),
    sb.from('shift_types').select('id, code, description, start_time, end_time, duration_hours, is_off, background_color, text_color').order('code'),
    isAdmin
      ? sb.from('user_profiles').select('id, full_name, role, is_active, operator_id, phone_number, job_title, can_approve').order('role').order('full_name')
      : Promise.resolve({ data: [], error: null }),
    isAdmin
      ? sb.from('edit_grants').select('id, user_id, starts_at, ends_at, date_from, date_to, note, revoked_at, created_at').order('starts_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: [], error: null }),
    sb.from('holidays').select('id, holiday_date, name, holiday_type').order('holiday_date'),
    isAdmin
      ? sb.from('org_positions').select('id, title, department_group, tier, holder_user_id, is_vacant').eq('is_active', true).order('sort_order')
      : Promise.resolve({ data: [], error: null }),
    isAdmin
      ? sb.from('organizations').select('allowed_signup_domains').eq('id', orgId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const [areas, ops] = await Promise.all([
    areasPrimary.error
      ? sb.from('area_codes').select('id, code, name, category, background_color, text_color').order('code')
      : Promise.resolve(areasPrimary),
    opsPrimary.error
      ? sb.from('operators').select('id, full_name, position, phone_number, default_station, sort_order, is_active').order('sort_order')
      : Promise.resolve(opsPrimary),
  ]);

  const rawUsers = (usersRes.data ?? []) as Array<SetupUserProfile & Person>;
  const peopleByName = [...rawUsers].sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''));
  const allowedSignupDomains =
    orgRes.error || !orgRes.data || !Array.isArray(orgRes.data.allowed_signup_domains)
      ? []
      : (orgRes.data.allowed_signup_domains as string[]);

  return (
    <Setup
      operators={ops.data ?? []}
      shifts={shifts.data ?? []}
      areas={areas.data ?? []}
      users={rawUsers}
      people={peopleByName}
      grants={grants.data ?? []}
      holidays={holidaysRes.error ? [] : (holidaysRes.data ?? [])}
      holidaysError={holidaysRes.error?.message ?? ''}
      orgPositions={orgPosRes.error ? [] : (orgPosRes.data ?? [])}
      headsError={usersRes.error?.message ?? grants.error?.message ?? ''}
      orgId={orgId}
      currentUserId={user?.id ?? ''}
      isAdmin={isAdmin}
      allowedSignupDomains={allowedSignupDomains}
      error={ops.error?.message ?? shifts.error?.message ?? areas.error?.message ?? usersRes.error?.message ?? ''}
    />
  );
}
