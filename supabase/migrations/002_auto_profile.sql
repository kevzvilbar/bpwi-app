-- Auto-provision a user_profiles row on sign-up.
--  * No organization yet  -> create 'BP Waterworks, Inc.' and make this first user an admin.
--  * Organization exists  -> join it as a read-only 'viewer' (an admin can promote later).
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  select id into org from organizations order by name limit 1;
  if org is null then
    insert into organizations(name) values ('BP Waterworks, Inc.') returning id into org;
    insert into user_profiles(id, organization_id, full_name, role)
      values (new.id, org, new.raw_user_meta_data->>'full_name', 'admin');
  else
    insert into user_profiles(id, organization_id, full_name, role)
      values (new.id, org, new.raw_user_meta_data->>'full_name', 'viewer');
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- Backfill: users who already signed up without a profile (first one becomes admin if no org exists).
do $$ declare u record; org uuid; begin
  for u in select id, raw_user_meta_data from auth.users where id not in (select id from user_profiles) order by created_at loop
    select id into org from organizations order by name limit 1;
    if org is null then
      insert into organizations(name) values ('BP Waterworks, Inc.') returning id into org;
      insert into user_profiles(id, organization_id, full_name, role) values (u.id, org, u.raw_user_meta_data->>'full_name', 'admin');
    else
      insert into user_profiles(id, organization_id, full_name, role) values (u.id, org, u.raw_user_meta_data->>'full_name', 'viewer');
    end if;
  end loop;
end $$;
