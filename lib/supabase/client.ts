import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseEnv } from './env';

export const supabaseBrowser = () => {
  const { url, key, isConfigured } = getSupabaseEnv();
  if (!isConfigured) {
    throw new Error('Supabase environment variables are not configured.');
  }
  return createBrowserClient(url, key);
};
