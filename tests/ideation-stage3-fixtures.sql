-- Ideation Stage 3 — TEST-ONLY deterministic fixtures.
--
-- Synthetic rows for a disposable validation database only. They must never be
-- inserted into the linked production project. All identifiers use reserved
-- UUID ranges and ZZ-prefixed names so accidental presence is obvious.

\set ON_ERROR_STOP on

-- The synthetic Stage 1 unit baseline does not create the operational Calendar.
-- Against the authoritative production dump these objects already exist and
-- this block is a no-op; it never alters an existing table.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'calendar_row_type') then
    create type public.calendar_row_type as enum
      ('ad1','ad2','ad3','reel','stories','feed_posts','carousels');
  end if;
  if not exists (select 1 from pg_type where typname = 'review_state') then
    create type public.review_state as enum ('needs_review','approved','rejected','archived');
  end if;
end
$$;

create table if not exists public.calendar_cells (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null,
  date date not null,
  row_type public.calendar_row_type not null,
  ref text not null,
  review_state public.review_state not null default 'needs_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  v_client uuid := 'aa111111-1111-4111-8111-111111111111';
  v_other_client uuid := 'aa111111-1111-4111-8111-1111111111ff';
  v_actor uuid := 'aa222222-2222-4222-8222-222222222222';
  v_manager uuid := 'aa222222-2222-4222-8222-2222222222ff';
  v_cycle uuid := 'aa333333-3333-4333-8333-333333333333';
  v_scoring uuid := 'aa444444-4444-4444-8444-444444444444';
  v_run_a uuid := 'aa555555-5555-4555-8555-555555555551';
  v_run_b uuid := 'aa555555-5555-4555-8555-555555555552';
  v_research_a uuid := 'aa666666-6666-4666-8666-666666666661';
  v_research_b uuid := 'aa666666-6666-4666-8666-666666666662';
  v_index integer;
  v_candidate uuid;
  v_asset text;
  v_snapshot jsonb;
begin
  insert into public.clients (id, name, slug)
  values (v_client, 'ZZ Stage 3 Fixture Client', 'zz-stage3-fixture'),
         (v_other_client, 'ZZ Stage 3 Other Client', 'zz-stage3-other')
  on conflict (id) do nothing;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_actor, 'zz-stage3@example.invalid', '{}'::jsonb),
         (v_manager, 'zz-stage3-manager@example.invalid', '{}'::jsonb)
  on conflict (id) do nothing;
  insert into public.users (id, email, role)
  values (v_actor, 'zz-stage3@example.invalid', 'admin'),
         (v_manager, 'zz-stage3-manager@example.invalid', 'account_manager')
  on conflict (id) do update set role = excluded.role;
  insert into public.team_members (user_id, client_id) values (v_manager, v_client)
  on conflict do nothing;

  insert into public.client_context_files (client_id, file_number, file_name, content_md, status, version)
  values (v_client, 2, '02_Avatar_And_Buyer_Psychology.md', 'ZZ approved context body.', 'approved', 1),
         (v_client, 9, '09_Content_System.md', 'ZZ approved strategic body.', 'approved', 1)
  on conflict do nothing;
  insert into public.client_execution_files (client_id, month, file_number, file_name, content_md, review_state, version)
  values (v_client, '2026-07', 11, '11_Stage_2_SOP_and_Laws.md', 'ZZ approved execution body.', 'approved', 1)
  on conflict do nothing;

  -- Completed cycle: 4 reels + 4 stories across an inclusive week.
  insert into public.client_ideation_cycles (
    id, client_id, period_type, period_start, period_end, execution_months,
    status, idempotency_key, input_hash, quantity_plan, configuration_snapshot,
    slot_allocation, expected_candidate_count, candidate_count, shortfall_count,
    retryable, attempt_count, created_by, finished_at
  ) values (
    v_cycle, v_client, 'one_week', '2026-07-01', '2026-07-07', array['2026-07'],
    'completed', 'zz-stage3-cycle', repeat('a', 64),
    jsonb_build_object('total', 8),
    jsonb_build_object('retry_policy', jsonb_build_object('max_attempts', 3),
      'authority', jsonb_build_object('context', jsonb_build_array(),
        'strategic_playbooks', jsonb_build_array(), 'execution', jsonb_build_array())),
    jsonb_build_object(
      'review-mined-pain-language', jsonb_build_array('reel','reel','reel','reel'),
      'competitor-objections', jsonb_build_array('story','story','story','story')),
    8, 8, 0, false, 1, v_actor, now()
  );

  insert into public.client_ideation_technique_runs (
    id, client_id, ideation_cycle_id, technique_slug, technique_version, technique_order,
    status, idempotency_key, input_hash, initiated_by, attempt_count,
    requested_slots, generated_slots, failed_slots, retryable, finished_at
  ) values
    (v_run_a, v_client, v_cycle, 'review-mined-pain-language', 2, 2, 'complete',
     'zz-stage3-cycle:rmp', repeat('a', 64), v_actor, 1,
     jsonb_build_array('reel','reel','reel','reel'), 4, 0, false, now()),
    (v_run_b, v_client, v_cycle, 'competitor-objections', 2, 3, 'complete',
     'zz-stage3-cycle:cmo', repeat('a', 64), v_actor, 1,
     jsonb_build_array('story','story','story','story'), 4, 0, false, now());

  insert into public.client_ideation_research_results (
    id, client_id, ideation_cycle_id, technique_run_id, research_key,
    source_identifier, source_type, source_url, source_title, source_excerpt,
    source_provider, retrieved_at, content_hash, status
  ) values
    (v_research_a, v_client, v_cycle, v_run_a, 'technique-2', 'zz:t2', 'approved_authority_bundle',
     'aa-authority://client/zz/technique/2', 'ZZ Pain Authority', 'ZZ excerpt.',
     'approved_client_authority', now(), repeat('c', 64), 'processed'),
    (v_research_b, v_client, v_cycle, v_run_b, 'technique-3', 'zz:t3', 'approved_authority_bundle',
     'aa-authority://client/zz/technique/3', 'ZZ Objection Authority', 'ZZ excerpt.',
     'approved_client_authority', now(), repeat('d', 64), 'processed');

  for v_index in 0..7 loop
    v_candidate := ('aa777777-7777-4777-8777-7777777777' || lpad(v_index::text, 2, '0'))::uuid;
    v_asset := case when v_index < 4 then 'reel' else 'story' end;
    insert into public.client_ideation_candidates (
      id, client_id, ideation_cycle_id, technique_run_id, research_result_id,
      candidate_index, asset_type, status, working_title, hook, core_message,
      cta, evidence_references, draft_payload, model_provider, model_name,
      prompt_version, output_schema_version, input_hash, created_by
    ) values (
      v_candidate, v_client, v_cycle,
      case when v_index < 4 then v_run_a else v_run_b end,
      case when v_index < 4 then v_research_a else v_research_b end,
      case when v_index < 4 then v_index else v_index - 4 end,
      v_asset, 'needs_review',
      'ZZ title ' || v_index, 'ZZ hook ' || v_index, 'ZZ message ' || v_index, 'ZZ cta ' || v_index,
      jsonb_build_array(jsonb_build_object(
        'evidence_type', 'paraphrase', 'source_ids', jsonb_build_array('context:zz:v1'),
        'source_ref', '02_Avatar_And_Buyer_Psychology.md',
        'source_url', 'aa-authority://client/zz/context/1',
        'claim', 'ZZ title ' || v_index, 'support_span', 'ZZ approved context body.',
        'support_note', 'ZZ note.')),
      '{}'::jsonb, 'anthropic', 'zz-model', 'ideation-period.v1.2',
      'ideation-candidates.v1.1', repeat('a', 64), v_actor
    );
  end loop;

  -- Completed scoring run with unique gap-free ranks.
  select jsonb_agg(jsonb_build_object(
    'candidate_id', ranked.id, 'content_hash', repeat('1', 64), 'evidence_hash', repeat('2', 64),
    'asset_type', ranked.asset_type, 'rank', ranked.rank_value,
    'overall_score', 90, 'display_reference', 'IDEATION/aa333333/ZZZ-XX-01'
  ) order by ranked.id)
  into v_snapshot
  from (
    select id, asset_type, row_number() over (order by id) as rank_value
    from public.client_ideation_candidates where ideation_cycle_id = v_cycle
  ) ranked;

  insert into public.client_ideation_scoring_runs (
    id, client_id, ideation_cycle_id, status, idempotency_key, configuration_hash,
    configuration_snapshot, authority_snapshot, candidate_snapshot,
    rubric_slug, rubric_version, prompt_digest, provider, model,
    output_schema_version, module_version, expected_candidate_count,
    scored_candidate_count, failed_candidate_count, completed_at, created_by
  ) values (
    v_scoring, v_client, v_cycle, 'completed', 'zz-stage3-scoring', repeat('9', 64),
    '{}'::jsonb, '{}'::jsonb, v_snapshot,
    'aa.ideation.scoring', 'aa.ideation.scoring.v1', repeat('8', 64),
    'anthropic', 'zz-model', 'aa.ideation.scoring-output.v1', 'ideation-scoring.v1',
    8, 8, 0, now(), v_actor
  );

  for v_index in 0..7 loop
    v_candidate := ('aa777777-7777-4777-8777-7777777777' || lpad(v_index::text, 2, '0'))::uuid;
    insert into public.client_ideation_candidate_scores (
      client_id, ideation_cycle_id, scoring_run_id, candidate_id,
      candidate_content_hash, candidate_evidence_hash,
      execution_plan_alignment, business_and_positioning_alignment,
      audience_and_pain_relevance, proof_and_evidence_strength,
      hook_and_attention_strength, commercial_potential,
      specificity_and_clarity, originality_and_distinctiveness,
      platform_and_format_fit, production_feasibility,
      overall_score, priority_band, rank, rationale, strengths,
      provider, model, rubric_slug, rubric_version, prompt_version, output_schema_version
    ) values (
      v_client, v_cycle, v_scoring, v_candidate, repeat('1', 64), repeat('2', 64),
      9,9,9,9,9,9,9,9,9,9, 90, 'top',
      (select (value->>'rank')::integer from jsonb_array_elements(v_snapshot) value
       where value->>'candidate_id' = v_candidate::text),
      'ZZ rationale.',
      jsonb_build_array('ZZ strength'), 'anthropic', 'zz-model',
      'aa.ideation.scoring', 'aa.ideation.scoring.v1', 'ideation-scoring-prompt.v1',
      'aa.ideation.scoring-output.v1'
    );
  end loop;

  -- Operational Calendar occupancy: one approved (protected) and one
  -- needs_review (merely occupied) row inside the period. READ ONLY for Stage 3.
  insert into public.calendar_cells (client_id, month, date, row_type, ref, review_state)
  values (v_client, '2026-07', '2026-07-02', 'reel', 'ZZJUL26-RL-001', 'approved'),
         (v_client, '2026-07', '2026-07-03', 'stories', 'ZZJUL26-ST-001', 'needs_review')
  on conflict do nothing;

  raise notice 'Stage 3 test-only fixtures created.';
end
$$;
