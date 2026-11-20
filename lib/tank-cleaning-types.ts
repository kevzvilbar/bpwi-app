import {
  normalizePulloutDateYMD,
  normalizePulloutTimeHHMM,
} from './well-pullout-types.ts';

/**
 * Types, defaults, water-quality evaluation, hydration, and serialization
 * for the Tank Cleaning & Sanitation Accomplishment Report
 * (`activity_type === 'tank_cleaning'`).
 *
 * Intentionally free of runtime `@/` path-alias imports so `node --test`
 * loads it directly.
 */

export type TankCleaningCondition = '' | 'Good' | 'Fair' | 'Needs Repair' | 'N/A';

export type TankCleaningType =
  | ''
  | 'Ground Reservoir'
  | 'Overhead / Elevated Tank'
  | 'Cistern'
  | 'Clearwell / Filter Tank'
  | 'Pressure Tank'
  | 'Other';

export type TankCapacityUnit = 'm³' | 'Gallons' | 'Liters';

export type WaterQualityVerdict = 'PASS' | 'FAIL' | 'PENDING';

export type TankSanitaryClearance = 'CLEARED' | 'HOLD' | 'INCOMPLETE';

export interface TankCleaningFormDetails {
  // Header / Tank Metadata & Timeline
  reportNo: string;
  tankId: string;
  tankType: TankCleaningType;
  tankCapacity: string;
  tankCapacityUnit: TankCapacityUnit;
  dateStarted: string;
  timeStarted: string;
  dateFinished: string;
  timeFinished: string;
  totalDowntime: string;

  // Section 1: Objective
  objective: string;

  // Section 2: Scope of Work & Execution Summary
  scopeSystemIsolation: boolean;
  scopeBypassEngaged: boolean;
  scopeDrainingSludge: boolean;
  scopeSurfaceScrubbing: boolean;
  scopeDisinfection: boolean;
  disinfectionConcentrationPpm: string;
  disinfectionContactTime: string;
  scopeFlushingRefilling: boolean;
  scopeCommissioning: boolean;

  // Section 3: Water Quality & Disinfection Log
  chlorinePre: string;
  chlorineDisinfection: string;
  chlorinePost: string;
  turbidityPre: string;
  turbidityPost: string;
  phPre: string;
  phDisinfection: string;
  phPost: string;
  odorPre: string;
  odorPost: string;
  disinfectantUsed: string;
  disinfectantQuantity: string;

  // Section 4: Physical Inspection & Conclusion
  condWallsFloor: TankCleaningCondition;
  remWallsFloor: string;
  condRoofHatch: TankCleaningCondition;
  remRoofHatch: string;
  condVentsScreen: TankCleaningCondition;
  remVentsScreen: string;
  condValves: TankCleaningCondition;
  remValves: string;
  condLadderGauge: TankCleaningCondition;
  remLadderGauge: string;
  conclusionRecommendations: string;
  nextScheduledCleaningDate: string;

  // Section 6: Photo Captions (actual images stored in daily_activities.photo_urls)
  startPhotoTime: string;
  startPhotoRemarks: string;
  endPhotoTime: string;
  endPhotoRemarks: string;

  // Section 7: Signatories (Prepared By auto-filled from Lead Operator)
  notedByName: string;
  approvedByName: string;
}

export const DEFAULT_TANK_CLEANING_OBJECTIVE =
  'To thoroughly clean, de-sludge, and sanitize the water storage facility by removing accumulated sediments, biofilm, and contaminants, ensuring safe drinking water quality and maintaining reliable distribution operations.';

export const DEFAULT_TANK_CLEANING_CONCLUSION =
  'The tank cleaning and sanitization activity was completed successfully, and the facility has been restored to sanitary operational condition.';

