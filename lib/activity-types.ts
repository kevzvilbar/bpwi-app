export type ActivityCategory = 'plant' | 'network' | 'metering' | 'grounds';

export const ACTIVITY_CATEGORIES: ActivityCategory[] = ['plant', 'network', 'metering', 'grounds'];

export interface ActivityTypeDef {
  id: string;
  label: string;
  shortLabel: string;
  category: ActivityCategory;
  color: string;
}

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  plant: 'Plant & Pump Ops',
  network: 'Network & Distribution',
  metering: 'Customer & Metering',
  grounds: 'Grounds, Fleet & General',
};

export const ACTIVITY_TYPES: ActivityTypeDef[] = [
  // Plant & Pump Ops
  { id: 'pump_monitoring', label: 'Pump House Monitoring', shortLabel: 'Pump Mon', category: 'plant', color: '#0369a1' },
  { id: 'genset_monitoring', label: 'Genset Monitoring', shortLabel: 'Genset', category: 'plant', color: '#b45309' },
  { id: 'genset_fuel_refill', label: 'Genset Fuel Refilling', shortLabel: 'Genset Refill', category: 'plant', color: '#d97706' },
  { id: 'genset_fuel_purchase', label: 'Genset Fuel Purchase', shortLabel: 'Fuel Purchase', category: 'plant', color: '#92400e' },
  { id: 'genset_fuel_distribution', label: 'Genset Fuel Distribution', shortLabel: 'Fuel Distrib', category: 'plant', color: '#b45309' },
  { id: 'backwash', label: 'Backwash / MMF Backwashing', shortLabel: 'Backwash', category: 'plant', color: '#7c3aed' },
  { id: 'thermal_scanning', label: 'Thermal Scanning', shortLabel: 'Thermal Scan', category: 'plant', color: '#ea580c' },
  { id: 'water_level_monitoring', label: 'Water Level Monitoring (SWL/PWL)', shortLabel: 'SWL & PWL', category: 'plant', color: '#ca8a04' },
  { id: 'tank_cleaning', label: 'Tank Cleaning', shortLabel: 'Tank Clean', category: 'plant', color: '#0d9488' },
  { id: 'tank_opening', label: 'Tank Opening & Closing', shortLabel: 'Tank Valve', category: 'plant', color: '#0f766e' },
  { id: 'water_sampling', label: 'Water Sampling / Chlorination', shortLabel: 'Sampling', category: 'plant', color: '#0891b2' },
  { id: 'chlorine_refill', label: 'Chlorine Refilling (Dosing Drum)', shortLabel: 'Cl₂ Refill', category: 'plant', color: '#0e7490' },
  { id: 'well_pull_out', label: 'Deep Well Pump & Motor Pull-Out', shortLabel: 'Pull-Out', category: 'plant', color: '#db2777' },

  // Network & Distribution
  { id: 'leak_repair', label: 'Leak Repair', shortLabel: 'Leak Repair', category: 'network', color: '#dc2626' },
  { id: 'leak_detection', label: 'Leak Detection', shortLabel: 'Leak Detect', category: 'network', color: '#ea580c' },
  { id: 'low_pressure', label: 'Low Pressure Complaint', shortLabel: 'Low Press', category: 'network', color: '#0369a1' },
  { id: 'no_water_supply', label: 'No Water Supply Complaint', shortLabel: 'No Water', category: 'network', color: '#b91c1c' },
  { id: 'valve_replacement', label: 'Valve Replacement', shortLabel: 'Valve Repl', category: 'network', color: '#0f766e' },
  { id: 'flushing', label: 'Line Flushing', shortLabel: 'Flushing', category: 'network', color: '#0284c7' },
  { id: 'hydro_testing', label: 'Hydro Testing', shortLabel: 'Hydro Test', category: 'network', color: '#4f46e5' },
  { id: 'tankering', label: 'Water Hauling', shortLabel: 'Hauling', category: 'network', color: '#7c3aed' },

  // Customer & Metering
  { id: 'meter_inst', label: 'Meter Installation', shortLabel: 'Meter Inst', category: 'metering', color: '#16a34a' },
  { id: 'meter_replacement', label: 'Meter Replacement', shortLabel: 'Meter Repl', category: 'metering', color: '#15803d' },
  { id: 'meter_relocation', label: 'Meter Relocation', shortLabel: 'Meter Reloc', category: 'metering', color: '#15803d' },
  { id: 'meter_test', label: 'Meter Test', shortLabel: 'Meter Test', category: 'metering', color: '#9333ea' },
  { id: 'meter_check_bulk', label: 'Meter Checking (Bulk)', shortLabel: 'Bulk Meter', category: 'metering', color: '#6d28d9' },
  { id: 'meter_check_indiv', label: 'Meter Checking (Individual)', shortLabel: 'Indiv Meter', category: 'metering', color: '#7e22ce' },
  { id: 'reconnection', label: 'Reconnection', shortLabel: 'Reconnect', category: 'metering', color: '#059669' },

  // Grounds, Fleet & General
  { id: 'vehicle_fueling', label: 'Vehicle Refueling', shortLabel: 'Vehicle Fuel', category: 'grounds', color: '#0f766e' },
  { id: 'garbage_collection', label: 'Garbage Collection', shortLabel: 'Garbage', category: 'grounds', color: '#475569' },
  { id: 'plant_watering', label: 'Plant Watering', shortLabel: 'Grounds', category: 'grounds', color: '#65a30d' },
];

