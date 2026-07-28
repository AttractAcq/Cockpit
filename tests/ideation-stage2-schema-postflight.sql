-- Ideation Stage 2 — post-migration verification against the authoritative schema.
-- Every check fails closed. Run immediately after applying the Stage 2 migration.

\set ON_ERROR_STOP on

do $$
declare
  v_missing text;
  v_count integer;
begin
  -- Tables exist with RLS enabled.
  for v_missing in
    select unnest(array['client_ideation_scoring_runs','client_ideation_candidate_scores'])
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_missing and c.relkind = 'r'
    ) then raise exception 'MISSING_TABLE: %', v_missing; end if;
    if not (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = v_missing) then
      raise exception 'RLS_NOT_ENABLED: %', v_missing;
    end if;
  end loop;

  -- Required constraints.
  for v_missing in
    select unnest(array[
      'client_ideation_scoring_runs_client_idempotency_key',
      'client_ideation_scoring_runs_id_cycle_client_key',
      'client_ideation_scoring_runs_cycle_client_fk',
      'client_ideation_scoring_runs_supersedes_client_fk',
      'client_ideation_scoring_runs_lease_check',
      'client_ideation_scoring_runs_attempts_check',
      'client_ideation_scoring_runs_completed_check',
      'client_ideation_candidate_scores_run_candidate_key',
      'client_ideation_candidate_scores_run_rank_key',
      'client_ideation_candidate_scores_dimensions_check',
      'client_ideation_candidate_scores_overall_check',
      'client_ideation_candidate_scores_band_check',
      'client_ideation_candidate_scores_band_matches_score_check',
      'client_ideation_candidate_scores_run_cycle_client_fk',
      'client_ideation_candidate_scores_candidate_cycle_client_fk',
      'client_ideation_candidates_id_cycle_client_key'
    ])
  loop
    if not exists (select 1 from pg_constraint where conname = v_missing) then
      raise exception 'MISSING_CONSTRAINT: %', v_missing;
    end if;
  end loop;

  -- Required indexes.
  for v_missing in
    select unnest(array[
      'client_ideation_scoring_runs_client_created_idx',
      'client_ideation_scoring_runs_cycle_created_idx',
      'client_ideation_candidate_scores_run_rank_idx'
    ])
  loop
    if not exists (select 1 from pg_class where relname = v_missing and relkind = 'i') then
      raise exception 'MISSING_INDEX: %', v_missing;
    end if;
  end loop;

  -- RPCs exist, are SECURITY DEFINER, and pin search_path.
  for v_missing in
    select unnest(array[
      'begin_ideation_scoring_run','renew_ideation_scoring_lease',
      'persist_ideation_score_batch','complete_ideation_scoring_run',
      'fail_ideation_scoring_run'
    ])
  loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_missing and p.prosecdef
        and array_to_string(coalesce(p.proconfig, array[]::text[]), ',') like '%search_path=public%'
    ) then raise exception 'MISSING_OR_UNSAFE_FUNCTION: %', v_missing; end if;

    -- Never executable by anon or authenticated.
    if has_function_privilege('anon', (
         select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_missing limit 1), 'EXECUTE')
    then raise exception 'ANON_CAN_EXECUTE: %', v_missing; end if;
    if has_function_privilege('authenticated', (
         select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_missing limit 1), 'EXECUTE')
    then raise exception 'AUTHENTICATED_CAN_EXECUTE: %', v_missing; end if;
    if not has_function_privilege('service_role', (
         select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_missing limit 1), 'EXECUTE')
    then raise exception 'SERVICE_ROLE_CANNOT_EXECUTE: %', v_missing; end if;
  end loop;

  -- Table privileges: authenticated may read only; service_role may write.
  for v_missing in
    select unnest(array['client_ideation_scoring_runs','client_ideation_candidate_scores'])
  loop
    if not has_table_privilege('authenticated', 'public.' || v_missing, 'SELECT') then
      raise exception 'AUTHENTICATED_CANNOT_SELECT: %', v_missing;
    end if;
    if has_table_privilege('authenticated', 'public.' || v_missing, 'INSERT')
      or has_table_privilege('authenticated', 'public.' || v_missing, 'UPDATE')
      or has_table_privilege('authenticated', 'public.' || v_missing, 'DELETE') then
      raise exception 'AUTHENTICATED_CAN_WRITE: %', v_missing;
    end if;
    if has_table_privilege('anon', 'public.' || v_missing, 'SELECT') then
      raise exception 'ANON_CAN_SELECT: %', v_missing;
    end if;
    if not has_table_privilege('service_role', 'public.' || v_missing, 'INSERT') then
      raise exception 'SERVICE_ROLE_CANNOT_WRITE: %', v_missing;
    end if;
  end loop;

  -- Exactly one SELECT policy per Stage 2 table, scoped by auth_client_ids().
  select count(*) into v_count from pg_policy
  where polrelid in ('public.client_ideation_scoring_runs'::regclass,
                     'public.client_ideation_candidate_scores'::regclass);
  if v_count <> 2 then raise exception 'UNEXPECTED_POLICY_COUNT: %', v_count; end if;
  if exists (
    select 1 from pg_policy
    where polrelid in ('public.client_ideation_scoring_runs'::regclass,
                       'public.client_ideation_candidate_scores'::regclass)
      and (polcmd <> 'r' or pg_get_expr(polqual, polrelid) not like '%auth_client_ids()%')
  ) then raise exception 'UNEXPECTED_POLICY_SHAPE'; end if;

  -- Stage 2 must not have created any downstream relation.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('ideation_calendar_proposals','ideation_committed_content','ideation_candidate_approvals')
  ) then raise exception 'STAGE_3_OR_4_TABLE_PRESENT'; end if;

  raise notice 'Stage 2 schema postflight passed.';
end
$$;
