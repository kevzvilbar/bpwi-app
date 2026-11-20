'use client';

import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  cellKey,
  DEFAULT_STATION_CODE,
  findOffShift,
  isHolidayArea,
  isLeaveArea,
  isRestArea,
  type Area,
  type HolidayItem,
  type Op,
  type PendingCellEntry,
  type RosterDay,
  type RosterDragBatch,
  type Row,
  type Shift,
  type Standby,
  type ToolMode,
} from '@/lib/roster-helpers';

interface RosterGridProps {
  monthLabel: string;
  today: string;
  days: RosterDay[];
  operators: Op[];
  totalOperatorsCount: number;
  operatorId?: string | null;
  canEdit: boolean;
  canOperate: boolean;
  mode: ToolMode;
  cell: Map<string, Row>;
  pendingMap: Map<string, PendingCellEntry>;
  standbyMap: Map<string, Standby>;
  shiftBy: Map<string, Shift>;
  areaBy: Map<string, Area>;
  pmByCell: Map<string, { titles: string[]; warn: boolean }>;
  holidayByDate: Map<string, HolidayItem>;
  dailyWorkingCounts: number[];
  dragRef: MutableRefObject<RosterDragBatch | null>;
  onApplyBrushLocal: (opId: string, date: string) => void;
  onActivateCell: (opId: string, date: string) => void;
  onClearCell: (opId: string, date: string) => void;
  onCopyCell: (opId: string, date: string) => void;
  onPasteCell: (opId: string, date: string) => void;
  onOpenContextMenu: (menu: { x: number; y: number; opId: string; opName: string; date: string }) => void;
}

