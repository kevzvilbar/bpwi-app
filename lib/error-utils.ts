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
  return /fetch|network|failed to load|\bload failed\b|timed out|timeout|aborted/i.test(message);
}

export type SyncErrorKind = 'network' | 'auth' | 'conflict' | 'other';

/** Categorizes offline sync errors so weak-signal retries, expired sessions, and conflicts get distinct handling. */
export function classifySyncError(message: string): SyncErrorKind {
  if (/^conflict:/i.test(message.trim())) return 'conflict';
  if (/jwt|refresh token|session.*expired|not authenticated|unauthorized|\b401\b/i.test(message)) {
    return 'auth';
  }
  if (isNetworkErrorMessage(message)) return 'network';
  return 'other';
}
