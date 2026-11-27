export interface HomeRouteSearchParams {
  m?: string;
  view?: string;
}

/**
 * Returns the default landing path for a signed-in user visiting `/`, or `null`
 * when the monthly roster should render directly.
 * Field operators default to `/field` unless they explicitly requested the roster (`?view=roster` or a month `?m=...`).
 */
export function resolveDefaultHomePath(
  role: string | null | undefined,
  searchParams?: HomeRouteSearchParams | null,
): string | null {
  if (role !== 'operator') return null;
  if (searchParams?.view === 'roster') return null;
  if (typeof searchParams?.m === 'string' && searchParams.m.trim().length > 0) return null;
  return '/field';
}

/**
 * Navigation target for the "Schedule" nav item. Operators get an explicit
 * `?view=roster` query param so clicking Schedule doesn't bounce back to `/field`.
 */
export function getScheduleNavHref(role: string | null | undefined): string {
  return role === 'operator' ? '/?view=roster' : '/';
}
