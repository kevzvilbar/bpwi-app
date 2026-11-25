'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { getSetupSaveLabel, SETUP_CELL_STYLE, SETUP_INPUT_STYLE } from '@/lib/setup-constants';
import type { GensetRow } from '@/lib/gensets';
import { buildSavedLocationCatalog, type PmLocationRow } from '@/lib/pm-locations';
import type { Grant, Person } from '@/components/DepartmentHeads';
import type { HolidayRow } from '@/components/HolidaysManager';
import type {
  OrgPosLite,
  SetupArea,
  SetupAuditLog,
  SetupOp,
  SetupShift,
  SetupUserProfile,
} from '@/components/SetupUsersAndAudit';
import { Badge, SegmentedTabs } from '@/components/ui';

const DepartmentHeads = dynamic(() => import('@/components/DepartmentHeads'), { ssr: false });
const HolidaysManager = dynamic(() => import('@/components/HolidaysManager'), { ssr: false });
const GensetsManager = dynamic(() => import('@/components/GensetsManager'), { ssr: false });
const SetupReferenceTabs = dynamic(() => import('@/components/SetupReferenceTabs'), { ssr: false });
const SetupUsersAndAudit = dynamic(() => import('@/components/SetupUsersAndAudit'), { ssr: false });

type Op = SetupOp;
type Shift = SetupShift;
type Area = SetupArea;
type UserProfile = SetupUserProfile;
type AuditLog = SetupAuditLog;

