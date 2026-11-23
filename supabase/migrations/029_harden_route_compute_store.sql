-- 029: Harden shared route compute cache & rate-limit store (fixes 028 gaps)
--
-- 1. Revokes authenticated access by dropping the 028 RPC signatures and re-creating
--    org-scoped, service_role-only RPCs so logged-in users cannot poison cache entries
--    or invoke rate-limit functions directly through PostgREST.
-- 2. Scopes `route_compute_cache` by `organization_id` (composite PK `(organization_id, cache_key)`),
--    enforces strict byte/array-length bounds on cached route JSON, caps cached rows per org,
--    and hardcodes rate-limit thresholds inside `check_route_compute_rate_limit(uuid, text)`.
-- 3. Adds cross-user expired-row sweeps plus `purge_expired_route_compute_state()` for scheduled
--    cron cleanup (`/api/activities/purge-photos`).

-- Drop 028 RPC overloads that were executable by `authenticated`
drop function if exists check_route_compute_rate_limit(text, int, int);
drop function if exists get_route_compute_cache(text);
drop function if exists set_route_compute_cache(text, jsonb, jsonb, int);

-- Upgrade route_compute_cache to be organization-partitioned and size-bounded
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'route_compute_cache'
      and column_name = 'organization_id'
  ) then
    truncate table route_compute_cache;
    alter table route_compute_cache drop constraint if exists route_compute_cache_pkey;
    alter table route_compute_cache
      add column organization_id uuid not null references organizations(id) on delete cascade;
    alter table route_compute_cache
      add constraint route_compute_cache_pkey primary key (organization_id, cache_key);
  end if;
end $$;

alter table route_compute_cache drop constraint if exists route_compute_cache_key_len_chk;
alter table route_compute_cache
  add constraint route_compute_cache_key_len_chk
  check (length(trim(cache_key)) between 1 and 4096);

alter table route_compute_cache drop constraint if exists route_compute_cache_legs_chk;
alter table route_compute_cache
  add constraint route_compute_cache_legs_chk
  check (
    jsonb_typeof(routed_legs) = 'array'
    and jsonb_array_length(routed_legs) <= 60
    and octet_length(routed_legs::text) <= 16384
  );

alter table route_compute_cache drop constraint if exists route_compute_cache_polys_chk;
alter table route_compute_cache
  add constraint route_compute_cache_polys_chk
  check (
    jsonb_typeof(encoded_polylines) = 'array'
    and jsonb_array_length(encoded_polylines) <= 10
    and octet_length(encoded_polylines::text) <= 131072
  );

create index if not exists route_compute_cache_org_expires_idx
  on route_compute_cache (organization_id, expires_at);

create index if not exists route_compute_rate_hits_created_idx
  on route_compute_rate_hits (created_at);

alter table route_compute_cache enable row level security;
alter table route_compute_rate_hits enable row level security;

revoke all on table route_compute_cache from public, anon, authenticated;
revoke all on table route_compute_rate_hits from public, anon, authenticated;

