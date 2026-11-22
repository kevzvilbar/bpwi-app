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
import { Badge, EmptyState, SegmentedTabs } from '@/components/ui';

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
  const [joTitle, setJoTitle] = useState('');
  const [joActivityType, setJoActivityType] = useState('leak_repair');
  const [joPriority, setJoPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [joAreaId, setJoAreaId] = useState('');
  const [joSite, setJoSite] = useState('');
  const [joBlockLot, setJoBlockLot] = useState('');
  const [joAccountNo, setJoAccountNo] = useState('');
  const [joAccountName, setJoAccountName] = useState('');
  const [joDesc, setJoDesc] = useState('');
  const [joDeadline, setJoDeadline] = useState('');
  const [joEstHours, setJoEstHours] = useState('2');
  const [joAssignedOps, setJoAssignedOps] = useState<string[]>([]);
  const [savingJo, setSavingJo] = useState(false);

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
        estimated_hours: Number(joEstHours) || 2,
        status: 'pending',
        created_by: userId,
      })
      .select('*')
      .single();

    setSavingJo(false);
    if (error) {
      onBannerMsg(`Job order error: ${error.message}`);
      return;
    }
    const created = data as JobOrderRow;
    onJobOrderCreated(created);
    setJoModalOpen(false);
    setJoTitle('');
    setJoAccountNo('');
    setJoAccountName('');
    setJoBlockLot('');
    setJoSite('');
    setJoDesc('');
    setJoAssignedOps([]);
    onBannerMsg(`✓ Dispatched ${created.jo_number}.`);
  }

  async function updateJobOrderStatus(jo: JobOrderRow, nextStatus: JobOrderRow['status']) {
    const sb = supabaseBrowser();
    const updates: Record<string, unknown> = {
      status: nextStatus,
      completed_at: nextStatus === 'completed' ? new Date().toISOString() : null,
    };
    const { data, error } = await sb.from('job_orders').update(updates).eq('id', jo.id).select('*').single();
    if (error) {
      onBannerMsg(`Update failed: ${error.message}`);
      return;
    }
    onJobOrderUpdated(data as JobOrderRow);
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
          <button type="button" className="btn btn-primary" onClick={() => setJoModalOpen(true)} style={{ fontWeight: 700 }}>
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
            const isOverdue = Boolean(jo.deadline && jo.status !== 'completed' && jo.status !== 'cancelled' && new Date(jo.deadline).getTime() < Date.now());
            const tatHours =
              jo.completed_at && jo.created_at
                ? ((new Date(jo.completed_at).getTime() - new Date(jo.created_at).getTime()) / (1000 * 60 * 60)).toFixed(1)
                : null;

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
                  <div style={{ display: 'flex', gap: 5 }}>
                    <Badge size="sm" tone={jo.priority === 'high' ? 'danger' : jo.priority === 'medium' ? 'warn' : 'info'}>
                      {jo.priority.toUpperCase()}
                    </Badge>
                    <Badge size="sm" tone={jo.status === 'completed' ? 'ok' : isOverdue ? 'danger' : 'neutral'}>
                      {(isOverdue ? 'SLA Breach' : jo.status.replace('_', ' ')).toUpperCase()}
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
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                  <span>Deadline: {jo.deadline ? fmtDateTimeManila(jo.deadline) : 'None'}</span>
                  {tatHours && <span>TAT: <b>{tatHours} hrs</b></span>}
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
                  {jo.status === 'pending' && (
                    <button type="button" className="btn" onClick={() => void updateJobOrderStatus(jo, 'in_progress')} style={{ fontSize: 12 }}>
                      Start Work
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

      {/* Dispatch Job Order Modal */}
      {joModalOpen && (
        <div className="modal-overlay no-print" role="dialog" aria-modal="true" onClick={() => !savingJo && setJoModalOpen(false)}>
          <form className="modal-sheet" onClick={(e) => e.stopPropagation()} onSubmit={handleCreateJobOrder} style={{ maxWidth: 580, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 17 }}>Dispatch Field Job Order</h2>
              <button type="button" className="btn" onClick={() => setJoModalOpen(false)}>✕</button>
            </div>
            <label style={{ display: 'grid', gap: 3, fontSize: 12.5, fontWeight: 600 }}>
              Job Title *
              <input className="input" required value={joTitle} onChange={(e) => setJoTitle(e.target.value)} placeholder="e.g. Service line leak repair at Block 4 Lot 9" />
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
                Est. SLA Hours
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setJoModalOpen(false)} disabled={savingJo}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={savingJo}>{savingJo ? 'Dispatching…' : 'Dispatch JO'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
