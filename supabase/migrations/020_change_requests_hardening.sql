-- Hardening for Change Requests & Approvals:
--  1. Validate cross-organization references on change_request_items (insert/update & apply).
--  2. Prevent pending -> draft rollback and closed-status mutations on change_requests.
--  3. Prevent approvers from approving their own change requests (unless explicit admin override).
--  4. Keep partial approvals in 'partially_approved' when pending items remain, and allow follow-up approvals.
--  5. Block reject_change_request on already-approved/closed requests (and preserve 'partially_approved' if items applied).
--  6. Enforce live-state conflict detection across standby_assignments, pm_tasks, and leave_records (including updates & date overlaps).
--  7. Send notifications for 'partially_approved' requests.

-- 1. Cross-organization FK validation trigger for change_request_items
create or replace function validate_change_request_item_org() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_req_org uuid;
  v_bad_op uuid;
begin
  select organization_id into v_req_org
  from change_requests
  where id = new.request_id;

  if not found or v_req_org is distinct from new.organization_id then
    raise exception 'Change request item must belong to the same organization as its request';
  end if;

  if new.operator_id is not null and not exists (
    select 1 from operators where id = new.operator_id and organization_id = new.organization_id
  ) then
    raise exception 'Operator does not belong to this organization';
  end if;

  if new.shift_type_id is not null and not exists (
    select 1 from shift_types where id = new.shift_type_id and organization_id = new.organization_id
  ) then
    raise exception 'Shift type does not belong to this organization';
  end if;

  if new.area_code_id is not null and not exists (
    select 1 from area_codes where id = new.area_code_id and organization_id = new.organization_id
  ) then
    raise exception 'Area code does not belong to this organization';
  end if;

  if new.pm_task_id is not null and not exists (
    select 1 from pm_tasks where id = new.pm_task_id and organization_id = new.organization_id
  ) then
    raise exception 'PM task does not belong to this organization';
  end if;

  if new.target_id is not null and new.target_table = 'leave_records' and not exists (
    select 1 from leave_records where id = new.target_id and organization_id = new.organization_id
  ) then
    raise exception 'Leave record does not belong to this organization';
  end if;

  if new.pm_assigned_operator_ids is not null and cardinality(new.pm_assigned_operator_ids) > 0 then
    select elem into v_bad_op
    from unnest(new.pm_assigned_operator_ids) as elem
    where not exists (
      select 1 from operators where id = elem and organization_id = new.organization_id
    )
    limit 1;
    if v_bad_op is not null then
      raise exception 'Assigned PM operator does not belong to this organization';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_validate_change_request_item_org on change_request_items;
create trigger trg_validate_change_request_item_org
  before insert or update on change_request_items
  for each row execute function validate_change_request_item_org();

-- 2. Guard change_requests state transitions (no pending -> draft rollback, no closed-status overwrite)
create or replace function guard_change_request_transition() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending' and new.status = 'draft' then
    raise exception 'Pending change requests cannot be moved back to draft; cancel or await review instead';
  end if;

  if old.status in ('approved', 'rejected', 'cancelled') and new.status is distinct from old.status then
    raise exception 'Closed change request (%) cannot change status', old.status;
  end if;

  if old.status = 'partially_approved' and new.status in ('draft', 'pending') then
    raise exception 'Partially approved change requests cannot revert to %', new.status;
  end if;

  if old.requester_id = auth.uid() and not is_approver() then
    if old.status = 'pending' then
      if new.status is distinct from 'cancelled'
         or new.title is distinct from old.title
         or new.note is distinct from old.note then
        raise exception 'Pending requests cannot be edited by the requester (only cancelled)';
      end if;
    elsif old.status = 'draft' then
      if new.status not in ('draft', 'pending', 'cancelled') then
        raise exception 'Requester cannot transition draft request to %', new.status;
      end if;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_change_request_transition on change_requests;
create trigger trg_guard_change_request_transition
  before update on change_requests
  for each row execute function guard_change_request_transition();

-- 3. Replace approve_change_request with self-approval protection, multi-table conflict detection,
--    proper leave update/overlap checks, and accurate remaining-pending header status.
drop function if exists approve_change_request(uuid, uuid[], uuid[], text, boolean);
drop function if exists approve_change_request(uuid, uuid[], uuid[], text, boolean, boolean);

