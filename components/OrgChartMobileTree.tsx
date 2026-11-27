'use client';

import type { ReactNode } from 'react';
import type { OrgPositionRow } from '@/lib/org-chart';
import type { OrgChartMeta } from '@/components/OrgChartModals';
import { ORG_S } from '@/components/OrgChartConnectors';

export interface OrgChartHeadColumn {
  head: OrgPositionRow;
  groups: Array<[string, OrgPositionRow[]]>;
  span: number;
}

/** Mobile vertical hierarchical layout for the organizational chart (<= 640px). */
export default function OrgChartMobileTree({
  meta,
  editMode,
  canEdit,
  executives,
  supportGroup,
  execDirectStaff,
  headColumns,
  leadmen,
  orphanStaff,
  positionsCount,
  renderPersonCard,
  onOpenHeaderEditor,
  onAddPositionUnderHead,
}: {
  meta: OrgChartMeta;
  editMode: boolean;
  canEdit: boolean;
  executives: OrgPositionRow[];
  supportGroup: OrgPositionRow[];
  execDirectStaff: OrgPositionRow[];
  headColumns: OrgChartHeadColumn[];
  leadmen: OrgPositionRow[];
  orphanStaff: OrgPositionRow[];
  positionsCount: number;
  renderPersonCard: (pos: OrgPositionRow, compact?: boolean, centered?: boolean) => ReactNode;
  onOpenHeaderEditor: () => void;
  onAddPositionUnderHead: (draft: Partial<OrgPositionRow>) => void;
}) {
  return (
    <div className="responsive-cards">
      {/* Chart Header Card */}
      <div
        className="card"
        style={{
          padding: 12,
          display: 'grid',
          gap: 10,
          cursor: editMode && canEdit ? 'pointer' : 'default',
        }}
        onClick={() => editMode && canEdit && onOpenHeaderEditor()}
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
          {editMode && canEdit && (
            <button
              type="button"
              className="no-print btn btn-sm"
              style={{ flexShrink: 0 }}
              onClick={(e) => {
                e.stopPropagation();
                onOpenHeaderEditor();
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

            {editMode && canEdit && (
              <button
                type="button"
                className="btn btn-sm btn-add"
                onClick={() =>
                  onAddPositionUnderHead({
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
                    sort_order: positionsCount * 5,
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
  );
}
