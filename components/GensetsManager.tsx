'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  canAssignGensetToLocation,
  findActiveGensetAtLocation,
  GENSET_STATUS_LABELS,
  isMissingGensetsTableError,
  normalizeGensetKey,
  type GensetRow,
  type GensetStatus,
  type GensetTransferRow,
} from '@/lib/gensets';
import type { PmLocationOption } from '@/lib/pm-locations';

interface GensetsManagerProps {
  orgId: string;
  canEdit: boolean;
  tableReady: boolean;
  gensets: GensetRow[];
  setGensets: Dispatch<SetStateAction<GensetRow[]>>;
  savedLocations: PmLocationOption[];
}

export default function GensetsManager({
  orgId,
  canEdit,
  tableReady,
  gensets,
  setGensets,
  savedLocations,
}: GensetsManagerProps) {
  const [newControlNo, setNewControlNo] = useState('');
  const [newKva, setNewKva] = useState('');
  const [newBrand, setNewBrand] = useState('');
  const [newStatus, setNewStatus] = useState<GensetStatus>('active');
  const [newLocation, setNewLocation] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editControlNo, setEditControlNo] = useState('');
  const [editKva, setEditKva] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editStatus, setEditStatus] = useState<GensetStatus>('active');
  const [editLocation, setEditLocation] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [historyForId, setHistoryForId] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<GensetTransferRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !tableReady || busy) return;
    const ctrl = newControlNo.trim().replace(/\s+/g, ' ');
    if (!ctrl) return;
    if (gensets.some((g) => normalizeGensetKey(g.control_no) === normalizeGensetKey(ctrl))) {
      setErrorMsg(`Genset "${ctrl}" already exists in the registry.`);
      return;
    }
    const locCheck = canAssignGensetToLocation(gensets, newLocation, newStatus);
    if (!locCheck.ok) {
      setErrorMsg(locCheck.error);
      return;
    }

    setBusy(true);
    setErrorMsg('');
    const cleanLoc = newLocation.trim() || null;
    const { data, error } = await supabaseBrowser()
      .from('gensets')
      .insert({
        organization_id: orgId,
        control_no: ctrl,
        kva_rating: newKva.trim() || null,
        brand_model: newBrand.trim() || null,
        status: newStatus,
        current_location: cleanLoc,
      })
      .select('id, control_no, brand_model, kva_rating, fuel_type, status, current_location, notes')
      .single();
    setBusy(false);

    if (error) {
      setErrorMsg(
        isMissingGensetsTableError(error)
          ? 'Gensets registry table is not installed yet. Run migration 033_genset_registry.sql first.'
          : error.message,
      );
      return;
    }
    if (data) {
      setGensets((prev) => [...prev, data as GensetRow].sort((a, b) => a.control_no.localeCompare(b.control_no)));
    }
    setNewControlNo('');
    setNewKva('');
    setNewBrand('');
    setNewStatus('active');
    setNewLocation('');
  };

  const startEdit = (g: GensetRow) => {
    setEditingId(g.id);
    setEditControlNo(g.control_no);
    setEditKva(g.kva_rating ?? '');
    setEditBrand(g.brand_model ?? '');
    setEditStatus(g.status);
    setEditLocation(g.current_location ?? '');
    setEditNotes(g.notes ?? '');
    setMoveReason('');
    setErrorMsg('');
  };

  const handleSaveEdit = async (original: GensetRow) => {
    if (!canEdit || !tableReady || busy) return;
    const ctrl = editControlNo.trim().replace(/\s+/g, ' ');
    if (!ctrl) {
      setErrorMsg('Control # cannot be empty.');
      return;
    }
    if (gensets.some((g) => g.id !== original.id && normalizeGensetKey(g.control_no) === normalizeGensetKey(ctrl))) {
      setErrorMsg(`Another genset already uses Control # "${ctrl}".`);
      return;
    }
    const locCheck = canAssignGensetToLocation(gensets, editLocation, editStatus, original.id);
    if (!locCheck.ok) {
      setErrorMsg(locCheck.error);
      return;
    }

    const nextLoc = editLocation.trim() || null;
    const locationChanged = (original.current_location ?? '') !== (nextLoc ?? '');

    setBusy(true);
    setErrorMsg('');
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('gensets')
      .update({
        control_no: ctrl,
        kva_rating: editKva.trim() || null,
        brand_model: editBrand.trim() || null,
        status: editStatus,
        current_location: nextLoc,
        notes: editNotes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', original.id)
      .select('id, control_no, brand_model, kva_rating, fuel_type, status, current_location, notes')
      .single();

    if (error) {
      setBusy(false);
      setErrorMsg(error.message);
      return;
    }

    // Attach optional transfer reason to the newly auto-created genset_transfers row
    if (locationChanged && moveReason.trim()) {
      const { data: latestTransfer } = await sb
        .from('genset_transfers')
        .select('id')
        .eq('genset_id', original.id)
        .order('moved_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestTransfer?.id) {
        await sb.from('genset_transfers').update({ reason: moveReason.trim() }).eq('id', latestTransfer.id);
      }
    }

    setBusy(false);
    if (data) {
      setGensets((prev) =>
        prev.map((x) => (x.id === original.id ? (data as GensetRow) : x)).sort((a, b) => a.control_no.localeCompare(b.control_no)),
      );
    }
    setEditingId(null);
    if (historyForId === original.id) {
      void loadHistory(original.id);
    }
  };

  const handleDelete = async (g: GensetRow) => {
    if (!canEdit || !tableReady || busy) return;
    setBusy(true);
    setErrorMsg('');
    const { error } = await supabaseBrowser().from('gensets').delete().eq('id', g.id);
    setBusy(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setGensets((prev) => prev.filter((x) => x.id !== g.id));
    if (editingId === g.id) setEditingId(null);
    if (historyForId === g.id) setHistoryForId(null);
  };

  const loadHistory = async (gensetId: string) => {
    if (historyForId === gensetId && !loadingHistory) {
      setHistoryForId(null);
      return;
    }
    setHistoryForId(gensetId);
    setLoadingHistory(true);
    const { data, error } = await supabaseBrowser()
      .from('genset_transfers')
      .select('id, genset_id, from_location, to_location, reason, moved_by, moved_at')
      .eq('genset_id', gensetId)
      .order('moved_at', { ascending: false })
      .limit(20);
    setLoadingHistory(false);
    if (error) {
      setErrorMsg(error.message);
      setTransfers([]);
      return;
    }
    setTransfers((data ?? []) as GensetTransferRow[]);
  };

  const renderLocationOptions = (excludeId?: string, currentVal?: string, statusVal: GensetStatus = 'active') => {
    const cleanCurrent = currentVal?.trim() ?? '';
    const knownNames = new Set(savedLocations.map((l) => normalizeGensetKey(l.name)));
    const extraCurrent =
      cleanCurrent && !knownNames.has(normalizeGensetKey(cleanCurrent)) ? [cleanCurrent] : [];

    return (
      <>
        <option value="">— Yard / Unassigned —</option>
        {extraCurrent.map((loc) => (
          <option key={loc} value={loc}>
            {loc} (current)
          </option>
        ))}
        {savedLocations.map((loc) => {
          const occupant = findActiveGensetAtLocation(gensets, loc.name, excludeId);
          const blocked = statusVal === 'active' && Boolean(occupant);
          return (
            <option key={loc.name} value={loc.name} disabled={blocked}>
              {loc.name}
              {occupant ? ` — Occupied by ${occupant.control_no}` : ''}
            </option>
          );
        })}
      </>
    );
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {!tableReady && (
        <div
          style={{
            fontSize: 12,
            padding: '8px 10px',
            borderRadius: 6,
            background: 'var(--warn-bg)',
            color: 'var(--warn-fg)',
            border: '1px solid var(--warn-border)',
          }}
        >
          The <code>gensets</code> table is not installed in Supabase yet. Run migration{' '}
          <code>033_genset_registry.sql</code> to manage Genset Control #s and site assignments.
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            padding: '7px 10px',
            borderRadius: 6,
            background: 'var(--danger-bg)',
            color: 'var(--danger-fg)',
            border: '1px solid var(--danger-border)',
            fontWeight: 600,
          }}
        >
          {errorMsg}
        </div>
      )}

      {canEdit && tableReady && (
        <form
          onSubmit={(e) => void handleAdd(e)}
          className="card"
          style={{ padding: 10, display: 'grid', gap: 8, background: 'var(--surface-muted)' }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>Register Genset</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 6 }}>
            <input
              className="input"
              aria-label="Genset Control #"
              placeholder="Control # (e.g. GS-04)"
              value={newControlNo}
              onChange={(e) => setNewControlNo(e.target.value)}
              disabled={busy}
            />
            <input
              className="input"
              aria-label="kVA Rating"
              placeholder="kVA (e.g. 100 kVA)"
              value={newKva}
              onChange={(e) => setNewKva(e.target.value)}
              disabled={busy}
            />
            <input
              className="input"
              aria-label="Brand / Model"
              placeholder="Brand / Model (opt.)"
              value={newBrand}
              onChange={(e) => setNewBrand(e.target.value)}
              disabled={busy}
            />
            <select
              className="input"
              aria-label="Genset status"
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as GensetStatus)}
              disabled={busy}
            >
              {(Object.keys(GENSET_STATUS_LABELS) as GensetStatus[]).map((st) => (
                <option key={st} value={st}>
                  {GENSET_STATUS_LABELS[st]}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Assigned site"
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              disabled={busy}
            >
              {renderLocationOptions(undefined, newLocation, newStatus)}
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Active gensets cannot share an already-occupied site. Relocating logs transfer history while recurring well PMs remain on their site.
            </span>
            <button type="submit" className="btn btn-add" disabled={busy || !newControlNo.trim()}>
              + Add genset
            </button>
          </div>
        </form>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {gensets.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center', padding: '14px 0' }}>
            No gensets registered yet.
          </div>
        ) : (
          gensets.map((g) => {
            const isEditing = editingId === g.id;
            const showHistory = historyForId === g.id;
            const locChanged = isEditing && (g.current_location ?? '') !== editLocation.trim();
            return (
              <div key={g.id} className="card" style={{ padding: 10, display: 'grid', gap: 8 }}>
                {!isEditing ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'grid', gap: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 13.5 }}>{g.control_no}</strong>
                        {g.kva_rating && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>· {g.kva_rating}</span>}
                        {g.brand_model && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {g.brand_model}</span>}
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '1px 7px',
                            borderRadius: 999,
                            background: g.status === 'active' ? 'var(--ok-bg)' : g.status === 'under_repair' ? 'var(--warn-bg)' : 'var(--surface-muted)',
                            color: g.status === 'active' ? 'var(--ok-fg)' : g.status === 'under_repair' ? 'var(--warn-fg)' : 'var(--text-secondary)',
                          }}
                        >
                          {GENSET_STATUS_LABELS[g.status]}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Site: <b>{g.current_location || 'Yard / Unassigned'}</b>
                        {g.notes ? ` · ${g.notes}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="btn" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => void loadHistory(g.id)}>
                        {showHistory ? 'Hide history' : 'History'}
                      </button>
                      {canEdit && tableReady && (
                        <>
                          <button type="button" className="btn" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => startEdit(g)}>
                            Move / Edit
                          </button>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '4px 9px', fontSize: 12, color: 'var(--danger)' }}
                            disabled={busy}
                            onClick={() => void handleDelete(g)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 6 }}>
                      <input className="input" aria-label="Edit Control #" value={editControlNo} onChange={(e) => setEditControlNo(e.target.value)} disabled={busy} />
                      <input className="input" aria-label="Edit kVA" placeholder="kVA" value={editKva} onChange={(e) => setEditKva(e.target.value)} disabled={busy} />
                      <input className="input" aria-label="Edit Brand" placeholder="Brand / Model" value={editBrand} onChange={(e) => setEditBrand(e.target.value)} disabled={busy} />
                      <select className="input" aria-label="Edit status" value={editStatus} onChange={(e) => setEditStatus(e.target.value as GensetStatus)} disabled={busy}>
                        {(Object.keys(GENSET_STATUS_LABELS) as GensetStatus[]).map((st) => (
                          <option key={st} value={st}>
                            {GENSET_STATUS_LABELS[st]}
                          </option>
                        ))}
                      </select>
                      <select className="input" aria-label="Edit assigned site" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} disabled={busy}>
                        {renderLocationOptions(g.id, editLocation, editStatus)}
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: locChanged ? 'repeat(auto-fit, minmax(180px, 1fr))' : '1fr', gap: 6 }}>
                      {locChanged && (
                        <input
                          className="input"
                          placeholder="Reason for relocation (optional, e.g. Backup swap)"
                          value={moveReason}
                          onChange={(e) => setMoveReason(e.target.value)}
                          disabled={busy}
                        />
                      )}
                      <input
                        className="input"
                        placeholder="Notes (optional)"
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        disabled={busy}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <button type="button" className="btn" disabled={busy} onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleSaveEdit(g)}>
                        {busy ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </div>
                )}

                {showHistory && (
                  <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 6, fontSize: 12, display: 'grid', gap: 4 }}>
                    <strong style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Location Transfer History</strong>
                    {loadingHistory ? (
                      <span style={{ color: 'var(--text-muted)' }}>Loading…</span>
                    ) : transfers.length === 0 ? (
                      <span style={{ color: 'var(--text-muted)' }}>No relocations recorded yet.</span>
                    ) : (
                      transfers.map((tr) => (
                        <div key={tr.id} style={{ color: 'var(--text-secondary)' }}>
                          <span>{tr.moved_at.slice(0, 10)}:</span>{' '}
                          <b>{tr.from_location || 'Yard'}</b> → <b>{tr.to_location || 'Yard'}</b>
                          {tr.reason ? ` (${tr.reason})` : ''}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
