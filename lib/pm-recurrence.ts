/**
 * Pure UTC recurrence engine for Preventive Maintenance Schedule (PMS) task series.
 * Restores interactive Google Calendar-style scheduling presets, custom N-day / N-week /
 * N-month / N-year rules (including arbitrary Nth weekday patterns like "2nd Friday"),
 * On-date vs After-# end limits, and Sunday handling rules.
 *
 * TIMEZONE INVARIANT: All helpers use pure UTC date math (`Date.UTC`, `getUTC*`), assuming
 * Manila (UTC+8, fixed offset without DST). Callers MUST pass pure calendar `YYYY-MM-DD`
 * date strings (e.g. from `manilaToday()` or `<input type="date">`), NEVER raw local
 * `Date` objects or un-shifted `new Date().toISOString().slice(0, 10)` timestamps.
 *
 * Uses zero `@/` path aliases so Node's native test runner imports it directly.
 */

export type PmRepeatPreset =
  | 'none'
  | 'daily'
  | 'every2days'
  | 'weekdays'
  | 'mon_sat'
  | 'weekends'
  | 'weekly'
  | 'biweekly'
  | 'every3weeks'
  | 'every4weeks'
  | 'monthly_nth'
  | 'monthly_last'
  | 'monthly_date'
  | 'monthly_lastday'
  | 'bimonthly_nth'
  | 'bimonthly_date'
  | 'quarterly_nth'
  | 'quarterly_last'
  | 'quarterly_date'
  | 'semiannual_nth'
  | 'semiannual_date'
  | 'annually'
  | 'custom';

export type PmRepeatEndMode = 'date' | 'count';
export type PmCustomUnit = 'day' | 'week' | 'month' | 'year';
export type PmCustomMonthMode = 'nth' | 'last' | 'date' | 'lastday';
export type PmSundayRule = 'keep' | 'next_mon' | 'skip';

export interface PmRecurrenceConfig {
  mode: PmRepeatPreset;
  endMode: PmRepeatEndMode;
  until: string;
  count: number;
  customInterval: number;
  customUnit: PmCustomUnit;
  customWeekDays: number[];
  customMonthMode: PmCustomMonthMode;
  customMonthNth: 1 | 2 | 3 | 4 | 5;
  customMonthDow: number;
  sundayRule: PmSundayRule;
}

export interface PmAnalyzedDate {
  year: number;
  monthIdx: number;
  dayOfMonth: number;
  dow: number;
  weekdayName: string;
  monthName: string;
  daysInMonth: number;
  nth: 1 | 2 | 3 | 4 | 5;
  ordinal: string;
  isLast: boolean;
}

export const PM_MAX_OCCURRENCES = 120;

export const PM_CUSTOM_UNIT_MAX: Record<PmCustomUnit, number> = {
  day: 365,
  week: 52,
  month: 24,
  year: 10,
};

export const PM_DAY_INTERVAL_PRESETS = [14, 30, 45, 60, 90] as const;

export const PM_WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const PM_WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const PM_WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
export const PM_ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'] as const;
export const PM_ORDINALS_SHORT = ['1st', '2nd', '3rd', '4th', '5th'] as const;
export const PM_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
export const PM_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function pmDaysInMonth(year: number, monthIdx: number): number {
  return new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
}

