'use client';

import type { Dispatch, SetStateAction } from 'react';
import {
  SETUP_CELL_STYLE,
  SETUP_INPUT_STYLE,
  getSetupSaveLabel,
  type SetupArea,
  type SetupShift,
} from '@/components/SetupUsersAndAudit';

interface SetupReferenceTabsProps {
  mode: 'mobile' | 'desktop';
  tab: 'shifts' | 'areas';
  shifts: SetupShift[];
  areas: SetupArea[];
  setShifts: Dispatch<SetStateAction<SetupShift[]>>;
  setAreas: Dispatch<SetStateAction<SetupArea[]>>;
  saveRow: <T extends { id?: string }>(
    table: string,
    row: T,
    idx: number,
    key: string,
    setter: Dispatch<SetStateAction<T[]>>,
  ) => Promise<void> | void;
  requestDelete: <T extends { id?: string }>(
    table: string,
    id: string | undefined,
    idx: number,
    label: string,
    setter: Dispatch<SetStateAction<T[]>>,
  ) => void;
  markDirty: (key: string) => void;
  busy: string;
  savedKey: string;
  dirty: Set<string>;
}

function ColorSwatchInput({ v, on }: { v: string; on: (c: string) => void }) {
  return (
    <input
      type="color"
      value={v}
      onChange={(e) => on(e.target.value)}
      style={{ width: 34, height: 28, padding: 0, border: '1px solid var(--border)', borderRadius: 4 }}
    />
  );
}

const DEFAULT_NEW_SHIFT: SetupShift = {
  code: '',
  description: '',
  start_time: '06:00',
  end_time: '14:00',
  duration_hours: 8,
  is_off: false,
  background_color: '#ffffff',
  text_color: '#0f172a',
};

const DEFAULT_NEW_AREA: SetupArea = {
  code: '',
  name: '',
  category: 'station',
  background_color: '#f1f5f9',
  text_color: '#1e293b',
};

