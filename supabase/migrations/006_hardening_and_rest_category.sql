-- Hardening & rest category migration:
-- 1. Support explicit 'rest' category on area_codes and reclassify RD (Rest Day).
-- 2. Tighten operator PM close RLS so only assigned linked operators may update,
--    and restrict operator updates via trigger to status, completed_at, and remarks.
-- 3. Prevent deleting, demoting, or deactivating the last active admin in an org.

alter table area_codes drop constraint if exists area_codes_category_check;
alter table area_codes add constraint area_codes_category_check
  check (category in ('station', 'leave', 'holiday', 'rest'));

update area_codes
  set category = 'rest'
  where upper(code) = 'RD';

drop policy if exists "pm_tasks operator close" on pm_tasks;
create policy "pm_tasks operator close" on pm_tasks
  for update
  using (
    organization_id = current_org()
    and current_role_name() = 'operator'
    and current_operator_id() is not null
    and current_operator_id() = any(assigned_operator_ids)
  )
  with check (
    organization_id = current_org()
    and current_role_name() = 'operator'
    and current_operator_id() is not null
    and current_operator_id() = any(assigned_operator_ids)
    and status in ('planned', 'done', 'postponed')
  );

create or replace function enforce_operator_pm_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_role_name() = 'operator' then
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
      raise exception 'Operators may only update status, completed_at, and remarks on assigned PM tasks';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_operator_pm_update on pm_tasks;
create trigger trg_enforce_operator_pm_update
  before update on pm_tasks
  for each row execute function enforce_operator_pm_update();

create or replace function prevent_last_admin_loss() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  remaining_admins int;
begin
  if old.role = 'admin' and old.is_active then
    if tg_op = 'DELETE' or new.role <> 'admin' or not new.is_active then
      select count(*) into remaining_admins
      from user_profiles
      where organization_id = old.organization_id
        and id <> old.id
        and role = 'admin'
        and is_active = true;
      if remaining_admins = 0 and exists (select 1 from organizations where id = old.organization_id) then
        raise exception 'Cannot remove, demote, or deactivate the last active admin in the organization';
      end if;
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_prevent_last_admin_loss on user_profiles;
create trigger trg_prevent_last_admin_loss
  before update or delete on user_profiles
  for each row execute function prevent_last_admin_loss();
