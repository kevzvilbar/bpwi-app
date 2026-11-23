/**
 * Pure helpers and constants for Genset Monitoring & Weekly Preventive Maintenance (PMS).
 * Encodes the 15–20 min weekly no-load exercise standard (with outage-run inspection skip
 * and diesel wet-stacking safeguard), fluid/battery/condition checklist evaluation, and
 * structured payload serialization/hydration compatible with legacy 4-field rows.
 */

export type GensetUnitFuelType = 'Diesel' | 'Gasoline';
export type GensetRunMode = 'no_load_pms' | 'skipped_ran_outage' | 'on_load_test' | 'power_outage';
export type GensetOilLevel = 'Normal / Full' | 'Low — Top-Up Needed' | 'Dirty / Due Change' | 'Critical / Empty';
export type GensetCoolantLevel = 'Normal' | 'Low — Top-Up Needed' | 'N/A (Air-Cooled)';
export type GensetBatteryStatus = 'Good / Strong Crank' | 'Weak / Needs Charge' | 'Dead / Replace' | 'N/A (Pull-Start)';
export type GensetLeakStatus = 'None' | 'Oil Leak' | 'Fuel Leak' | 'Coolant Leak' | 'Multiple Leaks';
export type GensetNoiseStatus = 'Normal' | 'Minor Vibration' | 'Abnormal Noise / Knock';
export type GensetExhaustSmoke = 'Clear / Normal' | 'White' | 'Black' | 'Blue' | 'N/A (Not Run)';
export type GensetStandbyVerdict = 'READY' | 'NEEDS_ATTENTION' | 'CRITICAL';

export interface GensetMonitoringFormState {
  unitFuelType: GensetUnitFuelType;
  runMode: GensetRunMode;
  runDurationMin: string;
  oilLevel: GensetOilLevel;
  coolantLevel: GensetCoolantLevel;
  batteryStatus: GensetBatteryStatus;
  batteryVoltageV: string;
  leaksObserved: GensetLeakStatus;
  noiseVibration: GensetNoiseStatus;
  exhaustSmoke: GensetExhaustSmoke;
  outputVoltageV: string;
  frequencyHz: string;
  standbyNote: string;
}

export const GENSET_RECOMMENDED_RUN_MIN = 15;
export const GENSET_RECOMMENDED_RUN_MAX = 20;
export const GENSET_WET_STACKING_WARN_MIN = 30;
export const GENSET_DURATION_PRESETS_MIN = [15, 20, 30] as const;

export const GENSET_RUN_MODE_OPTIONS: ReadonlyArray<{ value: GensetRunMode; label: string; shortLabel: string }> = [
  { value: 'no_load_pms', label: 'No-Load Exercise (15–20 min PMS)', shortLabel: 'No-Load PMS' },
  { value: 'skipped_ran_outage', label: 'Inspection Only (Already Ran on Outage)', shortLabel: 'Insp. Only (Outage)' },
  { value: 'on_load_test', label: 'On-Load Test', shortLabel: 'On-Load Test' },
  { value: 'power_outage', label: 'Power Outage Run', shortLabel: 'Outage Run' },
];

export const GENSET_OIL_LEVEL_OPTIONS: readonly GensetOilLevel[] = [
  'Normal / Full',
  'Low — Top-Up Needed',
  'Dirty / Due Change',
  'Critical / Empty',
];

export const GENSET_COOLANT_LEVEL_OPTIONS: readonly GensetCoolantLevel[] = [
  'Normal',
  'Low — Top-Up Needed',
  'N/A (Air-Cooled)',
];

export const GENSET_BATTERY_STATUS_OPTIONS: readonly GensetBatteryStatus[] = [
  'Good / Strong Crank',
  'Weak / Needs Charge',
  'Dead / Replace',
  'N/A (Pull-Start)',
];

export const GENSET_LEAK_STATUS_OPTIONS: readonly GensetLeakStatus[] = [
  'None',
  'Oil Leak',
  'Fuel Leak',
  'Coolant Leak',
  'Multiple Leaks',
];

