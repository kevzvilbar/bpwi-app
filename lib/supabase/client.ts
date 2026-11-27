import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { getSupabaseEnv } from './env';

const SUPABASE_BROWSER_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof AbortController === 'undefined') {
    return fetch(input, init);
  }
  const controller = new AbortController();
  let timedOut = false;
  const callerSignal = init?.signal;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SUPABASE_BROWSER_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    if (timedOut) {
      throw new Error('Request timed out — check your connection');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

export const supabaseBrowser = (): SupabaseClient<Database> => {
  const { url, key, isConfigured } = getSupabaseEnv();
  if (!isConfigured) {
    throw new Error('Supabase environment variables are not configured.');
  }
  return createBrowserClient<Database>(url, key, {
    global: { fetch: fetchWithTimeout },
  }) as unknown as SupabaseClient<Database>;
};
