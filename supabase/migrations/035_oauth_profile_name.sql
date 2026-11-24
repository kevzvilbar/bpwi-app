-- 035: Support OAuth metadata fallback (`name`) in handle_new_user() when `full_name` is absent.
-- Preserves all invite, bootstrap, single-org domain-allowlist, and pending-viewer defaults from 032.

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_invited_org uuid;
  v_org_count int;
  v_org uuid;
  v_allowed_domains text[];
  v_email_domain text;
  v_full_name text := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'name', '')), '')
  );
begin
  v_invited_org := nullif(to_jsonb(new)->'raw_app_meta_data'->>'organization_id', '')::uuid;

  if v_invited_org is not null then
    if not exists (select 1 from organizations where id = v_invited_org) then
      raise exception 'Invited organization does not exist';
    end if;
    insert into user_profiles(id, organization_id, full_name, role, is_active)
      values (new.id, v_invited_org, v_full_name, 'viewer', false);
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
    values (new.id, v_org, v_full_name, 'viewer', false);
  return new;
end $$;
