-- 035: Department heads may edit / delete SAMPLE logs only, plus hardened 24h sample cleanup.
--
--  1. guard_dept_head_real_log_changes(): a department head (role = 'manager') can no longer update or
--     delete REAL rows in daily_activities, job_orders, shift_handovers or accomplishment_reports.
--     Review actions stay possible because they are supervision, not edits:
--       * daily_activities       -> status verified/flagged (+ verified_by, verified_at, review_note)
--       * accomplishment_reports -> status checked/returned (+ checked_*, head_remarks)
--     Sample rows (is_sample = true) stay fully editable/deletable by their creator under the 034 policies.
--     Admins, schedulers, operators and service_role are untouched.
--  2. Sample cleanup no longer depends on the Vercel cron: purge_expired_sample_records() queues the
--     photo paths of expiring samples in sample_photo_cleanup and then deletes ALL expired samples in SQL
--     (pg_cron hourly, or the cron route as a fallback). The route only drains the file queue.
--     sample_cleanup_health() lets admins see when cleanup is overdue (e.g. pg_cron / cron secret missing).
--  3. Storage: department heads may upload/delete only 'sample-*' photo objects in activity-media.
--  4. Indexes for the hot PM / job-order reads.

-- 1. Department heads: real logs are read-only (review actions excepted) ---------------------------------
create or replace function guard_dept_head_real_log_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_allowed text[];
  v_bad text[] := '{}';
begin
  -- Only real signed-in department heads are restricted. service_role / SQL editor (auth.uid() is null)
  -- and every other role pass through untouched.
  if auth.uid() is null or current_role_name() is distinct from 'manager' then
    return coalesce(new, old);
  end if;

  -- Sample rows are the department head's sandbox (visibility/ownership enforced by the 034 policies).
  if coalesce(old.is_sample, false) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Department heads can only delete sample logs, not real records (%)', tg_table_name
      using errcode = '42501';
  end if;

  v_allowed := case tg_table_name
    when 'daily_activities' then array['status', 'verified_by', 'verified_at', 'review_note']
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

do $$
declare
  tbl text;
begin
  foreach tbl in array array['daily_activities', 'job_orders', 'shift_handovers', 'accomplishment_reports'] loop
    execute format('drop trigger if exists %I on %I', 'trg_' || tbl || '_dept_head_guard', tbl);
    execute format(
      'create trigger %I before update or delete on %I for each row execute function guard_dept_head_real_log_changes()',
      'trg_' || tbl || '_dept_head_guard',
      tbl
    );
  end loop;
end $$;

-- 2. Sample cleanup: photo queue + self-sufficient SQL purge ---------------------------------------------
create table if not exists sample_photo_cleanup (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  storage_path text not null,
  queued_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  unique (organization_id, storage_path)
);
create index if not exists sample_photo_cleanup_queued_idx on sample_photo_cleanup (queued_at);

-- Service-role only: no policies are defined, and direct grants are removed for API roles.
alter table sample_photo_cleanup enable row level security;
revoke all on sample_photo_cleanup from public, anon, authenticated;
grant select, insert, update, delete on sample_photo_cleanup to service_role;

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
  -- Queue the Storage objects of expiring sample activities first, so the rows can be deleted on time
  -- without orphaning files. The cron route removes the queued objects and retries failures.
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
    and x.p like a.organization_id::text || '/%'
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

-- Admin-only health probe used by the app to warn when the 24h cleanup is not running.
create or replace function sample_cleanup_health() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := current_org();
  v_overdue int := 0;
  v_queued int := 0;
  v_oldest_hours numeric := 0;
  v_cron boolean := false;
begin
  if current_role_name() is distinct from 'admin' then
    raise exception 'Only admins can view sample cleanup health' using errcode = '42501';
  end if;

  select
    (select count(*) from daily_activities where organization_id = v_org and is_sample and sample_expires_at < now() - interval '2 hours')
    + (select count(*) from job_orders where organization_id = v_org and is_sample and sample_expires_at < now() - interval '2 hours')
    + (select count(*) from shift_handovers where organization_id = v_org and is_sample and sample_expires_at < now() - interval '2 hours')
    + (select count(*) from accomplishment_reports where organization_id = v_org and is_sample and sample_expires_at < now() - interval '2 hours')
  into v_overdue;

  select count(*), coalesce(round(extract(epoch from (now() - min(queued_at))) / 3600.0, 1), 0)
  into v_queued, v_oldest_hours
  from sample_photo_cleanup where organization_id = v_org;

  begin
    if to_regclass('cron.job') is not null then
      execute $q$select exists (select 1 from cron.job where jobname = 'bpwi-purge-expired-samples' and active)$q$ into v_cron;
    end if;
  exception when others then
    v_cron := false;
  end;

  return jsonb_build_object(
    'overdue_samples', v_overdue,
    'queued_photos', v_queued,
    'oldest_queued_hours', v_oldest_hours,
    'pg_cron_scheduled', v_cron
  );
end $$;

revoke all on function sample_cleanup_health() from public, anon;
grant execute on function sample_cleanup_health() to authenticated;

do $$
begin
  perform cron.schedule(
    'bpwi-purge-expired-samples',
    '15 * * * *',
    $job$select public.purge_expired_sample_records();$job$
  );
exception when others then
  null;
end $$;

-- 3. Storage: department heads handle 'sample-*' objects only -------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "activity-media operator admin insert" on storage.objects;
    create policy "activity-media operator admin insert" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'activity-media'
        and split_part(name, '/', 1) = public.current_org()::text
        and exists (
          select 1 from public.user_profiles
          where id = auth.uid() and is_active
            and (
              role in ('operator', 'admin')
              or (role = 'manager' and split_part(name, '/', 3) like 'sample-%')
            )
        )
      );

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
              role in ('operator', 'admin', 'scheduler')
              or (role = 'manager' and split_part(name, '/', 3) like 'sample-%')
            )
        )
      );
  end if;
exception when others then
  null;
end $$;

-- 4. Indexes for hot reads --------------------------------------------------------------------------------
create index if not exists pm_tasks_org_scheduled_idx on pm_tasks (organization_id, scheduled_date);
create index if not exists pm_tasks_org_open_idx on pm_tasks (organization_id, scheduled_date) where status <> 'done';
create index if not exists pm_tasks_org_completed_idx on pm_tasks (organization_id, completed_at) where completed_at is not null;
create index if not exists job_orders_org_created_idx on job_orders (organization_id, created_at desc);
