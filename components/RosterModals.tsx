'use client';

import type React from 'react';

export interface RosterContextTarget {
  x: number;
  y: number;
  opId: string;
  opName: string;
  date: string;
}

export function RosterContextMenu({
  ctxMenu,
  onClose,
  onSetStandby,
  onRequestFillRight,
  onClearCell,
}: {
  ctxMenu: RosterContextTarget;
  onClose: () => void;
  onSetStandby: (opId: string, date: string, standbyType: 'OC' | 'DWP' | 'ERP' | null) => Promise<void> | void;
  onRequestFillRight: (opId: string, opName: string, date: string) => void;
  onClearCell: (opId: string, date: string) => Promise<void> | void;
}) {
  const actions: Array<{ label: string; fn: () => Promise<void> | void; color: string }> = [
    { label: 'Set General On-Call (OC)', fn: () => onSetStandby(ctxMenu.opId, ctxMenu.date, 'OC'), color: 'var(--violet)' },
    { label: 'Deep Well Standby (DWP)', fn: () => onSetStandby(ctxMenu.opId, ctxMenu.date, 'DWP'), color: 'var(--violet)' },
    { label: 'Electro-Mech Repair (ERP)', fn: () => onSetStandby(ctxMenu.opId, ctxMenu.date, 'ERP'), color: 'var(--violet)' },
    { label: 'Remove Standby', fn: () => onSetStandby(ctxMenu.opId, ctxMenu.date, null), color: 'var(--text-secondary)' },
    {
      label: 'Fill Right to Month End',
      fn: () => onRequestFillRight(ctxMenu.opId, ctxMenu.opName, ctxMenu.date),
      color: 'var(--text)',
    },
    { label: 'Clear Shift (No Duty)', fn: () => onClearCell(ctxMenu.opId, ctxMenu.date), color: 'var(--danger)' },
  ];

  return (
    <div
      className="no-print"
      role="menu"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: typeof window !== 'undefined' ? Math.max(8, Math.min(ctxMenu.y, window.innerHeight - 310)) : ctxMenu.y,
        left: typeof window !== 'undefined' ? Math.max(8, Math.min(ctxMenu.x, window.innerWidth - 228)) : ctxMenu.x,
        zIndex: 85,
        width: 220,
        background: 'var(--surface)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 10px 25px rgba(15, 23, 42, 0.25)',
        padding: '4px 0',
        fontSize: 12.5,
      }}
    >
      <div style={{ padding: '5px 10px', borderBottom: '1px solid var(--border-light)', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
        <span>CELL ACTIONS</span>
        <span style={{ color: 'var(--accent)' }}>
          {ctxMenu.opName.split(' ')[0]} · {ctxMenu.date.slice(5)}
        </span>
      </div>
      {actions.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          onClick={() => {
            onClose();
            void item.fn();
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            minHeight: 40,
            padding: '8px 12px',
            border: 'none',
            background: 'transparent',
            color: item.color,
            cursor: 'pointer',
            fontWeight: 500,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-muted)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function RosterFillConfirmModal({
  confirmFill,
  monthLabel,
  onCancel,
  onConfirm,
}: {
  confirmFill: { opId: string; opName: string; date: string; count: number };
  monthLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="no-print modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fill-dialog-title"
      onClick={onCancel}
    >
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, display: 'grid', gap: 12 }}>
        <h2 id="fill-dialog-title" style={{ margin: 0, fontSize: 17 }}>
          Fill schedule to month end?
        </h2>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
          This will copy <b>{confirmFill.opName}</b>&apos;s assignment from <b>{confirmFill.date}</b> across{' '}
          <b>{confirmFill.count}</b> days through the end of {monthLabel}. You can undo this with <code>Ctrl+Z</code>.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm}>
            Fill {confirmFill.count} days
          </button>
        </div>
      </div>
    </div>
  );
}

export function RosterImportJsonModal({
  importing,
  importStatus,
  onFileChange,
  onClose,
}: {
  importing: boolean;
  importStatus: string;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="no-print modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-dialog-title"
      onClick={() => !importing && onClose()}
    >
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 id="import-dialog-title" style={{ margin: '0 0 6px', fontSize: 17 }}>
          Import Legacy JSON Backup
        </h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-secondary)' }}>
          Select a JSON backup exported from the standalone HTML app. Existing records are safely upserted.
        </p>
        <input type="file" accept=".json,application/json" onChange={onFileChange} disabled={importing} />
        {importing && <p style={{ fontSize: 13, color: 'var(--accent)', margin: '10px 0 0' }}>Importing…</p>}
        {importStatus && (
          <p style={{ fontSize: 13, margin: '10px 0 0', color: importStatus.startsWith('Error:') ? 'var(--danger)' : 'var(--ok-fg)' }}>
            {importStatus}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn" onClick={onClose} disabled={importing}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function RosterProposeBar({
  count,
  onOpenSubmit,
  onDiscard,
}: {
  count: number;
  onOpenSubmit: () => void;
  onDiscard: () => void;
}) {
  return (
    <aside className="no-print propose-bar" aria-label="Pending proposal submission bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--warn-fg)', display: 'inline-block', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          Propose Mode: {count} change{count === 1 ? '' : 's'} queued
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onOpenSubmit}
          style={{ padding: '6px 14px', fontSize: 12.5 }}
        >
          Submit for Approval
        </button>
        <button
          type="button"
          className="btn"
          onClick={onDiscard}
          style={{ padding: '6px 12px', fontSize: 12.5, color: 'var(--danger)' }}
        >
          Discard
        </button>
      </div>
    </aside>
  );
}

export function RosterSubmitProposalModal({
  count,
  submitNote,
  isSubmitting,
  onChangeNote,
  onCancel,
  onSubmit,
}: {
  count: number;
  submitNote: string;
  isSubmitting: boolean;
  onChangeNote: (val: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div
      className="no-print modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-proposal-title"
      onClick={() => !isSubmitting && onCancel()}
    >
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, display: 'grid', gap: 12 }}>
        <h2 id="submit-proposal-title" style={{ margin: 0, fontSize: 17 }}>
          Submit Schedule Proposal
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
          You have queued <strong>{count}</strong> change{count === 1 ? '' : 's'}. Admins and delegated approvers will review and approve them before they take effect on the live schedule.
        </p>
        <div>
          <label htmlFor="submit-note-input" style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
            Optional Note / Reason:
          </label>
          <textarea
            id="submit-note-input"
            className="input"
            rows={3}
            placeholder="e.g. Schedule adjustments for pump maintenance coverage"
            value={submitNote}
            onChange={(e) => onChangeNote(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            className="btn"
            disabled={isSubmitting}
            onClick={onCancel}
            style={{ padding: '6px 14px', fontSize: 12.5 }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isSubmitting}
            onClick={onSubmit}
            style={{ padding: '6px 16px', fontSize: 12.5 }}
          >
            {isSubmitting ? 'Submitting...' : `Submit ${count} Change${count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