export const ACTIVITY_BY_ID: Record<string, ActivityTypeDef> = Object.fromEntries(
  ACTIVITY_TYPES.map((a) => [a.id, a]),
);

export const ACTIVITY_TYPE_MAP: Record<string, string> = Object.fromEntries(
  ACTIVITY_TYPES.map((a) => [a.id, a.label]),
);

const PM_CODE_TO_ACTIVITY: Record<string, string> = {
  FLUSH: 'flushing',
  TANK: 'tank_cleaning',
  PULL: 'well_pull_out',
  THERM: 'thermal_scanning',
  LEVEL: 'water_level_monitoring',
  BACKWASH: 'backwash',
  MMF: 'backwash',
  GENSET: 'genset_monitoring',
  PUMP: 'pump_monitoring',
  CHLOR: 'water_sampling',
  CHLREF: 'chlorine_refill',
  SAMPLING: 'water_sampling',
  LEAK: 'leak_repair',
  HYDRO: 'hydro_testing',
};

// "Chlorine refill", "Refill hypochlorite", "Dosing drum"... but not plain "Chlorination" or "Chlorine sampling".
const CHLORINE_REFILL_PATTERN =
  /(chlorin|hypochlor|\bcl2\b).*(re-?fill|replenish|drum)|(re-?fill|replenish).*(chlorin|hypochlor|\bcl2\b)|dosing\s*(drum|tank)/;

/**
 * Reconciles a PM task (its preset/custom `activity_type`, `title`, and optional `pm_activity_types` label)
 * to the canonical `ACTIVITY_TYPES` id for daily field logging.
 */
export function resolveActivityTypeFromPm(
  pm: { activity_type?: string | null; title?: string | null },
  pmActivityTypes?: Array<{ code: string; label: string; short_label?: string }>,
): string {
  const rawCode = (pm.activity_type ?? '').trim();
  const upperCode = rawCode.toUpperCase();

  if (rawCode && ACTIVITY_BY_ID[rawCode]) return rawCode;

  const customMeta = pmActivityTypes?.find((a) => a.code === rawCode || a.code.toUpperCase() === upperCode);
  const combined = `${pm.title ?? ''} ${customMeta?.label ?? ''} ${customMeta?.short_label ?? ''} ${rawCode}`.toLowerCase();

  // Checked before the code map: a refill task filed under the CHLOR code is not a water sampling task.
  if (CHLORINE_REFILL_PATTERN.test(combined)) return 'chlorine_refill';
  if (upperCode && PM_CODE_TO_ACTIVITY[upperCode]) return PM_CODE_TO_ACTIVITY[upperCode];

  if (/mmf|backwash/.test(combined)) return 'backwash';
  if (/flush/.test(combined)) return 'flushing';
  if (/tank.*clean|clean.*tank/.test(combined)) return 'tank_cleaning';
  if (/tank.*(open|clos|valve)/.test(combined)) return 'tank_opening';
  if (/pull[-_\s]?out|well\s*pull/.test(combined)) return 'well_pull_out';
  if (/thermal|thermograph/.test(combined)) return 'thermal_scanning';
  if (/water\s*level|swl|pwl/.test(combined)) return 'water_level_monitoring';
  if (/genset.*dist|fuel.*dist/.test(combined)) return 'genset_fuel_distribution';
  if (/genset.*purch|fuel.*purch/.test(combined)) return 'genset_fuel_purchase';
  if (/genset.*refill|refill.*genset/.test(combined)) return 'genset_fuel_refill';
  if (/vehicle.*fuel|refuel.*vehicle/.test(combined)) return 'vehicle_fueling';
  if (/genset|generator/.test(combined)) return 'genset_monitoring';
  if (/chlorin|sampl|water\s*qual/.test(combined)) return 'water_sampling';
  if (/hydro/.test(combined)) return 'hydro_testing';
  if (/leak.*detect/.test(combined)) return 'leak_detection';
  if (/leak/.test(combined)) return 'leak_repair';
  if (/low\s*press/.test(combined)) return 'low_pressure';
  if (/no\s*water/.test(combined)) return 'no_water_supply';
  if (/valve.*repl|repl.*valve/.test(combined)) return 'valve_replacement';
  if (/haul|tanker/.test(combined)) return 'tankering';
  if (/meter.*test/.test(combined)) return 'meter_test';
  if (/meter.*reloc|reloc.*meter/.test(combined)) return 'meter_relocation';
  if (/meter.*repl/.test(combined)) return 'meter_replacement';
  if (/meter.*inst/.test(combined)) return 'meter_inst';
  if (/meter.*bulk/.test(combined)) return 'meter_check_bulk';
  if (/meter/.test(combined)) return 'meter_check_indiv';
  if (/reconnect/.test(combined)) return 'reconnection';
  if (/garbage/.test(combined)) return 'garbage_collection';
  if (/plant\s*water|ground/.test(combined)) return 'plant_watering';

  return 'pump_monitoring';
}

