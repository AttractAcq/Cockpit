-- Ideation Stage 2 — integration and RLS behaviour against the applied schema.
-- Requires tests/ideation-stage2-fixtures.sql to have run first.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Happy path: begin -> persist batches -> complete with deterministic ranks.
-- ---------------------------------------------------------------------------
do $$
declare
  v_client uuid := '11111111-1111-4111-8111-111111111111';
  v_cycle uuid := '33333333-3333-4333-8333-333333333333';
  v_actor uuid := '22222222-2222-4222-8222-222222222222';
  v_snapshot jsonb;
  v_begin jsonb;
  v_run uuid;
  v_scores jsonb;
  v_ranks jsonb;
  v_row record;
begin
  select jsonb_agg(jsonb_build_object(
    'candidate_id', c.id,
    'technique_slug', r.technique_slug,
    'candidate_index', c.candidate_index,
    'asset_type', c.asset_type,
    'content_hash', repeat('1', 64),
    'evidence_hash', repeat('2', 64)
  ) order by c.id)
  into v_snapshot
  from public.client_ideation_candidates c
  join public.client_ideation_technique_runs r on r.id = c.technique_run_id
  where c.ideation_cycle_id = v_cycle;

  v_begin := public.begin_ideation_scoring_run(
    v_client, v_cycle, 'zz-scoring-1', repeat('9', 64),
    jsonb_build_object('stage', 'ideation.stage-2.score-and-sort'),
    jsonb_build_object('context', jsonb_build_array()),
    v_snapshot,
    'aa.ideation.scoring', 'aa.ideation.scoring.v1', repeat('8', 64),
    'anthropic', 'zz-test-model', 'aa.ideation.scoring-output.v1', 'ideation-scoring.v1',
    7, 3, null, 'zz-owner-1', 180, v_actor
  );
  if (v_begin->>'created')::boolean is not true then raise exception 'BEGIN_DID_NOT_CREATE'; end if;
  v_run := (v_begin->'run'->>'id')::uuid;

  -- Persist in two batches, proving partial persistence is durable.
  select jsonb_agg(jsonb_build_object(
    'candidate_id', value->>'candidate_id',
    'candidate_content_hash', repeat('1', 64),
    'candidate_evidence_hash', repeat('2', 64),
    'execution_plan_alignment', 8, 'business_and_positioning_alignment', 7,
    'audience_and_pain_relevance', 7, 'proof_and_evidence_strength', 6,
    'hook_and_attention_strength', 6, 'commercial_potential', 6,
    'specificity_and_clarity', 5, 'originality_and_distinctiveness', 5,
    'platform_and_format_fit', 5, 'production_feasibility', 5,
    'overall_score', 66, 'priority_band', 'medium',
    'rationale', 'ZZ rationale.',
    'strengths', jsonb_build_array('ZZ strength'),
    'risks', jsonb_build_array(),
    'authority_references', jsonb_build_array(),
    'evidence_references', jsonb_build_array(),
    'prompt_version', 'ideation-scoring-prompt.v1'
  ))
  into v_scores
  from (select value from jsonb_array_elements(v_snapshot) limit 4) batch;
  perform public.persist_ideation_score_batch(v_run, 'zz-owner-1', v_scores);

  select jsonb_agg(jsonb_build_object(
    'candidate_id', value->>'candidate_id',
    'candidate_content_hash', repeat('1', 64),
    'candidate_evidence_hash', repeat('2', 64),
    'execution_plan_alignment', 9, 'business_and_positioning_alignment', 9,
    'audience_and_pain_relevance', 9, 'proof_and_evidence_strength', 9,
    'hook_and_attention_strength', 9, 'commercial_potential', 9,
    'specificity_and_clarity', 9, 'originality_and_distinctiveness', 9,
    'platform_and_format_fit', 9, 'production_feasibility', 9,
    'overall_score', 90, 'priority_band', 'top',
    'rationale', 'ZZ rationale.',
    'strengths', jsonb_build_array('ZZ strength'),
    'risks', jsonb_build_array('ZZ risk'),
    'authority_references', jsonb_build_array(),
    'evidence_references', jsonb_build_array(),
    'prompt_version', 'ideation-scoring-prompt.v1'
  ))
  into v_scores
  from (select value from jsonb_array_elements(v_snapshot) offset 4) batch;
  perform public.persist_ideation_score_batch(v_run, 'zz-owner-1', v_scores);

  if (select count(*) from public.client_ideation_candidate_scores where scoring_run_id = v_run) <> 7 then
    raise exception 'BATCHES_DID_NOT_PERSIST';
  end if;

  -- Completion assigns gap-free unique ranks.
  select jsonb_agg(jsonb_build_object('candidate_id', candidate_id, 'rank', rn))
  into v_ranks
  from (
    select candidate_id,
      row_number() over (order by overall_score desc, execution_plan_alignment desc,
        proof_and_evidence_strength desc, audience_and_pain_relevance desc, candidate_id) as rn
    from public.client_ideation_candidate_scores
    where scoring_run_id = v_run
  ) ranked;
  perform public.complete_ideation_scoring_run(v_run, 'zz-owner-1', v_ranks, '[]'::jsonb, v_actor);

  select * into v_row from public.client_ideation_scoring_runs where id = v_run;
  if v_row.status <> 'completed' then raise exception 'RUN_NOT_COMPLETED'; end if;
  if v_row.scored_candidate_count <> 7 then raise exception 'SCORED_COUNT_WRONG'; end if;
  if v_row.lease_owner is not null then raise exception 'LEASE_NOT_CLEARED'; end if;
  if v_row.completed_at is null then raise exception 'COMPLETED_AT_MISSING'; end if;

  if (select count(distinct rank) from public.client_ideation_candidate_scores where scoring_run_id = v_run) <> 7
    or (select min(rank) from public.client_ideation_candidate_scores where scoring_run_id = v_run) <> 1
    or (select max(rank) from public.client_ideation_candidate_scores where scoring_run_id = v_run) <> 7 then
    raise exception 'RANKS_NOT_GAP_FREE_OR_UNIQUE';
  end if;

  -- The top band is assigned to the highest scores only.
  if (select count(*) from public.client_ideation_candidate_scores
      where scoring_run_id = v_run and priority_band = 'top') <> 3 then
    raise exception 'PRIORITY_BAND_WRONG';
  end if;

  raise notice 'Stage 2 happy path passed.';
