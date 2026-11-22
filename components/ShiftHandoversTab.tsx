'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { DailyActivityRow, ShiftHandoverRow } from '@/lib/activity-types';
import { Badge, EmptyState, StatCard } from '@/components/ui';

type HoOp = { id: string; full_name: string };
type HoArea = { id: string; code: string };

interface ShiftHandoversTabProps {
  orgId: string;
  userId: string;
  operatorId: string | null;
  date: string;
  canLogHandover: boolean;
  dateActivities: DailyActivityRow[];
  idleOnDutyCount: number;
  openHighJos: number;
  overduePms: number;
  handovers: ShiftHandoverRow[];
  operators: HoOp[];
  stationAreas: HoArea[];
  opBy: Map<string, HoOp>;
  areaBy: Map<string, HoArea>;
  onHandoverCreated: (ho: ShiftHandoverRow) => void;
  onBannerMsg: (msg: string) => void;
}

export default function ShiftHandoversTab({
  orgId,
  userId,
  operatorId,
  date,
  canLogHandover,
  dateActivities,
  idleOnDutyCount,
  openHighJos,
  overduePms,
  handovers,
  operators,
  stationAreas,
  opBy,
  areaBy,
  onHandoverCreated,
  onBannerMsg,
}: ShiftHandoversTabProps) {
  const [hoAreaId, setHoAreaId] = useState('');
  const [hoOutOpId, setHoOutOpId] = useState(operatorId ?? '');
  const [hoInOpId, setHoInOpId] = useState('');
  const [hoPlantStatus, setHoPlantStatus] = useState<'normal' | 'watch' | 'critical'>('normal');
  const [hoSummary, setHoSummary] = useState('');
  const [hoPending, setHoPending] = useState('');
  const [hoChemFuel, setHoChemFuel] = useState('');
  const [savingHo, setSavingHo] = useState(false);

  async function handleSaveHandover(e: React.FormEvent) {
    e.preventDefault();
    if (!hoSummary.trim()) return;
    setSavingHo(true);
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('shift_handovers')
      .insert({
        organization_id: orgId,
        handover_date: date,
        shift_type_id: null,
        area_code_id: hoAreaId || null,
        outgoing_operator_id: hoOutOpId || null,
        incoming_operator_id: hoInOpId || null,
        plant_status: hoPlantStatus,
        summary: hoSummary.trim(),
        pending_items: hoPending.trim() || null,
        chemical_fuel_notes: hoChemFuel.trim() || null,
        created_by: userId,
      })
      .select('*')
      .single();

    setSavingHo(false);
    if (error) {
      onBannerMsg(`Handover save error: ${error.message}`);
      return;
    }
    onHandoverCreated(data as ShiftHandoverRow);
    setHoSummary('');
    setHoPending('');
    setHoChemFuel('');
    onBannerMsg('✓ Shift handover recorded.');
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 12 }}>
        {/* Daily Huddle Brief Card */}
        <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 15 }}>Daily Operations Huddle Brief ({date})</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <StatCard
              label="Field Activities Today"
              value={dateActivities.length}
              subtitle={`${dateActivities.filter((a) => a.status === 'verified').length} verified`}
              subtitleTone="ok"
            />
            <StatCard
              label="Open Alerts"
              value={<span style={{ fontSize: 16 }}>{idleOnDutyCount} idle on-duty</span>}
              subtitle={`${openHighJos} high-prio JO · ${overduePms} overdue PM`}
              subtitleTone={openHighJos + overduePms > 0 ? 'warn' : 'default'}
            />
          </div>
        </div>

        {canLogHandover && (
          <form className="card" onSubmit={handleSaveHandover} style={{ padding: 14, display: 'grid', gap: 10 }}>
            <strong style={{ fontSize: 14.5 }}>Log Shift Handover Note</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Station / Area
                <select className="input" value={hoAreaId} onChange={(e) => setHoAreaId(e.target.value)}>
                  <option value="">All / General</option>
                  {stationAreas.map((a) => (
                    <option key={a.id} value={a.id}>{a.code}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Plant Status
                <select className="input" value={hoPlantStatus} onChange={(e) => setHoPlantStatus(e.target.value as 'normal' | 'watch' | 'critical')}>
                  <option value="normal">Normal</option>
                  <option value="watch">Watch / Caution</option>
                  <option value="critical">Critical Alert</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Outgoing Operator
                <select className="input" value={hoOutOpId} onChange={(e) => setHoOutOpId(e.target.value)}>
                  <option value="">— Select —</option>
                  {operators.map((o) => (
                    <option key={o.id} value={o.id}>{o.full_name}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
                Incoming Operator
                <select className="input" value={hoInOpId} onChange={(e) => setHoInOpId(e.target.value)}>
                  <option value="">— Select —</option>
                  {operators.map((o) => (
                    <option key={o.id} value={o.id}>{o.full_name}</option>
                  ))}
                </select>
              </label>
            </div>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
              Shift Summary *
              <textarea
                className="input"
                required
                rows={2}
                placeholder="Pump run status, tank levels, major actions completed…"
                value={hoSummary}
                onChange={(e) => setHoSummary(e.target.value)}
                style={{ minHeight: 56 }}
              />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
              Pending / Follow-up Items
              <input className="input" value={hoPending} onChange={(e) => setHoPending(e.target.value)} placeholder="Items for incoming shift" />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, fontWeight: 600 }}>
              Chemical / Fuel Notes
              <input className="input" value={hoChemFuel} onChange={(e) => setHoChemFuel(e.target.value)} placeholder="Chlorine stock, diesel level, etc." />
            </label>
            <button type="submit" className="btn btn-primary" disabled={savingHo}>
              {savingHo ? 'Saving Handover…' : 'Save Handover Entry'}
            </button>
          </form>
        )}
      </div>

      <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 14.5 }}>Recent Shift Handovers (Last 14 Days)</strong>
        {handovers.length === 0 ? (
          <EmptyState
            minHeight={160}
            title="No handover entries logged yet."
            description="Outgoing operators can log shift notes and pending items on the left."
          />
        ) : (
          handovers.map((h) => {
            const area = h.area_code_id ? areaBy.get(h.area_code_id) : undefined;
            const outOp = h.outgoing_operator_id ? opBy.get(h.outgoing_operator_id) : undefined;
            const inOp = h.incoming_operator_id ? opBy.get(h.incoming_operator_id) : undefined;
            const statusColor =
              h.plant_status === 'critical' ? 'var(--danger)' : h.plant_status === 'watch' ? 'var(--warn-fg)' : 'var(--ok-fg)';
            return (
              <div
                key={h.id}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  borderLeft: `4px solid ${statusColor}`,
                  display: 'grid',
                  gap: 4,
                  fontSize: 12.5,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>{h.handover_date} · {area ? area.code : 'All Stations'}</b>
                  <Badge size="sm" tone={h.plant_status === 'critical' ? 'danger' : h.plant_status === 'watch' ? 'warn' : 'ok'}>
                    {h.plant_status.toUpperCase()}
                  </Badge>
                </div>
                {(outOp || inOp) && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    {outOp?.full_name ?? 'Outgoing'} → {inOp?.full_name ?? 'Incoming'}
                  </div>
                )}
                <div>{h.summary}</div>
                {h.pending_items && <div style={{ color: 'var(--warn-fg)' }}><b>Pending:</b> {h.pending_items}</div>}
                {h.chemical_fuel_notes && <div style={{ color: 'var(--text-secondary)' }}><b>Chem/Fuel:</b> {h.chemical_fuel_notes}</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
