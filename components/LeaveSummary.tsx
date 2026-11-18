'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Op = { id: string; full_name: string; position: string | null };
type Area = { id: string; code: string; name: string | null; category: string; background_color: string; text_color: string };
type Row = { operator_id: string; schedule_date: string; area_code_id: string };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const th = { background: 'var(--header-bg)', color: 'var(--header-fg)', padding: '5px 8px', position: 'sticky' as const, top: 0, fontSize: 12 };
const td = { padding: '4px 8px', borderBottom: '1px solid var(--border-light)', textAlign: 'center' as const, fontSize: 12 };

export default function LeaveSummary(p: { year: number; operators: Op[]; areas: Area[]; rows: Row[]; error: string }) {
  const router = useRouter();
  const [showHoliday, setShowHoliday] = useState(false);
  const [showRd, setShowRd] = useState(false);
  const isRd = (a: Area) => a.category === 'rest' || a.code.toUpperCase() === 'RD';
  const areas = p.areas.filter((a) =>
    isRd(a) ? showRd : a.category === 'holiday' ? showHoliday : a.category === 'leave',
  );
  const areaIds = new Set(areas.map((a) => a.id));

  const byCode = useMemo(() => {
    const m = new Map<string, number>();
    p.rows.forEach((r) => { if (areaIds.has(r.area_code_id)) m.set(r.operator_id + r.area_code_id, (m.get(r.operator_id + r.area_code_id) ?? 0) + 1); });
    return m;
  }, [p.rows, areas]); // eslint-disable-line react-hooks/exhaustive-deps
  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    p.rows.forEach((r) => { if (areaIds.has(r.area_code_id)) { const k = r.operator_id + (+r.schedule_date.slice(5, 7) - 1); m.set(k, (m.get(k) ?? 0) + 1); } });
    return m;
  }, [p.rows, areas]); // eslint-disable-line react-hooks/exhaustive-deps

  const opTotal = (id: string) => areas.reduce((s, a) => s + (byCode.get(id + a.id) ?? 0), 0);

  function exportCsv() {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const head = ['Operator', ...areas.map((a) => a.code), 'Total', ...MONTHS];
    const lines = [head.map(esc).join(',')];
    p.operators.forEach((o) => lines.push([o.full_name, ...areas.map((a) => byCode.get(o.id + a.id) ?? 0), opTotal(o.id), ...MONTHS.map((_, i) => byMonth.get(o.id + i) ?? 0)].map(esc).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `leave-summary-${p.year}.csv`; a.click();
  }

  return (
    <div style={{ padding: 14 }}>
      <div className="no-print card" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', marginBottom: 10 }}>
        <strong>Leave Summary</strong>
        <button className="btn" onClick={() => router.push(`/leave?y=${p.year - 1}`)}>‹</button>
        <b>{p.year}</b>
        <button className="btn" onClick={() => router.push(`/leave?y=${p.year + 1}`)}>›</button>
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={showHoliday} onChange={(e) => setShowHoliday(e.target.checked)} /> include holidays</label>
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={showRd} onChange={(e) => setShowRd(e.target.checked)} /> include Rest Days (RD)</label>
        {p.error && <span role="alert" style={{ color: '#b91c1c', fontSize: 12 }}>{p.error}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn" onClick={exportCsv}>Export CSV</button><button className="btn" onClick={() => window.print()}>Print</button>
        </span>
      </div>
      {areas.length === 0 ? <p style={{ color: '#64748b' }}>No leave area codes defined yet. Add some (category “leave”) under Operators &amp; Setup.</p> : (
        <>
          <div className="responsive-cards">
            {p.operators.map((o) => {
              const tot = opTotal(o.id);
              return (
                <div key={o.id} className="card" style={{ padding: 12, display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 14 }}>{o.full_name}</strong>
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>{tot} days</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {areas.map((a) => {
                      const n = byCode.get(o.id + a.id) ?? 0;
                      if (!n) return null;
                      return (
                        <span
                          key={a.id}
                          style={{
                            background: a.background_color,
                            color: a.text_color,
                            padding: '2px 8px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                            border: '1px solid var(--border)',
                          }}
                        >
                          {a.code}: {n}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="responsive-table-wrap">
          <h3 style={{ margin: '4px 0' }}>Days by leave type</h3>
          <div className="card" style={{ overflow: 'auto', marginBottom: 16, maxHeight: '45vh' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={{ ...th, textAlign: 'left' }}>Operator</th>
                {areas.map((a) => <th key={a.id} style={th} title={a.name ?? ''}>{a.code}</th>)}<th style={th}>Total</th></tr></thead>
              <tbody>{p.operators.map((o) => (
                <tr key={o.id}><td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{o.full_name}</td>
                  {areas.map((a) => { const n = byCode.get(o.id + a.id) ?? 0; return <td key={a.id} className="tabular-nums" style={{ ...td, background: n ? a.background_color : undefined, color: n ? a.text_color : '#64748b', fontWeight: n ? 700 : 400 }}>{n || '·'}</td>; })}
                  <td className="tabular-nums" style={{ ...td, fontWeight: 700 }}>{opTotal(o.id)}</td></tr>))}
              </tbody>
              <tfoot><tr><td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>All operators</td>
                {areas.map((a) => <td key={a.id} style={{ ...td, fontWeight: 700 }}>{p.operators.reduce((s, o) => s + (byCode.get(o.id + a.id) ?? 0), 0)}</td>)}
                <td style={{ ...td, fontWeight: 700 }}>{p.operators.reduce((s, o) => s + opTotal(o.id), 0)}</td></tr></tfoot>
            </table>
          </div>
          <h3 style={{ margin: '4px 0' }}>Days by month</h3>
          <div className="card" style={{ overflow: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={{ ...th, textAlign: 'left' }}>Operator</th>{MONTHS.map((m) => <th key={m} style={th}>{m}</th>)}</tr></thead>
              <tbody>{p.operators.map((o) => (
                <tr key={o.id}><td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{o.full_name}</td>
                  {MONTHS.map((_, i) => { const n = byMonth.get(o.id + i) ?? 0; return <td key={i} className="tabular-nums" style={{ ...td, color: n ? 'var(--text)' : 'var(--text-muted)', fontWeight: n ? 700 : 400 }}>{n || '·'}</td>; })}</tr>))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>All operators</td>
                  {MONTHS.map((_, i) => (
                    <td key={i} className="tabular-nums" style={{ ...td, fontWeight: 700 }}>
                      {p.operators.reduce((s, o) => s + (byMonth.get(o.id + i) ?? 0), 0)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          </div>
        </>)}
    </div>
  );
}
