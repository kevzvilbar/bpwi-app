-- Consolidate 6 station area codes (PW, RM, LD, MR, WM, WD) down to 3 (PL, FD, WD):
--   PL = Plant Operations (replaces PW)
--   FD = Field Operations (combines RM, LD, MR, WM)
--   WD = Water Delivery   (kept distinct)
-- Existing leave/rest/holiday codes (RD, AL, VL, SL, H) are preserved untouched.

create or replace function consolidate_station_codes_for_org(p_org_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pl_id uuid;
  v_pw_id uuid;
  v_fd_id uuid;
  v_wd_id uuid;
  v_retired_ids uuid[];
  v_retired_texts text[];
  v_merged_sites text[];
  v_has_station boolean;
  v_has_area_codes boolean;
begin
  if auth.uid() is not null
     and (p_org_id is distinct from current_org() or current_role_name() is distinct from 'admin'::app_role) then
    raise exception 'Only organization admins can consolidate station codes';
  end if;

  select exists(select 1 from area_codes where organization_id = p_org_id)
    into v_has_area_codes;

  if not v_has_area_codes
     and not exists (select 1 from operators where organization_id = p_org_id and default_station is not null) then
    return;
  end if;

  -- 1. PL — Plant Operations (replaces PW)
  select id into v_pl_id
  from area_codes
  where organization_id = p_org_id and upper(code) = 'PL'
  order by id limit 1;

  select id into v_pw_id
  from area_codes
  where organization_id = p_org_id and upper(code) = 'PW'
  order by id limit 1;

  if v_pw_id is not null and v_pl_id is null then
    update area_codes
    set code = 'PL', name = 'Plant Operations', category = 'station'
    where id = v_pw_id;
    v_pl_id := v_pw_id;
  elsif v_pw_id is not null and v_pl_id is not null then
    select coalesce(array_agg(distinct val order by val), '{}'::text[])
    into v_merged_sites
    from (
      select trim(s) as val
      from area_codes ac, unnest(ac.sub_sites) as s
      where ac.id in (v_pl_id, v_pw_id) and length(trim(s)) > 0
    ) merged;

    update area_codes
    set name = 'Plant Operations', category = 'station', sub_sites = v_merged_sites
    where id = v_pl_id;

    update schedule_assignments
    set area_code_id = v_pl_id
    where organization_id = p_org_id and area_code_id = v_pw_id;

    update change_request_items
    set area_code_id = v_pl_id
    where organization_id = p_org_id and area_code_id = v_pw_id;

    update change_request_items
    set original_state = jsonb_set(original_state, '{area_code_id}', to_jsonb(v_pl_id::text), false)
    where organization_id = p_org_id
      and original_state is not null
      and original_state ->> 'area_code_id' = v_pw_id::text;

    update daily_activities
    set area_code_id = v_pl_id
    where organization_id = p_org_id and area_code_id = v_pw_id;

    update job_orders
    set area_code_id = v_pl_id
    where organization_id = p_org_id and area_code_id = v_pw_id;

    update shift_handovers
    set area_code_id = v_pl_id
    where organization_id = p_org_id and area_code_id = v_pw_id;

    delete from area_codes where id = v_pw_id;
  elsif v_pl_id is not null then
    update area_codes
    set name = 'Plant Operations', category = 'station'
    where id = v_pl_id;
  elsif v_has_area_codes then
    insert into area_codes (organization_id, code, name, category, background_color, text_color)
    values (p_org_id, 'PL', 'Plant Operations', 'station', '#f1f5f9', '#1e293b')
    returning id into v_pl_id;
  end if;

  -- 2. FD — Field Operations (combines RM, LD, MR, WM)
  select coalesce(array_agg(id), '{}'::uuid[]),
         coalesce(array_agg(id::text), '{}'::text[])
  into v_retired_ids, v_retired_texts
  from area_codes
  where organization_id = p_org_id
    and upper(code) in ('RM', 'LD', 'MR', 'WM');

  select id into v_fd_id
  from area_codes
  where organization_id = p_org_id and upper(code) = 'FD'
  order by id limit 1;

  select exists(select 1 from area_codes where organization_id = p_org_id and category = 'station')
    into v_has_station;

  if v_fd_id is null and (coalesce(array_length(v_retired_ids, 1), 0) > 0 or v_has_station) then
    insert into area_codes (organization_id, code, name, category, background_color, text_color)
    values (p_org_id, 'FD', 'Field Operations', 'station', '#f1f5f9', '#1e293b')
    returning id into v_fd_id;
  elsif v_fd_id is not null then
    update area_codes
    set name = 'Field Operations', category = 'station'
    where id = v_fd_id;
  end if;

  if v_fd_id is not null and coalesce(array_length(v_retired_ids, 1), 0) > 0 then
    select coalesce(array_agg(distinct val order by val), '{}'::text[])
    into v_merged_sites
    from (
      select trim(s) as val
      from area_codes ac, unnest(ac.sub_sites) as s
      where (ac.id = v_fd_id or ac.id = any(v_retired_ids))
        and length(trim(s)) > 0
    ) merged;

    update area_codes
    set sub_sites = v_merged_sites
    where id = v_fd_id;

    update schedule_assignments
    set area_code_id = v_fd_id
    where organization_id = p_org_id and area_code_id = any(v_retired_ids);

    update change_request_items
    set area_code_id = v_fd_id
    where organization_id = p_org_id and area_code_id = any(v_retired_ids);

    update change_request_items
    set original_state = jsonb_set(original_state, '{area_code_id}', to_jsonb(v_fd_id::text), false)
    where organization_id = p_org_id
      and original_state is not null
      and original_state ->> 'area_code_id' = any(v_retired_texts);

    update daily_activities
    set area_code_id = v_fd_id
    where organization_id = p_org_id and area_code_id = any(v_retired_ids);

    update job_orders
    set area_code_id = v_fd_id
    where organization_id = p_org_id and area_code_id = any(v_retired_ids);

    update shift_handovers
    set area_code_id = v_fd_id
    where organization_id = p_org_id and area_code_id = any(v_retired_ids);

    delete from area_codes where id = any(v_retired_ids);
  end if;

  -- 3. WD — Water Delivery (ensure canonical name & presence when org has stations)
  select id into v_wd_id
  from area_codes
  where organization_id = p_org_id and upper(code) = 'WD'
  order by id limit 1;

  select exists(select 1 from area_codes where organization_id = p_org_id and category = 'station')
    into v_has_station;

  if v_wd_id is not null then
    update area_codes
    set name = 'Water Delivery', category = 'station'
    where id = v_wd_id;
  elsif v_has_station then
    insert into area_codes (organization_id, code, name, category, background_color, text_color)
    values (p_org_id, 'WD', 'Water Delivery', 'station', '#f1f5f9', '#1e293b');
  end if;

  -- 4. Update operator default_station references
  update operators
  set default_station = 'PL'
  where organization_id = p_org_id
    and upper(trim(coalesce(default_station, ''))) = 'PW';

  update operators
  set default_station = 'FD'
  where organization_id = p_org_id
    and upper(trim(coalesce(default_station, ''))) in ('RM', 'LD', 'MR', 'WM');
end $$;

revoke all on function consolidate_station_codes_for_org(uuid) from public, anon;
grant execute on function consolidate_station_codes_for_org(uuid) to authenticated;

do $$
declare
  v_org_id uuid;
begin
  for v_org_id in select id from organizations loop
    perform consolidate_station_codes_for_org(v_org_id);
  end loop;
end $$;
