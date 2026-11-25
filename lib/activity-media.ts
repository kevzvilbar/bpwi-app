export const ACTIVITY_MEDIA_BUCKET = 'activity-media';

const STORAGE_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+\.(?:webp|jpe?g|png)$/i;

const LEGACY_STORAGE_PATH_RE =
  /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/activity-media\/(.+)$/;

/**
 * Photos attached to sample logs are stored as `<orgId>/<date>/sample-<name>.<ext>`. The Storage RLS policy
 * (migration 035) lets department heads upload/delete only objects with this file-name prefix, so they can
 * never add or remove photos belonging to real activity logs.
 */
export const SAMPLE_PHOTO_PREFIX = 'sample-';

export function samplePhotoStem(stem: string, sample: boolean | undefined): string {
  return sample ? `${SAMPLE_PHOTO_PREFIX}${stem}` : stem;
}

export function isSamplePhotoPath(storagePath: string): boolean {
  const fileName = storagePath.trim().split('/')[2] ?? '';
  return fileName.startsWith(SAMPLE_PHOTO_PREFIX);
}

export function isValidActivityStoragePath(storagePath: string): boolean {
  const trimmed = storagePath.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('\\')) return false;
  return STORAGE_PATH_RE.test(trimmed);
}

/**
 * Verifies that a validated storage path belongs to the specified organization
 * (the first path segment must match `orgId` case-insensitively).
 */
export function isStoragePathOwnedByOrg(storagePath: string, orgId: string): boolean {
  const cleanOrg = orgId.trim().toLowerCase();
  if (!cleanOrg) return false;
  const trimmedPath = storagePath.trim();
  if (!isValidActivityStoragePath(trimmedPath)) return false;
  const slashIdx = trimmedPath.indexOf('/');
  if (slashIdx <= 0) return false;
  return trimmedPath.slice(0, slashIdx).toLowerCase() === cleanOrg;
}

export function getActivityPhotoContentType(
  storagePath: string,
): 'image/webp' | 'image/png' | 'image/jpeg' {
  const lower = storagePath.toLowerCase();
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

export function extractActivityStoragePath(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;

  if (isValidActivityStoragePath(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed, 'http://localhost');
    if (parsed.pathname === '/api/activities/photo') {
      const pathParam = parsed.searchParams.get('path')?.trim() ?? '';
      return isValidActivityStoragePath(pathParam) ? pathParam : null;
    }

    const legacyMatch = parsed.pathname.match(LEGACY_STORAGE_PATH_RE);
    if (legacyMatch?.[1]) {
      const decoded = decodeURIComponent(legacyMatch[1]).trim();
      return isValidActivityStoragePath(decoded) ? decoded : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function buildActivityPhotoUrl(storagePath: string): string {
  return `/api/activities/photo?path=${encodeURIComponent(storagePath)}`;
}

export function resolveActivityPhotoUrl(
  rawUrl: string,
  storagePath?: string | null,
): string {
  if (rawUrl.startsWith('data:image/')) {
    return rawUrl;
  }

  const cleanPath = storagePath?.trim();
  if (cleanPath && isValidActivityStoragePath(cleanPath)) {
    return buildActivityPhotoUrl(cleanPath);
  }

  const extracted = extractActivityStoragePath(rawUrl);
  if (extracted) {
    return buildActivityPhotoUrl(extracted);
  }

  return rawUrl;
}
