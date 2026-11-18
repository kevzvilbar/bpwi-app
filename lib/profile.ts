import { cache } from 'react';
import { supabaseServer } from '@/lib/supabase/server';

/** An admin-granted edit window for a department head (see supabase/migrations/008). */
export type EditGrant = {
  starts_at: string;
  ends_at: string;
  date_from: string | null;
  date_to: string | null;
  note: string | null;
};

export const getProfile = cache(async () => {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  type OrgJoin = { name?: string | null; app_title?: string | null } | { name?: string | null; app_title?: string | null }[] | null;
  type ProfRow = {
    full_name?: string | null;
    role?: string | null;
    is_active?: boolean | null;
    organization_id?: string | null;
    operator_id?: string | null;
    can_approve?: boolean | null;
    organizations?: OrgJoin;
  };

  let prof: ProfRow | null = null;
  let orgName = 'BP Waterworks, Inc.';
  let appTitle = 'Operations & Plant Schedule';

  if (user) {
    const res = await sb
      .from('user_profiles')
      .select('full_name, role, is_active, organization_id, operator_id, can_approve, organizations(name, app_title)')
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
        .select('full_name, role, is_active, organization_id')
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
  const isActive = Boolean(prof && prof.is_active !== false);
  const role = (prof?.role ?? 'viewer') as string;
  const isAdmin = isActive && role === 'admin';
  const isManager = isActive && role === 'manager';

  // Department heads are read-only unless an admin has opened an edit window for them. The database
  // enforces the window (and its date range) on every write; this only drives what the UI offers.
  let editGrant: EditGrant | null = null;
  let nextGrant: EditGrant | null = null;
  if (user && isManager) {
    const nowMs = Date.now();
    const { data } = await sb
      .from('edit_grants')
      .select('starts_at, ends_at, date_from, date_to, note')
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .gt('ends_at', new Date(nowMs).toISOString())
      .order('starts_at');
    for (const g of (data ?? []) as EditGrant[]) {
      if (new Date(g.starts_at).getTime() <= nowMs) {
        if (!editGrant || new Date(g.ends_at) > new Date(editGrant.ends_at)) editGrant = g;
      } else if (!nextGrant) {
        nextGrant = g;
      }
    }
  }

  let pendingUsersCount = 0;
  if (isAdmin && orgId) {
    const { count } = await sb
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', false);
    pendingUsersCount = count ?? 0;
  }

  return {
    sb,
    user,
    role,
    isActive,
    pendingUsersCount,
    orgId,
    orgName,
    appTitle,
    operatorId: (prof?.operator_id ?? null) as string | null,
    name: (prof?.full_name ?? (user?.user_metadata?.full_name as string | undefined) ?? '') as string,
    canEdit: isActive && (role === 'admin' || role === 'scheduler' || (isManager && editGrant !== null)),
    canClosePm: isActive && (role === 'admin' || role === 'scheduler' || role === 'operator' || (isManager && editGrant !== null)),
    /** Bulk schedule generation stays with admins and schedulers. */
    canGenerate: isActive && (role === 'admin' || role === 'scheduler'),
    /** Admins, plus anyone an admin has delegated approval to (used by the upcoming change-request queue). */
    canApprove: isActive && (role === 'admin' || prof?.can_approve === true),
    isAdmin,
    isManager,
    editGrant,
    nextGrant,
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
