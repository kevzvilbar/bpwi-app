'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/error-utils';
import {
  CONSUMABLE_CATEGORY_LABELS,
  CONSUMABLE_UNIT_OPTIONS,
  computeCountAdjustmentDelta,
  formatInventoryQty,
  normalizeInventorySiteKey,
  roundQty3,
  type ConsumableCategory,
  type ConsumableItemRow,
  type ConsumableMovementRow,
} from '@/lib/inventory';

export type MovementActionKind = 'delivery' | 'opening_stock' | 'adjustment' | 'manual_usage' | 'transfer';

export interface StockMovementModalProps {
  open: boolean;
  orgId: string;
  userId: string;
  today: string;
  items: ConsumableItemRow[];
  siteNames: string[];
  currentBalanceBySiteItem: Map<string, number>;
  initialAction?: MovementActionKind;
  initialSite?: string;
  initialItemId?: string;
  onClose: () => void;
  onSaved: (inserted: ConsumableMovementRow[]) => void;
}

const ACTION_LABELS: Record<MovementActionKind, string> = {
  delivery: 'Stock Delivery (+)',
  opening_stock: 'Opening Stock (+)',
  adjustment: 'Count Correction (=)',
  manual_usage: 'Manual Usage (−)',
  transfer: 'Transfer Between Sites',
};

