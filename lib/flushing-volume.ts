/**
 * Pure hydraulic and metered volume calculation helpers for Line Flushing & Blow-Off activities.
 * Supports Mother Meter readings as well as per-blow-off-point Torricelli orifice volume
 * computation when the mother meter is unreadable/defective or absent.
 */

import {
  DEFAULT_DISCHARGE_COEFF,
  WATER_DENSITY_KG_M3,
  computeLeakVolumeLoss,
  type LeakVolumeLossComputed,
} from './leak-volume-loss.ts';

export type FlushingMeterStatus = 'metered' | 'unreadable' | 'no_meter';

export const FLUSHING_METER_STATUS_OPTIONS: ReadonlyArray<{
  id: FlushingMeterStatus;
  label: string;
}> = [
  { id: 'metered', label: 'Mother Meter Readable' },
  { id: 'unreadable', label: 'Meter Unreadable / Defective' },
  { id: 'no_meter', label: 'No Existing Mother Meter' },
];

export const FLUSHING_DISCHARGE_COEFF_PRESETS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: '0.6', label: '0.60 — Sharp Orifice / Valve (BPWI Default)' },
  { value: '0.8', label: '0.80 — Open Blow-Off / Pipe End' },
  { value: '0.9', label: '0.90 — Smooth Hydrant Nozzle (AWWA)' },
];

export const FLUSHING_BORE_PRESETS_MM: ReadonlyArray<{ mm: string; label: string }> = [
  { mm: '25', label: '1"' },
  { mm: '50', label: '2"' },
  { mm: '63', label: '2.5"' },
  { mm: '75', label: '3"' },
  { mm: '100', label: '4"' },
];

export const FLUSHING_INTERNAL_DETAIL_KEYS: ReadonlySet<string> = new Set([
  'flushingMeterStatus',
  'flushingVolume',
]);

export { WATER_DENSITY_KG_M3 };

export interface FlushingBlowOffInput {
  name: string;
  initialRead: string;
  finalRead: string;
  diameterMm?: string;
  pressurePsi?: string;
  dischargeCoeff?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: string;
}

export interface FlushingBlowOffComputed {
  name: string;
  method: 'metered' | 'orifice' | 'none';
  initialRead: number | null;
  finalRead: number | null;
  meteredVolumeM3: number | null;
  orifice: LeakVolumeLossComputed | null;
  volumeM3: number | null;
  startTime: string | null;
  endTime: string | null;
}

export interface FlushingVolumeSummary {
  meterStatus: FlushingMeterStatus;
  basis: 'mother_meter' | 'blowoff_meters' | 'orifice_theoretical' | 'none';
  motherMeterInitial: number | null;
  motherMeterFinal: number | null;
  motherMeterVolumeM3: number | null;
  blowOffPoints: FlushingBlowOffComputed[];
  totalBlowOffVolumeM3: number;
  totalVolumeM3: number | null;
  computedPointCount: number;
  hasHighPressureDropWarning: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function optStr(v: unknown, fallback = ''): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return fallback;
}

export function formatFlushingMeterStatusLabel(status: FlushingMeterStatus): string {
  return (
    FLUSHING_METER_STATUS_OPTIONS.find((opt) => opt.id === status)?.label ??
    'Mother Meter Readable'
  );
}

export function hydrateFlushingMeterStatus(d: Record<string, unknown>): FlushingMeterStatus {
  if (d.flushingMeterStatus === 'unreadable' || d.flushingMeterStatus === 'no_meter') {
    return d.flushingMeterStatus;
  }
  return 'metered';
}

/**
 * Computes line flushing volume from either Mother Meter / Blow-off meter differentials
 * (when `meterStatus === 'metered'`) or per-blow-off Torricelli orifice calculations
 * (when `meterStatus === 'unreadable' | 'no_meter'`).
 */
