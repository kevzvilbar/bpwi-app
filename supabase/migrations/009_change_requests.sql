-- Change request queue & approvals (Step 2 of Department Heads).
--
-- Outside an admin-granted edit window, department heads edit in "Propose" mode:
-- edits are saved into change_requests and change_request_items instead of writing directly
-- to schedule tables. Admins and delegated approvers review the diffs and approve or reject them.
--
-- Core guarantees:
--  1. Atomic batch approval: approved changes apply in a single database transaction via stored procedure.
--  2. Conflict detection: each item stores original_state at proposal time. If a cell changed
--     in the live schedule before approval, it is flagged as a conflict.
--  3. Delegated approvers: anyone with can_approve = true or role = 'admin' (via is_approver()) can review.
--  4. Database-enforced RLS: department heads can only write to change_requests/items; they cannot
--     bypass the approval queue to write schedule rows directly.

-- 1. Change requests header table (batches submitted by department heads)
create table if not exists change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  requester_id uuid not null references user_profiles(id) on delete cascade,
  title text,
  note text,
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'partially_approved', 'rejected', 'cancelled')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users on delete set null,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists change_requests_org_status_idx on change_requests (organization_id, status);
create index if not exists change_requests_requester_idx on change_requests (requester_id, status);

-- 2. Change request line items (individual cell or record changes)
create table if not exists change_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references change_requests(id) on delete cascade,
  organization_id uuid not null references organizations on delete cascade,
  target_table text not null check (target_table in ('schedule_assignments', 'standby_assignments', 'pm_tasks', 'leave_records')),
  target_id uuid,
  action text not null default 'upsert' check (action in ('upsert', 'delete')),

  -- Schedule & Standby assignment attributes:
  operator_id uuid references operators(id) on delete cascade,
  schedule_date date,
  shift_type_id uuid references shift_types(id) on delete set null,
  area_code_id uuid references area_codes(id) on delete set null,
  standby_type text,

  -- PM task attributes:
  pm_task_id uuid references pm_tasks(id) on delete set null,
  pm_title text,
  pm_status text,
  pm_assigned_operator_ids uuid[],

  -- Leave record attributes:
  leave_code text,
  leave_start_date date,
  leave_end_date date,

  notes text,

  -- Snapshot of state when requested (for conflict detection) and proposed payload:
  original_state jsonb,
  payload jsonb not null default '{}'::jsonb,

  -- Item status:
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'conflict')),
  rejection_reason text,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists change_request_items_req_idx on change_request_items (request_id);
create index if not exists change_request_items_schedule_idx on change_request_items (organization_id, schedule_date);
create index if not exists change_request_items_op_date_idx on change_request_items (operator_id, schedule_date);

-- Realtime publication for live collaboration
alter publication supabase_realtime add table change_requests, change_request_items;

-- Audit trail triggers
drop trigger if exists audit_change_requests on change_requests;
create trigger audit_change_requests after insert or update or delete on change_requests
  for each row execute function log_audit();

drop trigger if exists audit_change_request_items on change_request_items;
create trigger audit_change_request_items after insert or update or delete on change_request_items
  for each row execute function log_audit();

-- 3. Row Level Security
alter table change_requests enable row level security;
alter table change_request_items enable row level security;

-- change_requests read: requester can see own; approvers can see all in org
drop policy if exists "change_requests read" on change_requests;
create policy "change_requests read" on change_requests
  for select using (
    organization_id = current_org() and (requester_id = auth.uid() or is_approver())
  );

-- change_requests insert: department heads and schedulers/admins
drop policy if exists "change_requests insert" on change_requests;
create policy "change_requests insert" on change_requests
  for insert with check (
    organization_id = current_org() and requester_id = auth.uid()
  );

-- change_requests update: requester can update draft/pending; approver can update status/review
drop policy if exists "change_requests update" on change_requests;
create policy "change_requests update" on change_requests
  for update using (
    organization_id = current_org() and (
      (requester_id = auth.uid() and status in ('draft', 'pending')) or
      is_approver()
    )
  ) with check (
    organization_id = current_org() and (
      (requester_id = auth.uid() and status in ('draft', 'pending', 'cancelled')) or
      is_approver()
    )
  );

-- change_requests delete: requester can delete draft
drop policy if exists "change_requests delete" on change_requests;
create policy "change_requests delete" on change_requests
  for delete using (
    organization_id = current_org() and (
      (requester_id = auth.uid() and status = 'draft') or
      current_role_name() = 'admin'
    )
  );

-- change_request_items read: anyone in org can read so the roster can show dashed pending cells
drop policy if exists "change_request_items read" on change_request_items;
create policy "change_request_items read" on change_request_items
  for select using (organization_id = current_org());

-- change_request_items write: requester can modify items in draft requests; approvers can update
drop policy if exists "change_request_items insert" on change_request_items;
create policy "change_request_items insert" on change_request_items
  for insert with check (
    organization_id = current_org() and exists (
      select 1 from change_requests r
      where r.id = request_id and r.requester_id = auth.uid() and r.status = 'draft'
    )
  );