export function StockMovementModal(p: StockMovementModalProps) {
  const activeItems = p.items.filter((it) => it.is_active);
  const defaultSite = p.initialSite ?? p.siteNames[0] ?? '';
  const defaultItemId = p.initialItemId ?? activeItems[0]?.id ?? '';
  const [action, setAction] = useState<MovementActionKind>(p.initialAction ?? 'delivery');
  const [siteName, setSiteName] = useState(defaultSite);
  const [destSiteName, setDestSiteName] = useState('');
  const [itemId, setItemId] = useState(defaultItemId);
  const [quantityInput, setQuantityInput] = useState('');
  const [movementDate, setMovementDate] = useState(p.today);
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!p.open) return;
    setAction(p.initialAction ?? 'delivery');
    setSiteName(defaultSite);
    setDestSiteName('');
    setItemId(defaultItemId);
    setQuantityInput('');
    setMovementDate(p.today);
    setReferenceNo('');
    setNotes('');
    setErr('');
  }, [p.open, p.initialAction, defaultSite, defaultItemId, p.today]);

  if (!p.open) return null;

  const selectedItem = activeItems.find((it) => it.id === itemId) ?? activeItems[0];
  const siteKey = normalizeInventorySiteKey(siteName);
  const currentBal = selectedItem && siteKey ? (p.currentBalanceBySiteItem.get(`${siteKey}::${selectedItem.id}`) ?? 0) : 0;
  const parsedQty = Number(quantityInput);
  const hasValidNum = quantityInput.trim() !== '' && Number.isFinite(parsedQty);
  const adjDelta = action === 'adjustment' && hasValidNum ? computeCountAdjustmentDelta(currentBal, parsedQty) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!selectedItem) { setErr('Create or activate a consumable item first.'); return; }
    const cleanSite = siteName.trim().replace(/\s+/g, ' ');
    if (!cleanSite) { setErr('Enter or pick a well / pump site.'); return; }
    if (!hasValidNum) { setErr('Enter a valid quantity.'); return; }

    const cleanNote = notes.trim() || null;
    const cleanRef = referenceNo.trim() || null;
    const sb = supabaseBrowser();

    const payloads: Array<{
      organization_id: string;
      item_id: string;
      site_name: string;
      movement_type: ConsumableMovementRow['movement_type'];
      quantity_delta: number;
      movement_date: string;
      reference_no: string | null;
      notes: string | null;
      created_by: string | null;
    }> = [];

    if (action === 'adjustment') {
      if (parsedQty < 0) { setErr('Physical count cannot be negative.'); return; }
      const delta = computeCountAdjustmentDelta(currentBal, parsedQty);
      if (delta === 0) { setErr('Physical count already matches the current balance.'); return; }
      payloads.push({
        organization_id: p.orgId,
        item_id: selectedItem.id,
        site_name: cleanSite,
        movement_type: 'adjustment',
        quantity_delta: delta,
        movement_date: movementDate || p.today,
        reference_no: cleanRef,
        notes: cleanNote ?? `Physical count set to ${formatInventoryQty(parsedQty, selectedItem.unit)}`,
        created_by: p.userId || null,
      });
    } else if (action === 'transfer') {
      const cleanDest = destSiteName.trim().replace(/\s+/g, ' ');
      const qty = roundQty3(parsedQty);
      if (qty <= 0) { setErr('Transfer quantity must be greater than 0.'); return; }
      if (!cleanDest) { setErr('Enter a destination site for the transfer.'); return; }
      if (normalizeInventorySiteKey(cleanDest) === normalizeInventorySiteKey(cleanSite)) {
        setErr('Source and destination sites must be different.');
        return;
      }
      payloads.push(
        {
          organization_id: p.orgId,
          item_id: selectedItem.id,
          site_name: cleanSite,
          movement_type: 'transfer_out',
          quantity_delta: -qty,
          movement_date: movementDate || p.today,
          reference_no: cleanRef,
          notes: cleanNote ? `${cleanNote} (To: ${cleanDest})` : `Transferred to ${cleanDest}`,
          created_by: p.userId || null,
        },
        {
          organization_id: p.orgId,
          item_id: selectedItem.id,
          site_name: cleanDest,
          movement_type: 'transfer_in',
          quantity_delta: qty,
          movement_date: movementDate || p.today,
          reference_no: cleanRef,
          notes: cleanNote ? `${cleanNote} (From: ${cleanSite})` : `Transferred from ${cleanSite}`,
          created_by: p.userId || null,
        },
      );
    } else {
      const qty = roundQty3(parsedQty);
      if (qty <= 0) { setErr('Quantity must be greater than 0.'); return; }
      payloads.push({
        organization_id: p.orgId,
        item_id: selectedItem.id,
        site_name: cleanSite,
        movement_type: action,
        quantity_delta: action === 'manual_usage' ? -qty : qty,
        movement_date: movementDate || p.today,
        reference_no: cleanRef,
        notes: cleanNote,
        created_by: p.userId || null,
      });
    }

    setBusy(true);
    try {
      const { data, error } = await sb
        .from('consumable_movements')
        .insert(payloads)
        .select('id, organization_id, item_id, site_name, movement_type, quantity_delta, movement_date, activity_id, reference_no, notes, created_by, created_at');
      if (error) {
        setErr(error.message);
        return;
      }
      p.onSaved((data ?? []) as ConsumableMovementRow[]);
      p.onClose();
    } catch (ex: unknown) {
      setErr(getErrorMessage(ex, 'Failed to save stock movement'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={p.onClose}>
      <div className="modal-sheet" role="dialog" aria-modal="true" aria-label="Record stock movement" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 10px' }}>Record Stock Movement</h3>
        <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Action
            <select
              className="input"
              aria-label="Movement Action"
              value={action}
              onChange={(e) => setAction(e.target.value as MovementActionKind)}
            >
              {(Object.keys(ACTION_LABELS) as MovementActionKind[]).map((k) => (
                <option key={k} value={k}>{ACTION_LABELS[k]}</option>
              ))}
            </select>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              {action === 'transfer' ? 'From Site / Well' : 'Well / Pump Site'}
              <input
                className="input"
                aria-label={action === 'transfer' ? 'From Site / Well' : 'Well / Pump Site'}
                list="inventory-site-options"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="e.g. Well 4 BAR"
                required
              />
            </label>
            {action === 'transfer' && (
              <label style={{ fontSize: 12, fontWeight: 600 }}>
                To Site / Well
                <input
                  className="input"
                  aria-label="To Site / Well"
                  list="inventory-site-options"
                  value={destSiteName}
                  onChange={(e) => setDestSiteName(e.target.value)}
                  placeholder="Destination site"
                  required
                />
              </label>
            )}
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Consumable Item
              <select
                className="input"
                aria-label="Consumable Item"
                value={selectedItem?.id ?? ''}
                onChange={(e) => setItemId(e.target.value)}
                required
              >
                {activeItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name} ({it.unit})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <datalist id="inventory-site-options">
            {p.siteNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          {selectedItem && siteName.trim() && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '6px 10px', borderRadius: 6, background: 'var(--surface-muted)' }}>
              Current balance at <b>{siteName.trim()}</b>: <b>{formatInventoryQty(currentBal, selectedItem.unit)}</b>
              {adjDelta !== null && (
                <span>
                  {' '}→ Adjustment: <b style={{ color: adjDelta >= 0 ? 'var(--ok-fg)' : 'var(--danger)' }}>
                    {adjDelta >= 0 ? '+' : ''}{formatInventoryQty(adjDelta, selectedItem.unit)}
                  </b>
                </span>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, minWidth: 0 }}>
              {action === 'adjustment'
                ? `Physical Count (${selectedItem?.unit ?? ''})`
                : `Quantity (${selectedItem?.unit ?? ''})`}
              <input
                className="input"
                aria-label={action === 'adjustment' ? 'Physical Count' : 'Quantity'}
                type="number"
                step="0.001"
                min={action === 'adjustment' ? '0' : '0.001'}
                value={quantityInput}
                onChange={(e) => setQuantityInput(e.target.value)}
                placeholder="0"
                required
              />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, minWidth: 0 }}>
              Date
              <input
                className="input"
                aria-label="Movement Date"
                type="date"
                value={movementDate}
                onChange={(e) => setMovementDate(e.target.value)}
                required
              />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, minWidth: 0 }}>
              DR / Receipt # (optional)
              <input
                className="input"
                aria-label="DR / Receipt #"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="DR-2026-001"
              />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, minWidth: 0 }}>
              Notes (optional)
              <input
                className="input"
                aria-label="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Supplier, physical count note..."
              />
            </label>
          </div>

          {err && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)' }}>{err}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn" onClick={p.onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save Movement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export interface ConsumableItemModalProps {
  open: boolean;
  orgId: string;
  editing: ConsumableItemRow | null;
  onClose: () => void;
  onSaved: (item: ConsumableItemRow, isEdit: boolean) => void;
}

