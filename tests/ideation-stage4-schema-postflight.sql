-- Ideation Stage 4 — post-migration schema assertions.
-- Verifies the deployed shape of the commit domain: tables, constraints,
-- indexes, ownership foreign keys, RPCs, search_path, RLS, and grants.

\set ON_ERROR_STOP on

do $$
declare
  v_count integer;
begin
  -- Tables.
  for v_count in
    select 1 from unnest(array['client_ideation_commit_runs','client_ideation_commit_items']) as t(name)
    where not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.name and c.relkind = 'r')
  loop
    raise exception 'Stage 4 table missing';
  end loop;

  -- RLS is enabled on both, with SELECT-only policies for authenticated staff.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('client_ideation_commit_runs','client_ideation_commit_items')
      and not c.relrowsecurity
  ) then
    raise exception 'Stage 4 RLS is not enabled';
  end if;
  select count(*) into v_count from pg_policies
  where schemaname = 'public' and tablename like 'client_ideation_commit_%';
  if v_count <> 2 then raise exception 'expected 2 Stage 4 policies, found %', v_count; end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename like 'client_ideation_commit_%' and cmd <> 'SELECT'
  ) then
    raise exception 'a Stage 4 policy allows more than SELECT';
  end if;

  -- No authenticated write privilege exists on either table.
  if has_table_privilege('authenticated', 'public.client_ideation_commit_runs', 'INSERT')
    or has_table_privilege('authenticated', 'public.client_ideation_commit_runs', 'UPDATE')
    or has_table_privilege('authenticated', 'public.client_ideation_commit_runs', 'DELETE')
    or has_table_privilege('authenticated', 'public.client_ideation_commit_items', 'INSERT')
    or has_table_privilege('authenticated', 'public.client_ideation_commit_items', 'UPDATE')
    or has_table_privilege('authenticated', 'public.client_ideation_commit_items', 'DELETE') then
    raise exception 'authenticated holds a write privilege on a Stage 4 table';
  end if;
  if not has_table_privilege('authenticated', 'public.client_ideation_commit_runs', 'SELECT') then
    raise exception 'authenticated cannot select commit runs';
  end if;
  if has_table_privilege('anon', 'public.client_ideation_commit_runs', 'SELECT') then
    raise exception 'anon can select commit runs';
  end if;

  -- The one-completed-commit-per-proposal guarantee is structural.
  if not exists (
    select 1 from pg_indexes where schemaname = 'public'
      and indexname = 'client_ideation_commit_runs_one_completed_idx'
      and indexdef like '%UNIQUE%' and indexdef like '%status = ''completed''%'
  ) then
    raise exception 'the one-completed-commit unique index is missing';
  end if;

  -- Composite ownership foreign keys.
  for v_count in
    select 1 from unnest(array[
      'client_ideation_commit_runs_proposal_fk',
      'client_ideation_commit_runs_scoring_run_fk',
      'client_ideation_commit_runs_cycle_fk',
      'client_ideation_commit_items_run_fk',
      'client_ideation_commit_items_slot_fk',
      'client_ideation_commit_items_proposal_fk',
      'client_ideation_commit_items_candidate_fk',
      'client_ideation_commit_items_score_fk'
    ]) as t(name)
    where not exists (select 1 from pg_constraint where conname = t.name and contype = 'f')
  loop
    raise exception 'a Stage 4 ownership foreign key is missing';
  end loop;

  -- Uniqueness that prevents duplicate masters, Calendar rows, and refs.
  for v_count in
    select 1 from unnest(array[
      'client_ideation_commit_items_run_slot_key',
      'client_ideation_commit_items_run_candidate_key',
      'client_ideation_commit_items_master_key',
      'client_ideation_commit_items_calendar_key',
      'client_ideation_commit_items_ref_key'
    ]) as t(name)
    where not exists (select 1 from pg_constraint where conname = t.name and contype = 'u')
  loop
    raise exception 'a Stage 4 uniqueness constraint is missing';
  end loop;

  -- RPCs exist, are SECURITY DEFINER, and pin search_path.
  for v_count in
    select 1 from unnest(array[
      'commit_ideation_content','record_ideation_commit_failure','log_ideation_commit_replay'
    ]) as t(name)
    where not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = t.name
        and p.prosecdef and p.proconfig @> array['search_path=public'])
  loop
    raise exception 'a Stage 4 RPC is missing, not SECURITY DEFINER, or has an unpinned search_path';
  end loop;

  -- Execute privileges: service role only.
  for v_count in
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('commit_ideation_content','record_ideation_commit_failure',
                        'log_ideation_commit_replay','ideation_commit_target')
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('anon', p.oid, 'EXECUTE')
        or not has_function_privilege('service_role', p.oid, 'EXECUTE'))
  loop
    raise exception 'a Stage 4 function has incorrect execute privileges';
  end loop;

  -- The target manifest resolves exactly the four supported types.
  if (select count(*) from (
        select unnest(array['reel','carousel','static','story']) as asset) a
      cross join lateral public.ideation_commit_target(a.asset)) <> 4 then
    raise exception 'the SQL target manifest does not resolve all four asset types';
  end if;
  if exists (select 1 from public.ideation_commit_target('ad')) then
    raise exception 'the SQL target manifest resolves an ad type';
  end if;

  raise notice 'Stage 4 schema postflight passed.';
end
$$;
