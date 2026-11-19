-- Security & Privacy Hardening (Phase 3):
--  1. Prevent direct-table status/review bypass on change_requests and change_request_items
--     (including by delegated approvers on their own requests); enforce RPC-only approval/rejection.
--  2. Enforce requester checks whenever requester_id = auth.uid() regardless of is_approver().
--  3. Convert Supabase Storage bucket 'activity-media' to private with org-scoped RLS policies.
--  4. Restrict seed_bpwi_iloilo_org_chart(uuid) to organization admins and remove hardcoded employee names.

-- 1. Tighten RLS policies on change_requests and change_request_items so approvals/rejections
--    and review metadata can only flow through approve_change_request / reject_change_request RPCs.
drop policy if exists "change_requests insert" on change_requests;
create policy "change_requests insert" on change_requests
  for insert with check (
    organization_id = current_org()
    and requester_id = auth.uid()
    and status in ('draft', 'pending')
    and reviewed_by is null
    and reviewed_at is null
  );

drop policy if exists "change_requests update" on change_requests;
create policy "change_requests update" on change_requests
  for update using (
    organization_id = current_org()
    and requester_id = auth.uid()
    and status in ('draft', 'pending')
  ) with check (
    organization_id = current_org()
    and requester_id = auth.uid()
    and status in ('draft', 'pending', 'cancelled')
  );

drop policy if exists "change_request_items update" on change_request_items;
create policy "change_request_items update" on change_request_items
  for update using (
    organization_id = current_org()
    and exists (
      select 1 from change_requests r
      where r.id = request_id
        and r.requester_id = auth.uid()
        and r.status = 'draft'
    )
  ) with check (
    organization_id = current_org()
    and exists (
      select 1 from change_requests r
      where r.id = request_id
        and r.requester_id = auth.uid()
        and r.status = 'draft'
    )
  );

-- 2. Harden guard_change_request_transition():
--    - Enforce RPC-only transitions into review states ('approved', 'partially_approved', 'rejected')
--      or changes to reviewed_by / reviewed_at.
--    - Apply requester restrictions whenever requester_id = auth.uid(), regardless of is_approver().
create or replace function guard_change_request_transition() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_in_rpc boolean := coalesce(current_setting('app.change_request_rpc', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'pending')
       or new.reviewed_by is not null
       or new.reviewed_at is not null then
      raise exception 'New change requests must start in draft or pending status without review metadata';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'draft' then
    raise exception 'Pending change requests cannot be moved back to draft; cancel or await review instead';
  end if;

  if old.status in ('approved', 'rejected', 'cancelled') and new.status is distinct from old.status then
    raise exception 'Closed change request (%) cannot change status', old.status;
  end if;

  if old.status = 'partially_approved' and new.status in ('draft', 'pending', 'cancelled') and not v_in_rpc then
    raise exception 'Partially approved change requests cannot revert to %', new.status;
  end if;

  if (new.status in ('approved', 'partially_approved', 'rejected')
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at)
     and not v_in_rpc then
    raise exception 'Change request review status can only be changed through approve_change_request or reject_change_request';
  end if;

  if old.requester_id = auth.uid() and not v_in_rpc then
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
  before insert or update on change_requests
  for each row execute function guard_change_request_transition();

-- 3. Update approve_change_request & reject_change_request to set the transaction-local RPC flag
--    around status/review updates on change_requests, and lock execute permissions to authenticated.
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
     and not (current_role_name() = 'admin' and coalesce(p_allow_self_override, false)) then
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

      if v_has_conflict and not coalesce(p_force_conflicts, false) then
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

      if v_has_conflict and not coalesce(p_force_conflicts, false) then
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

        if v_has_conflict and not coalesce(p_force_conflicts, false) then
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

      if v_has_conflict and not coalesce(p_force_conflicts, false) then
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
    perform set_config('app.change_request_rpc', '1', true);
    update change_requests
    set status = v_final_status,
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        review_notes = coalesce(p_review_notes, review_notes),
        updated_at = now()
    where id = p_request_id;
    perform set_config('app.change_request_rpc', '', true);
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

  perform set_config('app.change_request_rpc', '1', true);
  update change_requests
  set status = v_final_status,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_notes = p_reason,
      updated_at = now()
  where id = p_request_id;
  perform set_config('app.change_request_rpc', '', true);

  return jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'rejected_items_count', v_count,
    'status', v_final_status
  );
