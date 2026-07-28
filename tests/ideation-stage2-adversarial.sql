-- Ideation Stage 2 — adversarial persistence tests.
-- Every case here must fail closed. Requires the fixtures and integration
-- scripts to have run first.

\set ON_ERROR_STOP on

create or replace function pg_temp.zz_expect_failure(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'ADVERSARIAL CASE ALLOWED: %', p_label;
end
$$;

create or replace function pg_temp.zz_snapshot(p_cycle uuid)
returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object(
    'candidate_id', c.id, 'technique_slug', r.technique_slug,
    'candidate_index', c.candidate_index, 'asset_type', c.asset_type,
    'content_hash', repeat('1', 64), 'evidence_hash', repeat('2', 64)
  ) order by c.id)
  from public.client_ideation_candidates c
  join public.client_ideation_technique_runs r on r.id = c.technique_run_id
  where c.ideation_cycle_id = p_cycle;
$$;

create or replace function pg_temp.zz_score(p_candidate uuid, p_value integer, p_overall integer, p_band text)
returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object(
    'candidate_id', p_candidate,
    'candidate_content_hash', repeat('1', 64),
    'candidate_evidence_hash', repeat('2', 64),
    'execution_plan_alignment', p_value, 'business_and_positioning_alignment', p_value,
    'audience_and_pain_relevance', p_value, 'proof_and_evidence_strength', p_value,
    'hook_and_attention_strength', p_value, 'commercial_potential', p_value,
    'specificity_and_clarity', p_value, 'originality_and_distinctiveness', p_value,
    'platform_and_format_fit', p_value, 'production_feasibility', p_value,
    'overall_score', p_overall, 'priority_band', p_band,
    'rationale', 'ZZ adversarial rationale.',
    'strengths', jsonb_build_array('ZZ strength'),
    'risks', jsonb_build_array(),
    'authority_references', jsonb_build_array(),
    'evidence_references', jsonb_build_array(),
    'prompt_version', 'ideation-scoring-prompt.v1'
  ));
$$;

do $$
declare
  v_client uuid := '11111111-1111-4111-8111-111111111111';
  v_other_client uuid := '11111111-1111-4111-8111-1111111111ff';
  v_cycle uuid := '33333333-3333-4333-8333-333333333333';
  v_other_cycle uuid := '33333333-3333-4333-8333-3333333333ff';
  v_actor uuid := '22222222-2222-4222-8222-222222222222';
  v_snapshot jsonb := pg_temp.zz_snapshot(v_cycle);
  v_begin jsonb;
  v_run uuid;
  v_candidate uuid := '66666666-6666-4666-8666-666666666600';
  v_foreign uuid := '66666666-6666-4666-8666-6666666666ff';
