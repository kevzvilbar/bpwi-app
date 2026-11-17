'use client';

import { useMemo, useState } from 'react';

type Op = { id: string; full_name: string; position: string | null; phone_number: string | null; default_station: string | null };
type Shift = { id: string; code: string; description: string | null; background_color: string; text_color: string; is_off: boolean };
type Area = { id: string; code: string; name: string | null; category: string };
type Asg = { operator_id: string; shift_type_id: string | null; area_code_id: string | null };
type Standby = { operator_id: string; standby_type: string };

export default function CallSheet(p: {
  today: string;
  operators: Op[];
  shifts: Shift[];
  areas: Area[];
  assignments: Asg[];
  standby: Standby[];
  error: string;
}) {
  const [search, setSearch] = useState('');
  const [onlyStandby, setOnlyStandby] = useState(false);

  const shiftBy = useMemo(() => new Map(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const areaBy = useMemo(() => new Map(p.areas.map((a) => [a.id, a])), [p.areas]);
  const asgBy = useMemo(() => new Map(p.assignments.map((a) => [a.operator_id, a])), [p.assignments]);
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
        const standbyType = sbBy.get(o.id);
        const isLeave = area?.category === 'leave';
        const isOnDuty = Boolean(shift && !shift.is_off && !isLeave);
        // Priority: 0 = Standby, 1 = On Duty, 2 = Off / Leave / Unassigned
        const tier = standbyType ? 0 : isOnDuty ? 1 : 2;
        return { op: o, idx, shift, area, standbyType, isLeave, isOnDuty, tier };
      });

    enriched.sort((a, b) => a.tier - b.tier || a.idx - b.idx);
    return enriched;
  }, [areaBy, asgBy, onlyStandby, p.operators, sbBy, search, shiftBy]);

  return (
    <div style={{ padding: 14, maxWidth: 1020 }}>
      <div
        className="no-print"
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '10px 14px',
          marginBottom: 10,
        }}
      >
        <strong>Emergency Call Sheet</strong>
        <span style={{ fontSize: 12, color: '#475569' }}>Today ({p.today}) · Standby first, then On Duty</span>
        <input
          type="search"
          aria-label="Search operators"
          placeholder="Search name, station, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, width: 220 }}
        />
        <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <input type="checkbox" checked={onlyStandby} onChange={(e) => setOnlyStandby(e.target.checked)} />
          On-Call / Standby only ({p.standby.length})
        </label>
        {p.error && (
          <span role="alert" style={{ color: '#b91c1c', fontSize: 12 }}>
            {p.error}
          </span>
        )}
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => window.print()}>
          Print
        </button>
      </div>

      {/* Desktop / Tablet Table */}
      <div className="call-sheet-table-wrap" style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 10, overflow: 'auto' }}>
        <table className="schedule-table" style={{ fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#0f172a', color: '#ffffff', textAlign: 'left' }}>
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
                <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#475569' }}>
                  No operators match the current filter.
                </td>
              </tr>
            ) : (
              sortedAndFiltered.map(({ op, shift, area, standbyType, isLeave, isOnDuty }, i) => (
                <tr key={op.id} style={{ background: standbyType ? '#faf5ff' : '#ffffff' }}>
                  <td className="tabular-nums" style={{ padding: '8px 10px', textAlign: 'center', color: '#475569' }}>
                    {i + 1}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{op.full_name}</div>
                    {op.position && <div style={{ fontSize: 11.5, color: '#475569' }}>{op.position}</div>}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {standbyType && (
                        <span
                          style={{
                            background: '#6d28d9',
                            color: '#ffffff',
                            padding: '3px 9px',
                            borderRadius: 999,
                            fontWeight: 700,
                            fontSize: 11.5,
                          }}
                        >
                          STANDBY · {standbyType}
                        </span>
                      )}
                      {isLeave ? (
                        <span
                          style={{
                            background: '#ffe4e6',
                            color: '#9f1239',
                            padding: '3px 9px',
                            borderRadius: 999,
                            fontWeight: 700,
                            fontSize: 11.5,
                          }}
                        >
                          LEAVE · {area?.code}
                        </span>
                      ) : isOnDuty && shift ? (
                        <span
                          style={{
                            background: shift.background_color,
                            color: shift.text_color,
                            padding: '3px 9px',
                            borderRadius: 6,
                            fontWeight: 700,
                            fontSize: 11.5,
                            border: '1px solid #cbd5e1',
                          }}
                        >
                          ON DUTY · {shift.code}
                        </span>
                      ) : shift?.is_off ? (
                        <span
                          style={{
                            background: '#f1f5f9',
                            color: '#475569',
                            padding: '3px 9px',
                            borderRadius: 6,
                            fontWeight: 600,
                            fontSize: 11.5,
                          }}
                        >
                          OFF · {shift.code}
                        </span>
                      ) : (
                        <span style={{ color: '#64748b', fontSize: 12 }}>Unassigned</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', color: '#334155', fontWeight: 500 }}>
                    {area?.code ?? (isOnDuty ? 'PW' : op.default_station ?? '—')}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    {op.phone_number ? (
                      <a
                        href={`tel:${op.phone_number}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          minHeight: 36,
                          padding: '6px 12px',
                          borderRadius: 8,
                          background: '#0369a1',
                          color: '#ffffff',
                          textDecoration: 'none',
                          fontWeight: 700,
                          fontSize: 13,
                          fontFamily: 'ui-monospace, monospace',
                        }}
                      >
                        Call {op.phone_number}
                      </a>
                    ) : (
                      <span style={{ color: '#64748b' }}>No phone</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List (<= 640px) */}
      <div className="call-sheet-cards">
        {sortedAndFiltered.map(({ op, shift, area, standbyType, isLeave, isOnDuty }) => (
          <div
            key={op.id}
            style={{
              background: standbyType ? '#faf5ff' : '#ffffff',
              border: standbyType ? '1.5px solid #7c3aed' : '1px solid #cbd5e1',
              borderRadius: 10,
              padding: 14,
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>{op.full_name}</div>
                {op.position && <div style={{ fontSize: 12, color: '#475569' }}>{op.position}</div>}
              </div>
              {standbyType && (
                <span
                  style={{
                    background: '#6d28d9',
                    color: '#ffffff',
                    padding: '3px 9px',
                    borderRadius: 999,
                    fontWeight: 700,
                    fontSize: 11.5,
                  }}
                >
                  STANDBY · {standbyType}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: '#334155' }}>
              <span>
                Status:{' '}
                <b>
                  {isLeave
                    ? `LEAVE (${area?.code})`
                    : isOnDuty && shift
                      ? `ON DUTY (${shift.code})`
                      : shift?.is_off
                        ? `OFF (${shift.code})`
                        : 'Unassigned'}
                </b>
              </span>
              <span>·</span>
              <span>
                Station: <b>{area?.code ?? (isOnDuty ? 'PW' : op.default_station ?? '—')}</b>
              </span>
            </div>

            {op.phone_number ? (
              <a
                href={`tel:${op.phone_number}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 44,
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: '#0369a1',
                  color: '#ffffff',
                  textDecoration: 'none',
                  fontWeight: 700,
                  fontSize: 14,
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                Tap to Call · {op.phone_number}
              </a>
            ) : (
              <div style={{ fontSize: 12.5, color: '#64748b' }}>No phone number on file</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
