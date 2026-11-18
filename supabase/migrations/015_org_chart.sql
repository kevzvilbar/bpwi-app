-- Editable Organizational Chart (Heads & Up) with flexible nodes, auto-vacate on resignation,
-- and auto-reassignment of subordinate operators when a new Head signs up.

create table if not exists org_positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  department_group text not null default 'OPERATIONS',
  tier text not null default 'staff' check (tier in ('executive', 'support', 'head', 'leadman', 'staff')),
  parent_position_id uuid references org_positions(id) on delete set null,
  secondary_parent_id uuid references org_positions(id) on delete set null,
  holder_user_id uuid references user_profiles(id) on delete set null,
  holder_operator_id uuid references operators(id) on delete set null,
  fallback_name text,
  shift_badge text,
  color_theme text not null default 'slate',
  is_vacant boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists org_positions_org_idx on org_positions (organization_id, sort_order);
create index if not exists org_positions_parent_idx on org_positions (parent_position_id);
create index if not exists org_positions_user_idx on org_positions (holder_user_id) where holder_user_id is not null;

create or replace function touch_org_position_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_org_position on org_positions;
create trigger trg_touch_org_position
  before update on org_positions
  for each row execute function touch_org_position_updated_at();

-- When a Head/User is deactivated (resigned), automatically vacate their org_positions slot
-- without deleting the position or breaking the subordinate tree.
create or replace function auto_vacate_org_position_on_deactivate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (old.is_active = true and new.is_active = false) then
    update org_positions
      set holder_user_id = null,
          is_vacant = true
      where holder_user_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_auto_vacate_org_position on user_profiles;
create trigger trg_auto_vacate_org_position
  after update of is_active on user_profiles
  for each row execute function auto_vacate_org_position_on_deactivate();

-- When a Head/Executive position's holder_user_id changes to a new active user,
-- automatically sync user_profiles.job_title and reassign subordinate operators.department_head_id.
create or replace function sync_org_head_to_subordinates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tier in ('head', 'executive') and new.holder_user_id is not null and new.holder_user_id is distinct from old.holder_user_id then
    -- Sync job_title on the newly assigned head's profile
    update user_profiles
      set job_title = new.title
      where id = new.holder_user_id;

    -- Reassign direct and 2-hop (e.g. via leadman) subordinate operators to the new head
    update operators
      set department_head_id = new.holder_user_id
      where organization_id = new.organization_id
        and id in (
          select p.holder_operator_id
          from org_positions p
          left join org_positions parent on parent.id = p.parent_position_id
          where p.organization_id = new.organization_id
            and p.is_active = true
            and p.holder_operator_id is not null
            and (p.parent_position_id = new.id or parent.parent_position_id = new.id)
        );
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_org_head_to_subordinates on org_positions;
create trigger trg_sync_org_head_to_subordinates
  after update of holder_user_id on org_positions
  for each row execute function sync_org_head_to_subordinates();

drop trigger if exists audit_org_positions on org_positions;
create trigger audit_org_positions
  after insert or update or delete on org_positions
  for each row execute function log_audit();

-- RLS: Only Heads & Up (admin, scheduler, manager) can read; Admin & Department Heads can edit.
alter table org_positions enable row level security;

drop policy if exists "org_positions read heads" on org_positions;
create policy "org_positions read heads" on org_positions
  for select using (
    organization_id = current_org()
    and current_role_name() in ('admin', 'scheduler', 'manager')
  );

drop policy if exists "org_positions insert heads" on org_positions;
create policy "org_positions insert heads" on org_positions
  for insert with check (
    organization_id = current_org()
    and current_role_name() in ('admin', 'manager')
  );

drop policy if exists "org_positions update heads" on org_positions;
create policy "org_positions update heads" on org_positions
  for update using (
    organization_id = current_org()
    and current_role_name() in ('admin', 'manager')
  ) with check (
    organization_id = current_org()
    and current_role_name() in ('admin', 'manager')
  );

drop policy if exists "org_positions delete heads" on org_positions;
create policy "org_positions delete heads" on org_positions
  for delete using (
    organization_id = current_org()
    and current_role_name() in ('admin', 'manager')
  );