export function parseIsoDateParts(dateStr: string): { year: number; monthIdx: number; day: number } | null {
  const m = ISO_DATE_RE.exec(dateStr.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (monthIdx < 0 || monthIdx > 11) return null;
  const dim = pmDaysInMonth(year, monthIdx);
  if (day < 1 || day > dim) return null;
  return { year, monthIdx, day };
}

export function formatIsoDateUtc(year: number, monthIdx: number, day: number): string {
  return new Date(Date.UTC(year, monthIdx, day)).toISOString().slice(0, 10);
}

export function addUtcDays(dateStr: string, days: number): string {
  const parts = parseIsoDateParts(dateStr);
  if (!parts) return dateStr;
  return formatIsoDateUtc(parts.year, parts.monthIdx, parts.day + days);
}

export function addUtcMonths(dateStr: string, months: number): string {
  const parts = parseIsoDateParts(dateStr);
  if (!parts) return dateStr;
  const rawMonth = parts.monthIdx + months;
  const targetYear = parts.year + Math.floor(rawMonth / 12);
  const targetMonth = ((rawMonth % 12) + 12) % 12;
  const clampedDay = Math.min(parts.day, pmDaysInMonth(targetYear, targetMonth));
  return formatIsoDateUtc(targetYear, targetMonth, clampedDay);
}

/**
 * Analyzes an explicit calendar `YYYY-MM-DD` string in UTC.
 * IMPORTANT: Never pass local-timezone timestamps or `new Date().toISOString().slice(0, 10)`
 * from UTC-shifted clocks—use Manila calendar dates (e.g. `manilaToday()` or `<input type="date">`).
 */
export function pmAnalyzeDate(dateStr: string): PmAnalyzedDate | null {
  const parts = parseIsoDateParts(dateStr);
  if (!parts) return null;
  const { year, monthIdx, day } = parts;
  const dow = new Date(Date.UTC(year, monthIdx, day)).getUTCDay();
  const daysInMonth = pmDaysInMonth(year, monthIdx);
  const nth = (Math.floor((day - 1) / 7) + 1) as 1 | 2 | 3 | 4 | 5;
  return {
    year,
    monthIdx,
    dayOfMonth: day,
    dow,
    weekdayName: PM_WEEKDAYS[dow],
    monthName: PM_MONTHS[monthIdx],
    daysInMonth,
    nth,
    ordinal: PM_ORDINALS[nth - 1] ?? `${nth}th`,
    isLast: day + 7 > daysInMonth,
  };
}

export function pmNthWeekdayDate(year: number, monthIdx: number, dow: number, nth: number): string | null {
  const safeDow = ((dow % 7) + 7) % 7;
  const firstDow = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay();
  const day = 1 + ((safeDow - firstDow + 7) % 7) + (nth - 1) * 7;
  const dim = pmDaysInMonth(year, monthIdx);
  if (day < 1 || day > dim) return null;
  return formatIsoDateUtc(year, monthIdx, day);
}

export function pmLastWeekdayDate(year: number, monthIdx: number, dow: number): string {
  const safeDow = ((dow % 7) + 7) % 7;
  const dim = pmDaysInMonth(year, monthIdx);
  const lastDow = new Date(Date.UTC(year, monthIdx, dim)).getUTCDay();
  const day = dim - ((lastDow - safeDow + 7) % 7);
  return formatIsoDateUtc(year, monthIdx, day);
}

export function createInitialRecurrence(startDate: string): PmRecurrenceConfig {
  const info = pmAnalyzeDate(startDate);
  const dow = info?.dow ?? 1;
  const nth = info?.nth ?? 1;
  return {
    mode: 'none',
    endMode: 'date',
    until: info ? addUtcMonths(startDate, 6) : startDate,
    count: 6,
    customInterval: 1,
    customUnit: 'week',
    customWeekDays: [dow],
    customMonthMode: 'nth',
    customMonthNth: nth,
    customMonthDow: dow,
    sundayRule: 'keep',
  };
}

export function syncRecurrenceForStartDate(
  prev: PmRecurrenceConfig,
  prevStartDate: string,
  nextStartDate: string,
): PmRecurrenceConfig {
  const nextInfo = pmAnalyzeDate(nextStartDate);
  if (!nextInfo) return prev;
  const prevInfo = pmAnalyzeDate(prevStartDate);

  let mode = prev.mode;
  if (mode === 'monthly_last' && !nextInfo.isLast) mode = 'monthly_nth';
  if (mode === 'quarterly_last' && !nextInfo.isLast) mode = 'quarterly_nth';

  const matchedDefaultWeekDays =
    prev.customWeekDays.length === 0 ||
    (prevInfo !== null && prev.customWeekDays.length === 1 && prev.customWeekDays[0] === prevInfo.dow);
  const customWeekDays = matchedDefaultWeekDays ? [nextInfo.dow] : prev.customWeekDays;

  const matchedDefaultMonthTarget =
    prevInfo !== null && prev.customMonthNth === prevInfo.nth && prev.customMonthDow === prevInfo.dow;
  const customMonthNth = matchedDefaultMonthTarget ? nextInfo.nth : prev.customMonthNth;
  const customMonthDow = matchedDefaultMonthTarget ? nextInfo.dow : prev.customMonthDow;

  const until = !prev.until || prev.until < nextStartDate ? addUtcMonths(nextStartDate, 6) : prev.until;

  return {
    ...prev,
    mode,
    until,
    customWeekDays,
    customMonthNth,
    customMonthDow,
  };
}

export function computeQuickEndDate(startDate: string, preset: '3m' | '6m' | '1y' | 'eoy'): string {
  const info = pmAnalyzeDate(startDate);
  if (!info) return startDate;
  if (preset === '3m') return addUtcMonths(startDate, 3);
  if (preset === '6m') return addUtcMonths(startDate, 6);
  if (preset === '1y') return addUtcMonths(startDate, 12);
  return `${info.year}-12-31`;
}

export function getPmRepeatOptions(startDate: string): Array<{ value: PmRepeatPreset; label: string }> {
  const info = pmAnalyzeDate(startDate);
  if (!info) return [{ value: 'none', label: 'Does not repeat' }];

  const wd = info.weekdayName;
  const od = info.ordinal;
  const dn = info.dayOfMonth;

  const opts: Array<{ value: PmRepeatPreset; label: string }> = [
    { value: 'none', label: 'Does not repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'every2days', label: 'Every 2 days' },
    { value: 'weekdays', label: 'Every weekday (Monday to Friday)' },
    { value: 'mon_sat', label: 'Every Monday to Saturday' },
    { value: 'weekends', label: 'Every weekend (Saturday & Sunday)' },
    { value: 'weekly', label: `Weekly on ${wd}` },
    { value: 'biweekly', label: `Every 2 weeks on ${wd}` },
    { value: 'every3weeks', label: `Every 3 weeks on ${wd}` },
    { value: 'every4weeks', label: `Every 4 weeks on ${wd}` },
    { value: 'monthly_nth', label: `Monthly on the ${od} ${wd}` },
  ];
  if (info.isLast) opts.push({ value: 'monthly_last', label: `Monthly on the last ${wd}` });
  opts.push(
    { value: 'monthly_date', label: `Monthly on day ${dn}` },
    { value: 'monthly_lastday', label: 'Monthly on the last day of the month' },
    { value: 'bimonthly_nth', label: `Every 2 months on the ${od} ${wd}` },
    { value: 'bimonthly_date', label: `Every 2 months on day ${dn}` },
    { value: 'quarterly_nth', label: `Every 3 months on the ${od} ${wd}` },
  );
  if (info.isLast) opts.push({ value: 'quarterly_last', label: `Every 3 months on the last ${wd}` });
  opts.push(
    { value: 'quarterly_date', label: `Every 3 months on day ${dn}` },
    { value: 'semiannual_nth', label: `Every 6 months on the ${od} ${wd}` },
    { value: 'semiannual_date', label: `Every 6 months on day ${dn}` },
    { value: 'annually', label: `Annually on ${info.monthName} ${dn}` },
    { value: 'custom', label: 'Custom…' },
  );
  return opts;
}

function clampCustomInterval(interval: number, unit: PmCustomUnit): number {
  const max = PM_CUSTOM_UNIT_MAX[unit];
  const n = Math.floor(Number.isFinite(interval) ? interval : 1);
  return Math.min(max, Math.max(1, n));
}

function normalizedWeekDays(days: number[], fallbackDow: number): number[] {
  const clean = Array.from(new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b);
  return clean.length > 0 ? clean : [fallbackDow];
}

export function formatPmRecurrenceLabel(startDate: string, config: PmRecurrenceConfig): string {
  const info = pmAnalyzeDate(startDate);
  if (!info || config.mode === 'none') return 'Does not repeat';

  if (config.mode !== 'custom') {
    const found = getPmRepeatOptions(startDate).find((o) => o.value === config.mode);
    return found?.label ?? config.mode;
  }

  const interval = clampCustomInterval(config.customInterval, config.customUnit);
  if (config.customUnit === 'day') {
    return interval === 1 ? 'Daily' : `Every ${interval} days`;
  }
  if (config.customUnit === 'week') {
    const names = normalizedWeekDays(config.customWeekDays, info.dow).map((d) => PM_WEEKDAYS_SHORT[d]);
    const prefix = interval === 1 ? 'Weekly' : `Every ${interval} weeks`;
    return `${prefix} on ${names.join(', ')}`;
  }
  if (config.customUnit === 'month') {
    const prefix = interval === 1 ? 'Monthly' : `Every ${interval} months`;
    if (config.customMonthMode === 'date') return `${prefix} on day ${info.dayOfMonth}`;
    if (config.customMonthMode === 'lastday') return `${prefix} on the last day of the month`;
    const wdName = PM_WEEKDAYS[((config.customMonthDow % 7) + 7) % 7] ?? info.weekdayName;
    if (config.customMonthMode === 'last') return `${prefix} on the last ${wdName}`;
    const ord = PM_ORDINALS[(config.customMonthNth - 1) as number] ?? `${config.customMonthNth}th`;
    return `${prefix} on the ${ord} ${wdName}`;
  }
  const prefix = interval === 1 ? 'Annually' : `Every ${interval} years`;
  return `${prefix} on ${info.monthName} ${info.dayOfMonth}`;
}

export function formatPmShortChipDate(dateStr: string, referenceYear?: number): string {
  const parts = parseIsoDateParts(dateStr);
  if (!parts) return dateStr;
  const dow = new Date(Date.UTC(parts.year, parts.monthIdx, parts.day)).getUTCDay();
  const base = `${PM_WEEKDAYS_SHORT[dow]}, ${PM_MONTHS_SHORT[parts.monthIdx]} ${parts.day}`;
  if (referenceYear !== undefined && parts.year !== referenceYear) {
    return `${base} '${String(parts.year).slice(-2)}`;
  }
  return base;
}

export function getIsoDateUtcDow(dateStr: string): number | null {
  const parts = parseIsoDateParts(dateStr);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.monthIdx, parts.day)).getUTCDay();
}

