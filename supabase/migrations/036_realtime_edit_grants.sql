-- 036: Register public.edit_grants in the supabase_realtime publication so
-- live Edit Access window changes (grants, extensions, revocations) propagate
-- to subscribed clients instead of silently no-oping.
--
-- Idempotent and guarded when the supabase_realtime publication does not exist.

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'edit_grants'
  ) then
    alter publication supabase_realtime add table public.edit_grants;
  end if;
end $$;
