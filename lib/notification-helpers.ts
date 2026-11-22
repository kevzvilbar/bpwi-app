/**
 * Determines whether a focus/visibility event should refresh notifications,
 * enforcing a cooldown period and visible-tab guard to prevent PostgREST spam on alt-tabs.
 */
export function shouldRefreshNotifications(
  lastFetchedMs: number,
  nowMs: number,
  cooldownMs: number,
  isVisible: boolean,
): boolean {
  if (!isVisible) return false;
  if (lastFetchedMs <= 0) return true;
  return nowMs - lastFetchedMs >= cooldownMs;
}
