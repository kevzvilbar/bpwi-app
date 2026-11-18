-- Daily Accomplishment Report (BPEMS-F-002) & Assigned Department Head per operator

alter table operators
  add column if not exists department_head_id uuid references user_profiles(id) on delete set null;

create index if not exists operators_head_idx on operators (department_head_id) where department_head_id is not null;

create table if not exists accomplishment_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  report_date date not null,
  shift_type_id uuid references shift_types(id) on delete set null,
  operator_id uuid references operators(id) on delete set null,
  submitted_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  assigned_head_id uuid references user_profiles(id) on delete set null,
  prepared_by_name text not null default '',
  prepared_by_title text not null default '',
  checked_by_name text,
  checked_by_title text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'checked', 'returned')),
  entries jsonb not null default '[]'::jsonb,
  summary_notes text,
  head_remarks text,
  submitted_at timestamptz,
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists accomplishment_reports_org_date_idx
  on accomplishment_reports (organization_id, report_date desc);
create index if not exists accomplishment_reports_head_idx
  on accomplishment_reports (assigned_head_id, status, report_date desc);
create index if not exists accomplishment_reports_submitter_idx
  on accomplishment_reports (submitted_by, report_date desc);

-- Keep updated_at fresh
create or replace function touch_accomplishment_report_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_accomplishment_report on accomplishment_reports;
create trigger trg_touch_accomplishment_report
  before update on accomplishment_reports
  for each row execute function touch_accomplishment_report_updated_at();

-- Prevent non-supervisors from stamping checked_by / checked_at / status = 'checked'
create or replace function guard_accomplishment_report_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_role_name() not in ('admin', 'scheduler', 'manager') then
    if new.status = 'checked' or new.checked_by is distinct from old.checked_by or new.checked_at is distinct from old.checked_at then
      raise exception 'Only assigned department heads or admins can check/approve accomplishment reports';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_accomplishment_report_check on accomplishment_reports;
create trigger trg_guard_accomplishment_report_check
  before update on accomplishment_reports
  for each row execute function guard_accomplishment_report_check();

drop trigger if exists audit_accomplishment_reports on accomplishment_reports;
create trigger audit_accomplishment_reports
  after insert or update or delete on accomplishment_reports
  for each row execute function log_audit();

alter table accomplishment_reports enable row level security;

drop policy if exists "accomplishment_reports read" on accomplishment_reports;
create policy "accomplishment_reports read" on accomplishment_reports
  for select using (
    organization_id = current_org()
    and (
      current_role_name() in ('admin', 'scheduler', 'manager')
      or submitted_by = auth.uid()
      or assigned_head_id = auth.uid()
      or (current_operator_id() is not null and operator_id = current_operator_id())
    )
  );

drop policy if exists "accomplishment_reports insert" on accomplishment_reports;
create policy "accomplishment_reports insert" on accomplishment_reports
  for insert with check (
    organization_id = current_org()
    and current_role_name() in ('operator', 'admin', 'scheduler', 'manager')
    and submitted_by = auth.uid()
  );

drop policy if exists "accomplishment_reports update" on accomplishment_reports;
create policy "accomplishment_reports update" on accomplishment_reports
  for update using (
    organization_id = current_org()
    and (
      current_role_name() in ('admin', 'scheduler', 'manager')
      or assigned_head_id = auth.uid()
      or (submitted_by = auth.uid() and status in ('draft', 'returned', 'submitted'))
    )
  ) with check (
    organization_id = current_org()
    and (
      current_role_name() in ('admin', 'scheduler', 'manager')
      or assigned_head_id = auth.uid()
      or (submitted_by = auth.uid() and status in ('draft', 'submitted'))
    )
  );

drop policy if exists "accomplishment_reports delete" on accomplishment_reports;
create policy "accomplishment_reports delete" on accomplishment_reports
  for delete using (
    organization_id = current_org()
    and (
      current_role_name() = 'admin'
      or (submitted_by = auth.uid() and status = 'draft')
    )
  );
