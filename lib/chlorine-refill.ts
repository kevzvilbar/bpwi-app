/**
 * Pure helpers for the Chlorine Refilling (Dosing Drum) activity (`chlorine_refill`):
 * drum level, chlorine added (kg or L), and dosing pump settings before and after adjustment.
 */

export const CHLORINE_REFILL_ACTIVITY_TYPE = 'chlorine_refill';

export type ChlorineAmountUnit = 'kg' | 'L';
export type DrumLevelUnit = 'L' | '%' | 'cm';

export const CHLORINE_CHEMICALS: ReadonlyArray<{ name: string; unit: ChlorineAmountUnit }> = [
  { name: 'Sodium Hypochlorite 12.5% (liquid)', unit: 'L' },
  { name: 'Calcium Hypochlorite 70% (granules)', unit: 'kg' },
];

export const DRUM_LEVEL_UNITS: ReadonlyArray<{ value: DrumLevelUnit; label: string }> = [
  { value: 'L', label: 'Liters (L)' },
  { value: '%', label: 'Percent (%)' },
  { value: 'cm', label: 'Dipstick (cm)' },
];

export interface ChlorineRefillFormState {
  chemicalType: string;
  drumLevelUnit: DrumLevelUnit;
  drumLevelBefore: string;
  drumLevelAfter: string;
  amountAdded: string;
  amountUnit: ChlorineAmountUnit;
  waterAddedLiters: string;
  pumpStrokePct: string;
  pumpSpeedPct: string;
  newPumpStrokePct: string;
  newPumpSpeedPct: string;
}

export const INITIAL_CHLORINE_REFILL_STATE: ChlorineRefillFormState = {
  chemicalType: '',
  drumLevelUnit: 'L',
  drumLevelBefore: '',
  drumLevelAfter: '',
  amountAdded: '',
  amountUnit: 'kg',
  waterAddedLiters: '',
  pumpStrokePct: '',
  pumpSpeedPct: '',
  newPumpStrokePct: '',
  newPumpSpeedPct: '',
};

const NUMERIC_KEYS = [
  'drumLevelBefore',
  'drumLevelAfter',
  'amountAdded',
  'waterAddedLiters',
  'pumpStrokePct',
  'pumpSpeedPct',
  'newPumpStrokePct',
  'newPumpSpeedPct',
] as const;

function numOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function hydrateChlorineRefillDetails(d: Record<string, unknown>): ChlorineRefillFormState {
  const next: ChlorineRefillFormState = { ...INITIAL_CHLORINE_REFILL_STATE };
  if (typeof d.chemicalType === 'string') next.chemicalType = d.chemicalType;
  if (d.drumLevelUnit === 'L' || d.drumLevelUnit === '%' || d.drumLevelUnit === 'cm') next.drumLevelUnit = d.drumLevelUnit;
  if (d.amountUnit === 'kg' || d.amountUnit === 'L') next.amountUnit = d.amountUnit;
  for (const key of NUMERIC_KEYS) {
    if (d[key] != null) next[key] = String(d[key]);
  }
  return next;
}

export function buildChlorineRefillPayload(
  f: ChlorineRefillFormState,
  chlorineResidual: string,
): Record<string, unknown> {
  return {
    chemicalType: f.chemicalType || null,
    drumLevelUnit: f.drumLevelUnit,
    drumLevelBefore: numOrNull(f.drumLevelBefore),
    amountAdded: numOrNull(f.amountAdded),
    amountUnit: f.amountUnit,
    waterAddedLiters: numOrNull(f.waterAddedLiters),
    drumLevelAfter: numOrNull(f.drumLevelAfter),
    pumpStrokePct: numOrNull(f.pumpStrokePct),
    pumpSpeedPct: numOrNull(f.pumpSpeedPct),
    newPumpStrokePct: numOrNull(f.newPumpStrokePct),
    newPumpSpeedPct: numOrNull(f.newPumpSpeedPct),
    chlorineResidual: numOrNull(chlorineResidual),
  };
}

/** Returns the first problem that must be fixed before the log can be saved, or null. */
export function validateChlorineRefill(f: ChlorineRefillFormState, chlorineResidual: string): string | null {
  const levelMax = f.drumLevelUnit === '%' ? 100 : null;
  const fields: Array<[label: string, raw: string, max: number | null]> = [
    ['Drum level before refill', f.drumLevelBefore, levelMax],
    ['Drum level after refill', f.drumLevelAfter, levelMax],
    ['Chlorine added', f.amountAdded, null],
    ['Water added', f.waterAddedLiters, null],
    ['Current pump stroke', f.pumpStrokePct, 100],
    ['Current pump speed', f.pumpSpeedPct, 100],
    ['New pump stroke', f.newPumpStrokePct, 100],
    ['New pump speed', f.newPumpSpeedPct, 100],
    ['Residual chlorine', chlorineResidual, null],
  ];
  for (const [label, raw, max] of fields) {
    if (!raw.trim()) continue;
    const n = numOrNull(raw);
    if (n === null || n < 0) return `${label} must be a number of 0 or more.`;
    if (max !== null && n > max) return `${label} cannot be more than ${max}%.`;
  }
  if (!f.drumLevelBefore.trim()) return 'Enter the chlorine level of the drum before refilling.';
  if (!((numOrNull(f.amountAdded) ?? 0) > 0)) return 'Enter how much chlorine was added (more than 0).';
  if (!f.pumpStrokePct.trim() && !f.pumpSpeedPct.trim()) {
    return 'Enter the current dosing setting (pump stroke, speed, or both).';
  }
  return null;
}

/** True when the drum reads lower after the refill than before it, which usually means a typing mistake. */
export function isDrumLevelLowerAfterRefill(f: ChlorineRefillFormState): boolean {
  const before = numOrNull(f.drumLevelBefore);
  const after = numOrNull(f.drumLevelAfter);
  return before !== null && after !== null && after < before;
}

export interface ChlorineRefillRow {
  label: string;
  value: string;
}

/** Labelled readings shared by the activity feed, printed report, and accomplishment report. */
export function describeChlorineRefill(d: Record<string, unknown>): ChlorineRefillRow[] {
  const f = hydrateChlorineRefillDetails(d);
  const rows: ChlorineRefillRow[] = [];
  const add = (label: string, value: string) => rows.push({ label, value });
  const level = (v: string) => (v ? `${v}${f.drumLevelUnit === '%' ? '%' : ` ${f.drumLevelUnit}`}` : '—');
  const setting = (current: string, changed: string) => {
    if (changed && changed !== current) return `${current ? `${current}%` : '—'} → ${changed}%`;
    return current ? `${current}%` : '';
  };

  if (f.chemicalType) add('Chemical', f.chemicalType);
  if (f.drumLevelBefore || f.drumLevelAfter) {
    add('Drum level (before → after)', `${level(f.drumLevelBefore)} → ${level(f.drumLevelAfter)}`);
  }
  if (f.amountAdded) add('Chlorine added', `${f.amountAdded} ${f.amountUnit}`);
  if (f.waterAddedLiters) add('Water added', `${f.waterAddedLiters} L`);
  const stroke = setting(f.pumpStrokePct, f.newPumpStrokePct);
  if (stroke) add('Dosing pump stroke', stroke);
  const speed = setting(f.pumpSpeedPct, f.newPumpSpeedPct);
  if (speed) add('Dosing pump speed', speed);
  if (d.chlorineResidual != null && d.chlorineResidual !== '') add('Residual Cl₂', `${String(d.chlorineResidual)} mg/L`);
  return rows;
}
