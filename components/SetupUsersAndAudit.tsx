'use client';

import type { Dispatch, SetStateAction } from 'react';
import {
  getSetupSaveLabel,
  SETUP_CELL_STYLE,
  SETUP_INPUT_STYLE,
} from '@/lib/setup-constants';

export { getSetupSaveLabel, SETUP_CELL_STYLE, SETUP_INPUT_STYLE };

export type SetupOp = {
  id?: string;
  full_name: string;
  position: string | null;
  phone_number: string | null;
  default_station: string | null;
  sort_order: number;
  is_active: boolean;
  department_head_id?: string | null;
};

export type SetupShift = {
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

export type SetupArea = {
  id?: string;
  code: string;
  name: string | null;
  category: string;
  background_color: string;
  text_color: string;
  sub_sites?: string[];
};

export type SetupUserProfile = {
  id: string;
  full_name: string | null;
  role: 'admin' | 'scheduler' | 'manager' | 'operator' | 'viewer';
  is_active: boolean;
  operator_id?: string | null;
};

export type SetupAuditLog = {
  id: number;
  user_id: string | null;
  action: string | null;
  table_name: string | null;
  record_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
};

export type OrgPosLite = {
  id: string;
  title: string;
  department_group: string;
  tier: string;
  holder_user_id: string | null;
  is_vacant: boolean;
};

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

export function normalizeName(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findSuggestedOperator(
  userName: string | null,
  ops: SetupOp[],
  users: SetupUserProfile[],
  rowUserId: string,
): SetupOp | undefined {
  const normUser = normalizeName(userName ?? '');
  if (!normUser) return undefined;

  const userAll = normUser.split(' ').filter(Boolean);
  const userCore = userAll.filter((t) => !SUFFIXES.has(t));
  const claimedIds = new Set(
    users.filter((x) => x.id !== rowUserId && x.operator_id).map((x) => x.operator_id as string),
  );

  let bestOp: SetupOp | undefined;
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

export function formatManilaTimestamp(iso: string) {
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

export function summarizeAudit(
  log: SetupAuditLog,
  opName: Map<string, string>,
  shiftCode: Map<string, string>,
  areaCode: Map<string, string>,
) {
  const rec = log.new_value ?? log.old_value ?? {};
  const str = (key: string) => (typeof rec[key] === 'string' ? rec[key] : '');
  if (log.table_name === 'schedule_assignments') {
    const who = opName.get(str('operator_id')) ?? 'Operator';
    const shiftId = str('shift_type_id');
    const areaId = str('area_code_id');
    const shift = shiftId ? shiftCode.get(shiftId) ?? 'Shift' : '—';
    const area = areaId ? areaCode.get(areaId) ?? 'Area' : '';
    return `${who} · ${str('schedule_date')} → ${shift}${area ? ` · ${area}` : ''}`;
  }
  if (log.table_name === 'standby_assignments') {
    const who = opName.get(str('operator_id')) ?? 'Operator';
    return `${who} · ${str('schedule_date')} · Standby ${str('standby_type') || 'OC'}`;
  }
  if (log.table_name === 'pm_tasks') {
    return `${str('title') || 'PM Task'} · ${str('scheduled_date')} (${str('status') || 'planned'})`;
  }
  if (log.table_name === 'leave_records') {
    const who = opName.get(str('operator_id')) ?? 'Operator';
    return `${who} · ${str('leave_code') || 'Leave'} (${str('start_date')}–${str('end_date')})`;
  }
  return log.record_id ?? 'Record updated';
}

function getAuditBadgeStyle(action: string | null) {
  return {
    background:
      action === 'DELETE'
        ? 'var(--danger-bg)'
        : action === 'INSERT'
          ? 'var(--ok-bg)'
          : 'var(--info-bg)',
    color:
      action === 'DELETE'
        ? 'var(--danger-fg)'
        : action === 'INSERT'
          ? 'var(--ok-fg)'
          : 'var(--info-fg)',
  };
}

interface SetupUsersAndAuditProps {
  mode: 'mobile' | 'desktop';
  tab: 'users' | 'audit';
  users: SetupUserProfile[];
  setUsers: Dispatch<SetStateAction<SetupUserProfile[]>>;
  ops: SetupOp[];
  orgPositions: OrgPosLite[];
  auditLogs: SetupAuditLog[];
  auditLoading?: boolean;
  auditError?: string;
  onRefreshAudit?: () => void;
  userNameMap: Map<string, string>;
  opNameMap: Map<string, string>;
  shiftCodeMap: Map<string, string>;
  areaCodeMap: Map<string, string>;
  currentUserId?: string;
  assignUserToOrgPosition: (userId: string, newPosId: string) => Promise<void>;
  saveRow: <T extends { id?: string }>(
    table: string,
    row: T,
    idx: number,
    key: string,
    setter: Dispatch<SetStateAction<T[]>>,
  ) => Promise<void> | void;
  markDirty: (key: string) => void;
  busy: string;
  savedKey: string;
  dirty: Set<string>;
}

export default function SetupUsersAndAudit({
  mode,
  tab,
  users,
  setUsers,
  ops,
  orgPositions,
  auditLogs,
  auditLoading,
  auditError,
  onRefreshAudit,
  userNameMap,
  opNameMap,
  shiftCodeMap,
  areaCodeMap,
  currentUserId,
  assignUserToOrgPosition,
  saveRow,
  markDirty,
  busy,
  savedKey,
  dirty,
}: SetupUsersAndAuditProps) {
  const updUser = (i: number, patch: Partial<SetupUserProfile>) => {
    setUsers((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    markDirty(`u${i}`);
  };

  const saveLabel = (key: string) => getSetupSaveLabel(key, busy, savedKey, dirty);

  if (mode === 'mobile') {
    if (tab === 'users') {
      return (
        <>
          {users.map((u, i) => {
            const isSelf = Boolean(currentUserId && u.id === currentUserId);
            const suggested = !u.operator_id ? findSuggestedOperator(u.full_name, ops, users, u.id) : undefined;
            const applySuggested = () => {
              if (!suggested?.id) return;
              updUser(i, {
                operator_id: suggested.id,
                ...(u.role === 'viewer' ? { role: 'operator' } : {}),
                is_active: true,
                ...(!u.full_name?.trim() ? { full_name: suggested.full_name } : {}),
              });
            };
            return (
              <div key={u.id} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
                <label style={{ fontSize: 12 }}>
                  Full name{' '}
                  {isSelf && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>(You)</span>}
                  {!u.is_active && (
                    <span style={{ color: 'var(--warn-fg, #b45309)', fontWeight: 700, marginLeft: 4 }}>
                      · Pending approval
                    </span>
                  )}
                  <input className="input" value={u.full_name ?? ''} placeholder="Full name" onChange={(e) => updUser(i, { full_name: e.target.value })} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 12 }}>
                    Role
                    <select
                      className="input"
                      value={u.role}
                      disabled={isSelf}
                      title={isSelf ? 'You cannot demote or deactivate your own admin account' : undefined}
                      onChange={(e) => updUser(i, { role: e.target.value as SetupUserProfile['role'] })}
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
                    <select className="input" value={u.operator_id ?? ''} onChange={(e) => updUser(i, { operator_id: e.target.value || null })}>
                      <option value="">(unlinked)</option>
                      {ops.filter((o) => o.id).map((o) => {
                        const takenByOther = users.some((x) => x.id !== u.id && x.operator_id === o.id);
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
                      onChange={(e) => updUser(i, { is_active: e.target.checked })}
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
        </>
      );
    }

    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {auditLoading ? 'Loading recent changes…' : `Showing latest ${auditLogs.length} audit entries`}
          </span>
          {onRefreshAudit && (
            <button type="button" className="btn" style={{ minHeight: 30, padding: '3px 10px', fontSize: 12 }} disabled={auditLoading} onClick={onRefreshAudit}>
              {auditLoading ? 'Loading…' : '↻ Refresh'}
            </button>
          )}
        </div>
        {auditError && (
          <div className="card" style={{ padding: 10, color: 'var(--danger)', fontSize: 12.5 }}>{auditError}</div>
        )}
        {auditLoading && auditLogs.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            Loading activity log…
          </div>
        ) : auditLogs.length === 0 ? (
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
                    ...getAuditBadgeStyle(log.action),
                  }}
                >
                  {log.action}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{log.table_name}</span>
              </div>
              <div style={{ color: 'var(--text)' }}>{summarizeAudit(log, opNameMap, shiftCodeMap, areaCodeMap)}</div>
            </div>
          ))
        )}
      </>
    );
  }

  if (tab === 'users') {
    return (
      <table className="data-table">
        <thead>
          <tr>
            {['Full name', 'Role', 'Org Position (Auto-Chart)', 'Linked Operator', 'Active (Approved)', 'User ID', ''].map((h) => (
              <th key={h} style={{ ...SETUP_CELL_STYLE, padding: '8px 6px', textAlign: 'left', background: 'var(--surface-muted)', color: 'var(--text)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                No user profiles found.
              </td>
            </tr>
          ) : (
            users.map((u, i) => {
              const isSelf = Boolean(currentUserId && u.id === currentUserId);
              const suggested = !u.operator_id ? findSuggestedOperator(u.full_name, ops, users, u.id) : undefined;
              const applySuggested = () => {
                if (!suggested?.id) return;
                updUser(i, {
                  operator_id: suggested.id,
                  ...(u.role === 'viewer' ? { role: 'operator' } : {}),
                  is_active: true,
                  ...(!u.full_name?.trim() ? { full_name: suggested.full_name } : {}),
                });
              };
              return (
                <tr key={u.id} style={{ background: u.is_active ? 'var(--surface)' : 'var(--warn-bg)' }}>
                  <td style={SETUP_CELL_STYLE}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        style={SETUP_INPUT_STYLE}
                        value={u.full_name ?? ''}
                        placeholder="Full name"
                        onChange={(e) => updUser(i, { full_name: e.target.value })}
                      />
                      {isSelf && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>(You)</span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...SETUP_CELL_STYLE, width: 130 }}>
                    <select
                      style={{ ...SETUP_INPUT_STYLE, opacity: isSelf ? 0.65 : 1 }}
                      value={u.role}
                      disabled={isSelf}
                      title={isSelf ? 'You cannot demote or deactivate your own admin account' : undefined}
                      onChange={(e) => updUser(i, { role: e.target.value as SetupUserProfile['role'] })}
                    >
                      <option value="admin">admin</option>
                      <option value="scheduler">scheduler</option>
                      <option value="operator">operator</option>
                      <option value="manager">department head</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </td>
                  <td style={{ ...SETUP_CELL_STYLE, width: 190 }}>
                    <select
                      style={SETUP_INPUT_STYLE}
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
                  <td style={{ ...SETUP_CELL_STYLE, width: 220 }}>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <select
                        style={SETUP_INPUT_STYLE}
                        value={u.operator_id ?? ''}
                        onChange={(e) => updUser(i, { operator_id: e.target.value || null })}
                      >
                        <option value="">(unlinked)</option>
                        {ops.filter((o) => o.id).map((o) => {
                          const takenByOther = users.some((x) => x.id !== u.id && x.operator_id === o.id);
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
                  <td style={{ ...SETUP_CELL_STYLE, textAlign: 'center', width: 130 }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11.5 }}>
                      <input
                        type="checkbox"
                        checked={u.is_active}
                        disabled={isSelf}
                        title={isSelf ? 'You cannot demote or deactivate your own admin account' : undefined}
                        onChange={(e) => updUser(i, { is_active: e.target.checked })}
                      />
                      {!u.is_active && (
                        <span style={{ color: 'var(--warn-fg, #b45309)', fontWeight: 700 }}>Pending</span>
                      )}
                    </label>
                  </td>
                  <td style={{ ...SETUP_CELL_STYLE, fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text-secondary)' }}>{u.id}</td>
                  <td style={{ ...SETUP_CELL_STYLE, whiteSpace: 'nowrap' }}>
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
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border-light)' }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {auditLoading ? 'Loading recent changes…' : `Showing latest ${auditLogs.length} audit entries`}
          {auditError && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>{auditError}</span>}
        </span>
        {onRefreshAudit && (
          <button type="button" className="btn" style={{ padding: '4px 10px', fontSize: 12 }} disabled={auditLoading} onClick={onRefreshAudit}>
            {auditLoading ? 'Loading…' : '↻ Refresh'}
          </button>
        )}
      </div>
      <table className="data-table">
        <thead>
          <tr>
            {['Time (Manila)', 'User', 'Action', 'Area / Table', 'Details'].map((h) => (
              <th key={h} style={{ ...SETUP_CELL_STYLE, padding: '8px 8px', textAlign: 'left', background: 'var(--surface-muted)', color: 'var(--text)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {auditLoading && auditLogs.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                Loading activity log…
              </td>
            </tr>
          ) : auditLogs.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                No recent activity recorded yet.
              </td>
            </tr>
          ) : (
            auditLogs.map((log) => (
              <tr key={log.id}>
                <td style={{ ...SETUP_CELL_STYLE, padding: '6px 8px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                  {formatManilaTimestamp(log.created_at)}
                </td>
                <td style={{ ...SETUP_CELL_STYLE, padding: '6px 8px', fontWeight: 600 }}>
                  {log.user_id ? userNameMap.get(log.user_id) ?? log.user_id.slice(0, 8) : 'System'}
                </td>
                <td style={{ ...SETUP_CELL_STYLE, padding: '6px 8px' }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      ...getAuditBadgeStyle(log.action),
                    }}
                  >
                    {log.action}
                  </span>
                </td>
                <td style={{ ...SETUP_CELL_STYLE, padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  {log.table_name}
                </td>
                <td style={{ ...SETUP_CELL_STYLE, padding: '6px 8px' }}>{summarizeAudit(log, opNameMap, shiftCodeMap, areaCodeMap)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
