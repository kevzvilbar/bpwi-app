-- 1. Allow Admins AND Department Heads (managers) to safely update organizations.org_chart_meta
--    without exposing broad UPDATE rights on the organizations table.
create or replace function update_org_chart_meta(p_org_id uuid, p_meta jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_org_id is distinct from current_org() or current_role_name() not in ('admin', 'manager') then
    raise exception 'Only admins and department heads can update the organization chart header';
  end if;
  update organizations
    set org_chart_meta = p_meta
    where id = p_org_id;
end $$;

grant execute on function update_org_chart_meta(uuid, jsonb) to authenticated;

-- 2. Auto-sync operators.department_head_id whenever a single staff/leadman node's
--    parent_position_id or holder_operator_id changes in org_positions.
create or replace function sync_org_staff_head_on_move() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_head_user_id uuid;
begin
  if new.holder_operator_id is null or new.is_active = false then
    return new;
  end if;

  -- Walk up 1 or 2 hops (direct parent or parent's parent via leadman) to find nearest head/executive with an app account
  select coalesce(
    case when p1.tier in ('head', 'executive') and p1.holder_user_id is not null then p1.holder_user_id else null end,
    case when p2.tier in ('head', 'executive') and p2.holder_user_id is not null then p2.holder_user_id else null end
  )
  into v_head_user_id
  from org_positions cur
  left join org_positions p1 on p1.id = cur.parent_position_id
  left join org_positions p2 on p2.id = p1.parent_position_id
  where cur.id = new.id;

  if v_head_user_id is not null then
    update operators
      set department_head_id = v_head_user_id
      where id = new.holder_operator_id
        and organization_id = new.organization_id
        and department_head_id is distinct from v_head_user_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_org_staff_head_on_move on org_positions;
create trigger trg_sync_org_staff_head_on_move
  after insert or update of parent_position_id, holder_operator_id, is_active on org_positions
  for each row execute function sync_org_staff_head_on_move();
