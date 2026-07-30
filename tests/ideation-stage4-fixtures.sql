-- Ideation Stage 4 — TEST-ONLY deterministic fixtures.
--
-- Synthetic rows for a disposable validation database only. They must never be
-- inserted into the linked production project. All identifiers use reserved
-- UUID ranges and ZZ-prefixed names so accidental presence is obvious.
--
-- Builds a complete, committable lineage: approved authority, a completed
-- cycle, a completed scoring run, and an APPROVED proposal whose slots cover
-- all four asset types (reel, carousel, static, story).

\set ON_ERROR_STOP on

do $$
declare
  v_client uuid := 'bb111111-1111-4111-8111-111111111111';
  v_other_client uuid := 'bb111111-1111-4111-8111-1111111111ff';
  v_admin uuid := 'bb222222-2222-4222-8222-222222222222';
  v_manager uuid := 'bb222222-2222-4222-8222-2222222222ff';
  v_editor uuid := 'bb222222-2222-4222-8222-2222222222ee';
  v_cycle uuid := 'bb333333-3333-4333-8333-333333333333';
  v_scoring uuid := 'bb444444-4444-4444-8444-444444444444';
  v_run uuid := 'bb555555-5555-4555-8555-555555555551';
  v_research uuid := 'bb666666-6666-4666-8666-666666666661';
  v_proposal uuid := 'bb888888-8888-4888-8888-888888888881';
  v_index integer;
  v_candidate uuid;
  v_score uuid;
  v_asset text;
  v_row_type text;
  v_date date;
  v_snapshot jsonb;
  v_manifest jsonb;
  v_authority jsonb;
