'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import DepartmentHeads, { type Grant, type Person } from '@/components/DepartmentHeads';
import HolidaysManager, { type HolidayRow } from '@/components/HolidaysManager';

type Op = {
  id?: string;
  full_name: string;
  position: string | null;
  phone_number: string | null;
  default_station: string | null;
  sort_order: number;
  is_active: boolean;
  department_head_id?: string | null;
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
  sub_sites?: string[];
};
type UserProfile = {
  id: string;
  full_name: string | null;
  role: 'admin' | 'scheduler' | 'manager' | 'operator' | 'viewer';
  is_active: boolean;
  operator_id?: string | null;
};

type AuditLog = {
  id: number;
  user_id: string | null;
  action: string | null;
  table_name: string | null;
  record_id: string | null;
  old_value: Record<string, any> | null;
  new_value: Record<string, any> | null;
  created_at: string;
};

type Tab = 'operators' | 'shifts' | 'areas' | 'holidays' | 'users' | 'heads' | 'audit';

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

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

function normalizeName(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findSuggestedOperator(
  userName: string | null,
  ops: Op[],
  users: UserProfile[],
  rowUserId: string,
): Op | undefined {
  const normUser = normalizeName(userName ?? '');
  if (!normUser) return undefined;

  const userAll = normUser.split(' ').filter(Boolean);
  const userCore = userAll.filter((t) => !SUFFIXES.has(t));
  const claimedIds = new Set(
    users.filter((x) => x.id !== rowUserId && x.operator_id).map((x) => x.operator_id as string),
  );

  let bestOp: Op | undefined;
  let bestScore = 0;

  for (const op of ops) {
    if (!op.id || claimedIds.has(op.id)) continue;
    const normOp = normalizeName(op.full_name);
    if (!normOp) continue;

    let score = 0;
    if (normUser === normOp) {
      score = 100;
    } else {
      const opAll = normOp.split(' ').filter(Boolean);
      const opCore = opAll.filter((t) => !SUFFIXES.has(t));
      const aTokens = userCore.length ? userCore : userAll;
      const bTokens = opCore.length ? opCore : opAll;

      const shared = aTokens.filter((t) => t.length >= 2 && bTokens.includes(t));
      const aLast = aTokens[aTokens.length - 1];
      const bLast = bTokens[bTokens.length - 1];
      const aFirst = aTokens[0];
      const bFirst = bTokens[0];

      const firstInitialMatch =
        aLast === bLast &&
        aLast.length >= 2 &&
        ((aFirst.length === 1 && bFirst.startsWith(aFirst)) ||
          (bFirst.length === 1 && aFirst.startsWith(bFirst)));

      const allShortMatchLong =
        (aTokens.length >= 2 && aTokens.every((t) => bTokens.includes(t))) ||
        (bTokens.length >= 2 && bTokens.every((t) => aTokens.includes(t)));

      if (allShortMatchLong || firstInitialMatch) {
        score = 85;
      } else if (
        shared.length >= 2 ||
        (aLast === bLast && aLast.length >= 2 && aFirst.length >= 3 && bFirst.length >= 3 && aFirst.slice(0, 3) === bFirst.slice(0, 3))
      ) {
        score = 70;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestOp = op;
    }
  }

  return bestScore >= 70 ? bestOp : undefined;
}

function formatManilaTimestamp(iso: string) {
  try {
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function summarizeAudit(
  log: AuditLog,
  opName: Map<string, string>,
  shiftCode: Map<string, string>,
  areaCode: Map<string, string>,
) {
  const rec = log.new_value ?? log.old_value ?? {};
  if (log.table_name === 'schedule_assignments') {
    const who = opName.get(rec.operator_id) ?? 'Operator';
    const shift = rec.shift_type_id ? shiftCode.get(rec.shift_type_id) ?? 'Shift' : '—';
    const area = rec.area_code_id ? areaCode.get(rec.area_code_id) ?? 'Area' : '';
    return `${who} · ${rec.schedule_date ?? ''} → ${shift}${area ? ` · ${area}` : ''}`;
  }
  if (log.table_name === 'standby_assignments') {
    const who = opName.get(rec.operator_id) ?? 'Operator';
    return `${who} · ${rec.schedule_date ?? ''} · Standby ${rec.standby_type ?? 'OC'}`;
  }
  if (log.table_name === 'pm_tasks') {
    return `${rec.title ?? 'PM Task'} · ${rec.scheduled_date ?? ''} (${rec.status ?? 'planned'})`;
  }
  if (log.table_name === 'leave_records') {
    const who = opName.get(rec.operator_id) ?? 'Operator';
    return `${who} · ${rec.leave_code ?? 'Leave'} (${rec.start_date ?? ''}–${rec.end_date ?? ''})`;
  }
  return log.record_id ?? 'Record updated';
}

type OrgPosLite = {
  id: string;
  title: string;
  department_group: string;
  tier: string;
  holder_user_id: string | null;
  is_vacant: boolean;
};

export default function Setup(p: {
  operators: Op[];
  shifts: Shift[];
  areas: Area[];
  users: UserProfile[];
  auditLogs?: AuditLog[];
  /** Department-head data is loaded separately from `users` so the Users tab never rewrites it. */
  people?: Person[];
  grants?: Grant[];
  holidays?: HolidayRow[];
  holidaysError?: string;
  orgPositions?: OrgPosLite[];
  headsError?: string;
  orgId: string;
  currentUserId?: string;
  isAdmin: boolean;
  error: string;
}) {
  const [tab, setTab] = useState<Tab>('operators');
  const [ops, setOps] = useState<Op[]>(p.operators);
  const [shifts, setShifts] = useState<Shift[]>(p.shifts);
  const [areas, setAreas] = useState<Area[]>(p.areas);
  const [users, setUsers] = useState<UserProfile[]>(p.users);
  const [orgPositions, setOrgPositions] = useState<OrgPosLite[]>(p.orgPositions ?? []);

  async function assignUserToOrgPosition(userId: string, newPosId: string) {
    const sb = supabaseBrowser();
    setMsg('');
    // Vacate any old position held by this user
    await sb.from('org_positions').update({ holder_user_id: null, is_vacant: true }).eq('holder_user_id', userId);
    if (newPosId) {
      const { error } = await sb
        .from('org_positions')
        .update({ holder_user_id: userId, is_vacant: false })
        .eq('id', newPosId);
      if (error) {
        setMsg(error.message);
        return;
      }
    }
    setOrgPositions((prev) =>
      prev.map((pos) =>
        pos.id === newPosId
          ? { ...pos, holder_user_id: userId, is_vacant: false }
          : pos.holder_user_id === userId
            ? { ...pos, holder_user_id: null, is_vacant: true }
            : pos,
      ),
    );
  }
  const [msg, setMsg] = useState(p.error);
  const [savedKey, setSavedKey] = useState('');
  const [dirty, setDirty] = useState<Set<string>>(new Set());
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
    setDirty((d) => {
      const n = new Set(d);
      n.delete(key);
      return n;
    });
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

  const upd = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number, patch: Partial<T>) => {
    setter((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const prefix =
      (setter as unknown) === setOps
        ? 'o'
        : (setter as unknown) === setShifts
          ? 's'
          : (setter as unknown) === setAreas
            ? 'a'
            : 'u';
    setDirty((d) => new Set(d).add(`${prefix}${i}`));
  };

  const saveLabel = (key: string) =>
    savedKey === key ? 'Saved ✓' : busy === key ? '…' : dirty.has(key) ? 'Save *' : 'Save';

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
  const auditLogs = p.auditLogs ?? [];
  const userNameMap = new Map(users.map((u) => [u.id, u.full_name || u.id.slice(0, 8)]));
  const opNameMap = new Map(ops.filter((o) => o.id).map((o) => [o.id as string, o.full_name]));
  const shiftCodeMap = new Map(shifts.filter((s) => s.id).map((s) => [s.id as string, s.code]));
  const areaCodeMap = new Map(areas.filter((a) => a.id).map((a) => [a.id as string, a.code]));

  const headOptions = (p.people ?? []).filter((x) => x.is_active && (x.role === 'manager' || x.role === 'admin'));

  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {tabBtn('operators', `Operators (${ops.length})`)}
        {tabBtn('shifts', `Shift types (${shifts.length})`)}
        {tabBtn('areas', `Areas & leave (${areas.length})`)}
        {tabBtn('holidays', `Holidays (${(p.holidays ?? []).length})`)}
        {tabBtn('users', `Users & roles (${users.length}${pendingUsers ? ` · ${pendingUsers} pending` : ''})`)}
        {tabBtn('heads', `Department heads (${(p.people ?? []).filter((x) => x.role === 'manager').length})`)}
        {tabBtn('audit', `Activity log (${auditLogs.length})`)}
        {dirty.size > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--warn-fg)', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', padding: '3px 9px', borderRadius: 999 }}>
            {dirty.size} unsaved {dirty.size === 1 ? 'row' : 'rows'}
          </span>
        )}
        {msg && (
          <span role="alert" style={{ color: '#b91c1c', fontSize: 12.5, fontWeight: 500 }}>
            {msg}
          </span>
        )}
      </div>

      <div hidden={tab !== 'heads'}>
        <DepartmentHeads people={p.people ?? []} grants={p.grants ?? []} orgId={p.orgId} error={p.headsError ?? ''} />
      </div>

      <div hidden={tab !== 'holidays'}>
        <HolidaysManager initialHolidays={p.holidays ?? []} orgId={p.orgId} isAdmin={p.isAdmin} error={p.holidaysError} />
      </div>

      <div hidden={tab === 'heads' || tab === 'holidays'}>
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 12 }}>
                    Phone
                    <input className="input" value={o.phone_number ?? ''} onChange={(e) => upd(setOps, i, { phone_number: e.target.value })} />
                  </label>
                  <label style={{ fontSize: 12 }}>
                    Assigned Head
                    <select className="input" value={o.department_head_id ?? ''} onChange={(e) => upd(setOps, i, { department_head_id: e.target.value || null })}>
                      <option value="">— Unassigned —</option>
                      {headOptions.map((h) => (
                        <option key={h.id} value={h.id}>{h.full_name ?? h.id}{h.job_title ? ` (${h.job_title})` : ''}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
                  <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={o.is_active} onChange={(e) => upd(setOps, i, { is_active: e.target.checked })} />
                    Active
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary" disabled={!o.full_name.trim() || busy === `o${i}`} onClick={() => saveRow('operators', o, i, `o${i}`, setOps)}>
                      {saveLabel(`o${i}`)}
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
                      {saveLabel(`s${i}`)}
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
                      <option value="rest">Rest</option>
                      <option value="holiday">Holiday</option>
                    </select>
                    <Color v={a.background_color} on={(c) => upd(setAreas, i, { background_color: c })} />
                    <Color v={a.text_color} on={(c) => upd(setAreas, i, { text_color: c })} />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary" disabled={!a.code.trim() || busy === `a${i}`} onClick={() => saveRow('area_codes', a, i, `a${i}`, setAreas)}>
                      {saveLabel(`a${i}`)}
                    </button>
                    <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => requestDelete('area_codes', a.id, i, a.code || 'this area code', setAreas as any)}>
                      Delete
                    </button>
                  </div>
                </div>
                {a.category === 'station' && (
                  <label style={{ fontSize: 12 }}>
                    Sub-sites / Wells (comma-separated, optional)
                    <input
                      className="input"
                      placeholder="e.g. Well 1, Well 2, Booster 1"
                      value={(a.sub_sites ?? []).join(', ')}
                      onChange={(e) =>
                        upd(setAreas, i, {
                          sub_sites: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                        })
                      }
                    />
                  </label>
                )}
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
          users.map((u, i) => {
            const isSelf = Boolean(p.currentUserId && u.id === p.currentUserId);
            const suggested = !u.operator_id ? findSuggestedOperator(u.full_name, ops, users, u.id) : undefined;
            const applySuggested = () => {
              if (!suggested?.id) return;
              upd(setUsers, i, {
                operator_id: suggested.id,
                ...(u.role === 'viewer' ? { role: 'operator' } : {}),
                is_active: true,
                ...(!u.full_name?.trim() ? { full_name: suggested.full_name } : {}),
              });
            };
            const headOptions = (p.people ?? []).filter((x) => x.is_active && (x.role === 'manager' || x.role === 'admin'));

  return (
              <div key={u.id} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
                <label style={{ fontSize: 12 }}>
                  Full name {isSelf && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>(You)</span>}
                  <input className="input" value={u.full_name ?? ''} placeholder="Full name" onChange={(e) => upd(setUsers, i, { full_name: e.target.value })} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 12 }}>
                    Role
                    <select
                      className="input"
                      value={u.role}
                      disabled={isSelf}
                      title={isSelf ? 'You cannot demote or deactivate your own admin account' : undefined}
                      onChange={(e) => upd(setUsers, i, { role: e.target.value as UserProfile['role'] })}
                    >
                      <option value="admin">admin</option>
                      <option value="scheduler">scheduler</option>
                      <option value="operator">operator</option>
                      <option value="manager">department head</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 12 }}>
                    Linked Operator
                    <select className="input" value={u.operator_id ?? ''} onChange={(e) => upd(setUsers, i, { operator_id: e.target.value || null })}>
                      <option value="">(unlinked)</option>
                      {ops.filter((o) => o.id).map((o) => {
                        const takenByOther = users.some((x) => x.id !== u.id && x.operator_id === o.id);
                        const headOptions = (p.people ?? []).filter((x) => x.is_active && (x.role === 'manager' || x.role === 'admin'));

  return (
                          <option key={o.id} value={o.id}>
                            {o.full_name}
                            {takenByOther ? ' (linked)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                </div>
                {suggested && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'var(--info-bg)',
                      color: 'var(--info-fg)',
                      fontSize: 12,
                    }}
                  >
                    <span>
                      Suggested match: <b>{suggested.full_name}</b>
                    </span>
                    <button type="button" className="btn" style={{ minHeight: 30, padding: '3px 9px', fontSize: 12, fontWeight: 700 }} onClick={applySuggested}>
                      {!u.is_active ? 'Link & approve' : 'Link match'}
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label
                    style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: isSelf ? 0.65 : 1 }}
                    title={isSelf ? 'You cannot demote or deactivate your own admin account' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={u.is_active}
                      disabled={isSelf}
                      onChange={(e) => upd(setUsers, i, { is_active: e.target.checked })}
                    />
                    Active (Approved)
                  </label>
                  <button className="btn btn-primary" disabled={busy === `u${i}`} onClick={() => saveRow('user_profiles', u, i, `u${i}`, setUsers)}>
                    {saveLabel(`u${i}`)}
                  </button>
                </div>
              </div>
            );
          })}

        {tab === 'audit' &&
          (auditLogs.length === 0 ? (
            <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              No recent activity recorded yet.
            </div>
          ) : (
            auditLogs.map((log) => (
              <div key={log.id} className="card" style={{ padding: 12, display: 'grid', gap: 4, fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>{log.user_id ? userNameMap.get(log.user_id) ?? 'System' : 'System'}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatManilaTimestamp(log.created_at)}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      padding: '1px 7px',
                      borderRadius: 999,
                      fontSize: 10.5,
                      fontWeight: 700,
                      background:
                        log.action === 'DELETE'
                          ? 'var(--danger-bg)'
                          : log.action === 'INSERT'
                            ? 'var(--ok-bg)'
                            : 'var(--info-bg)',
                      color:
                        log.action === 'DELETE'
                          ? 'var(--danger-fg)'
                          : log.action === 'INSERT'
                            ? 'var(--ok-fg)'
                            : 'var(--info-fg)',
                    }}
                  >
                    {log.action}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{log.table_name}</span>
                </div>
                <div style={{ color: 'var(--text)' }}>{summarizeAudit(log, opNameMap, shiftCodeMap, areaCodeMap)}</div>
              </div>
            ))
          ))}
      </div>

      {/* Desktop Table (> 640px) */}
      <div className="card responsive-table-wrap" style={{ overflow: 'auto' }}>
        {tab === 'operators' && (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
            <thead>
              <tr>
                {['#', 'Full name', 'Position', 'Phone', 'Default station', 'Assigned Head', 'Active', ''].map((h) => (
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
                  <td style={cell}>
                    <select style={inp} value={o.department_head_id ?? ''} onChange={(e) => upd(setOps, i, { department_head_id: e.target.value || null })}>
                      <option value="">— Unassigned —</option>
                      {headOptions.map((h) => (
                        <option key={h.id} value={h.id}>{h.full_name ?? h.id}{h.job_title ? ` (${h.job_title})` : ''}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <input type="checkbox" checked={o.is_active} onChange={(e) => upd(setOps, i, { is_active: e.target.checked })} />
                  </td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button
                      className={`btn ${dirty.has(`o${i}`) ? 'btn-primary' : ''}`}
                      style={{ padding: '4px 9px' }}
                      disabled={!o.full_name.trim() || busy === `o${i}`}
                      onClick={() => saveRow('operators', o, i, `o${i}`, setOps)}
                    >
                      {saveLabel(`o${i}`)}
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
                <td colSpan={8} style={{ ...cell, padding: 8 }}>
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
                      className={`btn ${dirty.has(`s${i}`) ? 'btn-primary' : ''}`}
                      style={{ padding: '4px 9px' }}
                      disabled={!s.code.trim() || busy === `s${i}`}
                      onClick={() => saveRow('shift_types', s, i, `s${i}`, setShifts)}
                    >
                      {saveLabel(`s${i}`)}
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
                {['Code', 'Name', 'Category', 'Sub-sites / Wells', 'BG', 'Text', 'Preview', ''].map((h) => (
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
                      <option value="rest">Rest</option>
                      <option value="holiday">Holiday</option>
                    </select>
                  </td>
                  <td style={cell}>
                    {a.category === 'station' ? (
                      <input
                        style={inp}
                        placeholder="Well 1, Well 2…"
                        value={(a.sub_sites ?? []).join(', ')}
                        onChange={(e) =>
                          upd(setAreas, i, {
                            sub_sites: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                          })
                        }
                      />
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                    )}
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
                      className={`btn ${dirty.has(`a${i}`) ? 'btn-primary' : ''}`}
                      style={{ padding: '4px 9px' }}
                      disabled={!a.code.trim() || busy === `a${i}`}
                      onClick={() => saveRow('area_codes', a, i, `a${i}`, setAreas)}
                    >
                      {saveLabel(`a${i}`)}
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
                <td colSpan={8} style={{ ...cell, padding: 8 }}>
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
                {['Full name', 'Role', 'Org Position (Auto-Chart)', 'Linked Operator', 'Active (Approved)', 'User ID', ''].map((h) => (
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
                users.map((u, i) => {
                  const isSelf = Boolean(p.currentUserId && u.id === p.currentUserId);
                  const suggested = !u.operator_id ? findSuggestedOperator(u.full_name, ops, users, u.id) : undefined;
                  const applySuggested = () => {
                    if (!suggested?.id) return;
                    upd(setUsers, i, {
                      operator_id: suggested.id,
                      ...(u.role === 'viewer' ? { role: 'operator' } : {}),
                      is_active: true,
                      ...(!u.full_name?.trim() ? { full_name: suggested.full_name } : {}),
                    });
                  };
                  const headOptions = (p.people ?? []).filter((x) => x.is_active && (x.role === 'manager' || x.role === 'admin'));

  return (
                    <tr key={u.id} style={{ background: u.is_active ? 'var(--surface)' : 'rgba(234, 179, 8, 0.12)' }}>
                      <td style={cell}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            style={inp}
                            value={u.full_name ?? ''}
                            placeholder="Full name"
                            onChange={(e) => upd(setUsers, i, { full_name: e.target.value })}
                          />
                          {isSelf && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>(You)</span>
                          )}
                        </div>
                      </td>
                      <td style={{ ...cell, width: 130 }}>
                        <select
                          style={{ ...inp, opacity: isSelf ? 0.65 : 1 }}
                          value={u.role}
                          disabled={isSelf}
                          title={isSelf ? 'You cannot demote or deactivate your own admin account' : undefined}
                          onChange={(e) => upd(setUsers, i, { role: e.target.value as UserProfile['role'] })}
                        >
                          <option value="admin">admin</option>
                          <option value="scheduler">scheduler</option>
                          <option value="operator">operator</option>
                          <option value="manager">department head</option>
                          <option value="viewer">viewer</option>
                        </select>
                      </td>
                      <td style={{ ...cell, width: 190 }}>
                        <select
                          style={inp}
                          value={orgPositions.find((pos) => pos.holder_user_id === u.id)?.id ?? ''}
                          onChange={(e) => assignUserToOrgPosition(u.id, e.target.value)}
                          title="Assigning a Head position auto-updates the Org Chart & subordinate routing"
                        >
                          <option value="">— None —</option>
                          {orgPositions.map((pos) => (
                            <option key={pos.id} value={pos.id}>
                              {pos.title}{pos.is_vacant ? ' (Vacant)' : pos.holder_user_id && pos.holder_user_id !== u.id ? ' (Occupied)' : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ ...cell, width: 220 }}>
                        <div style={{ display: 'grid', gap: 4 }}>
                          <select
                            style={inp}
                            value={u.operator_id ?? ''}
                            onChange={(e) => upd(setUsers, i, { operator_id: e.target.value || null })}
                          >
                            <option value="">(unlinked)</option>
                            {ops.filter((o) => o.id).map((o) => {
                              const takenByOther = users.some((x) => x.id !== u.id && x.operator_id === o.id);
                              const headOptions = (p.people ?? []).filter((x) => x.is_active && (x.role === 'manager' || x.role === 'admin'));

  return (
                                <option key={o.id} value={o.id}>
                                  {o.full_name}
                                  {takenByOther ? ' (linked)' : ''}
                                </option>
                              );
                            })}
                          </select>
                          {suggested && (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 6,
                                padding: '3px 6px',
                                borderRadius: 5,
                                background: 'var(--info-bg)',
                                color: 'var(--info-fg)',
                                fontSize: 11,
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={suggested.full_name}>
                                Match: <b>{suggested.full_name}</b>
                              </span>
                              <button
                                type="button"
                                onClick={applySuggested}
                                style={{
                                  border: '1px solid currentColor',
                                  background: 'transparent',
                                  color: 'inherit',
                                  borderRadius: 4,
                                  padding: '1px 6px',
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {!u.is_active ? 'Link & approve' : 'Link'}
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ ...cell, textAlign: 'center', width: 130 }}>
                        <input
                          type="checkbox"
                          checked={u.is_active}
                          disabled={isSelf}
                          title={isSelf ? 'You cannot demote or deactivate your own admin account' : undefined}
                          onChange={(e) => upd(setUsers, i, { is_active: e.target.checked })}
                        />
                      </td>
                      <td style={{ ...cell, fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#475569' }}>{u.id}</td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        <button
                          className={`btn ${dirty.has(`u${i}`) ? 'btn-primary' : ''}`}
                          style={{ padding: '4px 9px' }}
                          disabled={busy === `u${i}`}
                          onClick={() => saveRow('user_profiles', u, i, `u${i}`, setUsers)}
                        >
                          {saveLabel(`u${i}`)}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}

        {tab === 'audit' && (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
            <thead>
              <tr>
                {['Time (Manila)', 'User', 'Action', 'Area / Table', 'Details'].map((h) => (
                  <th key={h} style={{ ...cell, padding: '8px 8px', textAlign: 'left', background: 'var(--surface-muted)', color: 'var(--text)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                    No recent activity recorded yet.
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ ...cell, padding: '6px 8px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                      {formatManilaTimestamp(log.created_at)}
                    </td>
                    <td style={{ ...cell, padding: '6px 8px', fontWeight: 600 }}>
                      {log.user_id ? userNameMap.get(log.user_id) ?? log.user_id.slice(0, 8) : 'System'}
                    </td>
                    <td style={{ ...cell, padding: '6px 8px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background:
                            log.action === 'DELETE'
                              ? 'var(--danger-bg)'
                              : log.action === 'INSERT'
                                ? 'var(--ok-bg)'
                                : 'var(--info-bg)',
                          color:
                            log.action === 'DELETE'
                              ? 'var(--danger-fg)'
                              : log.action === 'INSERT'
                                ? 'var(--ok-fg)'
                                : 'var(--info-fg)',
                        }}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td style={{ ...cell, padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                      {log.table_name}
                    </td>
                    <td style={{ ...cell, padding: '6px 8px' }}>{summarizeAudit(log, opNameMap, shiftCodeMap, areaCodeMap)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
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
