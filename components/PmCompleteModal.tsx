'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  classifyPmCompletionRoles,
  getDefaultPmPerformers,
  resolvePmCreditedOperators,
  uniqueOperatorIds,
} from '@/lib/pm-credit';

export type PmCompleteModalTask = {
  id: string;
  title: string;
  locations: string[];
  asset?: string | null;
  scheduled_date: string;
  status: 'planned' | 'done' | 'postponed';
  assigned_operator_ids: string[];
  completed_by_operator_ids?: string[] | null;
  remarks: string | null;
};

export type PmCompleteModalOp = {
  id: string;
  full_name: string;
  position?: string | null;
};

interface PmCompleteModalProps {
  open: boolean;
  mode: 'complete' | 'edit';
  task: PmCompleteModalTask | null;
  operators: PmCompleteModalOp[];
  currentOperatorId?: string | null;
  requireCurrentOperator?: boolean;
  initialRemarks?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (result: { completedByIds: string[]; remarks: string | null }) => void;
}

/**
 * Shared 1-tap crew confirmation dialog for marking a PM task done or editing who actually
 * performed it, preserving original Planned Assignees while crediting actual performers.
 */
export default function PmCompleteModal({
  open,
  mode,
  task,
  operators,
  currentOperatorId,
  requireCurrentOperator = false,
  initialRemarks,
  busy = false,
  onCancel,
  onConfirm,
}: PmCompleteModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [remarks, setRemarks] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open || !task) return;
    const explicit = uniqueOperatorIds(task.completed_by_operator_ids);
    const taskPlannedSet = new Set(uniqueOperatorIds(task.assigned_operator_ids));
    const baseIds =
      mode === 'edit' && explicit.length > 0
        ? explicit
        : mode === 'edit' && task.status === 'done'
          ? resolvePmCreditedOperators(task)
          : getDefaultPmPerformers(task, currentOperatorId);
    const allowedBase = requireCurrentOperator
      ? baseIds.filter((id) => taskPlannedSet.has(id) || id === currentOperatorId)
      : baseIds;
    const initialIds =
      requireCurrentOperator && currentOperatorId
        ? uniqueOperatorIds([...allowedBase, currentOperatorId])
        : allowedBase;
    setSelectedIds(initialIds);
    setRemarks(initialRemarks !== undefined ? initialRemarks : (task.remarks ?? ''));
    setSearch('');
  }, [open, task, mode, currentOperatorId, initialRemarks, requireCurrentOperator]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  const opById = useMemo(() => new Map(operators.map((o) => [o.id, o])), [operators]);
  const plannedIds = useMemo(() => uniqueOperatorIds(task?.assigned_operator_ids), [task]);
  const plannedSet = useMemo(() => new Set(plannedIds), [plannedIds]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const unlistedOperators = useMemo(() => {
    const q = search.trim().toLowerCase();
    return operators
      .filter((o) => !plannedSet.has(o.id))
      .filter(
        (o) =>
          !q ||
          o.full_name.toLowerCase().includes(q) ||
          (o.position ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const aMe = a.id === currentOperatorId ? 1 : 0;
        const bMe = b.id === currentOperatorId ? 1 : 0;
        if (aMe !== bMe) return bMe - aMe;
        const aSel = selectedSet.has(a.id) ? 1 : 0;
        const bSel = selectedSet.has(b.id) ? 1 : 0;
        if (aSel !== bSel) return bSel - aSel;
        return a.full_name.localeCompare(b.full_name);
      });
  }, [operators, plannedSet, search, currentOperatorId, selectedSet]);

  if (!open || !task) return null;

  const roles = classifyPmCompletionRoles({
    status: 'done',
    assigned_operator_ids: task.assigned_operator_ids,
    completed_by_operator_ids: selectedIds,
  });

  function toggleOp(id: string) {
    if (requireCurrentOperator) {
      if (currentOperatorId && id === currentOperatorId && selectedSet.has(id)) return;
      if (!plannedSet.has(id) && id !== currentOperatorId) return;
    }
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const nameOf = (id: string) => opById.get(id)?.full_name ?? id;

  return (
    <div
      className="no-print modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pm-complete-title"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="modal-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 500, display: 'grid', gap: 12 }}
      >
        <div>
          <h2 id="pm-complete-title" style={{ margin: 0, fontSize: 17 }}>
            {mode === 'edit' ? 'Edit Actual Performers' : 'Who actually performed this PM?'}
          </h2>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
            <b>{task.title}</b>
            {task.locations.length > 0 ? ` · ${task.locations.join(', ')}` : ''}
            {task.scheduled_date ? ` · ${task.scheduled_date}` : ''}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
            Planned assignees stay recorded for audit; only selected performers receive Done KPI credit.
          </div>
        </div>

        {/* Section 1: Planned Assignees */}
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Planned Assignees ({plannedIds.length})
          </div>
          {plannedIds.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No personnel were pre-assigned.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {plannedIds.map((id) => {
                const checked = selectedSet.has(id);
                const isMe = id === currentOperatorId;
                const isLockedSelf = Boolean(requireCurrentOperator && isMe && checked);
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={busy}
                    title={isLockedSelf ? 'Required: your name must stay selected when closing a PM task' : undefined}
                    onClick={() => toggleOp(id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '6px 10px',
                      borderRadius: 999,
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: busy ? 'wait' : isLockedSelf ? 'default' : 'pointer',
                      border: checked ? '1.5px solid #0f766e' : '1.5px dashed var(--border)',
                      background: checked ? 'var(--ok-bg)' : 'var(--surface-muted)',
                      color: checked ? 'var(--ok-fg)' : 'var(--text-muted)',
                      textDecoration: checked ? 'none' : 'line-through',
                    }}
                  >
                    <span>{checked ? '✓' : '✕'}</span>
                    <span>
                      {nameOf(id)}
                      {isMe ? ' (Me)' : ''}
                    </span>
                    {isLockedSelf && <span style={{ fontSize: 10, fontWeight: 600 }}>🔒</span>}
                    {!checked && <span style={{ fontSize: 10.5, fontWeight: 600 }}>Not participating</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 2: Unlisted Personnel / Substitutes */}
        {requireCurrentOperator ? (
          <div style={{ display: 'grid', gap: 6 }}>
            {currentOperatorId && !plannedSet.has(currentOperatorId) && (
              <>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  Substitute Performer (You)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '5px 9px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      border: '1.5px solid #d97706',
                      background: 'var(--warn-bg)',
                      color: 'var(--warn-fg)',
                    }}
                  >
                    <span>✓</span>
                    <span>{nameOf(currentOperatorId)} (Me)</span>
                    <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>Sub 🔒</span>
                  </span>
                </div>
              </>
            )}
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Operators may credit themselves and originally planned assignees when closing a PM task. Contact a scheduler or admin if an additional substitute also helped.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Add Unlisted Personnel / Substitutes
            </div>
            <input
              type="search"
              className="input"
              placeholder="Filter personnel by name or role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={busy}
              style={{ fontSize: 12.5, minHeight: 34 }}
            />
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                maxHeight: 150,
                overflowY: 'auto',
                padding: 6,
                border: '1px solid var(--border-light)',
                borderRadius: 8,
                background: 'var(--surface-muted)',
              }}
            >
              {unlistedOperators.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No matching personnel.</span>
              ) : (
                unlistedOperators.map((o) => {
                  const checked = selectedSet.has(o.id);
                  const isMe = o.id === currentOperatorId;
                  const isLockedSelf = Boolean(requireCurrentOperator && isMe && checked);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      disabled={busy}
                      title={isLockedSelf ? 'Required: your name must stay selected when closing a PM task' : undefined}
                      onClick={() => toggleOp(o.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '5px 9px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: checked ? 700 : 500,
                        cursor: busy ? 'wait' : isLockedSelf ? 'default' : 'pointer',
                        border: checked ? '1.5px solid #d97706' : '1px solid var(--border)',
                        background: checked ? 'var(--warn-bg)' : 'var(--surface)',
                        color: checked ? 'var(--warn-fg)' : 'var(--text)',
                      }}
                    >
                      <span>{checked ? '✓' : '+'}</span>
                      <span>
                        {o.full_name}
                        {isMe ? ' (Me)' : ''}
                      </span>
                      {checked && (
                        <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>
                          {isLockedSelf ? 'Sub 🔒' : 'Sub'}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Live Credit Summary */}
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-light)',
            background: selectedIds.length === 0 ? 'var(--danger-bg)' : 'var(--info-bg)',
            color: selectedIds.length === 0 ? 'var(--danger-fg)' : 'var(--info-fg)',
            fontSize: 12,
            display: 'grid',
            gap: 2,
          }}
        >
          {selectedIds.length === 0 ? (
            <strong>Select at least one operator who performed this task.</strong>
          ) : (
            <>
              <div>
                <b>Crediting ({selectedIds.length}):</b> {selectedIds.map(nameOf).join(', ')}
              </div>
              {roles.substituteIds.length > 0 && (
                <div style={{ color: 'var(--warn-fg)', fontWeight: 600 }}>
                  Unlisted substitute{roles.substituteIds.length > 1 ? 's' : ''}:{' '}
                  {roles.substituteIds.map(nameOf).join(', ')}
                </div>
              )}
              {roles.absentPlannedIds.length > 0 && (
                <div style={{ color: 'var(--text-secondary)' }}>
                  Planned not participating (0 Done credit): {roles.absentPlannedIds.map(nameOf).join(', ')}
                </div>
              )}
              {requireCurrentOperator && currentOperatorId && (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  You must remain included as an actual performer when closing a PM task.
                </div>
              )}
            </>
          )}
        </div>

        <label style={{ fontSize: 12.5, display: 'grid', gap: 4 }}>
          <span>Completion notes / remarks (optional)</span>
          <input
            className="input"
            placeholder="e.g., Covered by Night Shift crew / valve flushed…"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            disabled={busy}
          />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || selectedIds.length === 0}
            onClick={() => onConfirm({ completedByIds: selectedIds, remarks: remarks.trim() || null })}
          >
            {busy ? 'Saving…' : mode === 'edit' ? 'Save Performers' : 'Confirm Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
