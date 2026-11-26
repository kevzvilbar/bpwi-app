'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
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
import {
  OrgAbsorbModal,
  OrgHeaderModal,
  OrgPositionModal,
  type OrgChartMeta,
} from '@/components/OrgChartModals';

const DEFAULT_META: OrgChartMeta = {
  title: 'BP Waterworks Inc. — Iloilo Field Office',
  subtitle: 'Master Organizational Chart & Shift Schedule',
  legend1: 'Regular Duty: 7:00 AM – 4:00 PM',
  legend2: 'Night Shift: 10:00 PM – 7:00 AM',
};

interface Props {
  orgId: string;
  role: string;
  canEdit: boolean;
  isAdmin: boolean;
  initialPositions: OrgPositionRow[];
  users: OrgUserLite[];
  operators: OrgOperatorLite[];
  initialMeta?: Partial<OrgChartMeta> | null;
  migrationMissing?: boolean;
  error?: string;
}

const THEME_STYLES: Record<OrgColorTheme, { bg: string; fg: string; border: string; badgeBg: string; badgeFg: string }> = {
  navy: { bg: '#0f2744', fg: '#ffffff', border: '#0f2744', badgeBg: '#1e3a5f', badgeFg: '#e2e8f0' },
  blue: { bg: '#0284c7', fg: '#ffffff', border: '#0369a1', badgeBg: 'var(--info-bg)', badgeFg: 'var(--info-fg)' },
  teal: { bg: '#0f766e', fg: '#ffffff', border: '#115e59', badgeBg: 'var(--ok-bg)', badgeFg: 'var(--ok-fg)' },
  purple: { bg: '#5b21b6', fg: '#ffffff', border: '#4c1d95', badgeBg: 'var(--violet-bg)', badgeFg: 'var(--violet-fg)' },
  amber: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)', border: 'var(--warn-border)', badgeBg: 'var(--warn-bg)', badgeFg: 'var(--warn-fg)' },
  slate: { bg: 'var(--surface)', fg: 'var(--text)', border: 'var(--border)', badgeBg: 'var(--info-bg)', badgeFg: 'var(--info-fg)' },
};

const ORG_S = {
  canvas: { background: 'var(--surface-muted)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px 20px', display: 'grid', gap: 0 },
  execGrid: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'start', gap: 0 },
  execCenter: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  supportBox: { border: '1.5px dashed var(--border)', borderRadius: 8, background: 'var(--surface)' },
  teamBox: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 },
  emptyTeamBox: { background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 8 },
  orphanBox: { border: '1px dashed var(--border)', borderRadius: 8, background: 'var(--surface)', marginTop: 12 },
  stemWrap: { display: 'flex', justifyContent: 'center' },
  stemLine: { width: 2, height: '100%', background: 'var(--border)' },
  logoImg: { width: 48, height: 36, objectFit: 'contain' },
} satisfies Record<string, CSSProperties>;

function StemDown({ height = 14 }: { height?: number }) {
  return (
    <div style={{ ...ORG_S.stemWrap, height }}>
      <div style={ORG_S.stemLine} />
    </div>
  );
}

function BusConnector({
  items,
  gridTemplateColumns,
  height,
}: {
  items: Array<{ key: string; span?: number }>;
  gridTemplateColumns: string;
  height: number;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns, columnGap: 12 }}>
      {items.map((item, idx) => (
        <div
          key={item.key}
          style={{ gridColumn: item.span ? `span ${item.span}` : undefined, position: 'relative', height }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: idx === 0 ? '50%' : -6,
              right: idx === items.length - 1 ? '50%' : -6,
              height: 2,
              background: 'var(--border)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '50%',
              width: 2,
              height,
              background: 'var(--border)',
              transform: 'translateX(-50%)',
            }}
          />
        </div>
      ))}
    </div>
  );
}

