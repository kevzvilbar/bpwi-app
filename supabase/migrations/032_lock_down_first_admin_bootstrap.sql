-- 032: Lock down first-organization and initial-admin bootstrap.
-- Public sign-ups can no longer create an organization or self-claim admin.

create or replace function bootstrap_initial_org_admin(
  p_org_name text default 'BP Waterworks, Inc.',
  p_admin_email text default null,
  p_admin_full_name text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_org_count int;
  v_org_name text := coalesce(nullif(trim(p_org_name), ''), 'BP Waterworks, Inc.');
  v_admin_email text := lower(nullif(trim(coalesce(p_admin_email, '')), ''));
  v_admin_user_id uuid;
  v_admin_full_name text := nullif(trim(coalesce(p_admin_full_name, '')), '');
begin
  perform pg_advisory_xact_lock(hashtext('bpwi_first_org_bootstrap'));

  select count(*)::int into v_org_count from organizations;

  if v_org_count = 0 then
    insert into organizations(name) values (v_org_name) returning id into v_org;
  elsif v_org_count = 1 then
    select id into v_org from organizations limit 1;
  else
    select id into v_org
    from organizations
    where lower(name) = lower(v_org_name)
    limit 1;
    if v_org is null then
      raise exception 'Multiple organizations exist; specify an existing organization name';
    end if;
  end if;

  if v_admin_email is not null then
    select id
    into v_admin_user_id
    from auth.users
    where lower(email) = v_admin_email
    order by created_at asc
    limit 1;

    if v_admin_user_id is null then
      raise exception 'No auth user found for admin email %', v_admin_email;
    end if;

    insert into user_profiles(id, organization_id, full_name, role, is_active)
    values (v_admin_user_id, v_org, v_admin_full_name, 'admin', true)
    on conflict (id) do update
      set organization_id = excluded.organization_id,
          role = 'admin',
          is_active = true,
          full_name = coalesce(excluded.full_name, user_profiles.full_name);
  end if;

  return v_org;
end $$;

revoke all on function bootstrap_initial_org_admin(text, text, text) from public, anon, authenticated;
grant execute on function bootstrap_initial_org_admin(text, text, text) to service_role;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_invited_org uuid;
  v_org_count int;
  v_org uuid;
  v_allowed_domains text[];
  v_email_domain text;
begin
  v_invited_org := nullif(to_jsonb(new)->'raw_app_meta_data'->>'organization_id', '')::uuid;

  if v_invited_org is not null then
    if not exists (select 1 from organizations where id = v_invited_org) then
      raise exception 'Invited organization does not exist';
    end if;
    insert into user_profiles(id, organization_id, full_name, role, is_active)
      values (new.id, v_invited_org, new.raw_user_meta_data->>'full_name', 'viewer', false);
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('bpwi_first_org_bootstrap'));

  select count(*)::int into v_org_count from organizations;

  if v_org_count = 0 then
    raise exception 'Organization is not initialized; run bootstrap_initial_org_admin() before creating users';
  end if;

  if v_org_count > 1 then
    raise exception 'Multiple organizations exist; new users must be invited with an organization_id';
  end if;

  select id, allowed_signup_domains
  into v_org, v_allowed_domains
  from organizations
  limit 1;

  if coalesce(array_length(v_allowed_domains, 1), 0) > 0 then
    v_email_domain := lower(split_part(coalesce(new.email, ''), '@', 2));
    if v_email_domain = ''
       or not exists (
         select 1
         from unnest(v_allowed_domains) as d
         where lower(trim(d)) = v_email_domain
       ) then
      raise exception 'Sign-up restricted to approved email domains';
    end if;
  end if;

  insert into user_profiles(id, organization_id, full_name, role, is_active)
    values (new.id, v_org, new.raw_user_meta_data->>'full_name', 'viewer', false);
  return new;
end $$;
