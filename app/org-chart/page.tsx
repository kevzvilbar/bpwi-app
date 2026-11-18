import { redirect } from 'next/navigation';
import { getProfile } from '@/lib/profile';
import OrgChart from '@/components/OrgChart';
import type { OrgPositionRow } from '@/lib/org-chart';

export const dynamic = 'force-dynamic';

export default async function OrgChartPage() {
  const { sb, role, orgId, isAdmin } = await getProfile();

  // Strictly accessible only by Heads and up (manager, scheduler, admin)
  if (!['admin', 'scheduler', 'manager'].includes(role)) {
    redirect('/');
  }

  const [posRes, usersRes, opsRes, orgMetaRes] = await Promise.all([
    sb
      .from('org_positions')
      .select('*')
      .eq('organization_id', orgId)
      .order('sort_order'),
    sb
      .from('user_profiles')
      .select('id, full_name, role, is_active, job_title')
      .eq('organization_id', orgId)
      .order('full_name'),
    sb
      .from('operators')
      .select('id, full_name, position, is_active')
      .eq('organization_id', orgId)
      .order('sort_order'),
    sb
      .from('organizations')
      .select('org_chart_meta')
      .eq('id', orgId)
      .maybeSingle(),
  ]);

  const migrationMissing = Boolean(posRes.error && /org_positions/i.test(posRes.error.message));
  const initialMeta = !orgMetaRes.error ? ((orgMetaRes.data as { org_chart_meta?: Record<string, string> | null } | null)?.org_chart_meta ?? null) : null;

  return (
    <OrgChart
      orgId={orgId}
      role={role}
      canEdit={role === 'admin' || role === 'manager'}
      isAdmin={isAdmin}
      initialPositions={migrationMissing ? [] : ((posRes.data ?? []) as OrgPositionRow[])}
      users={usersRes.data ?? []}
      operators={opsRes.data ?? []}
      initialMeta={initialMeta}
      migrationMissing={migrationMissing}
      error={!migrationMissing ? (posRes.error?.message ?? '') : ''}
    />
  );
}
