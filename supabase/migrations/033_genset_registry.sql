-- 033: Genset registry (Control # -> current site/well) and relocation history.
-- Enforces at most one active genset per site/location via a partial unique index
-- while preserving complete transfer history when a genset is relocated or repaired.

create table if not exists gensets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  control_no text not null,
  brand_model text,
  kva_rating text,
  fuel_type text not null default 'Diesel',
  status text not null default 'active' check (status in ('active', 'standby_yard', 'under_repair', 'retired')),
  current_location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists gensets_org_control_lower_uidx
  on gensets (organization_id, lower(btrim(control_no)));

-- Enforce: cannot move/assign an active genset onto a site that already has an active genset
create unique index if not exists gensets_org_active_location_uidx
  on gensets (organization_id, lower(btrim(current_location)))
  where status = 'active' and current_location is not null and btrim(current_location) <> '';

create index if not exists idx_gensets_org_status
  on gensets (organization_id, status);

create table if not exists genset_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  genset_id uuid not null references gensets(id) on delete cascade,
  from_location text,
  to_location text,
  reason text,
  moved_by uuid references auth.users(id) on delete set null,
  moved_at timestamptz not null default now()
);

create index if not exists idx_genset_transfers_org_genset
  on genset_transfers (organization_id, genset_id, moved_at desc);

create or replace function log_genset_location_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(old.current_location), '') is distinct from coalesce(btrim(new.current_location), '') then
    insert into genset_transfers (
      organization_id,
      genset_id,
      from_location,
      to_location,
      moved_by
    )
    values (
      new.organization_id,
      new.id,
      nullif(btrim(old.current_location), ''),
      nullif(btrim(new.current_location), ''),
      auth.uid()
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_genset_location_change on gensets;
create trigger trg_genset_location_change
  after update on gensets
  for each row execute function log_genset_location_change();

drop trigger if exists audit_gensets on gensets;
create trigger audit_gensets
  after insert or update or delete on gensets
  for each row execute function log_audit();

alter table gensets enable row level security;
alter table genset_transfers enable row level security;

drop policy if exists "gensets read" on gensets;
create policy "gensets read" on gensets
  for select
  using (organization_id = current_org());

drop policy if exists "gensets write" on gensets;
create policy "gensets write" on gensets
  for all
  using (
    organization_id = current_org()
    and (current_role_name() in ('admin', 'scheduler') or has_edit_grant())
  )
  with check (
    organization_id = current_org()
    and (current_role_name() in ('admin', 'scheduler') or has_edit_grant())
  );

drop policy if exists "genset_transfers read" on genset_transfers;
create policy "genset_transfers read" on genset_transfers
  for select
  using (organization_id = current_org());

drop policy if exists "genset_transfers write" on genset_transfers;
create policy "genset_transfers write" on genset_transfers
  for all
  using (
    organization_id = current_org()
    and (current_role_name() in ('admin', 'scheduler') or has_edit_grant())
  )
  with check (
    organization_id = current_org()
    and (current_role_name() in ('admin', 'scheduler') or has_edit_grant())
  );

grant select, insert, update, delete on gensets to authenticated;
grant select, insert, update on genset_transfers to authenticated;
