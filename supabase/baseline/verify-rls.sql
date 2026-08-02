-- Dedicated RLS catalogue gate, executed after the full baseline verification.
do $$
declare actual integer;
begin
  select count(*) into actual
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;
  if actual <> 80 then raise exception 'expected RLS on all 80 public tables, found %', actual; end if;
end
$$;
\echo STAGE_A_CASE rls.all_80_public_tables_have_rls_enabled PASS
