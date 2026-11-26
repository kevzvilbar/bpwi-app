'use client';

import { ALL_FORM_COLUMNS, type AccomplishmentEntry } from '@/lib/accomplishment-form';

interface Props {
  entries: AccomplishmentEntry[];
  isLocked: boolean;
  onUpdate: (idx: number, patch: Partial<AccomplishmentEntry>) => void;
  onRemove: (idx: number) => void;
}

const CELL_INPUT_STYLE = { padding: '4px 6px' } as const;

export default function AccomplishmentEntryEditor({ entries, isLocked, onUpdate, onRemove }: Props) {
  return (
    <>
      {/* Mobile Stacked Card Editor (<= 640px) */}
      <div className="responsive-cards mobile-toolbar-compact" style={{ gap: 10 }}>
        {entries.map((row, idx) => (
          <div
            key={`m-${row.id}`}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 10,
              background: 'var(--surface-muted)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 12 }}>
                Entry #{idx + 1}{row.source_activity_id ? ' · Synced' : ''}
              </strong>
              {!isLocked && (
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '2px 8px', fontSize: 12, color: 'var(--danger)' }}
                  onClick={() => onRemove(idx)}
                >
                  Remove
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px', gap: 8 }}>
              <label style={{ fontSize: 11.5, minWidth: 0 }}>
                Form Column
                <select
                  className="input"
                  style={{ minWidth: 0 }}
                  disabled={isLocked}
                  value={row.column_id ?? '__others__'}
                  onChange={(e) => {
                    const val = e.target.value;
                    onUpdate(idx, {
                      column_id: val === '__others__' ? null : val,
                      others_specify: val === '__others__' ? (row.others_specify || 'W.M') : '',
                    });
                  }}
                >
                  <option value="__others__">OTHERS (SPECIFY)</option>
                  <optgroup label="TECHNICAL">
                    {ALL_FORM_COLUMNS.filter((c) => c.group === 'technical').map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="PROJECT">
                    {ALL_FORM_COLUMNS.filter((c) => c.group === 'project').map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <label style={{ fontSize: 11.5, minWidth: 0 }}>
                Others
                <input
                  className="input"
                  disabled={isLocked || row.column_id !== null}
                  placeholder="W.M"
                  value={row.column_id === null ? row.others_specify : ''}
                  onChange={(e) => onUpdate(idx, { others_specify: e.target.value })}
                />
              </label>
            </div>
            <div className="entry-location-grid">
              <label className="entry-site-field" style={{ fontSize: 11.5 }}>
                Project / Site
                <input className="input" disabled={isLocked} value={row.location_project} onChange={(e) => onUpdate(idx, { location_project: e.target.value })} />
              </label>
              <label style={{ fontSize: 11.5 }}>
                PH
                <input className="input" disabled={isLocked} value={row.location_ph} onChange={(e) => onUpdate(idx, { location_ph: e.target.value })} />
              </label>
              <label style={{ fontSize: 11.5 }}>
                BLK
                <input className="input" disabled={isLocked} value={row.location_blk} onChange={(e) => onUpdate(idx, { location_blk: e.target.value })} />
              </label>
              <label style={{ fontSize: 11.5 }}>
                LOT
                <input className="input" disabled={isLocked} value={row.location_lot} onChange={(e) => onUpdate(idx, { location_lot: e.target.value })} />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <label style={{ fontSize: 11.5, minWidth: 0 }}>
                Time Started
                <input className="input" disabled={isLocked} placeholder="3:10 PM" value={row.time_started} onChange={(e) => onUpdate(idx, { time_started: e.target.value })} />
              </label>
              <label style={{ fontSize: 11.5, minWidth: 0 }}>
                Time Finished
                <input className="input" disabled={isLocked} placeholder="3:54 PM" value={row.time_finished} onChange={(e) => onUpdate(idx, { time_finished: e.target.value })} />
              </label>
            </div>
            <label style={{ fontSize: 11.5 }}>
              Remarks
              <input className="input" disabled={isLocked} placeholder="Well / site status, FM & PG readings..." value={row.remarks} onChange={(e) => onUpdate(idx, { remarks: e.target.value })} />
            </label>
          </div>
        ))}
      </div>

      {/* Desktop Editable Rows Table */}
      <div className="responsive-table-wrap" style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface-muted)', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px', minWidth: 180 }}>Form Column</th>
              <th style={{ padding: '6px 8px', width: 108 }}>Others (Code)</th>
              <th style={{ padding: '6px 8px', width: 130 }}>Project / Site</th>
              <th style={{ padding: '6px 8px', width: 72 }}>PH</th>
              <th style={{ padding: '6px 8px', width: 72 }}>BLK</th>
              <th style={{ padding: '6px 8px', width: 72 }}>LOT</th>
              <th style={{ padding: '6px 8px', width: 108 }}>Started</th>
              <th style={{ padding: '6px 8px', width: 108 }}>Finished</th>
              <th style={{ padding: '6px 8px', minWidth: 220 }}>Remarks</th>
              <th style={{ padding: '6px 8px', width: 42 }}></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((row, idx) => (
              <tr key={row.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td style={{ padding: 4 }}>
                  <select
                    className="input"
                    style={CELL_INPUT_STYLE}
                    disabled={isLocked}
                    value={row.column_id ?? '__others__'}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdate(idx, {
                        column_id: val === '__others__' ? null : val,
                        others_specify: val === '__others__' ? (row.others_specify || 'W.M') : '',
                      });
                    }}
                  >
                    <option value="__others__">OTHERS (SPECIFY)</option>
                    <optgroup label="TECHNICAL">
                      {ALL_FORM_COLUMNS.filter((c) => c.group === 'technical').map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="PROJECT">
                      {ALL_FORM_COLUMNS.filter((c) => c.group === 'project').map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </optgroup>
                  </select>
                </td>
                <td style={{ padding: 4 }}>
                  <input
                    className="input"
                    style={CELL_INPUT_STYLE}
                    disabled={isLocked || row.column_id !== null}
                    placeholder="W.M"
                    value={row.column_id === null ? row.others_specify : ''}
                    onChange={(e) => onUpdate(idx, { others_specify: e.target.value })}
                  />
                </td>
                <td style={{ padding: 4 }}>
                  <input
                    className="input"
                    style={CELL_INPUT_STYLE}
                    disabled={isLocked}
                    placeholder="e.g. Sta. Barbara"
                    value={row.location_project}
                    onChange={(e) => onUpdate(idx, { location_project: e.target.value })}
                  />
                </td>
                <td style={{ padding: 4 }}>
                  <input
                    className="input"
                    style={CELL_INPUT_STYLE}
                    disabled={isLocked}
                    value={row.location_ph}
                    onChange={(e) => onUpdate(idx, { location_ph: e.target.value })}
                  />
                </td>
                <td style={{ padding: 4 }}>
                  <input
                    className="input"
                    style={CELL_INPUT_STYLE}
                    disabled={isLocked}
                    value={row.location_blk}
                    onChange={(e) => onUpdate(idx, { location_blk: e.target.value })}
                  />
                </td>
                <td style={{ padding: 4 }}>
                  <input
                    className="input"
                    style={CELL_INPUT_STYLE}
                    disabled={isLocked}
                    value={row.location_lot}
                    onChange={(e) => onUpdate(idx, { location_lot: e.target.value })}
                  />
                </td>
                <td style={{ padding: 4 }}>
                  <input
                    className="input"
                    style={CELL_INPUT_STYLE}
                    disabled={isLocked}
                    placeholder="3:10 PM"
                    value={row.time_started}
                    onChange={(e) => onUpdate(idx, { time_started: e.target.value })}
                  />
                </td>
                <td style={{ padding: 4 }}>
                  <input
                    className="input"
                    style={CELL_INPUT_STYLE}
                    disabled={isLocked}
                    placeholder="3:54 PM"
                    value={row.time_finished}
                    onChange={(e) => onUpdate(idx, { time_finished: e.target.value })}
                  />
                </td>
                <td style={{ padding: 4 }}>
                  <input
                    className="input"
                    style={CELL_INPUT_STYLE}
                    disabled={isLocked}
                    placeholder="Well / site status, FM & PG readings..."
                    value={row.remarks}
                    onChange={(e) => onUpdate(idx, { remarks: e.target.value })}
                  />
                </td>
                <td style={{ padding: 4, textAlign: 'center' }}>
                  {!isLocked && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '4px 8px', color: 'var(--danger)' }}
                      onClick={() => onRemove(idx)}
                      title="Remove row"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
