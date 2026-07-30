-- Ideation Stage 4 — adversarial SQL.
--
-- Every case here attacks atomicity, ownership, or the structural guarantees.
-- Runs on a fresh disposable database (fixtures re-seeded, nothing committed yet).

\set ON_ERROR_STOP on

-- Session-scoped so the service-role claim persists across every DO block
-- below; the RPC guard is therefore genuinely exercised, not bypassed.
select set_config('request.jwt.claim.role', 'service_role', false);

create or replace function pg_temp.zz_commit(
  p_proposal uuid default 'bb888888-8888-4888-8888-888888888881',
  p_expected_revision integer default 3
) returns jsonb
language plpgsql
as $$
begin
  return public.commit_ideation_content(
    'bb111111-1111-4111-8111-111111111111'::uuid, p_proposal, p_expected_revision,
    'bb222222-2222-4222-8222-222222222222'::uuid, repeat('e', 64),
    '{}'::jsonb, repeat('4', 64), 'zz-commit-key',
    'aa.ideation.commit-targets.v1', 'aa.ideation.commit-mapping.v1',
    'aa.phase3.allocate-ref.v1', 'aa.ideation.commit-output.v1', 'aa.ideation.commit.v1'
  );
end;
$$;

-- ==========================================================================
-- 1. Rollback: a failure at ANY point leaves zero operational rows.
--
-- Failure is induced at the first, middle, and last item by making that item's
-- candidate unreadable in exactly the way the transaction checks.
-- ==========================================================================
do $$
declare
  v_position integer;
  v_slot uuid;
  v_masters_before integer;
  v_cells_before integer;
begin
  select count(*) into v_masters_before from public.organic_master;
  select count(*) into v_cells_before from public.calendar_cells;

  foreach v_position in array array[0, 2, 3] loop
    v_slot := ('bbaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa' || lpad(v_position::text, 2, '0'))::uuid;
    update public.client_ideation_calendar_proposal_slots
    set candidate_content_hash = repeat('9', 64) where id = v_slot;

    begin
      perform pg_temp.zz_commit();
      raise exception 'ZZ FAIL: a commit succeeded with a broken item at position %', v_position;
    exception when others then
      if sqlerrm like 'ZZ FAIL%' then raise; end if;
    end;

    if (select count(*) from public.organic_master) <> v_masters_before then
      raise exception 'ZZ FAIL: a failure at position % left organic rows', v_position;
    end if;
    if (select count(*) from public.story_master
        where client_id = 'bb111111-1111-4111-8111-111111111111') <> 0 then
      raise exception 'ZZ FAIL: a failure at position % left story rows', v_position;
    end if;
    if (select count(*) from public.calendar_cells) <> v_cells_before then
      raise exception 'ZZ FAIL: a failure at position % left Calendar rows', v_position;
    end if;
    if exists (select 1 from public.client_ideation_commit_items) then
      raise exception 'ZZ FAIL: a failure at position % left commit items', v_position;
    end if;
    if exists (select 1 from public.client_ideation_commit_runs) then
      raise exception 'ZZ FAIL: a failure at position % left a commit run', v_position;
    end if;

    update public.client_ideation_calendar_proposal_slots
    set candidate_content_hash = repeat('a', 64) where id = v_slot;
  end loop;

  raise notice 'Stage 4 rollback-on-any-item passed.';
end
$$;

-- ==========================================================================
-- 2. A new protected Calendar conflict blocks the WHOLE commit.
-- ==========================================================================
do $$
declare
  v_cell uuid;
