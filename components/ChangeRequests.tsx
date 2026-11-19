'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { formatManila, formatDateOnly } from '@/lib/date';
import type { ChangeRequest, ChangeRequestItem } from '@/lib/profile';
import { getErrorMessage } from '@/lib/error-utils';

import { findOffShift, isOffPartnerArea } from '@/lib/roster-helpers';

type Shift = { id: string; code: string; description?: string | null; background_color: string; text_color: string; is_off?: boolean };
type Area = { id: string; code: string; name?: string | null; category?: string; background_color: string; text_color: string };
type Op = { id: string; full_name: string; position?: string | null };

type Props = {
  requests: ChangeRequest[];
  operators: Op[];
  shifts: Shift[];
  areas: Area[];
  canApprove: boolean;
  isAdmin?: boolean;
  isManager: boolean;
  currentUserId: string;
};

function hasOpenItems(r: ChangeRequest): boolean {
  return (r.items ?? []).some((i) => i.status === 'pending' || i.status === 'conflict');
}

function getOpenItems(r: ChangeRequest): ChangeRequestItem[] {
  return (r.items ?? []).filter((i) => i.status === 'pending' || i.status === 'conflict');
}

export default function ChangeRequests(p: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [selectedItems, setSelectedItems] = useState<Record<string, Set<string>>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [rejectDialog, setRejectDialog] = useState<{ requestId: string; requesterName: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isPending, startTransition] = useTransition();

  const opMap = new Map(p.operators.map((o) => [o.id, o.full_name]));
  const shiftMap = new Map(p.shifts.map((s) => [s.id, s]));
  const areaMap = new Map(p.areas.map((a) => [a.id, a]));
  const offShift = findOffShift(p.shifts.map((s) => ({ ...s, is_off: Boolean(s.is_off) })));

  const filteredRequests = p.requests.filter((r) => {
    if (tab === 'pending') return r.status === 'pending' || (r.status === 'partially_approved' && hasOpenItems(r));
    if (tab === 'approved') return r.status === 'approved' || (r.status === 'partially_approved' && !hasOpenItems(r));
    if (tab === 'rejected') return r.status === 'rejected';
    return true;
  });

  const pendingCount = p.requests.filter((r) => r.status === 'pending' || (r.status === 'partially_approved' && hasOpenItems(r))).length;
  const approvedCount = p.requests.filter((r) => r.status === 'approved' || (r.status === 'partially_approved' && !hasOpenItems(r))).length;
  const rejectedCount = p.requests.filter((r) => r.status === 'rejected').length;

  function toggleItemSelection(requestId: string, itemId: string) {
    setSelectedItems((prev) => {
      const current = new Set(prev[requestId] ?? []);
      if (current.has(itemId)) {
        current.delete(itemId);
      } else {
        current.add(itemId);
      }
      return { ...prev, [requestId]: current };
    });
  }

  function toggleAllItemsForRequest(request: ChangeRequest) {
    const openItems = getOpenItems(request);
    setSelectedItems((prev) => {
      const current = prev[request.id] ?? new Set();
      if (current.size === openItems.length && openItems.length > 0) {
        return { ...prev, [request.id]: new Set() };
      }
      return { ...prev, [request.id]: new Set(openItems.map((i) => i.id)) };
    });
  }

  async function handleApprove(request: ChangeRequest, onlySelected = false, forceConflicts = false) {
    setProcessingId(request.id);
    setActionMsg(null);
    const sb = supabaseBrowser();

    const openItems = getOpenItems(request);
    const openIdSet = new Set(openItems.map((i) => i.id));
    const selectedSet = selectedItems[request.id];
    const selectedOpen = selectedSet ? Array.from(selectedSet).filter((id) => openIdSet.has(id)) : [];
    const itemsToApprove = onlySelected && selectedOpen.length > 0 ? selectedOpen : openItems.map((i) => i.id);
    const allowSelfOverride = request.requester_id === p.currentUserId && Boolean(p.isAdmin);

    try {
      const { data, error } = await sb.rpc('approve_change_request', {
        p_request_id: request.id,
        p_item_ids: itemsToApprove,
        p_reject_item_ids: null,
        p_review_notes: allowSelfOverride ? 'Approved by admin (self-override)' : 'Approved by admin',
        p_force_conflicts: forceConflicts,
        p_allow_self_override: allowSelfOverride,
      });

      if (error) {
        setActionMsg({ type: 'err', text: `Approval failed: ${error.message}` });
      } else {
        const res = data as { conflict_count?: number; approved_count?: number } | null;
        if ((res?.conflict_count ?? 0) > 0 && !forceConflicts) {
          setActionMsg({
            type: 'err',
            text: `${res?.conflict_count} item(s) had conflicts with recent schedule updates. Review conflicts below or click Override.`,
          });
        } else {
          setActionMsg({
            type: 'ok',
            text: `Successfully approved ${res?.approved_count ?? itemsToApprove.length} change(s) in a single atomic transaction.`,
          });
        }
        startTransition(() => router.refresh());
      }
    } catch (err: unknown) {
      setActionMsg({ type: 'err', text: getErrorMessage(err, 'Network error during approval') });
    } finally {
      setProcessingId(null);
    }
  }

  async function handleRejectConfirm() {
    if (!rejectDialog) return;
    setProcessingId(rejectDialog.requestId);
    setActionMsg(null);
    const sb = supabaseBrowser();

    try {
      const { error } = await sb.rpc('reject_change_request', {
        p_request_id: rejectDialog.requestId,
        p_reason: rejectReason.trim() || 'Rejected by approver',
      });

      if (error) {
        setActionMsg({ type: 'err', text: `Rejection failed: ${error.message}` });
      } else {
        setActionMsg({ type: 'ok', text: 'Change request rejected.' });
        setRejectDialog(null);
        setRejectReason('');
        startTransition(() => router.refresh());
      }
    } catch (err: unknown) {
      setActionMsg({ type: 'err', text: getErrorMessage(err, 'Network error during rejection') });
    } finally {
      setProcessingId(null);
    }
  }

  function renderShiftBadge(shiftId: string | null | undefined, areaId: string | null | undefined) {
    if (!shiftId && !areaId) return <span style={{ color: 'var(--text-muted)' }}>Off / Cleared</span>;
    const s = shiftId ? shiftMap.get(shiftId) : null;
    const a = areaId ? areaMap.get(areaId) : null;
    const isOffArea = Boolean(a && isOffPartnerArea({ code: a.code, category: a.category ?? '' }));
    const effShift = isOffArea ? (offShift ?? s) : s;

    return (
      <span
        className={isOffArea ? 'cell-leave' : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          borderRadius: 4,
          fontSize: 11.5,
          fontWeight: 700,
          background: isOffArea ? (offShift?.background_color ?? s?.background_color ?? '#f8fafc') : (s?.background_color ?? 'var(--surface-muted)'),
          color: isOffArea ? (a?.text_color ?? offShift?.text_color ?? 'var(--text)') : (s?.text_color ?? 'var(--text)'),
          border: '1px solid var(--border)',
        }}
      >
        {effShift?.code ?? 'Off'}
        {a && <span style={{ opacity: 0.85 }}>· {a.code}</span>}
      </span>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text)' }}>Change Requests &amp; Approvals</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Review, conflict-check, and atomically apply schedule changes proposed by Department Heads outside edit windows.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setActionMsg(null);
            startTransition(() => router.refresh());
          }}
          disabled={isPending}
          title="Refresh requests"
        >
          {isPending ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {actionMsg && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            background: actionMsg.type === 'ok' ? 'var(--ok-bg)' : 'var(--warn-bg)',
            color: actionMsg.type === 'ok' ? 'var(--ok-fg)' : 'var(--warn-fg)',
            border: `1px solid ${actionMsg.type === 'ok' ? 'var(--ok-border)' : 'var(--warn-border)'}`,
          }}
        >
          {actionMsg.text}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setTab('pending')}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            fontSize: 13,
            fontWeight: tab === 'pending' ? 700 : 500,
            cursor: 'pointer',
            background: tab === 'pending' ? 'var(--primary)' : 'transparent',
            color: tab === 'pending' ? 'var(--primary-fg)' : 'var(--text-secondary)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>Pending</span>
          {pendingCount > 0 && (
            <span
              style={{
                background: tab === 'pending' ? 'rgba(255,255,255,0.25)' : '#f59e0b',
                color: '#ffffff',
                borderRadius: 999,
                padding: '1px 6px',
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              {pendingCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab('approved')}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            fontSize: 13,
            fontWeight: tab === 'approved' ? 700 : 500,
            cursor: 'pointer',
            background: tab === 'approved' ? 'var(--primary)' : 'transparent',
            color: tab === 'approved' ? 'var(--primary-fg)' : 'var(--text-secondary)',
          }}
        >
          Approved ({approvedCount})
        </button>
        <button
          type="button"
          onClick={() => setTab('rejected')}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            fontSize: 13,
            fontWeight: tab === 'rejected' ? 700 : 500,
            cursor: 'pointer',
            background: tab === 'rejected' ? 'var(--primary)' : 'transparent',
            color: tab === 'rejected' ? 'var(--primary-fg)' : 'var(--text-secondary)',
          }}
        >
          Rejected ({rejectedCount})
        </button>
        <button
          type="button"
          onClick={() => setTab('all')}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            fontSize: 13,
            fontWeight: tab === 'all' ? 700 : 500,
            cursor: 'pointer',
            background: tab === 'all' ? 'var(--primary)' : 'transparent',
            color: tab === 'all' ? 'var(--primary-fg)' : 'var(--text-secondary)',
          }}
        >
          All ({p.requests.length})
        </button>
      </div>

      {/* Requests List */}
      {filteredRequests.length === 0 ? (
        <div className="card" style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            {tab === 'pending'
              ? 'No pending change requests awaiting approval.'
              : `No ${tab} change requests found.`}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {filteredRequests.map((req) => {
            const items = req.items ?? [];
            const openItems = getOpenItems(req);
            const isOpenRequest = req.status === 'pending' || (req.status === 'partially_approved' && openItems.length > 0);
            const isSelfRequest = req.requester_id === p.currentUserId;
            const canActOnSelf = !isSelfRequest || Boolean(p.isAdmin);
            const isProcessing = processingId === req.id;
            const selected = selectedItems[req.id] ?? new Set();
            const openSelectedCount = Array.from(selected).filter((id) => openItems.some((o) => o.id === id)).length;
            const hasConflicts = items.some((i) => i.status === 'conflict');

            return (
              <div
                key={req.id}
                className="card"
                style={{
                  border: isOpenRequest ? '1px solid var(--accent)' : '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 16,
                  background: 'var(--surface)',
                }}
              >
                {/* Request Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>
                        {req.requester_name || 'Department Head'}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '1px 7px',
                          borderRadius: 999,
                          background: 'var(--surface-muted)',
                          color: 'var(--text-secondary)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {req.requester_role === 'manager' ? 'Department Head' : req.requester_role}
                      </span>
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background:
                            req.status === 'approved'
                              ? 'var(--ok-bg)'
                              : req.status === 'rejected'
                                ? 'var(--warn-bg)'
                                : req.status === 'partially_approved'
                                  ? 'var(--info-bg)'
                                  : 'var(--warn-bg)',
                          color:
                            req.status === 'approved'
                              ? 'var(--ok-fg)'
                              : req.status === 'rejected'
                                ? 'var(--warn-fg)'
                                : req.status === 'partially_approved'
                                  ? 'var(--info-fg)'
                                  : 'var(--warn-fg)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {req.status}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                      Submitted {req.submitted_at ? formatManila(req.submitted_at) : formatManila(req.created_at)}
                      {req.reviewed_at && ` · Reviewed ${formatManila(req.reviewed_at)} by ${req.reviewed_by_name || 'Admin'}`}
                    </div>

                    {req.note && (
                      <div style={{ marginTop: 6, fontSize: 13, background: 'var(--surface-muted)', padding: '6px 10px', borderRadius: 6, fontStyle: 'italic' }}>
                        &ldquo;{req.note}&rdquo;
                      </div>
                    )}

                    {req.review_notes && (
                      <div style={{ marginTop: 6, fontSize: 12.5, color: req.status === 'rejected' ? 'var(--danger)' : 'var(--text-secondary)' }}>
                        <strong>Approver note:</strong> {req.review_notes}
                      </div>
                    )}
                  </div>

                  {/* Approver Actions */}
                  {p.canApprove && isOpenRequest && !canActOnSelf && (
                    <span
                      style={{
                        padding: '5px 10px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        background: 'var(--surface-muted)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      Submitted by you — requires another approver
                    </span>
                  )}

                  {p.canApprove && isOpenRequest && canActOnSelf && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ background: '#16a34a', color: '#ffffff', fontWeight: 700 }}
                        onClick={() => handleApprove(req, false)}
                        disabled={isProcessing}
                        title={isSelfRequest ? 'Explicit admin override to approve your own change request' : undefined}
                      >
                        {isProcessing
                          ? 'Processing…'
                          : isSelfRequest
                            ? `Admin Override & Approve (${openItems.length})`
                            : `Approve All (${openItems.length})`}
                      </button>

                      {openSelectedCount > 0 && openSelectedCount < openItems.length && (
                        <button
                          type="button"
                          className="btn"
                          style={{ background: '#0284c7', color: '#ffffff', fontWeight: 700 }}
                          onClick={() => handleApprove(req, true)}
                          disabled={isProcessing}
                        >
                          Approve Selected ({openSelectedCount})
                        </button>
                      )}

                      {hasConflicts && (
                        <button
                          type="button"
                          className="btn"
                          style={{ background: '#b45309', color: '#ffffff', fontWeight: 700 }}
                          onClick={() => handleApprove(req, false, true)}
                          disabled={isProcessing}
                          title="Apply proposed changes, overriding cells that changed in the live schedule"
                        >
                          Override &amp; Approve
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn"
                        style={{ background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger-border)' }}
                        onClick={() => setRejectDialog({ requestId: req.id, requesterName: req.requester_name || 'Department Head' })}
                        disabled={isProcessing}
                      >
                        Reject…
                      </button>
                    </div>
                  )}
                </div>

                {/* Items Table */}
                <div style={{ overflowX: 'auto', border: '1px solid var(--border-light)', borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
                        {p.canApprove && isOpenRequest && canActOnSelf && (
                          <th style={{ padding: '6px 8px', width: 32 }}>
                            <input
                              type="checkbox"
                              aria-label="Select all open items"
                              checked={openItems.length > 0 && openSelectedCount === openItems.length}
                              onChange={() => toggleAllItemsForRequest(req)}
                            />
                          </th>
                        )}
                        <th style={{ padding: '6px 8px' }}>Category</th>
                        <th style={{ padding: '6px 8px' }}>Operator</th>
                        <th style={{ padding: '6px 8px' }}>Date</th>
                        <th style={{ padding: '6px 8px' }}>Original State</th>
                        <th style={{ padding: '6px 8px' }}>Proposed Change</th>
                        <th style={{ padding: '6px 8px' }}>Status / Conflict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const opName = item.operator_id ? opMap.get(item.operator_id) ?? 'Unknown Operator' : 'N/A';
                        const origShift = item.original_state?.shift_type_id;
                        const origArea = item.original_state?.area_code_id;
                        const isConflict = item.status === 'conflict';
                        const isItemOpen = item.status === 'pending' || item.status === 'conflict';
                        const isSelected = isItemOpen && selected.has(item.id);

                        return (
                          <tr
                            key={item.id}
                            style={{
                              borderBottom: '1px solid var(--border-light)',
                              background: isConflict
                                ? 'var(--warn-bg)'
                                : isSelected
                                  ? 'rgba(59, 130, 246, 0.08)'
                                  : undefined,
                            }}
                          >
                            {p.canApprove && isOpenRequest && canActOnSelf && (
                              <td style={{ padding: '6px 8px' }}>
                                {isItemOpen ? (
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleItemSelection(req.id, item.id)}
                                    aria-label={`Select item for ${opName} on ${item.schedule_date}`}
                                  />
                                ) : null}
                              </td>
                            )}
                            <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                              {item.target_table === 'schedule_assignments' && 'Schedule'}
                              {item.target_table === 'standby_assignments' && 'Standby (OC)'}
                              {item.target_table === 'pm_tasks' && 'PM Task'}
                              {item.target_table === 'leave_records' && 'Leave'}
                            </td>
                            <td style={{ padding: '6px 8px', fontWeight: 700 }}>{opName}</td>
                            <td style={{ padding: '6px 8px' }}>{item.schedule_date ? formatDateOnly(item.schedule_date) : 'N/A'}</td>
                            <td style={{ padding: '6px 8px' }}>
                              {item.target_table === 'schedule_assignments'
                                ? renderShiftBadge(origShift, origArea)
                                : item.target_table === 'standby_assignments'
                                  ? (item.original_state?.standby_type ?? 'None')
                                  : item.target_table === 'pm_tasks'
                                    ? (item.original_state?.title ?? 'None')
                                    : 'None'}
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              {item.action === 'delete' ? (
                                <span style={{ color: 'var(--danger)', fontWeight: 700 }}>Delete assignment</span>
                              ) : item.target_table === 'schedule_assignments' ? (
                                renderShiftBadge(item.shift_type_id, item.area_code_id)
                              ) : item.target_table === 'standby_assignments' ? (
                                <strong>{item.standby_type ?? 'OC'}</strong>
                              ) : item.target_table === 'pm_tasks' ? (
                                <strong>{item.pm_title ?? 'PM Task'} ({item.pm_status ?? 'planned'})</strong>
                              ) : (
                                <strong>{item.leave_code ?? 'Leave'}</strong>
                              )}
                              {item.notes && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Note: {item.notes}</div>}
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              {isConflict ? (
                                <span style={{ color: 'var(--warn-fg)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  ⚠️ Live Conflict
                                </span>
                              ) : item.status === 'approved' ? (
                                <span style={{ color: 'var(--ok-fg)', fontWeight: 700 }}>✓ Approved</span>
                              ) : item.status === 'rejected' ? (
                                <span style={{ color: 'var(--danger)', fontWeight: 700 }}>✗ Rejected</span>
                              ) : (
                                <span style={{ color: 'var(--text-secondary)' }}>Pending</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject Modal Dialog */}
      {rejectDialog && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 440,
              padding: 20,
              borderRadius: 8,
              background: 'var(--surface)',
            }}
          >
            <h2 style={{ fontSize: 17, margin: '0 0 8px' }}>Reject Change Request</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              Provide a reason for rejecting this request from <strong>{rejectDialog.requesterName}</strong>:
            </p>
            <textarea
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
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setRejectDialog(null);
                  setRejectReason('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                style={{ background: '#dc2626', color: '#ffffff', fontWeight: 700 }}
                onClick={handleRejectConfirm}
                disabled={processingId !== null}
              >
                {processingId ? 'Rejecting…' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
