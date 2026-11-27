'use client';

import { Badge, EmptyState } from '@/components/ui';
import {
  CONSUMABLE_CATEGORY_LABELS,
  formatInventoryQty,
  type ConsumableItemRow,
} from '@/lib/inventory';

interface InventoryCatalogTabProps {
  items: ConsumableItemRow[];
  canManage: boolean;
  onEditItem: (item: ConsumableItemRow) => void;
  onToggleItemActive: (item: ConsumableItemRow) => void;
}

/** Displays consumable definitions, thresholds, and archive/restore actions. */
export default function InventoryCatalogTab(p: InventoryCatalogTabProps) {
  return (
    <div className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
      {p.items.length === 0 ? (
        <EmptyState title="No consumables defined yet" />
      ) : (
        <>
          <div className="responsive-cards">
            {p.items.map((it) => (
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
                    <button type="button" className="btn btn-sm" onClick={() => p.onEditItem(it)}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => p.onToggleItemActive(it)}>
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
                {p.items.map((it) => (
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
                          <button type="button" className="btn btn-sm" onClick={() => p.onEditItem(it)}>
                            Edit
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => p.onToggleItemActive(it)}>
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
  );
}