drop policy if exists "change_request_items update" on change_request_items;
create policy "change_request_items update" on change_request_items
  for update using (
    organization_id = current_org() and (
      exists (
        select 1 from change_requests r
        where r.id = request_id and r.requester_id = auth.uid() and r.status = 'draft'
      ) or is_approver()
    )
  ) with check (
    organization_id = current_org()
  );

drop policy if exists "change_request_items delete" on change_request_items;
create policy "change_request_items delete" on change_request_items
  for delete using (
    organization_id = current_org() and (
      exists (
        select 1 from change_requests r
        where r.id = request_id and r.requester_id = auth.uid() and r.status = 'draft'
      ) or current_role_name() = 'admin'
    )
  );

-- 4. Stored Procedure: Submit change request
create or replace function submit_change_request(
  p_request_id uuid,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req change_requests%rowtype;
  v_item_count int;
begin
  select * into v_req from change_requests
  where id = p_request_id and organization_id = current_org();

  if not found then
    raise exception 'Change request not found';
  end if;

  if v_req.requester_id <> auth.uid() and current_role_name() <> 'admin' then
    raise exception 'Only the requester can submit this change request';
  end if;

  if v_req.status <> 'draft' then
    raise exception 'Only draft change requests can be submitted';
  end if;

  select count(*) into v_item_count from change_request_items where request_id = p_request_id;
  if v_item_count = 0 then
    raise exception 'Cannot submit an empty change request';
  end if;

  update change_requests
  set status = 'pending',
      submitted_at = now(),
      note = coalesce(p_note, note),
      updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'items_count', v_item_count,
    'status', 'pending'
  );
end;
$$;

