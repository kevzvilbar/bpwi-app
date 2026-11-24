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