const DAY_STEP_PRESETS: Partial<Record<PmRepeatPreset, number>> = {
  daily: 1,
  every2days: 2,
  weekly: 7,
  biweekly: 14,
  every3weeks: 21,
  every4weeks: 28,
};

const DAY_SET_PRESETS: Partial<Record<PmRepeatPreset, ReadonlySet<number>>> = {
  weekdays: new Set([1, 2, 3, 4, 5]),
  mon_sat: new Set([1, 2, 3, 4, 5, 6]),
  weekends: new Set([0, 6]),
};

const MONTH_MODE_PRESETS: Partial<Record<PmRepeatPreset, readonly [number, PmCustomMonthMode]>> = {
  monthly_nth: [1, 'nth'],
  monthly_last: [1, 'last'],
  monthly_date: [1, 'date'],
  monthly_lastday: [1, 'lastday'],
  bimonthly_nth: [2, 'nth'],
  bimonthly_date: [2, 'date'],
  quarterly_nth: [3, 'nth'],
  quarterly_last: [3, 'last'],
  quarterly_date: [3, 'date'],
  semiannual_nth: [6, 'nth'],
  semiannual_date: [6, 'date'],
};

/**
 * Generates repeating `YYYY-MM-DD` occurrence dates from an explicit calendar start date.
 * Input dates (`startDate` and `config.until`) MUST be pure calendar `YYYY-MM-DD` strings, never
 * local-timezone Date objects or un-offset UTC ISO slices, so Manila (UTC+8) dates never shift.
 */
