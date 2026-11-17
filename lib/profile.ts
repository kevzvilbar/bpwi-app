import { supabaseServer } from '@/lib/supabase/server';

export async function getProfile() {
  const sb = supabaseServer();
  const { data: prof } = await sb.from('user_profiles').select('full_name, role, organization_id').maybeSingle();
  const role = (prof?.role ?? 'viewer') as string;
  return {
    sb,
    role,
    orgId: (prof?.organization_id ?? '') as string,
    name: (prof?.full_name ?? '') as string,
    canEdit: role === 'admin' || role === 'scheduler',
    isAdmin: role === 'admin',
  };
}

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