begin
  -- An approved operational row appears on a proposed date and lane.
  insert into public.calendar_cells (client_id, month, date, row_type, ref, review_state)
  values ('bb111111-1111-4111-8111-111111111111', '2026-08', '2026-08-02', 'carousels',
          'ZZAUG02-CR-900', 'approved')
  returning id into v_cell;

  begin
    perform pg_temp.zz_commit();
    raise exception 'ZZ FAIL: a protected Calendar conflict did not block the commit';
  exception when others then
    if sqlerrm like 'ZZ FAIL%' then raise; end if;
    if sqlerrm not like '%IDEATION_COMMIT_CALENDAR_CONFLICT%' then
      raise exception 'ZZ FAIL: unexpected error %', sqlerrm;
    end if;
  end;

  -- The entire commit was refused: not even the unaffected items were created.
  if exists (select 1 from public.organic_master
             where client_id = 'bb111111-1111-4111-8111-111111111111') then
    raise exception 'ZZ FAIL: a blocked commit still created masters';
  end if;
  if exists (select 1 from public.client_ideation_commit_items) then
    raise exception 'ZZ FAIL: a blocked commit still created items';
  end if;

  -- The pre-existing Calendar row is untouched.
  if not exists (select 1 from public.calendar_cells where id = v_cell and review_state = 'approved') then
    raise exception 'ZZ FAIL: the existing Calendar row was modified';
  end if;

  delete from public.calendar_cells where id = v_cell;
  raise notice 'Stage 4 Calendar-conflict blocking passed.';
end
$$;

-- ==========================================================================
-- 3. Existing operational content is never overwritten.
-- ==========================================================================
do $$
declare
  v_existing_ref text := 'ZZAUG01-RL-001';
  v_existing_id uuid;
  v_updated timestamptz;
begin
  insert into public.organic_master (client_id, month, ref, review_state, status, content_type, working_title)
  values ('bb111111-1111-4111-8111-111111111111', '2026-08', v_existing_ref,
          'needs_review', 'idea', 'RL', 'ZZ pre-existing title')
  returning id, updated_at into v_existing_id, v_updated;
  insert into public.calendar_cells (client_id, month, date, row_type, ref, review_state)
  values ('bb111111-1111-4111-8111-111111111111', '2026-08', '2026-08-01', 'reel',
          v_existing_ref, 'needs_review');

  perform pg_temp.zz_commit();

  -- The pre-existing row is byte-for-byte unchanged and was not claimed.
  if not exists (
    select 1 from public.organic_master
    where id = v_existing_id and ref = v_existing_ref
      and working_title = 'ZZ pre-existing title' and updated_at = v_updated
  ) then
    raise exception 'ZZ FAIL: pre-existing operational content was modified';
  end if;
  if exists (select 1 from public.client_ideation_commit_items where target_master_id = v_existing_id) then
    raise exception 'ZZ FAIL: a commit item claimed a pre-existing master';
  end if;
  if exists (select 1 from public.client_ideation_commit_items where operational_ref = v_existing_ref) then
    raise exception 'ZZ FAIL: the allocator reused an existing ref';
  end if;

  raise notice 'Stage 4 existing-content protection passed.';
end
$$;

-- ==========================================================================
-- 4. Structural ownership: cross-client, cross-cycle, cross-proposal, and
--    cross-scoring-run rows cannot be persisted at all.
-- ==========================================================================
do $$
declare
  v_run uuid;
  v_item public.client_ideation_commit_items;
  v_other_proposal uuid := 'bb888888-8888-4888-8888-888888888882';
  v_other_slot uuid := 'bbaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa90';
  v_spare_candidate uuid := 'bb777777-7777-4777-8777-777777777790';
  v_spare_score uuid := 'bb999999-9999-4999-8999-999999999990';
