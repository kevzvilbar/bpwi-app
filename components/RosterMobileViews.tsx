'use client';

import { useMemo, useRef, useState } from 'react';
import { DEFAULT_STATION_CODE, findOffShift, isOffPartnerArea } from '@/lib/roster-helpers';

type Op = { id: string; full_name: string; position: string | null };
type Shift = {
  id: string;
  code: string;
  description: string | null;
  duration_hours: number;
  background_color: string;
  text_color: string;
  is_off: boolean;
};
type Area = {
  id: string;
  code: string;
  name: string | null;
  category: string;
  background_color: string;
  text_color: string;
};
type Row = {
  operator_id: string;
  schedule_date: string;
  shift_type_id: string | null;
  area_code_id: string | null;
};
type Standby = {
  operator_id: string;
  schedule_date: string;
  standby_type: string;
};
type DayInfo = { date: string; dayNum: number; dow: number; dowLabel: string; isWeekend: boolean };

export type MobileViewMode = 'day' | 'week' | 'month' | 'timeline';

function cellKey(opId: string, date: string) {
  return `${opId}:${date}`;
}

export default function RosterMobileViews(p: {
  month: string;
  today: string;
  days: DayInfo[];
  operators: Op[];
  operatorId?: string | null;
  cell: Map<string, Row>;
  standbyMap: Map<string, Standby>;
  shiftBy: Map<string, Shift>;
  areaBy: Map<string, Area>;
  canEdit: boolean;
  onCellTap: (opId: string, date: string) => void;
  onCellMenu: (op: Op, date: string, e?: { clientX: number; clientY: number }) => void;
}) {
  const [view, setView] = useState<MobileViewMode>('day');
  const [selectedDate, setSelectedDate] = useState(() =>
    p.today.startsWith(p.month) ? p.today : `${p.month}-01`,
  );
  const [selectedOpId, setSelectedOpId] = useState(() =>
    p.operatorId && p.operators.some((o) => o.id === p.operatorId)
      ? p.operatorId
      : p.operators[0]?.id ?? '',
  );
  const swipeStartX = useRef<number | null>(null);

  const selectedDayIdx = Math.max(
    0,
    p.days.findIndex((d) => d.date === selectedDate),
  );

  // Week slice around selectedDate (7 days)
  const weekDays = useMemo(() => {
    const cur = p.days[selectedDayIdx];
    if (!cur) return p.days.slice(0, 7);
    const startIdx = Math.max(0, selectedDayIdx - cur.dow);
    return p.days.slice(startIdx, startIdx + 7);
  }, [p.days, selectedDayIdx]);

  function stepDay(delta: number) {
    const nextIdx = Math.min(p.days.length - 1, Math.max(0, selectedDayIdx + delta));
    if (p.days[nextIdx]) setSelectedDate(p.days[nextIdx].date);
  }

  function stepWeek(delta: number) {
    stepDay(delta * 7);
  }

  // Monthly calendar leading blanks
  const leadingBlanks = p.days[0]?.dow ?? 0;
  const activeOpId = p.operators.some((o) => o.id === selectedOpId) ? selectedOpId : p.operators[0]?.id ?? '';
  const offShift = useMemo(() => findOffShift(Array.from(p.shiftBy.values())), [p.shiftBy]);

  function resolveMobileCellVisual(s: Shift | undefined, a: Area | undefined) {
    if (isOffPartnerArea(a)) {
      const effShift = offShift ?? s;
      return {
        effShift,
        isOffArea: true,
        bg: offShift?.background_color ?? (s?.is_off ? s.background_color : '#f8fafc'),
        fg: a?.text_color ?? offShift?.text_color ?? s?.text_color ?? 'var(--text-secondary)',
      };
    }
    return {
      effShift: s,
      isOffArea: false,
      bg: s?.background_color ?? 'var(--surface-muted)',
      fg: s?.text_color ?? 'var(--text-secondary)',
    };
  }

  return (
    <div className="mobile-only-schedule no-print">
      {/* Mobile View Mode Tabs */}
      <div
        role="tablist"
        aria-label="Schedule view mode"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 4,
          padding: 4,
          background: 'var(--border-light)',
          borderRadius: 10,
        }}
      >
        {(
          [
            ['day', 'Day'],
            ['week', 'Week'],
            ['month', 'Month'],
            ['timeline', 'Timeline'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            style={{
              minHeight: 44,
              borderRadius: 8,
              border: 'none',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              background: view === id ? 'var(--surface)' : 'transparent',
              color: view === id ? 'var(--text)' : 'var(--text-secondary)',
              boxShadow: view === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 1. DAY VIEW (Default on mobile) */}
      {view === 'day' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div className="card" style={{ padding: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn" onClick={() => stepDay(-1)} aria-label="Previous day">
              ‹
            </button>
            <select
              className="input"
              aria-label="Select day"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ flex: 1 }}
            >
              {p.days.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.date} ({d.dowLabel}){d.date === p.today ? ' · Today' : ''}
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => stepDay(1)} aria-label="Next day">
              ›
            </button>
          </div>

          {p.operators.map((op) => {
            const k = cellKey(op.id, selectedDate);
            const r = p.cell.get(k);
            const s = r?.shift_type_id ? p.shiftBy.get(r.shift_type_id) : undefined;
            const a = r?.area_code_id ? p.areaBy.get(r.area_code_id) : undefined;
            const sb = p.standbyMap.get(k);
            const { effShift, isOffArea, bg, fg } = resolveMobileCellVisual(s, a);
            const areaLabel = a?.code ?? (effShift && !effShift.is_off ? DEFAULT_STATION_CODE : '');

            return (
              <div
                key={op.id}
                className="card"
                style={{
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  borderLeft: sb ? '4px solid var(--violet)' : undefined,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {op.full_name}
                    {op.id === p.operatorId && (
                      <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>(Me)</span>
                    )}
                  </div>
                  {op.position && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{op.position}</div>}
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  {sb && (
                    <span
                      style={{
                        background: 'var(--violet)',
                        color: '#fff',
                        padding: '3px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {sb.standby_type}
                    </span>
                  )}
                  <button
                    className={`btn${isOffArea ? ' cell-leave' : ''}`}
                    onClick={() => p.onCellTap(op.id, selectedDate)}
                    style={{
                      minWidth: 74,
                      background: bg,
                      color: fg,
                      fontWeight: 800,
                    }}
                  >
                    {effShift ? `${effShift.code}${areaLabel ? ` · ${areaLabel}` : ''}` : areaLabel || 'Assign'}
                  </button>
                  {p.canEdit && (
                    <button
                      className="btn"
                      aria-label={`More actions for ${op.full_name}`}
                      onClick={(e) => p.onCellMenu(op, selectedDate, { clientX: e.clientX, clientY: e.clientY })}
                    >
                      ⋯
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 2. WEEK VIEW (Horizontally swipeable) */}
      {view === 'week' && (
        <div
          style={{ display: 'grid', gap: 8 }}
          onTouchStart={(e) => {
            swipeStartX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (swipeStartX.current === null) return;
            const dx = e.changedTouches[0].clientX - swipeStartX.current;
            swipeStartX.current = null;
            if (dx > 55) stepWeek(-1);
            else if (dx < -55) stepWeek(1);
          }}
        >
          <div className="card" style={{ padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
            <button className="btn" onClick={() => stepWeek(-1)}>
              ‹ Prev Week
            </button>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>
              {weekDays[0]?.date.slice(5)} – {weekDays[weekDays.length - 1]?.date.slice(5)}
            </span>
            <button className="btn" onClick={() => stepWeek(1)}>
              Next Week ›
            </button>
          </div>

          {p.operators.map((op) => (
            <div key={op.id} className="card" style={{ padding: 10, display: 'grid', gap: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{op.full_name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${weekDays.length}, 1fr)`, gap: 4 }}>
                {weekDays.map((d) => {
                  const k = cellKey(op.id, d.date);
                  const r = p.cell.get(k);
                  const s = r?.shift_type_id ? p.shiftBy.get(r.shift_type_id) : undefined;
                  const a = r?.area_code_id ? p.areaBy.get(r.area_code_id) : undefined;
                  const sb = p.standbyMap.get(k);
                  const { effShift, isOffArea, bg, fg } = resolveMobileCellVisual(s, a);
                  return (
                    <button
                      key={d.date}
                      onClick={() => p.onCellTap(op.id, d.date)}
                      className={isOffArea ? 'cell-leave' : undefined}
                      style={{
                        minHeight: 46,
                        borderRadius: 6,
                        border: sb ? '2px solid var(--violet)' : '1px solid var(--border)',
                        background: bg,
                        color: fg,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: 2,
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontSize: 9.5, opacity: 0.8 }}>{d.dowLabel} {d.dayNum}</span>
                      <span>{a?.code ?? (effShift && !effShift.is_off ? DEFAULT_STATION_CODE : effShift?.code ?? '—')}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3. MONTHLY CALENDAR VIEW */}
      {view === 'month' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div
            className="card"
            style={{
              padding: 8,
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 4,
            }}
          >
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', padding: 4 }}>
                {w}
              </div>
            ))}
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`b${i}`} />
            ))}
            {p.days.map((d) => {
              const isSel = d.date === selectedDate;
              let dutyCnt = 0;
              let sbCnt = 0;
              for (const op of p.operators) {
                const k = cellKey(op.id, d.date);
                const r = p.cell.get(k);
                const s = r?.shift_type_id ? p.shiftBy.get(r.shift_type_id) : undefined;
                const a = r?.area_code_id ? p.areaBy.get(r.area_code_id) : undefined;
                if (s && !s.is_off && !isOffPartnerArea(a)) dutyCnt += 1;
                if (p.standbyMap.has(k)) sbCnt += 1;
              }
              return (
                <button
                  key={d.date}
                  onClick={() => setSelectedDate(d.date)}
                  style={{
                    minHeight: 46,
                    borderRadius: 8,
                    border: isSel ? '2px solid var(--accent)' : '1px solid var(--border-light)',
                    background: d.date === p.today ? 'var(--info-bg)' : 'var(--surface)',
                    color: 'var(--text)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{d.dayNum}</span>
                  <span style={{ fontSize: 9.5, color: 'var(--text-secondary)' }}>
                    {dutyCnt}d{sbCnt ? `·${sbCnt}⚡` : ''}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ fontWeight: 700, fontSize: 13.5 }}>Assignments for {selectedDate}</div>
          {p.operators.map((op) => {
            const k = cellKey(op.id, selectedDate);
            const r = p.cell.get(k);
            const s = r?.shift_type_id ? p.shiftBy.get(r.shift_type_id) : undefined;
            const a = r?.area_code_id ? p.areaBy.get(r.area_code_id) : undefined;
            const sb = p.standbyMap.get(k);
            const { effShift, isOffArea, bg, fg } = resolveMobileCellVisual(s, a);
            return (
              <div
                key={op.id}
                className="card"
                onClick={() => p.onCellTap(op.id, selectedDate)}
                style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              >
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{op.full_name}</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {sb && (
                    <span style={{ background: 'var(--violet)', color: '#fff', padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                      {sb.standby_type}
                    </span>
                  )}
                  <span
                    className={isOffArea ? 'cell-leave' : undefined}
                    style={{
                      background: bg,
                      color: fg,
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '3px 8px',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {effShift ? `${effShift.code} · ${a?.code ?? (effShift.is_off ? 'OFF' : DEFAULT_STATION_CODE)}` : a?.code ?? '—'}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. OPERATOR TIMELINE VIEW */}
      {view === 'timeline' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <select
            className="input"
            aria-label="Select operator for timeline"
            value={activeOpId}
            onChange={(e) => setSelectedOpId(e.target.value)}
          >
            {p.operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.full_name}
                {o.id === p.operatorId ? ' (Me)' : ''}
              </option>
            ))}
          </select>

          {activeOpId && (
            <div style={{ display: 'grid', gap: 6 }}>
              {p.days.map((d) => {
                const k = cellKey(activeOpId, d.date);
                const r = p.cell.get(k);
                const s = r?.shift_type_id ? p.shiftBy.get(r.shift_type_id) : undefined;
                const a = r?.area_code_id ? p.areaBy.get(r.area_code_id) : undefined;
                const sb = p.standbyMap.get(k);
                const op = p.operators.find((o) => o.id === activeOpId)!;
                const { effShift, isOffArea, bg, fg } = resolveMobileCellVisual(s, a);

                return (
                  <div
                    key={d.date}
                    className="card"
                    style={{
                      padding: '8px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderLeft: d.date === p.today ? '4px solid var(--accent)' : '4px solid var(--border)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>
                        {d.dowLabel}, {d.date}
                      </div>
                      {effShift?.description && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{effShift.description}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {sb && (
                        <span style={{ background: 'var(--violet)', color: '#fff', padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                          {sb.standby_type}
                        </span>
                      )}
                      <button
                        className={`btn${isOffArea ? ' cell-leave' : ''}`}
                        onClick={() => p.onCellTap(activeOpId, d.date)}
                        style={{
                          background: bg,
                          color: fg,
                          fontWeight: 700,
                        }}
                      >
                        {effShift ? `${effShift.code} · ${a?.code ?? (effShift.is_off ? 'OFF' : DEFAULT_STATION_CODE)}` : a?.code ?? 'Assign'}
                      </button>
                      {p.canEdit && op && (
                        <button className="btn" onClick={(e) => p.onCellMenu(op, d.date, { clientX: e.clientX, clientY: e.clientY })}>
                          ⋯
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