export function computeFlushingVolume(input: {
  meterStatus: FlushingMeterStatus;
  flushingInitialRead?: string | number | null;
  flushingFinalRead?: string | number | null;
  blowOffs: readonly FlushingBlowOffInput[];
}): FlushingVolumeSummary {
  const meterStatus = input.meterStatus;
  const motherMeterInitial = numOrNull(input.flushingInitialRead);
  const motherMeterFinal = numOrNull(input.flushingFinalRead);
  const motherMeterVolumeM3 =
    meterStatus === 'metered' &&
    motherMeterInitial !== null &&
    motherMeterFinal !== null &&
    motherMeterFinal >= motherMeterInitial
      ? Math.round((motherMeterFinal - motherMeterInitial) * 100) / 100
      : null;

  let blowOffSum = 0;
  let computedPointCount = 0;
  let hasHighPressureDropWarning = false;

  const blowOffPoints: FlushingBlowOffComputed[] = input.blowOffs.map((bo, idx) => {
    const name = bo.name.trim() || `Blow-off ${idx + 1}`;
    const initialRead = numOrNull(bo.initialRead);
    const finalRead = numOrNull(bo.finalRead);
    const meteredVolumeM3 =
      meterStatus === 'metered' &&
      initialRead !== null &&
      finalRead !== null &&
      finalRead >= initialRead
        ? Math.round((finalRead - initialRead) * 100) / 100
        : null;

    if (meterStatus === 'metered') {
      if (meteredVolumeM3 !== null) {
        blowOffSum += meteredVolumeM3;
        computedPointCount += 1;
      }
      return {
        name,
        method: meteredVolumeM3 !== null ? 'metered' : 'none',
        initialRead,
        finalRead,
        meteredVolumeM3,
        orifice: null,
        volumeM3: meteredVolumeM3,
        startTime: null,
        endTime: null,
      };
    }

    const orifice = computeLeakVolumeLoss({
      openingShape: 'circular',
      diameterMm: bo.diameterMm ?? '',
      pressurePsi: bo.pressurePsi ?? '',
      dischargeCoeff: bo.dischargeCoeff?.trim() || String(DEFAULT_DISCHARGE_COEFF),
      leakReportedAt: bo.startTime ?? '',
      valveIsolatedAt: bo.endTime ?? '',
      durationMinutes: bo.durationMinutes ?? '',
    });

    if (orifice) {
      blowOffSum += orifice.totalVolumeM3;
      computedPointCount += 1;
      if (orifice.highPressureDropWarning) hasHighPressureDropWarning = true;
    }

    return {
      name,
      method: orifice ? 'orifice' : 'none',
      initialRead: null,
      finalRead: null,
      meteredVolumeM3: null,
      orifice,
      volumeM3: orifice ? orifice.totalVolumeM3 : null,
      startTime: bo.startTime?.trim() || null,
      endTime: bo.endTime?.trim() || null,
    };
  });

  const totalBlowOffVolumeM3 = Math.round(blowOffSum * 100) / 100;

  let basis: FlushingVolumeSummary['basis'] = 'none';
  let totalVolumeM3: number | null = null;

  if (meterStatus === 'metered') {
    if (motherMeterVolumeM3 !== null) {
      basis = 'mother_meter';
      totalVolumeM3 = motherMeterVolumeM3;
    } else if (computedPointCount > 0) {
      basis = 'blowoff_meters';
      totalVolumeM3 = totalBlowOffVolumeM3;
    }
  } else if (computedPointCount > 0) {
    basis = 'orifice_theoretical';
    totalVolumeM3 = totalBlowOffVolumeM3;
  }

  return {
    meterStatus,
    basis,
    motherMeterInitial,
    motherMeterFinal,
    motherMeterVolumeM3,
    blowOffPoints,
    totalBlowOffVolumeM3,
    totalVolumeM3,
    computedPointCount,
    hasHighPressureDropWarning,
  };
}

/** Checks whether any blow-off entry holds non-empty orifice inputs. */
export function hasBlowOffOrificeInputs(blowOffs: readonly FlushingBlowOffInput[]): boolean {
  return blowOffs.some((b) =>
    Boolean(
      b.diameterMm?.trim() ||
        b.pressurePsi?.trim() ||
        b.startTime?.trim() ||
        b.endTime?.trim() ||
        b.durationMinutes?.trim() ||
        (b.dischargeCoeff?.trim() && b.dischargeCoeff.trim() !== String(DEFAULT_DISCHARGE_COEFF)),
    ),
  );
}

/** Hydrates and recomputes flushing summary directly from persisted `daily_activities.details`. */
export function hydrateFlushingSummaryFromDetails(d: Record<string, unknown>): FlushingVolumeSummary {
  const meterStatus = hydrateFlushingMeterStatus(d);
  const blowOffs: FlushingBlowOffInput[] = Array.isArray(d.blowOffs)
    ? d.blowOffs.filter(isRecord).map((b, idx) => ({
        name: typeof b.name === 'string' && b.name.trim() ? b.name : `Blow-off ${idx + 1}`,
        initialRead: optStr(b.initialRead),
        finalRead: optStr(b.finalRead),
        diameterMm: optStr(b.diameterMm),
        pressurePsi: optStr(b.pressurePsi),
        dischargeCoeff: optStr(b.dischargeCoeff, String(DEFAULT_DISCHARGE_COEFF)),
        startTime: optStr(b.startTime),
        endTime: optStr(b.endTime),
        durationMinutes: optStr(b.durationMinutes),
      }))
    : [];

  return computeFlushingVolume({
    meterStatus,
    flushingInitialRead: numOrNull(d.flushingInitialRead),
    flushingFinalRead: numOrNull(d.flushingFinalRead),
    blowOffs,
  });
}
