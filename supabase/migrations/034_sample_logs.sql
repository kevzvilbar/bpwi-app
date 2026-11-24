-- 034: 24-hour auto-expiring Sample Logs across daily_activities, job_orders, shift_handovers, and accomplishment_reports.
-- Preserves existing real-log permissions while allowing admins and department heads (managers)
-- to create auto-expiring 24h sample entries visible only to their creator and admins.

-- 1. Add sample tracking columns & expiry indexes to all four log tables
do $$
declare
  tbl text;
begin
  foreach tbl in array array['daily_activities', 'job_orders', 'shift_handovers', 'accomplishment_reports'] loop
    execute format('alter table %I add column if not exists is_sample boolean not null default false', tbl);
    execute format('alter table %I add column if not exists sample_expires_at timestamptz', tbl);
    execute format(
      'create index if not exists %I on %I (organization_id, sample_expires_at) where is_sample = true',
      'idx_' || tbl || '_sample_expiry',
      tbl
    );
  end loop;
end $$;

-- 2. Enforce server-side 24h expiry on INSERT and immutability of sample flags/expiry on UPDATE
create or replace function enforce_sample_log_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
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
    return new;
  end if;

  if new.is_sample is distinct from old.is_sample
     or new.sample_expires_at is distinct from old.sample_expires_at then
    raise exception 'Sample flag and expiry cannot be modified after creation';
  end if;
  return new;
end $$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['daily_activities', 'job_orders', 'shift_handovers', 'accomplishment_reports'] loop
    execute format('drop trigger if exists %I on %I', 'trg_' || tbl || '_sample_lifecycle', tbl);
    execute format(
      'create trigger %I before insert or update on %I for each row execute function enforce_sample_log_lifecycle()',
      'trg_' || tbl || '_sample_lifecycle',
      tbl
    );
  end loop;
end $$;

-- 3. Keep sample job orders on a dedicated SAMPLE-JO-YYYYMM-NNN sequence so real JO numbers are untouched
create or replace function assign_job_order_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ym text;
  next_seq int;
begin
  if coalesce(new.is_sample, false) then
    if new.jo_number is null or btrim(new.jo_number) = '' or upper(btrim(new.jo_number)) = 'AUTO' then
      ym := to_char(now() at time zone 'Asia/Manila', 'YYYYMM');
      perform pg_advisory_xact_lock(hashtext(new.organization_id::text || '-SAMPLE-' || ym));
      select coalesce(max((regexp_match(jo_number, '^SAMPLE-JO-' || ym || '-([0-9]+)$'))[1]::int), 0) + 1
        into next_seq
        from job_orders
        where organization_id = new.organization_id
          and jo_number like ('SAMPLE-JO-' || ym || '-%');
      new.jo_number := 'SAMPLE-JO-' || ym || '-' || lpad(next_seq::text, 3, '0');
    elsif upper(btrim(new.jo_number)) not like 'SAMPLE-%' then
      new.jo_number := 'SAMPLE-' || btrim(new.jo_number);
    end if;
    return new;
  end if;

  if new.jo_number is null or btrim(new.jo_number) = '' or upper(btrim(new.jo_number)) = 'AUTO' then
    ym := to_char(now() at time zone 'Asia/Manila', 'YYYYMM');
    perform pg_advisory_xact_lock(hashtext(new.organization_id::text || '-' || ym));
    select coalesce(max((regexp_match(jo_number, '^JO-' || ym || '-([0-9]+)$'))[1]::int), 0) + 1
      into next_seq
      from job_orders
      where organization_id = new.organization_id
        and jo_number like ('JO-' || ym || '-%');
    new.jo_number := 'JO-' || ym || '-' || lpad(next_seq::text, 3, '0');
  end if;
  return new;
end $$;

-- 4. Skip log_audit() for sample rows so transient test records never linger in audit_logs
create or replace function log_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_is_sample boolean;
begin
  v_is_sample := coalesce(
    case when tg_op in ('INSERT', 'UPDATE') then (to_jsonb(new)->>'is_sample')::boolean
         else (to_jsonb(old)->>'is_sample')::boolean end,
    false
  );
  if v_is_sample then
    return coalesce(new, old);
  end if;

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

