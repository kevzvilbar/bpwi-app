-- 031: Scope audit_logs per organization and serialize first-org sign-up bootstrap.

alter table audit_logs
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

update audit_logs
set organization_id = coalesce(
  nullif(new_value->>'organization_id', '')::uuid,
  nullif(old_value->>'organization_id', '')::uuid
)
where organization_id is null
  and coalesce(nullif(new_value->>'organization_id', ''), nullif(old_value->>'organization_id', '')) is not null;

create index if not exists idx_audit_logs_org_created
  on audit_logs(organization_id, created_at desc);

create or replace function log_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  v_org := coalesce(
    case when tg_op in ('INSERT', 'UPDATE') then nullif(to_jsonb(new)->>'organization_id', '')::uuid else null end,
    case when tg_op in ('UPDATE', 'DELETE') then nullif(to_jsonb(old)->>'organization_id', '')::uuid else null end,
    current_org()
  );
  if tg_op = 'DELETE' and v_org is not null and not exists (select 1 from organizations where id = v_org) then
    return old;
  end if;
  insert into audit_logs(organization_id, user_id, action, table_name, record_id, old_value, new_value)
  values (
    v_org,
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, ''),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end $$;

drop policy if exists "audit read" on audit_logs;
create policy "audit read" on audit_logs
  for select
  using (organization_id = current_org() and current_role_name() = 'admin');
grant select on audit_logs to authenticated;

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
