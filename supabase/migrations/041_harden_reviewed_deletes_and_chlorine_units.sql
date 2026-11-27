-- 041: Harden reviewed activity deletes and chlorine type/unit inventory checks
--  1. Prevent non-admin delete of any previously reviewed daily_activities row (verified, flagged, or
--     verified_at IS NOT NULL), blocking the flagged -> submitted -> delete two-step bypass.
--  2. Require an explicit, recognized chlorine chemicalType and matching unit (L for liquid, kg for
--     granules) inside sync_consumable_inventory_from_activity().

-- 1. Block non-admin delete once an activity has been reviewed ---------------------------------------
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
          or (status not in ('verified', 'flagged') and verified_at is null)
        )
      )
    )
  );

-- 2. Require explicit chlorine chemicalType and enforce unit match (L vs kg) -------------------------
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
      if v_unit not in ('l', 'liter', 'liters', 'litre', 'litres') then
        raise exception 'Liquid chlorine (%) requires unit L, got "%"',
          coalesce(new.details->>'chemicalType', ''), coalesce(new.details->>'amountUnit', '')
          using errcode = '22023';
      end if;
      v_code := 'CHLORINE_LIQ';
    elsif v_chem ~ '(calcium|granul|powder|70%|tablet)' then
      if v_unit <> 'kg' then
        raise exception 'Granular chlorine (%) requires unit kg, got "%"',
          coalesce(new.details->>'chemicalType', ''), coalesce(new.details->>'amountUnit', '')
          using errcode = '22023';
      end if;
      v_code := 'CHLORINE_GRAN';
    else
      raise exception 'Unrecognized or missing chlorine chemicalType "%" (unit "%"): select Liquid (L) or Granules (kg)',
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
