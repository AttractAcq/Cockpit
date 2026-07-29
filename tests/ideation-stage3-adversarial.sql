-- Ideation Stage 3 — adversarial persistence tests. Every case must fail closed.
-- Requires the fixtures and integration scripts to have run first.

\set ON_ERROR_STOP on

create or replace function pg_temp.zz3_manifest() returns jsonb
language sql stable as $$
  select jsonb_agg(jsonb_build_object(
    'proposal_slot_key', d.day || ':' || t.asset || ':1',
    'proposed_date', d.day,
    'date_slot_ordinal', 1,
    'required_asset_type', t.asset,
    'calendar_row_type', case t.asset when 'reel' then 'reel' else 'stories' end,
    'placement_basis', 'execution_cadence',
    'conflict_status', 'clear',
    'conflict_details', '{}'::jsonb
  ) order by d.day, t.asset)
  from (values ('2026-07-01'::text),('2026-07-02'),('2026-07-04'),('2026-07-06')) as d(day)
  cross join (values ('reel'::text),('story')) as t(asset);
$$;

create or replace function pg_temp.zz3_snapshot() returns jsonb
language sql stable as $$
  select candidate_snapshot from public.client_ideation_scoring_runs
  where id = 'aa444444-4444-4444-8444-444444444444';
$$;

create or replace function pg_temp.zz3_begin(p_key text, p_hash text, p_owner text, p_supersedes uuid)
returns jsonb language sql as $$
  select public.begin_ideation_calendar_proposal(
    'aa111111-1111-4111-8111-111111111111'::uuid,
    'aa333333-3333-4333-8333-333333333333'::uuid,
    'aa444444-4444-4444-8444-444444444444'::uuid,
    p_key, p_hash, '{}'::jsonb, '{}'::jsonb, pg_temp.zz3_snapshot(),
    '{}'::jsonb, pg_temp.zz3_manifest(), '{}'::jsonb, repeat('7', 64),
    'aa.ideation.slot-planner.v1', repeat('8', 64), 'anthropic', 'zz-model',
    'aa.ideation.proposal-output.v1', 'ideation-proposal.v1',
    '2026-07-01'::date, '2026-07-07'::date, 8, 3, p_supersedes, p_owner, 180,
    'aa222222-2222-4222-8222-222222222222'::uuid
  );
$$;

create or replace function pg_temp.zz3_expect_failure(p_sql text, p_label text)
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

do $$
declare
  v_client uuid := 'aa111111-1111-4111-8111-111111111111';
  v_other_client uuid := 'aa111111-1111-4111-8111-1111111111ff';
  v_cycle uuid := 'aa333333-3333-4333-8333-333333333333';
  v_scoring uuid := 'aa444444-4444-4444-8444-444444444444';
  v_actor uuid := 'aa222222-2222-4222-8222-222222222222';
  v_manifest jsonb := pg_temp.zz3_manifest();
  v_snapshot jsonb := pg_temp.zz3_snapshot();
  v_begin jsonb;
  v_proposal uuid;
  v_slot text;
  v_candidate uuid;
  v_foreign_slot text;