export const GENSET_NOISE_STATUS_OPTIONS: readonly GensetNoiseStatus[] = [
  'Normal',
  'Minor Vibration',
  'Abnormal Noise / Knock',
];

export const GENSET_EXHAUST_SMOKE_OPTIONS: readonly GensetExhaustSmoke[] = [
  'Clear / Normal',
  'White',
  'Black',
  'Blue',
  'N/A (Not Run)',
];

export const INITIAL_GENSET_MONITORING_STATE: GensetMonitoringFormState = {
  unitFuelType: 'Diesel',
  runMode: 'no_load_pms',
  runDurationMin: '',
  oilLevel: 'Normal / Full',
  coolantLevel: 'Normal',
  batteryStatus: 'Good / Strong Crank',
  batteryVoltageV: '',
  leaksObserved: 'None',
  noiseVibration: 'Normal',
  exhaustSmoke: 'Clear / Normal',
  outputVoltageV: '',
  frequencyHz: '',
  standbyNote: '',
};

export const GENSET_INTERNAL_DETAIL_KEYS = new Set<string>([
  'gensetInitialFuel',
  'gensetFinalFuel',
  'runningHours',
  'gensetCause',
  'gensetUnitFuelType',
  'gensetRunMode',
  'gensetRunDurationMin',
  'gensetOilLevel',
  'gensetCoolantLevel',
  'gensetBatteryStatus',
  'gensetBatteryVoltageV',
  'gensetLeaksObserved',
  'gensetNoiseVibration',
  'gensetExhaustSmoke',
  'gensetOutputVoltageV',
  'gensetFrequencyHz',
  'gensetStandbyNote',
  'gensetStandbyVerdict',
  'gensetFindings',
]);

const RUN_MODE_SET = new Set<string>(GENSET_RUN_MODE_OPTIONS.map((o) => o.value));
const OIL_SET = new Set<string>(GENSET_OIL_LEVEL_OPTIONS);
const COOLANT_SET = new Set<string>(GENSET_COOLANT_LEVEL_OPTIONS);
const BATTERY_SET = new Set<string>(GENSET_BATTERY_STATUS_OPTIONS);
const LEAK_SET = new Set<string>(GENSET_LEAK_STATUS_OPTIONS);
const NOISE_SET = new Set<string>(GENSET_NOISE_STATUS_OPTIONS);
const SMOKE_SET = new Set<string>(GENSET_EXHAUST_SMOKE_OPTIONS);

export function formatGensetRunModeLabel(mode: GensetRunMode): string {
  return GENSET_RUN_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? mode;
}

export function formatGensetRunModeShort(mode: GensetRunMode): string {
  return GENSET_RUN_MODE_OPTIONS.find((o) => o.value === mode)?.shortLabel ?? mode;
}

export function evaluateGensetDurationGuidance(
  runMode: GensetRunMode,
  runDurationMin: string,
  unitFuelType: GensetUnitFuelType,
): { tone: 'ok' | 'warn' | 'info'; message: string } | null {
  if (runMode === 'skipped_ran_outage') {
    return {
      tone: 'info',
      message: 'No-load run skipped — genset already ran on power outage this week. Inspection checks still recorded.',
    };
  }

  const trimmed = runDurationMin.trim();
  if (runMode === 'no_load_pms') {
    if (!trimmed) {
      return {
        tone: 'info',
        message: 'Recommended weekly no-load exercise: 15–20 mins to warm engine & burn off moisture without wet stacking.',
      };
    }
    const mins = Number(trimmed);
    if (!Number.isFinite(mins) || mins <= 0) {
      return {
        tone: 'warn',
        message: 'Enter a valid run duration in minutes (recommended 15–20 mins for weekly no-load PMS).',
      };
    }
    if (mins < GENSET_RECOMMENDED_RUN_MIN) {
      return {
        tone: 'warn',
        message: `${mins} min is under the recommended 15–20 min warm-up window; oil and exhaust may not reach operating temp.`,
      };
    }
    if (mins <= GENSET_RECOMMENDED_RUN_MAX) {
      return {
        tone: 'ok',
        message: `${mins} min no-load run is within the recommended 15–20 min weekly PMS window.`,
      };
    }
    if (unitFuelType === 'Diesel' && mins > GENSET_WET_STACKING_WARN_MIN) {
      return {
        tone: 'warn',
        message: `${mins} min unloaded exceeds 30 mins on Diesel — prolonged unloaded running risks wet stacking and carbon buildup.`,
      };
    }
    return {
      tone: 'ok',
      message: `Extended ${mins} min no-load exercise logged (recommended weekly target: 15–20 mins).`,
    };
  }

  if (!trimmed) return null;
  const mins = Number(trimmed);
  if (Number.isFinite(mins) && mins > 0) {
    return {
      tone: 'ok',
      message: `${mins} min ${runMode === 'on_load_test' ? 'on-load test' : 'power outage'} run logged.`,
    };
  }
  return null;
}