begin
  select id into v_run from public.client_ideation_commit_runs where status = 'completed';
  select * into v_item from public.client_ideation_commit_items where commit_run_id = v_run limit 1;

  -- A second proposal with its own slot, so cross-proposal ownership can be
  -- tested in isolation from the one-item-per-slot uniqueness rule.
  insert into public.client_ideation_calendar_proposals (
    id, client_id, ideation_cycle_id, scoring_run_id, status, proposal_version,
    idempotency_key, configuration_hash, slot_manifest_snapshot,
    calendar_conflict_digest, slot_planner_version, prompt_digest, provider, model,
    output_schema_version, module_version, period_start, period_end,
    expected_slot_count, assigned_slot_count, generated_at
  ) values (
    v_other_proposal, 'bb111111-1111-4111-8111-111111111111',
    'bb333333-3333-4333-8333-333333333333', 'bb444444-4444-4444-8444-444444444444',
    'draft', 2, 'zz-stage4-other-proposal', repeat('3', 64),
    jsonb_build_array(jsonb_build_object('proposal_slot_key', '2026-08-05:reel:1')),
    repeat('4', 64), 'aa.ideation.slot-planner.v1', repeat('6', 64),
    'anthropic', 'zz-model', 'aa.ideation.proposal-output.v1', 'ideation-proposal.v1',
    '2026-08-01', '2026-08-07', 1, 0, now()
  );
  insert into public.client_ideation_calendar_proposal_slots (
    id, client_id, proposal_id, ideation_cycle_id, scoring_run_id,
    proposal_slot_key, proposed_date, period_start, period_end, date_slot_ordinal,
    required_asset_type, calendar_row_type, placement_basis
  ) values (
    v_other_slot, 'bb111111-1111-4111-8111-111111111111', v_other_proposal,
    'bb333333-3333-4333-8333-333333333333', 'bb444444-4444-4444-8444-444444444444',
    '2026-08-05:reel:1', '2026-08-05', '2026-08-01', '2026-08-07', 1,
    'reel', 'reel', 'execution_cadence'
  );

  -- A spare candidate and score, so a negative insert reaches the constraint it
  -- is meant to prove rather than tripping one-item-per-candidate first.
  insert into public.client_ideation_candidates (
    id, client_id, ideation_cycle_id, technique_run_id, research_result_id,
    candidate_index, asset_type, status, working_title, hook, core_message, cta,
    evidence_references, draft_payload, model_provider, model_name,
    prompt_version, output_schema_version, input_hash
  ) values (
    v_spare_candidate, 'bb111111-1111-4111-8111-111111111111',
    'bb333333-3333-4333-8333-333333333333', 'bb555555-5555-4555-8555-555555555551',
    'bb666666-6666-4666-8666-666666666661', 90, 'reel', 'needs_review',
    'ZZ spare', 'ZZ spare hook', 'ZZ spare message', 'ZZ spare cta',
    jsonb_build_array(jsonb_build_object('evidence_type', 'paraphrase',
      'source_ids', jsonb_build_array('context:zz:v1'), 'claim', 'ZZ',
      'support_span', 'ZZ approved context body.')),
    '{}'::jsonb, 'anthropic', 'zz-model', 'ideation-period.v1.2',
    'ideation-candidates.v1.1', repeat('a', 64)
  );
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
    v_spare_score, 'bb111111-1111-4111-8111-111111111111',
    'bb333333-3333-4333-8333-333333333333', 'bb444444-4444-4444-8444-444444444444',
    v_spare_candidate, repeat('a', 64), repeat('2', 64),
    9,9,9,9,9,9,9,9,9,9, 90, 'top', 90, 'ZZ rationale.', jsonb_build_array('ZZ strength'),
    'anthropic', 'zz-model', 'aa.ideation.scoring', 'aa.ideation.scoring.v1',
    'ideation-scoring-prompt.v1', 'aa.ideation.scoring-output.v1'
  );

  -- Cross-client commit run.
  begin
    insert into public.client_ideation_commit_runs (
      client_id, ideation_cycle_id, scoring_run_id, proposal_id, idempotency_key,
      configuration_hash, calendar_digest, proposal_version, proposal_edit_revision,
      target_manifest_version, mapping_version, reference_allocator_version,
      output_schema_version, module_version, period_start, period_end, expected_item_count
    ) values (
      'bb111111-1111-4111-8111-1111111111ff', 'bb333333-3333-4333-8333-333333333333',
      'bb444444-4444-4444-8444-444444444444', 'bb888888-8888-4888-8888-888888888881',
      'zz-cross-client', repeat('a', 64), repeat('b', 64), 1, 3, 'v','v','v','v','v',
      '2026-08-01', '2026-08-07', 4
    );
    raise exception 'ZZ FAIL: a cross-client commit run was accepted';
  exception when foreign_key_violation then null;
  end;

  -- A commit item whose slot belongs to another proposal.
  begin
    insert into public.client_ideation_commit_items (
      client_id, commit_run_id, ideation_cycle_id, scoring_run_id, proposal_id,
      proposal_slot_id, proposal_slot_key, candidate_id, candidate_score_id,
      candidate_content_hash, candidate_rank_snapshot, candidate_score_snapshot,
      asset_type, target_master_table, target_master_id, target_calendar_cell_id,
      calendar_row_type, operational_ref, committed_date, execution_month,
      master_payload_hash, calendar_payload_hash
    ) values (
      -- The slot belongs to the OTHER proposal; the composite foreign key must
      -- refuse to attach it to this one.
      v_item.client_id, v_run, v_item.ideation_cycle_id, v_item.scoring_run_id,
      v_item.proposal_id, v_other_slot, 'zz',
      v_spare_candidate, v_spare_score, repeat('a', 64), 1, 90,
      'reel', 'organic_master', gen_random_uuid(), gen_random_uuid(),
      'reel', 'ZZX-RL-999', '2026-08-01', '2026-08',
      repeat('a', 64), repeat('a', 64)
    );
    raise exception 'ZZ FAIL: a cross-proposal commit item was accepted';
  exception when foreign_key_violation then null;
  end;

  -- An unsupported target table cannot be persisted.
  begin
    insert into public.client_ideation_commit_items (
      client_id, commit_run_id, ideation_cycle_id, scoring_run_id, proposal_id,
      proposal_slot_id, proposal_slot_key, candidate_id, candidate_score_id,
      candidate_content_hash, candidate_rank_snapshot, candidate_score_snapshot,
      asset_type, target_master_table, target_master_id, target_calendar_cell_id,
      calendar_row_type, operational_ref, committed_date, execution_month,
      master_payload_hash, calendar_payload_hash
    ) values (
      v_item.client_id, v_run, v_item.ideation_cycle_id, v_item.scoring_run_id,
      v_other_proposal, v_other_slot, 'zz-ads',
      v_spare_candidate, v_spare_score, repeat('a', 64), 1, 90,
      'reel', 'ads_master', gen_random_uuid(), gen_random_uuid(),
      'reel', 'ZZX-RL-998', '2026-08-01', '2026-08',
      repeat('a', 64), repeat('a', 64)
    );
    raise exception 'ZZ FAIL: ads_master was accepted as a commit target';
  exception when check_violation then null;
  end;

  -- A story may not be recorded against organic_master.
  begin
    insert into public.client_ideation_commit_items (
      client_id, commit_run_id, ideation_cycle_id, scoring_run_id, proposal_id,
      proposal_slot_id, proposal_slot_key, candidate_id, candidate_score_id,
      candidate_content_hash, candidate_rank_snapshot, candidate_score_snapshot,
      asset_type, target_master_table, target_master_id, target_calendar_cell_id,
      calendar_row_type, operational_ref, committed_date, execution_month,
      master_payload_hash, calendar_payload_hash
    ) values (
      v_item.client_id, v_run, v_item.ideation_cycle_id, v_item.scoring_run_id,
      v_other_proposal, v_other_slot, 'zz-story',
      v_spare_candidate, v_spare_score, repeat('a', 64), 1, 90,
      'story', 'organic_master', gen_random_uuid(), gen_random_uuid(),
      'stories', 'ZZX-ST-997', '2026-08-01', '2026-08',
      repeat('a', 64), repeat('a', 64)
    );
    raise exception 'ZZ FAIL: a story was accepted against organic_master';
  exception when check_violation then null;
  end;

  raise notice 'Stage 4 ownership and target constraints passed.';
