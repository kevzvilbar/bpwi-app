'use client';

import {
  resolvePositionDisplayName,
  type OrgColorTheme,
  type OrgOperatorLite,
  type OrgPositionRow,
  type OrgTier,
  type OrgUserLite,
} from '@/lib/org-chart';

export interface OrgChartMeta {
  title: string;
  subtitle: string;
  legend1: string;
  legend2: string;
}

export function OrgHeaderModal({
  draftMeta,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draftMeta: OrgChartMeta;
  busy: boolean;
  onChange: (next: OrgChartMeta) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="modal-overlay no-print" role="dialog" aria-modal="true" onClick={() => !busy && onCancel()}>
      <div className="card" style={{ maxWidth: 480, width: '95vw', padding: 16, display: 'grid', gap: 10 }} onClick={(e) => e.stopPropagation()}>
        <strong style={{ fontSize: 15 }}>Edit Chart Header &amp; Shift Legends</strong>
        <label style={{ fontSize: 12 }}>
          Organization / Office Title
          <input className="input" value={draftMeta.title} onChange={(e) => onChange({ ...draftMeta, title: e.target.value })} />
        </label>
        <label style={{ fontSize: 12 }}>
          Chart Subtitle
          <input className="input" value={draftMeta.subtitle} onChange={(e) => onChange({ ...draftMeta, subtitle: e.target.value })} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ fontSize: 12 }}>
            Shift Legend 1 (Blue)
            <input className="input" value={draftMeta.legend1} onChange={(e) => onChange({ ...draftMeta, legend1: e.target.value })} />
          </label>
          <label style={{ fontSize: 12 }}>
            Shift Legend 2 (Amber)
            <input className="input" value={draftMeta.legend2} onChange={(e) => onChange({ ...draftMeta, legend2: e.target.value })} />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onSave}>Save Header</button>
        </div>
      </div>
    </div>
  );
}

export function OrgPositionModal({
  editingPos,
  positions,
  users,
  operators,
  usersById,
  opsById,
  busy,
  onChange,
  onCancel,
  onSave,
  onDelete,
}: {
  editingPos: Partial<OrgPositionRow>;
  positions: OrgPositionRow[];
  users: OrgUserLite[];
  operators: OrgOperatorLite[];
  usersById: Map<string, OrgUserLite>;
  opsById: Map<string, OrgOperatorLite>;
  busy: boolean;
  onChange: (next: Partial<OrgPositionRow>) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="modal-overlay no-print" role="dialog" aria-modal="true" onClick={() => !busy && onCancel()}>
      <div className="card" style={{ maxWidth: 520, width: '95vw', padding: 16, display: 'grid', gap: 10 }} onClick={(e) => e.stopPropagation()}>
        <strong style={{ fontSize: 15 }}>{editingPos.id ? 'Edit Org Position' : 'Add Org Position'}</strong>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ fontSize: 12 }}>
            Position Title *
            <input
              className="input"
              value={editingPos.title ?? ''}
              onChange={(e) => onChange({ ...editingPos, title: e.target.value })}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Department / Team Group
            <input
              className="input"
              value={editingPos.department_group ?? ''}
              onChange={(e) => onChange({ ...editingPos, department_group: e.target.value })}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ fontSize: 12 }}>
            Tier
            <select
              className="input"
              value={editingPos.tier ?? 'staff'}
              onChange={(e) => onChange({ ...editingPos, tier: e.target.value as OrgTier })}
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
              onChange={(e) => onChange({ ...editingPos, parent_position_id: e.target.value || null })}
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
              onChange={(e) => onChange({ ...editingPos, shift_badge: e.target.value })}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Color Theme
            <select
              className="input"
              value={editingPos.color_theme ?? 'slate'}
              onChange={(e) => onChange({ ...editingPos, color_theme: e.target.value as OrgColorTheme })}
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
              onChange={(e) => onChange({ ...editingPos, sort_order: +e.target.value })}
            />
          </label>
        </div>

        <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8, display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={Boolean(editingPos.is_vacant)}
              onChange={(e) => onChange({ ...editingPos, is_vacant: e.target.checked })}
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
                  onChange={(e) => onChange({ ...editingPos, holder_user_id: e.target.value || null })}
                >
                  <option value="">— No App Account Linked —</option>
                  {users
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
                    onChange={(e) => onChange({ ...editingPos, holder_operator_id: e.target.value || null })}
                  >
                    <option value="">— None —</option>
                    {operators.map((o) => (
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
                    onChange={(e) => onChange({ ...editingPos, fallback_name: e.target.value })}
                  />
                </label>
              </div>
            </>
          )}

          <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={editingPos.is_active ?? true}
              onChange={(e) => onChange({ ...editingPos, is_active: e.target.checked })}
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
              onClick={() => onDelete(editingPos.id!)}
            >
              Delete Node
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={onSave}>
              Save Position
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OrgAbsorbModal({
  heads,
  usersById,
  opsById,
  absorbSourceId,
  absorbTargetId,
  archiveSource,
  busy,
  onSourceChange,
  onTargetChange,
  onArchiveChange,
  onCancel,
  onConfirm,
}: {
  heads: OrgPositionRow[];
  usersById: Map<string, OrgUserLite>;
  opsById: Map<string, OrgOperatorLite>;
  absorbSourceId: string;
  absorbTargetId: string;
  archiveSource: boolean;
  busy: boolean;
  onSourceChange: (id: string) => void;
  onTargetChange: (id: string) => void;
  onArchiveChange: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-overlay no-print" role="dialog" aria-modal="true" onClick={() => !busy && onCancel()}>
      <div className="card" style={{ maxWidth: 460, width: '95vw', padding: 16, display: 'grid', gap: 10 }} onClick={(e) => e.stopPropagation()}>
        <strong style={{ fontSize: 15 }}>Restructure / Absorb Department</strong>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Move all teams and staff under one Department Head to another Head (for example, if a department is omitted and absorbed).
        </p>
        <label style={{ fontSize: 12 }}>
          From Department Head (to move/omit)
          <select className="input" value={absorbSourceId} onChange={(e) => onSourceChange(e.target.value)}>
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
          <select className="input" value={absorbTargetId} onChange={(e) => onTargetChange(e.target.value)}>
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
          <input type="checkbox" checked={archiveSource} onChange={(e) => onArchiveChange(e.target.checked)} />
          Archive the omitted source department head position
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>
            Move &amp; Absorb
          </button>
        </div>
      </div>
    </div>
  );
}