begin
  -- A cycle that is not completed can never start scoring.
  update public.client_ideation_cycles set status = 'retryable' where id = v_cycle;
  perform pg_temp.zz_expect_failure(format(
    'select public.begin_ideation_scoring_run(%L,%L,%L,%L,''{}''::jsonb,''{}''::jsonb,%L::jsonb,''r'',''v'',%L,''anthropic'',''m'',''v'',''v'',7,3,null,''zz-adv'',180,%L)',
    v_client, v_cycle, 'zz-adv-not-completed', repeat('3', 64), v_snapshot, repeat('8', 64), v_actor
  ), 'scoring a non-completed cycle');
  update public.client_ideation_cycles set status = 'completed' where id = v_cycle;

  -- A cycle belonging to another client can never be scored under this client.
  perform pg_temp.zz_expect_failure(format(
    'select public.begin_ideation_scoring_run(%L,%L,%L,%L,''{}''::jsonb,''{}''::jsonb,%L::jsonb,''r'',''v'',%L,''anthropic'',''m'',''v'',''v'',7,3,null,''zz-adv'',180,%L)',
    v_client, v_other_cycle, 'zz-adv-cross-client', repeat('3', 64), v_snapshot, repeat('8', 64), v_actor
  ), 'cross-client cycle scoring');

  -- A candidate snapshot whose length disagrees with the expected count fails.
  perform pg_temp.zz_expect_failure(format(
    'select public.begin_ideation_scoring_run(%L,%L,%L,%L,''{}''::jsonb,''{}''::jsonb,%L::jsonb,''r'',''v'',%L,''anthropic'',''m'',''v'',''v'',6,3,null,''zz-adv'',180,%L)',
    v_client, v_cycle, 'zz-adv-count', repeat('3', 64), v_snapshot, repeat('8', 64), v_actor
  ), 'candidate snapshot length mismatch');

  -- Lease and attempt configuration outside the documented bounds fails.
  perform pg_temp.zz_expect_failure(format(
    'select public.begin_ideation_scoring_run(%L,%L,%L,%L,''{}''::jsonb,''{}''::jsonb,%L::jsonb,''r'',''v'',%L,''anthropic'',''m'',''v'',''v'',7,3,null,''zz-adv'',30,%L)',
    v_client, v_cycle, 'zz-adv-lease', repeat('3', 64), v_snapshot, repeat('8', 64), v_actor
  ), 'lease under the minimum');
  perform pg_temp.zz_expect_failure(format(
    'select public.begin_ideation_scoring_run(%L,%L,%L,%L,''{}''::jsonb,''{}''::jsonb,%L::jsonb,''r'',''v'',%L,''anthropic'',''m'',''v'',''v'',7,99,null,''zz-adv'',180,%L)',
    v_client, v_cycle, 'zz-adv-attempts', repeat('3', 64), v_snapshot, repeat('8', 64), v_actor
  ), 'attempt cap above the maximum');

  -- A re-score naming a non-existent predecessor fails.
  perform pg_temp.zz_expect_failure(format(
    'select public.begin_ideation_scoring_run(%L,%L,%L,%L,''{}''::jsonb,''{}''::jsonb,%L::jsonb,''r'',''v'',%L,''anthropic'',''m'',''v'',''v'',7,3,%L,''zz-adv'',180,%L)',
    v_client, v_cycle, 'zz-adv-rescore', repeat('3', 64), v_snapshot, repeat('8', 64),
    '99999999-9999-4999-8999-999999999999', v_actor
  ), 'rescore of an unknown predecessor');

  -- Start a genuine run for the persistence cases below.
  v_begin := public.begin_ideation_scoring_run(
    v_client, v_cycle, 'zz-adv-run', repeat('4', 64),
    '{}'::jsonb, '{}'::jsonb, v_snapshot,
    'aa.ideation.scoring', 'aa.ideation.scoring.v1', repeat('8', 64),
    'anthropic', 'zz-test-model', 'aa.ideation.scoring-output.v1', 'ideation-scoring.v1',
    7, 3, null, 'zz-adv-owner', 180, v_actor
  );
  v_run := (v_begin->'run'->>'id')::uuid;

  -- Reusing the identity with a different configuration is a conflict.
  perform pg_temp.zz_expect_failure(format(
    'select public.begin_ideation_scoring_run(%L,%L,%L,%L,''{}''::jsonb,''{}''::jsonb,%L::jsonb,''r'',''v'',%L,''anthropic'',''m'',''v'',''v'',7,3,null,''zz-adv2'',180,%L)',
    v_client, v_cycle, 'zz-adv-run', repeat('5', 64), v_snapshot, repeat('8', 64), v_actor
  ), 'idempotency conflict on a changed configuration');

  -- A non-owner can neither persist, complete, nor fail the run.
  perform pg_temp.zz_expect_failure(format(
    'select public.persist_ideation_score_batch(%L, ''zz-wrong-owner'', %L::jsonb)',
    v_run, pg_temp.zz_score(v_candidate, 5, 50, 'low')
  ), 'non-owner persistence');
  perform pg_temp.zz_expect_failure(format(
    'select public.complete_ideation_scoring_run(%L, ''zz-wrong-owner'', ''[]''::jsonb, ''[]''::jsonb, %L)',
    v_run, v_actor
  ), 'non-owner completion');
  perform pg_temp.zz_expect_failure(format(
    'select public.fail_ideation_scoring_run(%L, ''zz-wrong-owner'', ''X'', ''x'', false, ''[]''::jsonb, %L)',
    v_run, v_actor
  ), 'non-owner failure');
  perform pg_temp.zz_expect_failure(format(
    'select public.renew_ideation_scoring_lease(%L, ''zz-wrong-owner'', 180)', v_run
  ), 'non-owner lease renewal');

  -- A candidate from another cycle or client can never be scored on this run.
  perform pg_temp.zz_expect_failure(format(
    'select public.persist_ideation_score_batch(%L, ''zz-adv-owner'', %L::jsonb)',
    v_run, pg_temp.zz_score(v_foreign, 5, 50, 'low')
  ), 'cross-client candidate score');

  -- A candidate hash that disagrees with the immutable snapshot fails.
  perform pg_temp.zz_expect_failure(format(
    'select public.persist_ideation_score_batch(%L, ''zz-adv-owner'', %L::jsonb)',
    v_run,
    jsonb_build_array(jsonb_build_object(
      'candidate_id', v_candidate,
      'candidate_content_hash', repeat('f', 64),
      'candidate_evidence_hash', repeat('2', 64),
      'execution_plan_alignment', 5, 'business_and_positioning_alignment', 5,
      'audience_and_pain_relevance', 5, 'proof_and_evidence_strength', 5,
      'hook_and_attention_strength', 5, 'commercial_potential', 5,
      'specificity_and_clarity', 5, 'originality_and_distinctiveness', 5,
      'platform_and_format_fit', 5, 'production_feasibility', 5,
      'overall_score', 50, 'priority_band', 'low', 'rationale', 'ZZ.',
      'strengths', jsonb_build_array('ZZ'), 'risks', jsonb_build_array(),
      'authority_references', jsonb_build_array(), 'evidence_references', jsonb_build_array(),
      'prompt_version', 'ideation-scoring-prompt.v1'
    ))
  ), 'candidate hash mismatch');

  -- Out-of-range dimensions and a band that disagrees with the score fail.
  perform pg_temp.zz_expect_failure(format(
    'select public.persist_ideation_score_batch(%L, ''zz-adv-owner'', %L::jsonb)',
    v_run, pg_temp.zz_score(v_candidate, 11, 100, 'top')
  ), 'dimension above 10');
  perform pg_temp.zz_expect_failure(format(
    'select public.persist_ideation_score_batch(%L, ''zz-adv-owner'', %L::jsonb)',
    v_run, pg_temp.zz_score(v_candidate, -1, 0, 'low')
  ), 'dimension below 0');
  perform pg_temp.zz_expect_failure(format(
    'select public.persist_ideation_score_batch(%L, ''zz-adv-owner'', %L::jsonb)',
    v_run, pg_temp.zz_score(v_candidate, 5, 50, 'top')
  ), 'priority band inconsistent with the overall score');
  perform pg_temp.zz_expect_failure(format(
    'select public.persist_ideation_score_batch(%L, ''zz-adv-owner'', %L::jsonb)',
    v_run, pg_temp.zz_score(v_candidate, 5, 500, 'top')
  ), 'overall score above 100');

  -- Completion is impossible while any expected candidate is unscored.
  perform public.persist_ideation_score_batch(v_run, 'zz-adv-owner', pg_temp.zz_score(v_candidate, 5, 50, 'low'));
  perform pg_temp.zz_expect_failure(format(
    'select public.complete_ideation_scoring_run(%L, ''zz-adv-owner'', %L::jsonb, ''[]''::jsonb, %L)',
    v_run,
    jsonb_build_array(jsonb_build_object('candidate_id', v_candidate, 'rank', 1)),
    v_actor
  ), 'completing a partially scored run');

  raise notice 'Stage 2 adversarial persistence passed.';
