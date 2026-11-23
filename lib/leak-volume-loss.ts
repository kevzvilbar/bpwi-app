/**
 * Pure hydraulic helpers for Leak Repair theoretical water-wastage (volume loss)
 * calculation, fault attribution, and materials-unit tracking.
 *
 * Uses the Torricelli orifice equation:
 *   Q = mu * A * sqrt(2 * deltaP / rho)
 *   V = Q * t
 * supporting both Circular Hole / Pipe Break (A = pi * (d / 2)^2)
 * and Longitudinal Slit / Crack (A = L * W).
 */

export const PSI_TO_PA = 6894.757293;
export const WATER_DENSITY_KG_M3 = 1000;
export const DEFAULT_DISCHARGE_COEFF = 0.6;

export const DISCHARGE_COEFF_PRESETS: ReadonlyArray<{
  value: string;
  label: string;
  description: string;
}> = [
  { value: '0.6', label: '0.60 — Sharp Orifice (Standard)', description: 'BPWI default sharp-edged break' },
  { value: '0.5', label: '0.50 — Buried / Soil-Restricted', description: 'Underground backfill resistance' },
  { value: '0.8', label: '0.80 — Clean Open Pipe End', description: 'Sheared standpipe / full bore' },
];

export const LEAK_PIPE_BORE_PRESETS_MM: ReadonlyArray<{ mm: string; label: string }> = [
  { mm: '13', label: '1/2"' },
  { mm: '20', label: '3/4"' },
  { mm: '25', label: '1"' },
  { mm: '32', label: '1-1/4"' },
  { mm: '50', label: '2"' },
  { mm: '75', label: '3"' },
  { mm: '100', label: '4"' },
];

export const LEAK_MATERIAL_UNITS = [
  'pcs',
  'm',
  'ft',
  'length',
  'set',
  'bag',
  'can',
  'roll',
  'lot',
] as const;

export const LEAK_INTERNAL_DETAIL_KEYS: ReadonlySet<string> = new Set(['leakLoss']);

export type LeakOpeningShape = 'circular' | 'slit';
export type LeakFaultAttribution = 'natural_nrw' | 'third_party';

export interface LeakVolumeLossFormState {
  openingShape: LeakOpeningShape;
  diameterMm: string;
  slitLengthMm: string;
  slitWidthMm: string;
  pressurePsi: string;
  dischargeCoeff: string;
  leakReportedAt: string;
  valveIsolatedAt: string;
  durationMinutes: string;
  faultAttribution: LeakFaultAttribution;
  responsibleParty: string;
  responsibleAccountNo: string;
}

export interface LeakVolumeLossComputed {
  openingShape: LeakOpeningShape;
  diameterMm: number | null;
  slitLengthMm: number | null;
  slitWidthMm: number | null;
  areaM2: number;
  pressurePsi: number;
  deltaPa: number;
  dischargeCoeff: number;
  waterDensityKgM3: number;
  flowM3PerSec: number;
  flowLps: number;
  durationMinutes: number;
  durationHours: number;
  totalVolumeM3: number;
  formulaAreaText: string;
  highPressureDropWarning: boolean;
}

export const INITIAL_LEAK_LOSS_STATE: LeakVolumeLossFormState = {
  openingShape: 'circular',
  diameterMm: '',
  slitLengthMm: '',
  slitWidthMm: '',
  pressurePsi: '',
  dischargeCoeff: String(DEFAULT_DISCHARGE_COEFF),
  leakReportedAt: '',
  valveIsolatedAt: '',
  durationMinutes: '',
  faultAttribution: 'natural_nrw',
  responsibleParty: '',
  responsibleAccountNo: '',
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function numStr(v: unknown, fallback = ''): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim()) return v.trim();
  return fallback;
}

