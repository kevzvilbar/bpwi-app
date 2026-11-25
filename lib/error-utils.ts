export function getErrorMessage(err: unknown, fallback = 'Unexpected error'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

/**
 * True when an error message means the request never completed (so it is safe to queue and retry).
 * Browsers word this differently: Chrome "Failed to fetch", Firefox "NetworkError when attempting to
 * fetch resource", Safari/iOS "Load failed" or "The network connection was lost".
 * "load failed" is matched as whole words so that "Photo upload failed" is not treated as a network error.
 */
export function isNetworkErrorMessage(message: string): boolean {
  return /fetch|network|failed to load|\bload failed\b/i.test(message);
}
