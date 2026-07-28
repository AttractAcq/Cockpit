-- Ideation Stage 2: candidate scoring and deterministic ranking.
--
-- This migration intentionally creates no link, trigger, or write path to any
-- content master, Calendar, production brief, asset, distribution, or render
-- lifecycle. Scores are advisory and non-authoritative: nothing here approves,
-- rejects, shortlists, schedules, or commits a candidate.
--
-- Frozen boundaries preserved:
-- - public.client_context_files and public.client_execution_files are read-only
--   to Stage 2; this migration does not alter them;
-- - neither public.playbooks nor public.playbook_runs is altered or queried;
-- - Stage 1 Ideation tables are not restructured. The single additive change to
--   a Stage 1 table is one composite unique constraint on
--   public.client_ideation_candidates, required so a score row can carry a
--   composite ownership foreign key. (id) is already the primary key, so the
--   constraint adds an index and changes no existing behaviour.

alter table public.client_ideation_candidates
  add constraint client_ideation_candidates_id_cycle_client_key
  unique (id, ideation_cycle_id, client_id);

create table public.client_ideation_scoring_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ideation_cycle_id uuid not null,
  status text not null default 'running',
  idempotency_key text not null,
  configuration_hash text not null,
  configuration_snapshot jsonb not null default '{}'::jsonb,
  authority_snapshot jsonb not null default '{}'::jsonb,
  candidate_snapshot jsonb not null default '[]'::jsonb,
  rubric_slug text not null,
  rubric_version text not null,
  prompt_digest text not null,
  provider text not null,
  model text not null,
  output_schema_version text not null,
  module_version text not null,
  expected_candidate_count integer not null,
  scored_candidate_count integer not null default 0,
  failed_candidate_count integer not null default 0,
  attempt_count integer not null default 1,
  maximum_attempts integer not null default 3,
  retryable boolean not null default false,
  warnings jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  supersedes_scoring_run_id uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_ideation_scoring_runs_status_check
    check (status in ('running','retryable','completed','failed')),
  constraint client_ideation_scoring_runs_idempotency_check
    check (length(idempotency_key) between 1 and 128),
  constraint client_ideation_scoring_runs_configuration_hash_check
    check (configuration_hash ~ '^[0-9a-f]{64}$'),
  constraint client_ideation_scoring_runs_prompt_digest_check
    check (prompt_digest ~ '^[0-9a-f]{64}$'),
  constraint client_ideation_scoring_runs_rubric_check
    check (length(rubric_slug) between 1 and 100 and length(rubric_version) between 1 and 100),
  constraint client_ideation_scoring_runs_provider_check
    check (length(provider) between 1 and 100 and length(model) between 1 and 200),
  constraint client_ideation_scoring_runs_versions_check
    check (length(output_schema_version) between 1 and 100 and length(module_version) between 1 and 100),
  constraint client_ideation_scoring_runs_snapshot_check
    check (
      jsonb_typeof(configuration_snapshot) = 'object'
      and jsonb_typeof(authority_snapshot) = 'object'
      and jsonb_typeof(candidate_snapshot) = 'array'
      and jsonb_typeof(warnings) = 'array'
    ),
  constraint client_ideation_scoring_runs_counts_check
    check (
      expected_candidate_count >= 1
      and scored_candidate_count >= 0
      and failed_candidate_count >= 0
      and scored_candidate_count <= expected_candidate_count
    ),
  constraint client_ideation_scoring_runs_attempts_check
    check (attempt_count >= 1 and maximum_attempts between 1 and 10 and attempt_count <= maximum_attempts),
  constraint client_ideation_scoring_runs_candidate_snapshot_length_check
    check (jsonb_array_length(candidate_snapshot) = expected_candidate_count),
  constraint client_ideation_scoring_runs_lease_check
    check (
      (status = 'running' and lease_owner is not null and lease_expires_at is not null and last_heartbeat_at is not null)
      or (status <> 'running' and lease_owner is null and lease_expires_at is null)
    ),
  constraint client_ideation_scoring_runs_completed_check
    check (
      (status = 'completed' and completed_at is not null and scored_candidate_count = expected_candidate_count)
      or (status <> 'completed' and completed_at is null)
    ),
  constraint client_ideation_scoring_runs_failed_check
    check ((status = 'failed' and failed_at is not null) or (status <> 'failed' and failed_at is null)),
  constraint client_ideation_scoring_runs_retryable_check
    check (not (status = 'completed' and retryable)),
  constraint client_ideation_scoring_runs_no_self_supersede_check
    check (supersedes_scoring_run_id is null or supersedes_scoring_run_id <> id),
  constraint client_ideation_scoring_runs_client_idempotency_key
    unique (client_id, idempotency_key),
  constraint client_ideation_scoring_runs_id_client_key
    unique (id, client_id),
  constraint client_ideation_scoring_runs_id_cycle_client_key
    unique (id, ideation_cycle_id, client_id),
  constraint client_ideation_scoring_runs_cycle_client_fk
    foreign key (ideation_cycle_id, client_id)
    references public.client_ideation_cycles(id, client_id)
    on delete cascade,
  constraint client_ideation_scoring_runs_supersedes_client_fk
    foreign key (supersedes_scoring_run_id, client_id)
    references public.client_ideation_scoring_runs(id, client_id)
    on delete set null
);

