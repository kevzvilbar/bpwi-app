'use client';

import { useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  resolvePositionDisplayName,
  wouldCreateCycle,
  type OrgColorTheme,
  type OrgOperatorLite,
  type OrgPositionRow,
  type OrgTier,
  type OrgUserLite,
} from '@/lib/org-chart';

interface Props {
  orgId: string;
  role: string;
  canEdit: boolean;
  isAdmin: boolean;
  initialPositions: OrgPositionRow[];
  users: OrgUserLite[];
  operators: OrgOperatorLite[];
  migrationMissing?: boolean;
  error?: string;
}

const THEME_STYLES: Record<OrgColorTheme, { bg: string; fg: string; border: string; badgeBg: string; badgeFg: string }> = {
  navy: { bg: '#0f2744', fg: '#ffffff', border: '#0f2744', badgeBg: '#1e3a5f', badgeFg: '#e2e8f0' },
  blue: { bg: '#0284c7', fg: '#ffffff', border: '#0369a1', badgeBg: '#e0f2fe', badgeFg: '#0369a1' },
  teal: { bg: '#0f766e', fg: '#ffffff', border: '#115e59', badgeBg: '#ccfbf1', badgeFg: '#0f766e' },
  purple: { bg: '#5b21b6', fg: '#ffffff', border: '#4c1d95', badgeBg: '#ede9fe', badgeFg: '#5b21b6' },
  amber: { bg: '#fef3c7', fg: '#78350f', border: '#f59e0b', badgeBg: '#fde68a', badgeFg: '#92400e' },
  slate: { bg: '#ffffff', fg: '#0f172a', border: '#cbd5e1', badgeBg: '#e0f2fe', badgeFg: '#0369a1' },
};

