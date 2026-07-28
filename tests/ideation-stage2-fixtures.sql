-- Ideation Stage 2 — TEST-ONLY deterministic fixtures.
--
-- These rows are synthetic and exist only inside a disposable validation
-- database. They must never be inserted into the linked production project.
-- Every identifier is prefixed ZZ / uses a reserved UUID range so an accidental
-- appearance in a real database is obvious.

\set ON_ERROR_STOP on

do $$
declare
  v_client uuid := '11111111-1111-4111-8111-111111111111';
  v_other_client uuid := '11111111-1111-4111-8111-1111111111ff';
  v_actor uuid := '22222222-2222-4222-8222-222222222222';
  v_manager uuid := '22222222-2222-4222-8222-2222222222ff';
  v_cycle uuid := '33333333-3333-4333-8333-333333333333';
  v_other_cycle uuid := '33333333-3333-4333-8333-3333333333ff';
  v_run_a uuid := '44444444-4444-4444-8444-444444444441';
  v_run_b uuid := '44444444-4444-4444-8444-444444444442';
  v_research_a uuid := '55555555-5555-4555-8555-555555555551';
  v_research_b uuid := '55555555-5555-4555-8555-555555555552';
  v_other_run uuid := '44444444-4444-4444-8444-4444444444ff';
  v_other_research uuid := '55555555-5555-4555-8555-5555555555ff';
  v_index integer;
  v_candidate uuid;
  v_asset text;