export const INITIAL_TANK_CLEANING_DETAILS: TankCleaningFormDetails = {
  reportNo: '',
  tankId: '',
  tankType: '',
  tankCapacity: '',
  tankCapacityUnit: 'm³',
  dateStarted: '',
  timeStarted: '',
  dateFinished: '',
  timeFinished: '',
  totalDowntime: '',

  objective: DEFAULT_TANK_CLEANING_OBJECTIVE,

  scopeSystemIsolation: true,
  scopeBypassEngaged: false,
  scopeDrainingSludge: true,
  scopeSurfaceScrubbing: true,
  scopeDisinfection: true,
  disinfectionConcentrationPpm: '50',
  disinfectionContactTime: '30 mins',
  scopeFlushingRefilling: true,
  scopeCommissioning: true,

  chlorinePre: '',
  chlorineDisinfection: '50.0',
  chlorinePost: '',
  turbidityPre: '',
  turbidityPost: '',
  phPre: '',
  phDisinfection: '',
  phPost: '',
  odorPre: '',
  odorPost: '',
  disinfectantUsed: 'Sodium Hypochlorite 12.5%',
  disinfectantQuantity: '',

  condWallsFloor: 'Good',
  remWallsFloor: '',
  condRoofHatch: 'Good',
  remRoofHatch: '',
  condVentsScreen: 'Good',
  remVentsScreen: '',
  condValves: 'Good',
  remValves: '',
  condLadderGauge: 'Good',
  remLadderGauge: '',
  conclusionRecommendations: '',
  nextScheduledCleaningDate: '',

  startPhotoTime: '',
  startPhotoRemarks: '',
  endPhotoTime: '',
  endPhotoRemarks: '',

  notedByName: '',
  approvedByName: '',
};

const VALID_CONDITIONS = new Set<TankCleaningCondition>(['', 'Good', 'Fair', 'Needs Repair', 'N/A']);
const VALID_TANK_TYPES = new Set<TankCleaningType>([
  '',
  'Ground Reservoir',
  'Overhead / Elevated Tank',
  'Cistern',
  'Clearwell / Filter Tank',
  'Pressure Tank',
  'Other',
]);
const VALID_CAPACITY_UNITS = new Set<TankCapacityUnit>(['m³', 'Gallons', 'Liters']);

function strVal(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function boolVal(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function pickSource(d: Record<string, unknown>): Record<string, unknown> {
  const nested = d.tankCleaning;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...d, ...(nested as Record<string, unknown>) };
  }
  return d;
}

/**
 * Computes human-readable tank cleaning downtime (e.g. "6 hrs 30 mins")
 * from start and finish date/time strings. Supports overnight durations.
 */
export function computeTankDowntime(
  dateStarted: string,
  timeStarted: string,
  dateFinished: string,
  timeFinished: string,
  fallbackDateYmd = '',
): string {
  const sTime = normalizePulloutTimeHHMM(timeStarted);
  const eTime = normalizePulloutTimeHHMM(timeFinished);
  if (!sTime || !eTime) return '';
  const sYmd = normalizePulloutDateYMD(dateStarted, fallbackDateYmd || '2000-01-01');
  const eYmd = normalizePulloutDateYMD(dateFinished, sYmd);
  const startMs = Date.parse(`${sYmd}T${sTime}:00Z`);
  let endMs = Date.parse(`${eYmd}T${eTime}:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return '';
  if (!dateFinished.trim() && endMs < startMs) {
    endMs += 24 * 60 * 60 * 1000;
  }
  const diffMins = Math.round((endMs - startMs) / 60000);
  if (diffMins <= 0) return '';
  const hrs = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (hrs > 0 && mins > 0) {
    return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'} ${mins} ${mins === 1 ? 'min' : 'mins'}`;
  }
  if (hrs > 0) return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'}`;
  return `${mins} ${mins === 1 ? 'min' : 'mins'}`;
}

/** Generates TCAR-YYYY-MM-XXXX when no custom Report No. override is supplied. */
export function formatTankReportNumber(
  activityDate: string,
  activityId: string,
  customReportNo = '',
): string {
  if (customReportNo.trim()) return customReportNo.trim();
  const ymd = normalizePulloutDateYMD(activityDate, '');
  const ym = ymd ? ymd.slice(0, 7) : '0000-00';
  const shortId = (activityId || '0000').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || '0000';
  return `TCAR-${ym}-${shortId}`;
}

