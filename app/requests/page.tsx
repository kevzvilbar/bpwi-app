import { redirect } from 'next/navigation';
import { getProfile, fetchAll } from '@/lib/profile';
import ChangeRequests from '@/components/ChangeRequests';
import type { ChangeRequest, ChangeRequestItem } from '@/lib/profile';

export const dynamic = 'force-dynamic';

export default async function RequestsPage() {
  const profile = await getProfile();
  const { sb, user, isActive, canApprove, isManager, orgId } = profile;

  if (!user || !isActive) {
    redirect('/login');
  }

  // Only approvers and department heads (or schedulers/admins) can view this page
  if (!canApprove && !isManager && profile.role !== 'scheduler') {
    redirect('/');
  }

  // Load operators, shifts, areas for displaying labels
  const [opsRes, shiftsRes, areasRes] = await Promise.all([
    sb.from('operators').select('id, full_name, position').eq('is_active', true).order('sort_order'),
    sb.from('shift_types').select('id, code, description, background_color, text_color').order('code'),
    sb.from('area_codes').select('id, code, name, background_color, text_color').order('code'),
  ]);

  // Load change requests: approvers see all in org; managers see own
  let query = sb
    .from('change_requests')
    .select(`
      id,
      organization_id,
      requester_id,
      title,
      note,
      status,
      submitted_at,
      reviewed_at,
      reviewed_by,
      review_notes,
      created_at,
      updated_at
    `)
    .order('created_at', { ascending: false });

  if (!canApprove && isManager) {
    query = query.eq('requester_id', user.id);
  }

  const { data: rawRequests, error: reqErr } = await query;

  if (reqErr) {
    console.error('Error fetching change requests:', reqErr);
  }

  // Load user profiles to get requester and reviewer names
  const { data: userProfiles } = await sb
    .from('user_profiles')
    .select('id, full_name, role');
  const userMap = new Map((userProfiles ?? []).map((u) => [u.id, u]));

  // Load all items for these requests
  const requestIds = (rawRequests ?? []).map((r) => r.id);
  let rawItems: ChangeRequestItem[] = [];

  if (requestIds.length > 0) {
    const { data: itemsData, error: itemsErr } = await sb
      .from('change_request_items')
      .select('*')
      .in('request_id', requestIds)
      .order('created_at', { ascending: true });

    if (itemsErr) {
      console.error('Error fetching change request items:', itemsErr);
    } else {
      rawItems = (itemsData ?? []) as ChangeRequestItem[];
    }
  }

  // Live conflict detection for pending items
  // If an item was submitted with original_state, compare against live table
  const pendingScheduleItems = rawItems.filter(
    (i) => i.target_table === 'schedule_assignments' && (i.status === 'pending' || i.status === 'conflict') && i.operator_id && i.schedule_date
  );

  if (pendingScheduleItems.length > 0) {
    const opIds = Array.from(new Set(pendingScheduleItems.map((i) => i.operator_id!)));
    const dates = Array.from(new Set(pendingScheduleItems.map((i) => i.schedule_date!)));

    const { data: liveRows } = await sb
      .from('schedule_assignments')
      .select('operator_id, schedule_date, shift_type_id, area_code_id')
      .in('operator_id', opIds)
      .in('schedule_date', dates);

    const liveMap = new Map(
      (liveRows ?? []).map((r) => [`${r.operator_id}:${r.schedule_date}`, r])
    );

    for (const item of pendingScheduleItems) {
      const key = `${item.operator_id}:${item.schedule_date}`;
      const live = liveMap.get(key);
      const origShift = item.original_state?.shift_type_id ?? null;
      const origArea = item.original_state?.area_code_id ?? null;
      const liveShift = live?.shift_type_id ?? null;
      const liveArea = live?.area_code_id ?? null;

      if (liveShift !== origShift || liveArea !== origArea) {
        item.status = 'conflict';
      }
    }
  }

  // Group items by request_id
  const itemsByReq = new Map<string, ChangeRequestItem[]>();
  for (const item of rawItems) {
    const list = itemsByReq.get(item.request_id) ?? [];
    list.push(item);
    itemsByReq.set(item.request_id, list);
  }

  const requests: ChangeRequest[] = (rawRequests ?? []).map((r) => {
    const reqUser = userMap.get(r.requester_id);
    const revUser = r.reviewed_by ? userMap.get(r.reviewed_by) : null;
    const items = itemsByReq.get(r.id) ?? [];

    return {
      ...r,
      requester_name: reqUser?.full_name ?? 'Department Head',
      requester_role: reqUser?.role ?? 'manager',
      reviewed_by_name: revUser?.full_name ?? null,
      items,
      items_count: items.length,
    } as ChangeRequest;
  });

  return (
    <ChangeRequests
      requests={requests}
      operators={opsRes.data ?? []}
      shifts={shiftsRes.data ?? []}
      areas={areasRes.data ?? []}
      canApprove={canApprove}
      isManager={isManager}
      currentUserId={user.id}
    />
  );
}
