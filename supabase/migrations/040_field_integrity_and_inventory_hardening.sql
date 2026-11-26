-- 040: Field activity integrity & consumables inventory hardening
--  1. Prevent non-admin deletion of verified or flagged daily_activities logs in RLS.
--  2. Add server-controlled received_at on daily_activities while preserving device created_at.
--  3. Restrict direct execution of seed_default_consumables(uuid) away from public/anon/authenticated.
--  4. Enforce strict inventory quantity & chemical/fuel type validation, avoid rewriting stock rows
--     on non-stock activity updates (such as verify/flag), and add DB balance aggregation RPC.

-- 1. Block non-admin delete on verified & flagged daily_activities ---------------------------------
drop policy if exists "daily_activities delete" on daily_activities;
create policy "daily_activities delete" on daily_activities
  for delete using (
    organization_id = current_org()
    and (
      current_role_name() = 'admin'
      or (
        logged_by = auth.uid()
        and (
          coalesce(is_sample, false)
          or status not in ('verified', 'flagged')
        )
      )
    )
  );

-- 2. Server-controlled received_at timestamp on daily_activities -----------------------------------
alter table daily_activities
  add column if not exists received_at timestamptz;

update daily_activities
  set received_at = coalesce(created_at, now())
  where received_at is null;

alter table daily_activities
  alter column received_at set default now();

alter table daily_activities
  alter column received_at set not null;

create index if not exists idx_daily_activities_org_received
  on daily_activities (organization_id, received_at desc);

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

  if tg_op = 'INSERT' then
    -- Authoritative server receipt timestamp; created_at retains device offline capture time.
    new.received_at := now();
  elsif tg_op = 'UPDATE' then
    new.received_at := old.received_at;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_daily_activities_updated_at on daily_activities;
create trigger trg_daily_activities_updated_at
  before insert or update on daily_activities
  for each row execute function touch_daily_activities_updated_at();

-- 3. Restrict direct RPC execution of seed_default_consumables -------------------------------------
revoke all on function seed_default_consumables(uuid) from public, anon, authenticated;
grant execute on function seed_default_consumables(uuid) to service_role;

-- 4. Strict consumable quantity & type validation + no-op guard on non-stock updates ---------------
create or replace function parse_positive_consumable_qty(raw text) returns numeric
language plpgsql immutable as $$
declare
  v_clean text;
  v_num numeric;
begin
  v_clean := btrim(coalesce(raw, ''));
  if v_clean = '' then
    return null;
  end if;
  if v_clean !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception 'Invalid consumable quantity "%": expected a positive decimal number', raw
      using errcode = '22023';
  end if;
  v_num := round(v_clean::numeric, 3);
  if v_num <= 0 then
    raise exception 'Invalid consumable quantity "%": must be greater than zero', raw
      using errcode = '22023';
  end if;
  return v_num;
end $$;

