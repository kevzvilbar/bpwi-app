import { fetchAll, getProfile } from '@/lib/profile';
import { buildSavedLocationCatalog, isMissingPmLocationsTableError, type PmLocationRow } from '@/lib/pm-locations';
import {
  INVENTORY_LEDGER_PAGE_SIZE,
  isMissingInventoryTableError,
  type ConsumableItemRow,
  type ConsumableMovementRow,
  type DbSiteBalanceRow,
} from '@/lib/inventory';
import { manilaToday } from '@/lib/date';
import InventoryManager from '@/components/InventoryManager';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const { sb, user, orgId, isAdmin, isManager } = await getProfile();
  const today = manilaToday();

  const [itemsRes, balancesRes, pagedMovementsRes, locationsRes, areasRes, usersRes] = await Promise.all([
    sb
      .from('consumable_items')
      .select('id, organization_id, code, name, category, unit, low_stock_threshold, is_active, sort_order, created_at, updated_at')
      .order('sort_order')
      .order('name'),
    sb.rpc('get_consumable_site_balances'),
    sb
      .from('consumable_movements')
      .select(
        'id, organization_id, item_id, site_name, movement_type, quantity_delta, movement_date, activity_id, reference_no, notes, created_by, created_at',
        { count: 'exact' },
      )
      .order('movement_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(0, INVENTORY_LEDGER_PAGE_SIZE - 1),
    sb.from('pm_locations').select('id, name, sort_order').order('sort_order').order('name'),
    sb.from('area_codes').select('id, code, name, category, sub_sites'),
    sb.from('user_profiles').select('id, full_name').eq('organization_id', orgId),
  ]);

  const missingItems = isMissingInventoryTableError(itemsRes.error);
  const missingMovements = isMissingInventoryTableError(pagedMovementsRes.error);
  const inventoryTableReady = !missingItems && !missingMovements;

  let initialBalances: DbSiteBalanceRow[] | undefined;
  let movementRows = (pagedMovementsRes.error ? [] : (pagedMovementsRes.data ?? [])) as ConsumableMovementRow[];
  let totalMovements = typeof pagedMovementsRes.count === 'number' ? pagedMovementsRes.count : movementRows.length;
  let fallbackMovementsErr = '';

  if (!balancesRes.error && Array.isArray(balancesRes.data)) {
    initialBalances = balancesRes.data as DbSiteBalanceRow[];
  } else if (inventoryTableReady) {
    // Graceful fallback when migration 040 (get_consumable_site_balances) has not been applied yet.
    const allRes = await fetchAll((from, to) =>
      sb
        .from('consumable_movements')
        .select('id, organization_id, item_id, site_name, movement_type, quantity_delta, movement_date, activity_id, reference_no, notes, created_by, created_at')
        .order('movement_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to),
    );
    if (allRes.error) {
      fallbackMovementsErr = allRes.error;
    } else {
      movementRows = allRes.data as ConsumableMovementRow[];
      totalMovements = movementRows.length;
    }
  }

  const pmLocations: PmLocationRow[] =
    locationsRes.error || isMissingPmLocationsTableError(locationsRes.error)
      ? []
      : (locationsRes.data ?? []);
  const areas = areasRes.error ? [] : (areasRes.data ?? []);
  const savedSiteNames = buildSavedLocationCatalog(pmLocations, areas).map((opt) => opt.name);

  const userNameById: Record<string, string> = {};
  if (!usersRes.error) {
    for (const u of usersRes.data ?? []) {
      if (u.id && u.full_name) userNameById[u.id] = u.full_name;
    }
  }

  const error = Array.from(
    new Set(
      [
        !missingItems ? itemsRes.error?.message : '',
        !missingMovements ? pagedMovementsRes.error?.message : '',
        fallbackMovementsErr,
        locationsRes.error && !isMissingPmLocationsTableError(locationsRes.error) ? locationsRes.error.message : '',
        areasRes.error?.message,
        usersRes.error?.message,
      ].filter((e): e is string => Boolean(e)),
    ),
  ).join(' · ');

  return (
    <InventoryManager
      orgId={orgId}
      userId={user?.id ?? ''}
      today={today}
      canManage={isAdmin || isManager}
      inventoryTableReady={inventoryTableReady}
      initialItems={(itemsRes.error ? [] : (itemsRes.data ?? [])) as ConsumableItemRow[]}
      initialBalances={initialBalances}
      initialMovements={movementRows}
      initialTotalMovements={totalMovements}
      ledgerPageSize={INVENTORY_LEDGER_PAGE_SIZE}
      savedSiteNames={savedSiteNames}
      userNameById={userNameById}
      initialError={error}
    />
  );
}
