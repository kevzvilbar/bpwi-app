-- Enforce admin approval for all new sign-ups (supersedes earlier edited 002_auto_profile.sql)
-- Also notifies active admins in-app when a new user signs up pending approval.

alter table user_profiles
  alter column is_active set default false;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  select id into org from organizations order by name limit 1;
  if org is null then
    insert into organizations(name) values ('BP Waterworks, Inc.') returning id into org;
    insert into user_profiles(id, organization_id, full_name, role, is_active)
      values (new.id, org, new.raw_user_meta_data->>'full_name', 'admin', true);
  else
    insert into user_profiles(id, organization_id, full_name, role, is_active)
      values (new.id, org, new.raw_user_meta_data->>'full_name', 'viewer', false);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Notify active admins when a new pending user signs up
create or replace function notify_admins_on_pending_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_active = false then
    insert into notifications (organization_id, user_id, kind, title, body, href)
    select
      new.organization_id,
      up.id,
      'user_pending',
      'New Sign-Up Pending Approval',
      coalesce(nullif(new.full_name, ''), 'A new user') || ' signed up and is waiting for admin approval.',
      '/operators'
    from user_profiles up
    where up.organization_id = new.organization_id
      and up.is_active = true
      and up.role = 'admin'
      and up.id is distinct from new.id;
  end if;
  return new;
exception when undefined_table then
  return new;
end $$;

drop trigger if exists trg_notify_admins_pending_signup on user_profiles;
create trigger trg_notify_admins_pending_signup
  after insert on user_profiles
  for each row execute function notify_admins_on_pending_signup();

-- Backfill any existing auth.users who signed up without a user_profiles row
do $$
declare
  u record;
  v_org uuid;
begin
  select id into v_org from organizations order by name limit 1;
  if v_org is not null then
    for u in
      select id, email, raw_user_meta_data
      from auth.users
      where id not in (select id from user_profiles)
    loop
      insert into user_profiles(id, organization_id, full_name, role, is_active)
      values (
        u.id,
        v_org,
        coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), u.email),
        'viewer',
        false
      );
    end loop;
  end if;
end $$;