export type MeterTestVerdict = 'Passed' | 'Fast Moving' | 'Slow Moving';
export type MeterTestRecommendation = 'Retain' | 'Replace';

export interface MeterTestCalculation {
  err1: number | null;
  err2: number | null;
  err3: number | null;
  avgErr: number | null;
  verdict: MeterTestVerdict | null;
  recommendation: MeterTestRecommendation | null;
}

/**
 * Computes 3-trial volumetric meter test errors (default reference volume 10 L = 0.01 m³).
 * Threshold: within ±5% is Passed/Retain; > +5% is Fast Moving/Replace; < -5% is Slow Moving/Replace.
 */
export function computeMeterTestResult(
  initial: number | null | undefined,
  r1: number | null | undefined,
  r2: number | null | undefined,
  r3: number | null | undefined,
  refVolCubicMeters = 0.01,
): MeterTestCalculation {
  const validNum = (n: number | null | undefined): n is number =>
    typeof n === 'number' && Number.isFinite(n);

  if (refVolCubicMeters <= 0) {
    return { err1: null, err2: null, err3: null, avgErr: null, verdict: null, recommendation: null };
  }

  let validCount = 0;
  let totalRegistered = 0;

  const err1 =
    validNum(initial) && validNum(r1)
      ? (((r1 - initial) / refVolCubicMeters) - 1) * 100
      : null;
  if (err1 !== null && validNum(initial) && validNum(r1)) {
    validCount += 1;
    totalRegistered += r1 - initial;
  }

  const err2 =
    validNum(r1) && validNum(r2)
      ? (((r2 - r1) / refVolCubicMeters) - 1) * 100
      : null;
  if (err2 !== null && validNum(r1) && validNum(r2)) {
    validCount += 1;
    totalRegistered += r2 - r1;
  }

  const err3 =
    validNum(r2) && validNum(r3)
      ? (((r3 - r2) / refVolCubicMeters) - 1) * 100
      : null;
  if (err3 !== null && validNum(r2) && validNum(r3)) {
    validCount += 1;
    totalRegistered += r3 - r2;
  }

  const avgErr =
    validCount > 0
      ? ((totalRegistered - refVolCubicMeters * validCount) / (refVolCubicMeters * validCount)) * 100
      : null;

  const round2 = (v: number | null) => {
    if (v === null) return null;
    const r = Math.round(v * 100) / 100;
    return r === 0 ? 0 : r;
  };
  const verdict: MeterTestVerdict | null =
    avgErr === null
      ? null
      : Math.abs(avgErr) > 5
        ? avgErr > 5
          ? 'Fast Moving'
          : 'Slow Moving'
        : 'Passed';
  const recommendation: MeterTestRecommendation | null =
    avgErr === null ? null : Math.abs(avgErr) > 5 ? 'Replace' : 'Retain';

  return {
    err1: round2(err1),
    err2: round2(err2),
    err3: round2(err3),
    avgErr: round2(avgErr),
    verdict,
    recommendation,
  };
}

