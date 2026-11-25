-- 038: Add GIN indexes on daily_activities photo arrays and RA 10173 telemetry PII retention purge.
--
--  a) GIN indexes on daily_activities(photo_storage_paths) and daily_activities(photo_urls)
--     to accelerate authenticated photo-proxy RLS lookups.
--  b) service_role-only purge_expired_telemetry_pii(p_retention_days int default 365)
--     to scrub expired field GPS coordinates, signatures, GPS accuracy metadata, and closed JO contact numbers.

create index if not exists daily_activities_photo_storage_paths_gin_idx
  on daily_activities using gin (photo_storage_paths);

create index if not exists daily_activities_photo_urls_gin_idx
  on daily_activities using gin (photo_urls);

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
      details = coalesce(details, '{}'::jsonb) - 'gpsSource' - 'gpsAccuracyM'
  where not is_sample
    and created_at < now() - make_interval(days => p_retention_days)
    and (
      gps_lat is not null
      or gps_lng is not null
      or signature_data is not null
      or details ? 'gpsSource'
      or details ? 'gpsAccuracyM'
    );
  get diagnostics v_act = row_count;

  update job_orders
  set contact_number = null
  where not is_sample
    and status in ('completed', 'cancelled')
    and coalesce(completed_at, updated_at, created_at) < now() - make_interval(days => p_retention_days)
    and contact_number is not null;
  get diagnostics v_jo = row_count;

  return query select v_act, v_jo;
end $$;

revoke all on function purge_expired_telemetry_pii(int) from public, anon, authenticated;
grant execute on function purge_expired_telemetry_pii(int) to service_role;
