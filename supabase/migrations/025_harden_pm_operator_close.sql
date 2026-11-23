-- 025: Harden PM operator completion policy and trigger
--
-- Fixes three gaps introduced in 024_pm_actual_performers.sql:
-- 1. Only OPEN (status <> 'done') PM tasks may be updated by operators; completed tasks cannot be
--    reopened (done -> planned/postponed) or modified by operators.
-- 2. When closing an open task as 'done', the operator performing the update (current_operator_id())
--    MUST include themselves in completed_by_operator_ids (prevents crediting only colleagues).
-- 3. Unlisted substitutes may ONLY close open tasks as 'done'; only planned assignees may adjust
--    open-task states (planned/postponed), and open tasks cannot keep completed_by_operator_ids.

drop policy if exists "pm_tasks operator close" on pm_tasks;
create policy "pm_tasks operator close" on pm_tasks
  for update
  using (
    organization_id = current_org()
    and current_role_name() = 'operator'
    and current_operator_id() is not null
    and status <> 'done'
  )
  with check (
    organization_id = current_org()
    and current_role_name() = 'operator'
    and current_operator_id() is not null
    and (
      (
        status = 'done'
        and current_operator_id() = any(completed_by_operator_ids)
      )
      or (
        status in ('planned', 'postponed')
        and current_operator_id() = any(assigned_operator_ids)
        and cardinality(coalesce(completed_by_operator_ids, '{}'::uuid[])) = 0
      )
    )
  );

create or replace function enforce_operator_pm_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  bad_count int;
  v_op_id uuid;
begin
  if new.completed_by_operator_ids is not null and cardinality(new.completed_by_operator_ids) > 0 then
    select count(*) into bad_count
    from unnest(new.completed_by_operator_ids) as elem
    where not exists (
      select 1 from operators o
      where o.id = elem
        and o.organization_id = new.organization_id
    );
    if bad_count > 0 then
      raise exception 'Actual performer operator does not belong to this organization';
    end if;
  end if;

  if tg_op = 'UPDATE' and current_role_name() = 'operator' then
    v_op_id := current_operator_id();
    if v_op_id is null then
      raise exception 'Operator profile is not linked to an operator record';
    end if;

    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.legacy_key is distinct from old.legacy_key
      or new.activity_type is distinct from old.activity_type
      or new.title is distinct from old.title
      or new.locations is distinct from old.locations
      or new.asset is distinct from old.asset
      or new.assigned_operator_ids is distinct from old.assigned_operator_ids
      or new.scheduled_date is distinct from old.scheduled_date
    then
      raise exception 'Operators may only update status, completed_at, remarks, and completed_by_operator_ids on PM tasks';
    end if;

    if old.status = 'done' then
      raise exception 'Operators cannot reopen or modify completed PM tasks';
    end if;

    if new.status not in ('planned', 'done', 'postponed') then
      raise exception 'Invalid PM task status';
    end if;

    if new.status = 'done' then
      if new.completed_by_operator_ids is null or not (v_op_id = any(new.completed_by_operator_ids)) then
        raise exception 'The operator closing a PM task must be included in completed_by_operator_ids';
      end if;
    else
      if not (v_op_id = any(old.assigned_operator_ids)) then
        raise exception 'Unlisted operators may only close open PM tasks as done';
      end if;
      if cardinality(coalesce(new.completed_by_operator_ids, '{}'::uuid[])) > 0 then
        raise exception 'Open PM tasks cannot record actual performers';
      end if;
    end if;
  end if;

  return new;
end $$;
