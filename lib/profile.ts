import { cache } from 'react';
import { supabaseServer } from '@/lib/supabase/server';

export const getProfile = cache(async () => {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  let prof: { full_name?: string | null; role?: string | null; organization_id?: string | null; operator_id?: string | null } | null = null;
  if (user) {
    const res = await sb
      .from('user_profiles')
      .select('full_name, role, organization_id, operator_id')
      .eq('id', user.id)
      .maybeSingle();
    if (res.error) {
      const fallback = await sb
        .from('user_profiles')
        .select('full_name, role, organization_id')
        .eq('id', user.id)
        .maybeSingle();
      prof = fallback.data;
    } else {
      prof = res.data;
    }
  }

  const role = (prof?.role ?? 'viewer') as string;
  return {
    sb,
    user,
    role,
    orgId: (prof?.organization_id ?? '') as string,
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
