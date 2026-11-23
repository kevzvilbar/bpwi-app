-- 030: Harden user sign-up provisioning (multi-tenant invite + optional email-domain allowlist)
--      and add audit logging trigger on user_profiles role/approval/status changes.

alter table organizations
  add column if not exists allowed_signup_domains text[] not null default '{}';

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

  select count(*)::int into v_org_count from organizations;

  if v_org_count = 0 then
    insert into organizations(name) values ('BP Waterworks, Inc.') returning id into v_org;
    insert into user_profiles(id, organization_id, full_name, role, is_active)
      values (new.id, v_org, new.raw_user_meta_data->>'full_name', 'admin', true);
    return new;
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

drop trigger if exists audit_user_profiles on user_profiles;
create trigger audit_user_profiles
  after insert or update or delete on user_profiles
  for each row execute function log_audit();
