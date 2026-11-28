export function shouldBypassSessionAuth(pathname: string, method: string): boolean {
  const upper = method.toUpperCase();
  // Browser CSP violation reports can arrive from /login or expired sessions without a session cookie.
  if (pathname === '/api/csp-report' && upper === 'POST') return true;
  if (upper !== 'GET' && upper !== 'HEAD') return false;
  // PWA service worker, web manifest, and MapLibre Web Worker must never redirect to /login.
  if (
    pathname === '/sw.js' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/maplibre-gl-worker.mjs'
  ) {
    return true;
  }
  // Vercel Cron calls GET /api/activities/purge-photos with a Bearer CRON_SECRET and no session cookie.
  // The route handler itself strictly verifies CRON_SECRET and returns 401 otherwise.
  return pathname === '/api/activities/purge-photos' && upper === 'GET';
}