export function ConsumableItemModal(p: ConsumableItemModalProps) {
  const [name, setName] = useState(p.editing?.name ?? '');
  const [category, setCategory] = useState<ConsumableCategory>(p.editing?.category ?? 'supplies');
  const [unit, setUnit] = useState(p.editing?.unit ?? 'pcs');
  const [threshold, setThreshold] = useState(p.editing ? String(p.editing.low_stock_threshold) : '5');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!p.open) return;
    setName(p.editing?.name ?? '');
    setCategory(p.editing?.category ?? 'supplies');
    setUnit(p.editing?.unit ?? 'pcs');
    setThreshold(p.editing ? String(p.editing.low_stock_threshold) : '5');
    setErr('');
  }, [p.open, p.editing]);

  if (!p.open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const cleanName = name.trim();
    const cleanUnit = unit.trim();
    const numThreshold = Number(threshold || '0');
    if (!cleanName) { setErr('Item name is required.'); return; }
    if (!cleanUnit) { setErr('Unit is required.'); return; }
    if (!Number.isFinite(numThreshold) || numThreshold < 0) { setErr('Low-stock threshold must be 0 or greater.'); return; }

    setBusy(true);
    try {
      const sb = supabaseBrowser();
      if (p.editing) {
        const { data, error } = await sb
          .from('consumable_items')
          .update({
            name: cleanName,
            category,
            unit: cleanUnit,
            low_stock_threshold: roundQty3(numThreshold),
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.editing.id)
          .select('id, organization_id, code, name, category, unit, low_stock_threshold, is_active, sort_order, created_at, updated_at')
          .single();
        if (error) { setErr(error.message); return; }
        p.onSaved(data as ConsumableItemRow, true);
      } else {
        const { data, error } = await sb
          .from('consumable_items')
          .insert({
            organization_id: p.orgId,
            name: cleanName,
            category,
            unit: cleanUnit,
            low_stock_threshold: roundQty3(numThreshold),
            sort_order: 200,
          })
          .select('id, organization_id, code, name, category, unit, low_stock_threshold, is_active, sort_order, created_at, updated_at')
          .single();
        if (error) { setErr(error.message); return; }
        p.onSaved(data as ConsumableItemRow, false);
      }
      p.onClose();
    } catch (ex: unknown) {
      setErr(getErrorMessage(ex, 'Failed to save consumable item'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={p.onClose}>
      <div className="modal-sheet" role="dialog" aria-modal="true" aria-label={p.editing ? 'Edit consumable item' : 'Add consumable item'} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 10px' }}>{p.editing ? 'Edit Consumable Item' : 'Add Consumable Item'}</h3>
        <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Item Name
            <input
              className="input"
              aria-label="Item Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Engine Oil 15W-40, Salt Tablets"
              required
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, minWidth: 0 }}>
              Category
              <select
                className="input"
                aria-label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value as ConsumableCategory)}
              >
                {(Object.keys(CONSUMABLE_CATEGORY_LABELS) as ConsumableCategory[]).map((c) => (
                  <option key={c} value={c}>{CONSUMABLE_CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, minWidth: 0 }}>
              Unit
              <input
                className="input"
                aria-label="Unit"
                list="inventory-unit-options"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="kg, L, pcs"
                required
              />
            </label>
          </div>
          <datalist id="inventory-unit-options">
            {CONSUMABLE_UNIT_OPTIONS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Low-Stock Alert Threshold (per site, 0 = none)
            <input
              className="input"
              aria-label="Low-Stock Threshold"
              type="number"
              step="0.001"
              min="0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
          {err && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn" onClick={p.onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : p.editing ? 'Save Changes' : 'Add Consumable'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
