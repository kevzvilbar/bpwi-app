import { getProfile } from '@/lib/profile';
import { manilaToday } from '@/lib/date';
import AccomplishmentReports from '@/components/AccomplishmentReports';
import type { DailyActivityRow } from '@/lib/activity-types';
import type { AccomplishmentReportRow } from '@/lib/accomplishment-form';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const { sb, user, role, orgId, operatorId, name, canVerifyActivity } = await getProfile();
  const today = manilaToday();

  const opsPrimary = await sb
    .from('operators')
    .select('id, full_name, position, department_head_id')
    .eq('is_active', true)
    .order('sort_order');
  const opsRes = opsPrimary.error
    ? await sb.from('operators').select('id, full_name, position').eq('is_active', true).order('sort_order')
    : opsPrimary;

  const [headsRes, shiftsRes, areasRes, actsRes, reportsRes, myProfRes] = await Promise.all([
    sb
      .from('user_profiles')
      .select('id, full_name, role, job_title')
      .eq('is_active', true)
      .in('role', ['manager', 'admin'])
      .order('full_name'),
    sb.from('shift_types').select('id, code, description').eq('is_off', false).order('code'),
    sb.from('area_codes').select('id, code, name').order('code'),
    sb
      .from('daily_activities')
      .select('*')
      .eq('organization_id', orgId)
      .eq('activity_date', today)
      .order('started_at', { ascending: true }),
    sb
      .from('accomplishment_reports')
      .select('*')
      .eq('organization_id', orgId)
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(60),
    user
      ? sb.from('user_profiles').select('job_title').eq('id', user.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const migrationMissing = Boolean(reportsRes.error && /accomplishment_reports/i.test(reportsRes.error.message));

  const myTodayActs = ((actsRes.data ?? []) as DailyActivityRow[]).filter(
    (a) =>
      a.logged_by === user?.id ||
      (operatorId && (a.lead_operator_id === operatorId || a.crew_operator_ids?.includes(operatorId))),
  );

  return (
    <AccomplishmentReports
      orgId={orgId}
      userId={user?.id ?? ''}
      userName={name}
      userRole={role}
      userJobTitle={(myProfRes.data as { job_title?: string | null } | null)?.job_title ?? null}
      operatorId={operatorId}
      today={today}
      canVerify={canVerifyActivity}
      heads={headsRes.data ?? []}
      operators={opsRes.data ?? []}
      shifts={shiftsRes.data ?? []}
      areas={areasRes.data ?? []}
      initialActivities={myTodayActs}
      initialReports={migrationMissing ? [] : ((reportsRes.data ?? []) as AccomplishmentReportRow[])}
      migrationMissing={migrationMissing}
      error={!migrationMissing ? (reportsRes.error?.message || actsRes.error?.message || '') : ''}
    />
  );
}
