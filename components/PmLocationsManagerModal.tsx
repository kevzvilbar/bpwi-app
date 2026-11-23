'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  isMissingPmLocationsTableError,
  normalizeLocationKey,
  type PmAreaWithSubSites,
  type PmLocationRow,
} from '@/lib/pm-locations';

interface PmLocationsManagerModalProps {
  open: boolean;
  orgId: string;
  canEdit: boolean;
  tableReady: boolean;
  pmLocations: PmLocationRow[];
  setPmLocations: React.Dispatch<React.SetStateAction<PmLocationRow[]>>;
  areas: PmAreaWithSubSites[];
  onClose: () => void;
}

export default function PmLocationsManagerModal({
  open,
  orgId,
  canEdit,
  tableReady,
  pmLocations,
  setPmLocations,
  areas,
  onClose,
}: PmLocationsManagerModalProps) {
  const [newName, setNewName] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose, open]);

  if (!open) return null;

  const stationSubSites = areas
    .filter((a) => a.category === 'station' && (a.sub_sites ?? []).length > 0)
    .map((a) => ({ code: a.code, name: a.name, sites: a.sub_sites ?? [] }));

  const addLocation = async () => {
    if (!canEdit || !tableReady || busy) return;
    const cleaned = newName.trim().replace(/\s+/g, ' ');
    if (!cleaned) return;
    const key = normalizeLocationKey(cleaned);
    if (pmLocations.some((l) => normalizeLocationKey(l.name) === key)) {
      setErrorMsg(`"${cleaned}" is already in the saved PM locations list.`);
      return;
    }

    setBusy(true);
    setErrorMsg('');
    const nextSort =
      pmLocations.length > 0 ? Math.max(...pmLocations.map((l) => l.sort_order)) + 1 : 0;
    const { data, error } = await supabaseBrowser()
      .from('pm_locations')
      .insert({ organization_id: orgId, name: cleaned, sort_order: nextSort })
      .select('id, name, sort_order')
      .single();
    setBusy(false);

    if (error) {
      setErrorMsg(
        isMissingPmLocationsTableError(error)
          ? 'PM locations table is not yet installed. Run migration 027_pm_locations.sql first.'
          : error.message,
      );
      return;
    }
    if (data) {
      setPmLocations((prev) => [...prev, data as PmLocationRow]);
    }
    setNewName('');
  };

  const renameLocation = async (row: PmLocationRow) => {
    if (!canEdit || !tableReady || busy) return;
    const raw = edits[row.id] ?? row.name;
    const cleaned = raw.trim().replace(/\s+/g, ' ');
    if (!cleaned || cleaned === row.name) {
      setEdits((prev) => {
        const copy = { ...prev };
        delete copy[row.id];
        return copy;
      });
      return;
    }
    const key = normalizeLocationKey(cleaned);
    if (pmLocations.some((l) => l.id !== row.id && normalizeLocationKey(l.name) === key)) {
      setErrorMsg(`Another location named "${cleaned}" already exists.`);
      return;
    }

    setBusy(true);
    setErrorMsg('');
    const { error } = await supabaseBrowser()
      .from('pm_locations')
      .update({ name: cleaned })
      .eq('id', row.id);
    setBusy(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setPmLocations((prev) => prev.map((l) => (l.id === row.id ? { ...l, name: cleaned } : l)));
    setEdits((prev) => {
      const copy = { ...prev };
      delete copy[row.id];
      return copy;
    });
  };

  const deleteLocation = async (row: PmLocationRow) => {
    if (!canEdit || !tableReady || busy) return;
    setBusy(true);
    setErrorMsg('');
    const { error } = await supabaseBrowser().from('pm_locations').delete().eq('id', row.id);
    setBusy(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setPmLocations((prev) => prev.filter((l) => l.id !== row.id));
  };

  return (
    <div
      className="no-print modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pm-manage-locs-title"
      onClick={() => !busy && onClose()}
    >
      <div
        className="modal-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520, display: 'grid', gap: 12 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 id="pm-manage-locs-title" style={{ margin: 0, fontSize: 16 }}>
            Manage Saved PM Locations
          </h2>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>

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
            The <code>pm_locations</code> table is not created in Supabase yet. Run migration{' '}
            <code>027_pm_locations.sql</code> to add/edit PM locations here. Station sub-sites from Settings still appear in suggestions.
          </div>
        )}

        {errorMsg && (
          <div
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
            onSubmit={(e) => {
              e.preventDefault();
              void addLocation();
            }}
            style={{ display: 'flex', gap: 8 }}
          >
            <input
              className="input"
              placeholder="Add saved area / site name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={busy}
            />
            <button
              type="submit"
              className="btn btn-add"
              disabled={busy || !newName.trim()}
            >
              + Add
            </button>
          </form>
        )}

        <div style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 6 }}>
          {pmLocations.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
              No custom PM locations saved yet.
            </div>
          ) : (
            pmLocations.map((row) => {
              const draftName = edits[row.id] ?? row.name;
              const isDirty = draftName.trim() !== row.name;
              return (
                <div key={row.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    className="input"
                    value={draftName}
                    disabled={!canEdit || !tableReady || busy}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  />
                  {canEdit && tableReady && isDirty && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void renameLocation(row)}
                    >
                      Save
                    </button>
                  )}
                  {canEdit && tableReady && (
                    <button
                      type="button"
                      className="btn"
                      style={{ color: 'var(--danger)' }}
                      disabled={busy}
                      onClick={() => void deleteLocation(row)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {stationSubSites.length > 0 && (
          <div
            style={{
              borderTop: '1px solid var(--border-light)',
              paddingTop: 10,
              display: 'grid',
              gap: 6,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
              From Settings → Areas &amp; Leave (Sub-sites / Wells):
            </div>
            <div style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              {stationSubSites.map((st) => (
                <div key={st.code}>
                  <b style={{ color: 'var(--text)' }}>{st.code}</b>: {st.sites.join(', ')}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
