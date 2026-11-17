-- Editable PM activity types (names, short chip labels, and colors)
create table if not exists pm_activity_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  code text not null,
  label text not null,
  short_label text not null,
  color text not null default '#0284c7',
  sort_order int not null default 0,
  unique (organization_id, code)
);

alter table pm_activity_types enable row level security;

create policy "pm_activity_types read" on pm_activity_types
  for select using (organization_id = current_org());

create policy "pm_activity_types write" on pm_activity_types
  for all
  using (organization_id = current_org() and current_role_name() in ('admin', 'scheduler'))
  with check (organization_id = current_org() and current_role_name() in ('admin', 'scheduler'));
