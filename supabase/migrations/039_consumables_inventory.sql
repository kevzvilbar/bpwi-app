-- 039: Per-site consumables inventory (Chlorine, Gasoline, Diesel + custom items)
-- with automatic stock sync from field activity logs and manager/admin stock controls.

create table if not exists consumable_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text,
  name text not null check (length(btrim(name)) > 0),
  category text not null default 'other'
    check (category in ('chlorine', 'fuel', 'chemical', 'lubricant', 'supplies', 'other')),
  unit text not null check (length(btrim(unit)) > 0),
  low_stock_threshold numeric(12, 3) not null default 0 check (low_stock_threshold >= 0),
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists consumable_items_org_name_lower_uidx
  on consumable_items (organization_id, lower(btrim(name)));

create unique index if not exists consumable_items_org_code_uidx
  on consumable_items (organization_id, code)
  where code is not null;

create index if not exists idx_consumable_items_org_sort
  on consumable_items (organization_id, sort_order, name);

create table if not exists consumable_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references consumable_items(id) on delete cascade,
  site_name text not null check (length(btrim(site_name)) > 0),
  movement_type text not null check (
    movement_type in (
      'opening_stock',
      'delivery',
      'manual_usage',
      'adjustment',
      'transfer_in',
      'transfer_out',
      'activity_usage',
      'activity_delivery'
    )
  ),
  quantity_delta numeric(12, 3) not null check (quantity_delta <> 0),
  movement_date date not null default current_date,
  activity_id uuid references daily_activities(id) on delete cascade,
  reference_no text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_consumable_movements_org_site
  on consumable_movements (organization_id, lower(btrim(site_name)), item_id);

create index if not exists idx_consumable_movements_org_date
  on consumable_movements (organization_id, movement_date desc, created_at desc);

create index if not exists idx_consumable_movements_activity
  on consumable_movements (activity_id)
  where activity_id is not null;

alter table consumable_items enable row level security;
alter table consumable_movements enable row level security;

grant select, insert, update, delete on consumable_items to authenticated;
grant select, insert, update, delete on consumable_movements to authenticated;

drop policy if exists "consumable_items read" on consumable_items;
create policy "consumable_items read" on consumable_items
  for select
  using (organization_id = current_org());

drop policy if exists "consumable_items write" on consumable_items;
create policy "consumable_items write" on consumable_items
  for all
  using (
    organization_id = current_org()
    and current_role_name() in ('admin', 'manager')
  )
  with check (
    organization_id = current_org()
    and current_role_name() in ('admin', 'manager')
  );

drop policy if exists "consumable_movements read" on consumable_movements;
create policy "consumable_movements read" on consumable_movements
  for select
  using (organization_id = current_org());

drop policy if exists "consumable_movements write" on consumable_movements;
create policy "consumable_movements write" on consumable_movements
  for all
  using (
    organization_id = current_org()
    and current_role_name() in ('admin', 'manager')
    and activity_id is null
    and movement_type not in ('activity_usage', 'activity_delivery')
  )
  with check (
    organization_id = current_org()
    and current_role_name() in ('admin', 'manager')
    and activity_id is null
    and movement_type not in ('activity_usage', 'activity_delivery')
  );

create or replace function seed_default_consumables(p_org_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_org_id is null then
    return;
  end if;

  insert into consumable_items (organization_id, code, name, category, unit, low_stock_threshold, sort_order)
  values
    (p_org_id, 'CHLORINE_GRAN', 'Chlorine — Calcium Hypochlorite 70% (Granules)', 'chlorine', 'kg', 25, 10),
    (p_org_id, 'CHLORINE_LIQ', 'Chlorine — Sodium Hypochlorite 12.5% (Liquid)', 'chlorine', 'L', 20, 20),
    (p_org_id, 'GASOLINE', 'Gasoline', 'fuel', 'L', 20, 30),
    (p_org_id, 'DIESEL', 'Diesel', 'fuel', 'L', 40, 40)
  on conflict do nothing;
end $$;

create or replace function trg_seed_org_default_consumables() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_default_consumables(new.id);
  return new;
end $$;

drop trigger if exists seed_org_consumables on organizations;
create trigger seed_org_consumables
  after insert on organizations
  for each row execute function trg_seed_org_default_consumables();

do $$
declare
  v_org record;
begin
  for v_org in select id from organizations loop
    perform seed_default_consumables(v_org.id);
  end loop;
end $$;

create or replace function parse_positive_consumable_qty(raw text) returns numeric
language plpgsql immutable as $$
declare
  v_clean text;
  v_num numeric;
begin
  v_clean := btrim(coalesce(raw, ''));
  if v_clean = '' or v_clean !~ '^[0-9]+(\.[0-9]+)?$' then
    return null;
  end if;
  v_num := round(v_clean::numeric, 3);
  if v_num <= 0 then
    return null;
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
    v_chem := lower(coalesce(new.details->>'chemicalType', ''));
    v_unit := lower(coalesce(new.details->>'amountUnit', ''));
    v_code := case
      when v_chem ~ 'sodium|liquid' or v_unit = 'l' then 'CHLORINE_LIQ'
      else 'CHLORINE_GRAN'
    end;
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

  v_fuel_type := lower(coalesce(new.details->>'fuelType', ''));
  v_code := case when v_fuel_type = 'gasoline' then 'GASOLINE' else 'DIESEL' end;
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

drop trigger if exists trg_sync_consumable_inventory_from_activity on daily_activities;
create trigger trg_sync_consumable_inventory_from_activity
  after insert or update or delete on daily_activities
  for each row execute function sync_consumable_inventory_from_activity();

drop trigger if exists audit_consumable_items on consumable_items;
create trigger audit_consumable_items
  after insert or update or delete on consumable_items
  for each row execute function log_audit();

drop trigger if exists audit_consumable_movements on consumable_movements;
create trigger audit_consumable_movements
  after insert or update or delete on consumable_movements
  for each row execute function log_audit();
