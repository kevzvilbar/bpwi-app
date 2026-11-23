-- PM Actual Performer Credit Migration:
-- 1. Add completed_by_operator_ids to pm_tasks so Planned Assignees (assigned_operator_ids) stay
--    preserved for audit while Actual Performers receive KPI, duty-matrix, and history credit.
-- 2. Backfill historical completed tasks that have empty completed_by_operator_ids.
-- 3. Allow any active linked operator in the organization to close/complete an open PM task as a substitute.
-- 4. Allow operators to update completed_by_operator_ids (while still locking planned assignees/date/title)
--    and validate that every actual performer belongs to the task's organization.

alter table pm_tasks
  add column if not exists completed_by_operator_ids uuid[] not null default '{}';

create index if not exists pm_tasks_completed_by_gin_idx
  on pm_tasks using gin (completed_by_operator_ids);

update pm_tasks
  set completed_by_operator_ids = assigned_operator_ids
  where status = 'done'
    and cardinality(completed_by_operator_ids) = 0
    and cardinality(assigned_operator_ids) > 0;

drop policy if exists "pm_tasks operator close" on pm_tasks;
create policy "pm_tasks operator close" on pm_tasks
  for update
  using (
    organization_id = current_org()
    and current_role_name() = 'operator'
    and current_operator_id() is not null
  )
  with check (
    organization_id = current_org()
    and current_role_name() = 'operator'
    and current_operator_id() is not null
    and status in ('planned', 'done', 'postponed')
  );

create or replace function enforce_operator_pm_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  bad_count int;
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
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_operator_pm_update on pm_tasks;
create trigger trg_enforce_operator_pm_update
  before insert or update on pm_tasks
  for each row execute function enforce_operator_pm_update();
