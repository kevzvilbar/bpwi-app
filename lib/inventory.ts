/**
 * Pure per-site consumables inventory types, balance aggregation, CSV export, and validation.
 *
 * Uses zero `@/` imports so Node's native test runner executes it directly.
 */

import { csvEscape } from './csv.ts';

export type ConsumableCategory = 'chlorine' | 'fuel' | 'chemical' | 'lubricant' | 'supplies' | 'other';

export type ConsumableMovementType =
  | 'opening_stock'
  | 'delivery'
  | 'manual_usage'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out'
  | 'activity_usage'
  | 'activity_delivery';

export interface ConsumableItemRow {
  id: string;
  organization_id: string;
  code: string | null;
  name: string;
  category: ConsumableCategory;
  unit: string;
  low_stock_threshold: number;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface ConsumableMovementRow {
  id: string;
  organization_id: string;
  item_id: string;
  site_name: string;
  movement_type: ConsumableMovementType;
  quantity_delta: number;
  movement_date: string;
  activity_id: string | null;
  reference_no: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export type StockStatus = 'ok' | 'low' | 'out';

export interface SiteItemBalance {
  item: ConsumableItemRow;
  balance: number;
  status: StockStatus;
  movementCount: number;
  lastMovementDate: string | null;
}

export interface SiteInventorySummary {
  siteKey: string;
  siteName: string;
  balances: SiteItemBalance[];
  hasMovements: boolean;
  lowCount: number;
  outCount: number;
}

export interface ItemOrgSummary {
  item: ConsumableItemRow;
  totalBalance: number;
  siteBalances: Array<{ siteName: string; balance: number; status: StockStatus }>;
  lowSites: number;
  outSites: number;
}

export interface InventoryStats {
  sitesWithStock: number;
  totalSites: number;
  activeItems: number;
  lowCount: number;
  outCount: number;
}

export const CONSUMABLE_CATEGORY_LABELS: Record<ConsumableCategory, string> = {
  chlorine: 'Chlorine',
  fuel: 'Fuel',
  chemical: 'Treatment Chemical',
  lubricant: 'Oil & Lubricant',
  supplies: 'Field Supplies',
  other: 'Other',
};

export const CONSUMABLE_UNIT_OPTIONS = ['kg', 'L', 'gal', 'drum', 'bag', 'pcs', 'pack', 'box', 'm'] as const;

export const MOVEMENT_TYPE_LABELS: Record<ConsumableMovementType, string> = {
  opening_stock: 'Opening Stock',
  delivery: 'Delivery',
  manual_usage: 'Manual Usage',
  adjustment: 'Count Correction',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
  activity_usage: 'Auto · Activity Log',
  activity_delivery: 'Auto · Delivery Log',
};

export function normalizeInventorySiteKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function roundQty3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function formatInventoryQty(qty: number, unit: string): string {
  const rounded = Math.round(qty * 100) / 100;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
  return unit ? `${formatted} ${unit}` : formatted;
}

export function computeCountAdjustmentDelta(currentBalance: number, physicalCount: number): number {
  return roundQty3(physicalCount - currentBalance);
}

export function classifyStockStatus(balance: number, threshold: number): StockStatus {
  if (balance <= 0) return 'out';
  if (threshold > 0 && balance <= threshold) return 'low';
  return 'ok';
}

export function computeInventorySummaries(params: {
  items: ConsumableItemRow[];
  movements: ConsumableMovementRow[];
  savedSiteNames: string[];
}): {
  sites: SiteInventorySummary[];
  itemSummaries: ItemOrgSummary[];
  stats: InventoryStats;
} {
  const { items, movements, savedSiteNames } = params;
  const activeItems = items.filter((it) => it.is_active);
  const itemById = new Map(items.map((it) => [it.id, it]));

  // Canonical site directory preserving saved casing first, then any extra logged site names
  const siteNameByKey = new Map<string, string>();
  for (const raw of savedSiteNames) {
    const cleaned = raw.trim().replace(/\s+/g, ' ');
    if (!cleaned) continue;
    const key = normalizeInventorySiteKey(cleaned);
    if (!siteNameByKey.has(key)) siteNameByKey.set(key, cleaned);
  }
  for (const m of movements) {
    const cleaned = m.site_name.trim().replace(/\s+/g, ' ');
    if (!cleaned) continue;
    const key = normalizeInventorySiteKey(cleaned);
    if (!siteNameByKey.has(key)) siteNameByKey.set(key, cleaned);
  }

  // Aggregate per (siteKey, itemId)
  const cellAgg = new Map<string, { balance: number; count: number; lastDate: string | null }>();
  const siteHasMovements = new Set<string>();
  const siteTrackedItemIds = new Map<string, Set<string>>();

  for (const m of movements) {
    const sKey = normalizeInventorySiteKey(m.site_name);
    if (!sKey || !itemById.has(m.item_id)) continue;
    siteHasMovements.add(sKey);
    if (!siteTrackedItemIds.has(sKey)) siteTrackedItemIds.set(sKey, new Set());
    siteTrackedItemIds.get(sKey)!.add(m.item_id);

    const aggKey = `${sKey}::${m.item_id}`;
    const cur = cellAgg.get(aggKey) ?? { balance: 0, count: 0, lastDate: null };
    cur.balance = roundQty3(cur.balance + Number(m.quantity_delta));
    cur.count += 1;
    if (!cur.lastDate || m.movement_date > cur.lastDate) cur.lastDate = m.movement_date;
    cellAgg.set(aggKey, cur);
  }

  const sites: SiteInventorySummary[] = [];
  let lowCount = 0;
  let outCount = 0;
  let sitesWithStock = 0;

  const sortedSites = Array.from(siteNameByKey.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  for (const [siteKey, siteName] of sortedSites) {
    const trackedIds = siteTrackedItemIds.get(siteKey);
    const hasMovements = siteHasMovements.has(siteKey);
    const balances: SiteItemBalance[] = [];

    for (const item of activeItems) {
      const agg = cellAgg.get(`${siteKey}::${item.id}`);
      if (!agg && !trackedIds?.has(item.id)) continue;
      const balance = agg?.balance ?? 0;
      const status = classifyStockStatus(balance, Number(item.low_stock_threshold ?? 0));
      if (status === 'low') lowCount += 1;
      if (status === 'out') outCount += 1;
      balances.push({
        item,
        balance,
        status,
        movementCount: agg?.count ?? 0,
        lastMovementDate: agg?.lastDate ?? null,
      });
    }

    if (hasMovements || balances.length > 0) sitesWithStock += 1;
    sites.push({
      siteKey,
      siteName,
      balances,
      hasMovements,
      lowCount: balances.filter((b) => b.status === 'low').length,
      outCount: balances.filter((b) => b.status === 'out').length,
    });
  }

  const itemSummaries: ItemOrgSummary[] = activeItems.map((item) => {
    const siteBalances: Array<{ siteName: string; balance: number; status: StockStatus }> = [];
    let totalBalance = 0;
    let lowSites = 0;
    let outSites = 0;
    for (const s of sites) {
      const found = s.balances.find((b) => b.item.id === item.id);
      if (!found) continue;
      totalBalance = roundQty3(totalBalance + found.balance);
      if (found.status === 'low') lowSites += 1;
      if (found.status === 'out') outSites += 1;
      siteBalances.push({ siteName: s.siteName, balance: found.balance, status: found.status });
    }
    return { item, totalBalance, siteBalances, lowSites, outSites };
  });

  return {
    sites,
    itemSummaries,
    stats: {
      sitesWithStock,
      totalSites: sites.length,
      activeItems: activeItems.length,
      lowCount,
      outCount,
    },
  };
}

export function buildInventoryCsv(sites: SiteInventorySummary[]): string {
  const header = ['Site / Well', 'Consumable', 'Category', 'Balance', 'Unit', 'Low Threshold', 'Status', 'Last Movement'];
  const lines = [header.map(csvEscape).join(',')];

  for (const s of sites) {
    for (const b of s.balances) {
      lines.push(
        [
          s.siteName,
          b.item.name,
          CONSUMABLE_CATEGORY_LABELS[b.item.category] ?? b.item.category,
          roundQty3(b.balance),
          b.item.unit,
          b.item.low_stock_threshold,
          b.status.toUpperCase(),
          b.lastMovementDate ?? '',
        ]
          .map(csvEscape)
          .join(','),
      );
    }
  }
  return lines.join('\n');
}

export function isMissingInventoryTableError(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  const msg = err.message ?? '';
  return /(consumable_items|consumable_movements).*does not exist|could not find the table.*(consumable_items|consumable_movements)/i.test(
    msg,
  );
}