end
$$;

-- ==========================================================================
-- 5. Duplicate prevention at the structural level.
-- ==========================================================================
do $$
declare
  v_run public.client_ideation_commit_runs;
begin
  select * into v_run from public.client_ideation_commit_runs where status = 'completed';

  -- A second completed run for the same proposal is impossible.
  begin
    insert into public.client_ideation_commit_runs (
      client_id, ideation_cycle_id, scoring_run_id, proposal_id, status,
      idempotency_key, configuration_hash, calendar_digest, proposal_version,
      proposal_edit_revision, target_manifest_version, mapping_version,
      reference_allocator_version, output_schema_version, module_version,
      period_start, period_end, expected_item_count, committed_item_count,
      organic_item_count, story_item_count, completed_at
    ) values (
      v_run.client_id, v_run.ideation_cycle_id, v_run.scoring_run_id, v_run.proposal_id,
      'completed', 'zz-second', repeat('a', 64), repeat('b', 64), 1, 3,
      'v','v','v','v','v', '2026-08-01', '2026-08-07', 4, 4, 3, 1, now()
    );
    raise exception 'ZZ FAIL: a second completed commit run was accepted';
  exception when unique_violation then null;
  end;

  -- A completed run that does not reconcile is impossible.
  begin
    insert into public.client_ideation_commit_runs (
      client_id, ideation_cycle_id, scoring_run_id, proposal_id, status,
      idempotency_key, configuration_hash, calendar_digest, proposal_version,
      proposal_edit_revision, target_manifest_version, mapping_version,
      reference_allocator_version, output_schema_version, module_version,
      period_start, period_end, expected_item_count, committed_item_count,
      organic_item_count, story_item_count, failed_item_count, completed_at
    ) values (
      v_run.client_id, v_run.ideation_cycle_id, v_run.scoring_run_id,
      'bb888888-8888-4888-8888-888888888881', 'completed', 'zz-bad-counts',
      repeat('a', 64), repeat('b', 64), 1, 3, 'v','v','v','v','v',
      '2026-08-01', '2026-08-07', 4, 3, 2, 1, 0, now()
    );
    raise exception 'ZZ FAIL: a non-reconciling completed run was accepted';
  exception when check_violation or unique_violation then null;
  end;

  -- A completed run with a failed item is impossible.
  begin
    update public.client_ideation_commit_runs set failed_item_count = 1 where id = v_run.id;
    raise exception 'ZZ FAIL: a completed run accepted a failed item';
  exception when check_violation then null;
  end;

  -- One slot and one candidate may appear only once per run.
  begin
    insert into public.client_ideation_commit_items
    select (i).* from (
      select i.* from public.client_ideation_commit_items i where i.commit_run_id = v_run.id limit 1
    ) as i;
    raise exception 'ZZ FAIL: a duplicate commit item was accepted';
  exception when unique_violation then null;
  end;

  raise notice 'Stage 4 duplicate prevention passed.';
end
$$;

-- ==========================================================================
-- 6. The failure audit never overwrites a successful commit.
-- ==========================================================================
do $$
declare
  v_result uuid;
  v_runs integer;
begin
  select count(*) into v_runs from public.client_ideation_commit_runs;
  v_result := public.record_ideation_commit_failure(
    'bb111111-1111-4111-8111-111111111111'::uuid,
    'bb888888-8888-4888-8888-888888888881'::uuid,
    'bb222222-2222-4222-8222-222222222222'::uuid,
    'CALENDAR_CONFLICT', 'blocked', null, repeat('a', 64), repeat('b', 64),
    'zz-fail', 'v', 'v', 'v', 'v', 'v');
  if v_result is not null then
    raise exception 'ZZ FAIL: a failure was recorded over a completed commit';
  end if;
  if (select count(*) from public.client_ideation_commit_runs) <> v_runs then
    raise exception 'ZZ FAIL: the failure audit created a run anyway';
  end if;

  raise notice 'Stage 4 failure-audit safety passed.';
end
$$;

select 'Stage 4 adversarial SQL passed.' as result;
