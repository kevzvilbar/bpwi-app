export type OrgTier = 'executive' | 'support' | 'head' | 'leadman' | 'staff';
export type OrgColorTheme = 'navy' | 'blue' | 'teal' | 'purple' | 'amber' | 'slate';

export interface OrgPositionRow {
  id: string;
  organization_id: string;
  title: string;
  department_group: string;
  tier: OrgTier;
  parent_position_id: string | null;
  secondary_parent_id: string | null;
  holder_user_id: string | null;
  holder_operator_id: string | null;
  fallback_name: string | null;
  shift_badge: string | null;
  color_theme: OrgColorTheme;
  is_vacant: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface OrgUserLite {
  id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  job_title?: string | null;
}

export interface OrgOperatorLite {
  id: string;
  full_name: string;
  position: string | null;
  is_active: boolean;
}

/**
 * Resolves the display name for an org position node:
 * 1. If marked vacant -> "Vacant Position"
 * 2. Linked active user_profile full_name
 * 3. Linked operator full_name
 * 4. Directory fallback_name (for staff/heads without an app account yet)
 */
export function resolvePositionDisplayName(
  pos: OrgPositionRow,
  usersById: Map<string, OrgUserLite>,
  opsById: Map<string, OrgOperatorLite>,
): { name: string; source: 'user' | 'operator' | 'directory' | 'vacant' } {
  if (pos.is_vacant) return { name: 'Vacant (Open Position)', source: 'vacant' };
  if (pos.holder_user_id) {
    const u = usersById.get(pos.holder_user_id);
    if (u?.is_active && u.full_name?.trim()) return { name: u.full_name.trim(), source: 'user' };
  }
  if (pos.holder_operator_id) {
    const o = opsById.get(pos.holder_operator_id);
    if (o?.full_name?.trim()) return { name: o.full_name.trim(), source: 'operator' };
  }
  if (pos.fallback_name?.trim()) {
    return { name: pos.fallback_name.trim(), source: 'directory' };
  }
  return { name: 'Unassigned', source: 'vacant' };
}

/**
 * Prevents circular parent references when restructuring nodes.
 */
export function wouldCreateCycle(
  positions: OrgPositionRow[],
  nodeId: string,
  candidateParentId: string | null,
): boolean {
  if (!candidateParentId) return false;
  if (candidateParentId === nodeId) return true;
  const byId = new Map(positions.map((p) => [p.id, p]));
  const visited = new Set<string>([nodeId]);
  let cur: string | null = candidateParentId;
  while (cur) {
    if (visited.has(cur)) return true;
    visited.add(cur);
    cur = byId.get(cur)?.parent_position_id ?? null;
  }
  return false;
}

/**
 * Computes all direct + 2-hop subordinate position IDs under a head position.
 */
export function collectSubordinatePositionIds(
  positions: OrgPositionRow[],
  headPositionId: string,
): Set<string> {
  const result = new Set<string>();
  const queue = [headPositionId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const p of positions) {
      if (!p.is_active) continue;
      if ((p.parent_position_id === cur || p.secondary_parent_id === cur) && !result.has(p.id)) {
        result.add(p.id);
        queue.push(p.id);
      }
    }
  }
  return result;
}
