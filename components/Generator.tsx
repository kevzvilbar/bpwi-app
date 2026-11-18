'use client';

import { useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

type Op = { id: string; full_name: string };
type Shift = { id: string; code: string; description: string | null; is_off: boolean; background_color: string; text_color: string };
type Area = { id: string; code: string; category: string };

const addDays = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const diffDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export default function Generator(p: {
  today: string;
  operators: Op[];
  shifts: Shift[];
  areas?: Area[];
  holidays?: Array<{ holiday_date: string; name: string; holiday_type: string }>;
  orgId: string;
  canEdit: boolean;
}) {
  const today = p.today;
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 29));
  const [pattern, setPattern] = useState('');
  const [stagger, setStagger] = useState(0);
  const [mode, setMode] = useState<'fill' | 'overwrite'>('fill');
  const [markHolidays, setMarkHolidays] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set(p.operators.map((o) => o.id)));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  const byCode = useMemo(() => new Map(p.shifts.map((s) => [s.code.toUpperCase(), s])), [p.shifts]);
  const shiftIsOff = useMemo(() => new Map(p.shifts.map((s) => [s.id, s.is_off])), [p.shifts]);
  const areaBy = useMemo(() => new Map((p.areas ?? []).map((a) => [a.id, a])), [p.areas]);
  const holidayArea = useMemo(
    () => (p.areas ?? []).find((a) => a.category === 'holiday') ?? (p.areas ?? []).find((a) => a.code.toUpperCase() === 'H'),
    [p.areas],
  );
  const holidayDateSet = useMemo(
    () => new Set((p.holidays ?? []).filter((h) => h.holiday_date >= start && h.holiday_date <= end).map((h) => h.holiday_date)),
    [p.holidays, start, end],
  );
  const tokens = pattern.split(/[\s,]+/).filter(Boolean);
  const unknown = tokens.filter((t) => t !== '-' && !byCode.has(t.toUpperCase()));
  const days = diffDays(start, end) + 1;
  const valid = tokens.length > 0 && unknown.length === 0 && days > 0 && days <= 400 && sel.size > 0;

  const selectedOps = useMemo(() => p.operators.filter((o) => sel.has(o.id)), [p.operators, sel]);
  const previewDays = useMemo(() => {
    if (!valid) return [];
    return Array.from({ length: Math.min(7, days) }, (_, i) => addDays(start, i));
  }, [days, start, valid]);

  function build() {
    const out: { operator_id: string; schedule_date: string; shift_type_id: string }[] = [];
    selectedOps.forEach((o, idx) => {
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
    setConfirmOpen(false);
    setBusy(true);
    setMsg('');
    setOk(false);
    const sb = supabaseBrowser();
    const rawRows = build();

    const taken = new Set<string>();
    const existingArea = new Map<string, string | null>();
    const protectedLeaveDates = new Set<string>();

    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from('schedule_assignments')
        .select('operator_id, schedule_date, shift_type_id, area_code_id')
        .in('operator_id', Array.from(sel))
        .gte('schedule_date', start)
        .lte('schedule_date', end)
        .order('id')
        .range(from, from + 999);
      if (error) {
        setBusy(false);
        setMsg(error.message);
        return;
      }
      (data ?? []).forEach((r) => {
        const k = `${r.operator_id}:${r.schedule_date}`;
        if (r.shift_type_id || r.area_code_id) taken.add(k);
        if (r.area_code_id) {
          existingArea.set(k, r.area_code_id);
          const a = areaBy.get(r.area_code_id);
          if (a && ((a.category === 'leave' && a.code.toUpperCase() !== 'RD') || a.category === 'holiday')) {
            protectedLeaveDates.add(k);
          }
        }
      });
      if (!data || data.length < 1000) break;
    }

    let skippedProtected = 0;
    const rows: { operator_id: string; schedule_date: string; shift_type_id: string; area_code_id: string | null }[] = [];
    for (const r of rawRows) {
      const k = `${r.operator_id}:${r.schedule_date}`;
      if (mode === 'fill' && taken.has(k)) continue;
      if (mode === 'overwrite' && protectedLeaveDates.has(k)) {
        skippedProtected += 1;
        continue;
      }
      const prevAreaId = existingArea.get(k) ?? null;
      const prevArea = prevAreaId ? areaBy.get(prevAreaId) : undefined;
      const isPrevRest = Boolean(prevArea && (prevArea.category === 'rest' || prevArea.code.toUpperCase() === 'RD'));
      const nextIsOff = Boolean(shiftIsOff.get(r.shift_type_id));
      const preservedArea = isPrevRest && !nextIsOff ? null : prevAreaId;
      const finalArea =
        markHolidays && holidayArea && holidayDateSet.has(r.schedule_date) && !preservedArea
          ? holidayArea.id
          : preservedArea;
      rows.push({ ...r, area_code_id: finalArea });
    }

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb
        .from('schedule_assignments')
        .upsert(
          rows.slice(i, i + 500).map((r) => ({ ...r, organization_id: p.orgId })),
          { onConflict: 'operator_id,schedule_date' },
        );
      if (error) {
        setBusy(false);
        setMsg(`Stopped after ${i} rows: ${error.message}`);
        return;
      }
    }
    setBusy(false);
    setOk(true);
    setMsg(
      `Done: ${rows.length} assignments written${skippedProtected > 0 ? ` (${skippedProtected} leave/holiday day(s) preserved)` : ''}.`,
    );
  }

  if (!p.canEdit) {
    return <p style={{ padding: 20, color: 'var(--text-secondary)' }}>Only admins and schedulers can generate schedules.</p>;
  }

  return (
    <div style={{ padding: 14, maxWidth: 860, margin: '0 auto' }}>
      <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Generate Schedule</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
          Repeat a shift cycle across a date range. Use shift codes separated by spaces; use <code>-</code> to leave a day blank.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, flex: '1 1 160px' }}>
            From <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label style={{ fontSize: 13, flex: '1 1 160px' }}>
            To <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <label style={{ fontSize: 13 }}>
          Cycle pattern
          <input className="input" placeholder="e.g. 10-7 10-7 12-8 12-8 OFF" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </label>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
          {p.shifts.map((s) => (
            <button
              key={s.id}
              type="button"
              title={s.description ?? ''}
              onClick={() => setPattern((x) => (x.trim() + ' ' + s.code).trim())}
              style={{
                background: s.background_color,
                color: s.text_color,
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '5px 10px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {s.code}
            </button>
          ))}
          <button type="button" className="btn" onClick={() => setPattern((x) => (x.trim() + ' -').trim())}>
            blank (-)
          </button>
          <button type="button" className="btn" onClick={() => setPattern('')}>
            clear
          </button>
        </div>

        {unknown.length > 0 && (
          <span role="alert" style={{ color: 'var(--danger)', fontSize: 12.5 }}>
            Unknown shift code(s): {unknown.join(', ')}
          </span>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, flex: '1 1 200px' }}>
            Stagger between operators (days)
            <input type="number" className="input" value={stagger} onChange={(e) => setStagger(+e.target.value)} />
          </label>
          <label style={{ fontSize: 13, flex: '1 1 220px' }}>
            Existing entries
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value as 'fill' | 'overwrite')}>
              <option value="fill">Only fill empty days</option>
              <option value="overwrite">Overwrite existing days</option>
            </select>
          </label>
        </div>

        <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, padding: 10 }}>
          <legend>
            Operators ({sel.size}/{p.operators.length})
          </legend>
          <button type="button" className="btn" style={{ marginRight: 6 }} onClick={() => setSel(new Set(p.operators.map((o) => o.id)))}>
            All
          </button>
          <button type="button" className="btn" onClick={() => setSel(new Set())}>
            None
          </button>
          <div style={{ marginTop: 8, maxHeight: 160, overflow: 'auto', display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
            {p.operators.map((o) => (
              <label key={o.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <input
                  type="checkbox"
                  checked={sel.has(o.id)}
                  onChange={(e) =>
                    setSel((s) => {
                      const n = new Set(s);
                      e.target.checked ? n.add(o.id) : n.delete(o.id);
                      return n;
                    })
                  }
                />
                {o.full_name}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Live 7-Day Preview */}
        {holidayDateSet.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--surface-muted)', border: '1px solid var(--border-light)', fontSize: 12.5 }}>
            <span>
              <b>{holidayDateSet.size}</b> organization holiday{holidayDateSet.size === 1 ? '' : 's'} fall within {start} – {end}.
            </span>
            {holidayArea && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                <input type="checkbox" checked={markHolidays} onChange={(e) => setMarkHolidays(e.target.checked)} />
                Mark holidays as {holidayArea.code} (off/admin)
              </label>
            )}
          </div>
        )}
        {valid && previewDays.length > 0 && (
          <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div style={{ padding: '6px 10px', fontSize: 12, fontWeight: 700, background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
              Preview (first {previewDays.length} days · {Math.min(5, selectedOps.length)} of {selectedOps.length} operators)
            </div>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid var(--border)' }}>Operator</th>
                  {previewDays.map((d) => (
                    <th key={d} style={{ padding: '5px 6px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                      {d.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedOps.slice(0, 5).map((o, idx) => (
                  <tr key={o.id}>
                    <td style={{ padding: '4px 8px', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>{o.full_name}</td>
                    {previewDays.map((d, i) => {
                      const tk = tokens[(((i + idx * stagger) % tokens.length) + tokens.length) % tokens.length];
                      const s = tk === '-' ? undefined : byCode.get(tk.toUpperCase());
                      return (
                        <td
                          key={d}
                          style={{
                            padding: '4px 6px',
                            textAlign: 'center',
                            fontWeight: 700,
                            borderBottom: '1px solid var(--border-light)',
                            background: s?.background_color ?? 'var(--surface)',
                            color: s?.text_color ?? 'var(--text-muted)',
                          }}
                        >
                          {s?.code ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => setConfirmOpen(true)}>
            {busy ? 'Generating…' : 'Generate'}
          </button>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            {valid
              ? `${previewCount} assignments over ${days} days`
              : days > 400
                ? 'Range too long (max 400 days)'
                : days <= 0
                  ? 'End must be after start'
                  : ''}
          </span>
        </div>

        {msg && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: ok ? '#15803d' : 'var(--danger)' }}>
            {msg}
          </p>
        )}
      </div>

      {confirmOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="gen-confirm-title" onClick={() => setConfirmOpen(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, display: 'grid', gap: 12 }}>
            <h2 id="gen-confirm-title" style={{ margin: 0, fontSize: 17 }}>
              Confirm Schedule Generation
            </h2>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
              Generate <b>{previewCount}</b> assignments for <b>{sel.size}</b> operators ({mode === 'fill' ? 'filling empty days only' : 'overwriting existing days'})?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={run}>
                Confirm &amp; Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
