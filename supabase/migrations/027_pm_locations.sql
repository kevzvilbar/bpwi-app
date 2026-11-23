-- Saved PM Locations / Areas catalog (merged with station area_codes.sub_sites in the UI).
create table if not exists pm_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists pm_locations_org_name_lower_uidx
  on pm_locations (organization_id, lower(trim(name)));

create index if not exists pm_locations_org_sort_idx
  on pm_locations (organization_id, sort_order, name);

alter table pm_locations enable row level security;
grant select, insert, update, delete on pm_locations to authenticated;

drop policy if exists "pm_locations read" on pm_locations;
create policy "pm_locations read" on pm_locations
  for select using (organization_id = current_org());

drop policy if exists "pm_locations write" on pm_locations;
create policy "pm_locations write" on pm_locations
  for all
  using (
    organization_id = current_org()
    and (current_role_name() in ('admin', 'scheduler') or has_edit_grant())
  )
  with check (
    organization_id = current_org()
    and (current_role_name() in ('admin', 'scheduler') or has_edit_grant())
  );

-- Idempotent backfill from station sub_sites and historical pm_tasks.locations
insert into pm_locations (organization_id, name, sort_order)
select
  src.organization_id,
  (array_agg(src.trimmed_name order by src.source_rank, src.trimmed_name))[1] as canonical_name,
  row_number() over (partition by src.organization_id order by lower(src.trimmed_name)) - 1 as sort_order
from (
  select
    ac.organization_id,
    trim(s) as trimmed_name,
    1 as source_rank
  from area_codes ac, unnest(ac.sub_sites) as s
  where ac.category = 'station'
    and length(trim(s)) > 0
  union all
  select
    pm.organization_id,
    trim(loc) as trimmed_name,
    2 as source_rank
  from pm_tasks pm, unnest(pm.locations) as loc
  where length(trim(loc)) > 0
) src
group by src.organization_id, lower(src.trimmed_name)
on conflict (organization_id, lower(trim(name))) do nothing;