begin
  -- A non-completed cycle can never start a proposal.
  update public.client_ideation_cycles set status = 'retryable' where id = v_cycle;
  perform pg_temp.zz3_expect_failure(
    format('select pg_temp.zz3_begin(%L, %L, %L, null)', 'zz3-adv-cycle', repeat('3',64), 'zz3-adv-owner'),
    'proposal on a non-completed cycle');
  update public.client_ideation_cycles set status = 'completed' where id = v_cycle;

  -- A non-completed scoring run can never start a proposal.
  update public.client_ideation_scoring_runs set status = 'retryable', completed_at = null where id = v_scoring;
  perform pg_temp.zz3_expect_failure(
    format('select pg_temp.zz3_begin(%L, %L, %L, null)', 'zz3-adv-scoring', repeat('3',64), 'zz3-adv-owner'),
    'proposal on a non-completed scoring run');
  update public.client_ideation_scoring_runs set status = 'completed', completed_at = now() where id = v_scoring;

  -- A manifest whose length disagrees with the expected slot count fails.
  perform pg_temp.zz3_expect_failure(format($fmt$
    select public.begin_ideation_calendar_proposal(
      %L::uuid, %L::uuid, %L::uuid, 'zz3-adv-count', %L, '{}'::jsonb, '{}'::jsonb, %L::jsonb,
      '{}'::jsonb, %L::jsonb, '{}'::jsonb, %L, 'aa.ideation.slot-planner.v1', %L,
      'anthropic', 'zz-model', 'aa.ideation.proposal-output.v1', 'ideation-proposal.v1',
      '2026-07-01'::date, '2026-07-07'::date, 7, 3, null, 'zz3-adv-owner', 180, %L::uuid)
  $fmt$, v_client, v_cycle, v_scoring, repeat('3',64), v_snapshot, v_manifest,
       repeat('7',64), repeat('8',64), v_actor), 'slot manifest length mismatch');

  -- A period that disagrees with the originating cycle fails.
  perform pg_temp.zz3_expect_failure(format($fmt$
    select public.begin_ideation_calendar_proposal(
      %L::uuid, %L::uuid, %L::uuid, 'zz3-adv-period', %L, '{}'::jsonb, '{}'::jsonb, %L::jsonb,
      '{}'::jsonb, %L::jsonb, '{}'::jsonb, %L, 'aa.ideation.slot-planner.v1', %L,
      'anthropic', 'zz-model', 'aa.ideation.proposal-output.v1', 'ideation-proposal.v1',
      '2026-08-01'::date, '2026-08-07'::date, 8, 3, null, 'zz3-adv-owner', 180, %L::uuid)
  $fmt$, v_client, v_cycle, v_scoring, repeat('3',64), v_snapshot, v_manifest,
       repeat('7',64), repeat('8',64), v_actor), 'period mismatch');

  -- Lease and attempt bounds are enforced.
  perform pg_temp.zz3_expect_failure(format($fmt$
    select public.begin_ideation_calendar_proposal(
      %L::uuid, %L::uuid, %L::uuid, 'zz3-adv-lease', %L, '{}'::jsonb, '{}'::jsonb, %L::jsonb,
      '{}'::jsonb, %L::jsonb, '{}'::jsonb, %L, 'aa.ideation.slot-planner.v1', %L,
      'anthropic', 'zz-model', 'aa.ideation.proposal-output.v1', 'ideation-proposal.v1',
      '2026-07-01'::date, '2026-07-07'::date, 8, 3, null, 'zz3-adv-owner', 20, %L::uuid)
  $fmt$, v_client, v_cycle, v_scoring, repeat('3',64), v_snapshot, v_manifest,
       repeat('7',64), repeat('8',64), v_actor), 'lease below the minimum');

  -- A regeneration naming an unknown predecessor fails.
  perform pg_temp.zz3_expect_failure(
    format('select pg_temp.zz3_begin(%L, %L, %L, %L::uuid)',
      'zz3-adv-regen', repeat('3',64), 'zz3-adv-owner', 'aaaaaaaa-9999-4999-8999-999999999999'),
    'regeneration from an unknown predecessor');

  -- Start a genuine running proposal for the persistence cases.
  v_begin := pg_temp.zz3_begin('zz3-adv-run', repeat('2', 64), 'zz3-adv-owner', null);
  v_proposal := (v_begin->'proposal'->>'id')::uuid;

  -- Reusing the identity with a different configuration is a conflict.
  perform pg_temp.zz3_expect_failure(
    format('select pg_temp.zz3_begin(%L, %L, %L, null)', 'zz3-adv-run', repeat('1',64), 'zz3-adv-owner-2'),
    'idempotency conflict on a changed configuration');

  select proposal_slot_key into v_slot from public.client_ideation_calendar_proposal_slots
  where proposal_id = v_proposal and required_asset_type = 'reel' order by proposal_slot_key limit 1;
  select id into v_candidate from public.client_ideation_candidates
  where ideation_cycle_id = v_cycle and asset_type = 'reel' order by id limit 1;

  -- A non-owner can neither persist, complete, fail, nor renew.
  perform pg_temp.zz3_expect_failure(format(
    'select public.persist_ideation_proposal_batch(%L, ''zz3-wrong-owner'', ''[]''::jsonb)', v_proposal),
    'non-owner persistence');
  perform pg_temp.zz3_expect_failure(format(
    'select public.complete_ideation_calendar_proposal(%L, ''zz3-wrong-owner'', ''[]''::jsonb, %L)', v_proposal, v_actor),
    'non-owner completion');
  perform pg_temp.zz3_expect_failure(format(
    'select public.fail_ideation_calendar_proposal(%L, ''zz3-wrong-owner'', ''X'', ''x'', false, ''[]''::jsonb, %L)', v_proposal, v_actor),
    'non-owner failure');
  perform pg_temp.zz3_expect_failure(format(
    'select public.renew_ideation_proposal_lease(%L, ''zz3-wrong-owner'', 180)', v_proposal),
    'non-owner lease renewal');

  -- A story candidate can never occupy a reel slot.
  perform pg_temp.zz3_expect_failure(format($fmt$
    select public.persist_ideation_proposal_batch(%L, 'zz3-adv-owner', jsonb_build_array(jsonb_build_object(
      'proposal_slot_key', %L, 'candidate_id',
      (select id::text from public.client_ideation_candidates
       where ideation_cycle_id = %L and asset_type = 'story' order by id limit 1),
      'candidate_display_reference', 'IDEATION/aa333333/ZZZ-XX-01',
      'placement_rationale', 'ZZ', 'authority_references', '[]'::jsonb,
      'evidence_references', '[]'::jsonb, 'warnings', '[]'::jsonb)))
  $fmt$, v_proposal, v_slot, v_cycle), 'asset-type incompatible assignment');

  -- A candidate from another cycle can never be assigned.
  perform pg_temp.zz3_expect_failure(format($fmt$
    select public.persist_ideation_proposal_batch(%L, 'zz3-adv-owner', jsonb_build_array(jsonb_build_object(
      'proposal_slot_key', %L, 'candidate_id', 'aaaaaaaa-1111-4111-8111-111111111111',
      'candidate_display_reference', 'IDEATION/aa333333/ZZZ-XX-01',
      'placement_rationale', 'ZZ', 'authority_references', '[]'::jsonb,
      'evidence_references', '[]'::jsonb, 'warnings', '[]'::jsonb)))
  $fmt$, v_proposal, v_slot), 'unknown candidate assignment');

  -- An unregistered slot key can never be filled.
  perform pg_temp.zz3_expect_failure(format($fmt$
    select public.persist_ideation_proposal_batch(%L, 'zz3-adv-owner', jsonb_build_array(jsonb_build_object(
      'proposal_slot_key', '2026-12-31:reel:1', 'candidate_id', %L,
      'candidate_display_reference', 'IDEATION/aa333333/ZZZ-XX-01',
      'placement_rationale', 'ZZ', 'authority_references', '[]'::jsonb,
      'evidence_references', '[]'::jsonb, 'warnings', '[]'::jsonb)))
  $fmt$, v_proposal, v_candidate), 'unregistered slot assignment');

  -- Completion is impossible while any slot is unassigned.
  perform pg_temp.zz3_expect_failure(format(
    'select public.complete_ideation_calendar_proposal(%L, ''zz3-adv-owner'', ''[]''::jsonb, %L)', v_proposal, v_actor),
    'completing a partially assigned proposal');

  raise notice 'Stage 3 adversarial persistence passed.';
