'use client';

import { useMemo, useState } from 'react';

type Op = { id: string; full_name: string; position: string | null; phone_number: string | null; default_station: string | null };
type Shift = { id: string; code: string; description: string | null; background_color: string; text_color: string; is_off: boolean };
type Area = { id: string; code: string; name: string | null };
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

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return p.operators.filter((o) => {
      if (onlyStandby && !sbBy.has(o.id)) return false;
      if (!q) return true;
      return (
        o.full_name.toLowerCase().includes(q) ||
        (o.position ?? '').toLowerCase().includes(q) ||
        (o.default_station ?? '').toLowerCase().includes(q) ||
        (o.phone_number ?? '').toLowerCase().includes(q)
      );
    });
  }, [onlyStandby, p.operators, sbBy, search]);

  return (
    <div style={{ padding: 14, maxWidth: 960 }}>
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
        <span style={{ fontSize: 12, color: '#64748b' }}>Today ({p.today})</span>
        <input
          type="search"
          placeholder="Search name, station, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12.5, width: 210 }}
        />
        <label style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
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

      <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 10, overflow: 'auto' }}>
        <table className="schedule-table" style={{ fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: '#0f172a', color: '#ffffff', textAlign: 'left' }}>
              <th style={{ padding: '7px 10px', width: 36, textAlign: 'center' }}>#</th>
              <th style={{ padding: '7px 10px' }}>Operator</th>
              <th style={{ padding: '7px 10px' }}>Position</th>
              <th style={{ padding: '7px 10px' }}>Default Station</th>
              <th style={{ padding: '7px 10px' }}>Today&apos;s Shift</th>
              <th style={{ padding: '7px 10px' }}>Standby</th>
              <th style={{ padding: '7px 10px' }}>Phone</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                  No operators match the current filter.
                </td>
              </tr>
            ) : (
              list.map((o, i) => {
                const asg = asgBy.get(o.id);
                const s = asg?.shift_type_id ? shiftBy.get(asg.shift_type_id) : undefined;
                const a = asg?.area_code_id ? areaBy.get(asg.area_code_id) : undefined;
                const sb = sbBy.get(o.id);
                return (
                  <tr key={o.id} style={{ background: sb ? '#faf5ff' : '#ffffff' }}>
                    <td style={{ padding: '6px 10px', textAlign: 'center', color: '#64748b' }}>{i + 1}</td>
                    <td style={{ padding: '6px 10px', fontWeight: 600 }}>{o.full_name}</td>
                    <td style={{ padding: '6px 10px', color: '#475569' }}>{o.position ?? '—'}</td>
                    <td style={{ padding: '6px 10px', color: '#475569' }}>{o.default_station ?? '—'}</td>
                    <td style={{ padding: '6px 10px' }}>
                      {s ? (
                        <span
                          style={{
                            background: s.background_color,
                            color: s.text_color,
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontWeight: 700,
                            fontSize: 11.5,
                            border: '1px solid #cbd5e1',
                          }}
                        >
                          {s.code}
                          {a ? ` · ${a.code}` : ''}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      {sb ? (
                        <span
                          style={{
                            background: '#7c3aed',
                            color: '#ffffff',
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontWeight: 700,
                            fontSize: 11,
                          }}
                        >
                          {sb}
                        </span>
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace' }}>
                      {o.phone_number ? (
                        <a href={`tel:${o.phone_number}`} style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>
                          {o.phone_number}
                        </a>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
