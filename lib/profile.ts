import { cache } from 'react';
import { supabaseServer } from '@/lib/supabase/server';

export const getProfile = cache(async () => {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  type OrgJoin = { name?: string | null; app_title?: string | null } | { name?: string | null; app_title?: string | null }[] | null;
  type ProfRow = {
    full_name?: string | null;
    role?: string | null;
    organization_id?: string | null;
    operator_id?: string | null;
    organizations?: OrgJoin;
  };

  let prof: ProfRow | null = null;
  let orgName = 'BP Waterworks, Inc.';
  let appTitle = 'Operations & Plant Schedule';

  if (user) {
    const res = await sb
      .from('user_profiles')
      .select('full_name, role, organization_id, operator_id, organizations(name, app_title)')
      .eq('id', user.id)
      .maybeSingle();

    if (!res.error) {
      prof = res.data as ProfRow | null;
      const orgData = Array.isArray(prof?.organizations) ? prof?.organizations[0] : prof?.organizations;
      if (orgData?.name) orgName = orgData.name;
      if (orgData?.app_title) appTitle = orgData.app_title;
    } else {
      const fb = await sb
        .from('user_profiles')
        .select('full_name, role, organization_id')
        .eq('id', user.id)
        .maybeSingle();
      prof = fb.data as ProfRow | null;
      const fbOrgId = (prof?.organization_id ?? '') as string;
      if (fbOrgId) {
        const orgRes = await sb.from('organizations').select('name').eq('id', fbOrgId).maybeSingle();
        if (orgRes.data?.name) orgName = orgRes.data.name;
      }
    }
  }

  const orgId = (prof?.organization_id ?? '') as string;

  const role = (prof?.role ?? 'viewer') as string;
  return {
    sb,
    user,
    role,
    orgId,
    orgName,
    appTitle,
    operatorId: (prof?.operator_id ?? null) as string | null,
    name: (prof?.full_name ?? '') as string,
    canEdit: role === 'admin' || role === 'scheduler',
    canClosePm: role === 'admin' || role === 'scheduler' || role === 'operator',
    isAdmin: role === 'admin',
  };
});

/** PostgREST caps responses at 1000 rows; page through a query until exhausted. */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) return { data: out, error: error.message };
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: '' };
}
