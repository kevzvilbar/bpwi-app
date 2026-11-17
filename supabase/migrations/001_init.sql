-- BPWI Monitoring: core schema + Row Level Security
create extension if not exists pgcrypto;

create table organizations (id uuid primary key default gen_random_uuid(), name text not null, timezone text not null default 'Asia/Manila');

create type app_role as enum ('admin','scheduler','operator','viewer');
create table user_profiles (
  id uuid primary key references auth.users on delete cascade,
  organization_id uuid not null references organizations on delete cascade,
  full_name text, phone_number text, role app_role not null default 'viewer', is_active boolean not null default true
);

create table operators (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  legacy_key text, employee_code text, full_name text not null, phone_number text, position text,
  default_station text, sort_order int not null default 0, is_active boolean not null default true,
  unique (organization_id, legacy_key)
);
create table shift_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  legacy_key text, code text not null, description text, start_time time, end_time time,
  duration_hours numeric not null default 0, is_off boolean not null default false,
  background_color text not null default '#ffffff', text_color text not null default '#0f172a',
  unique (organization_id, legacy_key)
);
create table area_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  code text not null, name text, category text not null default 'station' check (category in ('station','leave','holiday')),
  background_color text not null default '#f1f5f9', text_color text not null default '#1e293b',
  unique (organization_id, code)
);
create table schedule_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  operator_id uuid not null references operators on delete cascade,
  schedule_date date not null,
  shift_type_id uuid references shift_types, area_code_id uuid references area_codes,
  notes text, created_by uuid references auth.users, updated_at timestamptz not null default now(),
  unique (operator_id, schedule_date)
);
create index on schedule_assignments (organization_id, schedule_date);
create table standby_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  operator_id uuid not null references operators on delete cascade,
  schedule_date date not null, standby_type text not null default 'OC', status text not null default 'assigned', notes text,
  unique (operator_id, schedule_date)
);
create table leave_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  operator_id uuid not null references operators on delete cascade,
  leave_code text not null, start_date date not null, end_date date not null,
  status text not null default 'approved', remarks text, approved_by uuid references auth.users
);
create table pm_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  legacy_key text, activity_type text not null, title text not null, locations text[] not null default '{}', asset text,
  assigned_operator_ids uuid[] not null default '{}', scheduled_date date not null,
  status text not null default 'planned' check (status in ('planned','done','postponed')),
  completed_at date, remarks text, unique (organization_id, legacy_key)
);
create table audit_logs (
  id bigint generated always as identity primary key, user_id uuid, action text, table_name text, record_id text,
  old_value jsonb, new_value jsonb, created_at timestamptz not null default now()
);

-- helpers
create function current_org() returns uuid language sql stable security definer set search_path = public as
  $$ select organization_id from user_profiles where id = auth.uid() and is_active $$;
create function current_role_name() returns app_role language sql stable security definer set search_path = public as
  $$ select role from user_profiles where id = auth.uid() and is_active $$;

-- audit trigger
create function log_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs(user_id, action, table_name, record_id, old_value, new_value)
  values (auth.uid(), tg_op, tg_table_name, coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id')),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger audit_assign after insert or update or delete on schedule_assignments for each row execute function log_audit();
create trigger audit_standby after insert or update or delete on standby_assignments for each row execute function log_audit();
create trigger audit_pm after insert or update or delete on pm_tasks for each row execute function log_audit();
create trigger audit_leave after insert or update or delete on leave_records for each row execute function log_audit();

-- RLS: everyone in the org reads; admin/scheduler write; config tables admin-only
do $$ declare t text; begin
  foreach t in array array['operators','shift_types','area_codes','schedule_assignments','standby_assignments','leave_records','pm_tasks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "%1$s read" on %1$I for select using (organization_id = current_org())', t);
  end loop;
  foreach t in array array['schedule_assignments','standby_assignments','leave_records','pm_tasks'] loop
    execute format('create policy "%1$s write" on %1$I for all using (organization_id = current_org() and current_role_name() in (''admin'',''scheduler'')) with check (organization_id = current_org() and current_role_name() in (''admin'',''scheduler''))', t);
  end loop;
  foreach t in array array['operators','shift_types','area_codes'] loop
    execute format('create policy "%1$s write" on %1$I for all using (organization_id = current_org() and current_role_name() = ''admin'') with check (organization_id = current_org() and current_role_name() = ''admin'')', t);
  end loop;
end $$;
alter table organizations enable row level security;
create policy "org read" on organizations for select using (id = current_org());
alter table user_profiles enable row level security;
create policy "profile read" on user_profiles for select using (organization_id = current_org());
create policy "profile admin write" on user_profiles for all using (organization_id = current_org() and current_role_name() = 'admin') with check (organization_id = current_org());
alter table audit_logs enable row level security;
create policy "audit read" on audit_logs for select using (current_role_name() = 'admin');

alter publication supabase_realtime add table schedule_assignments, standby_assignments, pm_tasks;

-- First-time bootstrap (run once in the SQL editor, after you sign up your first user):
--   insert into organizations(name) values ('BP Waterworks, Inc.') returning id;
--   insert into user_profiles(id, organization_id, full_name, role) values ('<your auth user id>', '<org id>', 'Your Name', 'admin');
