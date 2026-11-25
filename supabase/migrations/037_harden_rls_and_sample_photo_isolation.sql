-- 037: Harden RLS, trigger integrity guards, and sample photo isolation.
--
--  a) Sample photo path isolation in enforce_sample_log_lifecycle(): sample daily_activities may only
--     reference sample-* storage paths and URLs within their own organization.
--  b) purge_expired_sample_records(): only queue sample-* paths owned by the org and never referenced
--     by any non-sample daily_activities row.
--  c) Storage delete policy ("activity-media purge delete"): scope operator deletes to own unverified
--     objects, manager deletes to own/unreferenced sample-* objects, and allow admin/scheduler purge.
--  d) daily_activities: require logged_by = auth.uid() for operator inserts; enforce insert/update
--     integrity and verified-row immutability for non-supervisors in touch_daily_activities_updated_at().
--  e) accomplishment_reports: add guard_accomplishment_report_integrity() trigger and prevent self-review
--     via assigned_head_id = auth.uid() when submitted_by = auth.uid().
--  f) job_orders: remove the `current_operator_id() is null` bypass in "job_orders update" so operators
--     without a linked operator profile cannot update job orders.

-- a) Sample photo path & URL isolation ---------------------------------------------------------------------
create or replace function enforce_sample_log_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_path text;
  v_url text;
  v_resolved text;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.is_sample, false) then
      new.is_sample := true;
      new.sample_expires_at := now() + interval '24 hours';
      if tg_table_name = 'daily_activities' then
        new.photos_expires_at := least(coalesce(new.photos_expires_at, new.sample_expires_at), new.sample_expires_at);
      end if;
    else
      new.is_sample := false;
      new.sample_expires_at := null;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.is_sample is distinct from old.is_sample
       or new.sample_expires_at is distinct from old.sample_expires_at then
      raise exception 'Sample flag and expiry cannot be modified after creation';
    end if;
  end if;

  if tg_table_name = 'daily_activities' and coalesce(new.is_sample, false) then
    if new.photo_storage_paths is not null then
      foreach v_path in array new.photo_storage_paths loop
        v_path := btrim(coalesce(v_path, ''));
        if v_path <> '' then
          if split_part(v_path, '/', 1) is distinct from new.organization_id::text
             or split_part(v_path, '/', 2) = ''
             or split_part(v_path, '/', 3) not like 'sample-%'
             or position('..' in v_path) > 0 then
            raise exception 'Sample activity photos must use sample-* paths within the organization'
              using errcode = '42501';
          end if;
        end if;
      end loop;
    end if;

    if new.photo_urls is not null then
      foreach v_url in array new.photo_urls loop
        v_url := btrim(coalesce(v_url, ''));
        if v_url like '%path=%' then
          v_resolved := regexp_replace(coalesce(substring(v_url from 'path=([^&#]+)'), ''), '%2[Ff]', '/', 'g');
          if v_resolved = ''
             or split_part(v_resolved, '/', 1) is distinct from new.organization_id::text
             or split_part(v_resolved, '/', 2) = ''
             or split_part(v_resolved, '/', 3) not like 'sample-%'
             or position('..' in v_resolved) > 0 then
            raise exception 'Sample activity photo URLs must reference sample-* objects within the organization'
              using errcode = '42501';
          end if;
        end if;
        if v_url like '%/activity-media/%' then
          v_resolved := regexp_replace(coalesce(substring(v_url from '/activity-media/([^?#]+)'), ''), '%2[Ff]', '/', 'g');
          if v_resolved = ''
             or split_part(v_resolved, '/', 1) is distinct from new.organization_id::text
             or split_part(v_resolved, '/', 2) = ''
             or split_part(v_resolved, '/', 3) not like 'sample-%'
             or position('..' in v_resolved) > 0 then
            raise exception 'Sample activity photo URLs must reference sample-* objects within the organization'
              using errcode = '42501';
          end if;
        end if;
      end loop;
    end if;
  end if;

  return new;
end $$;

-- b) Sample cleanup queue isolation ------------------------------------------------------------------------
create or replace function purge_expired_sample_records()
returns table(
  activities_deleted int,
  job_orders_deleted int,
  handovers_deleted int,
  reports_deleted int
)
language plpgsql security definer set search_path = public as $$
declare
  v_act int := 0;
  v_jo int := 0;
  v_ho int := 0;
  v_rep int := 0;
