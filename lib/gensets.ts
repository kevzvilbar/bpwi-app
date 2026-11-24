/**
 * Pure genset registry helpers, location conflict checks, and PM task Control # auto-tagging.
 *
 * Uses zero `@/` imports so Node's native test runner executes it directly.
 */

export type GensetStatus = 'active' | 'standby_yard' | 'under_repair' | 'retired';

export interface GensetRow {
  id: string;
  control_no: string;
  brand_model: string | null;
  kva_rating: string | null;
  fuel_type: string;
  status: GensetStatus;
  current_location: string | null;
  notes: string | null;
}

export interface GensetTransferRow {
  id: string;
  genset_id: string;
  from_location: string | null;
  to_location: string | null;
  reason: string | null;
  moved_by: string | null;
  moved_at: string;
}

export const GENSET_STATUS_LABELS: Record<GensetStatus, string> = {
  active: 'Active on site',
  standby_yard: 'Standby / Yard',
  under_repair: 'Under repair',
  retired: 'Retired',
};

export function normalizeGensetKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function formatGensetTag(
  g: Pick<GensetRow, 'control_no' | 'kva_rating' | 'brand_model'>,
): string {
  const ctrl = g.control_no.trim();
  const kva = (g.kva_rating ?? '').trim();
  if (kva) return `${ctrl} (${kva})`;
  return ctrl;
}

export function findActiveGensetAtLocation(
  gensets: GensetRow[],
  locationName: string | null | undefined,
  excludeId?: string,
): GensetRow | null {
  const targetKey = normalizeGensetKey(locationName ?? '');
  if (!targetKey) return null;
  return (
    gensets.find(
      (g) =>
        g.id !== excludeId &&
        g.status === 'active' &&
        normalizeGensetKey(g.current_location ?? '') === targetKey,
    ) ?? null
  );
}

export function canAssignGensetToLocation(
  gensets: GensetRow[],
  targetLocation: string | null | undefined,
  status: GensetStatus,
  excludeId?: string,
): { ok: true } | { ok: false; occupiedBy: GensetRow; error: string } {
  if (status !== 'active') return { ok: true };
  const cleaned = (targetLocation ?? '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return { ok: true };

  const occupiedBy = findActiveGensetAtLocation(gensets, cleaned, excludeId);
  if (!occupiedBy) return { ok: true };

  return {
    ok: false,
    occupiedBy,
    error: `"${cleaned}" already has active genset ${occupiedBy.control_no}. Move or set ${occupiedBy.control_no} to Yard/Repair first.`,
  };
}

export function resolveTaskAssetForLocations(
  activityType: string,
  locations: string[],
  gensets: GensetRow[],
  manualAsset: string,
): string | null {
  const manual = manualAsset.trim();
  if (manual) return manual;
  if (activityType !== 'GENSET' || locations.length === 0) return null;

  const seenIds = new Set<string>();
  const tags: string[] = [];
  for (const loc of locations) {
    const g = findActiveGensetAtLocation(gensets, loc);
    if (g && !seenIds.has(g.id)) {
      seenIds.add(g.id);
      tags.push(formatGensetTag(g));
    }
  }
  return tags.length > 0 ? tags.join(', ') : null;
}

export function isMissingGensetsTableError(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  const msg = err.message ?? '';
  return /gensets.*does not exist|could not find the table.*gensets/i.test(msg);
}
