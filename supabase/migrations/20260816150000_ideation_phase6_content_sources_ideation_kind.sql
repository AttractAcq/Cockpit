-- Ideation nav consolidation, Phase 6: converge all three intake methods
-- (manual idea, proof-led, AI ideation) onto content_sources / the Sources
-- review gate.
--
-- content_sources already carried an ideation_candidate_id FK (Stage E1,
-- 20260803021320) with no writer -- this phase is the first thing that
-- populates it. A scored AI candidate becomes a content_sources row the
-- moment scoring completes, so it shows up in the same Sources queue as a
-- manually-typed idea or proof item, gated by the same approve/disapprove
-- action (approve_content_source_to_master, next migration).
--
-- No raw_content/raw_content_hash is captured for ideation_candidate rows --
-- the candidate's own row (working_title/hook/core_message/cta) is the
-- source of truth, reachable via ideation_candidate_id; content_sources is
-- just the review-queue pointer to it, same as it already is for proof_item
-- (which points at proof_items via proof_item_id without duplicating claim
-- text into raw_content).

alter table public.content_sources
  drop constraint content_sources_kind_check,
  add constraint content_sources_kind_check
    check (source_kind in ('manual_idea','proof_item','research_candidate',
                           'performance_insight','ideation_candidate'));

alter table public.content_sources
  drop constraint content_sources_adapter_check,
  add constraint content_sources_adapter_check check (
    (source_kind = 'manual_idea' and ideation_candidate_id is null and performance_insight_id is null and proof_item_id is null)
    or (source_kind = 'proof_item' and ideation_candidate_id is null and performance_insight_id is null)
    or (source_kind = 'research_candidate' and performance_insight_id is null and proof_item_id is null)
    or (source_kind = 'performance_insight' and ideation_candidate_id is null and proof_item_id is null)
    or (source_kind = 'ideation_candidate' and ideation_candidate_id is not null and performance_insight_id is null and proof_item_id is null)
  );

-- Insert one content_sources row per scored candidate, right after scoring
-- is confirmed complete (same transaction, same reconciled candidate set
-- complete_ideation_scoring_run already verified above this point). Uses
-- the existing content_sources_ideation_candidate_unique index to stay
-- idempotent across a re-score / reclaimed run -- a candidate that already
-- has a Sources row is left untouched (in particular, never resurrected
-- once an operator has approved or disapproved it).
create or replace function public.complete_ideation_scoring_run(
  p_scoring_run_id uuid,
  p_lease_owner text,
  p_ranks jsonb,
  p_warnings jsonb,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.client_ideation_scoring_runs%rowtype;
  v_scored integer;
  v_expected_ids uuid[];
  v_scored_ids uuid[];
  v_rank_count integer;
  v_max_rank integer;
  v_sources_created integer;
begin
  select * into v_run
  from public.client_ideation_scoring_runs
  where id = p_scoring_run_id
  for update;
  if v_run.id is null then raise exception 'SCORING_RUN_NOT_FOUND'; end if;
  if v_run.status <> 'running'
    or v_run.lease_owner <> p_lease_owner
    or v_run.lease_expires_at <= now() then
    raise exception 'SCORING_LEASE_OWNERSHIP_LOST';
  end if;

  -- Exact reconciliation, never an aggregate count: the scored candidate set
  -- must equal the immutable snapshot set exactly.
  select array_agg((value->>'candidate_id')::uuid order by value->>'candidate_id')
  into v_expected_ids
  from jsonb_array_elements(v_run.candidate_snapshot);
  select array_agg(candidate_id order by candidate_id), count(*)
  into v_scored_ids, v_scored
  from public.client_ideation_candidate_scores
  where scoring_run_id = v_run.id;

  if v_scored is null or v_scored <> v_run.expected_candidate_count then
    raise exception 'SCORING_INCOMPLETE';
  end if;
  if v_expected_ids is distinct from v_scored_ids then
    raise exception 'SCORING_CANDIDATE_RECONCILIATION_FAILED';
  end if;

  if jsonb_typeof(coalesce(p_ranks, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_ranks) <> v_run.expected_candidate_count then
    raise exception 'SCORING_RANK_PAYLOAD_INVALID';
  end if;

  -- Clear then set, so a reclaimed run cannot collide with stale ranks.
  update public.client_ideation_candidate_scores
  set rank = null
  where scoring_run_id = v_run.id;

  update public.client_ideation_candidate_scores as scores
  set rank = (payload.value->>'rank')::integer
  from jsonb_array_elements(p_ranks) as payload
  where scores.scoring_run_id = v_run.id
    and scores.candidate_id = (payload.value->>'candidate_id')::uuid;

  select count(rank), max(rank) into v_rank_count, v_max_rank
  from public.client_ideation_candidate_scores
  where scoring_run_id = v_run.id;
  if v_rank_count <> v_run.expected_candidate_count
    or v_max_rank <> v_run.expected_candidate_count then
    raise exception 'SCORING_RANK_ASSIGNMENT_INVALID';
  end if;
  if exists (
    select 1 from public.client_ideation_candidate_scores
    where scoring_run_id = v_run.id and rank < 1
  ) then
    raise exception 'SCORING_RANK_ASSIGNMENT_INVALID';
  end if;

  update public.client_ideation_scoring_runs
  set status = 'completed',
      retryable = false,
      -- Re-derived from the reconciled row count rather than trusted from an
      -- earlier statement, so the completed-run CHECK can never be satisfied by
      -- a stale counter.
      scored_candidate_count = v_scored,
      failed_candidate_count = 0,
      warnings = coalesce(p_warnings, '[]'::jsonb),
      error_code = null,
      error_message = null,
      completed_at = now(),
      failed_at = null,
      lease_owner = null,
      lease_expires_at = null
  where id = v_run.id
  returning * into v_run;

  insert into public.content_sources (
    client_id, source_kind, title, summary, payload,
    context_version, execution_version, ideation_candidate_id, created_by
  )
  select
    v_run.client_id, 'ideation_candidate', c.working_title,
    left(c.hook, 2000),
    jsonb_build_object(
      'scoring_run_id', v_run.id, 'candidate_score_id', s.id,
      'overall_score', s.overall_score, 'priority_band', s.priority_band,
      'rank', s.rank, 'asset_type', c.asset_type
    ),
    null, null, c.id, p_actor_id
  from public.client_ideation_candidate_scores s
  join public.client_ideation_candidates c on c.id = s.candidate_id
  where s.scoring_run_id = v_run.id
  on conflict (ideation_candidate_id) where ideation_candidate_id is not null
  do nothing;
  get diagnostics v_sources_created = row_count;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    v_run.client_id, p_actor_id, 'ideation_scoring_completed',
    'Ideation candidates were scored and ranked, and ' || v_sources_created ||
      ' entered the Sources review queue.',
    'client_ideation_scoring_run', v_run.id::text,
    jsonb_build_object(
      'ideation_cycle_id', v_run.ideation_cycle_id,
      'scored_candidates', v_run.scored_candidate_count,
      'rubric_version', v_run.rubric_version,
      'sources_created', v_sources_created
    )
  );
  return to_jsonb(v_run);
end
$$;