export default function RosterGrid(p: RosterGridProps) {
  const [focused, setFocused] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<HTMLTableElement | null>(null);
  const offShift = useMemo(() => findOffShift(Array.from(p.shiftBy.values())), [p.shiftBy]);

  function handleCellKeyDown(e: React.KeyboardEvent<HTMLTableCellElement>, rIdx: number, cIdx: number, op: Op, date: string) {
    const maxR = p.operators.length - 1;
    const maxC = p.days.length - 1;
    let nr = rIdx;
    let nc = cIdx;
    if (e.key === 'ArrowRight') nc = Math.min(maxC, cIdx + 1);
    else if (e.key === 'ArrowLeft') nc = Math.max(0, cIdx - 1);
    else if (e.key === 'ArrowDown') nr = Math.min(maxR, rIdx + 1);
    else if (e.key === 'ArrowUp') nr = Math.max(0, rIdx - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      p.onActivateCell(op.id, date);
      return;
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      p.onClearCell(op.id, date);
      return;
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      p.onCopyCell(op.id, date);
      return;
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      p.onPasteCell(op.id, date);
      return;
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      p.onOpenContextMenu({ x: rect.left, y: rect.bottom + 2, opId: op.id, opName: op.full_name, date });
      return;
    } else {
      return;
    }

    e.preventDefault();
    setFocused({ r: nr, c: nc });
    const nextTd = gridRef.current?.querySelector<HTMLTableCellElement>(`td[data-rc="${nr}-${nc}"]`);
    nextTd?.focus();
  }

  return (
    <>
      {/* Print-only header */}
      <div
        className="print-only"
        style={{
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
          paddingBottom: 6,
          borderBottom: '1px solid #475569',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bpwi-logo.svg" alt="BPWI Logo" style={{ width: 34, height: 26, objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
              BP Waterworks, Inc. — Operations &amp; Plant Schedule
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>
              {p.monthLabel}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Spreadsheet Schedule Table (> 1024px only) */}
      <div
        className="schedule-container desktop-only-grid"
        style={{
          overflow: 'auto',
          maxHeight: '78vh',
          background: 'var(--surface)',
          borderRadius: 10,
          border: '1px solid var(--border)',
          boxShadow: '0 1px 4px rgba(15, 23, 42, 0.05)',
          touchAction: 'pan-x pan-y pinch-zoom',
        }}
      >
        <table ref={gridRef} className="schedule-table" role="grid" aria-label={`Monthly schedule for ${p.monthLabel}`}>
          <thead>
            <tr style={{ height: 26 }}>
              <th rowSpan={2} className="sticky-corner-idx" style={{ background: 'var(--header-bg)', color: 'var(--text-muted)', width: 36, minWidth: 36, textAlign: 'center', fontSize: 10 }}>
                #
              </th>
              <th rowSpan={2} className="sticky-corner-name" style={{ background: 'var(--header-bg)', color: 'var(--header-fg)', minWidth: 165, padding: '4px 8px', textAlign: 'left' }}>
                Operator ({p.operators.length})
              </th>
              <th
                colSpan={p.days.length}
                className="sticky-header-month"
                style={{ background: 'var(--header-bg)', color: 'var(--header-fg)', padding: '4px 8px', textAlign: 'left', fontSize: 11.5, letterSpacing: '0.03em', textTransform: 'uppercase' }}
              >
                {/* Sticks just right of the operator column so the month stays readable while scrolling the days */}
                <span style={{ position: 'sticky', left: 212, display: 'inline-block' }}>{p.monthLabel}</span>
              </th>
              <th rowSpan={2} className="sticky-corner-stat sticky-col-duty" style={{ background: 'var(--header-bg)', color: 'var(--header-fg)', width: 42, minWidth: 42, textAlign: 'center' }}>
                Duty
              </th>
              <th rowSpan={2} className="sticky-corner-stat sticky-col-oc" style={{ background: '#4c1d95', color: '#f5f3ff', width: 42, minWidth: 42, textAlign: 'center' }}>
                OC
              </th>
              <th rowSpan={2} className="sticky-corner-stat sticky-col-hours" style={{ background: 'var(--header-bg)', color: 'var(--header-fg)', width: 42, minWidth: 42, textAlign: 'center' }}>
                Hrs
              </th>
              <th rowSpan={2} className="sticky-corner-stat sticky-col-off" style={{ background: 'var(--header-bg)', color: 'var(--text-muted)', width: 42, minWidth: 42, textAlign: 'center' }}>
                Off
              </th>
              <th rowSpan={2} className="sticky-corner-stat sticky-col-leaves" style={{ background: 'var(--header-bg)', color: '#fde68a', width: 42, minWidth: 42, textAlign: 'center' }}>
                Lvs
              </th>
            </tr>

            <tr>
              {p.days.map((d) => {
                const isToday = d.date === p.today;
                const hol = p.holidayByDate.get(d.date);
                return (
                  <th
                    key={d.date}
                    className="sticky-header-days"
                    title={hol ? `${hol.name} (${hol.holiday_type.replace(/_/g, ' ')})` : undefined}
                    style={{
                      background: isToday
                        ? '#0369a1'
                        : hol
                          ? hol.holiday_type === 'regular'
                            ? '#9f1239'
                            : '#92400e'
                          : d.isWeekend
                            ? 'var(--surface-muted)'
                            : 'var(--header-bg)',
                      color: d.isWeekend && !isToday && !hol ? 'var(--text)' : 'var(--header-fg)',
                      minWidth: 58,
                      padding: '3px 4px',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <div style={{ lineHeight: 1.1 }}>
                      {d.dayNum}
                      {hol && <span style={{ marginLeft: 2, color: '#fde68a' }} aria-label="Holiday">★</span>}
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.9 }}>{d.dowLabel}</div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {p.operators.length === 0 ? (
              <tr>
                <td colSpan={p.days.length + 7} style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                  No operators found{p.totalOperatorsCount === 0 ? '. Import data or add operators under Operators & Setup.' : '.'}
                </td>
              </tr>
            ) : (
              p.operators.map((o, rIdx) => {
                let duty = 0;
                let ocCount = 0;
                let hrs = 0;
                let off = 0;
                let leaves = 0;

                return (
                  <tr key={o.id} className="operator-row">
                    <td className="sticky-col-idx tabular-nums" style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)', textAlign: 'center', fontSize: 10.5, fontWeight: 600 }}>
                      {rIdx + 1}
                    </td>
                    <td className="sticky-col-name" style={{ background: o.id === p.operatorId ? 'rgba(3, 105, 161, 0.08)' : 'var(--surface)', padding: '3px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <div style={{ color: 'var(--text)' }}>
                        {o.full_name}
                        {o.id === p.operatorId && (
                          <span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 700, color: 'var(--accent)' }}>(Me)</span>
                        )}
                      </div>
                      {o.position && <div style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--text-secondary)' }}>{o.position}</div>}
                    </td>

                    {p.days.map((d, cIdx) => {
                      const k = cellKey(o.id, d.date);
                      const r = p.cell.get(k);
                      const pending = p.pendingMap.get(k);

                      const effShiftId = pending ? (pending.action === 'delete' ? null : (pending.shift_type_id ?? r?.shift_type_id)) : r?.shift_type_id;
                      const effAreaId = pending ? (pending.action === 'delete' ? null : (pending.area_code_id ?? r?.area_code_id)) : r?.area_code_id;
                      const s = effShiftId ? p.shiftBy.get(effShiftId) : undefined;
                      const a = effAreaId ? p.areaBy.get(effAreaId) : undefined;

                      const liveSb = p.standbyMap.get(k);
                      const sb = pending && pending.standby_type !== undefined
                        ? (pending.standby_type ? { standby_type: pending.standby_type } : undefined)
                        : liveSb;

                      const pm = p.pmByCell.get(k);

                      const isLeave = isLeaveArea(a);
                      const isRest = isRestArea(a);
                      const isHoliday = isHolidayArea(a);
                      const isOffArea = isLeave || isRest || isHoliday;
                      const effShift = isOffArea ? (offShift ?? s) : s;
                      if (sb) ocCount += 1;
                      if (isLeave) leaves += 1;
                      if (isRest || isHoliday || effShift?.is_off) off += 1;
                      else if (effShift && !isLeave) duty += 1;
                      if (effShift && !isOffArea) hrs += Number(effShift.duration_hours ?? 0);

                      const bg = isOffArea
                        ? (offShift?.background_color ?? (s?.is_off ? s.background_color : '#f8fafc'))
                        : (s?.background_color ?? (sb ? 'var(--violet-bg)' : d.isWeekend ? 'var(--surface-muted)' : 'var(--surface)'));
                      const fg = isOffArea
                        ? (a?.text_color ?? offShift?.text_color ?? 'var(--text)')
                        : (a && (s?.is_off || !s) ? a.text_color : s?.text_color ?? (sb ? 'var(--violet-fg)' : 'var(--text-muted)'));
                      const cellText =
                        !isOffArea && effShift && !effShift.is_off
                          ? `${effShift.code}·${a?.code ?? DEFAULT_STATION_CODE}`
                          : a?.code ?? effShift?.code ?? '';
                      const classes = [
                        isOffArea ? 'cell-leave' : '',
                        sb ? 'cell-oncall-active' : '',
                        pending ? 'cell-pending' : '',
                      ].filter(Boolean).join(' ');
                      const isFocused = focused.r === rIdx && focused.c === cIdx;

                      return (
                        <td
                          key={d.date}
                          data-rc={`${rIdx}-${cIdx}`}
                          tabIndex={isFocused ? 0 : -1}
                          role="gridcell"
                          aria-label={`${o.full_name}, ${d.date}, ${effShift ? effShift.code : 'No shift'}, ${cellText || 'none'}${sb ? `, Standby ${sb.standby_type}` : ''}${pending ? ' (Pending proposal)' : ''}`}
                          className={classes || undefined}
                          onFocus={() => setFocused({ r: rIdx, c: cIdx })}
                          onKeyDown={(e) => handleCellKeyDown(e, rIdx, cIdx, o, d.date)}
                          onPointerDown={(e) => {
                            if (!p.canOperate || e.button !== 0) return;
                            setFocused({ r: rIdx, c: cIdx });
                            if (p.mode === 'standby') {
                              p.onActivateCell(o.id, d.date);
                              return;
                            }
                            p.dragRef.current = { active: true, visited: new Set(), entries: [], upserts: [], deletes: [] };
                            p.onApplyBrushLocal(o.id, d.date);
                          }}
                          onPointerEnter={() => {
                            if (p.dragRef.current?.active && p.canOperate && p.mode !== 'standby') {
                              p.onApplyBrushLocal(o.id, d.date);
                            }
                          }}
                          onTouchStart={(e) => {
                            if (!p.canOperate) return;
                            const touch = e.touches[0];
                            longPressRef.current = setTimeout(() => {
                              p.onOpenContextMenu({ x: touch.clientX, y: touch.clientY, opId: o.id, opName: o.full_name, date: d.date });
                            }, 500);
                          }}
                          onTouchEnd={() => {
                            if (longPressRef.current) clearTimeout(longPressRef.current);
                          }}
                          onTouchMove={() => {
                            if (longPressRef.current) clearTimeout(longPressRef.current);
                          }}
                          onContextMenu={(e) => {
                            if (!p.canOperate) return;
                            e.preventDefault();
                            p.onOpenContextMenu({ x: e.clientX, y: e.clientY, opId: o.id, opName: o.full_name, date: d.date });
                          }}
                          title={[
                            `${o.full_name} • ${d.date}`,
                            pending ? `[Proposed: ${pending.isDraft ? 'Draft' : 'Pending Review'}]` : null,
                            effShift ? `${effShift.code}${effShift.description ? ` (${effShift.description})` : ''}` : null,
                            cellText ? `Area: ${a?.name ?? cellText}` : null,
                            sb ? `Standby: ${sb.standby_type}` : null,
                            pm ? `PM: ${pm.titles.join(', ')}` : null,
                          ]
                            .filter(Boolean)
                            .join('\n')}
                          style={{
                            position: 'relative',
                            textAlign: 'center',
                            cursor: p.canOperate ? 'pointer' : 'default',
                            height: 28,
                            padding: '0 4px',
                            whiteSpace: 'nowrap',
                            fontSize: 10.5,
                            background: bg,
                            color: fg,
                            fontWeight: 800,
                            outline: d.date === p.today ? '1.5px solid var(--accent)' : undefined,
                            outlineOffset: -1.5,
                          }}
                        >
                          {pending && <span className="pending-corner-mark" title="Pending proposed change" />}
                          {cellText}
                          {sb && (
                            <>
                              <span className="oncall-corner-triangle" />
                              <span className="oncall-icon-mark">{sb.standby_type === 'OC' ? 'OC' : sb.standby_type[0]}</span>
                            </>
                          )}
                          {pm && <span className={`pm-mark${pm.warn ? ' warn' : ''}`} />}
                        </td>
                      );
                    })}

                    <td className="sticky-col-duty tabular-nums" style={{ background: 'var(--surface)', color: 'var(--text)', textAlign: 'center', fontWeight: 700 }}>
                      {duty}
                    </td>
                    <td
                      className="sticky-col-oc tabular-nums"
                      style={{
                        background: 'var(--surface)',
                        boxShadow: ocCount ? 'inset 0 0 0 999px rgba(124, 58, 237, 0.14)' : undefined,
                        color: ocCount ? 'var(--violet)' : 'var(--text-muted)',
                        textAlign: 'center',
                        fontWeight: 700,
                      }}
                    >
                      {ocCount}
                    </td>
                    <td className="sticky-col-hours tabular-nums" style={{ background: 'var(--surface)', color: 'var(--text)', textAlign: 'center', fontWeight: 600 }}>
                      {hrs}
                    </td>
                    <td className="sticky-col-off tabular-nums" style={{ background: 'var(--surface)', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      {off}
                    </td>
                    <td
                      className="sticky-col-leaves tabular-nums"
                      style={{
                        background: 'var(--surface)',
                        boxShadow: leaves ? 'inset 0 0 0 999px rgba(234, 179, 8, 0.16)' : undefined,
                        color: leaves ? 'var(--warn-fg)' : 'var(--text-muted)',
                        textAlign: 'center',
                        fontWeight: 700,
                      }}
                    >
                      {leaves}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {p.operators.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2} className="sticky-col-idx" style={{ position: 'sticky', bottom: 0, zIndex: 30, background: 'var(--surface-muted)', color: 'var(--text)', padding: '5px 8px', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  On Duty Count
                </td>
                {p.dailyWorkingCounts.map((cnt, idx) => (
                  <td
                    key={p.days[idx].date}
                    className="tabular-nums"
                    style={{
                      position: 'sticky',
                      bottom: 0,
                      zIndex: 20,
                      background: 'var(--surface-muted)',
                      textAlign: 'center',
                      fontWeight: 700,
                      color: cnt === 0 ? 'var(--text-muted)' : 'var(--text)',
                      borderTop: '2px solid var(--border)',
                      padding: '5px 2px',
                    }}
                  >
                    {cnt}
                  </td>
                ))}
                <td colSpan={5} style={{ position: 'sticky', bottom: 0, zIndex: 20, background: 'var(--surface-muted)', borderTop: '2px solid var(--border)' }} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Legend Strip */}
      <div className="no-print" style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--violet-bg)', boxShadow: 'inset 0 0 0 2px var(--violet)', display: 'inline-block' }} />
          Violet ring + corner = Standby (OC/DWP/ERP)
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span className="cell-leave" style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: 'var(--warn-bg)', border: '1px solid var(--border)', display: 'inline-block' }} />
          Diagonal stripe = Leave / Rest / Holiday
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--teal)', display: 'inline-block' }} />
          Teal / Rose dot = PM scheduled / overdue
        </span>
        <span>
          <b>PL</b> Plant Ops · <b>FD</b> Field Ops · <b>WD</b> Water Delivery · <b>OC</b> On-Call · <b>DWP</b> Deep Well · <b>ERP</b> Electro-Mech · <b>Lvs</b> Leaves
        </span>
        {p.canEdit && <span>Tip: drag across cells to paint, arrow keys + Enter for keyboard, right-click or long-press for menu.</span>}
      </div>
    </>
  );
}