-- 5. Stored Procedure: Approve change request (Atomic batch execution)
create or replace function approve_change_request(
  p_request_id uuid,
  p_item_ids uuid[] default null,          -- null means approve all pending items not in reject list
  p_reject_item_ids uuid[] default null,   -- optional items to reject within the batch
  p_review_notes text default null,
  p_force_conflicts boolean default false  -- if true, applies proposed change even if live cell changed
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req change_requests%rowtype;
  v_item change_request_items%rowtype;
  v_approved_count int := 0;
  v_rejected_count int := 0;
  v_conflict_count int := 0;
  v_total_pending int := 0;
  v_curr_shift_id uuid;
  v_curr_area_id uuid;
  v_orig_shift_id uuid;
  v_orig_area_id uuid;
  v_has_conflict boolean;
begin
  -- Permission check
  if not is_approver() then
    raise exception 'Permission denied: only admins or delegated approvers can approve change requests';
  end if;

  -- Load request
  select * into v_req from change_requests
  where id = p_request_id and organization_id = current_org();

  if not found then
    raise exception 'Change request not found';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'Change request is not in pending status (current status: %)', v_req.status;
  end if;

  -- Count total items
  select count(*) into v_total_pending
  from change_request_items
  where request_id = p_request_id and status in ('pending', 'conflict');

  -- Process each item in this batch
  for v_item in
    select * from change_request_items
    where request_id = p_request_id and status in ('pending', 'conflict')
    order by created_at
  loop
    -- Check if explicitly rejected
    if p_reject_item_ids is not null and v_item.id = any(p_reject_item_ids) then
      update change_request_items
      set status = 'rejected',
          rejection_reason = coalesce(p_review_notes, 'Rejected by approver'),
          applied_at = now()
      where id = v_item.id;
      v_rejected_count := v_rejected_count + 1;
      continue;
    end if;

    -- Check if item is included in approval list (if specified)
    if p_item_ids is not null and not (v_item.id = any(p_item_ids)) then
      -- Item was left untouched / pending for later decision
      continue;
    end if;

    -- Conflict detection for schedule assignments
    v_has_conflict := false;
    if v_item.target_table = 'schedule_assignments' then
      -- Fetch current live state
      select shift_type_id, area_code_id into v_curr_shift_id, v_curr_area_id
      from schedule_assignments
      where organization_id = current_org()
        and operator_id = v_item.operator_id
        and schedule_date = v_item.schedule_date;

      -- Extract original snapshot
      if v_item.original_state is not null then
        v_orig_shift_id := (v_item.original_state->>'shift_type_id')::uuid;
        v_orig_area_id := (v_item.original_state->>'area_code_id')::uuid;

        -- Conflict if current state is different from what requester saw
        if (v_curr_shift_id is distinct from v_orig_shift_id) or
           (v_curr_area_id is distinct from v_orig_area_id) then
          v_has_conflict := true;
        end if;
      end if;

      if v_has_conflict and not p_force_conflicts then
        update change_request_items
        set status = 'conflict'
        where id = v_item.id;
        v_conflict_count := v_conflict_count + 1;
        continue;
      end if;

      -- Apply schedule change
      if v_item.action = 'delete' or (v_item.shift_type_id is null and v_item.area_code_id is null) then
        delete from schedule_assignments
        where organization_id = current_org()
          and operator_id = v_item.operator_id
          and schedule_date = v_item.schedule_date;
      else
        insert into schedule_assignments (
          organization_id, operator_id, schedule_date, shift_type_id, area_code_id, notes, created_by, updated_at
        ) values (
          current_org(), v_item.operator_id, v_item.schedule_date, v_item.shift_type_id, v_item.area_code_id, v_item.notes, auth.uid(), now()
        )
        on conflict (operator_id, schedule_date) do update set
          shift_type_id = excluded.shift_type_id,
          area_code_id = excluded.area_code_id,
          notes = coalesce(excluded.notes, schedule_assignments.notes),
          updated_at = now();
      end if;

    elsif v_item.target_table = 'standby_assignments' then
      -- Standby assignments
      if v_item.action = 'delete' then
        delete from standby_assignments
        where organization_id = current_org()
          and operator_id = v_item.operator_id
          and schedule_date = v_item.schedule_date;
      else
        insert into standby_assignments (
          organization_id, operator_id, schedule_date, standby_type, notes
        ) values (
          current_org(), v_item.operator_id, v_item.schedule_date, coalesce(v_item.standby_type, 'OC'), v_item.notes
        )
        on conflict (operator_id, schedule_date) do update set
          standby_type = excluded.standby_type,
          notes = excluded.notes;
      end if;

    elsif v_item.target_table = 'pm_tasks' then
      -- PM tasks
      if v_item.action = 'delete' and v_item.pm_task_id is not null then
        delete from pm_tasks
        where id = v_item.pm_task_id and organization_id = current_org();
      elsif v_item.pm_task_id is not null then
        update pm_tasks set
          title = coalesce(v_item.pm_title, title),
          status = coalesce(v_item.pm_status, status),
          assigned_operator_ids = coalesce(v_item.pm_assigned_operator_ids, assigned_operator_ids),
          scheduled_date = coalesce(v_item.schedule_date, scheduled_date),
          remarks = coalesce(v_item.notes, remarks)
        where id = v_item.pm_task_id and organization_id = current_org();
      else
        insert into pm_tasks (
          organization_id, title, activity_type, scheduled_date, assigned_operator_ids, status, remarks
        ) values (
          current_org(),
          coalesce(v_item.pm_title, 'PM Task'),
          'maintenance',
          v_item.schedule_date,
          coalesce(v_item.pm_assigned_operator_ids, '{}'),
          coalesce(v_item.pm_status, 'planned'),
          v_item.notes
        );
      end if;

    elsif v_item.target_table = 'leave_records' then
      -- Leave records
      if v_item.action = 'delete' and v_item.target_id is not null then
        delete from leave_records
        where id = v_item.target_id and organization_id = current_org();
      else
        insert into leave_records (
          organization_id, operator_id, leave_code, start_date, end_date, remarks, approved_by
        ) values (
          current_org(),
          v_item.operator_id,
          coalesce(v_item.leave_code, 'VL'),
          coalesce(v_item.leave_start_date, v_item.schedule_date),
          coalesce(v_item.leave_end_date, v_item.schedule_date),
          v_item.notes,
          auth.uid()
        );
      end if;
    end if;

    -- Mark item approved
    update change_request_items
    set status = 'approved',
        applied_at = now()
    where id = v_item.id;
    v_approved_count := v_approved_count + 1;
  end loop;

  -- Determine final header status
  if v_approved_count > 0 and v_rejected_count = 0 and v_conflict_count = 0 then
    update change_requests
    set status = 'approved',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        review_notes = p_review_notes,
        updated_at = now()
    where id = p_request_id;
  elsif v_approved_count > 0 then
    update change_requests
    set status = 'partially_approved',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        review_notes = p_review_notes,
        updated_at = now()
    where id = p_request_id;
  elsif v_rejected_count > 0 and v_approved_count = 0 then
    update change_requests
    set status = 'rejected',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        review_notes = p_review_notes,
        updated_at = now()
    where id = p_request_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'approved_count', v_approved_count,
    'rejected_count', v_rejected_count,
    'conflict_count', v_conflict_count,
    'total_processed', v_approved_count + v_rejected_count + v_conflict_count
  );
end;
$$;

-- 6. Stored Procedure: Reject change request
create or replace function reject_change_request(
  p_request_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req change_requests%rowtype;
  v_count int;
begin
  if not is_approver() then
    raise exception 'Permission denied: only admins or delegated approvers can reject change requests';
  end if;

  select * into v_req from change_requests
  where id = p_request_id and organization_id = current_org();

  if not found then
    raise exception 'Change request not found';
  end if;

  update change_request_items
  set status = 'rejected',
      rejection_reason = coalesce(p_reason, 'Rejected by approver'),
      applied_at = now()
  where request_id = p_request_id and status in ('pending', 'conflict');
  get diagnostics v_count = row_count;

  update change_requests
  set status = 'rejected',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_notes = p_reason,
      updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'rejected_items_count', v_count,
    'status', 'rejected'
  );
end;
$$;
