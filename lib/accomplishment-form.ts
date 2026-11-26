import { describeChlorineRefill } from './chlorine-refill.ts';
import type { DailyActivityRow } from '@/lib/activity-types';

export interface FormColumnDef {
  id: string;
  label: string;
  group: 'technical' | 'project';
}

export const TECHNICAL_COLUMNS: FormColumnDef[] = [
  { id: 'leak_repair', label: 'LEAK REPAIR', group: 'technical' },
  { id: 'leak_detection', label: 'LEAK DETECTION', group: 'technical' },
  { id: 'pm_pull_out', label: 'P&M PULL-OUT', group: 'technical' },
  { id: 'tank_cleaning', label: 'TANK CLEANING', group: 'technical' },
  { id: 'flushing', label: 'FLUSHING', group: 'technical' },
  { id: 'meter_installation', label: 'METER INSTALLATION', group: 'technical' },
  { id: 'pm_testing', label: 'P&M TESTING', group: 'technical' },
];

export const PROJECT_COLUMNS: FormColumnDef[] = [
  { id: 'disc', label: 'DISC', group: 'project' },
  { id: 'rec', label: 'REC', group: 'project' },
  { id: 'ps_mon', label: 'PS MON', group: 'project' },
  { id: 'wq_insp', label: 'WQ INSP', group: 'project' },
  { id: 'nw_insp', label: 'NW INSP', group: 'project' },
  { id: 'lp_insp', label: 'LP INSP', group: 'project' },
  { id: 'meter_test', label: 'METER TEST', group: 'project' },
];

export const ALL_FORM_COLUMNS: FormColumnDef[] = [...TECHNICAL_COLUMNS, ...PROJECT_COLUMNS];

export const FORM_CODE = 'BPEMS-F-002';
export const FORM_REV = 'Rev. 0 07/2024';
export const FORM_TITLE = 'TECHNICAL AND PROJECT ACCOMPLISHMENT REPORT';
export const FORM_FOOTER_NOTE =
  'NOTE FOR REMARKS: 1. FOR LR, NOTE IF MAINLINE (ML), SERVICE PIPE (SP), OR MSA; 2. FOR LD, NOTE ADDRESS OF LEAK/S FOUND, INITIAL ASSESSMENT IF ML, SP OR MSA; 3. FOR PULL-OUT, NOTE READING OF FM AND PG, AND PUMP AND MOTOR SPECS (NEW AND REPLACED); 4. FOR TC AND FLUSHING, NOTE READING OF FM AND PG.';

export interface AccomplishmentEntry {
  id: string;
  source_activity_id?: string | null;
  column_id: string | null; // one of ALL_FORM_COLUMNS ids, or null when using others_specify
  others_specify: string;
  location_project: string;
  location_ph: string;
  location_blk: string;
  location_lot: string;
  time_started: string; // e.g. "3:10 PM" or "15:10"
  time_finished: string;
  remarks: string;
}