export interface ParsedAccountNumber {
  projectCode: string;
  phaseCode: string;
  block: string;
  lot: string;
  blockLotFormatted: string;
}

/**
 * Parses a 12-character utility account number (PPP-PPP-BBB-LLL or 12 contiguous chars)
 * into project, phase, block, and lot components.
 */
export function parse12DigitAccount(acct: string): ParsedAccountNumber | null {
  const clean = acct.replace(/[\s-]+/g, '').trim();
  if (clean.length !== 12) return null;
  const projectCode = clean.slice(0, 3);
  const phaseCode = clean.slice(3, 6);
  const block = clean.slice(6, 9);
  const lot = clean.slice(9, 12);
  return {
    projectCode,
    phaseCode,
    block,
    lot,
    blockLotFormatted: `Block ${block} Lot ${lot}`,
  };
}

export type DailyActivityRow = {
  id: string;
  organization_id: string;
  activity_date: string;
  logged_by: string | null;
  lead_operator_id: string | null;
  crew_operator_ids: string[];
  shift_type_id: string | null;
  area_code_id: string | null;
  site_or_well: string | null;
  block_lot: string | null;
  activity_type: string;
  pm_task_id: string | null;
  job_order_id?: string | null;
  status: 'draft' | 'submitted' | 'verified' | 'flagged';
  started_at: string | null;
  completed_at: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  notes: string | null;
  details: Record<string, unknown>;
  photo_urls: string[];
  photo_storage_paths: string[];
  photos_expires_at: string | null;
  photos_purged_at: string | null;
  signature_data?: string | null;
  verified_by: string | null;
  verified_at: string | null;
  review_note: string | null;
  is_sample?: boolean;
  sample_expires_at?: string | null;
  created_at: string;
  updated_at: string;
};

/** Whether a user can edit an activity row (blocked once verified, including for admins). */
export function canEditActivity(
  act: Pick<DailyActivityRow, 'logged_by' | 'status'>,
  userId: string | null | undefined,
  isAdmin: boolean,
): boolean {
  return (isAdmin || (Boolean(userId) && act.logged_by === userId)) && act.status !== 'verified';
}

/**
 * Whether a user can delete an activity row.
 * Mirrors RLS `daily_activities delete` policy: admins can delete any log; creators can delete
 * their own sample logs or unreviewed logs (not verified, not flagged, verified_at IS NULL).
 */
export function canDeleteActivity(
  act: Pick<DailyActivityRow, 'logged_by' | 'status' | 'verified_at' | 'is_sample'>,
  userId: string | null | undefined,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  if (!userId || act.logged_by !== userId) return false;
  if (act.is_sample) return true;
  return act.status !== 'verified' && act.status !== 'flagged' && !act.verified_at;
}

export type JobOrderRow = {
  id: string;
  organization_id: string;
  jo_number: string;
  title: string;
  activity_type: string | null;
  priority: 'low' | 'medium' | 'high';
  area_code_id: string | null;
  site_or_well: string | null;
  block_lot: string | null;
  account_number: string | null;
  account_name: string | null;
  contact_number: string | null;
  description: string | null;
  assigned_operator_ids: string[];
  deadline: string | null;
  estimated_hours: number | null;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  tat_justification: string | null;
  created_by: string | null;
  completed_at: string | null;
  is_sample?: boolean;
  sample_expires_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type ShiftHandoverRow = {
  id: string;
  organization_id: string;
  handover_date: string;
  shift_type_id: string | null;
  area_code_id: string | null;
  outgoing_operator_id: string | null;
  incoming_operator_id: string | null;
  plant_status: 'normal' | 'watch' | 'critical';
  summary: string;
  pending_items: string | null;
  chemical_fuel_notes: string | null;
  created_by: string | null;
  is_sample?: boolean;
  sample_expires_at?: string | null;
  created_at: string;
};

export type LinkedPmTask = {
  id: string; title: string; activity_type: string; locations?: string[];
  asset?: string | null; assigned_operator_ids?: string[];
};

export type LinkedJobOrder = {
  id: string; jo_number: string; title: string; activity_type?: string | null;
  area_code_id?: string | null; site_or_well?: string | null; block_lot?: string | null;
  account_number?: string | null; account_name?: string | null;
  assigned_operator_ids?: string[]; deadline?: string | null; estimated_hours?: number | null;
};