end
$$;

-- ---------------------------------------------------------------------------
-- Duplicate candidate scores and duplicate ranks are rejected by constraints.
-- ---------------------------------------------------------------------------
do $$
declare
  v_run uuid;
  v_candidate uuid := '66666666-6666-4666-8666-666666666600';
  v_second uuid := '66666666-6666-4666-8666-666666666601';
begin
  select id into v_run from public.client_ideation_scoring_runs
  where idempotency_key = 'zz-adv-run';

  -- A repeat insert for the same candidate is absorbed, never duplicated.
  perform public.persist_ideation_score_batch(v_run, 'zz-adv-owner',
    pg_temp.zz_score(v_candidate, 5, 50, 'low'));
  if (select count(*) from public.client_ideation_candidate_scores
      where scoring_run_id = v_run and candidate_id = v_candidate) <> 1 then
    raise exception 'DUPLICATE_CANDIDATE_SCORE_PERSISTED';
  end if;

  -- Two candidates cannot share a rank inside one scoring run.
  perform public.persist_ideation_score_batch(v_run, 'zz-adv-owner',
    pg_temp.zz_score(v_second, 6, 60, 'medium'));
  update public.client_ideation_candidate_scores set rank = 1
  where scoring_run_id = v_run and candidate_id = v_candidate;
  perform pg_temp.zz_expect_failure(format(
    'update public.client_ideation_candidate_scores set rank = 1 where scoring_run_id = %L and candidate_id = %L',
    v_run, v_second
  ), 'duplicate rank inside one scoring run');
  update public.client_ideation_candidate_scores set rank = null where scoring_run_id = v_run;

  raise notice 'Stage 2 duplicate protection passed.';
end
$$;

-- ---------------------------------------------------------------------------
-- The attempt cap is terminal: attempt 3 can never become attempt 4.
-- ---------------------------------------------------------------------------
do $$
declare
  v_run uuid;
  v_client uuid := '11111111-1111-4111-8111-111111111111';
  v_cycle uuid := '33333333-3333-4333-8333-333333333333';
  v_actor uuid := '22222222-2222-4222-8222-222222222222';
  v_snapshot jsonb := pg_temp.zz_snapshot(v_cycle);
  v_result jsonb;
begin
  select id into v_run from public.client_ideation_scoring_runs where idempotency_key = 'zz-adv-run';
  update public.client_ideation_scoring_runs
  set attempt_count = 3, status = 'retryable', retryable = true,
      lease_owner = null, lease_expires_at = null
  where id = v_run;

  v_result := public.begin_ideation_scoring_run(
    v_client, v_cycle, 'zz-adv-run', repeat('4', 64),
    '{}'::jsonb, '{}'::jsonb, v_snapshot,
    'aa.ideation.scoring', 'aa.ideation.scoring.v1', repeat('8', 64),
    'anthropic', 'zz-test-model', 'aa.ideation.scoring-output.v1', 'ideation-scoring.v1',
    7, 3, null, 'zz-adv-owner-2', 180, v_actor
  );
  if (v_result->>'attempts_exhausted')::boolean is not true then
    raise exception 'ATTEMPT_CAP_NOT_ENFORCED';
  end if;
  if (v_result->'run'->>'status') <> 'failed' then raise exception 'EXHAUSTED_RUN_NOT_TERMINAL'; end if;
  if (v_result->'run'->>'attempt_count')::integer <> 3 then raise exception 'ATTEMPT_COUNT_INCREMENTED'; end if;

  raise notice 'Stage 2 attempt cap passed.';
end
$$;
