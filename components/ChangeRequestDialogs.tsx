'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ChangeRequest, ChangeRequestItem } from '@/lib/profile';
import { overrideExplanation } from '@/lib/change-request-conflicts';

export type RejectDialog = { request: ChangeRequest; itemIds: string[] | null; count: number };
export type OverrideDialog = { request: ChangeRequest; item: ChangeRequestItem };

export type ChangeRequestSnap = {
  shift_type_id?: string | null;
  area_code_id?: string | null;
  standby_type?: string | null;
  title?: string | null;
  status?: string | null;
  scheduled_date?: string | null;
  assigned_operator_ids?: string[] | null;
  leave_code?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

const DLG_TEXT_STYLE: CSSProperties = { fontSize: 13, color: 'var(--text-secondary)', margin: 0 };

/** Confirmation modal for rejecting selected or all open items in a change request. */
export function ChangeRequestRejectDialog({
  rejectDialog,
  rejectReason,
  busy,
  dialogError,
  onChangeReason,
  onCancel,
  onConfirm,
}: {
  rejectDialog: RejectDialog;
  rejectReason: string;
  busy: boolean;
  dialogError: ReactNode;
  onChangeReason: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="no-print modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-dialog-title"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ display: 'grid', gap: 12 }}>
        <h2 id="reject-dialog-title" style={{ fontSize: 17, margin: 0 }}>
          {rejectDialog.itemIds
            ? `Reject ${rejectDialog.count} selected item${rejectDialog.count === 1 ? '' : 's'}`
            : `Reject ${rejectDialog.count} open item${rejectDialog.count === 1 ? '' : 's'}`}
        </h2>
        <p style={DLG_TEXT_STYLE}>
          From <strong>{rejectDialog.request.requester_name || 'Department Head'}</strong>. Items that were already approved stay applied
          {rejectDialog.itemIds ? '; other open items stay open.' : '.'}
        </p>
        <textarea
          aria-label="Reason for rejection"
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: 13,
            minHeight: 80,
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
          placeholder="e.g. Schedule already locked for payroll; please revise weekend shifts."
          value={rejectReason}
          onChange={(e) => onChangeReason(e.target.value)}
        />
        {dialogError}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            style={{ background: '#dc2626', borderColor: '#dc2626', color: '#ffffff', fontWeight: 700 }}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Rejecting…' : 'Confirm rejection'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Confirmation modal showing original, live, and proposed state before overriding a conflict. */
export function ChangeRequestOverrideDialog({
  overrideDialog,
  busy,
  dialogError,
  opMap,
  categoryLabel,
  renderDate,
  renderSnapshot,
  renderLive,
  renderProposed,
  onCancel,
  onConfirm,
}: {
  overrideDialog: OverrideDialog;
  busy: boolean;
  dialogError: ReactNode;
  opMap: Map<string, string>;
  categoryLabel: (t: ChangeRequestItem['target_table']) => string;
  renderDate: (item: ChangeRequestItem) => string;
  renderSnapshot: (item: ChangeRequestItem, s: ChangeRequestSnap | null | undefined, emptyLabel: string) => ReactNode;
  renderLive: (item: ChangeRequestItem) => ReactNode;
  renderProposed: (item: ChangeRequestItem) => ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { item } = overrideDialog;
  const missing = item.conflict_reason === 'target_missing';
  const row = (label: string, body: ReactNode) => (
    <div className="override-diff-row">
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span>{body}</span>
    </div>
  );

  return (
    <div
      className="no-print modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="override-dialog-title"
      onClick={() => !busy && onCancel()}
    >
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ display: 'grid', gap: 12 }}>
        <h2 id="override-dialog-title" style={{ fontSize: 17, margin: 0 }}>
          {missing ? 'Discard this item?' : 'Override live change?'}
        </h2>
        <p style={DLG_TEXT_STYLE}>
          <strong>{categoryLabel(item.target_table)}</strong> · {item.operator_id ? (opMap.get(item.operator_id) ?? 'Unknown Operator') : 'PM task'} · {renderDate(item)}
        </p>
        {row('When proposed', renderSnapshot(item, item.original_state as ChangeRequestSnap | null, 'Empty cell'))}
        {item.conflict_reason && row('Now (live)', renderLive(item))}
        {row(missing ? 'Requested' : 'Will be applied', renderProposed(item))}
        <p style={DLG_TEXT_STYLE}>{overrideExplanation(item.conflict_reason)}</p>
        {dialogError}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            style={{ background: '#b45309', borderColor: '#b45309', color: '#ffffff', fontWeight: 700 }}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Working…' : missing ? 'Discard item' : 'Override & apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
