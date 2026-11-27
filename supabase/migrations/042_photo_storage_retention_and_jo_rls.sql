-- 042: Scope photo storage reads by daily_activities RLS, extend evidence photo retention/hold,
--      expand 365-day telemetry PII purge, and restrict job_orders reads away from viewer.

-- a) Scope 'activity-media' bucket reads to rows visible to the caller via daily_activities RLS -------
create or replace function public.activity_media_is_referenced(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.daily_activities da
    where da.organization_id = public.current_org()
      and (
        da.photo_storage_paths @> array[p_name]
        or exists (
          select 1
          from unnest(da.photo_urls) u
          where regexp_replace(substring(u from 'path=([^&#]+)'), '%2[Ff]', '/', 'g') = p_name
             or regexp_replace(substring(u from '/activity-media/([^?#]+)'), '%2[Ff]', '/', 'g') = p_name
        )
      )
  );
$$;

revoke all on function public.activity_media_is_referenced(text) from public, anon;
grant execute on function public.activity_media_is_referenced(text) to authenticated;

do $$
declare
  v_has_owner boolean;
  v_unattached_expr text;
begin
  if to_regclass('storage.objects') is not null then
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'storage'
        and table_name = 'objects'
        and column_name = 'owner'
    ) into v_has_owner;

    v_unattached_expr := case
      when v_has_owner then
        $expr$owner = auth.uid() or public.current_role_name() in ('admin', 'scheduler')$expr$
      else
        $expr$public.current_role_name() in ('admin', 'scheduler')$expr$
    end;

    execute 'drop policy if exists "activity-media org read" on storage.objects';
    execute format(
      $policy$
      create policy "activity-media org read" on storage.objects
        for select to authenticated
        using (
          bucket_id = 'activity-media'
          and split_part(name, '/', 1) = public.current_org()::text
          and (
            exists (
              select 1
              from public.daily_activities da
              where da.organization_id = public.current_org()
                and (
                  da.photo_storage_paths @> array[name]
                  or exists (
                    select 1
                    from unnest(da.photo_urls) u
                    where regexp_replace(substring(u from 'path=([^&#]+)'), '%%2[Ff]', '/', 'g') = name
                       or regexp_replace(substring(u from '/activity-media/([^?#]+)'), '%%2[Ff]', '/', 'g') = name
                  )
                )
            )
            or (
              not public.activity_media_is_referenced(name)
              and (%s)
            )
          )
        )
      $policy$,
      v_unattached_expr
    );
  end if;
end $$;

-- b) Evidence photo hold columns & 30d/180d/365d trigger enforcement on daily_activities --------------
alter table daily_activities
  add column if not exists photo_hold boolean not null default false,
  add column if not exists photo_hold_by uuid references auth.users(id) on delete set null,
  add column if not exists photo_hold_at timestamptz;

create or replace function touch_daily_activities_updated_at() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and current_role_name() not in ('admin', 'scheduler', 'manager') then
    if tg_op = 'INSERT' then
      if new.status not in ('draft', 'submitted') then
        raise exception 'Operators may only insert draft or submitted activity logs' using errcode = '42501';
      end if;
      if new.verified_by is not null or new.verified_at is not null or new.review_note is not null then
        raise exception 'Operators cannot set verification fields on insert' using errcode = '42501';
      end if;
      if new.logged_by is distinct from auth.uid() then
        raise exception 'Operators can only log activities under their own user ID' using errcode = '42501';
      end if;
      if coalesce(new.photo_hold, false) or new.photo_hold_by is not null or new.photo_hold_at is not null then
        raise exception 'Only supervisors can place an evidence photo hold' using errcode = '42501';
      end if;
    elsif tg_op = 'UPDATE' then
      if old.status = 'verified' then
        raise exception 'Verified activity logs cannot be modified by operators' using errcode = '42501';
      end if;
      if new.status in ('verified', 'flagged') and new.status is distinct from old.status then
        raise exception 'Only admins, schedulers, or department heads can verify or flag activities' using errcode = '42501';
      end if;
      if new.verified_by is distinct from old.verified_by
         or new.verified_at is distinct from old.verified_at
         or new.review_note is distinct from old.review_note then
        raise exception 'Only supervisors can modify verification fields' using errcode = '42501';
      end if;
      if new.logged_by is distinct from old.logged_by then
        raise exception 'Activity log creator cannot be reassigned' using errcode = '42501';
      end if;
      if new.photo_hold is distinct from old.photo_hold
         or new.photo_hold_by is distinct from old.photo_hold_by
         or new.photo_hold_at is distinct from old.photo_hold_at then
        raise exception 'Only supervisors can modify photo holds' using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- Authoritative server receipt timestamp; created_at retains device offline capture time.
    new.received_at := now();
    if not coalesce(new.is_sample, false)
       and new.activity_type in ('meter_test', 'leak_repair')
       and (coalesce(array_length(new.photo_urls, 1), 0) > 0 or coalesce(array_length(new.photo_storage_paths, 1), 0) > 0)
       and new.photos_expires_at is null then
      new.photos_expires_at := now() + interval '180 days';
    end if;
  elsif tg_op = 'UPDATE' then
    new.received_at := old.received_at;
    new.updated_at := now();
  end if;

  if not coalesce(new.is_sample, false) and new.photos_expires_at is not null then
    new.photos_expires_at := least(new.photos_expires_at, coalesce(new.created_at, now()) + interval '365 days');
  end if;

  return new;
