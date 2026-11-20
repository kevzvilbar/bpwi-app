'use client';

import { useState, useTransition } from 'react';
import type { CSSProperties, ReactNode } from 'react';
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
  /** True when the page could not load live data to check for conflicts (the server still checks on approval). */
  liveCheckFailed?: boolean;
};

type Tab = 'pending' | 'approved' | 'rejected' | 'all';
type Msg = { type: 'ok' | 'warn' | 'err'; text: string };
type RejectDialog = { request: ChangeRequest; itemIds: string[] | null; count: number };
type OverrideDialog = { request: ChangeRequest; item: ChangeRequestItem };

const isOpenItem = (i: ChangeRequestItem) => i.status === 'pending' || i.status === 'conflict';
const getOpenItems = (r: ChangeRequest) => (r.items ?? []).filter(isOpenItem);
const hasOpenItems = (r: ChangeRequest) => getOpenItems(r).length > 0;
const isOpenRequest = (r: ChangeRequest) => r.status === 'pending' || (r.status === 'partially_approved' && hasOpenItems(r));
const isClosedApproved = (r: ChangeRequest) => r.status === 'approved' || (r.status === 'partially_approved' && !hasOpenItems(r));

function statusBadge(status: string): CSSProperties {
  const pick = (k: 'ok' | 'info' | 'warn' | 'danger') => ({ background: `var(--${k}-bg)`, color: `var(--${k}-fg)` });
  switch (status) {
    case 'approved':
      return pick('ok');
    case 'partially_approved':
      return pick('info');
    case 'rejected':
      return pick('danger');
    default:
      return pick('warn'); // pending
  }
}

const dash = <span style={{ color: 'var(--text-muted)' }}>—</span>;

