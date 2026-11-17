import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseEnv } from './env';

export async function supabaseServer() {
  const { url, key, isConfigured } = getSupabaseEnv();
  if (!isConfigured) {
    throw new Error('Supabase environment variables are not configured.');
  }
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* server component */
        }
      },
    },
  });
}