end;
$$;

revoke all on function approve_change_request(uuid, uuid[], uuid[], text, boolean, boolean) from public, anon;
grant execute on function approve_change_request(uuid, uuid[], uuid[], text, boolean, boolean) to authenticated;

revoke all on function reject_change_request(uuid, text) from public, anon;
grant execute on function reject_change_request(uuid, text) to authenticated;

-- 4. Make 'activity-media' bucket private and restrict storage access strictly by organization.
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    update storage.buckets
    set public = false
    where id = 'activity-media';

    drop policy if exists "activity-media public read" on storage.objects;
    drop policy if exists "activity-media org read" on storage.objects;
    create policy "activity-media org read" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'activity-media'
        and split_part(name, '/', 1) = public.current_org()::text
      );

    drop policy if exists "activity-media operator admin insert" on storage.objects;
    create policy "activity-media operator admin insert" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'activity-media'
        and split_part(name, '/', 1) = public.current_org()::text
        and exists (
          select 1 from public.user_profiles
          where id = auth.uid() and is_active and role in ('operator', 'admin')
        )
      );

    drop policy if exists "activity-media purge delete" on storage.objects;
    create policy "activity-media purge delete" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'activity-media'
        and split_part(name, '/', 1) = public.current_org()::text
        and exists (
          select 1 from public.user_profiles
          where id = auth.uid() and is_active and role in ('operator', 'admin', 'scheduler', 'manager')
        )
      );
  end if;
end $$;