export function evaluateGensetHealth(state: GensetMonitoringFormState): {
  verdict: GensetStandbyVerdict;
  verdictLabel: string;
  findings: string[];
} {
  const critical: string[] = [];
  const attention: string[] = [];

  if (state.oilLevel === 'Critical / Empty') critical.push('Critical / empty engine oil');
  else if (state.oilLevel !== 'Normal / Full') attention.push(`Oil: ${state.oilLevel}`);

  if (state.coolantLevel === 'Low — Top-Up Needed') attention.push('Coolant low — top-up needed');

  if (state.batteryStatus === 'Dead / Replace') critical.push('Battery dead — replace');
  else if (state.batteryStatus === 'Weak / Needs Charge') attention.push('Battery weak — needs charge');

  if (state.leaksObserved === 'Fuel Leak' || state.leaksObserved === 'Multiple Leaks') {
    critical.push(state.leaksObserved);
  } else if (state.leaksObserved === 'Oil Leak' || state.leaksObserved === 'Coolant Leak') {
    attention.push(state.leaksObserved);
  }

  if (state.noiseVibration === 'Abnormal Noise / Knock') critical.push('Abnormal noise / knock');
  else if (state.noiseVibration === 'Minor Vibration') attention.push('Minor vibration observed');

  if (state.exhaustSmoke === 'White' || state.exhaustSmoke === 'Black' || state.exhaustSmoke === 'Blue') {
    attention.push(`${state.exhaustSmoke} exhaust smoke`);
  }

  const findings = [...critical, ...attention];
  if (critical.length > 0) {
    return { verdict: 'CRITICAL', verdictLabel: 'Critical — Service Required', findings };
  }
  if (attention.length > 0) {
    return { verdict: 'NEEDS_ATTENTION', verdictLabel: 'Needs Attention', findings };
  }
  return { verdict: 'READY', verdictLabel: 'Ready for Standby', findings: [] };
}

/**
 * Returns true only when structured PMS inspection keys exist so legacy 4-field
 * `genset_monitoring` records do not fabricate default checklist findings.
 */
export function hasGensetChecklistDetails(d: Record<string, unknown>): boolean {
  return (
    d.gensetRunMode !== undefined ||
    d.gensetOilLevel !== undefined ||
    d.gensetStandbyVerdict !== undefined ||
    d.gensetRunDurationMin !== undefined ||
    d.gensetBatteryStatus !== undefined ||
    d.gensetLeaksObserved !== undefined
  );
}

const optNumStr = (v: unknown): string =>
  typeof v === 'number' && Number.isFinite(v)
    ? String(v)
    : typeof v === 'string' && v.trim() !== ''
      ? v.trim()
      : '';

