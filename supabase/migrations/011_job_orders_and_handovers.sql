-- Phase 2: Dispatched Job Orders & Shift Handover Logs
-- Connects customer/dispatch job orders to roster operators, areas, and daily activity logs.

create table if not exists job_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  jo_number text not null,
  title text not null,
  activity_type text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  area_code_id uuid references area_codes on delete set null,
  site_or_well text,
  block_lot text,
  account_number text,
  account_name text,
  contact_number text,
  description text,
  assigned_operator_ids uuid[] not null default '{}',
  deadline timestamptz,
  estimated_hours numeric default 2,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  tat_justification text,
  created_by uuid references auth.users on delete set null default auth.uid(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_orders_org_status_idx
  on job_orders (organization_id, status, deadline);

create unique index if not exists job_orders_org_number_uidx
  on job_orders (organization_id, jo_number);

-- Link field activities to job orders
alter table daily_activities
  add column if not exists job_order_id uuid references job_orders on delete set null;

create index if not exists daily_activities_job_order_idx
  on daily_activities (job_order_id)
  where job_order_id is not null;

-- Collision-free JO-YYYYMM-NNN sequence generator when jo_number is blank or 'AUTO'
create or replace function assign_job_order_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ym text;
  next_seq int;
begin
  if new.jo_number is null or btrim(new.jo_number) = '' or upper(btrim(new.jo_number)) = 'AUTO' then
    ym := to_char(now() at time zone 'Asia/Manila', 'YYYYMM');
    perform pg_advisory_xact_lock(hashtext(new.organization_id::text || '-' || ym));
    select coalesce(max((regexp_match(jo_number, '^JO-' || ym || '-([0-9]+)$'))[1]::int), 0) + 1
      into next_seq
      from job_orders
      where organization_id = new.organization_id
        and jo_number like ('JO-' || ym || '-%');
    new.jo_number := 'JO-' || ym || '-' || lpad(next_seq::text, 3, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_job_orders_number on job_orders;
create trigger trg_job_orders_number
  before insert on job_orders
  for each row execute function assign_job_order_number();

create or replace function touch_job_orders_updated_at() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and current_role_name() = 'operator' then
    if new.jo_number is distinct from old.jo_number
       or new.title is distinct from old.title
       or new.priority is distinct from old.priority
       or new.assigned_operator_ids is distinct from old.assigned_operator_ids
       or new.deadline is distinct from old.deadline
       or new.area_code_id is distinct from old.area_code_id then
      raise exception 'Operators can only update job order status, completion timestamp, or turnaround justification';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_job_orders_updated_at on job_orders;
create trigger trg_job_orders_updated_at
  before update on job_orders
  for each row execute function touch_job_orders_updated_at();

-- Shift handovers / daily huddle log
create table if not exists shift_handovers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  handover_date date not null default ((now() at time zone 'Asia/Manila')::date),
  shift_type_id uuid references shift_types on delete set null,
  area_code_id uuid references area_codes on delete set null,
  outgoing_operator_id uuid references operators on delete set null,
  incoming_operator_id uuid references operators on delete set null,
  plant_status text not null default 'normal' check (plant_status in ('normal', 'watch', 'critical')),
  summary text not null,
  pending_items text,
  chemical_fuel_notes text,
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists shift_handovers_org_date_idx
  on shift_handovers (organization_id, handover_date desc);

-- Audit trail triggers
drop trigger if exists audit_job_orders on job_orders;
create trigger audit_job_orders
  after insert or update or delete on job_orders
  for each row execute function log_audit();

drop trigger if exists audit_shift_handovers on shift_handovers;
create trigger audit_shift_handovers
  after insert or update or delete on shift_handovers
  for each row execute function log_audit();

-- Row Level Security: job_orders
alter table job_orders enable row level security;

drop policy if exists "job_orders read" on job_orders;
create policy "job_orders read" on job_orders
  for select using (organization_id = current_org());

drop policy if exists "job_orders insert" on job_orders;
create policy "job_orders insert" on job_orders
  for insert with check (
    organization_id = current_org()
    and current_role_name() in ('admin', 'scheduler', 'manager')
  );

drop policy if exists "job_orders update" on job_orders;
create policy "job_orders update" on job_orders
  for update using (
    organization_id = current_org()
    and (
      current_role_name() in ('admin', 'scheduler', 'manager')
      or (
        current_role_name() = 'operator'
        and (
          current_operator_id() is null
          or current_operator_id() = any(assigned_operator_ids)
          or cardinality(assigned_operator_ids) = 0
        )
      )
    )
  ) with check (
    organization_id = current_org()
    and (
      current_role_name() in ('admin', 'scheduler', 'manager')
      or current_role_name() = 'operator'
    )
  );

drop policy if exists "job_orders delete" on job_orders;
create policy "job_orders delete" on job_orders
  for delete using (
    organization_id = current_org()
    and current_role_name() in ('admin', 'scheduler', 'manager')
  );

-- Row Level Security: shift_handovers
alter table shift_handovers enable row level security;

drop policy if exists "shift_handovers read" on shift_handovers;
create policy "shift_handovers read" on shift_handovers
  for select using (organization_id = current_org());

drop policy if exists "shift_handovers write" on shift_handovers;
create policy "shift_handovers write" on shift_handovers
  for insert with check (
    organization_id = current_org()
    and current_role_name() in ('operator', 'admin', 'scheduler', 'manager')
  );

drop policy if exists "shift_handovers update" on shift_handovers;
create policy "shift_handovers update" on shift_handovers
  for update using (
    organization_id = current_org()
    and (created_by = auth.uid() or current_role_name() in ('admin', 'scheduler', 'manager'))
  ) with check (
    organization_id = current_org()
    and (created_by = auth.uid() or current_role_name() in ('admin', 'scheduler', 'manager'))
  );

drop policy if exists "shift_handovers delete" on shift_handovers;
create policy "shift_handovers delete" on shift_handovers
  for delete using (
    organization_id = current_org()
    and current_role_name() = 'admin'
  );

-- Realtime publication
do $$
begin
  alter publication supabase_realtime add table job_orders, shift_handovers;
exception when duplicate_object then
  null;
end $$;
