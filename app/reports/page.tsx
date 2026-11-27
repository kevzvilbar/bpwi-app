import { getProfile } from '@/lib/profile';
import { manilaToday } from '@/lib/date';
import {
  ACCOMPLISHMENT_REPORT_COLUMNS,
  buildOwnActivityOrFilter,
  DAILY_ACTIVITY_REPORT_COLUMNS,
} from '@/lib/query-columns';
import AccomplishmentReports from '@/components/AccomplishmentReports';
import type { DailyActivityRow } from '@/lib/activity-types';
import type { AccomplishmentReportRow } from '@/lib/accomplishment-form';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const { sb, user, role, orgId, operatorId, name, jobTitle, canLogSampleActivity, canVerifyActivity } = await getProfile();
  const today = manilaToday();
  const ownActFilter = buildOwnActivityOrFilter(user?.id, operatorId);

  const [opsPrimary, headsRes, shiftsRes, areasRes, actsRes, reportsRes] = await Promise.all([
    sb
      .from('operators')
      .select('id, full_name, position, department_head_id')
      .eq('is_active', true)
      .order('sort_order'),
    sb
      .from('user_profiles')
      .select('id, full_name, role, job_title')
      .eq('is_active', true)
      .in('role', ['manager', 'admin'])
      .order('full_name'),
    sb.from('shift_types').select('id, code, description').eq('is_off', false).order('code'),
    sb.from('area_codes').select('id, code, name').order('code'),
    ownActFilter
      ? sb
          .from('daily_activities')
          .select(DAILY_ACTIVITY_REPORT_COLUMNS)
          .eq('organization_id', orgId)
          .eq('is_sample', false)
          .eq('activity_date', today)
          .or(ownActFilter)
          .order('started_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    (() => {
      let q = sb
        .from('accomplishment_reports')
        .select(ACCOMPLISHMENT_REPORT_COLUMNS)
        .eq('organization_id', orgId)
        .order('report_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(35);
      if (!canVerifyActivity && user) q = q.eq('submitted_by', user.id);
      return q;
    })(),
  ]);

  const opsRes = opsPrimary.error
    ? await sb.from('operators').select('id, full_name, position').eq('is_active', true).order('sort_order')
    : opsPrimary;

  const migrationMissing = Boolean(reportsRes.error && /accomplishment_reports/i.test(reportsRes.error.message));

  const loadErrors = Array.from(
    new Set(
      [
        reportsRes.error?.message,
        actsRes.error?.message,
        headsRes.error?.message,
        opsRes.error?.message,
        shiftsRes.error?.message,
        areasRes.error?.message,
      ].filter((e): e is string => Boolean(e)),
    ),
  );

  return (
    <AccomplishmentReports
      orgId={orgId}
      userId={user?.id ?? ''}
      userName={name}
      userRole={role}
      userJobTitle={jobTitle}
      operatorId={operatorId}
      today={today}
      canVerify={canVerifyActivity}
      canLogSample={canLogSampleActivity}
      heads={headsRes.data ?? []}
      operators={opsRes.data ?? []}
      shifts={shiftsRes.data ?? []}
      areas={areasRes.data ?? []}
      initialActivities={(actsRes.data ?? []) as DailyActivityRow[]}
      initialReports={migrationMissing ? [] : ((reportsRes.data ?? []) as AccomplishmentReportRow[])}
      migrationMissing={migrationMissing}
      error={!migrationMissing ? loadErrors.join(' · ') : ''}
    />
  );
}
