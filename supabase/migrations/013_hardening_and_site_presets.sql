-- Phase 4 Hardening & Station Sub-Sites
-- 1. Tighten job_orders read RLS so operators/viewers only read JOs assigned to them (or unassigned).
-- 2. Add optional sub_sites array on area_codes so admins can configure standardized well/pump/site names per station.

drop policy if exists "job_orders read" on job_orders;
create policy "job_orders read" on job_orders
  for select using (
    organization_id = current_org()
    and (
      current_role_name() in ('admin', 'scheduler', 'manager')
      or created_by = auth.uid()
      or cardinality(assigned_operator_ids) = 0
      or (current_operator_id() is not null and current_operator_id() = any(assigned_operator_ids))
    )
  );

alter table area_codes
  add column if not exists sub_sites text[] not null default '{}';
