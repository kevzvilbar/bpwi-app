'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_TYPES,
  parse12DigitAccount,
  type ActivityCategory,
  type JobOrderRow,
} from '@/lib/activity-types';
import {
  computeJobOrderSlaStatus,
  computeSlaDeadlineManilaLocal,
  findJobOrderSlaByActivityType,
  formatSlaDurationLabel,
  JOB_ORDER_SLA_BY_ID,
  JOB_ORDER_SLA_STANDARDS,
} from '@/lib/job-order-sla';
import { JOB_ORDER_COLUMNS } from '@/lib/query-columns';
import { Badge, EmptyState, SegmentedTabs } from '@/components/ui';
import { SampleBadge } from '@/components/SampleBadge';
import { canEditLogRow } from '@/lib/sample-logs';

type JoOp = { id: string; full_name: string };
type JoArea = { id: string; code: string; name: string | null };

function fmtDateTimeManila(iso: string | null | undefined) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(dt);
}

interface JobOrdersTabProps {
  orgId: string;
  userId: string;
  canManageJo: boolean;
  canLogActivity: boolean;
  canLogSample?: boolean;
  /** Viewer role; department heads ('manager') may change sample job orders only. */
  role?: string;
  joFilter: 'open' | 'completed' | 'all';
  onChangeJoFilter: (f: 'open' | 'completed' | 'all') => void;
  filteredJobOrders: JobOrderRow[];
  operators: JoOp[];
  stationAreas: JoArea[];
  opBy: Map<string, JoOp>;
  areaBy: Map<string, JoArea>;
  onJobOrderCreated: (jo: JobOrderRow) => void;
  onJobOrderUpdated: (jo: JobOrderRow) => void;
  onFulfillJobOrder: (jo: JobOrderRow) => void;
  onPrintJobOrder: (jo: JobOrderRow) => void;
  onBannerMsg: (msg: string) => void;
}

