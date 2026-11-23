-- 028: Shared Postgres-backed route compute cache + rate limit store (serverless-safe),
--      and tighter PM operator completion attribution so operators cannot credit
--      arbitrary unlisted colleagues when closing a PM task.

-- 1. Shared Route Compute Cache & Rate-Limit Tables (RPC-only; no direct table grants)
create table if not exists route_compute_cache (
  cache_key text primary key,
  routed_legs jsonb not null,
  encoded_polylines jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists route_compute_cache_expires_idx
  on route_compute_cache (expires_at);

alter table route_compute_cache enable row level security;

create table if not exists route_compute_rate_hits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  bucket text not null check (bucket in ('total', 'upstream')),
  created_at timestamptz not null default now()
);

create index if not exists route_compute_rate_hits_user_bucket_idx
  on route_compute_rate_hits (user_id, bucket, created_at);

alter table route_compute_rate_hits enable row level security;

create or replace function check_route_compute_rate_limit(
  p_bucket text,
  p_limit int,
  p_window_seconds int
) returns table (
  allowed boolean,
  remaining int,
  retry_after_seconds int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_now timestamptz;
  v_cutoff timestamptz;
  v_count int;
  v_oldest timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null or current_org() is null then
    raise exception 'Unauthorized';
  end if;
  if p_bucket not in ('total', 'upstream') then
    raise exception 'Invalid rate-limit bucket';
  end if;
  if p_limit < 1 or p_limit > 1000 or p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'Invalid rate-limit bounds';
  end if;

  perform pg_advisory_xact_lock(hashtext('route_rate:' || v_uid::text || ':' || p_bucket));

  v_now := now();
  v_cutoff := v_now - make_interval(secs => p_window_seconds);

  delete from route_compute_rate_hits
  where user_id = v_uid
    and bucket = p_bucket
    and created_at <= v_cutoff;

  select count(*)::int, min(created_at)
  into v_count, v_oldest
  from route_compute_rate_hits
  where user_id = v_uid
    and bucket = p_bucket;

  if v_count >= p_limit then
    return query
    select
      false,
      0,
      greatest(1, ceil(extract(epoch from ((v_oldest + make_interval(secs => p_window_seconds)) - v_now)))::int);
    return;
  end if;

  insert into route_compute_rate_hits (user_id, bucket, created_at)
  values (v_uid, p_bucket, v_now);

  return query
  select true, greatest(0, p_limit - v_count - 1), 0;
end $$;

create or replace function get_route_compute_cache(p_cache_key text)
returns table (
  routed_legs jsonb,
  encoded_polylines jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or current_org() is null then
    raise exception 'Unauthorized';
  end if;
  if p_cache_key is null or length(trim(p_cache_key)) = 0 then
    return;
  end if;

  return query
  select c.routed_legs, c.encoded_polylines
  from route_compute_cache c
  where c.cache_key = p_cache_key
    and c.expires_at > now()
  limit 1;
end $$;

create or replace function set_route_compute_cache(
  p_cache_key text,
  p_routed_legs jsonb,
  p_encoded_polylines jsonb,
  p_ttl_seconds int default 1800
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ttl int;
begin
  if auth.uid() is null or current_org() is null then
    raise exception 'Unauthorized';
  end if;
  if p_cache_key is null or length(trim(p_cache_key)) = 0 then
    return;
  end if;

  v_ttl := greatest(60, least(coalesce(p_ttl_seconds, 1800), 86400));

  insert into route_compute_cache (cache_key, routed_legs, encoded_polylines, expires_at, updated_at)
  values (
    p_cache_key,
    coalesce(p_routed_legs, '[]'::jsonb),
    coalesce(p_encoded_polylines, '[]'::jsonb),
    now() + make_interval(secs => v_ttl),
    now()
  )
  on conflict (cache_key) do update
    set routed_legs = excluded.routed_legs,
        encoded_polylines = excluded.encoded_polylines,
        expires_at = excluded.expires_at,
        updated_at = now();

  delete from route_compute_cache where expires_at <= now();
end $$;

revoke all on function check_route_compute_rate_limit(text, int, int) from public, anon;
revoke all on function get_route_compute_cache(text) from public, anon;
revoke all on function set_route_compute_cache(text, jsonb, jsonb, int) from public, anon;
grant execute on function check_route_compute_rate_limit(text, int, int) to authenticated;
grant execute on function get_route_compute_cache(text) to authenticated;
grant execute on function set_route_compute_cache(text, jsonb, jsonb, int) to authenticated;

-- 2. Restrict operator PM closing credit to self + originally planned assignees
drop policy if exists "pm_tasks operator close" on pm_tasks;
create policy "pm_tasks operator close" on pm_tasks
  for update
  using (
    organization_id = current_org()
    and current_role_name() = 'operator'
    and current_operator_id() is not null
    and status <> 'done'
  )
  with check (
    organization_id = current_org()
    and current_role_name() = 'operator'
    and current_operator_id() is not null
    and (
      (
        status = 'done'
        and current_operator_id() = any(completed_by_operator_ids)
        and completed_by_operator_ids <@ array_append(coalesce(assigned_operator_ids, '{}'::uuid[]), current_operator_id())
      )
      or (
        status in ('planned', 'postponed')
        and current_operator_id() = any(assigned_operator_ids)
        and cardinality(coalesce(completed_by_operator_ids, '{}'::uuid[])) = 0
      )
    )
  );

create or replace function enforce_operator_pm_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  bad_count int;
  v_op_id uuid;
begin
  if new.completed_by_operator_ids is not null and cardinality(new.completed_by_operator_ids) > 0 then
    select count(*) into bad_count
    from unnest(new.completed_by_operator_ids) as elem
    where not exists (
      select 1 from operators o
      where o.id = elem
        and o.organization_id = new.organization_id
    );
    if bad_count > 0 then
      raise exception 'Actual performer operator does not belong to this organization';
    end if;
  end if;

  if tg_op = 'UPDATE' and current_role_name() = 'operator' then
    v_op_id := current_operator_id();
    if v_op_id is null then
      raise exception 'Operator profile is not linked to an operator record';
    end if;

    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.legacy_key is distinct from old.legacy_key
      or new.activity_type is distinct from old.activity_type
      or new.title is distinct from old.title
      or new.locations is distinct from old.locations
      or new.asset is distinct from old.asset
      or new.assigned_operator_ids is distinct from old.assigned_operator_ids
      or new.scheduled_date is distinct from old.scheduled_date
    then
      raise exception 'Operators may only update status, completed_at, remarks, and completed_by_operator_ids on PM tasks';
    end if;

    if old.status = 'done' then
      raise exception 'Operators cannot reopen or modify completed PM tasks';
    end if;

    if new.status not in ('planned', 'done', 'postponed') then
      raise exception 'Invalid PM task status';
    end if;

    if new.status = 'done' then
      if new.completed_by_operator_ids is null or not (v_op_id = any(new.completed_by_operator_ids)) then
        raise exception 'The operator closing a PM task must be included in completed_by_operator_ids';
      end if;
      if not (new.completed_by_operator_ids <@ array_append(coalesce(old.assigned_operator_ids, '{}'::uuid[]), v_op_id)) then
        raise exception 'Operators may only credit themselves and the originally assigned operators when closing a PM task';
      end if;
    else
      if not (v_op_id = any(old.assigned_operator_ids)) then
        raise exception 'Unlisted operators may only close open PM tasks as done';
      end if;
      if cardinality(coalesce(new.completed_by_operator_ids, '{}'::uuid[])) > 0 then
        raise exception 'Open PM tasks cannot record actual performers';
      end if;
    end if;
  end if;

  return new;
end $$;
