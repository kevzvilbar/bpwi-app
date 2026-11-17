-- Link user_profiles to an operator record and allow operators to close/update PM tasks.
alter table user_profiles
  add column if not exists operator_id uuid references operators(id) on delete set null;

create or replace function current_operator_id() returns uuid
language sql stable security definer set search_path = public as
  $$ select operator_id from user_profiles where id = auth.uid() and is_active $$;

drop policy if exists "pm_tasks operator close" on pm_tasks;
create policy "pm_tasks operator close" on pm_tasks
  for update
  using (
    organization_id = current_org()
    and current_role_name() = 'operator'
    and (current_operator_id() is null or current_operator_id() = any(assigned_operator_ids))
  )
  with check (
    organization_id = current_org()
    and current_role_name() = 'operator'
    and status in ('planned', 'done', 'postponed')
  );