end
$$;

-- ---------------------------------------------------------------------------
-- Direct constraint violations must be impossible even for service_role.
-- ---------------------------------------------------------------------------
do $$
declare
  v_proposal uuid;
  v_slot record;
  v_candidate uuid;
begin
  select id into v_proposal from public.client_ideation_calendar_proposals
  where idempotency_key = 'zz3-adv-run';
  select * into v_slot from public.client_ideation_calendar_proposal_slots
  where proposal_id = v_proposal order by proposal_slot_key limit 1;
  select id into v_candidate from public.client_ideation_candidates
  where ideation_cycle_id = 'aa333333-3333-4333-8333-333333333333' order by id limit 1;

  -- A date outside the proposal period is rejected by the table itself.
  perform pg_temp.zz3_expect_failure(format(
    'update public.client_ideation_calendar_proposal_slots set proposed_date = ''2026-09-01'' where id = %L', v_slot.id),
    'slot date outside the period');

  -- A duplicate slot key inside one proposal is rejected.
  perform pg_temp.zz3_expect_failure(format($fmt$
    insert into public.client_ideation_calendar_proposal_slots (
      client_id, proposal_id, ideation_cycle_id, scoring_run_id, proposal_slot_key,
      proposed_date, period_start, period_end, date_slot_ordinal, required_asset_type,
      calendar_row_type, placement_basis)
    values (%L, %L, %L, %L, %L, '2026-07-02', '2026-07-01', '2026-07-07', 1, 'reel', 'reel', 'execution_cadence')
  $fmt$, v_slot.client_id, v_proposal, v_slot.ideation_cycle_id, v_slot.scoring_run_id, v_slot.proposal_slot_key),
    'duplicate slot key');

  -- A half-assigned slot row is rejected.
  perform pg_temp.zz3_expect_failure(format(
    'update public.client_ideation_calendar_proposal_slots set candidate_id = %L where id = %L', v_candidate, v_slot.id),
    'half-assigned slot row');

  -- A display reference imitating an operational master ref is rejected.
  perform pg_temp.zz3_expect_failure(format($fmt$
    update public.client_ideation_calendar_proposal_slots
    set candidate_id = %L, candidate_score_id = (select id from public.client_ideation_candidate_scores
          where candidate_id = %L limit 1),
        candidate_asset_type_snapshot = 'reel', candidate_content_hash = repeat('1',64),
        candidate_rank_snapshot = 1, candidate_score_snapshot = 90,
        candidate_display_reference = 'JUL26-RL-001', placement_source = 'model'
    where id = %L
  $fmt$, v_candidate, v_candidate, v_slot.id), 'operational-looking display reference');

  -- An invalid conflict status is rejected.
  perform pg_temp.zz3_expect_failure(format(
    'update public.client_ideation_calendar_proposal_slots set conflict_status = ''totally_fine'' where id = %L', v_slot.id),
    'unknown conflict status');

  raise notice 'Stage 3 constraint protection passed.';
end
$$;

-- ---------------------------------------------------------------------------
-- The attempt cap is terminal.
-- ---------------------------------------------------------------------------
do $$
declare v_proposal uuid; v_result jsonb;
begin
  select id into v_proposal from public.client_ideation_calendar_proposals
  where idempotency_key = 'zz3-adv-run';
  update public.client_ideation_calendar_proposals
  set attempt_count = 3, status = 'retryable', retryable = true,
      lease_owner = null, lease_expires_at = null
  where id = v_proposal;

  v_result := pg_temp.zz3_begin('zz3-adv-run', repeat('2', 64), 'zz3-adv-owner-3', null);
  if (v_result->>'attempts_exhausted')::boolean is not true then raise exception 'ATTEMPT_CAP_NOT_ENFORCED'; end if;
  if (v_result->'proposal'->>'status') <> 'failed' then raise exception 'EXHAUSTED_NOT_TERMINAL'; end if;
  if (v_result->'proposal'->>'attempt_count')::integer <> 3 then raise exception 'ATTEMPT_COUNT_INCREMENTED'; end if;

  raise notice 'Stage 3 attempt cap passed.';
end
$$;