export function hydrateGensetMonitoringDetails(d: Record<string, unknown>): GensetMonitoringFormState {
  const unitFuelType: GensetUnitFuelType =
    d.gensetUnitFuelType === 'Gasoline' ? 'Gasoline' : INITIAL_GENSET_MONITORING_STATE.unitFuelType;

  const fallbackMode: GensetRunMode =
    d.gensetCause === 'Power Outage' ? 'power_outage' : INITIAL_GENSET_MONITORING_STATE.runMode;

  const runMode: GensetRunMode =
    typeof d.gensetRunMode === 'string' && RUN_MODE_SET.has(d.gensetRunMode)
      ? (d.gensetRunMode as GensetRunMode)
      : fallbackMode;

  return {
    unitFuelType,
    runMode,
    runDurationMin: optNumStr(d.gensetRunDurationMin),
    oilLevel:
      typeof d.gensetOilLevel === 'string' && OIL_SET.has(d.gensetOilLevel)
        ? (d.gensetOilLevel as GensetOilLevel)
        : INITIAL_GENSET_MONITORING_STATE.oilLevel,
    coolantLevel:
      typeof d.gensetCoolantLevel === 'string' && COOLANT_SET.has(d.gensetCoolantLevel)
        ? (d.gensetCoolantLevel as GensetCoolantLevel)
        : INITIAL_GENSET_MONITORING_STATE.coolantLevel,
    batteryStatus:
      typeof d.gensetBatteryStatus === 'string' && BATTERY_SET.has(d.gensetBatteryStatus)
        ? (d.gensetBatteryStatus as GensetBatteryStatus)
        : INITIAL_GENSET_MONITORING_STATE.batteryStatus,
    batteryVoltageV: optNumStr(d.gensetBatteryVoltageV),
    leaksObserved:
      typeof d.gensetLeaksObserved === 'string' && LEAK_SET.has(d.gensetLeaksObserved)
        ? (d.gensetLeaksObserved as GensetLeakStatus)
        : INITIAL_GENSET_MONITORING_STATE.leaksObserved,
    noiseVibration:
      typeof d.gensetNoiseVibration === 'string' && NOISE_SET.has(d.gensetNoiseVibration)
        ? (d.gensetNoiseVibration as GensetNoiseStatus)
        : INITIAL_GENSET_MONITORING_STATE.noiseVibration,
    exhaustSmoke:
      typeof d.gensetExhaustSmoke === 'string' && SMOKE_SET.has(d.gensetExhaustSmoke)
        ? (d.gensetExhaustSmoke as GensetExhaustSmoke)
        : INITIAL_GENSET_MONITORING_STATE.exhaustSmoke,
    outputVoltageV: optNumStr(d.gensetOutputVoltageV),
    frequencyHz: optNumStr(d.gensetFrequencyHz),
    standbyNote: typeof d.gensetStandbyNote === 'string' ? d.gensetStandbyNote : '',
  };
}

function toFiniteNumberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function buildGensetMonitoringPayload(
  base: {
    gensetInitialFuel: string;
    gensetFinalFuel: string;
    runningHours: string;
    gensetCause: 'Routine' | 'Power Outage' | 'PMS';
  },
  g: GensetMonitoringFormState,
): Record<string, unknown> {
  const health = evaluateGensetHealth(g);
  return {
    gensetInitialFuel: toFiniteNumberOrNull(base.gensetInitialFuel),
    gensetFinalFuel: toFiniteNumberOrNull(base.gensetFinalFuel),
    runningHours: toFiniteNumberOrNull(base.runningHours),
    gensetCause: base.gensetCause,
    gensetUnitFuelType: g.unitFuelType,
    gensetRunMode: g.runMode,
    gensetRunDurationMin: g.runMode === 'skipped_ran_outage' ? null : toFiniteNumberOrNull(g.runDurationMin),
    gensetOilLevel: g.oilLevel,
    gensetCoolantLevel: g.coolantLevel,
    gensetBatteryStatus: g.batteryStatus,
    gensetBatteryVoltageV: toFiniteNumberOrNull(g.batteryVoltageV),
    gensetLeaksObserved: g.leaksObserved,
    gensetNoiseVibration: g.noiseVibration,
    gensetExhaustSmoke: g.exhaustSmoke,
    gensetOutputVoltageV: toFiniteNumberOrNull(g.outputVoltageV),
    gensetFrequencyHz: toFiniteNumberOrNull(g.frequencyHz),
    gensetStandbyNote: g.standbyNote.trim() || null,
    gensetStandbyVerdict: health.verdict,
    gensetFindings: health.findings,
  };
}
