'use client';

import { useMemo, useState } from 'react';
import {
  PM_CUSTOM_UNIT_MAX,
  PM_DAY_INTERVAL_PRESETS,
  PM_MAX_OCCURRENCES,
  PM_ORDINALS_SHORT,
  PM_WEEKDAYS,
  PM_WEEKDAY_INITIALS,
  computeQuickEndDate,
  formatPmRecurrenceLabel,
  formatPmShortChipDate,
  generatePmRepeatDates,
  getIsoDateUtcDow,
  getPmRepeatOptions,
  pmAnalyzeDate,
  type PmCustomMonthMode,
  type PmCustomUnit,
  type PmRecurrenceConfig,
  type PmRepeatPreset,
  type PmSundayRule,
} from '@/lib/pm-recurrence';

interface PmRepeatBuilderProps {
  startDate: string;
  recurrence: PmRecurrenceConfig;
  onChange: (next: PmRecurrenceConfig) => void;
  holidayByDate: Map<string, { holiday_date: string; name: string; holiday_type: string }>;
}

const PREVIEW_COLLAPSE_LIMIT = 6;

const chipBase: React.CSSProperties = {
  padding: '3px 8px',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-secondary)',
};

export default function PmRepeatBuilder({
  startDate,
  recurrence,
  onChange,
  holidayByDate,
}: PmRepeatBuilderProps) {
  const [showAllDates, setShowAllDates] = useState(false);

  const info = useMemo(() => pmAnalyzeDate(startDate), [startDate]);
  const presetOptions = useMemo(() => getPmRepeatOptions(startDate), [startDate]);
  const dates = useMemo(() => generatePmRepeatDates(startDate, recurrence), [recurrence, startDate]);
  const ruleLabel = useMemo(() => formatPmRecurrenceLabel(startDate, recurrence), [recurrence, startDate]);

  const isRepeating = recurrence.mode !== 'none';
  const startYear = info?.year;
  const shownDates = showAllDates ? dates : dates.slice(0, PREVIEW_COLLAPSE_LIMIT);
  const extraCount = dates.length - shownDates.length;

  const patch = (updates: Partial<PmRecurrenceConfig>) => onChange({ ...recurrence, ...updates });

  const toggleWeekDay = (dow: number) => {
    const exists = recurrence.customWeekDays.includes(dow);
    if (exists && recurrence.customWeekDays.length === 1) return;
    const nextDays = exists
      ? recurrence.customWeekDays.filter((d) => d !== dow)
      : [...recurrence.customWeekDays, dow].sort((a, b) => a - b);
    patch({ customWeekDays: nextDays });
  };

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 10,
        background: 'var(--surface-muted)',
        display: 'grid',
        gap: 10,
      }}
    >
      {/* Top Row: Repeat Preset + Ends Mode */}
      <div style={{ display: 'grid', gridTemplateColumns: isRepeating ? 'repeat(auto-fit, minmax(210px, 1fr))' : '1fr', gap: 10 }}>
        <label style={{ fontSize: 12.5, display: 'grid', gap: 4, alignContent: 'start' }}>
          <span style={{ fontWeight: 700, color: 'var(--text)' }}>Repeat</span>
          <select
            className="input"
            value={recurrence.mode}
            onChange={(e) => {
              const nextMode = e.target.value as PmRepeatPreset;
              const ensureWeekDays =
                nextMode === 'custom' && recurrence.customWeekDays.length === 0 && info
                  ? [info.dow]
                  : recurrence.customWeekDays;
              patch({ mode: nextMode, customWeekDays: ensureWeekDays });
            }}
          >
            {presetOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {isRepeating && (
          <div style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Ends</span>
              <div
                role="group"
                aria-label="Repeat end mode"
                style={{
                  display: 'inline-flex',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                {(['date', 'count'] as const).map((m) => {
                  const active = recurrence.endMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => patch({ endMode: m })}
                      style={{
                        border: 'none',
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        background: active ? 'var(--primary)' : 'var(--surface)',
                        color: active ? 'var(--primary-fg)' : 'var(--text-secondary)',
                      }}
                    >
                      {m === 'date' ? 'On date' : 'After #'}
                    </button>
                  );
                })}
              </div>
            </div>

            {recurrence.endMode === 'date' ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <input
                  type="date"
                  aria-label="Repeat until date"
                  className="input"
                  value={recurrence.until}
                  min={startDate}
                  onChange={(e) => patch({ until: e.target.value })}
                />
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(
                    [
                      ['3m', '+3 mo'],
                      ['6m', '+6 mo'],
                      ['eoy', 'Year-end'],
                      ['1y', '+1 yr'],
                    ] as const
                  ).map(([presetKey, label]) => {
                    const targetDate = computeQuickEndDate(startDate, presetKey);
                    const active = recurrence.until === targetDate;
                    return (
                      <button
                        key={presetKey}
                        type="button"
                        onClick={() => patch({ until: targetDate })}
                        style={{
                          ...chipBase,
                          background: active ? 'var(--primary)' : 'var(--surface)',
                          color: active ? 'var(--primary-fg)' : 'var(--text-secondary)',
                          borderColor: active ? 'var(--primary)' : 'var(--border)',
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  aria-label="Number of occurrences"
                  min={2}
                  max={PM_MAX_OCCURRENCES}
                  className="input"
                  style={{ width: 92, fontWeight: 700, textAlign: 'center' }}
                  value={recurrence.count}
                  onChange={(e) => patch({ count: Math.min(PM_MAX_OCCURRENCES, Math.max(2, Number(e.target.value) || 2)) })}
                />
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 600 }}>occurrences</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Custom Recurrence Builder */}
      {recurrence.mode === 'custom' && (
        <div
          style={{
            border: '1px solid var(--border-light)',
            borderRadius: 6,
            padding: 10,
            background: 'var(--surface)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Repeat every</span>
            <input
              type="number"
              aria-label="Custom repeat interval"
              min={1}
              max={PM_CUSTOM_UNIT_MAX[recurrence.customUnit]}
              className="input"
              style={{ width: 76, fontWeight: 700, textAlign: 'center' }}
              value={recurrence.customInterval}
              onChange={(e) => {
                const max = PM_CUSTOM_UNIT_MAX[recurrence.customUnit];
                patch({ customInterval: Math.min(max, Math.max(1, Number(e.target.value) || 1)) });
              }}
            />
            <select
              aria-label="Custom repeat unit"
              className="input"
              style={{ width: 'auto' }}
              value={recurrence.customUnit}
              onChange={(e) => {
                const nextUnit = e.target.value as PmCustomUnit;
                const max = PM_CUSTOM_UNIT_MAX[nextUnit];
                const nextInterval = Math.min(max, Math.max(1, recurrence.customInterval));
                const nextWeekDays =
                  nextUnit === 'week' && recurrence.customWeekDays.length === 0 && info
                    ? [info.dow]
                    : recurrence.customWeekDays;
                patch({ customUnit: nextUnit, customInterval: nextInterval, customWeekDays: nextWeekDays });
              }}
            >
              <option value="day">day(s)</option>
              <option value="week">week(s)</option>
              <option value="month">month(s)</option>
              <option value="year">year(s)</option>
            </select>
          </div>

          {recurrence.customUnit === 'day' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600 }}>Quick intervals:</span>
              {PM_DAY_INTERVAL_PRESETS.map((days) => {
                const active = recurrence.customInterval === days;
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => patch({ customInterval: days })}
                    style={{
                      ...chipBase,
                      background: active ? 'var(--primary)' : 'var(--surface-muted)',
                      color: active ? 'var(--primary-fg)' : 'var(--text-secondary)',
                      borderColor: active ? 'var(--primary)' : 'var(--border)',
                    }}
                  >
                    Every {days} days
                  </button>
                );
              })}
            </div>
          )}

          {recurrence.customUnit === 'week' && (
            <div style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>Repeat on:</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {PM_WEEKDAY_INITIALS.map((initial, dow) => {
                  const active = recurrence.customWeekDays.includes(dow);
                  return (
                    <button
                      key={dow}
                      type="button"
                      aria-label={PM_WEEKDAYS[dow]}
                      aria-pressed={active}
                      title={PM_WEEKDAYS[dow]}
                      onClick={() => toggleWeekDay(dow)}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
                        background: active ? 'var(--primary)' : 'var(--surface)',
                        color: active ? 'var(--primary-fg)' : 'var(--text-secondary)',
                        fontSize: 11.5,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {initial}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {recurrence.customUnit === 'month' && (
            <div style={{ display: 'grid', gap: 6 }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
                Monthly pattern:
                <select
                  className="input"
                  value={recurrence.customMonthMode}
                  onChange={(e) => patch({ customMonthMode: e.target.value as PmCustomMonthMode })}
                >
                  <option value="nth">On a specific weekday (e.g. 2nd Friday)</option>
                  <option value="last">On the last weekday of the month</option>
                  <option value="date">On day {info?.dayOfMonth ?? 1} of the month</option>
                  <option value="lastday">On the last day of the month</option>
                </select>
              </label>

              {(recurrence.customMonthMode === 'nth' || recurrence.customMonthMode === 'last') && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {recurrence.customMonthMode === 'nth' && (
                    <select
                      aria-label="Weekday ordinal in month"
                      className="input"
                      style={{ width: 'auto' }}
                      value={recurrence.customMonthNth}
                      onChange={(e) => patch({ customMonthNth: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })}
                    >
                      {PM_ORDINALS_SHORT.map((lbl, idx) => (
                        <option key={lbl} value={idx + 1}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    aria-label="Weekday in month"
                    className="input"
                    style={{ width: 'auto' }}
                    value={recurrence.customMonthDow}
                    onChange={(e) => patch({ customMonthDow: Number(e.target.value) })}
                  >
                    {PM_WEEKDAYS.map((name, dow) => (
                      <option key={name} value={dow}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sunday Handling Rule */}
      {isRepeating && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            paddingTop: 6,
            borderTop: '1px solid var(--border-light)',
          }}
        >
          <label htmlFor="pm-sunday-rule" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
            If a date falls on Sunday:
          </label>
          <select
            id="pm-sunday-rule"
            className="input"
            style={{ width: 'auto', fontSize: 12 }}
            value={recurrence.sundayRule}
            onChange={(e) => patch({ sundayRule: e.target.value as PmSundayRule })}
          >
            <option value="keep">Keep exact date</option>
            <option value="next_mon">Shift to Monday</option>
            <option value="skip">Skip Sunday</option>
          </select>
        </div>
      )}

      {/* Live Preview Summary & Chips */}
      {!isRepeating ? (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          Single task. Choose a repeat rule above (options adapt to your start date), or select <b>Custom…</b> for intervals like every 60 days or every 2nd Friday.
        </div>
      ) : dates.length === 0 ? (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)' }}>
          No valid dates generated — ensure the end date is on or after the start date (or adjust the Sunday skip rule).
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)' }}>
              {ruleLabel} → {dates.length} {dates.length === 1 ? 'task' : 'tasks'}
              {recurrence.endMode === 'count' ? ` • ends ${formatPmShortChipDate(dates[dates.length - 1], startYear)}` : ''}
            </span>
            {dates.length > PREVIEW_COLLAPSE_LIMIT && (
              <button
                type="button"
                onClick={() => setShowAllDates((s) => !s)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: 'var(--primary)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                {showAllDates ? 'Collapse dates' : `Show all ${dates.length} dates`}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 110, overflowY: 'auto' }}>
            {shownDates.map((dStr) => {
              const isSun = getIsoDateUtcDow(dStr) === 0;
              const holiday = holidayByDate.get(dStr);
              const flagged = isSun || Boolean(holiday);
              const titleParts = [dStr];
              if (holiday) titleParts.push(`★ ${holiday.name}`);
              return (
                <span
                  key={dStr}
                  title={titleParts.join(' — ')}
                  style={{
                    padding: '2px 7px',
                    borderRadius: 5,
                    fontSize: 11,
                    fontWeight: 600,
                    border: flagged ? '1px solid var(--warn-border)' : '1px solid var(--border)',
                    background: flagged ? 'var(--warn-bg)' : 'var(--surface)',
                    color: flagged ? 'var(--warn-fg)' : 'var(--text)',
                  }}
                >
                  {formatPmShortChipDate(dStr, startYear)}
                  {isSun ? ' (Sun)' : ''}
                  {holiday ? ' ★' : ''}
                </span>
              );
            })}
            {extraCount > 0 && (
              <span style={{ padding: '2px 6px', fontSize: 11, fontWeight: 700, color: 'var(--teal)' }}>
                +{extraCount} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