export interface AccomplishmentReportRow {
  id: string;
  organization_id: string;
  report_date: string;
  shift_type_id: string | null;
  operator_id: string | null;
  submitted_by: string;
  assigned_head_id: string | null;
  prepared_by_name: string;
  prepared_by_title: string;
  checked_by_name: string | null;
  checked_by_title: string | null;
  status: 'draft' | 'submitted' | 'checked' | 'returned';
  entries: AccomplishmentEntry[];
  summary_notes: string | null;
  head_remarks: string | null;
  submitted_at: string | null;
  checked_by: string | null;
  checked_at: string | null;
  is_sample?: boolean;
  sample_expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Maps an internal `daily_activities.activity_type` to the exact BPEMS-F-002
 * column checkbox or `OTHERS (SPECIFY)` code (e.g. `W.M`).
 */
export function mapActivityToFormColumn(activityType: string): {
  column_id: string | null;
  others_specify: string;
} {
  switch (activityType) {
    case 'leak_repair':
      return { column_id: 'leak_repair', others_specify: '' };
    case 'leak_detection':
      return { column_id: 'leak_detection', others_specify: '' };
    case 'well_pull_out':
      return { column_id: 'pm_pull_out', others_specify: '' };
    case 'tank_cleaning':
      return { column_id: 'tank_cleaning', others_specify: '' };
    case 'flushing':
      return { column_id: 'flushing', others_specify: '' };
    case 'meter_inst':
    case 'meter_replacement':
      return { column_id: 'meter_installation', others_specify: '' };
    case 'meter_relocation':
      return { column_id: null, others_specify: 'METER RELOC' };
    case 'valve_replacement':
      return { column_id: null, others_specify: 'VALVE REPL' };
    case 'hydro_testing':
      return { column_id: 'pm_testing', others_specify: '' };
    case 'reconnection':
      return { column_id: 'rec', others_specify: '' };
    case 'pump_monitoring':
      return { column_id: 'ps_mon', others_specify: '' };
    case 'chlorine_refill':
      return { column_id: null, others_specify: 'CHLORINE' };
    case 'water_sampling':
      return { column_id: 'wq_insp', others_specify: '' };
    case 'low_pressure':
      return { column_id: 'lp_insp', others_specify: '' };
    case 'no_water_supply':
      return { column_id: 'nw_insp', others_specify: '' };
    case 'meter_test':
    case 'meter_check_bulk':
    case 'meter_check_indiv':
      return { column_id: 'meter_test', others_specify: '' };
    case 'water_level_monitoring':
      return { column_id: null, others_specify: 'W.M' };
    case 'backwash':
      return { column_id: null, others_specify: 'BACKWASH' };
    case 'genset_monitoring':
      return { column_id: null, others_specify: 'GENSET' };
    case 'genset_fuel_refill':
      return { column_id: null, others_specify: 'GENSET REFILL' };
    case 'genset_fuel_purchase':
      return { column_id: null, others_specify: 'FUEL PURCH' };
    case 'genset_fuel_distribution':
      return { column_id: null, others_specify: 'FUEL DIST' };
    case 'vehicle_fueling':
      return { column_id: null, others_specify: 'VEHICLE FUEL' };
    case 'thermal_scanning':
      return { column_id: null, others_specify: 'THERMAL' };
    case 'tank_opening':
      return { column_id: null, others_specify: 'VALVE' };
    case 'tankering':
      return { column_id: null, others_specify: 'HAULING' };
    case 'garbage_collection':
    case 'plant_watering':
      return { column_id: null, others_specify: 'GROUNDS' };
    default:
      return { column_id: null, others_specify: 'W.M' };
  }
}

/**
 * Formats an ISO timestamp or `HH:MM` string into Manila 12-hour time (`h:mm AM/PM`).
 */
export function formatManilaTime12(isoOrTime: string | null | undefined): string {
  if (!isoOrTime) return '';
  const trimmed = isoOrTime.trim();
  if (/^\d{1,2}:\d{2}(\s*[AP]M)$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [hh, mm] = trimmed.split(':').map(Number);
    const period = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 || 12;
    return `${h12}:${String(mm).padStart(2, '0')} ${period}`;
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return trimmed;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/**
 * Extracts PH / BLK / LOT from a free-text `block_lot` string like `"Ph 2 Blk 4 Lot 12"` or `"B4 L12"`.
 */
export function parseLocationParts(blockLot: string | null | undefined): {
  ph: string;
  blk: string;
  lot: string;
} {
  const raw = (blockLot ?? '').trim();
  if (!raw) return { ph: '', blk: '', lot: '' };
  const phMatch = raw.match(/\b(?:ph(?:ase)?\.?\s*)([a-z0-9-]+)/i);
  const blkMatch = raw.match(/\b(?:block|blk|b(?=\s*\d))\.?\s*([a-z0-9-]+)/i);
  const lotMatch = raw.match(/\b(?:lot|l(?=\s*\d))\.?\s*([a-z0-9-]+)/i);
  return {
    ph: phMatch?.[1]?.toUpperCase() ?? '',
    blk: blkMatch?.[1]?.toUpperCase() ?? '',
    lot: lotMatch?.[1]?.toUpperCase() ?? '',
  };
}

/**
 * Builds a concise REMARKS line from a `DailyActivityRow`'s site, readings (`details`), and `notes`.
 */
export function buildActivityRemarks(a: DailyActivityRow): string {
  const parts: string[] = [];
  if (a.site_or_well) parts.push(a.site_or_well);
  const d = (a.details ?? {}) as Record<string, unknown>;
  const readings: string[] = [];
  if (d.pressure_psi != null && d.pressure_psi !== '') readings.push(`PG: ${d.pressure_psi} PSI`);
  if (d.flow_lps != null && d.flow_lps !== '') readings.push(`Flow: ${d.flow_lps} LPS`);
  if (d.totalizer_m3 != null && d.totalizer_m3 !== '') readings.push(`FM: ${d.totalizer_m3} m³`);
  if (d.chlorine_mg_l != null && d.chlorine_mg_l !== '') readings.push(`Cl2: ${d.chlorine_mg_l} mg/L`);
  if (a.activity_type === 'chlorine_refill') {
    readings.push(...describeChlorineRefill(d).map((row) => `${row.label}: ${row.value}`));
  }
  if (d.pipe_scope) readings.push(String(d.pipe_scope));
  if (d.pipe_size) readings.push(`Ø${d.pipe_size}`);
  if (d.fm_before != null && d.fm_before !== '') readings.push(`FM Before: ${d.fm_before}`);
  if (d.fm_after != null && d.fm_after !== '') readings.push(`FM After: ${d.fm_after}`);
  if (d.verdict) readings.push(`${d.verdict}${d.recommendation ? ` (${d.recommendation})` : ''}`);
  if (readings.length) parts.push(readings.join(' · '));
  if (a.notes) parts.push(a.notes);
  return parts.join(' — ');
}

/**
 * Converts a `DailyActivityRow` into an editable `AccomplishmentEntry` matching BPEMS-F-002.
 */
export function activityToAccomplishmentEntry(
  a: DailyActivityRow,
  areaLabel?: string,
): AccomplishmentEntry {
  const mapped = mapActivityToFormColumn(a.activity_type);
  const loc = parseLocationParts(a.block_lot);
  return {
    id: `act-${a.id}`,
    source_activity_id: a.id,
    column_id: mapped.column_id,
    others_specify: mapped.others_specify,
    location_project: a.site_or_well || areaLabel || '',
    location_ph: loc.ph,
    location_blk: loc.blk,
    location_lot: loc.lot,
    time_started: formatManilaTime12(a.started_at),
    time_finished: formatManilaTime12(a.completed_at ?? a.started_at),
    remarks: buildActivityRemarks(a),
  };
}