begin
  insert into public.clients (id, name, slug)
  values
    (v_client, 'ZZ Stage 2 Fixture Client', 'zz-stage2-fixture'),
    (v_other_client, 'ZZ Stage 2 Other Client', 'zz-stage2-other')
  on conflict (id) do nothing;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_actor, 'zz-stage2-fixture@example.invalid', '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.users (id, email, role)
  values (v_actor, 'zz-stage2-fixture@example.invalid', 'admin')
  on conflict (id) do update set role = excluded.role;

  -- An account manager scoped to one client only, so cross-client RLS scoping
  -- is observable. An admin legitimately sees every client.
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_manager, 'zz-stage2-manager@example.invalid', '{}'::jsonb)
  on conflict (id) do nothing;
  insert into public.users (id, email, role)
  values (v_manager, 'zz-stage2-manager@example.invalid', 'account_manager')
  on conflict (id) do update set role = excluded.role;
  insert into public.team_members (user_id, client_id)
  values (v_manager, v_client)
  on conflict do nothing;

  -- Approved authority the cycle snapshot references.
  insert into public.client_context_files (client_id, file_number, file_name, content_md, status, version)
  values
    (v_client, 2, '02_Avatar_And_Buyer_Psychology.md', 'ZZ approved context authority body.', 'approved', 1),
    (v_client, 9, '09_Content_System.md', 'ZZ approved strategic system body.', 'approved', 1)
  on conflict do nothing;

  insert into public.client_execution_files (client_id, month, file_number, file_name, content_md, review_state, version)
  values (v_client, '2026-07', 11, '11_Stage_2_SOP_and_Laws.md', 'ZZ approved execution authority body.', 'approved', 1)
  on conflict do nothing;

  -- One completed cycle: two techniques, seven candidates, two asset types.
  insert into public.client_ideation_cycles (
    id, client_id, period_type, period_start, period_end, execution_months,
    status, idempotency_key, input_hash, quantity_plan, configuration_snapshot,
    slot_allocation, expected_candidate_count, candidate_count, shortfall_count,
    retryable, attempt_count, created_by, finished_at
  ) values (
    v_cycle, v_client, 'one_week', '2026-07-01', '2026-07-07', array['2026-07'],
    'completed', 'zz-stage2-fixture-cycle', repeat('a', 64),
    jsonb_build_object('total', 7),
    jsonb_build_object(
      'retry_policy', jsonb_build_object('max_attempts', 3),
      'authority', jsonb_build_object(
        'context', jsonb_build_array(),
        'strategic_playbooks', jsonb_build_array(),
        'execution', jsonb_build_array()
      )
    ),
    jsonb_build_object(
      'review-mined-pain-language', jsonb_build_array('reel','reel','reel','reel'),
      'competitor-objections', jsonb_build_array('story','story','story')
    ),
    7, 7, 0, false, 1, v_actor, now()
  );

  -- A second cycle owned by another client, used for cross-ownership tests.
  insert into public.client_ideation_cycles (
    id, client_id, period_type, period_start, period_end, execution_months,
    status, idempotency_key, input_hash, quantity_plan, configuration_snapshot,
    slot_allocation, expected_candidate_count, candidate_count, shortfall_count,
    retryable, attempt_count, created_by, finished_at
  ) values (
    v_other_cycle, v_other_client, 'one_day', '2026-07-01', '2026-07-01', array['2026-07'],
    'completed', 'zz-stage2-fixture-other-cycle', repeat('b', 64),
    jsonb_build_object('total', 1),
    jsonb_build_object('retry_policy', jsonb_build_object('max_attempts', 3)),
    jsonb_build_object('review-mined-pain-language', jsonb_build_array('reel')),
    1, 1, 0, false, 1, v_actor, now()
  );

  insert into public.client_ideation_technique_runs (
    id, client_id, ideation_cycle_id, technique_slug, technique_version, technique_order,
    status, idempotency_key, input_hash, initiated_by, attempt_count,
    requested_slots, generated_slots, failed_slots, retryable, finished_at
  ) values
    (v_run_a, v_client, v_cycle, 'review-mined-pain-language', 2, 2, 'complete',
     'zz-stage2-fixture-cycle:review-mined-pain-language', repeat('a', 64), v_actor, 1,
     jsonb_build_array('reel','reel','reel','reel'), 4, 0, false, now()),
    (v_run_b, v_client, v_cycle, 'competitor-objections', 2, 3, 'complete',
     'zz-stage2-fixture-cycle:competitor-objections', repeat('a', 64), v_actor, 1,
     jsonb_build_array('story','story','story'), 3, 0, false, now()),
    (v_other_run, v_other_client, v_other_cycle, 'review-mined-pain-language', 2, 2, 'complete',
     'zz-stage2-fixture-other-cycle:review-mined-pain-language', repeat('b', 64), v_actor, 1,
     jsonb_build_array('reel'), 1, 0, false, now());

  insert into public.client_ideation_research_results (
    id, client_id, ideation_cycle_id, technique_run_id, research_key,
    source_identifier, source_type, source_url, source_title, source_excerpt,
    source_provider, retrieved_at, content_hash, status
  ) values
    (v_research_a, v_client, v_cycle, v_run_a, 'technique-2',
     'zz:client:technique:2', 'approved_authority_bundle',
     'aa-authority://client/zz/technique/2', 'ZZ Approved Pain-Language Authority',
     'ZZ bounded research excerpt.', 'approved_client_authority', now(), repeat('c', 64), 'processed'),
    (v_research_b, v_client, v_cycle, v_run_b, 'technique-3',
     'zz:client:technique:3', 'approved_authority_bundle',
     'aa-authority://client/zz/technique/3', 'ZZ Approved Competitor-Objection Authority',
     'ZZ bounded research excerpt.', 'approved_client_authority', now(), repeat('d', 64), 'processed'),
    (v_other_research, v_other_client, v_other_cycle, v_other_run, 'technique-2',
     'zz:other:technique:2', 'approved_authority_bundle',
     'aa-authority://client/zz-other/technique/2', 'ZZ Other Authority',
     'ZZ bounded research excerpt.', 'approved_client_authority', now(), repeat('e', 64), 'processed');

  -- Seven candidates: four reels on technique 2, three stories on technique 3.
  for v_index in 0..6 loop
    v_candidate := ('66666666-6666-4666-8666-6666666666' || lpad(v_index::text, 2, '0'))::uuid;
    v_asset := case when v_index < 4 then 'reel' else 'story' end;
    insert into public.client_ideation_candidates (
      id, client_id, ideation_cycle_id, technique_run_id, research_result_id,
      candidate_index, asset_type, status, working_title, hook, core_message,
      psychological_angle, cta, evidence_references, draft_payload,
      model_provider, model_name, prompt_version, output_schema_version, input_hash, created_by
    ) values (
      v_candidate, v_client, v_cycle,
      case when v_index < 4 then v_run_a else v_run_b end,
      case when v_index < 4 then v_research_a else v_research_b end,
      case when v_index < 4 then v_index else v_index - 4 end,
      v_asset, 'needs_review',
      'ZZ working title ' || v_index,
      'ZZ hook ' || v_index,
      'ZZ core message ' || v_index,
      'ZZ psychological angle ' || v_index,
      'ZZ cta ' || v_index,
      jsonb_build_array(jsonb_build_object(
        'evidence_type', 'paraphrase',
        'source_ids', jsonb_build_array('context:zz:v1'),
        'source_ref', '02_Avatar_And_Buyer_Psychology.md',
        'source_url', 'aa-authority://client/zz/context/1',
        'claim', 'ZZ working title ' || v_index,
        'support_span', 'ZZ approved context authority body.',
        'support_note', 'ZZ support note.'
      )),
      jsonb_build_object('technique_number', case when v_index < 4 then 2 else 3 end),
      'anthropic', 'zz-test-model', 'ideation-period.v1.2', 'ideation-candidates.v1.1',
      repeat('a', 64), v_actor
    );
  end loop;

  -- One candidate under the other client, for cross-ownership tests.
  insert into public.client_ideation_candidates (
    id, client_id, ideation_cycle_id, technique_run_id, research_result_id,
    candidate_index, asset_type, status, working_title, hook, core_message,
    cta, evidence_references, draft_payload,
    model_provider, model_name, prompt_version, output_schema_version, input_hash, created_by
  ) values (
    '66666666-6666-4666-8666-6666666666ff', v_other_client, v_other_cycle, v_other_run, v_other_research,
    0, 'reel', 'needs_review', 'ZZ other title', 'ZZ other hook', 'ZZ other message',
    'ZZ other cta',
    jsonb_build_array(jsonb_build_object(
      'evidence_type', 'paraphrase',
      'source_ids', jsonb_build_array('context:zz-other:v1'),
      'source_ref', '02_Avatar_And_Buyer_Psychology.md',
      'source_url', 'aa-authority://client/zz-other/context/1',
      'claim', 'ZZ other title',
      'support_span', 'ZZ approved context authority body.',
      'support_note', 'ZZ support note.'
    )),
    '{}'::jsonb, 'anthropic', 'zz-test-model', 'ideation-period.v1.2',
    'ideation-candidates.v1.1', repeat('b', 64), v_actor
  );

  raise notice 'Stage 2 test-only fixtures created.';
end
$$;
