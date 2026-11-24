import { getProfile } from '@/lib/profile';
import { manilaToday } from '@/lib/date';
import { PM_TASK_COLUMNS, PM_TASK_COLUMNS_LEGACY } from '@/lib/query-columns';
import { isMissingCompletedByColumnError } from '@/lib/pm-credit';
import { isMissingPmLocationsTableError, type PmLocationRow } from '@/lib/pm-locations';
import { isMissingGensetsTableError, type GensetRow } from '@/lib/gensets';
import PmPlanner from '@/components/PmPlanner';

export const dynamic = 'force-dynamic';

export default async function PmPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const { sb, orgId, operatorId, canEdit, isAdmin, isManager } = await getProfile();
  const today = manilaToday();
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : today.slice(0, 7);
  const [y, mo] = month.split('-').map(Number);

  // Include adjacent days visible in the 7-column calendar grid
  const firstOfMonth = new Date(Date.UTC(y, mo - 1, 1));
  const lastOfMonth = new Date(Date.UTC(y, mo, 0));
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - firstOfMonth.getUTCDay());
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - lastOfMonth.getUTCDay()));

  const first = gridStart.toISOString().slice(0, 10);
  const last = gridEnd.toISOString().slice(0, 10);

  const [tasksPrimary, activityTypes, ops, shifts, areas, asg, standby, holidaysRes, locationsRes, gensetsRes] = await Promise.all([
    sb.from('pm_tasks').select(PM_TASK_COLUMNS).gte('scheduled_date', first).lte('scheduled_date', last).order('scheduled_date'),
    sb.from('pm_activity_types').select('id, code, label, short_label, color, sort_order').order('sort_order').order('code'),
    sb.from('operators').select('id, full_name, phone_number').eq('is_active', true).order('sort_order'),
    sb.from('shift_types').select('id, is_off'),
    sb.from('area_codes').select('id, code, name, category, sub_sites'),
    sb
      .from('schedule_assignments')
      .select('operator_id, schedule_date, shift_type_id, area_code_id')
      .gte('schedule_date', first)
      .lte('schedule_date', last),
    sb
      .from('standby_assignments')
      .select('operator_id, schedule_date, standby_type')
      .gte('schedule_date', first)
      .lte('schedule_date', last),
    sb
      .from('holidays')
      .select('holiday_date, name, holiday_type')
      .gte('holiday_date', first)
      .lte('holiday_date', last),
    sb.from('pm_locations').select('id, name, sort_order').order('sort_order').order('name'),
    sb.from('gensets').select('id, control_no, brand_model, kva_rating, fuel_type, status, current_location, notes').order('control_no'),
  ]);

  const pmLocationsTableReady = !isMissingPmLocationsTableError(locationsRes.error);
  const savedLocations: PmLocationRow[] = locationsRes.error ? [] : (locationsRes.data ?? []);
  const gensetsTableReady = !isMissingGensetsTableError(gensetsRes.error);
  const gensets: GensetRow[] = gensetsRes.error ? [] : (gensetsRes.data ?? []);

  let tasksData = tasksPrimary.data ?? [];
  let tasksError = tasksPrimary.error;
  if (isMissingCompletedByColumnError(tasksPrimary.error)) {
    const legacyRes = await sb
      .from('pm_tasks')
      .select(PM_TASK_COLUMNS_LEGACY)
      .gte('scheduled_date', first)
      .lte('scheduled_date', last)
      .order('scheduled_date');
    tasksData = (legacyRes.data ?? []).map((t) => ({ ...t, completed_by_operator_ids: [] as string[] }));
    tasksError = legacyRes.error;
  }

  const error =
    tasksError?.message ||
    ops.error?.message ||
    shifts.error?.message ||
    areas.error?.message ||
    asg.error?.message ||
    standby.error?.message ||
    '';

  return (
    <PmPlanner
      key={month}
      month={month}
      today={today}
      tasks={tasksData}
      activityTypes={activityTypes.error ? [] : (activityTypes.data ?? [])}
      operators={ops.data ?? []}
      shifts={shifts.data ?? []}
      areas={areas.data ?? []}
      assignments={asg.data ?? []}
      standby={standby.data ?? []}
      holidays={holidaysRes.error ? [] : (holidaysRes.data ?? [])}
      savedLocations={savedLocations}
      pmLocationsTableReady={pmLocationsTableReady}
      gensets={gensets}
      gensetsTableReady={gensetsTableReady}
      orgId={orgId}
      operatorId={operatorId}
      canEdit={canEdit}
      canExportCsv={isAdmin || isManager}
      error={error}
    />
  );
}
