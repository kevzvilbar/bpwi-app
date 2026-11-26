'use client';

import { useEffect, useMemo, useState } from 'react';
import EscalationContacts, { type EscalationContact } from '@/components/EscalationContacts';
import { Badge } from '@/components/ui';
import { DEFAULT_STATION_CODE } from '@/lib/roster-helpers';

type Op = { id: string; full_name: string; position: string | null; phone_number: string | null; default_station: string | null };
type Shift = {
  id: string;
  code: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  background_color: string;
  text_color: string;
  is_off: boolean;
};
type Area = { id: string; code: string; name: string | null; category: string };
type Asg = { operator_id: string; shift_type_id: string | null; area_code_id: string | null };
type Standby = { operator_id: string; standby_type: string };

function toMinutes(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function isShiftActiveNow(todayShift: Shift | undefined, yesterdayShift: Shift | undefined, yesterdayIsLeave: boolean, nowMinutes: number) {
  if (todayShift && !todayShift.is_off) {
    const start = toMinutes(todayShift.start_time);
    const end = toMinutes(todayShift.end_time);
    if (start !== null && end !== null) {
      if (end > start && nowMinutes >= start && nowMinutes < end) return true;
      if (end <= start && nowMinutes >= start) return true;
    }
  }
  if (yesterdayShift && !yesterdayShift.is_off && !yesterdayIsLeave) {
    const start = toMinutes(yesterdayShift.start_time);
    const end = toMinutes(yesterdayShift.end_time);
    if (start !== null && end !== null && end <= start && nowMinutes < end) return true;
  }
  return false;
}

function manilaClockMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

export default function CallSheet(p: {
  today: string;
  nowMinutes: number;
  operators: Op[];
  shifts: Shift[];
  areas: Area[];
  assignments: Asg[];
  yesterdayAssignments: Asg[];
  standby: Standby[];
  /** Department heads / managers shown as escalation contacts (not on the roster). */
  heads?: EscalationContact[];
  error: string;
}) {
  const [search, setSearch] = useState('');
  const [onlyStandby, setOnlyStandby] = useState(false);
  const [nowMinutes, setNowMinutes] = useState(p.nowMinutes);

  useEffect(() => {
    setNowMinutes(manilaClockMinutes());
    const id = setInterval(() => setNowMinutes(manilaClockMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);

  const asOfTime = `${String(Math.floor(nowMinutes / 60)).padStart(2, '0')}:${String(nowMinutes % 60).padStart(2, '0')}`;

  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);
  const asgBy = useMemo(() => new Map(p.assignments.map((a) => [a.operator_id, a])), [p.assignments]);
  const prevAsgBy = useMemo(() => new Map(p.yesterdayAssignments.map((a) => [a.operator_id, a])), [p.yesterdayAssignments]);
  const sbBy = useMemo(() => new Map(p.standby.map((s) => [s.operator_id, s.standby_type])), [p.standby]);

  const sortedAndFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const enriched = p.operators
      .filter((o) => {
        if (onlyStandby && !sbBy.has(o.id)) return false;
        if (!q) return true;
        return (
          o.full_name.toLowerCase().includes(q) ||
          (o.position ?? '').toLowerCase().includes(q) ||
          (o.default_station ?? '').toLowerCase().includes(q) ||
          (o.phone_number ?? '').toLowerCase().includes(q)
        );
      })
      .map((o, idx) => {
        const asg = asgBy.get(o.id);
        const shift = asg?.shift_type_id ? shiftBy.get(asg.shift_type_id) : undefined;
        const area = asg?.area_code_id ? areaBy.get(asg.area_code_id) : undefined;
        const prevAsg = prevAsgBy.get(o.id);
        const prevShift = prevAsg?.shift_type_id ? shiftBy.get(prevAsg.shift_type_id) : undefined;
        const prevArea = prevAsg?.area_code_id ? areaBy.get(prevAsg.area_code_id) : undefined;
        const standbyType = sbBy.get(o.id);
        const isRestDay = Boolean(area && (area.category === 'rest' || area.code.toUpperCase() === 'RD'));
        const isLeave = Boolean(area && area.category === 'leave' && area.code.toUpperCase() !== 'RD');
        const prevRestOrLeave = Boolean(
          prevArea && (prevArea.category === 'leave' || prevArea.category === 'rest' || prevArea.code.toUpperCase() === 'RD'),
        );
        const isOnDuty = Boolean(shift && !shift.is_off && !isLeave && !isRestDay);
        const isNow = isShiftActiveNow(isLeave || isRestDay ? undefined : shift, prevShift, prevRestOrLeave, nowMinutes);
        // Priority: 0 = Standby, 1 = On Duty Now, 2 = On Duty Today, 3 = Off / Leave / Unassigned
        const tier = standbyType ? 0 : isNow ? 1 : isOnDuty ? 2 : 3;
        return { op: o, idx, shift, area, standbyType, isLeave, isRestDay, isOnDuty, isNow, tier };
      });

    enriched.sort((a, b) => a.tier - b.tier || a.idx - b.idx);
    return enriched;
  }, [areaBy, asgBy, nowMinutes, onlyStandby, p.operators, prevAsgBy, sbBy, search, shiftBy]);

  const priorityList = useMemo(
    () => sortedAndFiltered.filter((x) => Boolean(x.standbyType)),
    [sortedAndFiltered],
  );

  const coverageCounts = useMemo(() => {
    let standby = 0;
    let onDutyNow = 0;
    let onDutyToday = 0;
    let offOrLeave = 0;
    for (const x of sortedAndFiltered) {
      if (x.standbyType) standby += 1;
      if (x.isNow) onDutyNow += 1;
      if (x.isOnDuty) onDutyToday += 1;
      else offOrLeave += 1;
    }
    return { standby, onDutyNow, onDutyToday, offOrLeave };
  }, [sortedAndFiltered]);

  return (
    <div style={{ padding: 14, maxWidth: 1440, margin: '0 auto' }}>
      <div
        className="no-print card mobile-toolbar-compact"
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '10px 14px',
          marginBottom: 10,
        }}
      >
        <h1 className="page-title" style={{ fontSize: 16 }}>
          Emergency Call Sheet
        </h1>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {p.today} · as of {asOfTime} (Manila)
        </span>
        <input
          type="search"
          aria-label="Search operators"
          placeholder="Search name, station, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
          style={{ flex: '1 1 180px', minWidth: 0 }}
        />
        <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 40 }}>
          <input type="checkbox" checked={onlyStandby} onChange={(e) => setOnlyStandby(e.target.checked)} />
          On-Call / Standby only ({p.standby.length})
        </label>
        {p.error && (
          <span role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>
            {p.error}
          </span>
        )}
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => window.print()}>
          Print
        </button>
      </div>

      <details className="no-print card" style={{ padding: '7px 12px', marginBottom: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 40, display: 'inline-flex', alignItems: 'center' }}>Code Glossary (PL, FD, WD, OC, DWP, ERP, RD)</summary>
        <div style={{ marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span><b>FD</b> = Field Operations (default station)</span>
          <span><b>PL</b> = Plant Operations</span>
          <span><b>WD</b> = Water Delivery</span>
          <span><b>OC</b> = General On-Call</span>
          <span><b>DWP</b> = Deep Well Pull-out Standby</span>
          <span><b>ERP</b> = Electro-Mechanical Repair Standby</span>
          <span><b>RD</b> = Rest Day</span>
        </div>
      </details>

      <EscalationContacts contacts={p.heads ?? []} />

      {/* Desktop / Tablet 2-Column Side-by-Side Layout (> 640px) */}
      <div className="call-sheet-table-wrap call-sheet-split">
        {/* Left Column: Standby Dispatch & Shift Coverage Summary */}
        <section className="card" style={{ padding: 12, display: 'grid', gap: 10 }} aria-label="Emergency standby dispatch">
          <div style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 8, background: 'var(--surface-muted)', border: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Today&apos;s Shift Summary
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11.5, fontWeight: 700 }}>
              <Badge tone="violet" size="sm">{coverageCounts.standby} Standby</Badge>
              <Badge tone="ok" size="sm">{coverageCounts.onDutyNow} On Duty Now</Badge>
              <Badge tone="info" size="sm">{coverageCounts.onDutyToday} Duty Today</Badge>
              <Badge tone="neutral" size="sm">{coverageCounts.offOrLeave} Off / Leave</Badge>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>Emergency Standby</strong>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600 }}>
              {priorityList.length} on call
            </span>
          </div>
          {priorityList.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              No standby operators assigned or matching the filter.
            </p>
          ) : (
            priorityList.map(({ op, shift, area, standbyType, isOnDuty, isNow }) => (
              <div
                key={op.id}
                style={{
                  background: standbyType ? 'var(--violet-bg)' : 'var(--surface-muted)',
                  border: standbyType ? '1.5px solid var(--violet-border)' : '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 10,
                  display: 'grid',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 6 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{op.full_name}</div>
                    {op.position && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{op.position}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {standbyType && <Badge tone="violet" size="sm">{standbyType}</Badge>}
                    {isNow && shift && (
                      <span style={{ background: shift.background_color, color: shift.text_color, padding: '2px 7px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, border: '1px solid var(--border)' }}>
                        NOW · {shift.code}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Station: <b>{area?.code ?? (isOnDuty ? DEFAULT_STATION_CODE : op.default_station ?? '—')}</b>
                </div>
                {op.phone_number && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                    <a
                      href={`tel:${op.phone_number}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: 36,
                        padding: '5px 10px',
                        borderRadius: 7,
                        background: 'var(--primary)',
                        color: 'var(--primary-fg)',
                        textDecoration: 'none',
                        fontWeight: 700,
                        fontSize: 12.5,
                        fontFamily: 'ui-monospace, monospace',
                      }}
                    >
                      Call {op.phone_number}
                    </a>
                    <a href={`sms:${op.phone_number}`} className="btn" style={{ textDecoration: 'none', fontWeight: 700 }}>
                      SMS
                    </a>
                  </div>
                )}
              </div>
            ))
          )}
        </section>

        {/* Right Column: Full Roster Table */}
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="schedule-table" style={{ fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--header-bg)', color: 'var(--header-fg)', textAlign: 'left' }}>
              <th style={{ padding: '8px 10px', width: 38, textAlign: 'center' }}>#</th>
              <th style={{ padding: '8px 10px' }}>Operator</th>
              <th style={{ padding: '8px 10px' }}>Status</th>
              <th style={{ padding: '8px 10px' }}>Station / Area</th>
              <th style={{ padding: '8px 10px' }}>Phone</th>
            </tr>
          </thead>
          <tbody>
            {sortedAndFiltered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                  No operators match the current filter.
                </td>
              </tr>
            ) : (
              sortedAndFiltered.map(({ op, shift, area, standbyType, isLeave, isRestDay, isOnDuty, isNow }, i) => (
                <tr key={op.id} style={{ background: standbyType ? 'var(--violet-bg)' : 'var(--surface)' }}>
                  <td className="tabular-nums" style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    {i + 1}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)' }}>{op.full_name}</div>
                    {op.position && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{op.position}</div>}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {standbyType && <Badge tone="violet" size="sm">STANDBY · {standbyType}</Badge>}
                      {isLeave ? (
                        <Badge tone="danger" size="sm">LEAVE · {area?.code}</Badge>
                      ) : isRestDay ? (
                        <Badge tone="neutral" size="sm">REST DAY · {area?.code}</Badge>
                      ) : isOnDuty && shift ? (
                        <span
                          style={{
                            background: shift.background_color,
                            color: shift.text_color,
                            padding: '3px 9px',
                            borderRadius: 6,
                            fontWeight: 700,
                            fontSize: 11.5,
                            border: '1px solid var(--border)',
                          }}
                        >
                          {isNow ? 'ON DUTY NOW' : 'ON DUTY'} · {shift.code}
                        </span>
                      ) : shift?.is_off ? (
                        <Badge tone="neutral" size="sm">OFF · {shift.code}</Badge>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Unassigned</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--text)', fontWeight: 500 }}>
                    {area?.code ?? (isOnDuty ? DEFAULT_STATION_CODE : op.default_station ?? '—')}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    {op.phone_number ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <a
                          href={`tel:${op.phone_number}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            minHeight: 38,
                            padding: '6px 12px',
                            borderRadius: 8,
                            background: 'var(--primary)',
                            color: 'var(--primary-fg)',
                            textDecoration: 'none',
                            fontWeight: 700,
                            fontSize: 13,
                            fontFamily: 'ui-monospace, monospace',
                          }}
                        >
                          Call {op.phone_number}
                        </a>
                        <a
                          href={`sms:${op.phone_number}`}
                          className="btn"
                          style={{ minHeight: 38, textDecoration: 'none', fontWeight: 700 }}
                        >
                          SMS
                        </a>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>No phone</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Mobile Coverage Summary (<= 640px) */}
      <div className="call-sheet-mobile-summary no-print">
        <Badge tone="violet" size="sm">⚡ {coverageCounts.standby} Standby</Badge>
        <Badge tone="ok" size="sm">{coverageCounts.onDutyNow} On Duty Now</Badge>
        <Badge tone="info" size="sm">{coverageCounts.onDutyToday} On Duty Today</Badge>
        <Badge tone="neutral" size="sm">{coverageCounts.offOrLeave} Off / Leave</Badge>
      </div>

      {/* Mobile Card List (<= 640px) */}
      <div className="call-sheet-cards">
        {sortedAndFiltered.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13.5 }}>
            No operators match the current filter.
          </div>
        ) : (
          sortedAndFiltered.map(({ op, shift, area, standbyType, isLeave, isRestDay, isOnDuty }) => (
            <div
              key={op.id}
              className="card"
              style={{
                background: standbyType ? 'var(--violet-bg)' : 'var(--surface)',
                border: standbyType ? '1.5px solid var(--violet-border)' : '1px solid var(--border)',
                padding: 14,
                display: 'grid',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{op.full_name}</div>
                  {op.position && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{op.position}</div>}
                </div>
                {standbyType && <Badge tone="violet" size="sm">STANDBY · {standbyType}</Badge>}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                <span>
                  Status:{' '}
                  <b>
                    {isLeave
                      ? `LEAVE (${area?.code})`
                      : isRestDay
                        ? `REST DAY (${area?.code})`
                        : isOnDuty && shift
                          ? `ON DUTY (${shift.code})`
                          : shift?.is_off
                            ? `OFF (${shift.code})`
                            : 'Unassigned'}
                  </b>
                </span>
                <span>·</span>
                <span>
                  Station: <b>{area?.code ?? (isOnDuty ? DEFAULT_STATION_CODE : op.default_station ?? '—')}</b>
                </span>
              </div>

              {op.phone_number ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                  <a
                    href={`tel:${op.phone_number}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 44,
                      padding: '10px 14px',
                      borderRadius: 8,
                      background: 'var(--primary)',
                      color: 'var(--primary-fg)',
                      textDecoration: 'none',
                      fontWeight: 700,
                      fontSize: 14,
                      fontFamily: 'ui-monospace, monospace',
                    }}
                  >
                    Call · {op.phone_number}
                  </a>
                  <a
                    href={`sms:${op.phone_number}`}
                    className="btn"
                    style={{
                      minHeight: 44,
                      padding: '10px 16px',
                      textDecoration: 'none',
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    SMS
                  </a>
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No phone number on file</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
