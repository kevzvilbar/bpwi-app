export function shouldBypassSessionAuth(pathname: string, method: string): boolean {
  // Vercel Cron calls GET /api/activities/purge-photos with a Bearer CRON_SECRET and no session cookie.
  // The route handler itself strictly verifies CRON_SECRET and returns 401 otherwise.
  return pathname === '/api/activities/purge-photos' && method.toUpperCase() === 'GET';
}
