import { getProfile, type ChangeRequestItem } from '@/lib/profile';
import { manilaToday } from '@/lib/date';
import { CHANGE_REQUEST_ITEM_COLUMNS } from '@/lib/query-columns';
import Roster from '@/components/Roster';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const { sb, user, role, orgId, operatorId, name, canEdit, canPropose } = await getProfile();
  const today = manilaToday();
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : today.slice(0, 7);
  const [y, mo] = month.split('-').map(Number);
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;
  const shouldLoadDraft = Boolean((canPropose || role === 'manager') && user);

  const [ops, shifts, areas, rows, standby, pmTasks, pendingReqItems, holidaysRes, draftReqRes] = await Promise.all([
    sb.from('operators').select('id, full_name, position').eq('is_active', true).order('sort_order'),
    sb.from('shift_types').select('id, code, description, duration_hours, background_color, text_color, is_off').order('code'),
    sb.from('area_codes').select('id, code, name, category, background_color, text_color').order('code'),
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
      .from('pm_tasks')
      .select('scheduled_date, assigned_operator_ids, status, title')
      .gte('scheduled_date', first)
      .lte('scheduled_date', last),
    sb
      .from('change_request_items')
      .select('id, request_id, target_table, action, operator_id, schedule_date, shift_type_id, area_code_id, standby_type, status, original_state')
      .gte('schedule_date', first)
      .lte('schedule_date', last)
      .in('status', ['pending', 'conflict']),
    sb
      .from('holidays')
      .select('holiday_date, name, holiday_type')
      .gte('holiday_date', first)
      .lte('holiday_date', last),
    shouldLoadDraft && user
      ? sb
          .from('change_requests')
          .select('id')
          .eq('requester_id', user.id)
          .eq('status', 'draft')
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // Load draft items if this user is a department head (including when an edit window opened mid-draft)
  let draftItems: ChangeRequestItem[] = [];
  let initialDraftRequestId: string | null = null;
  if (draftReqRes.data?.id) {
    initialDraftRequestId = draftReqRes.data.id;
    const { data: items } = await sb
      .from('change_request_items')
      .select(CHANGE_REQUEST_ITEM_COLUMNS)
      .eq('request_id', draftReqRes.data.id);
    draftItems = (items ?? []) as ChangeRequestItem[];
  }

  const errors = [ops.error, shifts.error, areas.error, rows.error, standby.error, pmTasks.error]
    .filter(Boolean)
    .map((e) => e!.message);

  return (
    <Roster
      key={month}
      month={month}
      today={today}
      operators={ops.data ?? []}
      shifts={shifts.data ?? []}
      areas={areas.data ?? []}
      rows={rows.data ?? []}
      standby={standby.data ?? []}
      pmTasks={pmTasks.data ?? []}
      holidays={holidaysRes.error ? [] : (holidaysRes.data ?? [])}
      orgId={orgId}
      operatorId={operatorId}
      role={role}
      userName={name}
      canEdit={canEdit}
      canPropose={canPropose}
      userId={user?.id}
      pendingItems={pendingReqItems.data ?? []}
      initialDraftRequestId={initialDraftRequestId}
      initialDraftItems={draftItems}
      initialError={errors[0] ?? ''}
    />
  );
}
