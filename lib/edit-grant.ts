export type EditGrantWindow = {
  starts_at: string;
  ends_at: string;
  date_from: string | null;
  date_to: string | null;
};

export function isGrantActiveAt(grant: EditGrantWindow | null | undefined, nowMs = Date.now()): boolean {
  if (!grant) return false;
  const startMs = Date.parse(grant.starts_at);
  const endMs = Date.parse(grant.ends_at);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return startMs <= nowMs && nowMs < endMs;
}

export function isDateInGrantRange(grant: EditGrantWindow | null | undefined, isoDate: string): boolean {
  if (!grant) return false;
  if (grant.date_from && isoDate < grant.date_from) return false;
  if (grant.date_to && isoDate > grant.date_to) return false;
  return true;
}

export function canManagerDirectEditDate(
  grant: EditGrantWindow | null | undefined,
  isoDate: string,
  nowMs = Date.now(),
): boolean {
  return isGrantActiveAt(grant, nowMs) && isDateInGrantRange(grant, isoDate);
}