begin
  insert into public.clients (id, name, slug)
  values (v_client, 'ZZ Stage 4 Fixture Client', 'zz-stage4-fixture'),
         (v_other_client, 'ZZ Stage 4 Other Client', 'zz-stage4-other')
  on conflict (id) do nothing;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'zz-stage4-admin@example.invalid', '{}'::jsonb),
         (v_manager, 'zz-stage4-manager@example.invalid', '{}'::jsonb),
         (v_editor, 'zz-stage4-editor@example.invalid', '{}'::jsonb)
  on conflict (id) do nothing;
  insert into public.users (id, email, role)
  values (v_admin, 'zz-stage4-admin@example.invalid', 'admin'),
         (v_manager, 'zz-stage4-manager@example.invalid', 'account_manager'),
         (v_editor, 'zz-stage4-editor@example.invalid', 'editor')
  on conflict (id) do update set role = excluded.role;
  insert into public.team_members (user_id, client_id) values (v_manager, v_client)
  on conflict do nothing;

  insert into public.client_context_files (client_id, file_number, file_name, content_md, status, version)
  values (v_client, 2, '02_Avatar_And_Buyer_Psychology.md', 'ZZ approved context body.', 'approved', 1),
         (v_client, 9, '09_Content_System.md', 'ZZ approved strategic body.', 'approved', 1)
  on conflict do nothing;
  insert into public.client_execution_files (client_id, month, file_number, file_name, content_md, review_state, version)
  values (v_client, '2026-08', 11, '11_Stage_2_SOP_and_Laws.md', 'ZZ approved execution body.', 'approved', 1)
  on conflict do nothing;

  -- Completed cycle: one candidate per asset type across an inclusive week.
  insert into public.client_ideation_cycles (
    id, client_id, period_type, period_start, period_end, execution_months,
    status, idempotency_key, input_hash, quantity_plan, configuration_snapshot,
    slot_allocation, expected_candidate_count, candidate_count, shortfall_count,
    retryable, attempt_count, created_by, finished_at
  ) values (
    v_cycle, v_client, 'one_week', '2026-08-01', '2026-08-07', array['2026-08'],
    'completed', 'zz-stage4-cycle', repeat('a', 64),
    jsonb_build_object('total', 4),
    jsonb_build_object('retry_policy', jsonb_build_object('max_attempts', 3)),
    jsonb_build_object('review-mined-pain-language',
      jsonb_build_array('reel','carousel','static','story')),
    4, 4, 0, false, 1, v_admin, now()
  );

  insert into public.client_ideation_technique_runs (
    id, client_id, ideation_cycle_id, technique_slug, technique_version, technique_order,
    status, idempotency_key, input_hash, initiated_by, attempt_count,
    requested_slots, generated_slots, failed_slots, retryable, finished_at
  ) values (
    v_run, v_client, v_cycle, 'review-mined-pain-language', 2, 2, 'complete',
    'zz-stage4-cycle:rmp', repeat('a', 64), v_admin, 1,
    jsonb_build_array('reel','carousel','static','story'), 4, 0, false, now()
  );

  insert into public.client_ideation_research_results (
    id, client_id, ideation_cycle_id, technique_run_id, research_key,
    source_identifier, source_type, source_url, source_title, source_excerpt,
    source_provider, retrieved_at, content_hash, status
  ) values (
    v_research, v_client, v_cycle, v_run, 'technique-2', 'zz:t2', 'approved_authority_bundle',
    'aa-authority://client/zz/technique/2', 'ZZ Pain Authority', 'ZZ excerpt.',
    'approved_client_authority', now(), repeat('c', 64), 'processed'
  );

  for v_index in 0..3 loop
    v_candidate := ('bb777777-7777-4777-8777-7777777777' || lpad(v_index::text, 2, '0'))::uuid;
    v_asset := (array['reel','carousel','static','story'])[v_index + 1];
    insert into public.client_ideation_candidates (
      id, client_id, ideation_cycle_id, technique_run_id, research_result_id,
      candidate_index, asset_type, status, working_title, hook, core_message,
      psychological_angle, cta, evidence_references, draft_payload,
      model_provider, model_name, prompt_version, output_schema_version, input_hash, created_by
    ) values (
      v_candidate, v_client, v_cycle, v_run, v_research, v_index,
      v_asset, 'needs_review',
      'ZZ title ' || v_index, 'ZZ hook ' || v_index, 'ZZ message ' || v_index,
      'ZZ angle ' || v_index, 'ZZ cta ' || v_index,
      jsonb_build_array(jsonb_build_object(
        'evidence_type', 'paraphrase', 'source_ids', jsonb_build_array('context:zz:v1'),
        'source_ref', '02_Avatar_And_Buyer_Psychology.md',
        'source_url', 'aa-authority://client/zz/context/1',
        'claim', 'ZZ title ' || v_index, 'support_span', 'ZZ approved context body.',
        'support_note', 'ZZ note.')),
      '{}'::jsonb, 'anthropic', 'zz-model', 'ideation-period.v1.2',
      'ideation-candidates.v1.1', repeat('a', 64), v_admin
    );
  end loop;

  select jsonb_agg(jsonb_build_object(
    'candidate_id', ranked.id, 'content_hash', repeat('a', 64), 'evidence_hash', repeat('2', 64),
    'asset_type', ranked.asset_type, 'rank', ranked.rank_value, 'overall_score', 90
  ) order by ranked.id)
  into v_snapshot
  from (
    select id, asset_type, row_number() over (order by candidate_index) as rank_value
    from public.client_ideation_candidates where ideation_cycle_id = v_cycle
  ) ranked;

  insert into public.client_ideation_scoring_runs (
    id, client_id, ideation_cycle_id, status, idempotency_key, configuration_hash,
    configuration_snapshot, authority_snapshot, candidate_snapshot,
    rubric_slug, rubric_version, prompt_digest, provider, model,
    output_schema_version, module_version, expected_candidate_count,
    scored_candidate_count, failed_candidate_count, completed_at, created_by
  ) values (
    v_scoring, v_client, v_cycle, 'completed', 'zz-stage4-scoring', repeat('9', 64),
    '{}'::jsonb, '{}'::jsonb, v_snapshot,
    'aa.ideation.scoring', 'aa.ideation.scoring.v1', repeat('8', 64),
    'anthropic', 'zz-model', 'aa.ideation.scoring-output.v1', 'ideation-scoring.v1',
    4, 4, 0, now(), v_admin
  );

  for v_index in 0..3 loop
    v_candidate := ('bb777777-7777-4777-8777-7777777777' || lpad(v_index::text, 2, '0'))::uuid;
    v_score := ('bb999999-9999-4999-8999-9999999999' || lpad(v_index::text, 2, '0'))::uuid;
    insert into public.client_ideation_candidate_scores (
      id, client_id, ideation_cycle_id, scoring_run_id, candidate_id,
      candidate_content_hash, candidate_evidence_hash,
      execution_plan_alignment, business_and_positioning_alignment,
      audience_and_pain_relevance, proof_and_evidence_strength,
      hook_and_attention_strength, commercial_potential,
      specificity_and_clarity, originality_and_distinctiveness,
      platform_and_format_fit, production_feasibility,
      overall_score, priority_band, rank, rationale, strengths,
      provider, model, rubric_slug, rubric_version, prompt_version, output_schema_version
    ) values (
      v_score, v_client, v_cycle, v_scoring, v_candidate, repeat('a', 64), repeat('2', 64),
      9,9,9,9,9,9,9,9,9,9, 90, 'top', v_index + 1,
      'ZZ rationale.', jsonb_build_array('ZZ strength'), 'anthropic', 'zz-model',
      'aa.ideation.scoring', 'aa.ideation.scoring.v1', 'ideation-scoring-prompt.v1',
      'aa.ideation.scoring-output.v1'
    );
  end loop;

  -- The authority snapshot in the exact Stage 2/3 shape, built from the rows
  -- actually inserted above, so re-verification at commit time is meaningful
  -- rather than trivially empty. content_hash matches the real content.
  select jsonb_build_object(
    'context', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'file_number', f.file_number, 'file_name', f.file_name,
        'version', f.version,
        'content_hash', encode(sha256(convert_to(f.content_md, 'UTF8')), 'hex'))
        order by f.file_number)
      from public.client_context_files f
      where f.client_id = v_client and f.status = 'approved' and f.file_number = 2), '[]'::jsonb),
    'strategic_playbooks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'file_number', f.file_number, 'file_name', f.file_name,
        'version', f.version,
        'content_hash', encode(sha256(convert_to(f.content_md, 'UTF8')), 'hex'))
        order by f.file_number)
      from public.client_context_files f
      where f.client_id = v_client and f.status = 'approved' and f.file_number = 9), '[]'::jsonb),
    'execution', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'file_number', f.file_number, 'file_name', f.file_name,
        'version', f.version, 'month', f.month,
        'content_hash', encode(sha256(convert_to(f.content_md, 'UTF8')), 'hex'))
        order by f.file_number)
      from public.client_execution_files f
      where f.client_id = v_client and f.review_state = 'approved'), '[]'::jsonb)
  ) into v_authority;

  -- Slot manifest: one slot per asset type on four consecutive dates.
  select jsonb_agg(jsonb_build_object(
    'proposal_slot_key', to_char(('2026-08-0' || (index + 1))::date, 'YYYY-MM-DD')
      || ':' || (array['reel','carousel','static','story'])[index + 1] || ':1',
    'proposed_date', to_char(('2026-08-0' || (index + 1))::date, 'YYYY-MM-DD'),
    'required_asset_type', (array['reel','carousel','static','story'])[index + 1]
  ) order by index)
  into v_manifest
  from generate_series(0, 3) as index;

  insert into public.client_ideation_calendar_proposals (
    id, client_id, ideation_cycle_id, scoring_run_id, status, proposal_version,
    idempotency_key, configuration_hash, configuration_snapshot, authority_snapshot,
    candidate_snapshot, scoring_snapshot, slot_manifest_snapshot,
    calendar_conflict_snapshot, calendar_conflict_digest, slot_planner_version,
    prompt_digest, provider, model, output_schema_version, module_version,
    period_start, period_end, expected_slot_count, assigned_slot_count,
    unassigned_candidate_count, conflict_count, unresolved_conflict_count,
    attempt_count, edit_revision, generated_at, approved_at, approved_by, created_by
  ) values (
    v_proposal, v_client, v_cycle, v_scoring, 'approved', 1,
    'zz-stage4-proposal', repeat('7', 64), '{}'::jsonb,
    v_authority,
    v_snapshot, '{}'::jsonb, v_manifest,
    '{}'::jsonb, repeat('4', 64), 'aa.ideation.slot-planner.v1',
    repeat('6', 64), 'anthropic', 'zz-model', 'aa.ideation.proposal-output.v1',
    'ideation-proposal.v1', '2026-08-01', '2026-08-07', 4, 4, 0, 0, 0,
    1, 3, now(), now(), v_admin, v_admin
  );

  for v_index in 0..3 loop
    v_candidate := ('bb777777-7777-4777-8777-7777777777' || lpad(v_index::text, 2, '0'))::uuid;
    v_score := ('bb999999-9999-4999-8999-9999999999' || lpad(v_index::text, 2, '0'))::uuid;
    v_asset := (array['reel','carousel','static','story'])[v_index + 1];
    v_row_type := (array['reel','carousels','feed_posts','stories'])[v_index + 1];
    v_date := ('2026-08-0' || (v_index + 1))::date;
    insert into public.client_ideation_calendar_proposal_slots (
      id, client_id, proposal_id, ideation_cycle_id, scoring_run_id,
      proposal_slot_key, proposed_date, period_start, period_end, date_slot_ordinal,
      required_asset_type, calendar_row_type, placement_basis,
      candidate_id, candidate_score_id, candidate_asset_type_snapshot,
      candidate_content_hash, candidate_rank_snapshot, candidate_score_snapshot,
      candidate_display_reference, placement_rationale, placement_source, conflict_status
    ) values (
      ('bbaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa' || lpad(v_index::text, 2, '0'))::uuid,
      v_client, v_proposal, v_cycle, v_scoring,
      to_char(v_date, 'YYYY-MM-DD') || ':' || v_asset || ':1',
      v_date, '2026-08-01', '2026-08-07', 1,
      v_asset, v_row_type, 'execution_cadence',
      v_candidate, v_score, v_asset, repeat('a', 64), v_index + 1, 90,
      'IDEATION/bb333333/RMP-XX-0' || (v_index + 1), 'ZZ placement rationale.', 'model', 'clear'
    );
  end loop;

  raise notice 'Stage 4 test-only fixtures created.';
end
$$;