create or replace function sync_consumable_inventory_from_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_site text;
  v_qty numeric;
  v_code text;
  v_item_id uuid;
  v_date date;
  v_chem text;
  v_unit text;
  v_fuel_type text;
  v_fuel_source text;
  v_receipt text;
  v_stop jsonb;
  v_stop_site text;
  v_stop_qty numeric;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.is_sample is not distinct from old.is_sample
       and new.activity_type is not distinct from old.activity_type
       and new.activity_date is not distinct from old.activity_date
       and new.site_or_well is not distinct from old.site_or_well
       and new.details is not distinct from old.details
       and new.logged_by is not distinct from old.logged_by then
      return new;
    end if;
  end if;

  delete from consumable_movements where activity_id = new.id;

  if coalesce(new.is_sample, false) then
    return new;
  end if;

  if new.activity_type not in (
    'chlorine_refill',
    'genset_fuel_refill',
    'genset_fuel_distribution',
    'genset_fuel_purchase'
  ) then
    return new;
  end if;

  perform seed_default_consumables(new.organization_id);
  v_date := coalesce(new.activity_date, current_date);
  v_site := nullif(btrim(coalesce(new.site_or_well, '')), '');

  if new.activity_type = 'chlorine_refill' then
    if v_site is null then
      return new;
    end if;
    v_qty := parse_positive_consumable_qty(new.details->>'amountAdded');
    if v_qty is null then
      return new;
    end if;
    v_chem := lower(btrim(coalesce(new.details->>'chemicalType', '')));
    v_unit := lower(btrim(coalesce(new.details->>'amountUnit', '')));
    if v_chem ~ '(sodium|liquid|12\.5)' then
      v_code := 'CHLORINE_LIQ';
    elsif v_chem ~ '(calcium|granul|powder|70%|tablet)' then
      v_code := 'CHLORINE_GRAN';
    elsif v_chem = '' and v_unit in ('l', 'liter', 'liters') then
      v_code := 'CHLORINE_LIQ';
    elsif v_chem = '' and v_unit = 'kg' then
      v_code := 'CHLORINE_GRAN';
    else
      raise exception 'Unrecognized chlorine chemicalType "%" (unit "%")',
        coalesce(new.details->>'chemicalType', ''), coalesce(new.details->>'amountUnit', '')
        using errcode = '22023';
    end if;
    select id into v_item_id
      from consumable_items
      where organization_id = new.organization_id and code = v_code
      limit 1;
    if v_item_id is not null then
      insert into consumable_movements (
        organization_id, item_id, site_name, movement_type, quantity_delta,
        movement_date, activity_id, notes, created_by
      ) values (
        new.organization_id, v_item_id, v_site, 'activity_usage', -v_qty,
        v_date, new.id, 'Auto from Chlorine Refill log', new.logged_by
      );
    end if;
    return new;
  end if;

  v_fuel_type := lower(btrim(coalesce(new.details->>'fuelType', '')));
  if v_fuel_type = 'gasoline' then
    v_code := 'GASOLINE';
  elsif v_fuel_type = 'diesel' then
    v_code := 'DIESEL';
  else
    raise exception 'Unrecognized fuelType "%": expected Diesel or Gasoline',
      coalesce(new.details->>'fuelType', '')
      using errcode = '22023';
  end if;

  select id into v_item_id
    from consumable_items
    where organization_id = new.organization_id and code = v_code
    limit 1;
  if v_item_id is null then
    return new;
  end if;

  if new.activity_type = 'genset_fuel_refill' then
    v_fuel_source := coalesce(new.details->>'fuelSource', 'Stock Drum / Container');
    if v_site is null or v_fuel_source = 'Direct Purchase' then
      return new;
    end if;
    v_qty := parse_positive_consumable_qty(new.details->>'litersAdded');
    if v_qty is not null then
      insert into consumable_movements (
        organization_id, item_id, site_name, movement_type, quantity_delta,
        movement_date, activity_id, notes, created_by
      ) values (
        new.organization_id, v_item_id, v_site, 'activity_usage', -v_qty,
        v_date, new.id, 'Auto from Genset Fuel Refill log', new.logged_by
      );
    end if;
    return new;
  end if;

  if new.activity_type = 'genset_fuel_distribution' then
    if jsonb_typeof(new.details->'fuelDistributions') = 'array' then
      for v_stop in select * from jsonb_array_elements(new.details->'fuelDistributions') loop
        v_stop_site := nullif(btrim(coalesce(v_stop->>'destinationSite', '')), '');
        v_stop_qty := parse_positive_consumable_qty(v_stop->>'liters');
        if v_stop_site is not null and v_stop_qty is not null then
          insert into consumable_movements (
            organization_id, item_id, site_name, movement_type, quantity_delta,
            movement_date, activity_id, notes, created_by
          ) values (
            new.organization_id, v_item_id, v_stop_site, 'activity_delivery', v_stop_qty,
            v_date, new.id, 'Auto from Genset Fuel Distribution log', new.logged_by
          );
        end if;
      end loop;
    end if;
    return new;
  end if;

  if new.activity_type = 'genset_fuel_purchase' then
    if v_site is null then
      return new;
    end if;
    v_qty := parse_positive_consumable_qty(new.details->>'litersPurchased');
    if v_qty is not null then
      v_receipt := nullif(btrim(coalesce(new.details->>'receiptNumber', '')), '');
      insert into consumable_movements (
        organization_id, item_id, site_name, movement_type, quantity_delta,
        movement_date, activity_id, reference_no, notes, created_by
      ) values (
        new.organization_id, v_item_id, v_site, 'activity_delivery', v_qty,
        v_date, new.id, v_receipt, 'Auto from Genset Fuel Purchase log', new.logged_by
      );
    end if;
  end if;

  return new;
end $$;

-- 5. DB-aggregated per-site balance summary RPC ----------------------------------------------------
create or replace function get_consumable_site_balances()
returns table (
  site_key text,
  site_name text,
  item_id uuid,
  balance numeric,
  movement_count bigint,
  last_movement_date date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    lower(regexp_replace(btrim(m.site_name), '\s+', ' ', 'g')) as site_key,
    (array_agg(regexp_replace(btrim(m.site_name), '\s+', ' ', 'g') order by m.created_at asc, m.id asc))[1] as site_name,
    m.item_id,
    round(sum(m.quantity_delta), 3) as balance,
    count(*)::bigint as movement_count,
    max(m.movement_date) as last_movement_date
  from consumable_movements m
  where m.organization_id = current_org()
  group by lower(regexp_replace(btrim(m.site_name), '\s+', ' ', 'g')), m.item_id;
$$;

revoke all on function get_consumable_site_balances() from public, anon;
grant execute on function get_consumable_site_balances() to authenticated;
