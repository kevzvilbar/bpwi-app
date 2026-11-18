-- Phase 1: Daily Employee Activity Monitoring
-- Links field activities directly to area_codes (stations), operators (lead + crew tags),
-- shift_types, and pm_tasks. Only 'operator' and 'admin' roles may insert new activity logs.
-- Photos uploaded to Supabase Storage ('activity-media') auto-expire after 30 days.

create table if not exists daily_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  activity_date date not null default ((now() at time zone 'Asia/Manila')::date),
  logged_by uuid references auth.users on delete set null default auth.uid(),
  lead_operator_id uuid references operators on delete set null,
  crew_operator_ids uuid[] not null default '{}',
  shift_type_id uuid references shift_types on delete set null,
  area_code_id uuid references area_codes on delete set null,
  site_or_well text,
  block_lot text,
  activity_type text not null,
  pm_task_id uuid references pm_tasks on delete set null,
  status text not null default 'submitted' check (status in ('draft','submitted','verified','flagged')),
  started_at timestamptz,
  completed_at timestamptz default now(),
  gps_lat numeric,
  gps_lng numeric,
  notes text,
  details jsonb not null default '{}'::jsonb,
  photo_urls text[] not null default '{}',
  photo_storage_paths text[] not null default '{}',
  photos_expires_at timestamptz default (now() + interval '30 days'),
  photos_purged_at timestamptz,
  signature_data text,
  verified_by uuid references auth.users on delete set null,
  verified_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists daily_activities_org_date_idx
  on daily_activities (organization_id, activity_date desc);

create index if not exists daily_activities_org_lead_idx
  on daily_activities (organization_id, lead_operator_id);

create index if not exists daily_activities_crew_gin_idx
  on daily_activities using gin (crew_operator_ids);

create index if not exists daily_activities_photos_expiry_idx
  on daily_activities (organization_id, photos_expires_at)
  where photos_purged_at is null;

-- Keep updated_at fresh on row edits and prevent operators from self-verifying
create or replace function touch_daily_activities_updated_at() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and current_role_name() not in ('admin', 'scheduler', 'manager') then
    if new.status in ('verified', 'flagged') and new.status is distinct from old.status then
      raise exception 'Only admins, schedulers, or department heads can verify or flag activities';
    end if;
    if new.verified_by is distinct from old.verified_by
       or new.verified_at is distinct from old.verified_at
       or new.review_note is distinct from old.review_note then
      raise exception 'Only supervisors can modify verification fields';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_daily_activities_updated_at on daily_activities;
create trigger trg_daily_activities_updated_at
  before update on daily_activities
  for each row execute function touch_daily_activities_updated_at();

-- Audit trail trigger
drop trigger if exists audit_daily_activities on daily_activities;
create trigger audit_daily_activities
  after insert or update or delete on daily_activities
  for each row execute function log_audit();

-- Row Level Security: everyone in org reads; ONLY operator and admin can insert
alter table daily_activities enable row level security;

drop policy if exists "daily_activities read" on daily_activities;
create policy "daily_activities read" on daily_activities
  for select using (organization_id = current_org());

drop policy if exists "daily_activities insert" on daily_activities;
create policy "daily_activities insert" on daily_activities
  for insert with check (
    organization_id = current_org()
    and current_role_name() in ('operator', 'admin')
  );

drop policy if exists "daily_activities update" on daily_activities;
create policy "daily_activities update" on daily_activities
  for update using (
    organization_id = current_org()
    and (logged_by = auth.uid() or current_role_name() in ('admin', 'scheduler', 'manager'))
  ) with check (
    organization_id = current_org()
    and (logged_by = auth.uid() or current_role_name() in ('admin', 'scheduler', 'manager'))
  );

drop policy if exists "daily_activities delete" on daily_activities;
create policy "daily_activities delete" on daily_activities
  for delete using (
    organization_id = current_org()
    and (logged_by = auth.uid() or current_role_name() = 'admin')
  );

-- Realtime publication (ignore error if already added)
do $$
begin
  alter publication supabase_realtime add table daily_activities;
exception when duplicate_object then
  null;
end $$;

-- Provision Supabase Storage bucket 'activity-media' for 30-day compressed field photos
-- Wrapped in an exception handler so plain Postgres test DBs without storage schema succeed cleanly.
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'activity-media',
    'activity-media',
    true,
    2097152,
    array['image/webp', 'image/jpeg', 'image/png']
  )
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists "activity-media public read" on storage.objects;
  create policy "activity-media public read" on storage.objects
    for select using (bucket_id = 'activity-media');

  drop policy if exists "activity-media operator admin insert" on storage.objects;
  create policy "activity-media operator admin insert" on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'activity-media'
      and exists (
        select 1 from public.user_profiles
        where id = auth.uid() and is_active and role in ('operator', 'admin')
      )
    );

  drop policy if exists "activity-media purge delete" on storage.objects;
  create policy "activity-media purge delete" on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'activity-media'
      and exists (
        select 1 from public.user_profiles
        where id = auth.uid() and is_active and role in ('operator', 'admin', 'scheduler', 'manager')
      )
    );
exception when others then
  null;
end $$;
