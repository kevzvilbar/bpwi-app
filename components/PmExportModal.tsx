'use client';

import { useMemo, useState } from 'react';

type TimeframePreset = 'month' | 'year' | 'q1' | 'q2' | 'q3' | 'q4' | 'h1' | 'h2' | 'custom';

interface Props {
  currentMonth: string; // YYYY-MM
  typeFilter: string;
  statusFilter: string;
  areaFilter: string;
  onClose: () => void;
}

function lastDayOfMonth(year: number, month1To12: number): string {
  const d = new Date(Date.UTC(year, month1To12, 0));
  return d.toISOString().slice(0, 10);
}

export default function PmExportModal({ currentMonth, typeFilter, statusFilter, areaFilter, onClose }: Props) {
  const viewedYear = Number(currentMonth.slice(0, 4)) || new Date().getFullYear();
  const [preset, setPreset] = useState<TimeframePreset>('year');
  const [year, setYear] = useState<number>(viewedYear);
  const [customFrom, setCustomFrom] = useState<string>(`${viewedYear}-01-01`);
  const [customTo, setCustomTo] = useState<string>(`${viewedYear}-12-31`);
  const [applyFilters, setApplyFilters] = useState<boolean>(true);

  const hasActiveFilters = Boolean(typeFilter || statusFilter || areaFilter);

  const resolved = useMemo(() => {
    switch (preset) {
      case 'month': {
        const y = Number(currentMonth.slice(0, 4));
        const m = Number(currentMonth.slice(5, 7));
        return { from: `${currentMonth}-01`, to: lastDayOfMonth(y, m), label: currentMonth };
      }
      case 'year':
        return { from: `${year}-01-01`, to: `${year}-12-31`, label: `${year}` };
      case 'q1':
        return { from: `${year}-01-01`, to: `${year}-03-31`, label: `${year}-Q1` };
      case 'q2':
        return { from: `${year}-04-01`, to: `${year}-06-30`, label: `${year}-Q2` };
      case 'q3':
        return { from: `${year}-07-01`, to: `${year}-09-30`, label: `${year}-Q3` };
      case 'q4':
        return { from: `${year}-10-01`, to: `${year}-12-31`, label: `${year}-Q4` };
      case 'h1':
        return { from: `${year}-01-01`, to: `${year}-06-30`, label: `${year}-H1` };
      case 'h2':
        return { from: `${year}-07-01`, to: `${year}-12-31`, label: `${year}-H2` };
      case 'custom':
        return { from: customFrom, to: customTo, label: `${customFrom}_to_${customTo}` };
    }
  }, [preset, year, currentMonth, customFrom, customTo]);

  const invalidRange = !resolved.from || !resolved.to || resolved.to < resolved.from;

  const yearOptions = Array.from({ length: 6 }, (_, i) => viewedYear - 1 + i);

  function handleDownload() {
    if (invalidRange) return;
    const params = new URLSearchParams({
      from: resolved.from,
      to: resolved.to,
      label: resolved.label,
    });
    if (applyFilters && typeFilter) params.set('type', typeFilter);
    if (applyFilters && statusFilter) params.set('status', statusFilter);
    if (applyFilters && areaFilter) params.set('area', areaFilter);
    window.location.href = `/api/pm/export?${params.toString()}`;
    onClose();
  }

  return (
    <div className="modal-overlay no-print" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="card"
        style={{ maxWidth: 460, width: '95vw', padding: 16, display: 'grid', gap: 12 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <strong style={{ fontSize: 15 }}>Export PM Schedule (CSV)</strong>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Choose the timeframe to include in your CSV export.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8 }}>
          <label style={{ fontSize: 12 }}>
            Timeframe
            <select
              className="input"
              value={preset}
              onChange={(e) => setPreset(e.target.value as TimeframePreset)}
            >
              <option value="month">Current Viewed Month ({currentMonth})</option>
              <option value="year">Full Year (Jan – Dec)</option>
              <option value="q1">Q1 (Jan – Mar)</option>
              <option value="q2">Q2 (Apr – Jun)</option>
              <option value="q3">Q3 (Jul – Sep)</option>
              <option value="q4">Q4 (Oct – Dec)</option>
              <option value="h1">1st Half / H1 (Jan – Jun)</option>
              <option value="h2">2nd Half / H2 (Jul – Dec)</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </label>

          {preset !== 'month' && preset !== 'custom' && (
            <label style={{ fontSize: 12 }}>
              Year
              <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {preset === 'custom' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ fontSize: 12 }}>
              From Date
              <input type="date" className="input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <label style={{ fontSize: 12 }}>
              To Date
              <input type="date" className="input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
          </div>
        )}

        <div
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            background: 'var(--surface-muted)',
            fontSize: 12,
            color: invalidRange ? '#b91c1c' : 'var(--text-secondary)',
          }}
        >
          {invalidRange ? (
            'End date must be on or after start date.'
          ) : (
            <>
              Export range: <strong>{resolved.from}</strong> to <strong>{resolved.to}</strong>
              <br />
              File: <code>bpwi-pm-schedule-{resolved.label}.csv</code>
            </>
          )}
        </div>

        {hasActiveFilters && (
          <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={applyFilters}
              onChange={(e) => setApplyFilters(e.target.checked)}
            />
            Apply current filters ({[typeFilter, statusFilter, areaFilter].filter(Boolean).join(', ')})
          </label>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 2 }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={invalidRange} onClick={handleDownload}>
            Download CSV
          </button>
        </div>
      </div>
    </div>
  );
}
