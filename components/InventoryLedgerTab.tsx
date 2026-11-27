'use client';

import { Badge, EmptyState, SegmentedTabs } from '@/components/ui';
import {
  formatInventoryQty,
  MOVEMENT_TYPE_LABELS,
  type ConsumableItemRow,
  type ConsumableMovementRow,
} from '@/lib/inventory';

interface InventoryLedgerTabProps {
  items: ConsumableItemRow[];
  itemById: Map<string, ConsumableItemRow>;
  filteredLedger: ConsumableMovementRow[];
  movementsCount: number;
  totalMovements: number;
  loadingLedger: boolean;
  loadingMore: boolean;
  ledgerSource: 'all' | 'auto' | 'manual';
  ledgerItemId: string;
  userNameById: Record<string, string>;
  onChangeLedgerSource: (value: 'all' | 'auto' | 'manual') => void;
  onChangeLedgerItemId: (value: string) => void;
  onLoadMore: () => void;
}

/** Displays filterable inventory movement cards (mobile), table (desktop), and pagination controls. */
export default function InventoryLedgerTab(p: InventoryLedgerTabProps) {
  return (
    <div className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <SegmentedTabs
          ariaLabel="Filter ledger source"
          size="sm"
          value={p.ledgerSource}
          onChange={p.onChangeLedgerSource}
          items={[
            { id: 'all', label: 'All Movements' },
            { id: 'auto', label: 'Auto from Logs' },
            { id: 'manual', label: 'Manual Entries' },
          ]}
        />
        <select
          className="input"
          aria-label="Filter ledger by item"
          value={p.ledgerItemId}
          onChange={(e) => p.onChangeLedgerItemId(e.target.value)}
          style={{ flex: '1 1 200px', maxWidth: 300, minWidth: 0 }}
        >
          <option value="all">All Consumables</option>
          {p.items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name}
            </option>
          ))}
        </select>
      </div>

      {p.loadingLedger && p.filteredLedger.length === 0 ? (
        <EmptyState title="Searching movements…" />
      ) : p.filteredLedger.length === 0 ? (
        <EmptyState title="No movements match these filters" />
      ) : (
        <>
          <div className="responsive-cards">
            {p.filteredLedger.map((m) => {
              const it = p.itemById.get(m.item_id);
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
                      {isPositive ? '+' : ''}
                      {formatInventoryQty(Number(m.quantity_delta), unit)}
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
                {p.filteredLedger.map((m) => {
                  const it = p.itemById.get(m.item_id);
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
                        {isPositive ? '+' : ''}
                        {formatInventoryQty(Number(m.quantity_delta), unit)}
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

          {p.movementsCount < p.totalMovements && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Showing {p.movementsCount} of {p.totalMovements} movements
              </span>
              <button type="button" className="btn btn-sm" onClick={p.onLoadMore} disabled={p.loadingMore}>
                {p.loadingMore ? 'Loading…' : 'Load more movements'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
