'use client';

import type { ReactNode } from 'react';
import type { ChangeRequest, ChangeRequestItem } from '@/lib/profile';
import { Badge } from '@/components/ui';
import type { ChangeRequestSnap, OverrideDialog } from '@/components/ChangeRequestDialogs';

/** Mobile card view for proposed change request items (<= 640px). */
export default function ChangeRequestMobileCards({
  request,
  items,
  openItems,
  selected,
  selectedOpenIds,
  canAct,
  busy,
  opMap,
  isOpenItem,
  categoryLabel,
  renderDate,
  renderSnapshot,
  renderProposed,
  renderLive,
  onToggleAll,
  onToggleItem,
  onOpenOverrideDialog,
}: {
  request: ChangeRequest;
  items: ChangeRequestItem[];
  openItems: ChangeRequestItem[];
  selected: Set<string>;
  selectedOpenIds: string[];
  canAct: boolean;
  busy: boolean;
  opMap: Map<string, string>;
  isOpenItem: (item: ChangeRequestItem) => boolean;
  categoryLabel: (t: ChangeRequestItem['target_table']) => string;
  renderDate: (item: ChangeRequestItem) => string;
  renderSnapshot: (item: ChangeRequestItem, s: ChangeRequestSnap | null | undefined, emptyLabel: string) => ReactNode;
  renderProposed: (item: ChangeRequestItem) => ReactNode;
  renderLive: (item: ChangeRequestItem) => ReactNode;
  onToggleAll: () => void;
  onToggleItem: (itemId: string) => void;
  onOpenOverrideDialog: (dialog: OverrideDialog) => void;
}) {
  return (
    <div className="responsive-cards">
      {canAct && openItems.length > 1 && (
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 38,
            padding: '4px 8px',
            borderRadius: 6,
            background: 'var(--surface-muted)',
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          <input
            type="checkbox"
            aria-label="Select all open items (mobile)"
            checked={openItems.length > 0 && selectedOpenIds.length === openItems.length}
            onChange={onToggleAll}
          />
          Select all open items ({openItems.length})
        </label>
      )}
      {items.map((item) => {
        const opName = item.operator_id
          ? (opMap.get(item.operator_id) ?? 'Unknown Operator')
          : item.target_table === 'pm_tasks'
            ? 'See assignees'
            : 'N/A';
        const isConflict = item.status === 'conflict';
        const isItemOpen = isOpenItem(item);
        const isSelected = isItemOpen && selected.has(item.id);
        const mobileConflictNote =
          item.conflict_reason === 'target_missing'
            ? 'Live record no longer exists'
            : item.conflict_reason === 'changed'
              ? 'Modified on live schedule'
              : 'Flagged by server';

        return (
          <div
            key={`m-${item.id}`}
            style={{
              border: isConflict ? '1px solid var(--warn-border)' : '1px solid var(--border)',
              borderRadius: 8,
              padding: 12,
              display: 'grid',
              gap: 8,
              background: isConflict ? 'var(--warn-bg)' : isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--surface-muted)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                {canAct && isItemOpen && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, minHeight: 32, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleItem(item.id)}
                      aria-label={`Select mobile item for ${opName} on ${item.schedule_date ?? 'n/a'}`}
                    />
                  </label>
                )}
                <Badge size="sm" tone="neutral">{categoryLabel(item.target_table)}</Badge>
              </div>
              {isConflict ? (
                <Badge size="sm" tone="warn">⚠️ Conflict</Badge>
              ) : item.status === 'approved' ? (
                <Badge size="sm" tone="ok">✓ Approved</Badge>
              ) : item.status === 'rejected' ? (
                <Badge size="sm" tone="danger">✗ Rejected</Badge>
              ) : (
                <Badge size="sm" tone="neutral">Pending</Badge>
              )}
            </div>

            <div style={{ display: 'grid', gap: 2 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)' }}>{opName}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{renderDate(item)}</div>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 6,
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--surface)',
                border: '1px solid var(--border-light)',
                fontSize: 12.5,
              }}
            >
              <div style={{ display: 'grid', gap: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>When proposed</span>
                <div>{renderSnapshot(item, item.original_state as ChangeRequestSnap | null, 'Empty cell')}</div>
              </div>
              <div style={{ display: 'grid', gap: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Proposed change</span>
                <div>{renderProposed(item)}</div>
                {item.notes && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Note: {item.notes}</div>}
              </div>
            </div>

            {isConflict && (
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--warn-fg)' }}>{mobileConflictNote}</div>
                {item.conflict_reason && (
                  <div style={{ fontSize: 12 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Now: </span>
                    {renderLive(item)}
                  </div>
                )}
                {canAct && (
                  <button
                    type="button"
                    className="btn"
                    style={{ width: '100%' }}
                    disabled={busy}
                    onClick={() => onOpenOverrideDialog({ request, item })}
                  >
                    {item.conflict_reason === 'target_missing' ? 'Inspect & discard…' : 'Inspect & override…'}
                  </button>
                )}
              </div>
            )}

            {item.status === 'rejected' && item.rejection_reason && (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                Reason: {item.rejection_reason}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
