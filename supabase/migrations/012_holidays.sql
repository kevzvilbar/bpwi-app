-- Organization Holiday Calendar (non-destructive calendar layer)
-- Holidays highlight Roster & PM Planner dates and track Holiday Shifts Worked in Reports
-- without overwriting 24/7 plant operators' actual shift assignments.

create table if not exists holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  holiday_date date not null,
  name text not null,
  holiday_type text not null default 'regular' check (holiday_type in ('regular', 'special_non_working', 'company')),
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (organization_id, holiday_date)
);

create index if not exists holidays_org_date_idx
  on holidays (organization_id, holiday_date);

drop trigger if exists audit_holidays on holidays;
create trigger audit_holidays
  after insert or update or delete on holidays
  for each row execute function log_audit();

alter table holidays enable row level security;

drop policy if exists "holidays read" on holidays;
create policy "holidays read" on holidays
  for select using (organization_id = current_org());

drop policy if exists "holidays write" on holidays;
create policy "holidays write" on holidays
  for all using (
    organization_id = current_org()
    and current_role_name() in ('admin', 'scheduler')
  ) with check (
    organization_id = current_org()
    and current_role_name() in ('admin', 'scheduler')
  );

do $$
begin
  alter publication supabase_realtime add table holidays;
exception when duplicate_object then
  null;
end $$;