begin
  insert into sample_photo_cleanup (organization_id, storage_path)
  select distinct a.organization_id, x.p
  from daily_activities a
  cross join lateral (
    select unnest(a.photo_storage_paths) as p
    union
    select regexp_replace(substring(u from 'path=([^&]+)'), '%2[Ff]', '/', 'g')
    from unnest(a.photo_urls) as u
  ) x
  where a.is_sample = true
    and a.sample_expires_at <= now()
    and x.p is not null
    and split_part(x.p, '/', 1) = a.organization_id::text
    and split_part(x.p, '/', 3) like 'sample-%'
    and not exists (
      select 1
      from daily_activities live
      where live.organization_id = a.organization_id
        and not live.is_sample
        and (
          x.p = any(live.photo_storage_paths)
          or exists (
            select 1
            from unnest(live.photo_urls) lu
            where regexp_replace(substring(lu from 'path=([^&]+)'), '%2[Ff]', '/', 'g') = x.p
               or regexp_replace(substring(lu from '/activity-media/([^?#]+)'), '%2[Ff]', '/', 'g') = x.p
          )
        )
    )
  on conflict (organization_id, storage_path) do nothing;

  delete from daily_activities where is_sample = true and sample_expires_at <= now();
  get diagnostics v_act = row_count;

  delete from job_orders where is_sample = true and sample_expires_at <= now();
  get diagnostics v_jo = row_count;

  delete from shift_handovers where is_sample = true and sample_expires_at <= now();
  get diagnostics v_ho = row_count;

  delete from accomplishment_reports where is_sample = true and sample_expires_at <= now();
  get diagnostics v_rep = row_count;

  return query select v_act, v_jo, v_ho, v_rep;
end $$;

revoke all on function purge_expired_sample_records() from public, anon, authenticated;
grant execute on function purge_expired_sample_records() to service_role;

-- c) Tighten storage.objects "activity-media purge delete" policy -----------------------------------------
-- Uses a security definer helper so daily_activities RLS does not hide real/other-user references.
create or replace function activity_media_is_protected(p_name text, p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from daily_activities da
    where da.organization_id = current_org()
      and (
        (p_role = 'manager' and (not da.is_sample or da.logged_by is distinct from auth.uid()))
        or (p_role = 'operator' and (da.status = 'verified' or da.logged_by is distinct from auth.uid()))
      )
      and (
        p_name = any(da.photo_storage_paths)
        or exists (
          select 1
          from unnest(da.photo_urls) u
          where regexp_replace(substring(u from 'path=([^&#]+)'), '%2[Ff]', '/', 'g') = p_name
             or regexp_replace(substring(u from '/activity-media/([^?#]+)'), '%2[Ff]', '/', 'g') = p_name
        )
      )
  );
$$;

revoke all on function activity_media_is_protected(text, text) from public, anon;
grant execute on function activity_media_is_protected(text, text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "activity-media purge delete" on storage.objects;
    create policy "activity-media purge delete" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'activity-media'
        and split_part(name, '/', 1) = public.current_org()::text
        and exists (
          select 1 from public.user_profiles
          where id = auth.uid() and is_active
            and (
              role in ('admin', 'scheduler')
              or (
                role = 'manager'
                and split_part(name, '/', 3) like 'sample-%'
                and not public.activity_media_is_protected(name, 'manager')
              )
              or (
                role = 'operator'
                and owner = auth.uid()
                and not public.activity_media_is_protected(name, 'operator')
              )
            )
        )
      );
  end if;
exception when others then
  null;
end $$;

-- d) Harden daily_activities insert policy & insert/update integrity trigger -------------------------------
drop policy if exists "daily_activities insert" on daily_activities;
create policy "daily_activities insert" on daily_activities
  for insert with check (
    organization_id = current_org()
    and (
      current_role_name() = 'admin'
      or (current_role_name() = 'operator' and not is_sample and logged_by = auth.uid())
      or (current_role_name() = 'manager' and is_sample and logged_by = auth.uid())
    )
  );

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
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_daily_activities_updated_at on daily_activities;
create trigger trg_daily_activities_updated_at
  before insert or update on daily_activities
  for each row execute function touch_daily_activities_updated_at();