end $$;

drop trigger if exists trg_daily_activities_updated_at on daily_activities;
create trigger trg_daily_activities_updated_at
  before insert or update on daily_activities
  for each row execute function touch_daily_activities_updated_at();

create or replace function guard_dept_head_real_log_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_allowed text[];
  v_bad text[] := '{}';
begin
  if auth.uid() is null or current_role_name() is distinct from 'manager' then
    return coalesce(new, old);
  end if;

  if coalesce(old.is_sample, false) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Department heads can only delete sample logs, not real records (%)', tg_table_name
      using errcode = '42501';
  end if;

  v_allowed := case tg_table_name
    when 'daily_activities' then array['status', 'verified_by', 'verified_at', 'review_note', 'photo_hold', 'photo_hold_by', 'photo_hold_at']
    when 'accomplishment_reports' then array['status', 'checked_by', 'checked_at', 'checked_by_name', 'checked_by_title', 'head_remarks']
    else array[]::text[]
  end;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  for v_key in select key from jsonb_each(v_new) loop
    if v_key = 'updated_at' then
      continue;
    end if;
    if (v_new -> v_key) is distinct from (v_old -> v_key) and not (v_key = any (v_allowed)) then
      v_bad := v_bad || v_key;
    end if;
  end loop;

  if cardinality(v_bad) > 0 then
    raise exception 'Department heads can only edit sample logs; real % rows are read-only (changed: %)',
      tg_table_name, array_to_string(v_bad, ', ')
      using errcode = '42501';
  end if;

  if tg_table_name = 'daily_activities'
     and new.status is distinct from old.status
     and new.status not in ('verified', 'flagged') then
    raise exception 'Department heads may only verify or flag real activity logs' using errcode = '42501';
  end if;

  if tg_table_name = 'accomplishment_reports'
     and new.status is distinct from old.status
     and new.status not in ('checked', 'returned') then
    raise exception 'Department heads may only check or return real accomplishment reports' using errcode = '42501';
  end if;

  return new;
end $$;

-- c) Expanded 365-day PII cleanup (preserves job_orders.account_number for billing audit) ------------
create or replace function purge_expired_telemetry_pii(p_retention_days int default 365)
returns table(activities_scrubbed int, job_orders_scrubbed int)
language plpgsql security definer set search_path = public as $$
declare
  v_act int := 0;
  v_jo int := 0;
begin
  if p_retention_days is null or p_retention_days < 30 then
    raise exception 'Retention period must be at least 30 days'
      using errcode = '22023';
  end if;

  update daily_activities
  set gps_lat = null,
      gps_lng = null,
      signature_data = null,
      details = coalesce(details, '{}'::jsonb) - 'gpsSource' - 'gpsAccuracyM' - 'witnessedBy' - 'witnessName' - 'accountName'
  where not is_sample
    and created_at < now() - make_interval(days => p_retention_days)
    and (
      gps_lat is not null
      or gps_lng is not null
      or signature_data is not null
      or details ? 'gpsSource'
      or details ? 'gpsAccuracyM'
      or details ? 'witnessedBy'
      or details ? 'witnessName'
      or details ? 'accountName'
    );
  get diagnostics v_act = row_count;

  update job_orders
  set contact_number = null,
      account_name = null
  where not is_sample
    and status in ('completed', 'cancelled')
    and coalesce(completed_at, updated_at, created_at) < now() - make_interval(days => p_retention_days)
    and (contact_number is not null or account_name is not null);
  get diagnostics v_jo = row_count;

  return query select v_act, v_jo;
end $$;

revoke all on function purge_expired_telemetry_pii(int) from public, anon, authenticated;
grant execute on function purge_expired_telemetry_pii(int) to service_role;

-- d) Exclude 'viewer' role from reading customer job_orders --------------------------------------------
drop policy if exists "job_orders read" on job_orders;
create policy "job_orders read" on job_orders
  for select using (
    organization_id = current_org()
    and current_role_name() in ('admin', 'scheduler', 'manager', 'operator')
    and (
      not is_sample
      or (sample_expires_at > now() and (created_by = auth.uid() or current_role_name() = 'admin'))
    )
  );
