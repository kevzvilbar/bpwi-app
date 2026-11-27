export const DEFAULT_PHOTO_RETENTION_DAYS = 30;
export const EVIDENCE_PHOTO_RETENTION_DAYS = 180;
export const MAX_PHOTO_RETENTION_DAYS = 365;

export const EXTENDED_EVIDENCE_ACTIVITY_TYPES = new Set<string>(['meter_test', 'leak_repair']);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PhotoRetentionCandidate {
  activity_type?: string | null;
  status?: string | null;
  photo_hold?: boolean | null;
  photos_expires_at?: string | null;
  created_at?: string | null;
}

/** Returns the default storage retention window (days) before expiry for an activity type. */
export function getPhotoRetentionDays(activityType: string): number {
  return EXTENDED_EVIDENCE_ACTIVITY_TYPES.has(activityType)
    ? EVIDENCE_PHOTO_RETENTION_DAYS
    : DEFAULT_PHOTO_RETENTION_DAYS;
}

/** Computes the initial `photos_expires_at` ISO timestamp, capped at MAX_PHOTO_RETENTION_DAYS. */
export function computePhotoExpiryIso(activityType: string, baseMs = Date.now()): string {
  const days = Math.min(getPhotoRetentionDays(activityType), MAX_PHOTO_RETENTION_DAYS);
  return new Date(baseMs + days * MS_PER_DAY).toISOString();
}

/**
 * Determines whether a field log's photos are eligible for storage purge at `nowMs`.
 * Flagged logs and supervisor-held logs are exempt until the 365-day privacy ceiling elapses.
 */
export function isPhotoPurgeEligible(row: PhotoRetentionCandidate, nowMs = Date.now()): boolean {
  const createdMs = row.created_at ? Date.parse(row.created_at) : Number.NaN;
  if (Number.isFinite(createdMs) && nowMs - createdMs >= MAX_PHOTO_RETENTION_DAYS * MS_PER_DAY) {
    return true;
  }
  if (row.status === 'flagged' || row.photo_hold === true) {
    return false;
  }
  const expiresMs = row.photos_expires_at ? Date.parse(row.photos_expires_at) : Number.NaN;
  if (Number.isFinite(expiresMs)) {
    return expiresMs < nowMs;
  }
  if (Number.isFinite(createdMs)) {
    const retentionMs = getPhotoRetentionDays(row.activity_type ?? '') * MS_PER_DAY;
    return createdMs < nowMs - retentionMs;
  }
  return false;
}
