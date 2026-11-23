const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * All `daily_activities` columns used in list/detail views EXCEPT `signature_data`
 * (base64 PNG signatures are loaded lazily only when printing a Meter Test Certificate).
 */
export const DAILY_ACTIVITY_LIST_COLUMNS =
  'id, organization_id, activity_date, logged_by, lead_operator_id, crew_operator_ids, shift_type_id, area_code_id, site_or_well, block_lot, activity_type, pm_task_id, job_order_id, status, started_at, completed_at, gps_lat, gps_lng, notes, details, photo_urls, photo_storage_paths, photos_expires_at, photos_purged_at, verified_by, verified_at, review_note, created_at, updated_at';

/** Minimal `daily_activities` columns required to build BPEMS-F-002 accomplishment rows. */
export const DAILY_ACTIVITY_REPORT_COLUMNS =
  'id, activity_date, logged_by, lead_operator_id, crew_operator_ids, area_code_id, site_or_well, block_lot, activity_type, started_at, completed_at, notes, details';

/** Ultra-slim columns needed for 7/30/90-day KPI aggregations (excludes details JSONB, photos, notes, signatures). */
export const DAILY_ACTIVITY_KPI_COLUMNS =
  'id, activity_date, activity_type, status, lead_operator_id, crew_operator_ids, area_code_id';

/** Minimal columns needed for recent genset fuel telemetry rows in the KPI tab. */
export const DAILY_ACTIVITY_GENSET_COLUMNS =
  'id, activity_date, area_code_id, site_or_well, details';

export const JOB_ORDER_COLUMNS =
  'id, organization_id, jo_number, title, activity_type, priority, area_code_id, site_or_well, block_lot, account_number, account_name, contact_number, description, assigned_operator_ids, deadline, estimated_hours, status, tat_justification, created_by, completed_at, created_at, updated_at';

export const JOB_ORDER_KPI_COLUMNS =
  'id, assigned_operator_ids, status, created_at, completed_at, deadline';

export const SHIFT_HANDOVER_COLUMNS =
  'id, organization_id, handover_date, shift_type_id, area_code_id, outgoing_operator_id, incoming_operator_id, plant_status, summary, pending_items, chemical_fuel_notes, created_by, created_at';

export const PM_TASK_COLUMNS =
  'id, legacy_key, activity_type, title, locations, asset, assigned_operator_ids, completed_by_operator_ids, scheduled_date, status, completed_at, remarks';

export const PM_TASK_COLUMNS_LEGACY =
  'id, legacy_key, activity_type, title, locations, asset, assigned_operator_ids, scheduled_date, status, completed_at, remarks';

export const PM_TASK_KPI_COLUMNS =
  'id, scheduled_date, completed_at, status, assigned_operator_ids, completed_by_operator_ids';

export const PM_TASK_KPI_COLUMNS_LEGACY =
  'id, scheduled_date, completed_at, status, assigned_operator_ids';

export const PM_TASK_MONITOR_COLUMNS =
  'id, activity_type, title, scheduled_date, completed_at, status, assigned_operator_ids, completed_by_operator_ids';

export const PM_TASK_MONITOR_COLUMNS_LEGACY =
  'id, activity_type, title, scheduled_date, completed_at, status, assigned_operator_ids';

export const ACCOMPLISHMENT_REPORT_COLUMNS =
  'id, organization_id, report_date, shift_type_id, operator_id, submitted_by, assigned_head_id, prepared_by_name, prepared_by_title, checked_by_name, checked_by_title, status, entries, summary_notes, head_remarks, submitted_at, checked_by, checked_at, created_at, updated_at';

export const CHANGE_REQUEST_ITEM_COLUMNS =
  'id, request_id, organization_id, target_table, target_id, action, operator_id, schedule_date, shift_type_id, area_code_id, standby_type, pm_task_id, pm_title, pm_status, pm_assigned_operator_ids, leave_code, leave_start_date, leave_end_date, notes, original_state, status, rejection_reason, applied_at, created_at';

export const ORG_POSITION_COLUMNS =
  'id, organization_id, title, department_group, tier, parent_position_id, secondary_parent_id, holder_user_id, holder_operator_id, fallback_name, shift_badge, color_theme, is_vacant, is_active, sort_order';

/**
 * Builds a validated PostgREST `.or(...)` filter matching `daily_activities` rows owned by
 * the current user (logged by user, led by linked operator, or tagged as crew).
 * Returns `null` when neither identifier is a valid UUID.
 */
export function buildOwnActivityOrFilter(
  userId: string | null | undefined,
  operatorId: string | null | undefined,
): string | null {
  const parts: string[] = [];
  const uid = typeof userId === 'string' ? userId.trim() : '';
  const oid = typeof operatorId === 'string' ? operatorId.trim() : '';

  if (UUID_RE.test(uid)) {
    parts.push(`logged_by.eq.${uid}`);
  }
  if (UUID_RE.test(oid)) {
    parts.push(`lead_operator_id.eq.${oid}`, `crew_operator_ids.cs.{${oid}}`);
  }

  return parts.length > 0 ? parts.join(',') : null;
}