export default function SetupReferenceTabs({
  mode,
  tab,
  shifts,
  areas,
  setShifts,
  setAreas,
  saveRow,
  requestDelete,
  markDirty,
  busy,
  savedKey,
  dirty,
}: SetupReferenceTabsProps) {
  const updShift = (i: number, patch: Partial<SetupShift>) => {
    setShifts((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    markDirty(`s${i}`);
  };

  const updArea = (i: number, patch: Partial<SetupArea>) => {
    setAreas((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    markDirty(`a${i}`);
  };

  const saveLabel = (key: string) => getSetupSaveLabel(key, busy, savedKey, dirty);

  if (mode === 'mobile') {
    if (tab === 'shifts') {
      return (
        <>
          {shifts.map((s, i) => (
            <div key={s.id ?? `msn${i}`} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                <label style={{ fontSize: 12, width: 90 }}>
                  Code
                  <input className="input" value={s.code} onChange={(e) => updShift(i, { code: e.target.value })} />
                </label>
                <label style={{ fontSize: 12, flex: 1 }}>
                  Description
                  <input className="input" value={s.description ?? ''} onChange={(e) => updShift(i, { description: e.target.value })} />
                </label>
                <span style={{ background: s.background_color, color: s.text_color, padding: '8px 12px', borderRadius: 6, fontWeight: 800, border: '1px solid var(--border)' }}>
                  {s.code || '?'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 76px', gap: 8 }}>
                <label style={{ fontSize: 12 }}>
                  Start
                  <input className="input" type="time" value={s.start_time?.slice(0, 5) ?? ''} onChange={(e) => updShift(i, { start_time: e.target.value || null })} />
                </label>
                <label style={{ fontSize: 12 }}>
                  End
                  <input className="input" type="time" value={s.end_time?.slice(0, 5) ?? ''} onChange={(e) => updShift(i, { end_time: e.target.value || null })} />
                </label>
                <label style={{ fontSize: 12 }}>
                  Hrs
                  <input className="input" type="number" step="0.5" value={s.duration_hours} onChange={(e) => updShift(i, { duration_hours: +e.target.value })} />
                </label>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    BG <ColorSwatchInput v={s.background_color} on={(c) => updShift(i, { background_color: c })} />
                  </label>
                  <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Text <ColorSwatchInput v={s.text_color} on={(c) => updShift(i, { text_color: c })} />
                  </label>
                  <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={s.is_off} onChange={(e) => updShift(i, { is_off: e.target.checked })} /> Off
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-primary" disabled={!s.code.trim() || busy === `s${i}`} onClick={() => saveRow('shift_types', s, i, `s${i}`, setShifts)}>
                    {saveLabel(`s${i}`)}
                  </button>
                  <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => requestDelete('shift_types', s.id, i, s.code || 'this shift', setShifts)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
          <button className="btn btn-add" onClick={() => setShifts((x) => [...x, { ...DEFAULT_NEW_SHIFT }])}>
            + Add shift type
          </button>
        </>
      );
    }

    return (
      <>
        {areas.map((a, i) => (
          <div key={a.id ?? `man${i}`} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
              <label style={{ fontSize: 12, width: 84 }}>
                Code
                <input className="input" value={a.code} onChange={(e) => updArea(i, { code: e.target.value })} />
              </label>
              <label style={{ fontSize: 12, flex: 1 }}>
                Name
                <input className="input" value={a.name ?? ''} onChange={(e) => updArea(i, { name: e.target.value })} />
              </label>
              <span style={{ background: a.background_color, color: a.text_color, padding: '8px 12px', borderRadius: 6, fontWeight: 800, border: '1px solid var(--border)' }}>
                {a.code || '?'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select className="input" style={{ width: 'auto' }} value={a.category} onChange={(e) => updArea(i, { category: e.target.value })}>
                  <option value="station">Station</option>
                  <option value="leave">Leave</option>
                  <option value="rest">Rest</option>
                  <option value="holiday">Holiday</option>
                </select>
                <ColorSwatchInput v={a.background_color} on={(c) => updArea(i, { background_color: c })} />
                <ColorSwatchInput v={a.text_color} on={(c) => updArea(i, { text_color: c })} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary" disabled={!a.code.trim() || busy === `a${i}`} onClick={() => saveRow('area_codes', a, i, `a${i}`, setAreas)}>
                  {saveLabel(`a${i}`)}
                </button>
                <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => requestDelete('area_codes', a.id, i, a.code || 'this area code', setAreas)}>
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
                    updArea(i, {
                      sub_sites: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              </label>
            )}
          </div>
        ))}
        <button className="btn btn-add" onClick={() => setAreas((x) => [...x, { ...DEFAULT_NEW_AREA }])}>
          + Add area / leave code
        </button>
      </>
    );
  }

  if (tab === 'shifts') {
    return (
      <table className="data-table">
        <thead>
          <tr>
            {['Code', 'Description', 'Start', 'End', 'Hours', 'Off day', 'BG', 'Text', 'Preview', ''].map((h) => (
              <th key={h} style={{ ...SETUP_CELL_STYLE, padding: '8px 6px', textAlign: 'left', background: 'var(--surface-muted)', color: 'var(--text)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shifts.map((s, i) => (
            <tr key={s.id ?? `n${i}`}>
              <td style={{ ...SETUP_CELL_STYLE, width: 76 }}>
                <input style={SETUP_INPUT_STYLE} value={s.code} onChange={(e) => updShift(i, { code: e.target.value })} />
              </td>
              <td style={SETUP_CELL_STYLE}>
                <input style={SETUP_INPUT_STYLE} value={s.description ?? ''} onChange={(e) => updShift(i, { description: e.target.value })} />
              </td>
              <td style={{ ...SETUP_CELL_STYLE, width: 105 }}>
                <input
                  style={SETUP_INPUT_STYLE}
                  type="time"
                  value={s.start_time?.slice(0, 5) ?? ''}
                  onChange={(e) => updShift(i, { start_time: e.target.value || null })}
                />
              </td>
              <td style={{ ...SETUP_CELL_STYLE, width: 105 }}>
                <input
                  style={SETUP_INPUT_STYLE}
                  type="time"
                  value={s.end_time?.slice(0, 5) ?? ''}
                  onChange={(e) => updShift(i, { end_time: e.target.value || null })}
                />
              </td>
              <td style={{ ...SETUP_CELL_STYLE, width: 68 }}>
                <input style={SETUP_INPUT_STYLE} type="number" step="0.5" value={s.duration_hours} onChange={(e) => updShift(i, { duration_hours: +e.target.value })} />
              </td>
              <td style={{ ...SETUP_CELL_STYLE, textAlign: 'center' }}>
                <input type="checkbox" checked={s.is_off} onChange={(e) => updShift(i, { is_off: e.target.checked })} />
              </td>
              <td style={SETUP_CELL_STYLE}>
                <ColorSwatchInput v={s.background_color} on={(c) => updShift(i, { background_color: c })} />
              </td>
              <td style={SETUP_CELL_STYLE}>
                <ColorSwatchInput v={s.text_color} on={(c) => updShift(i, { text_color: c })} />
              </td>
              <td style={SETUP_CELL_STYLE}>
                <span style={{ background: s.background_color, color: s.text_color, padding: '3px 10px', borderRadius: 4, fontWeight: 800, border: '1px solid var(--border)' }}>
                  {s.code || '?'}
                </span>
              </td>
              <td style={{ ...SETUP_CELL_STYLE, whiteSpace: 'nowrap' }}>
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
                  style={{ padding: '4px 9px', color: 'var(--danger)' }}
                  onClick={() => requestDelete('shift_types', s.id, i, s.code || 'this shift', setShifts)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={10} style={{ ...SETUP_CELL_STYLE, padding: 8 }}>
              <button className="btn btn-add" onClick={() => setShifts((x) => [...x, { ...DEFAULT_NEW_SHIFT }])}>
                + Add shift type
              </button>
            </td>
          </tr>
        </tfoot>
      </table>
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          {['Code', 'Name', 'Category', 'Sub-sites / Wells', 'BG', 'Text', 'Preview', ''].map((h) => (
            <th key={h} style={{ ...SETUP_CELL_STYLE, padding: '8px 6px', textAlign: 'left', background: 'var(--surface-muted)', color: 'var(--text)' }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {areas.map((a, i) => (
          <tr key={a.id ?? `n${i}`}>
            <td style={{ ...SETUP_CELL_STYLE, width: 80 }}>
              <input style={SETUP_INPUT_STYLE} value={a.code} onChange={(e) => updArea(i, { code: e.target.value })} />
            </td>
            <td style={SETUP_CELL_STYLE}>
              <input style={SETUP_INPUT_STYLE} value={a.name ?? ''} onChange={(e) => updArea(i, { name: e.target.value })} />
            </td>
            <td style={{ ...SETUP_CELL_STYLE, width: 115 }}>
              <select style={SETUP_INPUT_STYLE} value={a.category} onChange={(e) => updArea(i, { category: e.target.value })}>
                <option value="station">Station</option>
                <option value="leave">Leave</option>
                <option value="rest">Rest</option>
                <option value="holiday">Holiday</option>
              </select>
            </td>
            <td style={SETUP_CELL_STYLE}>
              {a.category === 'station' ? (
                <input
                  style={SETUP_INPUT_STYLE}
                  placeholder="Well 1, Well 2…"
                  value={(a.sub_sites ?? []).join(', ')}
                  onChange={(e) =>
                    updArea(i, {
                      sub_sites: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
              )}
            </td>
            <td style={SETUP_CELL_STYLE}>
              <ColorSwatchInput v={a.background_color} on={(c) => updArea(i, { background_color: c })} />
            </td>
            <td style={SETUP_CELL_STYLE}>
              <ColorSwatchInput v={a.text_color} on={(c) => updArea(i, { text_color: c })} />
            </td>
            <td style={SETUP_CELL_STYLE}>
              <span style={{ background: a.background_color, color: a.text_color, padding: '3px 10px', borderRadius: 4, fontWeight: 800, border: '1px solid var(--border)' }}>
                {a.code || '?'}
              </span>
            </td>
            <td style={{ ...SETUP_CELL_STYLE, whiteSpace: 'nowrap' }}>
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
                style={{ padding: '4px 9px', color: 'var(--danger)' }}
                onClick={() => requestDelete('area_codes', a.id, i, a.code || 'this area code', setAreas)}
              >
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={8} style={{ ...SETUP_CELL_STYLE, padding: 8 }}>
            <button className="btn btn-add" onClick={() => setAreas((x) => [...x, { ...DEFAULT_NEW_AREA }])}>
              + Add area / leave code
            </button>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