-- e) Harden accomplishment_reports integrity trigger & update RLS ------------------------------------------
create or replace function guard_accomplishment_report_integrity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and current_role_name() not in ('admin', 'scheduler', 'manager') then
    if tg_op = 'INSERT' then
      if new.status not in ('draft', 'submitted') then
        raise exception 'Non-supervisors may only create draft or submitted accomplishment reports'
          using errcode = '42501';
      end if;
      if new.checked_by is not null or new.checked_at is not null or new.head_remarks is not null then
        raise exception 'Non-supervisors cannot set review fields on insert'
          using errcode = '42501';
      end if;
      if new.assigned_head_id = auth.uid() then
        raise exception 'Submitters cannot assign themselves as reviewing head'
          using errcode = '42501';
      end if;
    elsif tg_op = 'UPDATE' then
      if old.status = 'checked' then
        raise exception 'Checked accomplishment reports cannot be modified'
          using errcode = '42501';
      end if;

      if old.assigned_head_id = auth.uid() and old.submitted_by is distinct from auth.uid() then
        if new.submitted_by is distinct from old.submitted_by then
          raise exception 'Accomplishment report submitter cannot be changed'
            using errcode = '42501';
        end if;
      else
        if new.status not in ('draft', 'submitted') then
          raise exception 'Only assigned department heads or supervisors can check or return reports'
            using errcode = '42501';
        end if;
        if new.assigned_head_id = auth.uid() then
          raise exception 'Submitters cannot assign themselves as reviewing head'
            using errcode = '42501';
        end if;
        if new.submitted_by is distinct from old.submitted_by then
          raise exception 'Accomplishment report submitter cannot be changed'
            using errcode = '42501';
        end if;
        if new.checked_by is distinct from old.checked_by
           or new.checked_at is distinct from old.checked_at
           or new.checked_by_name is distinct from old.checked_by_name
           or new.checked_by_title is distinct from old.checked_by_title
           or new.head_remarks is distinct from old.head_remarks then
          raise exception 'Only assigned department heads or supervisors can modify review fields'
            using errcode = '42501';
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_accomplishment_report_check on accomplishment_reports;
drop trigger if exists trg_accomplishment_reports_integrity on accomplishment_reports;
create trigger trg_accomplishment_reports_integrity
  before insert or update on accomplishment_reports
  for each row execute function guard_accomplishment_report_integrity();

drop policy if exists "accomplishment_reports update" on accomplishment_reports;
create policy "accomplishment_reports update" on accomplishment_reports
  for update using (
    organization_id = current_org()
    and (
      (not is_sample and (
        current_role_name() in ('admin', 'scheduler', 'manager')
        or (assigned_head_id = auth.uid() and submitted_by is distinct from auth.uid())
        or (submitted_by = auth.uid() and status in ('draft', 'returned', 'submitted'))
      ))
      or (is_sample and (submitted_by = auth.uid() or current_role_name() = 'admin'))
    )
  ) with check (
    organization_id = current_org()
    and (
      (not is_sample and (
        current_role_name() in ('admin', 'scheduler', 'manager')
        or (assigned_head_id = auth.uid() and submitted_by is distinct from auth.uid())
        or (submitted_by = auth.uid() and status in ('draft', 'submitted'))
      ))
      or (is_sample and (submitted_by = auth.uid() or current_role_name() = 'admin'))
    )
  );

-- f) Fix job_orders update policy (remove current_operator_id() is null bypass) -------------------------
drop policy if exists "job_orders update" on job_orders;
create policy "job_orders update" on job_orders
  for update using (
    organization_id = current_org()
    and (
      (not is_sample and (
        current_role_name() in ('admin', 'scheduler', 'manager')
        or (
          current_role_name() = 'operator'
          and current_operator_id() is not null
          and (
            current_operator_id() = any(assigned_operator_ids)
            or cardinality(assigned_operator_ids) = 0
          )
        )
      ))
      or (is_sample and (created_by = auth.uid() or current_role_name() = 'admin'))
    )
  ) with check (
    organization_id = current_org()
    and (
      (not is_sample and (
        current_role_name() in ('admin', 'scheduler', 'manager')
        or (
          current_role_name() = 'operator'
          and current_operator_id() is not null
        )
      ))
      or (is_sample and (created_by = auth.uid() or current_role_name() = 'admin'))
    )
  );
