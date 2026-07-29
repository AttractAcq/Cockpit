-- Ideation Stage 3 — post-migration verification. Every check fails closed.
\set ON_ERROR_STOP on

do $$
declare v_name text; v_count integer;
begin
  for v_name in select unnest(array[
    'client_ideation_calendar_proposals','client_ideation_calendar_proposal_slots'])
  loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = v_name and c.relkind = 'r') then
      raise exception 'MISSING_TABLE: %', v_name;
    end if;
    if not (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = v_name) then
      raise exception 'RLS_NOT_ENABLED: %', v_name;
    end if;
    if not has_table_privilege('authenticated', 'public.' || v_name, 'SELECT') then
      raise exception 'AUTHENTICATED_CANNOT_SELECT: %', v_name;
    end if;
    if has_table_privilege('authenticated', 'public.' || v_name, 'INSERT')
      or has_table_privilege('authenticated', 'public.' || v_name, 'UPDATE')
      or has_table_privilege('authenticated', 'public.' || v_name, 'DELETE') then
      raise exception 'AUTHENTICATED_CAN_WRITE: %', v_name;
    end if;
    if has_table_privilege('anon', 'public.' || v_name, 'SELECT') then
      raise exception 'ANON_CAN_SELECT: %', v_name;
    end if;
    if not has_table_privilege('service_role', 'public.' || v_name, 'INSERT') then
      raise exception 'SERVICE_ROLE_CANNOT_WRITE: %', v_name;
    end if;
  end loop;

  for v_name in select unnest(array[
    'client_ideation_calendar_proposals_client_idempotency_key',
    'client_ideation_calendar_proposals_id_cycle_client_key',
    'client_ideation_calendar_proposals_cycle_client_fk',
    'client_ideation_calendar_proposals_scoring_run_fk',
    'client_ideation_calendar_proposals_supersedes_fk',
    'client_ideation_calendar_proposals_lease_check',
    'client_ideation_calendar_proposals_draft_check',
    'client_ideation_calendar_proposals_approved_check',
    'client_ideation_calendar_proposals_attempts_check',
    'client_ideation_proposal_slots_proposal_key',
    'client_ideation_proposal_slots_proposal_candidate_key',
    'client_ideation_proposal_slots_period_check',
    'client_ideation_proposal_slots_asset_match_check',
    'client_ideation_proposal_slots_assignment_check',
    'client_ideation_proposal_slots_conflict_check',
    'client_ideation_proposal_slots_display_ref_check',
    'client_ideation_proposal_slots_proposal_cycle_client_fk',
    'client_ideation_proposal_slots_candidate_cycle_client_fk',
    'client_ideation_proposal_slots_score_run_fk',
    'client_ideation_candidate_scores_id_run_key'])
  loop
    if not exists (select 1 from pg_constraint where conname = v_name) then
      raise exception 'MISSING_CONSTRAINT: %', v_name;
    end if;
  end loop;

  for v_name in select unnest(array[
    'client_ideation_calendar_proposals_client_created_idx',
    'client_ideation_calendar_proposals_cycle_created_idx',
    'client_ideation_proposal_slots_proposal_date_idx'])
  loop
    if not exists (select 1 from pg_class where relname = v_name and relkind = 'i') then
      raise exception 'MISSING_INDEX: %', v_name;
    end if;
  end loop;

  for v_name in select unnest(array[
    'begin_ideation_calendar_proposal','renew_ideation_proposal_lease',
    'persist_ideation_proposal_batch','complete_ideation_calendar_proposal',
    'fail_ideation_calendar_proposal','edit_ideation_proposal_assignment',
    'refresh_ideation_proposal_conflicts','approve_ideation_calendar_proposal',
    'recount_ideation_proposal'])
  loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name and p.prosecdef
        and array_to_string(coalesce(p.proconfig, array[]::text[]), ',') like '%search_path=public%'
    ) then raise exception 'MISSING_OR_UNSAFE_FUNCTION: %', v_name; end if;
    if has_function_privilege('anon', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = v_name limit 1), 'EXECUTE') then
      raise exception 'ANON_CAN_EXECUTE: %', v_name;
    end if;
    if has_function_privilege('authenticated', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = v_name limit 1), 'EXECUTE') then
      raise exception 'AUTHENTICATED_CAN_EXECUTE: %', v_name;
    end if;
    if not has_function_privilege('service_role', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = v_name limit 1), 'EXECUTE') then
      raise exception 'SERVICE_ROLE_CANNOT_EXECUTE: %', v_name;
    end if;
  end loop;

  select count(*) into v_count from pg_policy
  where polrelid in ('public.client_ideation_calendar_proposals'::regclass,
                     'public.client_ideation_calendar_proposal_slots'::regclass);
  if v_count <> 2 then raise exception 'UNEXPECTED_POLICY_COUNT: %', v_count; end if;
  if exists (select 1 from pg_policy
    where polrelid in ('public.client_ideation_calendar_proposals'::regclass,
                       'public.client_ideation_calendar_proposal_slots'::regclass)
      and (polcmd <> 'r' or pg_get_expr(polqual, polrelid) not like '%auth_client_ids()%')) then
    raise exception 'UNEXPECTED_POLICY_SHAPE';
  end if;

  -- Stage 3 must create no Stage 4 object and no trigger onto operational tables.
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname in
               ('client_ideation_committed_content','ideation_calendar_commits')) then
    raise exception 'STAGE_4_TABLE_PRESENT';
  end if;
  if exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname in ('calendar_cells','organic_master','story_master','ads_master')
      and t.tgname like '%ideation%'
  ) then raise exception 'IDEATION_TRIGGER_ON_OPERATIONAL_TABLE'; end if;

  raise notice 'Stage 3 schema postflight passed.';
end
$$;
