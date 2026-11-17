'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Op = { id?: string; full_name: string; position: string | null; phone_number: string | null; default_station: string | null; sort_order: number; is_active: boolean };
type Shift = { id?: string; code: string; description: string | null; duration_hours: number; is_off: boolean; background_color: string; text_color: string };
type Area = { id?: string; code: string; name: string | null; category: string; background_color: string; text_color: string };
type Tab = 'operators' | 'shifts' | 'areas';

const cell = { padding: 3, borderBottom: '1px solid #e2e8f0' };
const inp = { width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 12 } as const;

export default function Setup(p: { operators: Op[]; shifts: Shift[]; areas: Area[]; orgId: string; isAdmin: boolean; error: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('operators');
  const [ops, setOps] = useState(p.operators);
  const [shifts, setShifts] = useState(p.shifts);
  const [areas, setAreas] = useState(p.areas);
  const [msg, setMsg] = useState(p.error);
  const [busy, setBusy] = useState('');
  useEffect(() => setOps(p.operators), [p.operators]);
  useEffect(() => setShifts(p.shifts), [p.shifts]);
  useEffect(() => setAreas(p.areas), [p.areas]);

  async function save(table: string, row: { id?: string }, key: string) {
    setBusy(key); setMsg('');
    const { id, ...rest } = row;
    const sb = supabaseBrowser();
    const { error } = id ? await sb.from(table).update(rest).eq('id', id) : await sb.from(table).insert({ ...rest, organization_id: p.orgId });
    setBusy('');
    if (error) setMsg(error.message); else router.refresh();
  }
  async function del(table: string, id: string | undefined, idx: number, set: (f: (x: any[]) => any[]) => void) {
    if (!id) { set((x) => x.filter((_, i) => i !== idx)); return; }
    if (!confirm('Delete this entry? Schedule entries using it may be affected.')) return;
    const { error } = await supabaseBrowser().from(table).delete().eq('id', id);
    if (error) setMsg(error.message.includes('foreign key') ? 'Cannot delete: it is still used in the schedule.' : error.message); else router.refresh();
  }
  const upd = <T,>(set: (f: (x: T[]) => T[]) => void, i: number, patch: Partial<T>) => set((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (!p.isAdmin) return <p style={{ padding: 20, color: '#64748b' }}>Only admins can manage operators and setup.</p>;
  const tabBtn = (t: Tab, l: string) => <button className="btn" onClick={() => setTab(t)} style={{ fontWeight: 700, background: tab === t ? '#0f172a' : '#fff', color: tab === t ? '#fff' : '#0f172a' }}>{l}</button>;
  const Color = ({ v, on }: { v: string; on: (c: string) => void }) => <input type="color" value={v} onChange={(e) => on(e.target.value)} style={{ width: 34, height: 26, padding: 0, border: '1px solid #cbd5e1' }} />;

  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' }}>
        {tabBtn('operators', 'Operators')}{tabBtn('shifts', 'Shift types')}{tabBtn('areas', 'Areas & leave codes')}
        {msg && <span role="alert" style={{ color: '#b91c1c', fontSize: 12 }}>{msg}</span>}
      </div>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
        {tab === 'operators' && (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead><tr>{['#', 'Full name', 'Position', 'Phone', 'Default station', 'Active', ''].map((h) => <th key={h} style={{ ...cell, textAlign: 'left', background: '#f1f5f9' }}>{h}</th>)}</tr></thead>
            <tbody>
              {ops.map((o, i) => (
                <tr key={o.id ?? `n${i}`}>
                  <td style={{ ...cell, width: 60 }}><input style={inp} type="number" value={o.sort_order} onChange={(e) => upd(setOps, i, { sort_order: +e.target.value })} /></td>
                  <td style={cell}><input style={inp} value={o.full_name} onChange={(e) => upd(setOps, i, { full_name: e.target.value })} /></td>
                  <td style={cell}><input style={inp} value={o.position ?? ''} onChange={(e) => upd(setOps, i, { position: e.target.value })} /></td>
                  <td style={cell}><input style={inp} value={o.phone_number ?? ''} onChange={(e) => upd(setOps, i, { phone_number: e.target.value })} /></td>
                  <td style={cell}><input style={inp} value={o.default_station ?? ''} onChange={(e) => upd(setOps, i, { default_station: e.target.value })} /></td>
                  <td style={{ ...cell, textAlign: 'center' }}><input type="checkbox" checked={o.is_active} onChange={(e) => upd(setOps, i, { is_active: e.target.checked })} /></td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button className="btn" style={{ padding: '3px 8px' }} disabled={!o.full_name.trim() || busy === `o${i}`} onClick={() => save('operators', o, `o${i}`)}>Save</button>{' '}
                    <button className="btn" style={{ padding: '3px 8px', color: '#b91c1c' }} onClick={() => del('operators', o.id, i, setOps)}>✕</button></td>
                </tr>))}
            </tbody>
            <tfoot><tr><td colSpan={7} style={cell}><button className="btn" onClick={() => setOps((x) => [...x, { full_name: '', position: '', phone_number: '', default_station: '', sort_order: x.length, is_active: true }])}>+ Add operator</button>
              <span style={{ marginLeft: 10, color: '#64748b' }}>Tip: untick “Active” instead of deleting to keep history.</span></td></tr></tfoot>
          </table>)}
        {tab === 'shifts' && (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead><tr>{['Code', 'Description', 'Hours', 'Off day', 'BG', 'Text', 'Preview', ''].map((h) => <th key={h} style={{ ...cell, textAlign: 'left', background: '#f1f5f9' }}>{h}</th>)}</tr></thead>
            <tbody>
              {shifts.map((s, i) => (
                <tr key={s.id ?? `n${i}`}>
                  <td style={{ ...cell, width: 80 }}><input style={inp} value={s.code} onChange={(e) => upd(setShifts, i, { code: e.target.value })} /></td>
                  <td style={cell}><input style={inp} value={s.description ?? ''} onChange={(e) => upd(setShifts, i, { description: e.target.value })} /></td>
                  <td style={{ ...cell, width: 70 }}><input style={inp} type="number" step="0.5" value={s.duration_hours} onChange={(e) => upd(setShifts, i, { duration_hours: +e.target.value })} /></td>
                  <td style={{ ...cell, textAlign: 'center' }}><input type="checkbox" checked={s.is_off} onChange={(e) => upd(setShifts, i, { is_off: e.target.checked })} /></td>
                  <td style={cell}><Color v={s.background_color} on={(c) => upd(setShifts, i, { background_color: c })} /></td>
                  <td style={cell}><Color v={s.text_color} on={(c) => upd(setShifts, i, { text_color: c })} /></td>
                  <td style={cell}><span style={{ background: s.background_color, color: s.text_color, padding: '3px 10px', borderRadius: 4, fontWeight: 800 }}>{s.code || '?'}</span></td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button className="btn" style={{ padding: '3px 8px' }} disabled={!s.code.trim() || busy === `s${i}`} onClick={() => save('shift_types', s, `s${i}`)}>Save</button>{' '}
                    <button className="btn" style={{ padding: '3px 8px', color: '#b91c1c' }} onClick={() => del('shift_types', s.id, i, setShifts)}>✕</button></td>
                </tr>))}
            </tbody>
            <tfoot><tr><td colSpan={8} style={cell}><button className="btn" onClick={() => setShifts((x) => [...x, { code: '', description: '', duration_hours: 8, is_off: false, background_color: '#ffffff', text_color: '#0f172a' }])}>+ Add shift type</button></td></tr></tfoot>
          </table>)}
        {tab === 'areas' && (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead><tr>{['Code', 'Name', 'Category', 'BG', 'Text', 'Preview', ''].map((h) => <th key={h} style={{ ...cell, textAlign: 'left', background: '#f1f5f9' }}>{h}</th>)}</tr></thead>
            <tbody>
              {areas.map((a, i) => (
                <tr key={a.id ?? `n${i}`}>
                  <td style={{ ...cell, width: 80 }}><input style={inp} value={a.code} onChange={(e) => upd(setAreas, i, { code: e.target.value })} /></td>
                  <td style={cell}><input style={inp} value={a.name ?? ''} onChange={(e) => upd(setAreas, i, { name: e.target.value })} /></td>
                  <td style={{ ...cell, width: 110 }}><select style={inp} value={a.category} onChange={(e) => upd(setAreas, i, { category: e.target.value })}><option value="station">Station</option><option value="leave">Leave</option><option value="holiday">Holiday</option></select></td>
                  <td style={cell}><Color v={a.background_color} on={(c) => upd(setAreas, i, { background_color: c })} /></td>
                  <td style={cell}><Color v={a.text_color} on={(c) => upd(setAreas, i, { text_color: c })} /></td>
                  <td style={cell}><span style={{ background: a.background_color, color: a.text_color, padding: '3px 10px', borderRadius: 4, fontWeight: 800 }}>{a.code || '?'}</span></td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button className="btn" style={{ padding: '3px 8px' }} disabled={!a.code.trim() || busy === `a${i}`} onClick={() => save('area_codes', a, `a${i}`)}>Save</button>{' '}
                    <button className="btn" style={{ padding: '3px 8px', color: '#b91c1c' }} onClick={() => del('area_codes', a.id, i, setAreas)}>✕</button></td>
                </tr>))}
            </tbody>
            <tfoot><tr><td colSpan={7} style={cell}><button className="btn" onClick={() => setAreas((x) => [...x, { code: '', name: '', category: 'station', background_color: '#f1f5f9', text_color: '#1e293b' }])}>+ Add area / leave code</button></td></tr></tfoot>
          </table>)}
      </div>
    </div>
  );
}