-- 5. Skip accomplishment report notifications for sample reports
create or replace function notify_on_accomplishment_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_sample, false) then
    return new;
  end if;

  if (tg_op = 'INSERT' and new.status = 'submitted')
     or (tg_op = 'UPDATE' and new.status = 'submitted' and old.status is distinct from 'submitted') then
    if new.assigned_head_id is not null and new.assigned_head_id is distinct from new.submitted_by then
      insert into notifications (organization_id, user_id, kind, title, body, href)
      values (
        new.organization_id,
        new.assigned_head_id,
        'report_submitted',
        'New Accomplishment Report',
        coalesce(nullif(new.prepared_by_name, ''), 'Staff') || ' submitted BPEMS-F-002 for ' || new.report_date::text,
        '/reports'
      );
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'checked' and old.status is distinct from 'checked' then
    if new.submitted_by is not null and new.submitted_by is distinct from new.checked_by then
      insert into notifications (organization_id, user_id, kind, title, body, href)
      values (
        new.organization_id,
        new.submitted_by,
        'report_checked',
        'Accomplishment Report Checked',
        coalesce(nullif(new.checked_by_name, ''), 'Department Head') || ' checked your report for ' || new.report_date::text,
        '/reports'
      );
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'returned' and old.status is distinct from 'returned' then
    if new.submitted_by is not null then
      insert into notifications (organization_id, user_id, kind, title, body, href)
      values (
        new.organization_id,
        new.submitted_by,
        'report_returned',
        'Report Returned for Revision',
        coalesce(nullif(new.head_remarks, ''), 'Please review and update your report for ' || new.report_date::text),
        '/reports'
      );
    end if;
  end if;
  return new;
end $$;

-- 6. Update RLS policies across all four tables so samples are creator+admin only and vanish at 24h
grant select, insert, update, delete on daily_activities to authenticated;
grant select, insert, update, delete on job_orders to authenticated;
grant select, insert, update, delete on shift_handovers to authenticated;
grant select, insert, update, delete on accomplishment_reports to authenticated;

-- daily_activities
drop policy if exists "daily_activities read" on daily_activities;
create policy "daily_activities read" on daily_activities
  for select using (
    organization_id = current_org()
    and (
      (
        not is_sample
        and (
          current_role_name() in ('admin', 'scheduler', 'manager')
          or logged_by = auth.uid()
          or (
            current_operator_id() is not null
            and (
              lead_operator_id = current_operator_id()
              or current_operator_id() = any(crew_operator_ids)
            )
          )
        )
      )
      or (
        is_sample
        and sample_expires_at > now()
        and (logged_by = auth.uid() or current_role_name() = 'admin')
      )
    )
  );

drop policy if exists "daily_activities insert" on daily_activities;
create policy "daily_activities insert" on daily_activities
  for insert with check (
    organization_id = current_org()
    and (
      current_role_name() = 'admin'
      or (current_role_name() = 'operator' and not is_sample)
      or (current_role_name() = 'manager' and is_sample and logged_by = auth.uid())
    )
  );

drop policy if exists "daily_activities update" on daily_activities;
create policy "daily_activities update" on daily_activities
  for update using (
    organization_id = current_org()
    and (
      (not is_sample and (logged_by = auth.uid() or current_role_name() in ('admin', 'scheduler', 'manager')))
      or (is_sample and (logged_by = auth.uid() or current_role_name() = 'admin'))
    )
  ) with check (
    organization_id = current_org()
    and (
      (not is_sample and (logged_by = auth.uid() or current_role_name() in ('admin', 'scheduler', 'manager')))
      or (is_sample and (logged_by = auth.uid() or current_role_name() = 'admin'))
    )
  );

drop policy if exists "daily_activities delete" on daily_activities;
create policy "daily_activities delete" on daily_activities
  for delete using (
    organization_id = current_org()
    and (logged_by = auth.uid() or current_role_name() = 'admin')
  );

-- job_orders
drop policy if exists "job_orders read" on job_orders;
create policy "job_orders read" on job_orders
  for select using (
    organization_id = current_org()
    and (
      not is_sample
      or (sample_expires_at > now() and (created_by = auth.uid() or current_role_name() = 'admin'))
    )
  );

drop policy if exists "job_orders insert" on job_orders;
create policy "job_orders insert" on job_orders
  for insert with check (
    organization_id = current_org()
    and (
      current_role_name() = 'admin'
      or (current_role_name() = 'scheduler' and not is_sample)
      or (current_role_name() = 'manager' and (not is_sample or created_by = auth.uid()))
    )
  );

drop policy if exists "job_orders update" on job_orders;
create policy "job_orders update" on job_orders
  for update using (
    organization_id = current_org()
    and (
      (not is_sample and (
        current_role_name() in ('admin', 'scheduler', 'manager')
        or (
          current_role_name() = 'operator'
          and (
            current_operator_id() is null
            or current_operator_id() = any(assigned_operator_ids)
            or cardinality(assigned_operator_ids) = 0
          )
        )
      ))
      or (is_sample and (created_by = auth.uid() or current_role_name() = 'admin'))
    )
  ) with check (
    organization_id = current_org()
    and (
      (not is_sample and current_role_name() in ('admin', 'scheduler', 'manager', 'operator'))
      or (is_sample and (created_by = auth.uid() or current_role_name() = 'admin'))
    )
  );