export default function ChangeRequests(p: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('pending');
  const [selectedItems, setSelectedItems] = useState<Record<string, Set<string>>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<Msg | null>(null);
  const [rejectDialog, setRejectDialog] = useState<RejectDialog | null>(null);
  const [overrideDialog, setOverrideDialog] = useState<OverrideDialog | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isPending, startTransition] = useTransition();
  const busy = processingId !== null;

  const opMap = new Map(p.operators.map((o) => [o.id, o.full_name]));
  const shiftMap = new Map(p.shifts.map((s) => [s.id, s]));
  const areaMap = new Map(p.areas.map((a) => [a.id, a]));
  const offShift = findOffShift(p.shifts.map((s) => ({ ...s, is_off: Boolean(s.is_off) })));

  const counts = {
    pending: p.requests.filter(isOpenRequest).length,
    approved: p.requests.filter(isClosedApproved).length,
    rejected: p.requests.filter((r) => r.status === 'rejected').length,
    all: p.requests.length,
  };
  const filteredRequests = p.requests.filter((r) =>
    tab === 'pending' ? isOpenRequest(r) : tab === 'approved' ? isClosedApproved(r) : tab === 'rejected' ? r.status === 'rejected' : true,
  );
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'pending', label: 'Pending', count: counts.pending },
    { id: 'approved', label: 'Approved & partial', count: counts.approved },
    { id: 'rejected', label: 'Rejected', count: counts.rejected },
    { id: 'all', label: 'All', count: counts.all },
  ];

  function toggleItemSelection(requestId: string, itemId: string) {
    setSelectedItems((prev) => {
      const current = new Set(prev[requestId] ?? []);
      if (current.has(itemId)) current.delete(itemId);
      else current.add(itemId);
      return { ...prev, [requestId]: current };
    });
  }

  function toggleAllItemsForRequest(request: ChangeRequest) {
    const open = getOpenItems(request);
    setSelectedItems((prev) => {
      const current = prev[request.id] ?? new Set<string>();
      const all = current.size === open.length && open.length > 0;
      return { ...prev, [request.id]: all ? new Set<string>() : new Set(open.map((i) => i.id)) };
    });
  }

  /**
   * One entry point for every review action. Always sends explicit item ids, so a stale screen can never
   * approve more than what the approver saw: `approveIds` are applied, `rejectIds` are rejected, nothing else moves.
   */
  async function runReview(
    request: ChangeRequest,
    opts: { approveIds?: string[]; rejectIds?: string[]; force?: boolean; note?: string | null },
  ): Promise<boolean> {
    if (busy) return false;
    setProcessingId(request.id);
    setActionMsg(null);
    const approveIds = opts.approveIds ?? [];
    const allowSelfOverride = request.requester_id === p.currentUserId && Boolean(p.isAdmin);
    const note =
      [allowSelfOverride && approveIds.length > 0 ? 'Admin self-override' : null, opts.note?.trim() || null].filter(Boolean).join(' — ') || null;
    let ok = false;

    try {
      const { data, error } = await supabaseBrowser().rpc('approve_change_request', {
        p_request_id: request.id,
        p_item_ids: approveIds,
        p_reject_item_ids: opts.rejectIds?.length ? opts.rejectIds : null,
        p_review_notes: note,
        p_force_conflicts: Boolean(opts.force),
        p_allow_self_override: allowSelfOverride,
      });

      if (error) {
        setActionMsg({ type: 'err', text: `Review failed: ${error.message}` });
      } else {
        const res = data as { approved_count?: number; rejected_count?: number; conflict_count?: number } | null;
        const a = res?.approved_count ?? 0;
        const r = res?.rejected_count ?? 0;
        const c = res?.conflict_count ?? 0;
        const parts = [
          a > 0 ? `${a} applied` : null,
          r > 0 ? `${r} rejected` : null,
          c > 0 ? `${c} skipped: changed since proposed (see ⚠️ rows)` : null,
        ].filter(Boolean);
        setActionMsg({ type: c > 0 ? 'warn' : 'ok', text: parts.length ? parts.join(' · ') : 'Nothing was changed.' });
        setSelectedItems((prev) => ({ ...prev, [request.id]: new Set<string>() }));
        ok = true;
        startTransition(() => router.refresh());
      }
    } catch (err: unknown) {
      setActionMsg({ type: 'err', text: getErrorMessage(err, 'Network error during review') });
    } finally {
      setProcessingId(null);
    }
    return ok;
  }

  async function handleRejectConfirm() {
    if (!rejectDialog || busy) return;
    const { request, itemIds } = rejectDialog;
    const reason = rejectReason.trim() || 'Rejected by approver';
    let ok = false;

    if (itemIds) {
      ok = await runReview(request, { approveIds: [], rejectIds: itemIds, note: reason });
    } else {
      setProcessingId(request.id);
      setActionMsg(null);
      try {
        const { error } = await supabaseBrowser().rpc('reject_change_request', { p_request_id: request.id, p_reason: reason });
        if (error) {
          setActionMsg({ type: 'err', text: `Rejection failed: ${error.message}` });
        } else {
          setActionMsg({ type: 'ok', text: 'Remaining items rejected.' });
          ok = true;
          startTransition(() => router.refresh());
        }
      } catch (err: unknown) {
        setActionMsg({ type: 'err', text: getErrorMessage(err, 'Network error during rejection') });
      } finally {
        setProcessingId(null);
      }
    }
    if (ok) {
      setRejectDialog(null);
      setRejectReason('');
    }
  }

  async function handleOverrideConfirm() {
    if (!overrideDialog || busy) return;
    const { request, item } = overrideDialog;
    const ok = await runReview(request, { approveIds: [item.id], force: true, note: notes[request.id] });
    if (ok) setOverrideDialog(null);
  }

  // ---------- renderers ----------

  function renderShiftBadge(shiftId: string | null | undefined, areaId: string | null | undefined, emptyLabel = 'Off / Cleared') {
    if (!shiftId && !areaId) return <span style={{ color: 'var(--text-muted)' }}>{emptyLabel}</span>;
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

  const names = (ids?: string[] | null) => (ids && ids.length ? ids.map((id) => opMap.get(id) ?? 'Unknown').join(', ') : null);
  const range = (start?: string | null, end?: string | null) =>
    start ? (end && end !== start ? `${formatDateOnly(start)} – ${formatDateOnly(end)}` : formatDateOnly(start)) : null;

  type Snap = {
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

  /** Renders a state snapshot (original or live) for any target table. */
  function renderSnapshot(item: ChangeRequestItem, s: Snap | null | undefined, emptyLabel: string): ReactNode {
    if (item.target_table === 'schedule_assignments') return renderShiftBadge(s?.shift_type_id, s?.area_code_id, emptyLabel);
    if (item.target_table === 'standby_assignments') return s?.standby_type ? <strong>{s.standby_type}</strong> : <span style={{ color: 'var(--text-muted)' }}>{emptyLabel}</span>;
    if (!s || Object.keys(s).length === 0) return dash;
    if (item.target_table === 'pm_tasks') {
      const who = names(s.assigned_operator_ids);
      return (
        <div>
          <strong>{s.title ?? 'PM Task'}</strong>
          {s.status ? ` (${s.status})` : ''}
          {s.scheduled_date && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatDateOnly(s.scheduled_date)}</div>}
          {who && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Assigned: {who}</div>}
        </div>
      );
    }
    return (
      <div>
        <strong>{s.leave_code ?? 'Leave'}</strong>
        {range(s.start_date, s.end_date) && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{range(s.start_date, s.end_date)}</div>}
      </div>
    );
  }

  function renderProposed(item: ChangeRequestItem): ReactNode {
    if (item.action === 'delete') return <span style={{ color: 'var(--danger)', fontWeight: 700 }}>Delete{item.target_table === 'schedule_assignments' ? ' assignment' : ''}</span>;
    return renderSnapshot(
      item,
      {
        shift_type_id: item.shift_type_id,
        area_code_id: item.area_code_id,
        standby_type: item.standby_type ?? 'OC',
        title: item.pm_title ?? 'PM Task',
        status: item.pm_status ?? 'planned',
        scheduled_date: item.schedule_date,
        assigned_operator_ids: item.pm_assigned_operator_ids,
        leave_code: item.leave_code ?? 'Leave',
        start_date: item.leave_start_date ?? item.schedule_date,
        end_date: item.leave_end_date ?? item.schedule_date,
      },
      'Off / Cleared',
    );
  }

  const categoryLabel = (t: ChangeRequestItem['target_table']) =>
    t === 'schedule_assignments' ? 'Schedule' : t === 'standby_assignments' ? 'Standby (OC)' : t === 'pm_tasks' ? 'PM Task' : 'Leave';

  function renderDate(item: ChangeRequestItem) {
    if (item.target_table === 'leave_records') return range(item.leave_start_date ?? item.schedule_date, item.leave_end_date ?? item.schedule_date) ?? 'N/A';
    return item.schedule_date ? formatDateOnly(item.schedule_date) : 'N/A';
  }

  function renderLive(item: ChangeRequestItem): ReactNode {
    if (item.conflict_reason === 'target_missing') return <span style={{ color: 'var(--danger)', fontWeight: 700 }}>Deleted</span>;
    return renderSnapshot(item, item.live_state as Snap | null, 'Empty cell');
  }

  const dlgText: CSSProperties = { fontSize: 13, color: 'var(--text-secondary)', margin: 0 };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text)' }}>Change Requests &amp; Approvals</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Review, conflict-check, and apply schedule changes proposed by Department Heads outside edit windows.
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

      {p.liveCheckFailed && (
        <div role="status" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12.5, background: 'var(--warn-bg)', color: 'var(--warn-fg)', border: '1px solid var(--warn-border)' }}>
          Live conflict check is unavailable right now, so conflicts are not highlighted here. The server still checks every item when you approve.
        </div>
      )}

      {actionMsg && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            background: actionMsg.type === 'ok' ? 'var(--ok-bg)' : actionMsg.type === 'warn' ? 'var(--warn-bg)' : 'var(--danger-bg)',
            color: actionMsg.type === 'ok' ? 'var(--ok-fg)' : actionMsg.type === 'warn' ? 'var(--warn-fg)' : 'var(--danger-fg)',
            border: `1px solid ${actionMsg.type === 'ok' ? 'var(--ok-border)' : actionMsg.type === 'warn' ? 'var(--warn-border)' : 'var(--danger-border)'}`,
          }}
        >
          {actionMsg.text}
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              fontSize: 13,
              fontWeight: tab === t.id ? 700 : 500,
              cursor: 'pointer',
              background: tab === t.id ? 'var(--primary)' : 'transparent',
              color: tab === t.id ? 'var(--primary-fg)' : 'var(--text-secondary)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {t.label}
            {t.id === 'pending' && t.count > 0 ? (
              <span style={{ background: tab === 'pending' ? 'rgba(255,255,255,0.25)' : '#f59e0b', color: '#ffffff', borderRadius: 999, padding: '1px 6px', fontSize: 11, fontWeight: 800 }}>
                {t.count}
              </span>
            ) : (
              <span style={{ opacity: 0.8 }}>({t.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Requests List */}
      {filteredRequests.length === 0 ? (
        <div className="card" style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <p style={{ margin: 0, fontSize: 14 }}>{tab === 'pending' ? 'No pending change requests awaiting approval.' : `No ${tab} change requests found.`}</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {filteredRequests.map((req) => {
            const items = req.items ?? [];
            const openItems = getOpenItems(req);
            const open = isOpenRequest(req);
            const isSelfRequest = req.requester_id === p.currentUserId;
            const canActOnSelf = !isSelfRequest || Boolean(p.isAdmin);
            const canAct = p.canApprove && open && canActOnSelf;
            const isProcessing = processingId === req.id;
            const selected = selectedItems[req.id] ?? new Set<string>();
            const selectedOpenIds = openItems.filter((i) => selected.has(i.id)).map((i) => i.id);
            const conflictCount = openItems.filter((i) => i.status === 'conflict').length;
            const approvable = openItems.filter((i) => i.status !== 'conflict');
            const approvedN = items.filter((i) => i.status === 'approved').length;
            const rejectedN = items.filter((i) => i.status === 'rejected').length;

            return (
              <div
                key={req.id}
                className="card"
                style={{ border: open ? '1px solid var(--accent)' : '1px solid var(--border)', borderRadius: 8, padding: 16, background: 'var(--surface)' }}
              >
                {/* Request Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{req.requester_name || 'Department Head'}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: 'var(--surface-muted)', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                        {req.requester_role === 'manager' ? 'Department Head' : req.requester_role}
                      </span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase', ...statusBadge(req.status) }}>
                        {req.status.replace('_', ' ')}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                      Submitted {req.submitted_at ? formatManila(req.submitted_at) : formatManila(req.created_at)}
                      {req.reviewed_at && ` · Last reviewed ${formatManila(req.reviewed_at)} by ${req.reviewed_by_name || 'Admin'}`}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {items.length} item{items.length === 1 ? '' : 's'}: {approvedN} approved · {rejectedN} rejected · {openItems.length} open
                      {conflictCount > 0 && <strong style={{ color: 'var(--warn-fg)' }}> · {conflictCount} in conflict</strong>}
                    </div>

                    {req.note && (
                      <div style={{ marginTop: 6, fontSize: 13, background: 'var(--surface-muted)', padding: '6px 10px', borderRadius: 6, fontStyle: 'italic' }}>
                        &ldquo;{req.note}&rdquo;
                      </div>
                    )}

                    {req.review_notes && (
                      <div style={{ marginTop: 6, fontSize: 12.5, whiteSpace: 'pre-line', color: req.status === 'rejected' ? 'var(--danger)' : 'var(--text-secondary)' }}>
                        <strong>Approver notes:</strong> {req.review_notes}
                      </div>
                    )}
                  </div>

                  {p.canApprove && open && !canActOnSelf && (
                    <span style={{ padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'var(--surface-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                      Submitted by you — requires another approver
                    </span>
                  )}

                  {canAct && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {approvable.length > 0 && (
                        <button
                          type="button"
                          className="btn"
                          style={{ background: '#16a34a', color: '#ffffff', fontWeight: 700 }}
                          onClick={() => runReview(req, { approveIds: approvable.map((i) => i.id), note: notes[req.id] })}
                          disabled={busy}
                          title={isSelfRequest ? 'Explicit admin override to approve your own change request' : conflictCount > 0 ? 'Items in conflict are left open for individual review' : undefined}
                        >
                          {isProcessing ? 'Processing…' : `${isSelfRequest ? 'Admin override: approve' : 'Approve'} ${conflictCount > 0 ? 'non-conflicting' : 'all'} (${approvable.length})`}
                        </button>
                      )}

                      {selectedOpenIds.length > 0 && (
                        <>
                          <button
                            type="button"
                            className="btn"
                            style={{ background: '#0284c7', color: '#ffffff', fontWeight: 700 }}
                            onClick={() => runReview(req, { approveIds: selectedOpenIds, note: notes[req.id] })}
                            disabled={busy}
                          >
                            Approve selected ({selectedOpenIds.length})
                          </button>
                          <button
                            type="button"
                            className="btn"
                            style={{ background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger-border)' }}
                            onClick={() => setRejectDialog({ request: req, itemIds: selectedOpenIds, count: selectedOpenIds.length })}
                            disabled={busy}
                          >
                            Reject selected ({selectedOpenIds.length})…
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        className="btn"
                        style={{ background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger-border)' }}
                        onClick={() => setRejectDialog({ request: req, itemIds: null, count: openItems.length })}
                        disabled={busy}
                      >
                        {req.status === 'partially_approved' ? 'Reject remaining' : 'Reject all'} ({openItems.length})…
                      </button>
                    </div>
                  )}
                </div>

                {canAct && (
                  <input
                    type="text"
                    aria-label="Approver note (optional)"
                    placeholder="Note for the requester (optional) — saved with this review"
                    value={notes[req.id] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
                    maxLength={300}
                    style={{ width: '100%', boxSizing: 'border-box', marginBottom: 12, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
                  />
                )}

                {/* Items Table */}
                <div style={{ overflowX: 'auto', border: '1px solid var(--border-light)', borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
                        {canAct && (
                          <th style={{ padding: '6px 8px', width: 32 }}>
                            <input
                              type="checkbox"
                              aria-label="Select all open items"
                              checked={openItems.length > 0 && selectedOpenIds.length === openItems.length}
                              onChange={() => toggleAllItemsForRequest(req)}
                            />
                          </th>
                        )}
                        <th style={{ padding: '6px 8px' }}>Category</th>
                        <th style={{ padding: '6px 8px' }}>Operator</th>
                        <th style={{ padding: '6px 8px' }}>Date</th>
                        <th style={{ padding: '6px 8px' }}>When proposed</th>
                        <th style={{ padding: '6px 8px' }}>Proposed change</th>
                        <th style={{ padding: '6px 8px' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const opName = item.operator_id ? (opMap.get(item.operator_id) ?? 'Unknown Operator') : item.target_table === 'pm_tasks' ? 'See assignees' : 'N/A';
                        const isConflict = item.status === 'conflict';
                        const isItemOpen = isOpenItem(item);
                        const isSelected = isItemOpen && selected.has(item.id);

                        return (
                          <tr
                            key={item.id}
                            style={{
                              borderBottom: '1px solid var(--border-light)',
                              verticalAlign: 'top',
                              background: isConflict ? 'var(--warn-bg)' : isSelected ? 'rgba(59, 130, 246, 0.08)' : undefined,
                            }}
                          >
                            {canAct && (
                              <td style={{ padding: '6px 8px' }}>
                                {isItemOpen ? (
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleItemSelection(req.id, item.id)}
                                    aria-label={`Select item for ${opName} on ${item.schedule_date ?? 'n/a'}`}
                                  />
                                ) : null}
                              </td>
                            )}
                            <td style={{ padding: '6px 8px', fontWeight: 600 }}>{categoryLabel(item.target_table)}</td>
                            <td style={{ padding: '6px 8px', fontWeight: 700 }}>{opName}</td>
                            <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{renderDate(item)}</td>
                            <td style={{ padding: '6px 8px' }}>{renderSnapshot(item, item.original_state as Snap | null, 'Empty cell')}</td>
                            <td style={{ padding: '6px 8px' }}>
                              {renderProposed(item)}
                              {item.notes && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Note: {item.notes}</div>}
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              {isConflict ? (
                                <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
                                  <span style={{ color: 'var(--warn-fg)', fontWeight: 700 }}>
                                    ⚠️ {item.conflict_reason === 'target_missing' ? 'Target no longer exists' : item.conflict_reason === 'changed' ? 'Changed since proposed' : 'Conflict flagged'}
                                  </span>
                                  {item.conflict_reason && <span style={{ fontSize: 11.5 }}>Now: {renderLive(item)}</span>}
                                  {canAct && (
                                    <button type="button" className="btn" style={{ fontSize: 11.5, padding: '2px 8px' }} disabled={busy} onClick={() => setOverrideDialog({ request: req, item })}>
                                      {item.conflict_reason === 'target_missing' ? 'Discard…' : 'Review & override…'}
                                    </button>
                                  )}
                                </div>
                              ) : item.status === 'approved' ? (
                                <span style={{ color: 'var(--ok-fg)', fontWeight: 700 }}>✓ Approved</span>
                              ) : item.status === 'rejected' ? (
                                <div>
                                  <span style={{ color: 'var(--danger)', fontWeight: 700 }}>✗ Rejected</span>
                                  {item.rejection_reason && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{item.rejection_reason}</div>}
                                </div>
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

      {/* Reject dialog (shared .modal-overlay so Escape / focus trap / focus return come from DialogA11y) */}
      {rejectDialog && (
        <div
          className="no-print modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-dialog-title"
          onClick={() => {
            if (!busy) {
              setRejectDialog(null);
              setRejectReason('');
            }
          }}
        >
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, display: 'grid', gap: 12 }}>
            <h2 id="reject-dialog-title" style={{ fontSize: 17, margin: 0 }}>
              {rejectDialog.itemIds ? `Reject ${rejectDialog.count} selected item${rejectDialog.count === 1 ? '' : 's'}` : `Reject ${rejectDialog.count} open item${rejectDialog.count === 1 ? '' : 's'}`}
            </h2>
            <p style={dlgText}>
              From <strong>{rejectDialog.request.requester_name || 'Department Head'}</strong>. Items that were already approved stay applied
              {rejectDialog.itemIds ? '; other open items stay open.' : '.'}
            </p>
            <textarea
              aria-label="Reason for rejection"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, minHeight: 80, resize: 'vertical', boxSizing: 'border-box' }}
              placeholder="e.g. Schedule already locked for payroll; please revise weekend shifts."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setRejectDialog(null);
                  setRejectReason('');
                }}
              >
                Cancel
              </button>
              <button type="button" className="btn" style={{ background: '#dc2626', color: '#ffffff', fontWeight: 700 }} onClick={handleRejectConfirm} disabled={busy}>
                {busy ? 'Rejecting…' : 'Confirm rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Override dialog: shows exactly what would be replaced before anything is forced */}
      {overrideDialog && (
        <div className="no-print modal-overlay" role="dialog" aria-modal="true" aria-labelledby="override-dialog-title" onClick={() => !busy && setOverrideDialog(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, display: 'grid', gap: 12 }}>
            {(() => {
              const { item } = overrideDialog;
              const missing = item.conflict_reason === 'target_missing';
              const row = (label: string, body: ReactNode) => (
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 8, alignItems: 'start', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <span>{body}</span>
                </div>
              );
              return (
                <>
                  <h2 id="override-dialog-title" style={{ fontSize: 17, margin: 0 }}>
                    {missing ? 'Discard this item?' : 'Override live change?'}
                  </h2>
                  <p style={dlgText}>
                    <strong>{categoryLabel(item.target_table)}</strong> · {item.operator_id ? (opMap.get(item.operator_id) ?? 'Unknown Operator') : 'PM task'} · {renderDate(item)}
                  </p>
                  {row('When proposed', renderSnapshot(item, item.original_state as Snap | null, 'Empty cell'))}
                  {row('Now (live)', renderLive(item))}
                  {row(missing ? 'Requested' : 'Will be applied', renderProposed(item))}
                  <p style={dlgText}>
                    {missing
                      ? 'The original record was deleted after this was proposed, and a deleted record cannot be recreated by approval. Confirming rejects this item and records the reason.'
                      : 'The live value above was changed after this was proposed. Confirming replaces it with the requested change.'}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" className="btn" disabled={busy} onClick={() => setOverrideDialog(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn" style={{ background: '#b45309', color: '#ffffff', fontWeight: 700 }} disabled={busy} onClick={handleOverrideConfirm}>
                      {busy ? 'Working…' : missing ? 'Discard item' : 'Override & apply'}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
