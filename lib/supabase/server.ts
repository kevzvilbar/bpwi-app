import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from './database.types';
import { getSupabaseEnv } from './env';

export async function supabaseServer(): Promise<SupabaseClient<Database>> {
  const { url, key, isConfigured } = getSupabaseEnv();
  if (!isConfigured) {
    throw new Error('Supabase environment variables are not configured.');
  }
  const store = await cookies();
  return createServerClient<Database>(url, key, {
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
  }) as unknown as SupabaseClient<Database>;
}