drop policy if exists "job_orders delete" on job_orders;
create policy "job_orders delete" on job_orders
  for delete using (
    organization_id = current_org()
    and (
      (not is_sample and current_role_name() in ('admin', 'scheduler', 'manager'))
      or (is_sample and (created_by = auth.uid() or current_role_name() = 'admin'))
    )
  );

-- shift_handovers
drop policy if exists "shift_handovers read" on shift_handovers;
create policy "shift_handovers read" on shift_handovers
  for select using (
    organization_id = current_org()
    and (
      not is_sample
      or (sample_expires_at > now() and (created_by = auth.uid() or current_role_name() = 'admin'))
    )
  );

drop policy if exists "shift_handovers write" on shift_handovers;
create policy "shift_handovers write" on shift_handovers
  for insert with check (
    organization_id = current_org()
    and (
      current_role_name() = 'admin'
      or (current_role_name() in ('operator', 'scheduler') and not is_sample)
      or (current_role_name() = 'manager' and (not is_sample or created_by = auth.uid()))
    )
  );

drop policy if exists "shift_handovers update" on shift_handovers;
create policy "shift_handovers update" on shift_handovers
  for update using (
    organization_id = current_org()
    and (
      (not is_sample and (created_by = auth.uid() or current_role_name() in ('admin', 'scheduler', 'manager')))
      or (is_sample and (created_by = auth.uid() or current_role_name() = 'admin'))
    )
  ) with check (
    organization_id = current_org()
    and (
      (not is_sample and (created_by = auth.uid() or current_role_name() in ('admin', 'scheduler', 'manager')))
      or (is_sample and (created_by = auth.uid() or current_role_name() = 'admin'))
    )
  );

drop policy if exists "shift_handovers delete" on shift_handovers;
create policy "shift_handovers delete" on shift_handovers
  for delete using (
    organization_id = current_org()
    and (
      current_role_name() = 'admin'
      or (is_sample and created_by = auth.uid())
    )
  );

-- accomplishment_reports
drop policy if exists "accomplishment_reports read" on accomplishment_reports;
create policy "accomplishment_reports read" on accomplishment_reports
  for select using (
    organization_id = current_org()
    and (
      (
        not is_sample
        and (
          current_role_name() in ('admin', 'scheduler', 'manager')
          or submitted_by = auth.uid()
          or assigned_head_id = auth.uid()
          or (current_operator_id() is not null and operator_id = current_operator_id())
        )
      )
      or (
        is_sample
        and sample_expires_at > now()
        and (submitted_by = auth.uid() or current_role_name() = 'admin')
      )
    )
  );

drop policy if exists "accomplishment_reports insert" on accomplishment_reports;
create policy "accomplishment_reports insert" on accomplishment_reports
  for insert with check (
    organization_id = current_org()
    and submitted_by = auth.uid()
    and (
      current_role_name() in ('admin', 'manager')
      or (current_role_name() in ('operator', 'scheduler') and not is_sample)
    )
  );

drop policy if exists "accomplishment_reports update" on accomplishment_reports;
create policy "accomplishment_reports update" on accomplishment_reports
  for update using (
    organization_id = current_org()
    and (
      (not is_sample and (
        current_role_name() in ('admin', 'scheduler', 'manager')
        or assigned_head_id = auth.uid()
        or (submitted_by = auth.uid() and status in ('draft', 'returned', 'submitted'))
      ))
      or (is_sample and (submitted_by = auth.uid() or current_role_name() = 'admin'))
    )
  ) with check (
    organization_id = current_org()
    and (
      (not is_sample and (
        current_role_name() in ('admin', 'scheduler', 'manager')
        or assigned_head_id = auth.uid()
        or (submitted_by = auth.uid() and status in ('draft', 'submitted'))
      ))
      or (is_sample and (submitted_by = auth.uid() or current_role_name() = 'admin'))
    )
  );

drop policy if exists "accomplishment_reports delete" on accomplishment_reports;
create policy "accomplishment_reports delete" on accomplishment_reports
  for delete using (
    organization_id = current_org()
    and (
      current_role_name() = 'admin'
      or (submitted_by = auth.uid() and (status = 'draft' or is_sample))
    )
  );

-- 7. Allow department heads to upload photos for sample logs in their own org
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
          where id = auth.uid() and is_active and role in ('operator', 'admin', 'manager')
        )
      );
  end if;
exception when others then
  null;
end $$;

-- 8. Service-role-only cleanup RPC for expired samples across all four tables + guarded pg_cron hourly schedule
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
