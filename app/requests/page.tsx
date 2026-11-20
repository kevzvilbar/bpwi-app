import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getProfile, fetchAll } from '@/lib/profile';
import ChangeRequests from '@/components/ChangeRequests';
import type { ChangeRequest, ChangeRequestItem } from '@/lib/profile';
import { cellKey, chunk, emptySnapshot, evaluateItem } from '@/lib/change-request-conflicts';

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

type RawRequest = {
  id: string;
  organization_id: string;
  requester_id: string;
  title: string | null;
  note: string | null;
  status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
};

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
    sb.from('shift_types').select('id, code, description, background_color, text_color, is_off').order('code'),
    sb.from('area_codes').select('id, code, name, category, background_color, text_color').order('code'),
  ]);

  // Load change requests (paged past PostgREST's 1000-row cap): approvers see all in org; managers see own
  const REQ_COLS =
    'id, organization_id, requester_id, title, note, status, submitted_at, reviewed_at, reviewed_by, review_notes, created_at, updated_at';
  const reqRes = await fetchAll<RawRequest>((from, to) => {
    let q = sb.from('change_requests').select(REQ_COLS).order('created_at', { ascending: false }).order('id');
    if (!canApprove && isManager) q = q.eq('requester_id', user.id);
    return q.range(from, to);
  });
  if (reqRes.error) console.error('Error fetching change requests:', reqRes.error);
  const rawRequests = reqRes.data;

  // Load user profiles to get requester and reviewer names
  const { data: userProfiles } = await sb.from('user_profiles').select('id, full_name, role');
  const userMap = new Map((userProfiles ?? []).map((u) => [u.id, u]));

  // Load all items, in request-id chunks so the query string stays short as history grows
  const requestIds = rawRequests.map((r) => r.id);
  const rawItems: ChangeRequestItem[] = [];
  const itemResults = await Promise.all(
    chunk(requestIds, 40).map((ids) =>
      fetchAll<ChangeRequestItem>((from, to) =>
        sb.from('change_request_items').select('*').in('request_id', ids).order('created_at', { ascending: true }).order('id').range(from, to),
      ),
    ),
  );
  for (const r of itemResults) {
    if (r.error) console.error('Error fetching change request items:', r.error);
    else rawItems.push(...r.data);
  }

  // Live conflict detection for open items (schedule, standby, PM, leave), same rules as the RPC.
  const openItems = rawItems.filter((i) => i.status === 'pending' || i.status === 'conflict');
  const snap = emptySnapshot();
  let liveCheckFailed = false;

  async function loadCells(
    table: 'schedule_assignments' | 'standby_assignments',
    columns: string,
    onRow: (r: Record<string, string | null>) => void,
  ) {
    const items = openItems.filter((i) => i.target_table === table && i.operator_id && i.schedule_date);
    if (items.length === 0) return;
    const opIds = Array.from(new Set(items.map((i) => i.operator_id as string)));
    const dates = items.map((i) => i.schedule_date as string).sort();
    const [min, max] = [dates[0], dates[dates.length - 1]];
    const results = await Promise.all(
      chunk(opIds, 40).map((ids) =>
        fetchAll<Record<string, string | null>>(
          (from, to) =>
            sb.from(table).select(columns).in('operator_id', ids).gte('schedule_date', min).lte('schedule_date', max).order('schedule_date').order('operator_id').range(from, to) as unknown as Page<Record<string, string | null>>,
        ),
      ),
    );
    for (const r of results) {
      if (r.error) liveCheckFailed = true;
      else r.data.forEach(onRow);
    }
  }

  async function loadById<T extends { id: string }>(table: 'pm_tasks' | 'leave_records', columns: string, ids: string[], onRow: (r: T) => void) {
    const uniq = Array.from(new Set(ids));
    if (uniq.length === 0) return;
    const results = await Promise.all(
      chunk(uniq, 60).map((c) => fetchAll<T>((from, to) => sb.from(table).select(columns).in('id', c).order('id').range(from, to) as unknown as Page<T>)),
    );
    for (const r of results) {
      if (r.error) liveCheckFailed = true;
      else r.data.forEach(onRow);
    }
  }

  await Promise.all([
    loadCells('schedule_assignments', 'operator_id, schedule_date, shift_type_id, area_code_id', (r) =>
      snap.schedule.set(cellKey(r.operator_id, r.schedule_date), { shift_type_id: r.shift_type_id, area_code_id: r.area_code_id }),
    ),
    loadCells('standby_assignments', 'operator_id, schedule_date, standby_type', (r) =>
      snap.standby.set(cellKey(r.operator_id, r.schedule_date), { standby_type: r.standby_type }),
    ),
    loadById<{ id: string; title: string | null; status: string | null; scheduled_date: string | null; assigned_operator_ids: string[] | null }>(
      'pm_tasks',
      'id, title, status, scheduled_date, assigned_operator_ids',
      openItems.filter((i) => i.target_table === 'pm_tasks' && i.pm_task_id).map((i) => i.pm_task_id as string),
      (r) => snap.pm.set(r.id, r),
    ),
    loadById<{ id: string; leave_code: string | null; start_date: string | null; end_date: string | null }>(
      'leave_records',
      'id, leave_code, start_date, end_date',
      openItems.filter((i) => i.target_table === 'leave_records' && i.target_id).map((i) => i.target_id as string),
      (r) => snap.leave.set(r.id, r),
    ),
  ]);

  // If any live lookup failed, don't guess: leave statuses as stored (the server re-checks on approval anyway).
  if (!liveCheckFailed) {
    for (const item of openItems) {
      const res = evaluateItem(item, snap);
      if (res.conflict) {
        item.status = 'conflict';
        item.conflict_reason = res.reason;
        item.live_state = res.live;
      } else if (item.status === 'conflict' && item.target_table !== 'leave_records') {
        item.status = 'pending'; // conflict cleared since it was recorded (leave overlaps are server-only)
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

  const requests: ChangeRequest[] = rawRequests.map((r) => {
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
    <div style={{ display: 'grid', gap: 12 }}>
      {profile.isAdmin && (
        <div
          className="card"
          style={{
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            borderLeft: profile.pendingUsersCount > 0 ? '4px solid #f59e0b' : '4px solid var(--border)',
          }}
        >
          <span style={{ fontSize: 13 }}>
            {profile.pendingUsersCount > 0 ? (
              <>
                <strong>{profile.pendingUsersCount} new user sign-up{profile.pendingUsersCount === 1 ? '' : 's'}</strong> waiting for account approval &amp; role assignment.
              </>
            ) : (
              <>Looking for new user sign-ups or role assignments? Manage them under <strong>Users &amp; roles</strong>.</>
            )}
          </span>
          <Link href="/operators" className="btn btn-primary" style={{ textDecoration: 'none', fontSize: 12.5 }}>
            Open Users &amp; Roles →
          </Link>
        </div>
      )}
      <ChangeRequests
        requests={requests}
        operators={opsRes.data ?? []}
        shifts={shiftsRes.data ?? []}
        areas={areasRes.data ?? []}
        canApprove={canApprove}
        isAdmin={profile.isAdmin}
        isManager={isManager}
        currentUserId={user.id}
        liveCheckFailed={liveCheckFailed}
      />
    </div>
  );
}