export function generatePmRepeatDates(startDate: string, config: PmRecurrenceConfig): string[] {
  const info = pmAnalyzeDate(startDate);
  if (!info) return [];
  if (config.mode === 'none') return [startDate];

  const useCount = config.endMode === 'count';
  const maxCount = useCount
    ? Math.min(PM_MAX_OCCURRENCES, Math.max(2, Math.floor(Number.isFinite(config.count) ? config.count : 6)))
    : PM_MAX_OCCURRENCES;
  const limitUntil = useCount ? '2099-12-31' : config.until;

  if (!useCount && (!parseIsoDateParts(limitUntil) || limitUntil < startDate)) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();

  const emitRaw = (rawStr: string): 'ok' | 'stop' => {
    if (rawStr < startDate) return 'ok';
    if (!useCount && rawStr > limitUntil) return 'stop';

    let finalStr = rawStr;
    const dow = getIsoDateUtcDow(rawStr);
    if (dow === 0) {
      if (config.sundayRule === 'skip') return 'ok';
      if (config.sundayRule === 'next_mon') finalStr = addUtcDays(rawStr, 1);
    }
    if (!useCount && finalStr > limitUntil) return 'stop';
    if (!seen.has(finalStr)) {
      seen.add(finalStr);
      result.push(finalStr);
    }
    return result.length >= maxCount ? 'stop' : 'ok';
  };

  const dayStep =
    DAY_STEP_PRESETS[config.mode] ??
    (config.mode === 'custom' && config.customUnit === 'day'
      ? clampCustomInterval(config.customInterval, 'day')
      : null);

  if (dayStep !== null) {
    for (let i = 0; i < 1500 && result.length < maxCount; i++) {
      if (emitRaw(addUtcDays(startDate, i * dayStep)) === 'stop') break;
    }
    return result;
  }

  const daySet = DAY_SET_PRESETS[config.mode];
  if (daySet) {
    for (let i = 0; i < 1500 && result.length < maxCount; i++) {
      const candidate = addUtcDays(startDate, i);
      if (!useCount && candidate > limitUntil) break;
      const dow = getIsoDateUtcDow(candidate);
      if (dow !== null && daySet.has(dow)) {
        if (emitRaw(candidate) === 'stop') break;
      }
    }
    return result;
  }

  if (config.mode === 'custom' && config.customUnit === 'week') {
    const interval = clampCustomInterval(config.customInterval, 'week');
    const dows = normalizedWeekDays(config.customWeekDays, info.dow);
    const weekSunday = addUtcDays(startDate, -info.dow);
    for (let w = 0; w < 600 && result.length < maxCount; w += interval) {
      let stopped = false;
      for (const dw of dows) {
        const candidate = addUtcDays(weekSunday, w * 7 + dw);
        if (emitRaw(candidate) === 'stop') {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
    return result;
  }

  const presetMonth = MONTH_MODE_PRESETS[config.mode];
  if (presetMonth || (config.mode === 'custom' && config.customUnit === 'month')) {
    const isCustomMonth = presetMonth === undefined;
    const step = presetMonth ? presetMonth[0] : clampCustomInterval(config.customInterval, 'month');
    const pick: PmCustomMonthMode = presetMonth ? presetMonth[1] : config.customMonthMode;
    const targetNth = isCustomMonth ? config.customMonthNth : info.nth;
    const targetDow = isCustomMonth ? config.customMonthDow : info.dow;

    const resolveMonthCandidate = (mOffset: number): string | null => {
      const totalM = info.monthIdx + mOffset;
      const targetYear = info.year + Math.floor(totalM / 12);
      const targetMonth = ((totalM % 12) + 12) % 12;
      if (pick === 'nth') return pmNthWeekdayDate(targetYear, targetMonth, targetDow, targetNth);
      if (pick === 'last') return pmLastWeekdayDate(targetYear, targetMonth, targetDow);
      if (pick === 'lastday') return formatIsoDateUtc(targetYear, targetMonth, pmDaysInMonth(targetYear, targetMonth));
      return formatIsoDateUtc(targetYear, targetMonth, Math.min(info.dayOfMonth, pmDaysInMonth(targetYear, targetMonth)));
    };

    // For custom nth/last weekday rules, if month offset 0 lands before startDate (or lacks a 5th weekday),
    // align stepping to the first month whose candidate falls on/after startDate.
    let startOffset = 0;
    if (isCustomMonth && (pick === 'nth' || pick === 'last')) {
      for (let probe = 0; probe <= 12; probe++) {
        const cand = resolveMonthCandidate(probe);
        if (cand !== null && cand >= startDate) {
          startOffset = probe;
          break;
        }
      }
    }

    for (let offset = startOffset; offset < startOffset + 600 && result.length < maxCount; offset += step) {
      const cand = resolveMonthCandidate(offset);
      if (cand && emitRaw(cand) === 'stop') break;
    }
    return result;
  }

  if (config.mode === 'annually' || (config.mode === 'custom' && config.customUnit === 'year')) {
    const step = config.mode === 'annually' ? 1 : clampCustomInterval(config.customInterval, 'year');
    for (let yOff = 0; yOff < 120 && result.length < maxCount; yOff += step) {
      const targetYear = info.year + yOff;
      const cand = formatIsoDateUtc(targetYear, info.monthIdx, Math.min(info.dayOfMonth, pmDaysInMonth(targetYear, info.monthIdx)));
      if (emitRaw(cand) === 'stop') break;
    }
    return result;
  }

  return [startDate];
}
