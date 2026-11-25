/**
 * Pure helpers for 24-hour auto-expiring Sample Logs across
 * daily_activities, job_orders, shift_handovers, and accomplishment_reports.
 *
 * Uses zero `@/` imports so Node's native test runner executes it directly.
 */

export interface SampleLogFields {
  is_sample?: boolean | null;
  sample_expires_at?: string | null;
}

export function isActiveSample(row: SampleLogFields, nowMs = Date.now()): boolean {
  if (!row.is_sample) return false;
  if (!row.sample_expires_at) return true;
  const expMs = Date.parse(row.sample_expires_at);
  return Number.isFinite(expMs) ? expMs > nowMs : true;
}

export function excludeSamples<T extends SampleLogFields>(rows: T[]): T[] {
  return rows.filter((r) => !r.is_sample);
}

export function formatSampleRemaining(expiresAt: string | null | undefined, nowMs = Date.now()): string {
  if (!expiresAt) return '24h left';
  const expMs = Date.parse(expiresAt);
  if (!Number.isFinite(expMs)) return '24h left';
  const diffMs = expMs - nowMs;
  if (diffMs <= 0) return 'Expired';
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours <= 0) return `${mins}m left`;
  return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
}

export function isMissingSampleColumnsError(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!err) return false;
  const msg = err.message ?? '';
  return (
    err.code === '42703' ||
    err.code === 'PGRST204' ||
    /is_sample|sample_expires_at/i.test(msg)
  );
}

/**
 * Department heads (role 'manager') may edit/delete only SAMPLE logs; real records are read-only for them
 * (review actions such as verify/flag or check/return are separate and stay allowed). Mirrors the database
 * guard in migration 035 so the UI never offers an action the server will refuse.
 */
export function canEditLogRow(role: string | null | undefined, row: SampleLogFields): boolean {
  if (role === 'manager') return Boolean(row.is_sample);
  return true;
}

export interface SampleCleanupHealth {
  overdue_samples: number;
  queued_photos: number;
  oldest_queued_hours: number;
  pg_cron_scheduled: boolean;
}

/** Admin-facing warning when the 24h sample cleanup is not keeping up; null when everything is healthy. */
export function describeSampleCleanupHealth(h: Partial<SampleCleanupHealth> | null | undefined): string | null {
  if (!h) return null;
  const overdue = Number(h.overdue_samples ?? 0);
  const queued = Number(h.queued_photos ?? 0);
  const oldest = Number(h.oldest_queued_hours ?? 0);
  if (overdue > 0) {
    return h.pg_cron_scheduled
      ? `${overdue} expired sample record(s) have not been deleted yet. Check the hourly Supabase pg_cron job (bpwi-purge-expired-samples).`
      : `${overdue} expired sample record(s) are still stored: the hourly pg_cron cleanup is not scheduled. Enable pg_cron in Supabase, or make sure the daily /api/activities/purge-photos cron runs (CRON_SECRET and SUPABASE_SECRET_KEY must be set).`;
  }
  if (queued > 0 && oldest >= 48) {
    return `${queued} sample photo file(s) have been waiting ${Math.round(oldest)}h for removal. Check that the daily /api/activities/purge-photos cron runs (CRON_SECRET and SUPABASE_SECRET_KEY must be set).`;
  }
  return null;
}
