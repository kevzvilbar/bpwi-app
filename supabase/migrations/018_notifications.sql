-- In-app notifications for Accomplishment Reports (BPEMS-F-002) and Change Requests

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'info',
  title text not null,
  body text,
  href text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on notifications (user_id, is_read, created_at desc);

alter table notifications enable row level security;

drop policy if exists "notifications read own" on notifications;
create policy "notifications read own" on notifications
  for select using (user_id = auth.uid());

drop policy if exists "notifications update own" on notifications;
create policy "notifications update own" on notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notifications delete own" on notifications;
create policy "notifications delete own" on notifications
  for delete using (user_id = auth.uid());

-- Trigger: Accomplishment Report submitted / checked / returned
create or replace function notify_on_accomplishment_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.status = 'submitted')
     or (tg_op = 'UPDATE' and new.status = 'submitted' and old.status is distinct from 'submitted') then
    if new.assigned_head_id is not null and new.assigned_head_id is distinct from new.submitted_by then
      insert into notifications (organization_id, user_id, kind, title, body, href)
      values (
        new.organization_id,
        new.assigned_head_id,
        'report_submitted',
        'New Accomplishment Report',
        coalesce(nullif(new.prepared_by_name, ''), 'Staff') || ' submitted BPEMS-F-002 for ' || new.report_date::text,
        '/reports'
      );
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'checked' and old.status is distinct from 'checked' then
    if new.submitted_by is not null and new.submitted_by is distinct from new.checked_by then
      insert into notifications (organization_id, user_id, kind, title, body, href)
      values (
        new.organization_id,
        new.submitted_by,
        'report_checked',
        'Accomplishment Report Checked',
        coalesce(nullif(new.checked_by_name, ''), 'Department Head') || ' checked your report for ' || new.report_date::text,
        '/reports'
      );
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'returned' and old.status is distinct from 'returned' then
    if new.submitted_by is not null then
      insert into notifications (organization_id, user_id, kind, title, body, href)
      values (
        new.organization_id,
        new.submitted_by,
        'report_returned',
        'Report Returned for Revision',
        coalesce(nullif(new.head_remarks, ''), 'Please review and update your report for ' || new.report_date::text),
        '/reports'
      );
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_accomplishment_report on accomplishment_reports;
create trigger trg_notify_accomplishment_report
  after insert or update of status on accomplishment_reports
  for each row execute function notify_on_accomplishment_report();

-- Trigger: Change Request submitted / approved / rejected
create or replace function notify_on_change_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.status = 'pending')
     or (tg_op = 'UPDATE' and new.status = 'pending' and old.status is distinct from 'pending') then
    insert into notifications (organization_id, user_id, kind, title, body, href)
    select
      new.organization_id,
      up.id,
      'request_pending',
      'New Change Request',
      coalesce(nullif(new.title, ''), 'Schedule / leave change request') || ' is awaiting approval',
      '/requests'
    from user_profiles up
    where up.organization_id = new.organization_id
      and up.is_active = true
      and (up.role = 'admin' or up.can_approve = true)
      and up.id is distinct from new.requester_id;
  elsif tg_op = 'UPDATE' and new.status in ('approved', 'rejected') and old.status is distinct from new.status then
    if new.requester_id is not null then
      insert into notifications (organization_id, user_id, kind, title, body, href)
      values (
        new.organization_id,
        new.requester_id,
        'request_' || new.status,
        'Change Request ' || initcap(new.status),
        coalesce(nullif(new.title, ''), 'Your change request') || ' was ' || new.status,
        '/requests'
      );
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_change_request on change_requests;
create trigger trg_notify_change_request
  after insert or update of status on change_requests
  for each row execute function notify_on_change_request();