-- Fixed-policy per-user sliding-window rate limiter (service_role only; caller cannot pick limit/window)
create or replace function check_route_compute_rate_limit(
  p_user_id uuid,
  p_bucket text
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
  v_limit int;
  v_window_seconds constant int := 300;
  v_now timestamptz;
  v_cutoff timestamptz;
  v_count int;
  v_oldest timestamptz;
begin
  if nullif(current_setting('request.jwt.claim.role', true), '') in ('anon', 'authenticated') then
    raise exception 'Forbidden';
  end if;
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_bucket = 'total' then
    v_limit := 60;
  elsif p_bucket = 'upstream' then
    v_limit := 20;
  else
    raise exception 'Invalid rate-limit bucket';
  end if;

  perform pg_advisory_xact_lock(hashtext('route_rate:' || p_user_id::text || ':' || p_bucket));

  v_now := now();
  v_cutoff := v_now - make_interval(secs => v_window_seconds);

  -- Sweep expired hits across ALL users via route_compute_rate_hits_created_idx
  delete from route_compute_rate_hits
  where created_at <= v_cutoff;

  select count(*)::int, min(created_at)
  into v_count, v_oldest
  from route_compute_rate_hits
  where user_id = p_user_id
    and bucket = p_bucket;

  if v_count >= v_limit then
    return query
    select
      false,
      0,
      greatest(1, ceil(extract(epoch from ((v_oldest + make_interval(secs => v_window_seconds)) - v_now)))::int);
    return;
  end if;

  insert into route_compute_rate_hits (user_id, bucket, created_at)
  values (p_user_id, p_bucket, v_now);

  return query
  select true, greatest(0, v_limit - v_count - 1), 0;
end $$;

-- Organization-scoped route cache lookup (service_role only)
create or replace function get_route_compute_cache(
  p_org_id uuid,
  p_cache_key text
) returns table (
  routed_legs jsonb,
  encoded_polylines jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(current_setting('request.jwt.claim.role', true), '') in ('anon', 'authenticated') then
    raise exception 'Forbidden';
  end if;
  if p_org_id is null or p_cache_key is null or length(trim(p_cache_key)) not between 1 and 4096 then
    return;
  end if;

  return query
  select c.routed_legs, c.encoded_polylines
  from route_compute_cache c
  where c.organization_id = p_org_id
    and c.cache_key = p_cache_key
    and c.expires_at > now()
  limit 1;
end $$;

-- Organization-scoped, size-capped, entry-bounded route cache write (service_role only, fixed 30m TTL)
create or replace function set_route_compute_cache(
  p_org_id uuid,
  p_cache_key text,
  p_routed_legs jsonb,
  p_encoded_polylines jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ttl_seconds constant int := 1800;
  v_max_org_entries constant int := 500;
  v_legs jsonb := coalesce(p_routed_legs, '[]'::jsonb);
  v_polys jsonb := coalesce(p_encoded_polylines, '[]'::jsonb);
  v_org_count int;
begin
  if nullif(current_setting('request.jwt.claim.role', true), '') in ('anon', 'authenticated') then
    raise exception 'Forbidden';
  end if;
  if p_org_id is null then
    raise exception 'p_org_id is required';
  end if;
  if p_cache_key is null or length(trim(p_cache_key)) not between 1 and 4096 then
    raise exception 'Invalid cache key length';
  end if;
  if jsonb_typeof(v_legs) <> 'array'
     or jsonb_array_length(v_legs) > 60
     or octet_length(v_legs::text) > 16384 then
    raise exception 'Route cache legs payload exceeds size or element bounds';
  end if;
  if jsonb_typeof(v_polys) <> 'array'
     or jsonb_array_length(v_polys) > 10
     or octet_length(v_polys::text) > 131072 then
    raise exception 'Route cache polylines payload exceeds size or element bounds';
  end if;

  delete from route_compute_cache where expires_at <= now();

  select count(*)::int into v_org_count
  from route_compute_cache
  where organization_id = p_org_id
    and cache_key <> p_cache_key;

  if v_org_count >= v_max_org_entries then
    delete from route_compute_cache
    where organization_id = p_org_id
      and cache_key in (
        select cache_key
        from route_compute_cache
        where organization_id = p_org_id
          and cache_key <> p_cache_key
        order by expires_at asc
        limit (v_org_count - v_max_org_entries + 1)
      );
  end if;

  insert into route_compute_cache (organization_id, cache_key, routed_legs, encoded_polylines, expires_at, updated_at)
  values (
    p_org_id,
    p_cache_key,
    v_legs,
    v_polys,
    now() + make_interval(secs => v_ttl_seconds),
    now()
  )
  on conflict (organization_id, cache_key) do update
    set routed_legs = excluded.routed_legs,
        encoded_polylines = excluded.encoded_polylines,
        expires_at = excluded.expires_at,
        updated_at = now();
end $$;

-- Scheduled cleanup RPC invoked by daily cron (`/api/activities/purge-photos`)
create or replace function purge_expired_route_compute_state()
returns table (
  purged_cache_rows int,
  purged_rate_hits int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cache int;
  v_hits int;
begin
  if nullif(current_setting('request.jwt.claim.role', true), '') in ('anon', 'authenticated') then
    raise exception 'Forbidden';
  end if;

  with del_cache as (
    delete from route_compute_cache
    where expires_at <= now()
    returning 1
  )
  select count(*)::int into v_cache from del_cache;

  with del_hits as (
    delete from route_compute_rate_hits
    where created_at <= now() - interval '5 minutes'
    returning 1
  )
  select count(*)::int into v_hits from del_hits;

  return query select v_cache, v_hits;
end $$;

revoke all on function check_route_compute_rate_limit(uuid, text) from public, anon, authenticated;
revoke all on function get_route_compute_cache(uuid, text) from public, anon, authenticated;
revoke all on function set_route_compute_cache(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function purge_expired_route_compute_state() from public, anon, authenticated;

grant usage on schema public to service_role;
grant execute on function check_route_compute_rate_limit(uuid, text) to service_role;
grant execute on function get_route_compute_cache(uuid, text) to service_role;
grant execute on function set_route_compute_cache(uuid, text, jsonb, jsonb) to service_role;
grant execute on function purge_expired_route_compute_state() to service_role;
