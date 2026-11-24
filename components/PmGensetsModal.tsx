'use client';

import { useEffect, type Dispatch, type SetStateAction } from 'react';
import GensetsManager from '@/components/GensetsManager';
import type { GensetRow } from '@/lib/gensets';
import type { PmLocationOption } from '@/lib/pm-locations';

interface PmGensetsModalProps {
  open: boolean;
  orgId: string;
  canEdit: boolean;
  tableReady: boolean;
  gensets: GensetRow[];
  setGensets: Dispatch<SetStateAction<GensetRow[]>>;
  savedLocations: PmLocationOption[];
  onClose: () => void;
}

export default function PmGensetsModal({
  open,
  orgId,
  canEdit,
  tableReady,
  gensets,
  setGensets,
  savedLocations,
  onClose,
}: PmGensetsModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="no-print modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pm-manage-gensets-title"
      onClick={onClose}
    >
      <div
        className="modal-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 680, maxHeight: '88vh', overflowY: 'auto', display: 'grid', gap: 12 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 id="pm-manage-gensets-title" style={{ margin: 0, fontSize: 16 }}>
            Manage Gensets &amp; Site Assignments
          </h2>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>

        <GensetsManager
          orgId={orgId}
          canEdit={canEdit}
          tableReady={tableReady}
          gensets={gensets}
          setGensets={setGensets}
          savedLocations={savedLocations}
        />
      </div>
    </div>
  );
}