create index client_ideation_scoring_runs_client_created_idx
  on public.client_ideation_scoring_runs (client_id, created_at desc);
create index client_ideation_scoring_runs_cycle_created_idx
  on public.client_ideation_scoring_runs (ideation_cycle_id, created_at desc);
create index client_ideation_scoring_runs_status_idx
  on public.client_ideation_scoring_runs (client_id, status, updated_at desc);
create trigger client_ideation_scoring_runs_updated_at
  before update on public.client_ideation_scoring_runs
  for each row execute function public.set_updated_at();

comment on table public.client_ideation_scoring_runs is
  'Stage 2 Ideation scoring batch. Advisory only: it has no Calendar, master, production, distribution, or approval semantics.';

create table public.client_ideation_candidate_scores (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ideation_cycle_id uuid not null,
  scoring_run_id uuid not null,
  candidate_id uuid not null,
  candidate_content_hash text not null,
  candidate_evidence_hash text not null,
  execution_plan_alignment smallint not null,
  business_and_positioning_alignment smallint not null,
  audience_and_pain_relevance smallint not null,
  proof_and_evidence_strength smallint not null,
  hook_and_attention_strength smallint not null,
  commercial_potential smallint not null,
  specificity_and_clarity smallint not null,
  originality_and_distinctiveness smallint not null,
  platform_and_format_fit smallint not null,
  production_feasibility smallint not null,
  overall_score smallint not null,
  priority_band text not null,
  rank integer,
  rationale text not null,
  strengths jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  authority_references jsonb not null default '[]'::jsonb,
  evidence_references jsonb not null default '[]'::jsonb,
  provider text not null,
  model text not null,
  rubric_slug text not null,
  rubric_version text not null,
  prompt_version text not null,
  output_schema_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_ideation_candidate_scores_dimensions_check
    check (
      execution_plan_alignment between 0 and 10
      and business_and_positioning_alignment between 0 and 10
      and audience_and_pain_relevance between 0 and 10
      and proof_and_evidence_strength between 0 and 10
      and hook_and_attention_strength between 0 and 10
      and commercial_potential between 0 and 10
      and specificity_and_clarity between 0 and 10
      and originality_and_distinctiveness between 0 and 10
      and platform_and_format_fit between 0 and 10
      and production_feasibility between 0 and 10
    ),
  constraint client_ideation_candidate_scores_overall_check
    check (overall_score between 0 and 100),
  constraint client_ideation_candidate_scores_band_check
    check (priority_band in ('top','high','medium','low')),
  -- The band is a pure function of the overall score. Enforcing it here means a
  -- service-role write cannot persist a band the rubric would not produce.
  constraint client_ideation_candidate_scores_band_matches_score_check
    check (
      priority_band = case
        when overall_score >= 90 then 'top'
        when overall_score >= 75 then 'high'
        when overall_score >= 60 then 'medium'
        else 'low'
      end
    ),
  constraint client_ideation_candidate_scores_rank_check
    check (rank is null or rank >= 1),
  constraint client_ideation_candidate_scores_hash_check
    check (
      candidate_content_hash ~ '^[0-9a-f]{64}$'
      and candidate_evidence_hash ~ '^[0-9a-f]{64}$'
    ),
  constraint client_ideation_candidate_scores_rationale_check
    check (length(rationale) between 1 and 1200),
  constraint client_ideation_candidate_scores_arrays_check
    check (
      jsonb_typeof(strengths) = 'array' and jsonb_array_length(strengths) between 1 and 3
      and jsonb_typeof(risks) = 'array' and jsonb_array_length(risks) between 0 and 3
      and jsonb_typeof(authority_references) = 'array' and jsonb_array_length(authority_references) between 0 and 12
      and jsonb_typeof(evidence_references) = 'array' and jsonb_array_length(evidence_references) between 0 and 12
    ),
  constraint client_ideation_candidate_scores_provenance_check
    check (
      length(provider) between 1 and 100 and length(model) between 1 and 200
      and length(rubric_slug) between 1 and 100 and length(rubric_version) between 1 and 100
      and length(prompt_version) between 1 and 100 and length(output_schema_version) between 1 and 100
    ),
  constraint client_ideation_candidate_scores_run_candidate_key
    unique (scoring_run_id, candidate_id),
  constraint client_ideation_candidate_scores_run_rank_key
    unique (scoring_run_id, rank),
  constraint client_ideation_candidate_scores_run_cycle_client_fk
    foreign key (scoring_run_id, ideation_cycle_id, client_id)
    references public.client_ideation_scoring_runs(id, ideation_cycle_id, client_id)
    on delete cascade,
  constraint client_ideation_candidate_scores_candidate_cycle_client_fk
    foreign key (candidate_id, ideation_cycle_id, client_id)
    references public.client_ideation_candidates(id, ideation_cycle_id, client_id)
    on delete cascade
);