create or replace function approve_change_request(
  p_request_id uuid,
  p_item_ids uuid[] default null,
  p_reject_item_ids uuid[] default null,
  p_review_notes text default null,
  p_force_conflicts boolean default false,
  p_allow_self_override boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req change_requests%rowtype;
  v_item change_request_items%rowtype;
  v_approved_count int := 0;
  v_rejected_count int := 0;
  v_conflict_count int := 0;
  v_remaining_pending int := 0;
  v_total_approved int := 0;
  v_total_rejected int := 0;
  v_final_status text;

  v_curr_shift_id uuid;
  v_curr_area_id uuid;
  v_orig_shift_id uuid;
  v_orig_area_id uuid;

  v_curr_standby_type text;
  v_orig_standby_type text;

  v_curr_pm_title text;
  v_curr_pm_status text;
  v_curr_pm_date date;
  v_curr_pm_assigned uuid[];
  v_orig_pm_assigned uuid[];

  v_leave_start date;
  v_leave_end date;
  v_curr_leave_code text;
  v_curr_leave_start date;
  v_curr_leave_end date;

  v_has_conflict boolean;
begin
  if not is_approver() then
    raise exception 'Permission denied: only admins or delegated approvers can approve change requests';
  end if;

  select * into v_req from change_requests
  where id = p_request_id and organization_id = current_org();

  if not found then
    raise exception 'Change request not found';
  end if;

  if v_req.requester_id = auth.uid()
     and not (current_role_name() = 'admin' and p_allow_self_override) then
    raise exception 'Approvers cannot approve their own change requests (explicit admin override required)';
  end if;

  if v_req.status not in ('pending', 'partially_approved') then
    raise exception 'Change request is not open for approval (current status: %)', v_req.status;
  end if;

  for v_item in
    select * from change_request_items
    where request_id = p_request_id and status in ('pending', 'conflict')
    order by created_at
  loop
    if p_reject_item_ids is not null and v_item.id = any(p_reject_item_ids) then
      update change_request_items
      set status = 'rejected',
          rejection_reason = coalesce(p_review_notes, 'Rejected by approver'),
          applied_at = now()
      where id = v_item.id;
      v_rejected_count := v_rejected_count + 1;
      continue;
    end if;

    if p_item_ids is not null and not (v_item.id = any(p_item_ids)) then
      continue;
    end if;

    -- Defensive org checks before applying
    if v_item.operator_id is not null and not exists (
      select 1 from operators where id = v_item.operator_id and organization_id = current_org()
    ) then
      raise exception 'Item operator does not belong to current organization';
    end if;

    v_has_conflict := false;

    if v_item.target_table = 'schedule_assignments' then
      select shift_type_id, area_code_id into v_curr_shift_id, v_curr_area_id
      from schedule_assignments
      where organization_id = current_org()
        and operator_id = v_item.operator_id
        and schedule_date = v_item.schedule_date;

      if v_item.original_state is not null then
        v_orig_shift_id := nullif(v_item.original_state->>'shift_type_id', '')::uuid;
        v_orig_area_id := nullif(v_item.original_state->>'area_code_id', '')::uuid;

        if (v_curr_shift_id is distinct from v_orig_shift_id) or
           (v_curr_area_id is distinct from v_orig_area_id) then
          v_has_conflict := true;
        end if;
      end if;

      if v_has_conflict and not p_force_conflicts then
        update change_request_items set status = 'conflict' where id = v_item.id;
        v_conflict_count := v_conflict_count + 1;
        continue;
      end if;

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
      select standby_type into v_curr_standby_type
      from standby_assignments
      where organization_id = current_org()
        and operator_id = v_item.operator_id
        and schedule_date = v_item.schedule_date;

      if v_item.original_state is not null then
        v_orig_standby_type := nullif(v_item.original_state->>'standby_type', '');
        if v_curr_standby_type is distinct from v_orig_standby_type then
          v_has_conflict := true;
        end if;
      end if;

      if v_has_conflict and not p_force_conflicts then
        update change_request_items set status = 'conflict' where id = v_item.id;
        v_conflict_count := v_conflict_count + 1;
        continue;
      end if;

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
      if v_item.pm_task_id is not null then
        select title, status, scheduled_date, assigned_operator_ids
        into v_curr_pm_title, v_curr_pm_status, v_curr_pm_date, v_curr_pm_assigned
        from pm_tasks
        where id = v_item.pm_task_id and organization_id = current_org();

        if not found then
          v_has_conflict := true;
        elsif v_item.original_state is not null then
          if (v_item.original_state ? 'title' and v_curr_pm_title is distinct from (v_item.original_state->>'title'))
             or (v_item.original_state ? 'status' and v_curr_pm_status is distinct from (v_item.original_state->>'status'))
             or (v_item.original_state ? 'scheduled_date' and v_curr_pm_date is distinct from nullif(v_item.original_state->>'scheduled_date', '')::date) then
            v_has_conflict := true;
          end if;

          if not v_has_conflict
             and (v_item.original_state ? 'assigned_operator_ids')
             and jsonb_typeof(v_item.original_state->'assigned_operator_ids') = 'array' then
            select coalesce(array_agg(elem::uuid), '{}'::uuid[])
            into v_orig_pm_assigned
            from jsonb_array_elements_text(v_item.original_state->'assigned_operator_ids') as elem;

            if coalesce(v_curr_pm_assigned, '{}'::uuid[]) is distinct from v_orig_pm_assigned then
              v_has_conflict := true;
            end if;
          end if;
        end if;

        if v_has_conflict and not p_force_conflicts then
          update change_request_items set status = 'conflict' where id = v_item.id;
          v_conflict_count := v_conflict_count + 1;
          continue;
        end if;
      end if;

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
      v_leave_start := coalesce(v_item.leave_start_date, v_item.schedule_date);
      v_leave_end := coalesce(v_item.leave_end_date, v_item.schedule_date);

      if v_item.action <> 'delete' and (v_leave_start is null or v_leave_end is null or v_leave_end < v_leave_start) then
        raise exception 'Invalid leave date range for change request item %', v_item.id;
      end if;

      if v_item.target_id is not null then
        select leave_code, start_date, end_date
        into v_curr_leave_code, v_curr_leave_start, v_curr_leave_end
        from leave_records
        where id = v_item.target_id and organization_id = current_org();

        if not found then
          v_has_conflict := true;
        elsif v_item.original_state is not null then
          if (v_item.original_state ? 'leave_code' and v_curr_leave_code is distinct from (v_item.original_state->>'leave_code'))
             or (v_item.original_state ? 'start_date' and v_curr_leave_start is distinct from nullif(v_item.original_state->>'start_date', '')::date)
             or (v_item.original_state ? 'end_date' and v_curr_leave_end is distinct from nullif(v_item.original_state->>'end_date', '')::date) then
            v_has_conflict := true;
          end if;
        end if;
      end if;

      if not v_has_conflict and v_item.action <> 'delete' and v_item.operator_id is not null then
        if exists (
          select 1 from leave_records
          where organization_id = current_org()
            and operator_id = v_item.operator_id
            and (v_item.target_id is null or id <> v_item.target_id)
            and start_date <= v_leave_end
            and end_date >= v_leave_start
        ) then
          v_has_conflict := true;
        end if;
      end if;

      if v_has_conflict and not p_force_conflicts then
        update change_request_items set status = 'conflict' where id = v_item.id;
        v_conflict_count := v_conflict_count + 1;
        continue;
      end if;

      if v_item.action = 'delete' and v_item.target_id is not null then
        delete from leave_records
        where id = v_item.target_id and organization_id = current_org();
      elsif v_item.target_id is not null then
        update leave_records set
          leave_code = coalesce(v_item.leave_code, leave_code),
          start_date = v_leave_start,
          end_date = v_leave_end,
          remarks = coalesce(v_item.notes, remarks),
          approved_by = auth.uid()
        where id = v_item.target_id and organization_id = current_org();
      else
        insert into leave_records (
          organization_id, operator_id, leave_code, start_date, end_date, remarks, approved_by
        ) values (
          current_org(),
          v_item.operator_id,
          coalesce(v_item.leave_code, 'VL'),
          v_leave_start,
          v_leave_end,
          v_item.notes,
          auth.uid()
        );
      end if;
    end if;

    update change_request_items
    set status = 'approved',
        applied_at = now()
    where id = v_item.id;
    v_approved_count := v_approved_count + 1;
  end loop;

  -- Compute header status across ALL items on the request (including untouched ones)
  select
    count(*) filter (where status in ('pending', 'conflict')),
    count(*) filter (where status = 'approved'),
    count(*) filter (where status = 'rejected')
  into v_remaining_pending, v_total_approved, v_total_rejected
  from change_request_items
  where request_id = p_request_id;

  if v_remaining_pending = 0 and v_total_approved > 0 and v_total_rejected = 0 then
    v_final_status := 'approved';
  elsif v_total_approved > 0 then
    v_final_status := 'partially_approved';
  elsif v_remaining_pending = 0 and v_total_rejected > 0 then
    v_final_status := 'rejected';
  else
    v_final_status := v_req.status;
  end if;

  if v_final_status is distinct from v_req.status
     or (v_approved_count + v_rejected_count + v_conflict_count) > 0 then
    update change_requests
    set status = v_final_status,
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        review_notes = coalesce(p_review_notes, review_notes),
        updated_at = now()
    where id = p_request_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'approved_count', v_approved_count,
    'rejected_count', v_rejected_count,
    'conflict_count', v_conflict_count,
    'remaining_pending_count', v_remaining_pending,
    'status', v_final_status,
    'total_processed', v_approved_count + v_rejected_count + v_conflict_count
  );