end
$$;

-- ---------------------------------------------------------------------------
-- Idempotent replay: the same identity and configuration returns the same run.
-- ---------------------------------------------------------------------------
do $$
declare
  v_client uuid := '11111111-1111-4111-8111-111111111111';
  v_cycle uuid := '33333333-3333-4333-8333-333333333333';
  v_actor uuid := '22222222-2222-4222-8222-222222222222';
  v_snapshot jsonb;
  v_replay jsonb;
  v_before integer;
begin
  select count(*) into v_before from public.client_ideation_scoring_runs;
  select jsonb_agg(jsonb_build_object(
    'candidate_id', c.id, 'technique_slug', r.technique_slug,
    'candidate_index', c.candidate_index, 'asset_type', c.asset_type,
    'content_hash', repeat('1', 64), 'evidence_hash', repeat('2', 64)
  ) order by c.id)
  into v_snapshot
  from public.client_ideation_candidates c
  join public.client_ideation_technique_runs r on r.id = c.technique_run_id
  where c.ideation_cycle_id = v_cycle;

  v_replay := public.begin_ideation_scoring_run(
    v_client, v_cycle, 'zz-scoring-1', repeat('9', 64),
    jsonb_build_object('stage', 'ideation.stage-2.score-and-sort'),
    jsonb_build_object('context', jsonb_build_array()), v_snapshot,
    'aa.ideation.scoring', 'aa.ideation.scoring.v1', repeat('8', 64),
    'anthropic', 'zz-test-model', 'aa.ideation.scoring-output.v1', 'ideation-scoring.v1',
    7, 3, null, 'zz-owner-2', 180, v_actor
  );
  if (v_replay->>'created')::boolean is not false then raise exception 'REPLAY_CREATED_DUPLICATE'; end if;
  if (v_replay->'run'->>'status') <> 'completed' then raise exception 'REPLAY_STATUS_WRONG'; end if;
  if (select count(*) from public.client_ideation_scoring_runs) <> v_before then
    raise exception 'REPLAY_ADDED_A_RUN';
  end if;
  raise notice 'Stage 2 idempotent replay passed.';
