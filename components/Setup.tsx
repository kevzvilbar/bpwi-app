'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

type Op = {
  id?: string;
  full_name: string;
  position: string | null;
  phone_number: string | null;
  default_station: string | null;
  sort_order: number;
  is_active: boolean;
};
type Shift = {
  id?: string;
  code: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_hours: number;
  is_off: boolean;
  background_color: string;
  text_color: string;
};
type Area = {
  id?: string;
  code: string;
  name: string | null;
  category: string;
  background_color: string;
  text_color: string;
};
type UserProfile = {
  id: string;
  full_name: string | null;
  role: 'admin' | 'scheduler' | 'operator' | 'viewer';
  is_active: boolean;
  operator_id?: string | null;
};

type Tab = 'operators' | 'shifts' | 'areas' | 'users';

const cell = { padding: 4, borderBottom: '1px solid var(--border-light)' };
const inp = {
  width: '100%',
  padding: '5px 7px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 12.5,
  background: 'var(--surface)',
  color: 'var(--text)',
} as const;

export default function Setup(p: {
  operators: Op[];
  shifts: Shift[];
  areas: Area[];
  users: UserProfile[];
  orgId: string;
  isAdmin: boolean;
  error: string;
}) {
  const [tab, setTab] = useState<Tab>('operators');
  const [ops, setOps] = useState<Op[]>(p.operators);
  const [shifts, setShifts] = useState<Shift[]>(p.shifts);
  const [areas, setAreas] = useState<Area[]>(p.areas);
  const [users, setUsers] = useState<UserProfile[]>(p.users);
  const [msg, setMsg] = useState(p.error);
  const [savedKey, setSavedKey] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmDel, setConfirmDel] = useState<{ table: string; id: string; idx: number; label: string } | null>(null);

  async function saveRow<T extends { id?: string }>(
    table: string,
    row: T,
    idx: number,
    key: string,
    setter: React.Dispatch<React.SetStateAction<T[]>>,
  ) {
    setBusy(key);
    setMsg('');
    setSavedKey('');
    const { id, ...rest } = row;
    const sb = supabaseBrowser();
    const res = id
      ? await sb.from(table).update(rest as Record<string, unknown>).eq('id', id).select().single()
      : await sb.from(table).insert({ ...rest, organization_id: p.orgId } as Record<string, unknown>).select().single();

    setBusy('');
    if (res.error) {
      setMsg(res.error.message);
      return;
    }
    if (res.data) {
      setter((list) => list.map((item, j) => (j === idx ? (res.data as T) : item)));
    }
    setSavedKey(key);
    setTimeout(() => setSavedKey((cur) => (cur === key ? '' : cur)), 2000);
  }

  async function executeDelete() {
    if (!confirmDel) return;
    const { table, id, idx } = confirmDel;
    setConfirmDel(null);
    const { error } = await supabaseBrowser().from(table).delete().eq('id', id);
    if (error) {
      setMsg(error.message.includes('foreign key') ? 'Cannot delete: it is still used in the schedule.' : error.message);
      return;
    }
    if (table === 'operators') setOps((x) => x.filter((_, i) => i !== idx));
    else if (table === 'shift_types') setShifts((x) => x.filter((_, i) => i !== idx));
    else if (table === 'area_codes') setAreas((x) => x.filter((_, i) => i !== idx));
  }

  function requestDelete(table: string, id: string | undefined, idx: number, label: string, setter: (fn: (x: any[]) => any[]) => void) {
    if (!id) {
      setter((x) => x.filter((_, i) => i !== idx));
      return;
    }
    setConfirmDel({ table, id, idx, label });
  }

  const upd = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number, patch: Partial<T>) =>
    setter((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (!p.isAdmin) {
    return <p style={{ padding: 20, color: '#475569' }}>Only admins can manage operators and setup.</p>;
  }

  const tabBtn = (t: Tab, l: string) => (
    <button
      className="btn"
      onClick={() => setTab(t)}
      aria-current={tab === t ? 'page' : undefined}
      style={{
        fontWeight: 700,
        background: tab === t ? 'var(--primary)' : 'var(--surface)',
        color: tab === t ? 'var(--primary-fg)' : 'var(--text)',
      }}
    >
      {l}
    </button>
  );

  const Color = ({ v, on }: { v: string; on: (c: string) => void }) => (
    <input type="color" value={v} onChange={(e) => on(e.target.value)} style={{ width: 34, height: 28, padding: 0, border: '1px solid #cbd5e1', borderRadius: 4 }} />
  );

  const pendingUsers = users.filter((u) => !u.is_active).length;

  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {tabBtn('operators', `Operators (${ops.length})`)}
        {tabBtn('shifts', `Shift types (${shifts.length})`)}
        {tabBtn('areas', `Areas & leave (${areas.length})`)}
        {tabBtn('users', `Users & roles (${users.length}${pendingUsers ? ` · ${pendingUsers} pending` : ''})`)}
        {msg && (
          <span role="alert" style={{ color: '#b91c1c', fontSize: 12.5, fontWeight: 500 }}>
            {msg}
          </span>
        )}
      </div>

      {/* Mobile Cards (<= 640px) */}
      <div className="responsive-cards">
        {tab === 'operators' && (
          <>
            {ops.map((o, i) => (
              <div key={o.id ?? `mn${i}`} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 12, width: 68 }}>
                    Order
                    <input className="input" type="number" value={o.sort_order} onChange={(e) => upd(setOps, i, { sort_order: +e.target.value })} />
                  </label>
                  <label style={{ fontSize: 12, flex: 1 }}>
                    Full name
                    <input className="input" value={o.full_name} onChange={(e) => upd(setOps, i, { full_name: e.target.value })} />
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 12 }}>
                    Position
                    <input className="input" value={o.position ?? ''} onChange={(e) => upd(setOps, i, { position: e.target.value })} />
                  </label>
                  <label style={{ fontSize: 12 }}>
                    Default station
                    <input className="input" value={o.default_station ?? ''} onChange={(e) => upd(setOps, i, { default_station: e.target.value })} />
                  </label>
                </div>
                <label style={{ fontSize: 12 }}>
                  Phone
                  <input className="input" value={o.phone_number ?? ''} onChange={(e) => upd(setOps, i, { phone_number: e.target.value })} />
                </label>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
                  <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={o.is_active} onChange={(e) => upd(setOps, i, { is_active: e.target.checked })} />
                    Active
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary" disabled={!o.full_name.trim() || busy === `o${i}`} onClick={() => saveRow('operators', o, i, `o${i}`, setOps)}>
                      {savedKey === `o${i}` ? 'Saved ✓' : busy === `o${i}` ? '…' : 'Save'}
                    </button>
                    <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => requestDelete('operators', o.id, i, o.full_name || 'this operator', setOps as any)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button
              className="btn"
              onClick={() => setOps((x) => [...x, { full_name: '', position: '', phone_number: '', default_station: '', sort_order: x.length, is_active: true }])}
            >
              + Add operator
            </button>
          </>
        )}

        {tab === 'shifts' && (
          <>
            {shifts.map((s, i) => (
              <div key={s.id ?? `msn${i}`} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                  <label style={{ fontSize: 12, width: 90 }}>
                    Code
                    <input className="input" value={s.code} onChange={(e) => upd(setShifts, i, { code: e.target.value })} />
                  </label>
                  <label style={{ fontSize: 12, flex: 1 }}>
                    Description
                    <input className="input" value={s.description ?? ''} onChange={(e) => upd(setShifts, i, { description: e.target.value })} />
                  </label>
                  <span style={{ background: s.background_color, color: s.text_color, padding: '8px 12px', borderRadius: 6, fontWeight: 800, border: '1px solid var(--border)' }}>
                    {s.code || '?'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 76px', gap: 8 }}>
                  <label style={{ fontSize: 12 }}>
                    Start
                    <input className="input" type="time" value={s.start_time?.slice(0, 5) ?? ''} onChange={(e) => upd(setShifts, i, { start_time: e.target.value || null })} />
                  </label>
                  <label style={{ fontSize: 12 }}>
                    End
                    <input className="input" type="time" value={s.end_time?.slice(0, 5) ?? ''} onChange={(e) => upd(setShifts, i, { end_time: e.target.value || null })} />
                  </label>
                  <label style={{ fontSize: 12 }}>
                    Hrs
                    <input className="input" type="number" step="0.5" value={s.duration_hours} onChange={(e) => upd(setShifts, i, { duration_hours: +e.target.value })} />
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      BG <Color v={s.background_color} on={(c) => upd(setShifts, i, { background_color: c })} />
                    </label>
                    <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      Text <Color v={s.text_color} on={(c) => upd(setShifts, i, { text_color: c })} />
                    </label>
                    <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" checked={s.is_off} onChange={(e) => upd(setShifts, i, { is_off: e.target.checked })} /> Off
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary" disabled={!s.code.trim() || busy === `s${i}`} onClick={() => saveRow('shift_types', s, i, `s${i}`, setShifts)}>
                      {savedKey === `s${i}` ? 'Saved ✓' : busy === `s${i}` ? '…' : 'Save'}
                    </button>
                    <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => requestDelete('shift_types', s.id, i, s.code || 'this shift', setShifts as any)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button
              className="btn"
              onClick={() => setShifts((x) => [...x, { code: '', description: '', start_time: '06:00', end_time: '14:00', duration_hours: 8, is_off: false, background_color: '#ffffff', text_color: '#0f172a' }])}
            >
              + Add shift type
            </button>
          </>
        )}

        {tab === 'areas' && (
          <>
            {areas.map((a, i) => (
              <div key={a.id ?? `man${i}`} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                  <label style={{ fontSize: 12, width: 84 }}>
                    Code
                    <input className="input" value={a.code} onChange={(e) => upd(setAreas, i, { code: e.target.value })} />
                  </label>
                  <label style={{ fontSize: 12, flex: 1 }}>
                    Name
                    <input className="input" value={a.name ?? ''} onChange={(e) => upd(setAreas, i, { name: e.target.value })} />
                  </label>
                  <span style={{ background: a.background_color, color: a.text_color, padding: '8px 12px', borderRadius: 6, fontWeight: 800, border: '1px solid var(--border)' }}>
                    {a.code || '?'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select className="input" style={{ width: 'auto' }} value={a.category} onChange={(e) => upd(setAreas, i, { category: e.target.value })}>
                      <option value="station">Station</option>
                      <option value="leave">Leave</option>
                      <option value="holiday">Holiday</option>
                    </select>
                    <Color v={a.background_color} on={(c) => upd(setAreas, i, { background_color: c })} />
                    <Color v={a.text_color} on={(c) => upd(setAreas, i, { text_color: c })} />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary" disabled={!a.code.trim() || busy === `a${i}`} onClick={() => saveRow('area_codes', a, i, `a${i}`, setAreas)}>
                      {savedKey === `a${i}` ? 'Saved ✓' : busy === `a${i}` ? '…' : 'Save'}
                    </button>
                    <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => requestDelete('area_codes', a.id, i, a.code || 'this area code', setAreas as any)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button
              className="btn"
              onClick={() => setAreas((x) => [...x, { code: '', name: '', category: 'station', background_color: '#f1f5f9', text_color: '#1e293b' }])}
            >
              + Add area / leave code
            </button>
          </>
        )}

        {tab === 'users' &&
          users.map((u, i) => (
            <div key={u.id} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12 }}>
                Full name
                <input className="input" value={u.full_name ?? ''} placeholder="Full name" onChange={(e) => upd(setUsers, i, { full_name: e.target.value })} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ fontSize: 12 }}>
                  Role
                  <select className="input" value={u.role} onChange={(e) => upd(setUsers, i, { role: e.target.value as UserProfile['role'] })}>
                    <option value="admin">admin</option>
                    <option value="scheduler">scheduler</option>
                    <option value="operator">operator</option>
                    <option value="viewer">viewer</option>
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>
                  Linked Operator
                  <select className="input" value={u.operator_id ?? ''} onChange={(e) => upd(setUsers, i, { operator_id: e.target.value || null })}>
                    <option value="">(unlinked)</option>
                    {ops.filter((o) => o.id).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.full_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={u.is_active} onChange={(e) => upd(setUsers, i, { is_active: e.target.checked })} />
                  Active (Approved)
                </label>
                <button className="btn btn-primary" disabled={busy === `u${i}`} onClick={() => saveRow('user_profiles', u, i, `u${i}`, setUsers)}>
                  {savedKey === `u${i}` ? 'Saved ✓' : busy === `u${i}` ? '…' : 'Save'}
                </button>
              </div>
            </div>
          ))}
      </div>

      {/* Desktop Table (> 640px) */}
      <div className="card responsive-table-wrap" style={{ overflow: 'auto' }}>
        {tab === 'operators' && (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
            <thead>
              <tr>
                {['#', 'Full name', 'Position', 'Phone', 'Default station', 'Active', ''].map((h) => (
                  <th key={h} style={{ ...cell, padding: '8px 6px', textAlign: 'left', background: 'var(--surface-muted)', color: 'var(--text)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ops.map((o, i) => (
                <tr key={o.id ?? `n${i}`}>
                  <td style={{ ...cell, width: 64 }}>
                    <input style={inp} type="number" value={o.sort_order} onChange={(e) => upd(setOps, i, { sort_order: +e.target.value })} />
                  </td>
                  <td style={cell}>
                    <input style={inp} value={o.full_name} onChange={(e) => upd(setOps, i, { full_name: e.target.value })} />
                  </td>
                  <td style={cell}>
                    <input style={inp} value={o.position ?? ''} onChange={(e) => upd(setOps, i, { position: e.target.value })} />
                  </td>
                  <td style={cell}>
                    <input style={inp} value={o.phone_number ?? ''} onChange={(e) => upd(setOps, i, { phone_number: e.target.value })} />
                  </td>
                  <td style={cell}>
                    <input style={inp} value={o.default_station ?? ''} onChange={(e) => upd(setOps, i, { default_station: e.target.value })} />
                  </td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <input type="checkbox" checked={o.is_active} onChange={(e) => upd(setOps, i, { is_active: e.target.checked })} />
                  </td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button
                      className="btn"
                      style={{ padding: '4px 9px' }}
                      disabled={!o.full_name.trim() || busy === `o${i}`}
                      onClick={() => saveRow('operators', o, i, `o${i}`, setOps)}
                    >
                      {savedKey === `o${i}` ? 'Saved ✓' : busy === `o${i}` ? '…' : 'Save'}
                    </button>{' '}
                    <button
                      className="btn"
                      style={{ padding: '4px 9px', color: '#b91c1c' }}
                      onClick={() => requestDelete('operators', o.id, i, o.full_name || 'this operator', setOps as any)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7} style={{ ...cell, padding: 8 }}>
                  <button
                    className="btn"
                    onClick={() =>
                      setOps((x) => [
                        ...x,
                        { full_name: '', position: '', phone_number: '', default_station: '', sort_order: x.length, is_active: true },
                      ])
                    }
                  >
                    + Add operator
                  </button>
                  <span style={{ marginLeft: 10, color: '#475569' }}>Tip: untick “Active” instead of deleting to keep history.</span>
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {tab === 'shifts' && (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
            <thead>
              <tr>
                {['Code', 'Description', 'Start', 'End', 'Hours', 'Off day', 'BG', 'Text', 'Preview', ''].map((h) => (
                  <th key={h} style={{ ...cell, padding: '8px 6px', textAlign: 'left', background: 'var(--surface-muted)', color: 'var(--text)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shifts.map((s, i) => (
                <tr key={s.id ?? `n${i}`}>
                  <td style={{ ...cell, width: 76 }}>
                    <input style={inp} value={s.code} onChange={(e) => upd(setShifts, i, { code: e.target.value })} />
                  </td>
                  <td style={cell}>
                    <input style={inp} value={s.description ?? ''} onChange={(e) => upd(setShifts, i, { description: e.target.value })} />
                  </td>
                  <td style={{ ...cell, width: 105 }}>
                    <input
                      style={inp}
                      type="time"
                      value={s.start_time?.slice(0, 5) ?? ''}
                      onChange={(e) => upd(setShifts, i, { start_time: e.target.value || null })}
                    />
                  </td>
                  <td style={{ ...cell, width: 105 }}>
                    <input
                      style={inp}
                      type="time"
                      value={s.end_time?.slice(0, 5) ?? ''}
                      onChange={(e) => upd(setShifts, i, { end_time: e.target.value || null })}
                    />
                  </td>
                  <td style={{ ...cell, width: 68 }}>
                    <input style={inp} type="number" step="0.5" value={s.duration_hours} onChange={(e) => upd(setShifts, i, { duration_hours: +e.target.value })} />
                  </td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <input type="checkbox" checked={s.is_off} onChange={(e) => upd(setShifts, i, { is_off: e.target.checked })} />
                  </td>
                  <td style={cell}>
                    <Color v={s.background_color} on={(c) => upd(setShifts, i, { background_color: c })} />
                  </td>
                  <td style={cell}>
                    <Color v={s.text_color} on={(c) => upd(setShifts, i, { text_color: c })} />
                  </td>
                  <td style={cell}>
                    <span style={{ background: s.background_color, color: s.text_color, padding: '3px 10px', borderRadius: 4, fontWeight: 800, border: '1px solid #cbd5e1' }}>
                      {s.code || '?'}
                    </span>
                  </td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button
                      className="btn"
                      style={{ padding: '4px 9px' }}
                      disabled={!s.code.trim() || busy === `s${i}`}
                      onClick={() => saveRow('shift_types', s, i, `s${i}`, setShifts)}
                    >
                      {savedKey === `s${i}` ? 'Saved ✓' : busy === `s${i}` ? '…' : 'Save'}
                    </button>{' '}
                    <button
                      className="btn"
                      style={{ padding: '4px 9px', color: '#b91c1c' }}
                      onClick={() => requestDelete('shift_types', s.id, i, s.code || 'this shift', setShifts as any)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={10} style={{ ...cell, padding: 8 }}>
                  <button
                    className="btn"
                    onClick={() =>
                      setShifts((x) => [
                        ...x,
                        {
                          code: '',
                          description: '',
                          start_time: '06:00',
                          end_time: '14:00',
                          duration_hours: 8,
                          is_off: false,
                          background_color: '#ffffff',
                          text_color: '#0f172a',
                        },
                      ])
                    }
                  >
                    + Add shift type
                  </button>
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {tab === 'areas' && (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
            <thead>
              <tr>
                {['Code', 'Name', 'Category', 'BG', 'Text', 'Preview', ''].map((h) => (
                  <th key={h} style={{ ...cell, padding: '8px 6px', textAlign: 'left', background: 'var(--surface-muted)', color: 'var(--text)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {areas.map((a, i) => (
                <tr key={a.id ?? `n${i}`}>
                  <td style={{ ...cell, width: 80 }}>
                    <input style={inp} value={a.code} onChange={(e) => upd(setAreas, i, { code: e.target.value })} />
                  </td>
                  <td style={cell}>
                    <input style={inp} value={a.name ?? ''} onChange={(e) => upd(setAreas, i, { name: e.target.value })} />
                  </td>
                  <td style={{ ...cell, width: 115 }}>
                    <select style={inp} value={a.category} onChange={(e) => upd(setAreas, i, { category: e.target.value })}>
                      <option value="station">Station</option>
                      <option value="leave">Leave</option>
                      <option value="holiday">Holiday</option>
                    </select>
                  </td>
                  <td style={cell}>
                    <Color v={a.background_color} on={(c) => upd(setAreas, i, { background_color: c })} />
                  </td>
                  <td style={cell}>
                    <Color v={a.text_color} on={(c) => upd(setAreas, i, { text_color: c })} />
                  </td>
                  <td style={cell}>
                    <span style={{ background: a.background_color, color: a.text_color, padding: '3px 10px', borderRadius: 4, fontWeight: 800, border: '1px solid #cbd5e1' }}>
                      {a.code || '?'}
                    </span>
                  </td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button
                      className="btn"
                      style={{ padding: '4px 9px' }}
                      disabled={!a.code.trim() || busy === `a${i}`}
                      onClick={() => saveRow('area_codes', a, i, `a${i}`, setAreas)}
                    >
                      {savedKey === `a${i}` ? 'Saved ✓' : busy === `a${i}` ? '…' : 'Save'}
                    </button>{' '}
                    <button
                      className="btn"
                      style={{ padding: '4px 9px', color: '#b91c1c' }}
                      onClick={() => requestDelete('area_codes', a.id, i, a.code || 'this area code', setAreas as any)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7} style={{ ...cell, padding: 8 }}>
                  <button
                    className="btn"
                    onClick={() =>
                      setAreas((x) => [
                        ...x,
                        { code: '', name: '', category: 'station', background_color: '#f1f5f9', text_color: '#1e293b' },
                      ])
                    }
                  >
                    + Add area / leave code
                  </button>
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {tab === 'users' && (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
            <thead>
              <tr>
                {['Full name', 'Role', 'Linked Operator', 'Active (Approved)', 'User ID', ''].map((h) => (
                  <th key={h} style={{ ...cell, padding: '8px 6px', textAlign: 'left', background: 'var(--surface-muted)', color: 'var(--text)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#475569' }}>
                    No user profiles found.
                  </td>
                </tr>
              ) : (
                users.map((u, i) => (
                  <tr key={u.id} style={{ background: u.is_active ? 'var(--surface)' : 'rgba(234, 179, 8, 0.12)' }}>
                    <td style={cell}>
                      <input
                        style={inp}
                        value={u.full_name ?? ''}
                        placeholder="Full name"
                        onChange={(e) => upd(setUsers, i, { full_name: e.target.value })}
                      />
                    </td>
                    <td style={{ ...cell, width: 130 }}>
                      <select
                        style={inp}
                        value={u.role}
                        onChange={(e) => upd(setUsers, i, { role: e.target.value as UserProfile['role'] })}
                      >
                        <option value="admin">admin</option>
                        <option value="scheduler">scheduler</option>
                        <option value="operator">operator</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </td>
                    <td style={{ ...cell, width: 170 }}>
                      <select
                        style={inp}
                        value={u.operator_id ?? ''}
                        onChange={(e) => upd(setUsers, i, { operator_id: e.target.value || null })}
                      >
                        <option value="">(unlinked)</option>
                        {ops.filter((o) => o.id).map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.full_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ ...cell, textAlign: 'center', width: 130 }}>
                      <input
                        type="checkbox"
                        checked={u.is_active}
                        onChange={(e) => upd(setUsers, i, { is_active: e.target.checked })}
                      />
                    </td>
                    <td style={{ ...cell, fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#475569' }}>{u.id}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                      <button
                        className="btn"
                        style={{ padding: '4px 9px' }}
                        disabled={busy === `u${i}`}
                        onClick={() => saveRow('user_profiles', u, i, `u${i}`, setUsers)}
                      >
                        {savedKey === `u${i}` ? 'Saved ✓' : busy === `u${i}` ? '…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {confirmDel && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-dialog-title"
          onClick={() => setConfirmDel(null)}
        >
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, display: 'grid', gap: 12 }}>
            <h2 id="del-dialog-title" style={{ margin: 0, fontSize: 16 }}>
              Delete {confirmDel.label}?
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              Schedule entries using this item may be affected.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmDel(null)}>
                Cancel
              </button>
              <button className="btn" style={{ background: '#b91c1c', borderColor: '#b91c1c', color: '#fff' }} onClick={executeDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