/** Evaluates Post-Cleaning water quality parameters against PNSDW thresholds. */
export function evaluateTankWaterQuality(tc: TankCleaningFormDetails): {
  chlorine: WaterQualityVerdict;
  turbidity: WaterQualityVerdict;
  ph: WaterQualityVerdict;
  odor: WaterQualityVerdict;
  overall: TankSanitaryClearance;
} {
  const parseMetric = (raw: string, allowLessThan = false): number | null => {
    const s = raw.trim();
    if (!s) return null;
    const lt = /^(?:<=|<)\s*(\d+(?:\.\d+)?)$/.exec(s);
    if (allowLessThan && lt) return Number(lt[1]);
    if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
    return Number(s);
  };

  const clVal = parseMetric(tc.chlorinePost);
  const chlorine: WaterQualityVerdict =
    clVal === null ? 'PENDING' : clVal >= 0.3 && clVal <= 1.5 ? 'PASS' : 'FAIL';

  const turbVal = parseMetric(tc.turbidityPost, true);
  const turbidity: WaterQualityVerdict =
    turbVal === null ? 'PENDING' : turbVal >= 0 && turbVal <= 5.0 ? 'PASS' : 'FAIL';

  const phVal = parseMetric(tc.phPost);
  const ph: WaterQualityVerdict =
    phVal === null ? 'PENDING' : phVal >= 6.5 && phVal <= 8.5 ? 'PASS' : 'FAIL';

  const odorRaw = tc.odorPost.trim().toLowerCase();
  let odor: WaterQualityVerdict = 'PENDING';
  if (odorRaw) {
    if (/\bunobjectionable\b|\bodorless\b|\bclear\b|\bnone\b|\bnormal\b|\bok\b|\bacceptable\b/.test(odorRaw)) {
      odor = 'PASS';
    } else if (/foul|musty|murky|dirty|silt|rust|cloudy|pungent|smell|objectionable/.test(odorRaw)) {
      odor = 'FAIL';
    }
  }

  const verdicts = [chlorine, turbidity, ph, odor];
  const overall: TankSanitaryClearance = verdicts.includes('FAIL')
    ? 'HOLD'
    : verdicts.every((v) => v === 'PASS')
      ? 'CLEARED'
      : 'INCOMPLETE';

  return { chlorine, turbidity, ph, odor, overall };
}

