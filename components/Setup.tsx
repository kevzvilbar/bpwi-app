'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import DepartmentHeads, { type Grant, type Person } from '@/components/DepartmentHeads';
import HolidaysManager, { type HolidayRow } from '@/components/HolidaysManager';
import SetupReferenceTabs from '@/components/SetupReferenceTabs';
import SetupUsersAndAudit, {
  SETUP_CELL_STYLE,
  SETUP_INPUT_STYLE,
  getSetupSaveLabel,
  type OrgPosLite,
  type SetupArea,
  type SetupAuditLog,
  type SetupOp,
  type SetupShift,
  type SetupUserProfile,
} from '@/components/SetupUsersAndAudit';

type Op = SetupOp;
type Shift = SetupShift;
type Area = SetupArea;
type UserProfile = SetupUserProfile;
type AuditLog = SetupAuditLog;

type Tab = 'operators' | 'shifts' | 'areas' | 'holidays' | 'users' | 'heads' | 'audit';

const cell = SETUP_CELL_STYLE;
const inp = SETUP_INPUT_STYLE;

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

  function requestDelete<T extends { id?: string }>(
    table: string,
    id: string | undefined,
    idx: number,
    label: string,
    setter: React.Dispatch<React.SetStateAction<T[]>>,
  ) {
    if (!id) {
      setter((x) => x.filter((_, i) => i !== idx));
      return;
    }
    setConfirmDel({ table, id, idx, label });
  }

  const markDirty = (key: string) => setDirty((d) => new Set(d).add(key));

  const upd = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number, patch: Partial<T>) => {
    setter((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    markDirty(`o${i}`);
  };

  const saveLabel = (key: string) => getSetupSaveLabel(key, busy, savedKey, dirty);

  if (!p.isAdmin) {
    return <p style={{ padding: 20, color: 'var(--text-secondary)' }}>Only admins can manage operators and setup.</p>;
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
          <span role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, fontWeight: 500 }}>
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
                    <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => requestDelete('operators', o.id, i, o.full_name || 'this operator', setOps)}>
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

        {(tab === 'shifts' || tab === 'areas') && (
          <SetupReferenceTabs
            mode="mobile"
            tab={tab}
            shifts={shifts}
            areas={areas}
            setShifts={setShifts}
            setAreas={setAreas}
            saveRow={saveRow}
            requestDelete={requestDelete}
            markDirty={markDirty}
            busy={busy}
            savedKey={savedKey}
            dirty={dirty}
          />
        )}

        {(tab === 'users' || tab === 'audit') && (
          <SetupUsersAndAudit
            mode="mobile"
            tab={tab}
            users={users}
            setUsers={setUsers}
            ops={ops}
            orgPositions={orgPositions}
            auditLogs={auditLogs}
            userNameMap={userNameMap}
            opNameMap={opNameMap}
            shiftCodeMap={shiftCodeMap}
            areaCodeMap={areaCodeMap}
            currentUserId={p.currentUserId}
            assignUserToOrgPosition={assignUserToOrgPosition}
            saveRow={saveRow}
            markDirty={markDirty}
            busy={busy}
            savedKey={savedKey}
            dirty={dirty}
          />
        )}
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
                      style={{ padding: '4px 9px', color: 'var(--danger)' }}
                      onClick={() => requestDelete('operators', o.id, i, o.full_name || 'this operator', setOps)}
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
                  <span style={{ marginLeft: 10, color: 'var(--text-secondary)' }}>Tip: untick “Active” instead of deleting to keep history.</span>
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {(tab === 'shifts' || tab === 'areas') && (
          <SetupReferenceTabs
            mode="desktop"
            tab={tab}
            shifts={shifts}
            areas={areas}
            setShifts={setShifts}
            setAreas={setAreas}
            saveRow={saveRow}
            requestDelete={requestDelete}
            markDirty={markDirty}
            busy={busy}
            savedKey={savedKey}
            dirty={dirty}
          />
        )}

        {(tab === 'users' || tab === 'audit') && (
          <SetupUsersAndAudit
            mode="desktop"
            tab={tab}
            users={users}
            setUsers={setUsers}
            ops={ops}
            orgPositions={orgPositions}
            auditLogs={auditLogs}
            userNameMap={userNameMap}
            opNameMap={opNameMap}
            shiftCodeMap={shiftCodeMap}
            areaCodeMap={areaCodeMap}
            currentUserId={p.currentUserId}
            assignUserToOrgPosition={assignUserToOrgPosition}
            saveRow={saveRow}
            markDirty={markDirty}
            busy={busy}
            savedKey={savedKey}
            dirty={dirty}
          />
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
