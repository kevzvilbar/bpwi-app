-- 026: Fix validate_change_request_item_org() trigger on status-only updates
--
-- Migration 023 added conflict/rejection handling for change_request_items whose target
-- leave_records row was deleted while pending. Updating status = 'conflict' or 'rejected'
-- on that item re-ran the full BEFORE INSERT OR UPDATE trigger from 020 and failed with
-- "Leave record does not belong to this organization" because target_id still pointed at
-- the deleted leave row. Only validate foreign/org references when inserted or modified.

create or replace function validate_change_request_item_org() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_req_org uuid;
  v_bad_op uuid;
begin
  if tg_op = 'INSERT'
     or new.request_id is distinct from old.request_id
     or new.organization_id is distinct from old.organization_id then
    select organization_id into v_req_org
    from change_requests
    where id = new.request_id;

    if not found or v_req_org is distinct from new.organization_id then
      raise exception 'Change request item must belong to the same organization as its request';
    end if;
  end if;

  if new.operator_id is not null and (
       tg_op = 'INSERT'
       or new.operator_id is distinct from old.operator_id
       or new.organization_id is distinct from old.organization_id
     ) and not exists (
    select 1 from operators where id = new.operator_id and organization_id = new.organization_id
  ) then
    raise exception 'Operator does not belong to this organization';
  end if;

  if new.shift_type_id is not null and (
       tg_op = 'INSERT'
       or new.shift_type_id is distinct from old.shift_type_id
       or new.organization_id is distinct from old.organization_id
     ) and not exists (
    select 1 from shift_types where id = new.shift_type_id and organization_id = new.organization_id
  ) then
    raise exception 'Shift type does not belong to this organization';
  end if;

  if new.area_code_id is not null and (
       tg_op = 'INSERT'
       or new.area_code_id is distinct from old.area_code_id
       or new.organization_id is distinct from old.organization_id
     ) and not exists (
    select 1 from area_codes where id = new.area_code_id and organization_id = new.organization_id
  ) then
    raise exception 'Area code does not belong to this organization';
  end if;

  if new.pm_task_id is not null and (
       tg_op = 'INSERT'
       or new.pm_task_id is distinct from old.pm_task_id
       or new.organization_id is distinct from old.organization_id
     ) and not exists (
    select 1 from pm_tasks where id = new.pm_task_id and organization_id = new.organization_id
  ) then
    raise exception 'PM task does not belong to this organization';
  end if;

  if new.target_id is not null
     and new.target_table = 'leave_records'
     and (
       tg_op = 'INSERT'
       or new.target_id is distinct from old.target_id
       or new.target_table is distinct from old.target_table
       or new.organization_id is distinct from old.organization_id
     )
     and not exists (
    select 1 from leave_records where id = new.target_id and organization_id = new.organization_id
  ) then
    raise exception 'Leave record does not belong to this organization';
  end if;

  if new.pm_assigned_operator_ids is not null
     and cardinality(new.pm_assigned_operator_ids) > 0
     and (
       tg_op = 'INSERT'
       or new.pm_assigned_operator_ids is distinct from old.pm_assigned_operator_ids
       or new.organization_id is distinct from old.organization_id
     ) then
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