function posNum(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * Computes elapsed minutes between `HH:MM` leak report and valve isolation times.
 * Wraps smoothly across midnight (e.g., `23:40` to `00:24` = `44` min).
 */
export function calcLeakDurationMinutesFromTimes(
  reportedHHMM: string,
  isolatedHHMM: string,
): number | null {
  if (!/^\d{2}:\d{2}$/.test(reportedHHMM) || !/^\d{2}:\d{2}$/.test(isolatedHHMM)) {
    return null;
  }
  const [sh, sm] = reportedHHMM.split(':').map(Number);
  const [eh, em] = isolatedHHMM.split(':').map(Number);
  if (sh > 23 || sm > 59 || eh > 23 || em > 59) return null;
  const startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (endM < startM) endM += 24 * 60;
  const diff = endM - startM;
  return diff > 0 ? diff : null;
}

/**
 * Computes theoretical orifice discharge rate (`m³/s`, `L/s`) and total water volume lost (`m³`).
 * Uses unrounded intermediate SI values and rounds outputs consistently for display and reporting.
 */
export function computeLeakVolumeLoss(
  input: Partial<LeakVolumeLossFormState>,
): LeakVolumeLossComputed | null {
  const openingShape: LeakOpeningShape = input.openingShape === 'slit' ? 'slit' : 'circular';
  const pressurePsi = posNum(input.pressurePsi);
  const muRaw = posNum(input.dischargeCoeff ?? DEFAULT_DISCHARGE_COEFF) ?? DEFAULT_DISCHARGE_COEFF;
  if (pressurePsi === null || muRaw <= 0 || muRaw > 1) return null;

  const durationMinutes =
    posNum(input.durationMinutes) ??
    calcLeakDurationMinutesFromTimes(input.leakReportedAt ?? '', input.valveIsolatedAt ?? '');
  if (durationMinutes === null) return null;

  let diameterMm: number | null = null;
  let slitLengthMm: number | null = null;
  let slitWidthMm: number | null = null;
  let areaM2 = 0;

  if (openingShape === 'slit') {
    slitLengthMm = posNum(input.slitLengthMm);
    slitWidthMm = posNum(input.slitWidthMm);
    if (slitLengthMm === null || slitWidthMm === null) return null;
    areaM2 = (slitLengthMm / 1000) * (slitWidthMm / 1000);
  } else {
    diameterMm = posNum(input.diameterMm);
    if (diameterMm === null) return null;
    const radiusM = diameterMm / 2000;
    areaM2 = Math.PI * radiusM * radiusM;
  }

  if (!Number.isFinite(areaM2) || areaM2 <= 0) return null;

  const deltaPa = pressurePsi * PSI_TO_PA;
  const flowM3PerSec = muRaw * areaM2 * Math.sqrt((2 * deltaPa) / WATER_DENSITY_KG_M3);
  const totalSeconds = durationMinutes * 60;
  const totalVolumeM3 = flowM3PerSec * totalSeconds;

  return {
    openingShape,
    diameterMm,
    slitLengthMm,
    slitWidthMm,
    areaM2,
    pressurePsi,
    deltaPa,
    dischargeCoeff: muRaw,
    waterDensityKgM3: WATER_DENSITY_KG_M3,
    flowM3PerSec,
    flowLps: flowM3PerSec * 1000,
    durationMinutes: Math.round(durationMinutes * 100) / 100,
    durationHours: Math.round((durationMinutes / 60) * 100) / 100,
    totalVolumeM3: Math.round(totalVolumeM3 * 100) / 100,
    formulaAreaText: openingShape === 'slit' ? 'A = L × W' : 'A = π(d/2)²',
    highPressureDropWarning:
      openingShape === 'circular' && diameterMm !== null && diameterMm >= 40 && pressurePsi >= 25,
  };
}

/** Hydrates `details.leakLoss` safely with clean defaults. */
export function hydrateLeakLossDetails(d: Record<string, unknown>): LeakVolumeLossFormState {
  const raw = isRecord(d.leakLoss) ? d.leakLoss : null;
  if (!raw) return { ...INITIAL_LEAK_LOSS_STATE };

  return {
    openingShape: raw.openingShape === 'slit' ? 'slit' : 'circular',
    diameterMm: numStr(raw.diameterMm),
    slitLengthMm: numStr(raw.slitLengthMm),
    slitWidthMm: numStr(raw.slitWidthMm),
    pressurePsi: numStr(raw.pressurePsi),
    dischargeCoeff: numStr(raw.dischargeCoeff, String(DEFAULT_DISCHARGE_COEFF)),
    leakReportedAt: numStr(raw.leakReportedAt),
    valveIsolatedAt: numStr(raw.valveIsolatedAt),
    durationMinutes: numStr(raw.durationMinutes),
    faultAttribution: raw.faultAttribution === 'third_party' ? 'third_party' : 'natural_nrw',
    responsibleParty: numStr(raw.responsibleParty),
    responsibleAccountNo: numStr(raw.responsibleAccountNo),
  };
}

export function hasLeakLossInput(f: LeakVolumeLossFormState): boolean {
  return Boolean(
    f.diameterMm.trim() ||
      f.slitLengthMm.trim() ||
      f.slitWidthMm.trim() ||
      f.pressurePsi.trim() ||
      f.leakReportedAt.trim() ||
      f.valveIsolatedAt.trim() ||
      f.durationMinutes.trim() ||
      f.faultAttribution === 'third_party' ||
      f.responsibleParty.trim() ||
      f.responsibleAccountNo.trim(),
  );
}

/**
 * Serializes `leakLoss` for `daily_activities.details`, returning `null` when empty so non-loss
 * leak logs omit extra JSONB keys.
 */
export function buildLeakLossPayload(
  f: LeakVolumeLossFormState,
): Record<string, unknown> | null {
  if (!hasLeakLossInput(f)) return null;
  const computed = computeLeakVolumeLoss(f);

  return {
    openingShape: f.openingShape,
    diameterMm: f.openingShape === 'circular' ? posNum(f.diameterMm) : null,
    slitLengthMm: f.openingShape === 'slit' ? posNum(f.slitLengthMm) : null,
    slitWidthMm: f.openingShape === 'slit' ? posNum(f.slitWidthMm) : null,
    pressurePsi: posNum(f.pressurePsi),
    dischargeCoeff: posNum(f.dischargeCoeff) ?? DEFAULT_DISCHARGE_COEFF,
    leakReportedAt: f.leakReportedAt.trim() || null,
    valveIsolatedAt: f.valveIsolatedAt.trim() || null,
    durationMinutes: computed?.durationMinutes ?? posNum(f.durationMinutes),
    durationHours: computed?.durationHours ?? null,
    faultAttribution: f.faultAttribution,
    responsibleParty: f.faultAttribution === 'third_party' ? f.responsibleParty.trim() || null : null,
    responsibleAccountNo: f.faultAttribution === 'third_party' ? f.responsibleAccountNo.trim() || null : null,
    areaM2: computed ? Number(computed.areaM2.toFixed(6)) : null,
    deltaPa: computed ? Number(computed.deltaPa.toFixed(4)) : null,
    flowM3PerSec: computed ? Number(computed.flowM3PerSec.toFixed(6)) : null,
    totalVolumeM3: computed ? computed.totalVolumeM3 : null,
  };
}