/** Hydrate TankCleaningFormDetails from saved activity `details` JSON. */
export function hydrateTankCleaningDetails(d: Record<string, unknown>): TankCleaningFormDetails {
  const src = pickSource(d);
  const init = INITIAL_TANK_CLEANING_DETAILS;
  const rawType = strVal(src.tankType) as TankCleaningType;
  const rawUnit = strVal(src.tankCapacityUnit, init.tankCapacityUnit) as TankCapacityUnit;
  const pickCond = (v: unknown, fb: TankCleaningCondition): TankCleaningCondition => {
    const s = strVal(v, fb) as TankCleaningCondition;
    return VALID_CONDITIONS.has(s) ? s : fb;
  };

  return {
    reportNo: strVal(src.reportNo),
    tankId: strVal(src.tankId),
    tankType: VALID_TANK_TYPES.has(rawType) ? rawType : '',
    tankCapacity: strVal(src.tankCapacity),
    tankCapacityUnit: VALID_CAPACITY_UNITS.has(rawUnit) ? rawUnit : init.tankCapacityUnit,
    dateStarted: strVal(src.dateStarted),
    timeStarted: strVal(src.timeStarted),
    dateFinished: strVal(src.dateFinished),
    timeFinished: strVal(src.timeFinished),
    totalDowntime: strVal(src.totalDowntime),

    objective: strVal(src.objective, init.objective),

    scopeSystemIsolation: boolVal(src.scopeSystemIsolation, init.scopeSystemIsolation),
    scopeBypassEngaged: boolVal(src.scopeBypassEngaged, init.scopeBypassEngaged),
    scopeDrainingSludge: boolVal(src.scopeDrainingSludge, init.scopeDrainingSludge),
    scopeSurfaceScrubbing: boolVal(src.scopeSurfaceScrubbing, init.scopeSurfaceScrubbing),
    scopeDisinfection: boolVal(src.scopeDisinfection, init.scopeDisinfection),
    disinfectionConcentrationPpm: strVal(src.disinfectionConcentrationPpm, init.disinfectionConcentrationPpm),
    disinfectionContactTime: strVal(src.disinfectionContactTime, init.disinfectionContactTime),
    scopeFlushingRefilling: boolVal(src.scopeFlushingRefilling, init.scopeFlushingRefilling),
    scopeCommissioning: boolVal(src.scopeCommissioning, init.scopeCommissioning),

    chlorinePre: strVal(src.chlorinePre),
    chlorineDisinfection: strVal(src.chlorineDisinfection, init.chlorineDisinfection),
    chlorinePost: strVal(src.chlorinePost),
    turbidityPre: strVal(src.turbidityPre),
    turbidityPost: strVal(src.turbidityPost),
    phPre: strVal(src.phPre),
    phDisinfection: strVal(src.phDisinfection),
    phPost: strVal(src.phPost),
    odorPre: strVal(src.odorPre),
    odorPost: strVal(src.odorPost),
    disinfectantUsed: strVal(src.disinfectantUsed, init.disinfectantUsed),
    disinfectantQuantity: strVal(src.disinfectantQuantity),

    condWallsFloor: pickCond(src.condWallsFloor, init.condWallsFloor),
    remWallsFloor: strVal(src.remWallsFloor),
    condRoofHatch: pickCond(src.condRoofHatch, init.condRoofHatch),
    remRoofHatch: strVal(src.remRoofHatch),
    condVentsScreen: pickCond(src.condVentsScreen, init.condVentsScreen),
    remVentsScreen: strVal(src.remVentsScreen),
    condValves: pickCond(src.condValves, init.condValves),
    remValves: strVal(src.remValves),
    condLadderGauge: pickCond(src.condLadderGauge, init.condLadderGauge),
    remLadderGauge: strVal(src.remLadderGauge),
    conclusionRecommendations: strVal(src.conclusionRecommendations),
    nextScheduledCleaningDate: strVal(src.nextScheduledCleaningDate),

    startPhotoTime: strVal(src.startPhotoTime),
    startPhotoRemarks: strVal(src.startPhotoRemarks),
    endPhotoTime: strVal(src.endPhotoTime),
    endPhotoRemarks: strVal(src.endPhotoRemarks),

    notedByName: strVal(src.notedByName),
    approvedByName: strVal(src.approvedByName),
  };
}

/** Build the persisted JSON details object for `activity_type === 'tank_cleaning'`. */
export function buildTankCleaningPayload(
  tc: TankCleaningFormDetails,
  fallbackDateYmd = '',
): Record<string, unknown> {
  const totalDowntime =
    tc.totalDowntime.trim() ||
    computeTankDowntime(tc.dateStarted, tc.timeStarted, tc.dateFinished, tc.timeFinished, fallbackDateYmd);
  const disinfectionConcentrationPpm =
    tc.chlorineDisinfection.trim() || tc.disinfectionConcentrationPpm;
  const resolved: TankCleaningFormDetails = {
    ...tc,
    totalDowntime,
    disinfectionConcentrationPpm,
  };
  const evalRes = evaluateTankWaterQuality(resolved);

  return {
    tankCleaning: resolved,
    tankId: resolved.tankId.trim() || null,
    tankType: resolved.tankType || null,
    tankCapacity: resolved.tankCapacity.trim() || null,
    tankCapacityUnit: resolved.tankCapacity.trim() ? resolved.tankCapacityUnit : null,
    totalDowntime: totalDowntime || null,
    chlorinePost: resolved.chlorinePost.trim() || null,
    turbidityPost: resolved.turbidityPost.trim() || null,
    phPost: resolved.phPost.trim() || null,
    sanitaryClearance: evalRes.overall,
    nextScheduledCleaningDate: resolved.nextScheduledCleaningDate.trim() || null,
  };
}
