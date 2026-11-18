-- Department heads: read-only by default, with admin-granted edit windows.
-- Requires 007 (the 'manager' enum value) to have been committed first.
--
--  * user_profiles.job_title   - shown on the Call Sheet escalation list
--  * user_profiles.can_approve - delegated approver flag (used by the upcoming change-request queue)
--  * edit_grants               - a department head may write schedule data only inside a window
--                                (timestamp range, optionally limited to a date range)
--  * Write policies on schedule/standby/leave/PM now allow a 'manager' with a live grant.
--
-- Windows are enforced here, in the database, using the database clock. The UI only reflects it.

alter table user_profiles
  add column if not exists job_title text,
  add column if not exists can_approve boolean not null default false;

-- Admins, plus any active user an admin has delegated approval to.
create or replace function is_approver() returns boolean
language sql stable security definer set search_path = public as
  $$ select coalesce((select is_active and (role = 'admin' or can_approve) from user_profiles where id = auth.uid()), false) $$;

create table if not exists edit_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  user_id uuid not null references user_profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  date_from date,
  date_to date,
  note text,
  granted_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users on delete set null,
  -- A window is at most 14 days. Raise this constraint if you need longer ones.
  constraint edit_grants_window check (ends_at > starts_at and ends_at <= starts_at + interval '14 days'),
  constraint edit_grants_dates check (date_from is null or date_to is null or date_to >= date_from)
);
create index if not exists edit_grants_user_idx on edit_grants (user_id, ends_at);

-- Only department heads can hold a grant.
create or replace function check_edit_grant_target() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from user_profiles
    where id = new.user_id and role = 'manager' and organization_id = new.organization_id
  ) then
    raise exception 'Edit windows can only be granted to department heads in the same organization';
  end if;
  return new;
end $$;
drop trigger if exists trg_check_edit_grant_target on edit_grants;
create trigger trg_check_edit_grant_target before insert on edit_grants
  for each row execute function check_edit_grant_target();

-- True when the current user is an active department head with a live, unrevoked window that
-- covers date d (d = null means "ignore the date range").
create or replace function has_edit_grant(d date default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from edit_grants g
    join user_profiles u on u.id = g.user_id
    where g.user_id = auth.uid()
      and u.is_active
      and u.role = 'manager'
      and g.organization_id = u.organization_id
      and g.revoked_at is null
      and now() >= g.starts_at and now() < g.ends_at
      and (d is null or ((g.date_from is null or d >= g.date_from) and (g.date_to is null or d <= g.date_to)))
  )
$$;

alter table edit_grants enable row level security;
drop policy if exists "edit_grants read" on edit_grants;
create policy "edit_grants read" on edit_grants
  for select using (organization_id = current_org() and (user_id = auth.uid() or current_role_name() = 'admin'));
drop policy if exists "edit_grants admin write" on edit_grants;
create policy "edit_grants admin write" on edit_grants
  for all using (organization_id = current_org() and current_role_name() = 'admin')
  with check (organization_id = current_org() and current_role_name() = 'admin');

drop trigger if exists audit_grants on edit_grants;
create trigger audit_grants after insert or update or delete on edit_grants
  for each row execute function log_audit();

-- Schedule, standby, leave and PM writes: admin/scheduler as before, or a department head
-- inside a live window. For ranges (leave) both ends must fall inside the window's date range.
do $$ declare t text; allowed text; begin
  for t, allowed in
    select * from (values
      ('schedule_assignments', 'has_edit_grant(schedule_date)'),
      ('standby_assignments',  'has_edit_grant(schedule_date)'),
      ('pm_tasks',             'has_edit_grant(scheduled_date)'),
      ('leave_records',        'has_edit_grant(start_date) and has_edit_grant(end_date)')
    ) as v(tbl, cond)
  loop
    execute format('drop policy if exists "%1$s write" on %1$I', t);
    execute format(
      'create policy "%1$s write" on %1$I for all '
      'using (organization_id = current_org() and (current_role_name() in (''admin'',''scheduler'') or (current_role_name() = ''manager'' and %2$s))) '
      'with check (organization_id = current_org() and (current_role_name() in (''admin'',''scheduler'') or (current_role_name() = ''manager'' and %2$s)))',
      t, allowed);
  end loop;
end $$;