type Tab = 'operators' | 'shifts' | 'areas' | 'gensets' | 'holidays' | 'users' | 'heads' | 'audit';

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
  allowedSignupDomains?: string[];
  gensets?: GensetRow[];
  gensetsTableReady?: boolean;
  savedPmLocations?: PmLocationRow[];
  error: string;
}) {
  const [tab, setTab] = useState<Tab>('operators');
  const [ops, setOps] = useState<Op[]>(p.operators);
  const [shifts, setShifts] = useState<Shift[]>(p.shifts);
  const [areas, setAreas] = useState<Area[]>(p.areas);
  const [gensets, setGensets] = useState<GensetRow[]>(p.gensets ?? []);
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
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(p.auditLogs ?? []);
  const [auditLoaded, setAuditLoaded] = useState<boolean>(Boolean(p.auditLogs));
  const [auditLoading, setAuditLoading] = useState<boolean>(false);
  const [auditError, setAuditError] = useState<string>('');
  const [signupDomainsText, setSignupDomainsText] = useState<string>((p.allowedSignupDomains ?? []).join(', '));
  const [signupDomainsBusy, setSignupDomainsBusy] = useState<boolean>(false);
  const [signupDomainsSaved, setSignupDomainsSaved] = useState<boolean>(false);
  const [signupDomainsErr, setSignupDomainsErr] = useState<string>('');

  async function saveSignupDomains() {
    setSignupDomainsErr('');
    setSignupDomainsSaved(false);
    const rawEntries = signupDomainsText
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
    const deduped = [...new Set(rawEntries)];
    const invalid = deduped.find((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
    if (invalid) {
      setSignupDomainsErr(`Invalid email domain "${invalid}". Use domains like example.com.`);
      return;
    }
    setSignupDomainsBusy(true);
    const { error } = await supabaseBrowser()
      .from('organizations')
      .update({ allowed_signup_domains: deduped })
      .eq('id', p.orgId);
    setSignupDomainsBusy(false);
    if (error) {
      setSignupDomainsErr(error.message);
      return;
    }
    setSignupDomainsText(deduped.join(', '));
    setSignupDomainsSaved(true);
    setTimeout(() => setSignupDomainsSaved(false), 2500);
  }

  const loadAuditLogs = useCallback(async (force = false) => {
    if (!p.isAdmin || (!force && auditLoaded)) return;
    setAuditLoading(true);
    setAuditError('');
    const { data, error } = await supabaseBrowser()
      .from('audit_logs')
      .select('id, created_at, user_id, action, table_name, record_id, old_value, new_value')
      .order('created_at', { ascending: false })
      .limit(50);
    setAuditLoading(false);
    if (error) {
      setAuditError(error.message);
      return;
    }
    setAuditLogs((data ?? []) as AuditLog[]);
    setAuditLoaded(true);
  }, [p.isAdmin, auditLoaded]);

  useEffect(() => {
    if (tab === 'audit' && !auditLoaded) {
      void loadAuditLogs();
    }
  }, [tab, auditLoaded, loadAuditLogs]);

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
    type Tables = Database['public']['Tables'];
    const runSave = async (): Promise<{ data: unknown; error: { message: string } | null }> => {
      switch (table) {
        case 'operators':
          return id
            ? sb.from('operators').update(rest as Tables['operators']['Update']).eq('id', id).select().single()
            : sb.from('operators').insert({ ...(rest as unknown as Omit<Tables['operators']['Insert'], 'organization_id'>), organization_id: p.orgId }).select().single();
        case 'shift_types':
          return id
            ? sb.from('shift_types').update(rest as Tables['shift_types']['Update']).eq('id', id).select().single()
            : sb.from('shift_types').insert({ ...(rest as unknown as Omit<Tables['shift_types']['Insert'], 'organization_id'>), organization_id: p.orgId }).select().single();
        case 'area_codes':
          return id
            ? sb.from('area_codes').update(rest as Tables['area_codes']['Update']).eq('id', id).select().single()
            : sb.from('area_codes').insert({ ...(rest as unknown as Omit<Tables['area_codes']['Insert'], 'organization_id'>), organization_id: p.orgId }).select().single();
        case 'user_profiles':
          return id
            ? sb.from('user_profiles').update(rest as Tables['user_profiles']['Update']).eq('id', id).select().single()
            : { data: null, error: { message: 'User profile id is required for updates.' } };
        default:
          return { data: null, error: { message: `Unsupported setup table: ${table}` } };
      }
    };
    const res = await runSave();

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
    const sb = supabaseBrowser();
    let error: { message: string } | null = null;
    if (table === 'operators') ({ error } = await sb.from('operators').delete().eq('id', id));
    else if (table === 'shift_types') ({ error } = await sb.from('shift_types').delete().eq('id', id));
    else if (table === 'area_codes') ({ error } = await sb.from('area_codes').delete().eq('id', id));
    else error = { message: `Unsupported delete table: ${table}` };
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

  const pendingUsers = users.filter((u) => !u.is_active).length;
  const userNameMap = new Map(users.map((u) => [u.id, u.full_name || u.id.slice(0, 8)]));
  const opNameMap = new Map(ops.filter((o) => o.id).map((o) => [o.id as string, o.full_name]));
  const shiftCodeMap = new Map(shifts.filter((s) => s.id).map((s) => [s.id as string, s.code]));
  const areaCodeMap = new Map(areas.filter((a) => a.id).map((a) => [a.id as string, a.code]));

  const headOptions = (p.people ?? []).filter((x) => x.is_active && (x.role === 'manager' || x.role === 'admin'));

  return (
    <div style={{ padding: 14 }}>
      <h1 className="page-title" style={{ marginBottom: 10 }}>
        Operators, Users &amp; Setup
      </h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <SegmentedTabs
          ariaLabel="Setup sections"
          size="sm"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'operators', label: `Operators (${ops.length})` },
            { id: 'shifts', label: `Shift types (${shifts.length})` },
            { id: 'areas', label: `Areas & leave (${areas.length})` },
            { id: 'gensets', label: `Gensets (${gensets.length})` },
            { id: 'holidays', label: `Holidays (${(p.holidays ?? []).length})` },
            { id: 'users', label: `Users & roles (${users.length}${pendingUsers ? ` · ${pendingUsers} pending` : ''})` },
            { id: 'heads', label: `Department heads (${(p.people ?? []).filter((x) => x.role === 'manager').length})` },
            { id: 'audit', label: auditLoaded ? `Activity log (${auditLogs.length})` : 'Activity log' },
          ]}
        />
        {dirty.size > 0 && (
          <Badge tone="warn">
            {dirty.size} unsaved {dirty.size === 1 ? 'row' : 'rows'}
          </Badge>
        )}
        {msg && (
          <span role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, fontWeight: 500 }}>
            {msg}
          </span>
        )}
      </div>

      {tab === 'heads' && (
        <DepartmentHeads people={p.people ?? []} grants={p.grants ?? []} orgId={p.orgId} error={p.headsError ?? ''} />
      )}

      {tab === 'holidays' && (
        <HolidaysManager initialHolidays={p.holidays ?? []} orgId={p.orgId} isAdmin={p.isAdmin} error={p.holidaysError} />
      )}

      {tab === 'gensets' && (
        <GensetsManager
          orgId={p.orgId}
          canEdit={p.isAdmin}
          tableReady={p.gensetsTableReady ?? true}
          gensets={gensets}
          setGensets={setGensets}
          savedLocations={buildSavedLocationCatalog(
            p.savedPmLocations ?? [],
            areas.filter((a): a is Area & { id: string } => Boolean(a.id)),
          )}
        />
      )}

      <div hidden={tab === 'heads' || tab === 'holidays' || tab === 'gensets'}>
      {tab === 'users' && p.isAdmin && (
        <div className="card" style={{ padding: 12, marginBottom: 10, display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13 }}>Sign-Up Access &amp; Domain Allowlist</strong>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Optional email domain restriction for single-org self sign-up (leave empty to allow any domain when sign-ups are enabled).
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '1 1 260px', minWidth: 200 }}
              aria-label="Approved sign-up email domains"
              placeholder="e.g. bpwaterworks.com, partner.org"
              value={signupDomainsText}
              onChange={(e) => {
                setSignupDomainsText(e.target.value);
                setSignupDomainsSaved(false);
                if (signupDomainsErr) setSignupDomainsErr('');
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={signupDomainsBusy}
              onClick={() => void saveSignupDomains()}
            >
              {signupDomainsBusy ? 'Saving…' : signupDomainsSaved ? 'Saved ✓' : 'Save domains'}
            </button>
          </div>
          {signupDomainsErr && (
            <div role="alert" style={{ fontSize: 12, color: 'var(--danger)' }}>
              {signupDomainsErr}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Production tip: keep <b>Confirm email</b> enabled in Supabase Auth when using domain allowlists, or disable public sign-ups in Supabase Auth for invite-only access.
          </div>
        </div>
      )}
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
              className="btn btn-add"
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
            auditLoading={auditLoading}
            auditError={auditError}
            onRefreshAudit={() => void loadAuditLogs(true)}
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
          <table className="data-table">
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
                    className="btn btn-add"
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
            auditLoading={auditLoading}
            auditError={auditError}
            onRefreshAudit={() => void loadAuditLogs(true)}
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
              <button className="btn" style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }} onClick={executeDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