export default function OrgChart(p: Props) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [positions, setPositions] = useState<OrgPositionRow[]>(p.initialPositions);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    p.error ? { kind: 'err', text: p.error } : null,
  );

  const [meta, setMeta] = useState<OrgChartMeta>({
    title: p.initialMeta?.title || DEFAULT_META.title,
    subtitle: p.initialMeta?.subtitle || DEFAULT_META.subtitle,
    legend1: p.initialMeta?.legend1 || DEFAULT_META.legend1,
    legend2: p.initialMeta?.legend2 || DEFAULT_META.legend2,
  });
  const [editingHeader, setEditingHeader] = useState<boolean>(false);
  const [draftMeta, setDraftMeta] = useState<OrgChartMeta>(meta);

  useEffect(() => {
    if (p.initialMeta) return;
    try {
      const raw = localStorage.getItem(`bpwi-org-meta-${p.orgId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<OrgChartMeta>;
        setMeta((cur) => ({ ...cur, ...parsed }));
        setDraftMeta((cur) => ({ ...cur, ...parsed }));
      }
    } catch {
      // ignore localStorage read errors
    }
  }, [p.initialMeta, p.orgId]);

  const [editingPos, setEditingPos] = useState<Partial<OrgPositionRow> | null>(null);
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

  const execIds = useMemo(() => new Set(executives.map((e) => e.id)), [executives]);
  const execDirectStaff = useMemo(
    () => staff.filter((s) => s.parent_position_id && execIds.has(s.parent_position_id)),
    [staff, execIds],
  );

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
      const groups = Array.from(byGroup.entries());
      return { head, groups, span: Math.max(1, groups.length) };
    });
  }, [heads, leadmen, staff]);

  const totalTeamCols = useMemo(
    () => Math.max(1, headColumns.reduce((sum, col) => sum + col.span, 0)),
    [headColumns],
  );

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

  async function saveHeaderMeta() {
    const next: OrgChartMeta = {
      title: draftMeta.title.trim() || DEFAULT_META.title,
      subtitle: draftMeta.subtitle.trim() || DEFAULT_META.subtitle,
      legend1: draftMeta.legend1.trim(),
      legend2: draftMeta.legend2.trim(),
    };
    setBusy(true);
    setMsg(null);
    setMeta(next);
    try {
      localStorage.setItem(`bpwi-org-meta-${p.orgId}`, JSON.stringify(next));
    } catch {
      // ignore
    }
    const rpcRes = await sb.rpc('update_org_chart_meta', { p_org_id: p.orgId, p_meta: next });
    let error = rpcRes.error;
    if (error && /update_org_chart_meta/i.test(error.message)) {
      const fallbackRes = await sb.from('organizations').update({ org_chart_meta: next }).eq('id', p.orgId);
      error = fallbackRes.error;
    }
    setBusy(false);
    setEditingHeader(false);
    if (error && !/org_chart_meta|update_org_chart_meta/i.test(error.message)) {
      setMsg({ kind: 'err', text: error.message });
      return;
    }
    setMsg({ kind: 'ok', text: 'Chart header updated.' });
  }

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
    setPositions((prev) => (prev.some((x) => x.id === saved.id) ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved]));
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
      const { error } = await sb.from('org_positions').update({ parent_position_id: absorbTargetId }).eq('id', child.id);
      if (error) {
        setBusy(false);
        setMsg({ kind: 'err', text: error.message });
        return;
      }
      if (child.holder_operator_id && targetHead?.holder_user_id) {
        await sb.from('operators').update({ department_head_id: targetHead.holder_user_id }).eq('id', child.holder_operator_id);
      }
    }

    for (const sc of positions.filter((x) => x.secondary_parent_id === absorbSourceId)) {
      await sb.from('org_positions').update({ secondary_parent_id: absorbTargetId }).eq('id', sc.id);
    }

    if (archiveSource) {
      await sb.from('org_positions').update({ is_active: false, is_vacant: true, holder_user_id: null }).eq('id', absorbSourceId);
    }

    const { data: refreshed } = await sb.from('org_positions').select('*').eq('organization_id', p.orgId).order('sort_order');
    setBusy(false);
    if (refreshed) setPositions(refreshed as OrgPositionRow[]);
    setAbsorbOpen(false);
    setMsg({ kind: 'ok', text: `Restructured ${children.length} position(s) under ${targetHead?.title ?? 'target head'}.` });
  }

  function renderPersonCard(pos: OrgPositionRow, compact = false, centered = false) {
    const { name } = resolvePositionDisplayName(pos, usersById, opsById);
    const theme = THEME_STYLES[pos.color_theme] ?? THEME_STYLES.slate;
    const isSolidHeader = pos.tier === 'executive' || pos.tier === 'head';
    const isNightCard = pos.color_theme === 'amber' && !isSolidHeader;
    const editable = editMode && p.canEdit;

    return (
      <div
        key={pos.id}
        onClick={() => editable && setEditingPos({ ...pos })}
        className={centered ? 'row-sm text-center' : 'row-between'}
        style={{
          justifyContent: centered ? 'center' : 'space-between',
          background: pos.is_vacant ? 'var(--warn-bg)' : isSolidHeader ? theme.bg : isNightCard ? 'var(--warn-bg)' : 'var(--surface)',
          color: pos.is_vacant ? 'var(--warn-fg)' : isSolidHeader ? theme.fg : isNightCard ? 'var(--warn-fg)' : 'var(--text)',
          border: pos.is_vacant ? '2px dashed var(--warn-border)' : `1px solid ${theme.border}`,
          borderRadius: 8,
          padding: compact ? '6px 9px' : '10px 14px',
          cursor: editable ? 'pointer' : 'default',
          opacity: pos.is_active ? 1 : 0.55,
          boxShadow: isSolidHeader ? '0 2px 6px rgba(15,23,42,0.12)' : '0 1px 2px rgba(15,23,42,0.04)',
          outline: editable ? '1px dashed rgba(2,132,199,0.35)' : undefined,
        }}
        title={editable ? 'Click to edit position or reassign person' : undefined}
      >
        <div style={{ minWidth: 0 }}>
          {pos.tier === 'executive' && (
            <div className="font-bold" style={{ fontSize: 9.5, opacity: 0.8, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 1 }}>
              {pos.department_group}
            </div>
          )}
          <div className="font-bold truncate" style={{ fontSize: compact ? 12 : 14 }}>{name}</div>
          <div style={{ fontSize: compact ? 10.5 : 11.5, opacity: isSolidHeader && !pos.is_vacant ? 0.9 : 0.72 }}>
            {pos.title}
            {!pos.is_active ? ' · Archived' : ''}
          </div>
        </div>
        {pos.shift_badge && (
          <span
            className="font-bold"
            style={{
              background: pos.color_theme === 'amber' ? 'var(--warn-bg)' : theme.badgeBg,
              color: pos.color_theme === 'amber' ? 'var(--warn-fg)' : theme.badgeFg,
              border: pos.color_theme === 'amber' ? '1px solid var(--warn-border)' : undefined,
              fontSize: 10,
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

  const openHeaderEditor = () => {
    setDraftMeta(meta);
    setEditingHeader(true);
  };

  return (
    <div className="stack-md">
      <style>{`
        @media print {
          @page { size: landscape; margin: 8mm; }
          .org-canvas { box-shadow: none !important; border: none !important; padding: 8px !important; }
        }
      `}</style>

      <div className="no-print card card-pad-sm row-wrap">
        <div>
          <h1 className="page-title" style={{ fontSize: 15 }}>Master Organizational Chart</h1>
          <span className="text-secondary-xs">
            Heads &amp; Up · Auto-updates when heads resign or new heads sign up
          </span>
        </div>

        <div className="row-wrap" style={{ marginLeft: 'auto' }}>
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
                  <button type="button" className="btn" onClick={openHeaderEditor}>Edit Header</button>
                  <button
                    type="button"
                    className="btn btn-add"
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
                  <label className="row-xs text-sm">
                    <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                    Show archived
                  </label>
                </>
              )}
            </>
          )}
          <button type="button" className="btn" onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>

      {p.migrationMissing && (
        <div className="no-print card card-pad-sm text-sm" style={{ borderLeft: '4px solid var(--warn-border)' }}>
          Run migration <code>supabase/migrations/015_org_chart.sql</code> in Supabase SQL Editor to enable and seed the editable Organizational Chart.
        </div>
      )}

      {msg && (
        <div
          className="no-print card card-pad-xs text-sm"
          role="alert"
          style={{
            borderLeft: `4px solid ${msg.kind === 'err' ? 'var(--danger)' : 'var(--ok-fg)'}`,
            color: msg.kind === 'err' ? 'var(--danger-fg)' : 'var(--ok-fg)',
          }}
        >
          {msg.text}
        </div>
      )}

      {editMode && p.canEdit && (
        <div className="no-print text-secondary-sm" style={{ padding: '0 4px' }}>
          Tip: Click the header or any card below to edit titles, shift legends, reporting parents, or assign/vacate occupants.
        </div>
      )}

      {/* Visual Org Chart Canvas (Desktop) */}
      <div className="responsive-table-wrap">
        <div className="org-canvas scroll-x" style={ORG_S.canvas}>
        <div
          onClick={() => editMode && p.canEdit && openHeaderEditor()}
          className="row-between-wrap"
          style={{
            gap: 12,
            borderBottom: '1px solid var(--border-light)',
            paddingBottom: 12,
            marginBottom: 16,
            cursor: editMode && p.canEdit ? 'pointer' : 'default',
          }}
          title={editMode && p.canEdit ? 'Click to edit chart title, subtitle, and shift legends' : undefined}
        >
          <div className="row-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bpwi-logo.svg" alt="BPWI Logo" style={ORG_S.logoImg} />
            <div>
              <div className="row-sm">
                <span className="font-bold" style={{ fontSize: 18, color: 'var(--text)' }}>{meta.title}</span>
                {p.canEdit && (
                  <button
                    type="button"
                    className="no-print btn btn-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      openHeaderEditor();
                    }}
                    title="Edit chart header & legends"
                  >
                    ✎ Edit
                  </button>
                )}
              </div>
              <div className="text-secondary-sm">{meta.subtitle}</div>
            </div>
          </div>

          <div className="row-wrap">
            {meta.legend1 && <span className="badge badge-info">{meta.legend1}</span>}
            {meta.legend2 && <span className="badge badge-warn">{meta.legend2}</span>}
          </div>
        </div>

        {/* Tier 1: Executive + Support Group + Direct Staff */}
        <div style={ORG_S.execGrid}>
          <div />
          <div style={ORG_S.execCenter}>
            <div style={{ minWidth: 270 }}>{executives.map((ex) => renderPersonCard(ex, false, true))}</div>
            <StemDown height={22} />
          </div>

          <div className="stack-sm" style={{ justifyItems: 'start' }}>
            {supportGroup.length > 0 && (
              <div className="row-sm" style={{ gap: 0 }}>
                <div style={{ width: 20, borderTop: '2px dashed var(--border)' }} />
                <div className="card-pad-xs" style={ORG_S.supportBox}>
                  <div className="row-between text-secondary-xs font-bold" style={{ fontSize: 9.5, marginBottom: 5, gap: 12 }}>
                    <span>SUPPORT GROUP</span>
                    <span style={{ fontStyle: 'italic', fontWeight: 500 }}>Advisory &amp; Control</span>
                  </div>
                  <div className="row-wrap" style={{ gap: 6 }}>{supportGroup.map((s) => renderPersonCard(s, true))}</div>
                </div>
              </div>
            )}
            {execDirectStaff.length > 0 && (
              <div className="row-wrap" style={{ gap: 6, paddingLeft: 20 }}>
                {execDirectStaff.map((s) => renderPersonCard(s, true))}
              </div>
            )}
          </div>
        </div>

        <BusConnector
          items={headColumns.map((col) => ({ key: `stem-${col.head.id}`, span: col.span }))}
          gridTemplateColumns={`repeat(${totalTeamCols}, minmax(205px, 1fr))`}
          height={20}
        />

        {/* Tier 2 & 3: Department Heads + Optional Leadman + Team Columns */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${totalTeamCols}, minmax(205px, 1fr))`, columnGap: 12, alignItems: 'start' }}>
          {headColumns.map(({ head, groups }) => {
            const headLeadmen = leadmen.filter((l) => l.parent_position_id === head.id);
            return (
              <div key={head.id} style={{ gridColumn: `span ${Math.max(1, groups.length)}`, display: 'flex', flexDirection: 'column' }}>
                {renderPersonCard(head, false, true)}

                {headLeadmen.length > 0 && (
                  <>
                    <StemDown />
                    <div className="row-sm" style={{ justifyContent: 'center' }}>
                      {headLeadmen.map((lm) => (
                        <div key={lm.id} className="w-full" style={{ minWidth: 230, maxWidth: 290 }}>
                          {renderPersonCard(lm, true)}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <StemDown />

                {groups.length > 0 ? (
                  <>
                    {groups.length > 1 && (
                      <BusConnector
                        items={groups.map(([gName]) => ({ key: `substem-${head.id}-${gName}` }))}
                        gridTemplateColumns={`repeat(${groups.length}, 1fr)`}
                        height={14}
                      />
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${groups.length}, 1fr)`, columnGap: 12, alignItems: 'start' }}>
                      {groups.map(([groupName, members]) => (
                        <div key={`${head.id}-${groupName}`} className="card-pad-xs stack-sm" style={ORG_S.teamBox}>
                          <div className="font-bold" style={{ fontSize: 10.5, color: 'var(--accent)', letterSpacing: '0.03em' }}>
                            {groupName}
                          </div>
                          {members.map((m) => renderPersonCard(m, true))}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="card-pad-xs text-center text-muted-xs" style={ORG_S.emptyTeamBox}>
                    No staff assigned yet
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {orphanStaff.length > 0 && (
          <div className="card-pad-xs stack-xs" style={ORG_S.orphanBox}>
            <div className="section-eyebrow">UNASSIGNED / OTHER NODES</div>
            <div className="row-wrap">{orphanStaff.map((s) => renderPersonCard(s, true))}</div>
          </div>
        )}
        </div>
      </div>

      {/* Mobile Vertical Org Tree (<= 640px) */}
      <div className="responsive-cards">
        {/* Chart Header Card */}
        <div
          className="card"
          style={{
            padding: 12,
            display: 'grid',
            gap: 10,
            cursor: editMode && p.canEdit ? 'pointer' : 'default',
          }}
          onClick={() => editMode && p.canEdit && openHeaderEditor()}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bpwi-logo.svg" alt="BPWI Logo" style={{ width: 40, height: 30, objectFit: 'contain', flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="font-bold" style={{ fontSize: 15, color: 'var(--text)', lineHeight: 1.25 }}>
                {meta.title}
              </div>
              <div className="text-secondary-sm" style={{ marginTop: 2 }}>{meta.subtitle}</div>
            </div>
            {p.canEdit && (
              <button
                type="button"
                className="no-print btn btn-sm"
                style={{ flexShrink: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  openHeaderEditor();
                }}
                title="Edit chart header & legends"
              >
                ✎ Edit
              </button>
            )}
          </div>
          {(meta.legend1 || meta.legend2) && (
            <div className="row-wrap" style={{ gap: 6 }}>
              {meta.legend1 && <span className="badge badge-info">{meta.legend1}</span>}
              {meta.legend2 && <span className="badge badge-warn">{meta.legend2}</span>}
            </div>
          )}
        </div>

        {/* Tier 1: Executive + Support Group + Direct Staff */}
        <div className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div className="section-eyebrow">EXECUTIVE</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {executives.map((ex) => renderPersonCard(ex, false, false))}
          </div>

          {supportGroup.length > 0 && (
            <div style={{ ...ORG_S.supportBox, padding: 10, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="font-bold text-secondary-xs">SUPPORT GROUP</span>
                <span className="text-secondary-xs" style={{ fontStyle: 'italic' }}>Advisory &amp; Control</span>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {supportGroup.map((s) => renderPersonCard(s, true))}
              </div>
            </div>
          )}

          {execDirectStaff.length > 0 && (
            <div style={{ display: 'grid', gap: 6 }}>
              <div className="section-eyebrow">DIRECT REPORTS</div>
              {execDirectStaff.map((s) => renderPersonCard(s, true))}
            </div>
          )}
        </div>

        {/* Tier 2 & 3: Department Heads -> Leadmen -> Crew Groups */}
        {headColumns.map(({ head, groups }) => {
          const headLeadmen = leadmen.filter((l) => l.parent_position_id === head.id);
          return (
            <div key={`m-${head.id}`} className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
              {renderPersonCard(head, false, false)}

              {headLeadmen.length > 0 && (
                <div style={{ paddingLeft: 10, borderLeft: '2px solid var(--border)', display: 'grid', gap: 6 }}>
                  <div className="section-eyebrow">LEADMAN / BRIDGE</div>
                  {headLeadmen.map((lm) => renderPersonCard(lm, true))}
                </div>
              )}

              <div style={{ paddingLeft: 10, borderLeft: '2px solid var(--border)', display: 'grid', gap: 8 }}>
                {groups.length > 0 ? (
                  groups.map(([groupName, members]) => (
                    <div
                      key={`m-${head.id}-${groupName}`}
                      style={{
                        background: 'var(--surface-muted)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: 8,
                        display: 'grid',
                        gap: 6,
                      }}
                    >
                      <div className="font-bold" style={{ fontSize: 11, color: 'var(--accent)', letterSpacing: '0.03em' }}>
                        {groupName}
                      </div>
                      {members.map((m) => renderPersonCard(m, true))}
                    </div>
                  ))
                ) : (
                  <div className="card-pad-xs text-center text-muted-xs" style={ORG_S.emptyTeamBox}>
                    No staff assigned yet
                  </div>
                )}
              </div>

              {editMode && p.canEdit && (
                <button
                  type="button"
                  className="btn btn-sm btn-add"
                  onClick={() =>
                    setEditingPos({
                      title: '',
                      department_group: head.department_group || 'OPERATIONS',
                      tier: 'staff',
                      parent_position_id: head.id,
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
                  + Add Position under {head.department_group || head.title}
                </button>
              )}
            </div>
          );
        })}

        {orphanStaff.length > 0 && (
          <div className="card" style={{ padding: 12, display: 'grid', gap: 8, borderStyle: 'dashed' }}>
            <div className="section-eyebrow">UNASSIGNED / OTHER NODES</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {orphanStaff.map((s) => renderPersonCard(s, true))}
            </div>
          </div>
        )}
      </div>

      {editingHeader && (
        <OrgHeaderModal
          draftMeta={draftMeta}
          busy={busy}
          onChange={setDraftMeta}
          onCancel={() => setEditingHeader(false)}
          onSave={saveHeaderMeta}
        />
      )}

      {editingPos && (
        <OrgPositionModal
          editingPos={editingPos}
          positions={positions}
          users={p.users}
          operators={p.operators}
          usersById={usersById}
          opsById={opsById}
          busy={busy}
          onChange={setEditingPos}
          onCancel={() => setEditingPos(null)}
          onSave={savePosition}
          onDelete={deletePosition}
        />
      )}

      {absorbOpen && p.isAdmin && (
        <OrgAbsorbModal
          heads={heads}
          usersById={usersById}
          opsById={opsById}
          absorbSourceId={absorbSourceId}
          absorbTargetId={absorbTargetId}
          archiveSource={archiveSource}
          busy={busy}
          onSourceChange={setAbsorbSourceId}
          onTargetChange={setAbsorbTargetId}
          onArchiveChange={setArchiveSource}
          onCancel={() => setAbsorbOpen(false)}
          onConfirm={runAbsorbDepartment}
        />
      )}
    </div>
  );
}