export default function JobOrdersTab({
  orgId,
  userId,
  canManageJo,
  canLogActivity,
  canLogSample = false,
  role,
  joFilter,
  onChangeJoFilter,
  filteredJobOrders,
  operators,
  stationAreas,
  opBy,
  areaBy,
  onJobOrderCreated,
  onJobOrderUpdated,
  onFulfillJobOrder,
  onPrintJobOrder,
  onBannerMsg,
}: JobOrdersTabProps) {
  const [joModalOpen, setJoModalOpen] = useState(false);
  const [joSlaId, setJoSlaId] = useState('leakage');
  const [joTitle, setJoTitle] = useState('');
  const [joActivityType, setJoActivityType] = useState('leak_repair');
  const [joPriority, setJoPriority] = useState<'low' | 'medium' | 'high'>('high');
  const [joAreaId, setJoAreaId] = useState('');
  const [joSite, setJoSite] = useState('');
  const [joBlockLot, setJoBlockLot] = useState('');
  const [joAccountNo, setJoAccountNo] = useState('');
  const [joAccountName, setJoAccountName] = useState('');
  const [joDesc, setJoDesc] = useState('');
  const [joDeadline, setJoDeadline] = useState('');
  const [joEstHours, setJoEstHours] = useState('24');
  const [joAssignedOps, setJoAssignedOps] = useState<string[]>([]);
  const [joIsSample, setJoIsSample] = useState(false);
  const [savingJo, setSavingJo] = useState(false);
  const [overdueModalJo, setOverdueModalJo] = useState<JobOrderRow | null>(null);
  const [overdueReason, setOverdueReason] = useState('');
  const [completingJo, setCompletingJo] = useState(false);

  function applySlaPreset(slaId: string) {
    setJoSlaId(slaId);
    if (slaId === 'custom') return;
    const def = JOB_ORDER_SLA_BY_ID[slaId];
    if (!def) return;
    setJoActivityType(def.activityType);
    setJoPriority(def.defaultPriority);
    setJoEstHours(String(def.slaHours));
    setJoDeadline(computeSlaDeadlineManilaLocal(def.slaHours));
  }

  function openDispatchModal() {
    setJoTitle('');
    setJoAreaId('');
    setJoSite('');
    setJoBlockLot('');
    setJoAccountNo('');
    setJoAccountName('');
    setJoDesc('');
    setJoAssignedOps([]);
    setJoIsSample(false);
    applySlaPreset('leakage');
    setJoModalOpen(true);
  }

  async function handleCreateJobOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!joTitle.trim()) return;
    setSavingJo(true);
    const parsedAcct = parse12DigitAccount(joAccountNo);

    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('job_orders')
      .insert({
        organization_id: orgId,
        jo_number: 'AUTO',
        title: joTitle.trim(),
        activity_type: joActivityType || null,
        priority: joPriority,
        area_code_id: joAreaId || null,
        site_or_well: joSite.trim() || (parsedAcct ? `Phase ${parsedAcct.phaseCode}` : null),
        block_lot: joBlockLot.trim() || parsedAcct?.blockLotFormatted || null,
        account_number: joAccountNo.trim() || null,
        account_name: joAccountName.trim() || null,
        contact_number: null,
        description: joDesc.trim() || null,
        assigned_operator_ids: joAssignedOps,
        deadline: joDeadline ? new Date(`${joDeadline}:00+08:00`).toISOString() : null,
        estimated_hours: Number(joEstHours) || 24,
        status: 'pending',
        created_by: userId,
        is_sample: canLogSample ? joIsSample : false,
      })
      .select(JOB_ORDER_COLUMNS)
      .single();

    setSavingJo(false);
    if (error) {
      onBannerMsg(`Job order error: ${error.message}`);
      return;
    }
    const created = data as unknown as JobOrderRow;
    onJobOrderCreated(created);
    setJoModalOpen(false);
    onBannerMsg(`✓ Dispatched ${created.jo_number}.`);
  }

  async function updateJobOrderStatus(
    jo: JobOrderRow,
    nextStatus: JobOrderRow['status'],
    tatJustification?: string | null,
  ) {
    if (!canEditLogRow(role, jo)) {
      onBannerMsg('Department heads can only change sample job orders; real job orders are read-only.');
      return;
    }
    const sb = supabaseBrowser();
    const updates: Record<string, unknown> = {
      status: nextStatus,
      completed_at: nextStatus === 'completed' ? new Date().toISOString() : null,
      ...(tatJustification !== undefined ? { tat_justification: tatJustification } : {}),
    };
    const { data, error } = await sb
      .from('job_orders')
      .update(updates)
      .eq('id', jo.id)
      .select(JOB_ORDER_COLUMNS)
      .single();
    if (error) {
      onBannerMsg(`Update failed: ${error.message}`);
      return;
    }
    onJobOrderUpdated(data as unknown as JobOrderRow);
  }

  async function confirmOverdueCompletion(e: React.FormEvent) {
    e.preventDefault();
    if (!overdueModalJo) return;
    setCompletingJo(true);
    await updateJobOrderStatus(overdueModalJo, 'completed', overdueReason.trim() || null);
    setCompletingJo(false);
    setOverdueModalJo(null);
    setOverdueReason('');
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <SegmentedTabs
          ariaLabel="Job order filter"
          size="sm"
          value={joFilter}
          onChange={onChangeJoFilter}
          items={[
            { id: 'open', label: 'Open' },
            { id: 'completed', label: 'Completed' },
            { id: 'all', label: 'All' },
          ]}
        />
        {canManageJo && (
          <button type="button" className="btn btn-primary" onClick={openDispatchModal} style={{ fontWeight: 700 }}>
            + Dispatch Job Order
          </button>
        )}
      </div>

      {filteredJobOrders.length === 0 ? (
        <EmptyState minHeight={180} title="No job orders in this filter." description="Switch filters or dispatch a new job order above." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 12 }}>
          {filteredJobOrders.map((jo) => {
            const area = jo.area_code_id ? areaBy.get(jo.area_code_id) : undefined;
            const crew = (jo.assigned_operator_ids ?? []).map((id) => opBy.get(id)?.full_name).filter(Boolean);
            const slaStatus = computeJobOrderSlaStatus(jo);
            const matchedSla = findJobOrderSlaByActivityType(jo.activity_type);
            const slaTargetText = formatSlaDurationLabel(jo.estimated_hours ?? matchedSla?.slaHours ?? null);
            const badgeTone =
              slaStatus.state === 'met'
                ? 'ok'
                : slaStatus.state === 'breached_open' || slaStatus.state === 'breached_closed'
                  ? 'danger'
                  : slaStatus.state === 'at_risk'
                    ? 'warn'
                    : jo.status === 'completed'
                      ? 'ok'
                      : 'neutral';
            const slaDetailColor =
              slaStatus.isOverdue
                ? 'var(--danger)'
                : slaStatus.state === 'at_risk'
                  ? 'var(--warn-fg)'
                  : slaStatus.state === 'met'
                    ? 'var(--ok-fg)'
                    : 'var(--text-secondary)';
            const tatHours =
              jo.completed_at && jo.created_at
                ? ((new Date(jo.completed_at).getTime() - new Date(jo.created_at).getTime()) / (1000 * 60 * 60)).toFixed(1)
                : null;
            const canEditThisJo = canEditLogRow(role, jo);
            const canCompleteJo = canEditThisJo && (canManageJo || canLogActivity) && (jo.status === 'pending' || jo.status === 'in_progress');

            return (
              <div
                key={jo.id}
                className="card"
                style={{
                  padding: 14,
                  display: 'grid',
                  gap: 8,
                  borderLeft: `4px solid ${jo.priority === 'high' ? 'var(--danger)' : jo.priority === 'medium' ? 'var(--warn-fg)' : 'var(--accent)'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 13.5 }}>{jo.jo_number}</strong>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {jo.is_sample && <SampleBadge expiresAt={jo.sample_expires_at} />}
                    <Badge size="sm" tone={jo.priority === 'high' ? 'danger' : jo.priority === 'medium' ? 'warn' : 'info'}>
                      {jo.priority.toUpperCase()}
                    </Badge>
                    <Badge size="sm" tone={badgeTone}>
                      {slaStatus.badgeLabel}
                    </Badge>
                  </div>
                </div>

                <div style={{ fontSize: 14.5, fontWeight: 700 }}>{jo.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {area ? `${area.code}${area.name ? ` · ${area.name}` : ''}` : 'General'}
                  {jo.site_or_well ? ` · ${jo.site_or_well}` : ''}
                  {jo.block_lot ? ` · ${jo.block_lot}` : ''}
                </div>
                {(jo.account_number || jo.account_name) && (
                  <div style={{ fontSize: 12 }}>
                    Customer: <b>{[jo.account_number, jo.account_name].filter(Boolean).join(' · ')}</b>
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Assigned: <b>{crew.length > 0 ? crew.join(', ') : 'Unassigned'}</b>
                </div>
                {jo.description && <div style={{ fontSize: 12.5 }}>{jo.description}</div>}
                {jo.tat_justification && (
                  <div style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>
                    <b>TAT Justification:</b> {jo.tat_justification}
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', display: 'grid', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <span>SLA Target: <b>{slaTargetText}</b></span>
                    <span style={{ color: slaDetailColor, fontWeight: 700 }}>{slaStatus.detailLabel}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <span>Deadline: {jo.deadline ? fmtDateTimeManila(jo.deadline) : 'None'}</span>
                    {tatHours && <span>Actual TAT: <b>{tatHours} hrs</b></span>}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--border-light)', paddingTop: 8 }}>
                  {canLogActivity && (jo.status === 'pending' || jo.status === 'in_progress') && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => onFulfillJobOrder(jo)}
                      style={{ fontSize: 12, fontWeight: 700 }}
                    >
                      Fulfill &amp; Log Activity
                    </button>
                  )}
                  {jo.status === 'pending' && canEditThisJo && (
                    <button type="button" className="btn" onClick={() => void updateJobOrderStatus(jo, 'in_progress')} style={{ fontSize: 12 }}>
                      Start Work
                    </button>
                  )}
                  {canCompleteJo && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (slaStatus.isOverdue) {
                          setOverdueReason('');
                          setOverdueModalJo(jo);
                        } else {
                          void updateJobOrderStatus(jo, 'completed');
                        }
                      }}
                      style={{ fontSize: 12, color: 'var(--ok-fg)', borderColor: 'var(--ok-border)' }}
                    >
                      ✓ Complete JO
                    </button>
                  )}
                  <button type="button" className="btn" onClick={() => onPrintJobOrder(jo)} style={{ fontSize: 12 }}>
                    🖨 Print JO
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Overdue SLA TAT Justification Prompt */}
      {overdueModalJo && (
        <div className="modal-overlay no-print" role="dialog" aria-modal="true" onClick={() => !completingJo && setOverdueModalJo(null)}>
          <form className="modal-sheet" onClick={(e) => e.stopPropagation()} onSubmit={confirmOverdueCompletion} style={{ maxWidth: 440, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>Complete Past-SLA Job Order</h2>
              <button type="button" className="btn" onClick={() => setOverdueModalJo(null)} disabled={completingJo}>✕</button>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--warn-fg)', background: 'var(--warn-bg)', padding: '8px 10px', borderRadius: 6 }}>
              <b>{overdueModalJo.jo_number}</b> passed its SLA deadline ({fmtDateTimeManila(overdueModalJo.deadline)}). Add a turnaround delay justification if applicable.
            </p>
            <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
              TAT Delay Justification (optional)
              <textarea
                className="input"
                rows={3}
                value={overdueReason}
                onChange={(e) => setOverdueReason(e.target.value)}
                placeholder="e.g. Awaited customer gate access / spare valve delivery…"
                style={{ minHeight: 72 }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setOverdueModalJo(null)} disabled={completingJo}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={completingJo}>
                {completingJo ? 'Completing…' : 'Mark Completed'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Dispatch Job Order Modal */}
      {joModalOpen && (() => {
        const activeSla = joSlaId !== 'custom' ? JOB_ORDER_SLA_BY_ID[joSlaId] : null;
        return (
        <div className="modal-overlay no-print" role="dialog" aria-modal="true" onClick={() => !savingJo && setJoModalOpen(false)}>
          <form className="modal-sheet" onClick={(e) => e.stopPropagation()} onSubmit={handleCreateJobOrder} style={{ maxWidth: 580, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 17 }}>Dispatch Field Job Order</h2>
              <button type="button" className="btn" onClick={() => setJoModalOpen(false)}>✕</button>
            </div>
            <label style={{ display: 'grid', gap: 3, fontSize: 12.5, fontWeight: 600 }}>
              Job Order Task / SLA Standard
              <select className="input" value={joSlaId} onChange={(e) => applySlaPreset(e.target.value)}>
                {JOB_ORDER_SLA_STANDARDS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} — {formatSlaDurationLabel(s.slaHours)}
                  </option>
                ))}
                <option value="custom">Other / Custom Task</option>
              </select>
            </label>
            {activeSla && (
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', padding: '6px 9px', borderRadius: 6, background: 'var(--surface-muted)', border: '1px solid var(--border-light)' }}>
                Standard SLA: <b>{activeSla.label}</b> — {activeSla.description} (Default priority: <b>{activeSla.defaultPriority.toUpperCase()}</b>). Deadline &amp; hours remain editable below.
              </div>
            )}
            <label style={{ display: 'grid', gap: 3, fontSize: 12.5, fontWeight: 600 }}>
              Job Title *
              <input
                className="input"
                required
                value={joTitle}
                onChange={(e) => setJoTitle(e.target.value)}
                placeholder={activeSla ? `e.g. ${activeSla.label} at Block 4 Lot 9` : 'Describe the job order task…'}
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Linked Activity Type
                <select className="input" value={joActivityType} onChange={(e) => setJoActivityType(e.target.value)}>
                  {ACTIVITY_CATEGORIES.map((cat: ActivityCategory) => (
                    <optgroup key={cat} label={ACTIVITY_CATEGORY_LABELS[cat]}>
                      {ACTIVITY_TYPES.filter((a) => a.category === cat).map((a) => (
                        <option key={a.id} value={a.id}>{a.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Priority
                <select className="input" value={joPriority} onChange={(e) => setJoPriority(e.target.value as 'low' | 'medium' | 'high')}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High (Urgent)</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Account # (12-char auto-parse)
                <input
                  className="input"
                  value={joAccountNo}
                  onChange={(e) => {
                    setJoAccountNo(e.target.value);
                    const parsed = parse12DigitAccount(e.target.value);
                    if (parsed) {
                      if (!joBlockLot) setJoBlockLot(parsed.blockLotFormatted);
                      if (!joSite) setJoSite(`Phase ${parsed.phaseCode}`);
                    }
                  }}
                  placeholder="Optional 12-char account #"
                />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Account Name
                <input className="input" value={joAccountName} onChange={(e) => setJoAccountName(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Area / Station
                <select className="input" value={joAreaId} onChange={(e) => setJoAreaId(e.target.value)}>
                  <option value="">— Select Station —</option>
                  {stationAreas.map((a) => (
                    <option key={a.id} value={a.id}>{a.code}{a.name ? ` · ${a.name}` : ''}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Block &amp; Lot / Site
                <input className="input" value={joBlockLot} onChange={(e) => setJoBlockLot(e.target.value)} placeholder="e.g. Block 004 Lot 009" />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Deadline (Manila Time)
                <input className="input" type="datetime-local" value={joDeadline} onChange={(e) => setJoDeadline(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                SLA Response Hours
                <input className="input" type="number" step="0.5" value={joEstHours} onChange={(e) => setJoEstHours(e.target.value)} />
              </label>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Assign Crew Operators:</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxHeight: 110, overflow: 'auto' }}>
                {operators.map((op) => {
                  const sel = joAssignedOps.includes(op.id);
                  return (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => setJoAssignedOps((prev) => (sel ? prev.filter((x) => x !== op.id) : [...prev, op.id]))}
                      style={{
                        padding: '3px 9px',
                        borderRadius: 999,
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: sel ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                        background: sel ? 'var(--primary)' : 'var(--surface-muted)',
                        color: sel ? 'var(--primary-fg)' : 'var(--text)',
                      }}
                    >
                      {sel ? '✓ ' : '+ '}{op.full_name}
                    </button>
                  );
                })}
              </div>
            </div>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
              Instructions / Description
              <textarea className="input" rows={2} value={joDesc} onChange={(e) => setJoDesc(e.target.value)} style={{ minHeight: 54 }} />
            </label>
            {canLogSample && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 6, background: 'var(--warn-bg)', color: 'var(--warn-fg)', border: '1px solid var(--warn-border)', cursor: 'pointer' }}>
                <input type="checkbox" checked={joIsSample} onChange={(e) => setJoIsSample(e.target.checked)} />
                <span>Log as sample (auto-deletes in 24h)</span>
              </label>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setJoModalOpen(false)} disabled={savingJo}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={savingJo}>{savingJo ? 'Dispatching…' : 'Dispatch JO'}</button>
            </div>
          </form>
        </div>
        );
      })()}
    </div>
  );
}