create index client_ideation_candidate_scores_run_rank_idx
  on public.client_ideation_candidate_scores (scoring_run_id, rank);
create index client_ideation_candidate_scores_cycle_idx
  on public.client_ideation_candidate_scores (ideation_cycle_id, created_at desc);
create index client_ideation_candidate_scores_client_idx
  on public.client_ideation_candidate_scores (client_id, created_at desc);
create trigger client_ideation_candidate_scores_updated_at
  before update on public.client_ideation_candidate_scores
  for each row execute function public.set_updated_at();

comment on table public.client_ideation_candidate_scores is
  'Stage 2 advisory candidate score. Overall score, priority band, and rank are server-calculated; the model supplies only the ten rubric dimensions.';

alter table public.client_ideation_scoring_runs enable row level security;
alter table public.client_ideation_candidate_scores enable row level security;

revoke all on public.client_ideation_scoring_runs from public, anon, authenticated;
revoke all on public.client_ideation_candidate_scores from public, anon, authenticated;
grant select on public.client_ideation_scoring_runs to authenticated;
grant select on public.client_ideation_candidate_scores to authenticated;
grant all on public.client_ideation_scoring_runs to service_role;
grant all on public.client_ideation_candidate_scores to service_role;

create policy client_ideation_scoring_runs_select
  on public.client_ideation_scoring_runs for select to authenticated
  using (client_id = any(public.auth_client_ids()));
create policy client_ideation_candidate_scores_select
  on public.client_ideation_candidate_scores for select to authenticated
  using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- Scoring run transactions. Service-role only; owner-bound leases throughout.
-- ---------------------------------------------------------------------------

