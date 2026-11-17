'use client';
import { useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

type Op = { id: string; full_name: string };
type Shift = { id: string; code: string; description: string | null; is_off: boolean; background_color: string; text_color: string };

const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const diffDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export default function Generator(p: { today: string; operators: Op[]; shifts: Shift[]; orgId: string; canEdit: boolean }) {
  const today = p.today;
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 29));
  const [pattern, setPattern] = useState('');
  const [stagger, setStagger] = useState(0);
  const [mode, setMode] = useState<'fill' | 'overwrite'>('fill');
  const [sel, setSel] = useState<Set<string>>(new Set(p.operators.map((o) => o.id)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  const byCode = useMemo(() => new Map(p.shifts.map((s) => [s.code.toUpperCase(), s])), [p.shifts]);
  const tokens = pattern.split(/[\s,]+/).filter(Boolean);
  const unknown = tokens.filter((t) => t !== '-' && !byCode.has(t.toUpperCase()));
  const days = diffDays(start, end) + 1;
  const valid = tokens.length > 0 && unknown.length === 0 && days > 0 && days <= 400 && sel.size > 0;

  function build() {
    const out: { operator_id: string; schedule_date: string; shift_type_id: string }[] = [];
    p.operators.filter((o) => sel.has(o.id)).forEach((o, idx) => {
      for (let i = 0; i < days; i++) {
        const tk = tokens[(((i + idx * stagger) % tokens.length) + tokens.length) % tokens.length];
        if (tk === '-') continue;
        out.push({ operator_id: o.id, schedule_date: addDays(start, i), shift_type_id: byCode.get(tk.toUpperCase())!.id });
      }
    });
    return out;
  }
  const previewCount = valid ? build().length : 0;

  async function run() {
    if (!valid) return;
    if (!confirm(`Generate ${previewCount} assignments for ${sel.size} operators (${mode === 'fill' ? 'only empty days' : 'overwriting existing days'})?`)) return;
    setBusy(true); setMsg(''); setOk(false);
    const sb = supabaseBrowser();
    let rows = build();
    if (mode === 'fill') {
      const taken = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('schedule_assignments').select('operator_id, schedule_date, shift_type_id')
          .in('operator_id', Array.from(sel)).gte('schedule_date', start).lte('schedule_date', end).order('id').range(from, from + 999);
        if (error) { setBusy(false); setMsg(error.message); return; }
        (data ?? []).forEach((r) => { if (r.shift_type_id) taken.add(r.operator_id + r.schedule_date); });
        if (!data || data.length < 1000) break;
      }
      rows = rows.filter((r) => !taken.has(r.operator_id + r.schedule_date));
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('schedule_assignments').upsert(
        rows.slice(i, i + 500).map((r) => ({ ...r, organization_id: p.orgId, area_code_id: null })), { onConflict: 'operator_id,schedule_date' });
      if (error) { setBusy(false); setMsg(`Stopped after ${i} rows: ${error.message}`); return; }
    }
    setBusy(false); setOk(true); setMsg(`Done: ${rows.length} assignments written.`);
  }

  if (!p.canEdit) return <p style={{ padding: 20, color: '#64748b' }}>Only admins and schedulers can generate schedules.</p>;
  return (
    <div style={{ padding: 14, maxWidth: 760 }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 18, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Generate Schedule</h2>
        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Repeat a shift cycle across a date range. Use shift codes separated by spaces; use <code>-</code> to leave a day blank.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13 }}>From <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label style={{ fontSize: 13 }}>To <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <label style={{ fontSize: 13 }}>Cycle pattern
          <input className="input" placeholder="e.g. D D N N R R" value={pattern} onChange={(e) => setPattern(e.target.value)} /></label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 12 }}>
          {p.shifts.map((s) => <button key={s.id} type="button" title={s.description ?? ''} onClick={() => setPattern((x) => (x.trim() + ' ' + s.code).trim())}
            style={{ background: s.background_color, color: s.text_color, border: '1px solid #cbd5e1', borderRadius: 5, padding: '3px 8px', fontWeight: 700, cursor: 'pointer' }}>{s.code}</button>)}
          <button type="button" className="btn" style={{ padding: '3px 8px' }} onClick={() => setPattern((x) => (x.trim() + ' -').trim())}>blank</button>
          <button type="button" className="btn" style={{ padding: '3px 8px' }} onClick={() => setPattern('')}>clear</button>
        </div>
        {unknown.length > 0 && <span style={{ color: '#b91c1c', fontSize: 12 }}>Unknown shift code(s): {unknown.join(', ')}</span>}
        <label style={{ fontSize: 13 }}>Stagger between operators (days of offset per operator)
          <input type="number" className="input" style={{ width: 100 }} value={stagger} onChange={(e) => setStagger(+e.target.value)} /></label>
        <label style={{ fontSize: 13 }}>Existing entries
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as 'fill' | 'overwrite')}>
            <option value="fill">Only fill empty days</option><option value="overwrite">Overwrite existing days</option></select></label>
        <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }}>
          <legend>Operators ({sel.size}/{p.operators.length})</legend>
          <button type="button" className="btn" style={{ padding: '2px 8px', marginRight: 6 }} onClick={() => setSel(new Set(p.operators.map((o) => o.id)))}>All</button>
          <button type="button" className="btn" style={{ padding: '2px 8px' }} onClick={() => setSel(new Set())}>None</button>
          <div style={{ marginTop: 6, maxHeight: 160, overflow: 'auto' }}>
            {p.operators.map((o) => <label key={o.id} style={{ display: 'inline-flex', gap: 4, margin: '2px 12px 2px 0' }}>
              <input type="checkbox" checked={sel.has(o.id)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(o.id) : n.delete(o.id); return n; })} />{o.full_name}</label>)}
          </div>
        </fieldset>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={run}>{busy ? 'Generating…' : 'Generate'}</button>
          <span style={{ fontSize: 12, color: '#64748b' }}>{valid ? `${previewCount} assignments over ${days} days` : days > 400 ? 'Range too long (max 400 days)' : days <= 0 ? 'End must be after start' : ''}</span>
        </div>
        {msg && <p role="alert" style={{ margin: 0, fontSize: 13, color: ok ? '#15803d' : '#b91c1c' }}>{msg}</p>}
      </div>
    </div>
  );
}
