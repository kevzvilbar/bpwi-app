'use client';

import { useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/error-utils';
import {
  AlertBanner,
  Badge,
  EmptyState,
  SegmentedTabs,
  StatCard,
  type BadgeTone,
} from '@/components/ui';
import {
  ConsumableItemModal,
  StockMovementModal,
  type MovementActionKind,
} from '@/components/InventoryModals';
import {
  applyMovementsToBalances,
  buildInventoryCsv,
  computeInventorySummaries,
  computeInventorySummariesFromBalances,
  CONSUMABLE_CATEGORY_LABELS,
  formatInventoryQty,
  INVENTORY_LEDGER_PAGE_SIZE,
  MOVEMENT_TYPE_LABELS,
  type ConsumableItemRow,
  type ConsumableMovementRow,
  type DbSiteBalanceRow,
  type StockStatus,
} from '@/lib/inventory';

type InventoryTab = 'sites' | 'items' | 'ledger' | 'catalog';

export interface InventoryManagerProps {
  orgId: string;
  userId: string;
  today: string;
  canManage: boolean;
  inventoryTableReady: boolean;
  initialItems: ConsumableItemRow[];
  initialBalances?: DbSiteBalanceRow[];
  initialMovements: ConsumableMovementRow[];
  initialTotalMovements?: number;
  ledgerPageSize?: number;
  savedSiteNames: string[];
  userNameById: Record<string, string>;
  initialError?: string;
}

const STATUS_TONE: Record<StockStatus, BadgeTone> = {
  ok: 'ok',
  low: 'warn',
  out: 'danger',
};

const STATUS_LABEL: Record<StockStatus, string> = {
  ok: 'OK',
  low: 'Low',
  out: 'Out',
};

export default function InventoryManager(p: InventoryManagerProps) {
  const [items, setItems] = useState<ConsumableItemRow[]>(p.initialItems);
  const [balances, setBalances] = useState<DbSiteBalanceRow[] | null>(p.initialBalances ?? null);
  const [movements, setMovements] = useState<ConsumableMovementRow[]>(p.initialMovements);
  const [totalMovements, setTotalMovements] = useState<number>(p.initialTotalMovements ?? p.initialMovements.length);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tab, setTab] = useState<InventoryTab>('sites');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'chlorine' | 'fuel' | 'other'>('all');
  const [lowOnly, setLowOnly] = useState(false);
  const [showEmptySites, setShowEmptySites] = useState(false);
  const [ledgerSource, setLedgerSource] = useState<'all' | 'auto' | 'manual'>('all');
  const [ledgerItemId, setLedgerItemId] = useState('all');
  const [bannerErr, setBannerErr] = useState(p.initialError ?? '');

  const [moveModal, setMoveModal] = useState<{
    open: boolean;
    action: MovementActionKind;
    site?: string;
    itemId?: string;
  }>({ open: false, action: 'delivery' });
  const [itemModal, setItemModal] = useState<{ open: boolean; editing: ConsumableItemRow | null }>({
    open: false,
    editing: null,
  });

  const { sites, itemSummaries, stats } = useMemo(
    () =>
      balances !== null
        ? computeInventorySummariesFromBalances({
            items,
            balances,
            savedSiteNames: p.savedSiteNames,
          })
        : computeInventorySummaries({
            items,
            movements,
            savedSiteNames: p.savedSiteNames,
          }),
    [items, balances, movements, p.savedSiteNames],
  );

  const allSiteNames = useMemo(() => sites.map((s) => s.siteName), [sites]);
  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  const currentBalanceBySiteItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sites) {
      for (const b of s.balances) {
        map.set(`${s.siteKey}::${b.item.id}`, b.balance);
      }
    }
    return map;
  }, [sites]);

  const filteredSites = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sites
      .map((s) => {
        const balances = s.balances.filter((b) => {
          if (categoryFilter === 'chlorine' && b.item.category !== 'chlorine') return false;
          if (categoryFilter === 'fuel' && b.item.category !== 'fuel') return false;
          if (categoryFilter === 'other' && (b.item.category === 'chlorine' || b.item.category === 'fuel')) return false;
          if (lowOnly && b.status === 'ok') return false;
          return true;
        });
        return { ...s, balances };
      })
      .filter((s) => {
        if (q && !s.siteName.toLowerCase().includes(q) && !s.balances.some((b) => b.item.name.toLowerCase().includes(q))) {
          return false;
        }
        if (lowOnly) return s.balances.length > 0;
        if (!showEmptySites && !s.hasMovements) return false;
        if (categoryFilter !== 'all') return s.balances.length > 0;
        return true;
      });
  }, [sites, search, categoryFilter, lowOnly, showEmptySites]);

  const filteredLedger = useMemo(() => {
    const q = search.trim().toLowerCase();
    return movements.filter((m) => {
      const it = itemById.get(m.item_id);
      const isAuto = m.movement_type === 'activity_usage' || m.movement_type === 'activity_delivery';
      if (ledgerSource === 'auto' && !isAuto) return false;
      if (ledgerSource === 'manual' && isAuto) return false;
      if (ledgerItemId !== 'all' && m.item_id !== ledgerItemId) return false;
      if (q) {
        const matchSite = m.site_name.toLowerCase().includes(q);
        const matchItem = (it?.name ?? '').toLowerCase().includes(q);
        const matchRef = (m.reference_no ?? '').toLowerCase().includes(q);
        const matchNote = (m.notes ?? '').toLowerCase().includes(q);
        if (!matchSite && !matchItem && !matchRef && !matchNote) return false;
      }
      return true;
    });
  }, [movements, itemById, ledgerSource, ledgerItemId, search]);

  async function toggleItemActive(item: ConsumableItemRow) {
    if (!p.canManage) return;
    setBannerErr('');
    try {
      const { data, error } = await supabaseBrowser()
        .from('consumable_items')
        .update({ is_active: !item.is_active, updated_at: new Date().toISOString() })
        .eq('id', item.id)
        .select('id, organization_id, code, name, category, unit, low_stock_threshold, is_active, sort_order, created_at, updated_at')
        .single();
      if (error) { setBannerErr(error.message); return; }
      const updated = data as ConsumableItemRow;
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (ex: unknown) {
      setBannerErr(getErrorMessage(ex, 'Failed to update consumable'));
    }
  }

  async function loadMoreMovements() {
    if (loadingMore) return;
    setLoadingMore(true);
    setBannerErr('');
    try {
      const pageSize = p.ledgerPageSize ?? INVENTORY_LEDGER_PAGE_SIZE;
      const from = movements.length;
      const to = from + pageSize - 1;
      const { data, error, count } = await supabaseBrowser()
        .from('consumable_movements')
        .select(
          'id, organization_id, item_id, site_name, movement_type, quantity_delta, movement_date, activity_id, reference_no, notes, created_by, created_at',
          { count: 'exact' },
        )
        .order('movement_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) {
        setBannerErr(error.message);
        return;
      }
      const rows = (data ?? []) as ConsumableMovementRow[];
      setMovements((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = rows.filter((r) => !seen.has(r.id));
        return [...prev, ...fresh];
      });
      if (typeof count === 'number') setTotalMovements(count);
    } catch (ex: unknown) {
      setBannerErr(getErrorMessage(ex, 'Failed to load more movements'));
    } finally {
      setLoadingMore(false);
    }
  }

  function exportCsv() {
    const csv = buildInventoryCsv(filteredSites);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `bpwi-consumables-inventory-${p.today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card-pad w-full" style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Consumables Inventory</h1>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            Stock per well &amp; pump site · Auto-synced from Chlorine Refill and Fuel activity logs
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={exportCsv} disabled={filteredSites.length === 0}>
            Export CSV
          </button>
          {p.canManage && p.inventoryTableReady && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => setItemModal({ open: true, editing: null })}
              >
                + Add Consumable
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setMoveModal({ open: true, action: 'delivery' })}
              >
                + Record Stock
              </button>
            </>
          )}
        </div>
      </div>

      {!p.inventoryTableReady && (
        <AlertBanner tone="warn" className="mb-12">
          <strong>Setup needed:</strong> Run Supabase migration{' '}
          <code>039_consumables_inventory.sql</code> to create per-site consumables tables and enable automatic log syncing.
        </AlertBanner>
      )}

      {bannerErr && (
        <AlertBanner tone="danger" onDismiss={() => setBannerErr('')} className="mb-12">
          {bannerErr}
        </AlertBanner>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        <StatCard label="Sites with Stock" value={`${stats.sitesWithStock} / ${stats.totalSites}`} subtitle="Wells & pump stations" />
        <StatCard label="Active Consumables" value={stats.activeItems} subtitle="Chlorine, fuel & custom" />
        <StatCard label="Low Stock Alerts" value={stats.lowCount} subtitleTone={stats.lowCount > 0 ? 'warn' : 'ok'} subtitle={stats.lowCount > 0 ? 'Needs restock' : 'All sufficient'} />
        <StatCard label="Out of Stock" value={stats.outCount} subtitleTone={stats.outCount > 0 ? 'danger' : 'ok'} subtitle={stats.outCount > 0 ? 'Depleted / 0 left' : 'None empty'} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="mobile-scroll-tabs" style={{ maxWidth: '100%' }}>
          <SegmentedTabs
            ariaLabel="Inventory views"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'sites', label: `Stock by Site (${filteredSites.length})` },
              { id: 'items', label: `By Consumable (${itemSummaries.length})` },
              { id: 'ledger', label: `Movement Ledger (${search.trim() || ledgerSource !== 'all' || ledgerItemId !== 'all' ? filteredLedger.length : totalMovements})` },
              { id: 'catalog', label: `Catalog (${items.length})` },
            ]}
          />
        </div>
        {(tab === 'sites' || tab === 'ledger') && (
          <input
            type="search"
            className="input"
            aria-label="Search site or consumable"
            placeholder="Search site or item…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 200px', maxWidth: 300, minWidth: 0 }}
          />
        )}
      </div>

      {tab === 'sites' && (
        <>
          <div className="card" style={{ padding: '10px 12px', marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <SegmentedTabs
              ariaLabel="Filter category"
              size="sm"
              value={categoryFilter}
              onChange={setCategoryFilter}
              items={[
                { id: 'all', label: 'All Items' },
                { id: 'chlorine', label: 'Chlorine' },
                { id: 'fuel', label: 'Fuel' },
                { id: 'other', label: 'Other' },
              ]}
            />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
              Low / Out only
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={showEmptySites} onChange={(e) => setShowEmptySites(e.target.checked)} />
              Show sites without stock yet ({sites.length - stats.sitesWithStock})
            </label>
          </div>

          {filteredSites.length === 0 ? (
            <EmptyState
              title="No site stock records yet"
              description={
                p.canManage
                  ? 'Record opening stock or a delivery for a well/pump site, or stock will update automatically as operators submit Chlorine Refill and Fuel logs.'
                  : 'Stock balances appear here once opening stock, deliveries, or chlorine/fuel field logs are recorded.'
              }
              action={
                p.canManage && p.inventoryTableReady ? (
                  <button type="button" className="btn btn-primary" onClick={() => setMoveModal({ open: true, action: 'opening_stock' })}>
                    + Set Opening Stock
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 12 }}>
              {filteredSites.map((site) => (
                <section key={site.siteKey} className="card" style={{ padding: 14, display: 'grid', gap: 10, alignContent: 'start' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{site.siteName}</strong>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {site.outCount > 0 && <Badge tone="danger" size="sm">{site.outCount} Out</Badge>}
                      {site.lowCount > 0 && <Badge tone="warn" size="sm">{site.lowCount} Low</Badge>}
                      {site.balances.length === 0 && <Badge tone="neutral" size="sm">No stock</Badge>}
                    </div>
                  </div>

                  {site.balances.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      No consumables recorded at this site yet.
                      {p.canManage && (
                        <div style={{ marginTop: 8 }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setMoveModal({ open: true, action: 'opening_stock', site: site.siteName })}
                          >
                            + Add Opening Stock
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {site.balances.map((b) => (
                        <div
                          key={b.item.id}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: '1px solid var(--border-light)',
                            background: 'var(--surface-muted)',
                            display: 'grid',
                            gap: 6,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <div>
                              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{b.item.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                {CONSUMABLE_CATEGORY_LABELS[b.item.category]}
                                {b.item.low_stock_threshold > 0 && ` · Min ${formatInventoryQty(b.item.low_stock_threshold, b.item.unit)}`}
                                {b.lastMovementDate && ` · Last ${b.lastMovementDate}`}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div className="tabular-nums" style={{ fontSize: 15, fontWeight: 800 }}>
                                {formatInventoryQty(b.balance, b.item.unit)}
                              </div>
                              <Badge tone={STATUS_TONE[b.status]} size="sm">{STATUS_LABEL[b.status]}</Badge>
                            </div>
                          </div>
                          {p.canManage && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => setMoveModal({ open: true, action: 'delivery', site: site.siteName, itemId: b.item.id })}
                              >
                                + Deliver
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => setMoveModal({ open: true, action: 'adjustment', site: site.siteName, itemId: b.item.id })}
                              >
                                Count
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => setMoveModal({ open: true, action: 'manual_usage', site: site.siteName, itemId: b.item.id })}
                              >
                                − Use
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'items' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {itemSummaries.map((sum) => (
            <section key={sum.item.id} className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong style={{ fontSize: 15 }}>{sum.item.name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {CONSUMABLE_CATEGORY_LABELS[sum.item.category]} · Alert below {formatInventoryQty(sum.item.low_stock_threshold, sum.item.unit)} per site
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Total Across All Sites</div>
                  <strong className="tabular-nums" style={{ fontSize: 18 }}>{formatInventoryQty(sum.totalBalance, sum.item.unit)}</strong>
                </div>
              </div>
              {sum.siteBalances.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No site balances recorded yet.</div>
              ) : (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {sum.siteBalances.map((sb) => (
                    <Badge key={sb.siteName} tone={STATUS_TONE[sb.status]} size="sm">
                      {sb.siteName}: {formatInventoryQty(sb.balance, sum.item.unit)}
                    </Badge>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {tab === 'ledger' && (
        <div className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <SegmentedTabs
              ariaLabel="Filter ledger source"
              size="sm"
              value={ledgerSource}
              onChange={setLedgerSource}
              items={[
                { id: 'all', label: 'All Movements' },
                { id: 'auto', label: 'Auto from Logs' },
                { id: 'manual', label: 'Manual Entries' },
              ]}
            />
            <select
              className="input"
              aria-label="Filter ledger by item"
              value={ledgerItemId}
              onChange={(e) => setLedgerItemId(e.target.value)}
              style={{ flex: '1 1 200px', maxWidth: 300, minWidth: 0 }}
            >
              <option value="all">All Consumables</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>{it.name}</option>
              ))}
            </select>
          </div>

          {filteredLedger.length === 0 ? (
            <EmptyState title="No movements match these filters" />
          ) : (
            <>
              <div className="responsive-cards">
                {filteredLedger.map((m) => {
                  const it = itemById.get(m.item_id);
                  const unit = it?.unit ?? '';
                  const isPositive = Number(m.quantity_delta) > 0;
                  const isAuto = m.movement_type === 'activity_usage' || m.movement_type === 'activity_delivery';
                  const who = m.created_by ? (p.userNameById[m.created_by] ?? 'Staff') : '';
                  const refWho = [m.reference_no, who].filter(Boolean).join(' · ');
                  return (
                    <div
                      key={`card-${m.id}`}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border-light)',
                        background: 'var(--surface-muted)',
                        display: 'grid',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{m.site_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it?.name ?? 'Unknown item'}</div>
                        </div>
                        <div
                          className="tabular-nums"
                          style={{
                            fontWeight: 800,
                            fontSize: 14,
                            color: isPositive ? 'var(--ok-fg)' : 'var(--danger)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isPositive ? '+' : ''}{formatInventoryQty(Number(m.quantity_delta), unit)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Badge tone={isAuto ? 'info' : isPositive ? 'ok' : 'warn'} size="sm">
                          {MOVEMENT_TYPE_LABELS[m.movement_type]}
                        </Badge>
                        <span className="tabular-nums" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          {m.movement_date}
                        </span>
                      </div>
                      {refWho && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          Ref / By: {refWho}
                        </div>
                      )}
                      {m.notes && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          {m.notes}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="responsive-table-wrap scroll-x">
                <table className="data-table data-table-sticky">
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      <th>Date</th>
                      <th>Site / Well</th>
                      <th>Consumable</th>
                      <th>Type</th>
                      <th style={{ textAlign: 'right' }}>Change</th>
                      <th>Ref / By</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLedger.map((m) => {
                      const it = itemById.get(m.item_id);
                      const unit = it?.unit ?? '';
                      const isPositive = Number(m.quantity_delta) > 0;
                      const isAuto = m.movement_type === 'activity_usage' || m.movement_type === 'activity_delivery';
                      const who = m.created_by ? (p.userNameById[m.created_by] ?? 'Staff') : '';
                      return (
                        <tr key={m.id}>
                          <td className="tabular-nums" style={{ whiteSpace: 'nowrap' }}>{m.movement_date}</td>
                          <td style={{ fontWeight: 600 }}>{m.site_name}</td>
                          <td>{it?.name ?? 'Unknown item'}</td>
                          <td>
                            <Badge tone={isAuto ? 'info' : isPositive ? 'ok' : 'warn'} size="sm">
                              {MOVEMENT_TYPE_LABELS[m.movement_type]}
                            </Badge>
                          </td>
                          <td
                            className="tabular-nums"
                            style={{
                              textAlign: 'right',
                              fontWeight: 700,
                              color: isPositive ? 'var(--ok-fg)' : 'var(--danger)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isPositive ? '+' : ''}{formatInventoryQty(Number(m.quantity_delta), unit)}
                          </td>
                          <td style={{ color: 'var(--text-secondary)' }}>
                            {[m.reference_no, who].filter(Boolean).join(' · ') || '—'}
                          </td>
                          <td style={{ color: 'var(--text-secondary)' }}>{m.notes ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {movements.length < totalMovements && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Showing {movements.length} of {totalMovements} movements
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => void loadMoreMovements()} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : 'Load more movements'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'catalog' && (
        <div className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
          {items.length === 0 ? (
            <EmptyState title="No consumables defined yet" />
          ) : (
            <>
              <div className="responsive-cards">
                {items.map((it) => (
                  <div
                    key={`card-${it.id}`}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border-light)',
                      background: 'var(--surface-muted)',
                      display: 'grid',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{it.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          {CONSUMABLE_CATEGORY_LABELS[it.category]} · Unit: {it.unit} · Min {formatInventoryQty(Number(it.low_stock_threshold), it.unit)}
                        </div>
                      </div>
                      <Badge tone={it.is_active ? 'ok' : 'neutral'} size="sm">
                        {it.is_active ? 'Active' : 'Archived'}
                      </Badge>
                    </div>
                    {p.canManage && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setItemModal({ open: true, editing: it })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void toggleItemActive(it)}
                        >
                          {it.is_active ? 'Archive' : 'Restore'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="responsive-table-wrap scroll-x">
                <table className="data-table data-table-sticky">
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      <th>Consumable</th>
                      <th>Category</th>
                      <th>Unit</th>
                      <th>Low Threshold / Site</th>
                      <th>Status</th>
                      {p.canManage && <th style={{ textAlign: 'right' }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id}>
                        <td style={{ fontWeight: 700 }}>{it.name}</td>
                        <td>{CONSUMABLE_CATEGORY_LABELS[it.category]}</td>
                        <td>{it.unit}</td>
                        <td className="tabular-nums">
                          {formatInventoryQty(Number(it.low_stock_threshold), it.unit)}
                        </td>
                        <td>
                          <Badge tone={it.is_active ? 'ok' : 'neutral'} size="sm">
                            {it.is_active ? 'Active' : 'Archived'}
                          </Badge>
                        </td>
                        {p.canManage && (
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => setItemModal({ open: true, editing: it })}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => void toggleItemActive(it)}
                              >
                                {it.is_active ? 'Archive' : 'Restore'}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <StockMovementModal
        open={moveModal.open}
        orgId={p.orgId}
        userId={p.userId}
        today={p.today}
        items={items}
        siteNames={allSiteNames}
        currentBalanceBySiteItem={currentBalanceBySiteItem}
        initialAction={moveModal.action}
        initialSite={moveModal.site}
        initialItemId={moveModal.itemId}
        onClose={() => setMoveModal((prev) => ({ ...prev, open: false }))}
        onSaved={(inserted) => {
          setMovements((prev) => [...inserted, ...prev]);
          setTotalMovements((prev) => prev + inserted.length);
          setBalances((prev) => (prev !== null ? applyMovementsToBalances(prev, inserted) : null));
        }}
      />

      <ConsumableItemModal
        open={itemModal.open}
        orgId={p.orgId}
        editing={itemModal.editing}
        onClose={() => setItemModal({ open: false, editing: null })}
        onSaved={(saved, isEdit) => {
          setItems((prev) =>
            isEdit
              ? prev.map((x) => (x.id === saved.id ? saved : x))
              : [...prev, saved].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
          );
        }}
      />
    </div>
  );
}