end;
$$;

-- 4. Harden reject_change_request: only reject open requests; preserve partially_approved if items already applied
create or replace function reject_change_request(
  p_request_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req change_requests%rowtype;
  v_count int;
  v_already_approved int := 0;
  v_final_status text;
begin
  if not is_approver() then
    raise exception 'Permission denied: only admins or delegated approvers can reject change requests';
  end if;

  select * into v_req from change_requests
  where id = p_request_id and organization_id = current_org();

  if not found then
    raise exception 'Change request not found';
  end if;

  if v_req.status not in ('pending', 'partially_approved') then
    raise exception 'Cannot reject change request in % status', v_req.status;
  end if;

  if v_req.requester_id = auth.uid() and current_role_name() <> 'admin' then
    raise exception 'Approvers cannot reject their own change requests (cancel instead)';
  end if;

  update change_request_items
  set status = 'rejected',
      rejection_reason = coalesce(p_reason, 'Rejected by approver'),
      applied_at = now()
  where request_id = p_request_id and status in ('pending', 'conflict');
  get diagnostics v_count = row_count;

  select count(*) into v_already_approved
  from change_request_items
  where request_id = p_request_id and status = 'approved';

  v_final_status := case when v_already_approved > 0 then 'partially_approved' else 'rejected' end;

  update change_requests
  set status = v_final_status,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_notes = p_reason,
      updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'rejected_items_count', v_count,
    'status', v_final_status
  );