end
$$;

-- ---------------------------------------------------------------------------
-- Explicit re-scoring preserves history and records the superseded run.
-- ---------------------------------------------------------------------------
do $$
declare
  v_client uuid := '11111111-1111-4111-8111-111111111111';
  v_cycle uuid := '33333333-3333-4333-8333-333333333333';
  v_actor uuid := '22222222-2222-4222-8222-222222222222';
  v_previous uuid;
  v_snapshot jsonb;
  v_begin jsonb;
begin
  select id into v_previous from public.client_ideation_scoring_runs
  where ideation_cycle_id = v_cycle and status = 'completed' order by created_at limit 1;

  select jsonb_agg(jsonb_build_object(
    'candidate_id', c.id, 'technique_slug', r.technique_slug,
    'candidate_index', c.candidate_index, 'asset_type', c.asset_type,
    'content_hash', repeat('1', 64), 'evidence_hash', repeat('2', 64)
  ) order by c.id)
  into v_snapshot
  from public.client_ideation_candidates c
  join public.client_ideation_technique_runs r on r.id = c.technique_run_id
  where c.ideation_cycle_id = v_cycle;

  v_begin := public.begin_ideation_scoring_run(
    v_client, v_cycle, 'zz-scoring-2', repeat('7', 64),
    jsonb_build_object('stage', 'ideation.stage-2.score-and-sort'),
    jsonb_build_object('context', jsonb_build_array()), v_snapshot,
    'aa.ideation.scoring', 'aa.ideation.scoring.v1', repeat('8', 64),
    'anthropic', 'zz-test-model', 'aa.ideation.scoring-output.v1', 'ideation-scoring.v1',
    7, 3, v_previous, 'zz-owner-3', 180, v_actor
  );
  if (v_begin->>'created')::boolean is not true then raise exception 'RESCORE_NOT_CREATED'; end if;
  if (v_begin->'run'->>'supersedes_scoring_run_id')::uuid <> v_previous then
    raise exception 'RESCORE_PREDECESSOR_NOT_RECORDED';
  end if;

  -- The previous completed run and all of its scores are untouched.
  if (select status from public.client_ideation_scoring_runs where id = v_previous) <> 'completed' then
    raise exception 'HISTORY_LOST';
  end if;
  if (select count(*) from public.client_ideation_candidate_scores where scoring_run_id = v_previous) <> 7 then
    raise exception 'HISTORICAL_SCORES_LOST';
  end if;
  raise notice 'Stage 2 re-scoring history passed.';
end
$$;

-- ---------------------------------------------------------------------------
-- RLS: staff read their own client only; all direct writes are denied.
-- ---------------------------------------------------------------------------
do $$
declare
  v_manager uuid := '22222222-2222-4222-8222-2222222222ff';
  v_actor uuid := '22222222-2222-4222-8222-222222222222';
  v_run uuid;
  v_visible integer;