-- Seed the BPWI Iloilo Field Office Master Organizational Chart for an organization (idempotent)
create or replace function seed_bpwi_iloilo_org_chart(p_org_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_exec uuid;
  v_plant_head uuid;
  v_tech_head uuid;
  v_proj_head uuid;
  v_comm_head uuid;
  v_leadman uuid;
begin
  if exists (select 1 from org_positions where organization_id = p_org_id) then
    return;
  end if;

  -- Executive
  insert into org_positions (organization_id, title, department_group, tier, fallback_name, color_theme, sort_order)
  values (p_org_id, 'Business Unit Head', 'MANAGING HEAD', 'executive', 'Hernan Talavera', 'navy', 1)
  returning id into v_exec;

  -- Support Group (Advisory & Control)
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, color_theme, sort_order) values
    (p_org_id, 'HR Assist./GS/SO', 'SUPPORT GROUP', 'support', v_exec, 'Jonela Amoyan', 'slate', 10),
    (p_org_id, 'Proc/Warehouse Man', 'SUPPORT GROUP', 'support', v_exec, 'John Paul Valencia', 'slate', 11),
    (p_org_id, 'Data Analyst', 'SUPPORT GROUP', 'support', v_exec, 'Hanna Igon-Igon', 'slate', 12);

  -- Gardener directly under Managing Head
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, shift_badge, color_theme, sort_order) values
    (p_org_id, 'Gardener', 'SUPPORT STAFF', 'staff', v_exec, 'Jerome Pagsuguiron', '7AM–4PM', 'slate', 15);

  -- 4 Department Heads
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, color_theme, sort_order)
  values (p_org_id, 'Plant Operations Head', 'WATER SUPPLY • PAVIA', 'head', v_exec, 'Kevin Vilbar', 'blue', 20)
  returning id into v_plant_head;

  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, color_theme, sort_order)
  values (p_org_id, 'Technical Head', 'TECHNICAL', 'head', v_exec, 'Arnold Diaday Jr.', 'blue', 21)
  returning id into v_tech_head;

  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, color_theme, sort_order)
  values (p_org_id, 'Project Head', 'PROJECT SPECIALISTS', 'head', v_exec, 'Andrea Faith Galon', 'teal', 22)
  returning id into v_proj_head;

  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, color_theme, sort_order)
  values (p_org_id, 'Commercial Head', 'COMMERCIAL OPERATIONS', 'head', v_exec, 'Mayrose Lebuna', 'purple', 23)
  returning id into v_comm_head;

  -- Leadman bridging Plant Ops & Technical
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, secondary_parent_id, fallback_name, shift_badge, color_theme, sort_order)
  values (p_org_id, 'Technical Leadman • Electro-Mech', 'LEADMAN', 'leadman', v_tech_head, v_plant_head, 'Ghelson Viejo', '7AM–4PM', 'blue', 30)
  returning id into v_leadman;

  -- WATER SUPPLY • PAVIA
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, shift_badge, color_theme, sort_order) values
    (p_org_id, 'Water Supply Specialist', 'WATER SUPPLY • PAVIA', 'staff', v_plant_head, 'Jose Marie Alipala Jr', 'Shifting', 'slate', 40),
    (p_org_id, 'Water Supply Specialist', 'WATER SUPPLY • PAVIA', 'staff', v_plant_head, 'Rheynante Toledo', 'Shifting', 'slate', 41),
    (p_org_id, 'Water Supply Specialist', 'WATER SUPPLY • PAVIA', 'staff', v_plant_head, 'Exo John Rogador', 'Shifting', 'slate', 42),
    (p_org_id, 'Water Supply Specialist / Meter Reader', 'WATER SUPPLY • PAVIA', 'staff', v_plant_head, 'Franz Justin Grajo', 'Shifting', 'purple', 43);

  -- LEAK DETECTION & NIGHT SHIFT
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, shift_badge, color_theme, sort_order) values
    (p_org_id, 'Leak Detection Spec.', 'LEAK DETECTION & NIGHT SHIFT', 'staff', v_tech_head, 'Jasson Salarda', '7AM–4PM', 'slate', 50),
    (p_org_id, 'Leak Detection Spec.', 'LEAK DETECTION & NIGHT SHIFT', 'staff', v_tech_head, 'Gerald Romaldon', '7AM–4PM', 'slate', 51);

  -- TECHNICAL MAINTENANCE
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, shift_badge, color_theme, sort_order) values
    (p_org_id, 'Tech Maint. / Driver', 'TECHNICAL MAINTENANCE', 'staff', v_tech_head, 'Aladen Pareño', '7AM–4PM', 'blue', 60),
    (p_org_id, 'Tech Maint. / Driver', 'TECHNICAL MAINTENANCE', 'staff', v_tech_head, 'L Alave', '7AM–4PM', 'blue', 61),
    (p_org_id, 'Tech Maintenance', 'TECHNICAL MAINTENANCE', 'staff', v_tech_head, 'Armandico Honorio', '7AM–4PM', 'slate', 62),
    (p_org_id, 'Night Maintenance', 'TECHNICAL MAINTENANCE', 'staff', v_tech_head, 'Charel Culasino', '10PM–7AM', 'amber', 63);

  -- PROJECT SPECIALISTS
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, shift_badge, color_theme, sort_order) values
    (p_org_id, 'Project Specialist', 'PROJECT SPECIALISTS', 'staff', v_proj_head, 'Leonardo Enanoria', '7AM–4PM', 'slate', 70),
    (p_org_id, 'Project Specialist', 'PROJECT SPECIALISTS', 'staff', v_proj_head, 'Vincent Rocamora', '7AM–4PM', 'slate', 71),
    (p_org_id, 'Project Specialist', 'PROJECT SPECIALISTS', 'staff', v_proj_head, 'Jeiel Villanueva', '7AM–4PM', 'slate', 72);

  -- COMMERCIAL OPERATIONS
  insert into org_positions (organization_id, title, department_group, tier, parent_position_id, fallback_name, shift_badge, color_theme, sort_order) values
    (p_org_id, 'Customer Service', 'COMMERCIAL OPERATIONS', 'staff', v_comm_head, 'Haydeline Quinto', null, 'slate', 80),
    (p_org_id, 'Commercial (Billing) Specialist', 'COMMERCIAL OPERATIONS', 'staff', v_comm_head, 'Jene Liza Macaya', null, 'slate', 81),
    (p_org_id, 'Meter Reader', 'COMMERCIAL OPERATIONS', 'staff', v_comm_head, 'Joseph Magbanua', '7AM–4PM', 'slate', 82);

  -- Auto-link matching operators and user_profiles by name
  update org_positions p
    set holder_operator_id = o.id
    from operators o
    where p.organization_id = p_org_id
      and o.organization_id = p_org_id
      and lower(trim(o.full_name)) = lower(trim(p.fallback_name));

  update org_positions p
    set holder_user_id = u.id
    from user_profiles u
    where p.organization_id = p_org_id
      and u.organization_id = p_org_id
      and u.is_active = true
      and lower(trim(u.full_name)) = lower(trim(p.fallback_name));
end $$;

-- Seed for all existing organizations on migration
do $$
declare r record;
begin
  for r in select id from organizations loop
    perform seed_bpwi_iloilo_org_chart(r.id);
  end loop;
end $$;
