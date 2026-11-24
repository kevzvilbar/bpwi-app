export function shouldBypassSessionAuth(pathname: string, method: string): boolean {
  const upper = method.toUpperCase();
  // Browser CSP violation reports can arrive from /login or expired sessions without a session cookie.
  if (pathname === '/api/csp-report' && upper === 'POST') return true;
  if (upper !== 'GET' && upper !== 'HEAD') return false;
  // PWA service worker and web manifest must never redirect to /login (browsers reject redirected SW scripts).
  if (pathname === '/sw.js' || pathname === '/manifest.webmanifest') return true;
  // OAuth PKCE callback exchanges ?code=... for a session cookie before any session exists.
  if (pathname === '/auth/callback' && upper === 'GET') return true;
  // Vercel Cron calls GET /api/activities/purge-photos with a Bearer CRON_SECRET and no session cookie.
  // The route handler itself strictly verifies CRON_SECRET and returns 401 otherwise.
  return pathname === '/api/activities/purge-photos' && upper === 'GET';
}