create or replace function public.begin_ideation_scoring_run(
  p_client_id uuid,
  p_ideation_cycle_id uuid,
  p_idempotency_key text,
  p_configuration_hash text,
  p_configuration_snapshot jsonb,
  p_authority_snapshot jsonb,
  p_candidate_snapshot jsonb,
  p_rubric_slug text,
  p_rubric_version text,
  p_prompt_digest text,
  p_provider text,
  p_model text,
  p_output_schema_version text,
  p_module_version text,
  p_expected_candidate_count integer,
  p_maximum_attempts integer,
  p_supersedes_scoring_run_id uuid,
  p_lease_owner text,
  p_lease_seconds integer,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.client_ideation_cycles%rowtype;
  v_run public.client_ideation_scoring_runs%rowtype;
  v_inserted_id uuid;
begin
  if length(trim(p_lease_owner)) < 8 or p_lease_seconds not between 60 and 600 then
    raise exception 'LEASE_CONFIGURATION_INVALID';
  end if;
  if p_maximum_attempts is null or p_maximum_attempts not between 1 and 10 then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end if;
  if p_expected_candidate_count is null or p_expected_candidate_count < 1 then
    raise exception 'SCORING_EXPECTATION_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_candidate_snapshot, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_candidate_snapshot) <> p_expected_candidate_count then
    raise exception 'CANDIDATE_SNAPSHOT_INVALID';
  end if;

  select * into v_cycle
  from public.client_ideation_cycles
  where id = p_ideation_cycle_id
  for share;
  if v_cycle.id is null then raise exception 'CYCLE_NOT_FOUND'; end if;
  if v_cycle.client_id <> p_client_id then raise exception 'CYCLE_CLIENT_MISMATCH'; end if;
  if v_cycle.status <> 'completed' then raise exception 'CYCLE_NOT_ELIGIBLE'; end if;
  if v_cycle.shortfall_count <> 0
    or v_cycle.candidate_count <> v_cycle.expected_candidate_count
    or v_cycle.expected_candidate_count <> p_expected_candidate_count then
    raise exception 'CYCLE_NOT_ELIGIBLE';
  end if;

  -- An explicit re-score must name a real, completed, same-cycle predecessor.
  if p_supersedes_scoring_run_id is not null then
    perform 1 from public.client_ideation_scoring_runs
    where id = p_supersedes_scoring_run_id
      and client_id = p_client_id
      and ideation_cycle_id = p_ideation_cycle_id
      and status = 'completed';
    if not found then raise exception 'RESCORE_PREDECESSOR_INVALID'; end if;
  end if;

  insert into public.client_ideation_scoring_runs (
    client_id, ideation_cycle_id, idempotency_key, configuration_hash,
    configuration_snapshot, authority_snapshot, candidate_snapshot,
    rubric_slug, rubric_version, prompt_digest, provider, model,
    output_schema_version, module_version, expected_candidate_count,
    maximum_attempts, supersedes_scoring_run_id, created_by,
    lease_owner, lease_expires_at, last_heartbeat_at
  ) values (
    p_client_id, p_ideation_cycle_id, p_idempotency_key, p_configuration_hash,
    p_configuration_snapshot, p_authority_snapshot, p_candidate_snapshot,
    p_rubric_slug, p_rubric_version, p_prompt_digest, p_provider, p_model,
    p_output_schema_version, p_module_version, p_expected_candidate_count,
    p_maximum_attempts, p_supersedes_scoring_run_id, p_actor_id,
    p_lease_owner, now() + make_interval(secs => p_lease_seconds), now()
  )
  on conflict (client_id, idempotency_key) do nothing
  returning id into v_inserted_id;

  select * into v_run
  from public.client_ideation_scoring_runs
  where client_id = p_client_id and idempotency_key = p_idempotency_key
  for update;
  if v_run.configuration_hash <> p_configuration_hash then
    raise exception using errcode = '23505', message = 'SCORING_IDEMPOTENCY_CONFLICT';
  end if;

  if v_inserted_id is not null then
    insert into public.activity_log (
      client_id, actor_id, event_type, plain_english_message,
      object_type, object_id, metadata
    ) values (
      p_client_id, p_actor_id, 'ideation_scoring_started',
      'Ideation candidate scoring started.',
      'client_ideation_scoring_run', v_run.id::text,
      jsonb_build_object(
        'ideation_cycle_id', p_ideation_cycle_id,
        'expected_candidates', p_expected_candidate_count,
        'rubric_version', p_rubric_version,
        'supersedes_scoring_run_id', p_supersedes_scoring_run_id
      )
    );
    return jsonb_build_object('created', true, 'reclaimed', false, 'run', to_jsonb(v_run));
  end if;

  if v_run.status in ('completed','failed') then
    return jsonb_build_object('created', false, 'reclaimed', false, 'run', to_jsonb(v_run));
  end if;
  if v_run.status = 'running' and v_run.lease_expires_at > now() then
    return jsonb_build_object('created', false, 'reclaimed', false, 'run', to_jsonb(v_run));
  end if;
  if v_run.status not in ('running','retryable') then
    raise exception 'SCORING_RUN_STATE_INVALID';
  end if;
  if v_run.attempt_count >= v_run.maximum_attempts then
    update public.client_ideation_scoring_runs
    set status = 'failed',
        retryable = false,
        error_code = 'SCORING_ATTEMPTS_EXHAUSTED',
        error_message = 'The configured Ideation scoring attempt limit was exhausted.',
        failed_at = now(),
        lease_owner = null,
        lease_expires_at = null
    where id = v_run.id
    returning * into v_run;
    insert into public.activity_log (
      client_id, actor_id, event_type, plain_english_message,
      object_type, object_id, metadata
    ) values (
      p_client_id, p_actor_id, 'ideation_scoring_attempts_exhausted',
      'Ideation scoring stopped after exhausting its configured attempt limit.',
      'client_ideation_scoring_run', v_run.id::text,
      jsonb_build_object('attempt_count', v_run.attempt_count, 'max_attempts', v_run.maximum_attempts)
    );
    return jsonb_build_object(
      'created', false, 'reclaimed', false, 'attempts_exhausted', true, 'run', to_jsonb(v_run)
    );
  end if;

  update public.client_ideation_scoring_runs
  set status = 'running',
      retryable = false,
      attempt_count = attempt_count + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_heartbeat_at = now(),
      error_code = null,
      error_message = null,
      failed_at = null
  where id = v_run.id
  returning * into v_run;
  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'ideation_scoring_reclaimed',
    'An expired or retryable Ideation scoring run was safely reclaimed.',
    'client_ideation_scoring_run', v_run.id::text,
    jsonb_build_object('attempt_count', v_run.attempt_count)
  );
  return jsonb_build_object('created', true, 'reclaimed', true, 'run', to_jsonb(v_run));
