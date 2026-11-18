-- Editable app title on organizations and admin update policy
alter table organizations
  add column if not exists app_title text not null default 'Operations & Plant Schedule';

drop policy if exists "org admin write" on organizations;
create policy "org admin write" on organizations
  for update
  using (id = current_org() and current_role_name() = 'admin')
  with check (id = current_org() and current_role_name() = 'admin');
