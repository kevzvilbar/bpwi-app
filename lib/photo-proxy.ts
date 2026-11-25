const SAMPLE_FILENAME_PREFIX = 'sample-';
const SUPABASE_AUTH_COOKIE_RE = /^sb-.*-auth-token/i;

export interface PhotoCacheHeaderResult {
  etag: string;
  headers: Record<string, string>;
  cacheable: boolean;
}

/**
 * Returns true if the filename segment (last `/`-separated part) starts with `sample-` (case-insensitive).
 */
export function isSampleStoragePath(storagePath: string): boolean {
  const trimmed = storagePath.trim();
  if (!trimmed) return false;
  const segments = trimmed.split('/');
  const fileName = segments[segments.length - 1] ?? '';
  return fileName.toLowerCase().startsWith(SAMPLE_FILENAME_PREFIX);
}

/**
 * Computes conservative private cache headers for proxied activity photos.
 * Sample photos are never cached (`private, no-store`), and real photos revalidate
 * after 5 minutes (`private, max-age=300, must-revalidate`) with a deterministic ETag.
 */
export function buildPhotoCacheHeaders(
  storagePath: string,
  isSample: boolean,
): PhotoCacheHeaderResult {
  if (isSample || isSampleStoragePath(storagePath)) {
    return {
      etag: '',
      cacheable: false,
      headers: {
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    };
  }

  const etag = `"bpwi-photo-${Buffer.from(storagePath, 'utf8').toString('base64url')}"`;
  return {
    etag,
    cacheable: true,
    headers: {
      'Cache-Control': 'private, max-age=300, must-revalidate',
      ETag: etag,
      Vary: 'Cookie',
    },
  };
}

/**
 * Returns true iff any cookie name looks like a Supabase auth token cookie
 * (`sb-<ref>-auth-token*` or legacy `supabase-auth-token`).
 */
export function hasSupabaseAuthCookie(cookieNames: string[]): boolean {
  return cookieNames.some((raw) => {
    const name = raw.trim();
    return SUPABASE_AUTH_COOKIE_RE.test(name) || name.toLowerCase() === 'supabase-auth-token';
  });
}