begin
  select id into v_run from public.client_ideation_scoring_runs
  where client_id = '11111111-1111-4111-8111-111111111111' and status = 'completed' limit 1;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_manager::text, true);

  select count(*) into v_visible from public.client_ideation_scoring_runs;
  if v_visible < 1 then raise exception 'STAFF_SELECT_DENIED_UNEXPECTEDLY'; end if;
  if (select count(*) from public.client_ideation_candidate_scores) < 1 then
    raise exception 'STAFF_SCORE_SELECT_DENIED_UNEXPECTEDLY';
  end if;

  -- Cross-client rows are invisible to a scoped account manager.
  if exists (
    select 1 from public.client_ideation_scoring_runs
    where client_id = '11111111-1111-4111-8111-1111111111ff'
  ) then
    raise exception 'CROSS_CLIENT_SELECT_LEAKED';
  end if;

  begin
    insert into public.client_ideation_scoring_runs (
      client_id, ideation_cycle_id, idempotency_key, configuration_hash,
      candidate_snapshot, rubric_slug, rubric_version, prompt_digest,
      provider, model, output_schema_version, module_version,
      expected_candidate_count, lease_owner, lease_expires_at, last_heartbeat_at
    ) values (
      '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
      'zz-direct-insert', repeat('0', 64), '[]'::jsonb, 'x', 'x', repeat('0', 64),
      'anthropic', 'm', 'v', 'v', 1, 'zz-owner', now(), now()
    );
    raise exception 'AUTHENTICATED_INSERT_ALLOWED';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.client_ideation_scoring_runs set status = 'failed' where id = v_run;
    raise exception 'AUTHENTICATED_UPDATE_ALLOWED';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.client_ideation_scoring_runs where id = v_run;
    raise exception 'AUTHENTICATED_DELETE_ALLOWED';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.client_ideation_candidate_scores (
      client_id, ideation_cycle_id, scoring_run_id, candidate_id,
      candidate_content_hash, candidate_evidence_hash,
      execution_plan_alignment, business_and_positioning_alignment,
      audience_and_pain_relevance, proof_and_evidence_strength,
      hook_and_attention_strength, commercial_potential,
      specificity_and_clarity, originality_and_distinctiveness,
      platform_and_format_fit, production_feasibility,
      overall_score, priority_band, rationale, strengths,
      provider, model, rubric_slug, rubric_version, prompt_version, output_schema_version
    ) values (
      '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
      v_run, '66666666-6666-4666-8666-666666666600', repeat('1', 64), repeat('2', 64),
      5,5,5,5,5,5,5,5,5,5, 50, 'low', 'ZZ', '["ZZ"]'::jsonb,
      'anthropic', 'm', 'r', 'v', 'p', 'o'
    );
    raise exception 'AUTHENTICATED_SCORE_INSERT_ALLOWED';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.client_ideation_candidate_scores set overall_score = 100 where scoring_run_id = v_run;
    raise exception 'AUTHENTICATED_SCORE_UPDATE_ALLOWED';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.client_ideation_candidate_scores where scoring_run_id = v_run;
    raise exception 'AUTHENTICATED_SCORE_DELETE_ALLOWED';
  exception when insufficient_privilege then null;
  end;

  -- RPC execution is denied to authenticated callers.
  begin
    perform public.begin_ideation_scoring_run(
      '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
      'zz-direct-rpc', repeat('0', 64), '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
      'x', 'x', repeat('0', 64), 'anthropic', 'm', 'v', 'v', 1, 3, null, 'zz-owner', 180, v_actor
    );
    raise exception 'AUTHENTICATED_RPC_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.persist_ideation_score_batch(v_run, 'zz-owner', '[]'::jsonb);
    raise exception 'AUTHENTICATED_PERSIST_RPC_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.complete_ideation_scoring_run(v_run, 'zz-owner', '[]'::jsonb, '[]'::jsonb, v_actor);
    raise exception 'AUTHENTICATED_COMPLETE_RPC_ALLOWED';
  exception when insufficient_privilege then null;
  end;

  reset role;
  raise notice 'Stage 2 RLS passed.';
end
$$;

-- Anonymous access is denied outright.
do $$
begin
  set local role anon;
  begin
    perform 1 from public.client_ideation_scoring_runs limit 1;
    raise exception 'ANON_SELECT_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.client_ideation_candidate_scores limit 1;
    raise exception 'ANON_SCORE_SELECT_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'Stage 2 anonymous denial passed.';
end
$$;
