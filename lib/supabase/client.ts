import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { getSupabaseEnv } from './env';

export const supabaseBrowser = (): SupabaseClient<Database> => {
  const { url, key, isConfigured } = getSupabaseEnv();
  if (!isConfigured) {
    throw new Error('Supabase environment variables are not configured.');
  }
  return createBrowserClient<Database>(url, key) as unknown as SupabaseClient<Database>;
};