end
$$;

create or replace function public.renew_ideation_scoring_lease(
  p_scoring_run_id uuid,
  p_lease_owner text,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.client_ideation_scoring_runs%rowtype;
begin
  if p_lease_seconds not between 60 and 600 then raise exception 'LEASE_CONFIGURATION_INVALID'; end if;
  update public.client_ideation_scoring_runs
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_heartbeat_at = now()
  where id = p_scoring_run_id
    and status = 'running'
    and lease_owner = p_lease_owner
    and lease_expires_at > now()
  returning * into v_run;
  if v_run.id is null then raise exception 'SCORING_LEASE_OWNERSHIP_LOST'; end if;
  return to_jsonb(v_run);
end
$$;

create or replace function public.persist_ideation_score_batch(
  p_scoring_run_id uuid,
  p_lease_owner text,
  p_scores jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.client_ideation_scoring_runs%rowtype;
  v_item jsonb;
  v_candidate public.client_ideation_candidates%rowtype;
  v_snapshot jsonb;
  v_inserted integer := 0;
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
  if jsonb_typeof(coalesce(p_scores, 'null'::jsonb)) <> 'array' then
    raise exception 'SCORE_BATCH_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_scores)
  loop
    select * into v_candidate
    from public.client_ideation_candidates
    where id = (v_item->>'candidate_id')::uuid;
    if v_candidate.id is null then raise exception 'SCORE_CANDIDATE_NOT_FOUND'; end if;
    if v_candidate.client_id <> v_run.client_id then raise exception 'SCORE_CANDIDATE_CLIENT_MISMATCH'; end if;
    if v_candidate.ideation_cycle_id <> v_run.ideation_cycle_id then
      raise exception 'SCORE_CANDIDATE_CYCLE_MISMATCH';
    end if;

    -- The candidate must still be the exact scoring input the run was created
    -- for. A candidate edited after the run began fails closed here.
    select value into v_snapshot
    from jsonb_array_elements(v_run.candidate_snapshot)
    where value->>'candidate_id' = v_item->>'candidate_id';
    if v_snapshot is null then raise exception 'SCORE_CANDIDATE_NOT_IN_SNAPSHOT'; end if;
    if v_snapshot->>'content_hash' <> v_item->>'candidate_content_hash'
      or v_snapshot->>'evidence_hash' <> v_item->>'candidate_evidence_hash' then
      raise exception 'SCORE_CANDIDATE_HASH_MISMATCH';
    end if;

    insert into public.client_ideation_candidate_scores (
      client_id, ideation_cycle_id, scoring_run_id, candidate_id,
      candidate_content_hash, candidate_evidence_hash,
      execution_plan_alignment, business_and_positioning_alignment,
      audience_and_pain_relevance, proof_and_evidence_strength,
      hook_and_attention_strength, commercial_potential,
      specificity_and_clarity, originality_and_distinctiveness,
      platform_and_format_fit, production_feasibility,
      overall_score, priority_band, rationale, strengths, risks,
      authority_references, evidence_references,
      provider, model, rubric_slug, rubric_version, prompt_version, output_schema_version
    ) values (
      v_run.client_id, v_run.ideation_cycle_id, v_run.id, (v_item->>'candidate_id')::uuid,
      v_item->>'candidate_content_hash', v_item->>'candidate_evidence_hash',
      (v_item->>'execution_plan_alignment')::smallint,
      (v_item->>'business_and_positioning_alignment')::smallint,
      (v_item->>'audience_and_pain_relevance')::smallint,
      (v_item->>'proof_and_evidence_strength')::smallint,
      (v_item->>'hook_and_attention_strength')::smallint,
      (v_item->>'commercial_potential')::smallint,
      (v_item->>'specificity_and_clarity')::smallint,
      (v_item->>'originality_and_distinctiveness')::smallint,
      (v_item->>'platform_and_format_fit')::smallint,
      (v_item->>'production_feasibility')::smallint,
      (v_item->>'overall_score')::smallint,
      v_item->>'priority_band',
      v_item->>'rationale',
      coalesce(v_item->'strengths', '[]'::jsonb),
      coalesce(v_item->'risks', '[]'::jsonb),
      coalesce(v_item->'authority_references', '[]'::jsonb),
      coalesce(v_item->'evidence_references', '[]'::jsonb),
      v_run.provider, v_run.model, v_run.rubric_slug, v_run.rubric_version,
      v_item->>'prompt_version', v_run.output_schema_version
    )
    on conflict (scoring_run_id, candidate_id) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
  end loop;

  update public.client_ideation_scoring_runs
  set scored_candidate_count = (
        select count(*) from public.client_ideation_candidate_scores
        where scoring_run_id = v_run.id
      )
  where id = v_run.id
  returning * into v_run;

  return jsonb_build_object('inserted', v_inserted, 'run', to_jsonb(v_run));
end
$$;

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

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    v_run.client_id, p_actor_id, 'ideation_scoring_completed',
    'Ideation candidates were scored and ranked.',
    'client_ideation_scoring_run', v_run.id::text,
    jsonb_build_object(
      'ideation_cycle_id', v_run.ideation_cycle_id,
      'scored_candidates', v_run.scored_candidate_count,
      'rubric_version', v_run.rubric_version
    )
  );
  return to_jsonb(v_run);
end
$$;

create or replace function public.fail_ideation_scoring_run(
  p_scoring_run_id uuid,
  p_lease_owner text,
  p_error_code text,
  p_error_message text,
  p_retryable boolean,
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
  v_retryable boolean;
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

  select count(*) into v_scored
  from public.client_ideation_candidate_scores
  where scoring_run_id = v_run.id;

  -- A run is only retryable while attempts remain. Attempt 3 is terminal.
  v_retryable := coalesce(p_retryable, false) and v_run.attempt_count < v_run.maximum_attempts;

  update public.client_ideation_scoring_runs
  set status = case when v_retryable then 'retryable' else 'failed' end,
      retryable = v_retryable,
      scored_candidate_count = v_scored,
      failed_candidate_count = greatest(v_run.expected_candidate_count - v_scored, 0),
      warnings = coalesce(p_warnings, '[]'::jsonb),
      error_code = p_error_code,
      error_message = left(p_error_message, 2000),
      failed_at = case when v_retryable then null else now() end,
      completed_at = null,
      lease_owner = null,
      lease_expires_at = null
  where id = v_run.id
  returning * into v_run;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    v_run.client_id, p_actor_id,
    case when v_retryable then 'ideation_scoring_retryable' else 'ideation_scoring_failed' end,
    'Ideation scoring did not complete: ' || left(coalesce(p_error_message, 'unknown'), 500),
    'client_ideation_scoring_run', v_run.id::text,
    jsonb_build_object(
      'error_code', p_error_code,
      'attempt_count', v_run.attempt_count,
      'scored_candidates', v_scored
    )
  );
  return to_jsonb(v_run);
end
$$;

revoke all on function public.begin_ideation_scoring_run(
  uuid,uuid,text,text,jsonb,jsonb,jsonb,text,text,text,text,text,text,text,integer,integer,uuid,text,integer,uuid
) from public, anon, authenticated;
revoke all on function public.renew_ideation_scoring_lease(uuid,text,integer)
  from public, anon, authenticated;
revoke all on function public.persist_ideation_score_batch(uuid,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_ideation_scoring_run(uuid,text,jsonb,jsonb,uuid)
  from public, anon, authenticated;
revoke all on function public.fail_ideation_scoring_run(uuid,text,text,text,boolean,jsonb,uuid)
  from public, anon, authenticated;

grant execute on function public.begin_ideation_scoring_run(
  uuid,uuid,text,text,jsonb,jsonb,jsonb,text,text,text,text,text,text,text,integer,integer,uuid,text,integer,uuid
) to service_role;
grant execute on function public.renew_ideation_scoring_lease(uuid,text,integer) to service_role;
grant execute on function public.persist_ideation_score_batch(uuid,text,jsonb) to service_role;
grant execute on function public.complete_ideation_scoring_run(uuid,text,jsonb,jsonb,uuid) to service_role;
grant execute on function public.fail_ideation_scoring_run(uuid,text,text,text,boolean,jsonb,uuid) to service_role;