export default function OrgChart(p: Props) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [positions, setPositions] = useState<OrgPositionRow[]>(p.initialPositions);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    p.error ? { kind: 'err', text: p.error } : null,
  );

  // Position editor modal state
  const [editingPos, setEditingPos] = useState<Partial<OrgPositionRow> | null>(null);
  // Absorb / Restructure modal state (admin only)
  const [absorbOpen, setAbsorbOpen] = useState<boolean>(false);
  const [absorbSourceId, setAbsorbSourceId] = useState<string>('');
  const [absorbTargetId, setAbsorbTargetId] = useState<string>('');
  const [archiveSource, setArchiveSource] = useState<boolean>(true);

  const usersById = useMemo(() => new Map(p.users.map((u) => [u.id, u])), [p.users]);
  const opsById = useMemo(() => new Map(p.operators.map((o) => [o.id, o])), [p.operators]);

  const activePositions = useMemo(
    () => positions.filter((pos) => (showArchived ? true : pos.is_active)).sort((a, b) => a.sort_order - b.sort_order),
    [positions, showArchived],
  );

  const executives = useMemo(() => activePositions.filter((x) => x.tier === 'executive'), [activePositions]);
  const supportGroup = useMemo(() => activePositions.filter((x) => x.tier === 'support'), [activePositions]);
  const heads = useMemo(() => activePositions.filter((x) => x.tier === 'head'), [activePositions]);
  const leadmen = useMemo(() => activePositions.filter((x) => x.tier === 'leadman'), [activePositions]);
  const staff = useMemo(() => activePositions.filter((x) => x.tier === 'staff'), [activePositions]);

  // Direct staff under executive (not belonging to a department head)
  const execIds = useMemo(() => new Set(executives.map((e) => e.id)), [executives]);
  const execDirectStaff = useMemo(
    () => staff.filter((s) => s.parent_position_id && execIds.has(s.parent_position_id)),
    [staff, execIds],
  );

  // Group staff under heads into team columns
  const headColumns = useMemo(() => {
    return heads.map((head) => {
      const myLeadmenIds = new Set(
        leadmen.filter((l) => l.parent_position_id === head.id || l.secondary_parent_id === head.id).map((l) => l.id),
      );
      const myStaff = staff.filter(
        (s) => s.parent_position_id === head.id || (s.parent_position_id && myLeadmenIds.has(s.parent_position_id)),
      );
      const byGroup = new Map<string, OrgPositionRow[]>();
      for (const s of myStaff) {
        const g = s.department_group || head.department_group || 'TEAM';
        const list = byGroup.get(g) ?? [];
        list.push(s);
        byGroup.set(g, list);
      }
      return {
        head,
        groups: Array.from(byGroup.entries()),
      };
    });
  }, [heads, leadmen, staff]);

  // Any orphan staff whose parent isn't an active executive/head/leadman
  const assignedStaffIds = useMemo(() => {
    const ids = new Set<string>(execDirectStaff.map((s) => s.id));
    for (const col of headColumns) {
      for (const [, list] of col.groups) {
        for (const s of list) ids.add(s.id);
      }
    }
    return ids;
  }, [execDirectStaff, headColumns]);

  const orphanStaff = useMemo(
    () => staff.filter((s) => !assignedStaffIds.has(s.id)),
    [staff, assignedStaffIds],
  );

  async function savePosition() {
    if (!editingPos || !editingPos.title?.trim()) {
      setMsg({ kind: 'err', text: 'Position title is required.' });
      return;
    }
    if (editingPos.id && wouldCreateCycle(positions, editingPos.id, editingPos.parent_position_id ?? null)) {
      setMsg({ kind: 'err', text: 'Invalid reporting line: this would create a circular hierarchy.' });
      return;
    }
    setBusy(true);
    setMsg(null);

    const payload = {
      organization_id: p.orgId,
      title: editingPos.title.trim(),
      department_group: (editingPos.department_group ?? 'OPERATIONS').trim() || 'OPERATIONS',
      tier: (editingPos.tier ?? 'staff') as OrgTier,
      parent_position_id: editingPos.parent_position_id || null,
      secondary_parent_id: editingPos.secondary_parent_id || null,
      holder_user_id: editingPos.is_vacant ? null : (editingPos.holder_user_id || null),
      holder_operator_id: editingPos.is_vacant ? null : (editingPos.holder_operator_id || null),
      fallback_name: editingPos.is_vacant ? null : (editingPos.fallback_name?.trim() || null),
      shift_badge: editingPos.shift_badge?.trim() || null,
      color_theme: (editingPos.color_theme ?? 'slate') as OrgColorTheme,
      is_vacant: Boolean(editingPos.is_vacant),
      is_active: editingPos.is_active ?? true,
      sort_order: Number(editingPos.sort_order ?? 0),
    };

    const res = editingPos.id
      ? await sb.from('org_positions').update(payload).eq('id', editingPos.id).select('*').single()
      : await sb.from('org_positions').insert(payload).select('*').single();

    setBusy(false);
    if (res.error || !res.data) {
      setMsg({ kind: 'err', text: res.error?.message ?? 'Failed to save position.' });
      return;
    }
    const saved = res.data as OrgPositionRow;
    setPositions((prev) => {
      const exists = prev.some((x) => x.id === saved.id);
      return exists ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved];
    });
    setEditingPos(null);
    setMsg({ kind: 'ok', text: `Saved "${saved.title}".` });
  }

  async function deletePosition(posId: string) {
    setBusy(true);
    const { error } = await sb.from('org_positions').delete().eq('id', posId);
    setBusy(false);
    if (error) {
      setMsg({ kind: 'err', text: error.message });
      return;
    }
    setPositions((prev) => prev.filter((x) => x.id !== posId));
    setEditingPos(null);
    setMsg({ kind: 'ok', text: 'Position removed.' });
  }

  async function runAbsorbDepartment() {
    if (!absorbSourceId || !absorbTargetId || absorbSourceId === absorbTargetId) {
      setMsg({ kind: 'err', text: 'Select two different department heads to merge/absorb.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    const targetHead = positions.find((x) => x.id === absorbTargetId);
    const children = positions.filter((x) => x.parent_position_id === absorbSourceId);

    for (const child of children) {
      const { error } = await sb
        .from('org_positions')
        .update({ parent_position_id: absorbTargetId })
        .eq('id', child.id);
      if (error) {
        setBusy(false);
        setMsg({ kind: 'err', text: error.message });
        return;
      }
      // Also sync subordinate operator's department_head_id if target head has an app user
      if (child.holder_operator_id && targetHead?.holder_user_id) {
        await sb
          .from('operators')
          .update({ department_head_id: targetHead.holder_user_id })
          .eq('id', child.holder_operator_id);
      }
    }

    // Move secondary_parent_id bridges as well
    const secChildren = positions.filter((x) => x.secondary_parent_id === absorbSourceId);
    for (const sc of secChildren) {
      await sb.from('org_positions').update({ secondary_parent_id: absorbTargetId }).eq('id', sc.id);
    }

    if (archiveSource) {
      await sb.from('org_positions').update({ is_active: false, is_vacant: true, holder_user_id: null }).eq('id', absorbSourceId);
    }

    const { data: refreshed } = await sb
      .from('org_positions')
      .select('*')
      .eq('organization_id', p.orgId)
      .order('sort_order');

    setBusy(false);
    if (refreshed) setPositions(refreshed as OrgPositionRow[]);
    setAbsorbOpen(false);
    setMsg({ kind: 'ok', text: `Restructured ${children.length} position(s) under ${targetHead?.title ?? 'target head'}.` });
  }

  function renderPersonCard(pos: OrgPositionRow, compact = false) {
    const { name, source } = resolvePositionDisplayName(pos, usersById, opsById);
    const theme = THEME_STYLES[pos.color_theme] ?? THEME_STYLES.slate;
    const isSolidHeader = pos.tier === 'executive' || pos.tier === 'head';
    const bg = pos.is_vacant ? '#fffbeb' : isSolidHeader ? theme.bg : '#ffffff';
    const fg = pos.is_vacant ? '#92400e' : isSolidHeader ? theme.fg : '#0f172a';
    const border = pos.is_vacant ? '2px dashed #f59e0b' : `1px solid ${theme.border}`;

    return (
      <div
        key={pos.id}
        onClick={() => {
          if (editMode && p.canEdit) setEditingPos({ ...pos });
        }}
        style={{
          background: bg,
          color: fg,
          border,
          borderRadius: 8,
          padding: compact ? '6px 9px' : '9px 12px',
          cursor: editMode && p.canEdit ? 'pointer' : 'default',
          opacity: pos.is_active ? 1 : 0.55,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          boxShadow: isSolidHeader ? '0 2px 5px rgba(15,23,42,0.12)' : '0 1px 2px rgba(15,23,42,0.05)',
        }}
        title={editMode && p.canEdit ? 'Click to edit position or reassign person' : undefined}
      >
        <div style={{ minWidth: 0 }}>
          {pos.tier === 'executive' && (
            <div style={{ fontSize: 9.5, fontWeight: 700, opacity: 0.8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {pos.department_group}
            </div>
          )}
          <div style={{ fontWeight: 700, fontSize: compact ? 12 : 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </div>
          <div style={{ fontSize: compact ? 10.5 : 11.5, opacity: isSolidHeader && !pos.is_vacant ? 0.9 : 0.72 }}>
            {pos.title}
            {source === 'directory' && !pos.is_vacant ? ' · Directory' : ''}
            {!pos.is_active ? ' · Archived' : ''}
          </div>
        </div>
        {pos.shift_badge && (
          <span
            style={{
              background: pos.color_theme === 'amber' ? '#fde68a' : theme.badgeBg,
              color: pos.color_theme === 'amber' ? '#92400e' : theme.badgeFg,
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 999,
              whiteSpace: 'nowrap',
            }}
          >
            {pos.shift_badge}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <style>{`
        @media print {
          @page { size: landscape; margin: 8mm; }
          .org-canvas { box-shadow: none !important; border: none !important; }
        }
      `}</style>

      {/* Toolbar */}
      <div className="no-print card" style={{ padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <strong style={{ fontSize: 15 }}>Master Organizational Chart</strong>
          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Heads &amp; Up · Auto-updates when heads resign or new heads sign up
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {p.canEdit && (
            <>
              <button
                type="button"
                className={`btn ${editMode ? 'btn-primary' : ''}`}
                onClick={() => setEditMode((v) => !v)}
              >
                {editMode ? 'Done Editing' : 'Edit Org Chart'}
              </button>
              {editMode && (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setEditingPos({
                        title: '',
                        department_group: 'OPERATIONS',
                        tier: 'staff',
                        parent_position_id: heads[0]?.id ?? executives[0]?.id ?? null,
                        secondary_parent_id: null,
                        holder_user_id: null,
                        holder_operator_id: null,
                        fallback_name: '',
                        shift_badge: '7AM–4PM',
                        color_theme: 'slate',
                        is_vacant: false,
                        is_active: true,
                        sort_order: positions.length * 5,
                      })
                    }
                  >
                    + Add Position
                  </button>
                  {p.isAdmin && (
                    <button type="button" className="btn" onClick={() => setAbsorbOpen(true)}>
                      Restructure / Absorb Dept
                    </button>
                  )}
                  <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                    Show archived
                  </label>
                </>
              )}
            </>
          )}
          <button type="button" className="btn" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      {p.migrationMissing && (
        <div className="no-print card" style={{ padding: 12, borderLeft: '4px solid #d97706', fontSize: 12.5 }}>
          Run migration <code>supabase/migrations/015_org_chart.sql</code> in Supabase SQL Editor to enable and seed the editable Organizational Chart.
        </div>
      )}

      {msg && (
        <div
          className="no-print card"
          role="alert"
          style={{
            padding: '8px 12px',
            fontSize: 12.5,
            borderLeft: `4px solid ${msg.kind === 'err' ? '#dc2626' : '#16a34a'}`,
            color: msg.kind === 'err' ? '#b91c1c' : '#15803d',
          }}
        >
          {msg.text}
        </div>
      )}

      {editMode && p.canEdit && (
        <div className="no-print" style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '0 4px' }}>
          Tip: Click any card below to edit its title, shift badge, reporting parent, or assign/vacate the person holding the position.
        </div>
      )}

      {/* Visual Org Chart Canvas */}
      <div
        className="org-canvas"
        style={{
          background: '#f8fafc',
          color: '#0f172a',
          border: '1px solid #cbd5e1',
          borderRadius: 10,
          padding: 18,
          display: 'grid',
          gap: 16,
          overflowX: 'auto',
        }}
      >
        {/* Chart Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid #e2e8f0', paddingBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bpwi-logo.svg" alt="BPWI Logo" style={{ width: 46, height: 34, objectFit: 'contain' }} />
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#0f172a' }}>
                BP Waterworks Inc. — Iloilo Field Office
              </div>
              <div style={{ fontSize: 12, color: '#475569' }}>
                Master Organizational Chart &amp; Shift Schedule
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ background: '#dbeafe', color: '#1e40af', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6 }}>
              Regular Duty: 7:00 AM – 4:00 PM
            </span>
            <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6 }}>
              Night Shift: 10:00 PM – 7:00 AM
            </span>
          </div>
        </div>

        {/* Tier 1: Executive + Support Group */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 10, minWidth: 260 }}>
            {executives.map((ex) => renderPersonCard(ex))}
          </div>

          {(supportGroup.length > 0 || execDirectStaff.length > 0) && (
            <div style={{ display: 'grid', gap: 8 }}>
              {supportGroup.length > 0 && (
                <div style={{ border: '1.5px dashed #94a3b8', borderRadius: 8, padding: 8, background: '#ffffff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                    <span>SUPPORT GROUP</span>
                    <span style={{ fontStyle: 'italic', fontWeight: 500 }}>Advisory &amp; Control</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {supportGroup.map((s) => renderPersonCard(s, true))}
                  </div>
                </div>
              )}
              {execDirectStaff.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {execDirectStaff.map((s) => renderPersonCard(s, true))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Connector line */}
        <div style={{ height: 2, background: '#cbd5e1', margin: '0 24px' }} />

        {/* Tier 2 & 3: Department Heads + Leadmen + Team Columns */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, headColumns.length)}, minmax(220px, 1fr))`, gap: 14, alignItems: 'start' }}>
          {headColumns.map(({ head, groups }) => {
            const myLeadmen = leadmen.filter((l) => l.parent_position_id === head.id || l.secondary_parent_id === head.id);
            return (
              <div key={head.id} style={{ display: 'grid', gap: 10 }}>
                {renderPersonCard(head)}

                {myLeadmen.map((lm) => (
                  <div key={`${head.id}-${lm.id}`} style={{ paddingLeft: 8, borderLeft: '2px solid #94a3b8' }}>
                    {renderPersonCard(lm, true)}
                  </div>
                ))}

                {groups.map(([groupName, members]) => (
                  <div
                    key={groupName}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: 8,
                      padding: 10,
                      display: 'grid',
                      gap: 7,
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: '#0369a1', letterSpacing: '0.03em' }}>
                      {groupName}
                    </div>
                    {members.map((m) => renderPersonCard(m, true))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {orphanStaff.length > 0 && (
          <div style={{ border: '1px dashed #94a3b8', borderRadius: 8, padding: 10, background: '#ffffff' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>
              UNASSIGNED / OTHER NODES
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {orphanStaff.map((s) => renderPersonCard(s, true))}
            </div>
          </div>
        )}
      </div>

      {/* Edit Position Modal */}
      {editingPos && (
        <div className="modal-overlay no-print" role="dialog" aria-modal="true" onClick={() => !busy && setEditingPos(null)}>
          <div className="card" style={{ maxWidth: 520, width: '95vw', padding: 16, display: 'grid', gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <strong style={{ fontSize: 15 }}>{editingPos.id ? 'Edit Org Position' : 'Add Org Position'}</strong>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ fontSize: 12 }}>
                Position Title *
                <input
                  className="input"
                  value={editingPos.title ?? ''}
                  onChange={(e) => setEditingPos({ ...editingPos, title: e.target.value })}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Department / Team Group
                <input
                  className="input"
                  value={editingPos.department_group ?? ''}
                  onChange={(e) => setEditingPos({ ...editingPos, department_group: e.target.value })}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ fontSize: 12 }}>
                Tier
                <select
                  className="input"
                  value={editingPos.tier ?? 'staff'}
                  onChange={(e) => setEditingPos({ ...editingPos, tier: e.target.value as OrgTier })}
                >
                  <option value="executive">Executive (Managing Head)</option>
                  <option value="support">Support Group</option>
                  <option value="head">Department Head</option>
                  <option value="leadman">Leadman / Bridge</option>
                  <option value="staff">Staff / Specialist</option>
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Reports To (Parent Node)
                <select
                  className="input"
                  value={editingPos.parent_position_id ?? ''}
                  onChange={(e) => setEditingPos({ ...editingPos, parent_position_id: e.target.value || null })}
                >
                  <option value="">— Top Level —</option>
                  {positions
                    .filter((x) => x.id !== editingPos.id && x.is_active)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title} ({resolvePositionDisplayName(x, usersById, opsById).name})
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <label style={{ fontSize: 12 }}>
                Shift Badge
                <input
                  className="input"
                  placeholder="7AM–4PM / Shifting"
                  value={editingPos.shift_badge ?? ''}
                  onChange={(e) => setEditingPos({ ...editingPos, shift_badge: e.target.value })}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Color Theme
                <select
                  className="input"
                  value={editingPos.color_theme ?? 'slate'}
                  onChange={(e) => setEditingPos({ ...editingPos, color_theme: e.target.value as OrgColorTheme })}
                >
                  <option value="navy">Navy</option>
                  <option value="blue">Blue</option>
                  <option value="teal">Teal</option>
                  <option value="purple">Purple</option>
                  <option value="amber">Amber (Night)</option>
                  <option value="slate">White / Slate</option>
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Sort Order
                <input
                  type="number"
                  className="input"
                  value={editingPos.sort_order ?? 0}
                  onChange={(e) => setEditingPos({ ...editingPos, sort_order: +e.target.value })}
                />
              </label>
            </div>

            <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8, display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={Boolean(editingPos.is_vacant)}
                  onChange={(e) => setEditingPos({ ...editingPos, is_vacant: e.target.checked })}
                />
                <strong>Mark as Vacant / Open Slot</strong> (use when a Head or staff resigns)
              </label>

              {!editingPos.is_vacant && (
                <>
                  <label style={{ fontSize: 12 }}>
                    Linked App Account (Auto-syncs Head &amp; Subordinates)
                    <select
                      className="input"
                      value={editingPos.holder_user_id ?? ''}
                      onChange={(e) => setEditingPos({ ...editingPos, holder_user_id: e.target.value || null })}
                    >
                      <option value="">— No App Account Linked —</option>
                      {p.users
                        .filter((u) => u.is_active)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.full_name ?? u.id} ({u.role})
                          </option>
                        ))}
                    </select>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label style={{ fontSize: 12 }}>
                      Linked Operator (Roster)
                      <select
                        className="input"
                        value={editingPos.holder_operator_id ?? ''}
                        onChange={(e) => setEditingPos({ ...editingPos, holder_operator_id: e.target.value || null })}
                      >
                        <option value="">— None —</option>
                        {p.operators.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.full_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ fontSize: 12 }}>
                      Directory Name (if no account)
                      <input
                        className="input"
                        placeholder="Manual name"
                        value={editingPos.fallback_name ?? ''}
                        onChange={(e) => setEditingPos({ ...editingPos, fallback_name: e.target.value })}
                      />
                    </label>
                  </div>
                </>
              )}

              <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={editingPos.is_active ?? true}
                  onChange={(e) => setEditingPos({ ...editingPos, is_active: e.target.checked })}
                />
                Active in Org Chart (uncheck to omit/archive)
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 6 }}>
              {editingPos.id ? (
                <button
                  type="button"
                  className="btn"
                  style={{ color: '#b91c1c' }}
                  disabled={busy}
                  onClick={() => deletePosition(editingPos.id!)}
                >
                  Delete Node
                </button>
              ) : (
                <span />
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" disabled={busy} onClick={() => setEditingPos(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={savePosition}>
                  Save Position
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Restructure / Absorb Department Modal (Admin) */}
      {absorbOpen && p.isAdmin && (
        <div className="modal-overlay no-print" role="dialog" aria-modal="true" onClick={() => !busy && setAbsorbOpen(false)}>
          <div className="card" style={{ maxWidth: 460, width: '95vw', padding: 16, display: 'grid', gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <strong style={{ fontSize: 15 }}>Restructure / Absorb Department</strong>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Move all teams and staff under one Department Head to another Head (for example, if a department is omitted and absorbed).
            </p>
            <label style={{ fontSize: 12 }}>
              From Department Head (to move/omit)
              <select className="input" value={absorbSourceId} onChange={(e) => setAbsorbSourceId(e.target.value)}>
                <option value="">— Select Source Head —</option>
                {heads.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.title} ({resolvePositionDisplayName(h, usersById, opsById).name})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>
              Absorbing Department Head (Target)
              <select className="input" value={absorbTargetId} onChange={(e) => setAbsorbTargetId(e.target.value)}>
                <option value="">— Select Target Head —</option>
                {heads
                  .filter((h) => h.id !== absorbSourceId)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.title} ({resolvePositionDisplayName(h, usersById, opsById).name})
                    </option>
                  ))}
              </select>
            </label>
            <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={archiveSource} onChange={(e) => setArchiveSource(e.target.checked)} />
              Archive the omitted source department head position
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
              <button type="button" className="btn" disabled={busy} onClick={() => setAbsorbOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={runAbsorbDepartment}>
                Move &amp; Absorb
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