end;
$$;

-- 5. Notify requester on partially_approved in addition to approved/rejected
create or replace function notify_on_change_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_label text;
begin
  if (tg_op = 'INSERT' and new.status = 'pending')
     or (tg_op = 'UPDATE' and new.status = 'pending' and old.status is distinct from 'pending') then
    insert into notifications (organization_id, user_id, kind, title, body, href)
    select
      new.organization_id,
      up.id,
      'request_pending',
      'New Change Request',
      coalesce(nullif(new.title, ''), 'Schedule / leave change request') || ' is awaiting approval',
      '/requests'
    from user_profiles up
    where up.organization_id = new.organization_id
      and up.is_active = true
      and (up.role = 'admin' or up.can_approve = true)
      and up.id is distinct from new.requester_id;
  elsif tg_op = 'UPDATE'
        and new.status in ('approved', 'partially_approved', 'rejected')
        and old.status is distinct from new.status then
    if new.requester_id is not null then
      v_label := case new.status
        when 'partially_approved' then 'Partially Approved'
        else initcap(new.status)
      end;
      insert into notifications (organization_id, user_id, kind, title, body, href)
      values (
        new.organization_id,
        new.requester_id,
        'request_' || new.status,
        'Change Request ' || v_label,
        coalesce(nullif(new.title, ''), 'Your change request') || ' was ' || replace(new.status, '_', ' '),
        '/requests'
      );
    end if;
  end if;
  return new;
end $$;