-- 5. Restrict seed_bpwi_iloilo_org_chart(uuid) to organization admins and remove hardcoded employee names.
create or replace function seed_bpwi_iloilo_org_chart(p_org_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_exec uuid;
  v_plant_head uuid;
  v_tech_head uuid;
  v_proj_head uuid;
  v_comm_head uuid;
  v_leadman uuid;
begin
  if p_org_id is distinct from current_org() or current_role_name() <> 'admin' then
    raise exception 'Permission denied: only organization admins can seed the organization chart';
  end if;

  if exists (select 1 from org_positions where organization_id = p_org_id) then
    return;
  end if;

  -- Executive
  insert into org_positions (organization_id, title, department_group, tier, fallback_name, is_vacant, color_theme, sort_order)
  values (p_org_id, 'Business Unit Head', 'MANAGING HEAD', 'executive', null, true, 'navy', 1)
  returning id into v_exec;

  -- Support Group (Advisory & Control)
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, is_vacant, color_theme, sort_order) values
    (p_org_id, 'HR Assist./GS/SO', 'SUPPORT GROUP', 'support', v_exec, null, true, 'slate', 10),
    (p_org_id, 'Proc/Warehouse Man', 'SUPPORT GROUP', 'support', v_exec, null, true, 'slate', 11),
    (p_org_id, 'Data Analyst', 'SUPPORT GROUP', 'support', v_exec, null, true, 'slate', 12);

  -- Gardener directly under Managing Head
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, is_vacant, shift_badge, color_theme, sort_order) values
    (p_org_id, 'Gardener', 'SUPPORT STAFF', 'staff', v_exec, null, true, '7AM–4PM', 'slate', 15);

  -- 4 Department Heads
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, is_vacant, color_theme, sort_order)
  values (p_org_id, 'Plant Operations Head', 'WATER SUPPLY • PAVIA', 'head', v_exec, null, true, 'blue', 20)
  returning id into v_plant_head;

  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, is_vacant, color_theme, sort_order)
  values (p_org_id, 'Technical Head', 'TECHNICAL', 'head', v_exec, null, true, 'blue', 21)
  returning id into v_tech_head;

  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, is_vacant, color_theme, sort_order)
  values (p_org_id, 'Project Head', 'PROJECT SPECIALISTS', 'head', v_exec, null, true, 'teal', 22)
  returning id into v_proj_head;

  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, is_vacant, color_theme, sort_order)
  values (p_org_id, 'Commercial Head', 'COMMERCIAL OPERATIONS', 'head', v_exec, null, true, 'purple', 23)
  returning id into v_comm_head;

  -- Leadman bridging Plant Ops & Technical
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, secondary_parent_id, fallback_name, is_vacant, shift_badge, color_theme, sort_order)
  values (p_org_id, 'Technical Leadman • Electro-Mech', 'LEADMAN', 'leadman', v_tech_head, v_plant_head, null, true, '7AM–4PM', 'blue', 30)
  returning id into v_leadman;

  -- WATER SUPPLY • PAVIA
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, is_vacant, shift_badge, color_theme, sort_order) values
    (p_org_id, 'Water Supply Specialist', 'WATER SUPPLY • PAVIA', 'staff', v_plant_head, null, true, 'Shifting', 'slate', 40),
    (p_org_id, 'Water Supply Specialist', 'WATER SUPPLY • PAVIA', 'staff', v_plant_head, null, true, 'Shifting', 'slate', 41),
    (p_org_id, 'Water Supply Specialist', 'WATER SUPPLY • PAVIA', 'staff', v_plant_head, null, true, 'Shifting', 'slate', 42),
    (p_org_id, 'Water Supply Specialist / Meter Reader', 'WATER SUPPLY • PAVIA', 'staff', v_plant_head, null, true, 'Shifting', 'purple', 43);

  -- LEAK DETECTION & NIGHT SHIFT
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, is_vacant, shift_badge, color_theme, sort_order) values
    (p_org_id, 'Leak Detection Spec.', 'LEAK DETECTION & NIGHT SHIFT', 'staff', v_tech_head, null, true, '7AM–4PM', 'slate', 50),
    (p_org_id, 'Leak Detection Spec.', 'LEAK DETECTION & NIGHT SHIFT', 'staff', v_tech_head, null, true, '7AM–4PM', 'slate', 51);

  -- TECHNICAL MAINTENANCE
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, is_vacant, shift_badge, color_theme, sort_order) values
    (p_org_id, 'Tech Maint. / Driver', 'TECHNICAL MAINTENANCE', 'staff', v_tech_head, null, true, '7AM–4PM', 'blue', 60),
    (p_org_id, 'Tech Maint. / Driver', 'TECHNICAL MAINTENANCE', 'staff', v_tech_head, null, true, '7AM–4PM', 'blue', 61),
    (p_org_id, 'Tech Maintenance', 'TECHNICAL MAINTENANCE', 'staff', v_tech_head, null, true, '7AM–4PM', 'slate', 62),
    (p_org_id, 'Night Maintenance', 'TECHNICAL MAINTENANCE', 'staff', v_tech_head, null, true, '10PM–7AM', 'amber', 63);

  -- PROJECT SPECIALISTS
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, is_vacant, shift_badge, color_theme, sort_order) values
    (p_org_id, 'Project Specialist', 'PROJECT SPECIALISTS', 'staff', v_proj_head, null, true, '7AM–4PM', 'slate', 70),
    (p_org_id, 'Project Specialist', 'PROJECT SPECIALISTS', 'staff', v_proj_head, null, true, '7AM–4PM', 'slate', 71),
    (p_org_id, 'Project Specialist', 'PROJECT SPECIALISTS', 'staff', v_proj_head, null, true, '7AM–4PM', 'slate', 72);

  -- COMMERCIAL OPERATIONS
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, is_vacant, shift_badge, color_theme, sort_order) values
    (p_org_id, 'Customer Service', 'COMMERCIAL OPERATIONS', 'staff', v_comm_head, null, true, null, 'slate', 80),
    (p_org_id, 'Commercial (Billing) Specialist', 'COMMERCIAL OPERATIONS', 'staff', v_comm_head, null, true, null, 'slate', 81),
    (p_org_id, 'Meter Reader', 'COMMERCIAL OPERATIONS', 'staff', v_comm_head, null, true, '7AM–4PM', 'slate', 82);
end $$;

revoke all on function seed_bpwi_iloilo_org_chart(uuid) from public, anon;
grant execute on function seed_bpwi_iloilo_org_chart(uuid) to authenticated;

revoke all on function update_org_chart_meta(uuid, jsonb) from public, anon;
grant execute on function update_org_chart_meta(uuid, jsonb) to authenticated;
