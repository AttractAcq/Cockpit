-- Ideation Stage 3: proposed Calendar generation, review, and approval.
--
-- This migration creates no link, trigger, or write path to the operational
-- Calendar, any content master, production brief, asset, distribution, or render
-- lifecycle. An approved proposal is advisory and Ideation-owned: approval is
-- explicitly NOT a commit. Stage 4 will read these rows; it is not implemented.
--
-- Frozen boundaries preserved:
-- - public.calendar_cells, public.organic_master, public.story_master, and
--   public.ads_master are read-only to Stage 3 and are not altered here;
-- - public.client_context_files and public.client_execution_files are read-only;
-- - neither public.playbooks nor public.playbook_runs is altered or queried;
-- - Stage 1 and Stage 2 tables are not restructured. The single additive change
--   to a Stage 2 table is one composite unique constraint on
--   public.client_ideation_candidate_scores, required so a proposal slot can
--   carry a composite ownership foreign key to the score. (id) is already the
--   primary key, so the constraint adds an index and changes no behaviour.

alter table public.client_ideation_candidate_scores
  add constraint client_ideation_candidate_scores_id_run_key
  unique (id, scoring_run_id);

create table public.client_ideation_calendar_proposals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ideation_cycle_id uuid not null,
  scoring_run_id uuid not null,
  status text not null default 'running',
  proposal_version integer not null default 1,
  supersedes_proposal_id uuid,
  idempotency_key text not null,
  configuration_hash text not null,
  configuration_snapshot jsonb not null default '{}'::jsonb,
  authority_snapshot jsonb not null default '{}'::jsonb,
  candidate_snapshot jsonb not null default '[]'::jsonb,
  scoring_snapshot jsonb not null default '{}'::jsonb,
  slot_manifest_snapshot jsonb not null default '[]'::jsonb,
  calendar_conflict_snapshot jsonb not null default '{}'::jsonb,
  calendar_conflict_digest text not null,
  slot_planner_version text not null,
  prompt_digest text not null,
  provider text not null,
  model text not null,
  output_schema_version text not null,
  module_version text not null,
  period_start date not null,
  period_end date not null,
  expected_slot_count integer not null,
  assigned_slot_count integer not null default 0,
  unassigned_candidate_count integer not null default 0,
  conflict_count integer not null default 0,
  unresolved_conflict_count integer not null default 0,
  attempt_count integer not null default 1,
  maximum_attempts integer not null default 3,
  retryable boolean not null default false,
  warnings jsonb not null default '[]'::jsonb,
  failure_code text,
  failure_message text,
  lease_owner text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  edit_revision integer not null default 0,
  generated_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  failed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_ideation_calendar_proposals_status_check
    check (status in ('running','retryable','failed','draft','approved','superseded')),
  constraint client_ideation_calendar_proposals_version_check
    check (proposal_version >= 1),
  constraint client_ideation_calendar_proposals_idempotency_check
    check (length(idempotency_key) between 1 and 160),
  constraint client_ideation_calendar_proposals_hash_check
    check (configuration_hash ~ '^[0-9a-f]{64}$'
      and calendar_conflict_digest ~ '^[0-9a-f]{64}$'
      and prompt_digest ~ '^[0-9a-f]{64}$'),
  constraint client_ideation_calendar_proposals_provenance_check
    check (length(provider) between 1 and 100 and length(model) between 1 and 200
      and length(slot_planner_version) between 1 and 100
      and length(output_schema_version) between 1 and 100
      and length(module_version) between 1 and 100),
  constraint client_ideation_calendar_proposals_snapshot_check
    check (jsonb_typeof(configuration_snapshot) = 'object'
      and jsonb_typeof(authority_snapshot) = 'object'
      and jsonb_typeof(candidate_snapshot) = 'array'
      and jsonb_typeof(scoring_snapshot) = 'object'
      and jsonb_typeof(slot_manifest_snapshot) = 'array'
      and jsonb_typeof(calendar_conflict_snapshot) = 'object'
      and jsonb_typeof(warnings) = 'array'),
  constraint client_ideation_calendar_proposals_period_check
    check (period_end >= period_start and period_end - period_start between 0 and 30),
  constraint client_ideation_calendar_proposals_counts_check
    check (expected_slot_count >= 1
      and assigned_slot_count between 0 and expected_slot_count
      and unassigned_candidate_count >= 0
      and conflict_count >= 0
      and unresolved_conflict_count >= 0
      and unresolved_conflict_count <= conflict_count),
  constraint client_ideation_calendar_proposals_manifest_length_check
    check (jsonb_array_length(slot_manifest_snapshot) = expected_slot_count),
  constraint client_ideation_calendar_proposals_attempts_check
    check (attempt_count >= 1 and maximum_attempts between 1 and 10
      and attempt_count <= maximum_attempts),
  constraint client_ideation_calendar_proposals_edit_revision_check
    check (edit_revision >= 0),
  constraint client_ideation_calendar_proposals_lease_check
    check ((status = 'running' and lease_owner is not null and lease_expires_at is not null
        and last_heartbeat_at is not null)
      or (status <> 'running' and lease_owner is null and lease_expires_at is null)),
  -- Reaching draft requires a completed generation pass. A draft may then hold
  -- an unassigned candidate: removing one to the unassigned pool is a supported
  -- operator edit, and full assignment is re-enforced at approval.
  constraint client_ideation_calendar_proposals_draft_check
    check (status not in ('draft','approved','superseded') or generated_at is not null),
  -- Approval requires every slot filled, no candidate left over, and every
  -- conflict resolved.
  constraint client_ideation_calendar_proposals_approved_check
    check (status <> 'approved'
      or (approved_at is not null and approved_by is not null
        and assigned_slot_count = expected_slot_count
        and unassigned_candidate_count = 0
        and unresolved_conflict_count = 0)),
  constraint client_ideation_calendar_proposals_unapproved_check
    check (status in ('approved','superseded') or approved_at is null),
  constraint client_ideation_calendar_proposals_failed_check
    check ((status = 'failed' and failed_at is not null)
      or (status <> 'failed' and failed_at is null)),
  constraint client_ideation_calendar_proposals_retryable_check
    check (not (status in ('draft','approved','superseded') and retryable)),
  constraint client_ideation_calendar_proposals_no_self_supersede_check
    check (supersedes_proposal_id is null or supersedes_proposal_id <> id),
  constraint client_ideation_calendar_proposals_client_idempotency_key
    unique (client_id, idempotency_key),
  constraint client_ideation_calendar_proposals_id_client_key
    unique (id, client_id),
  constraint client_ideation_calendar_proposals_id_cycle_client_key
    unique (id, ideation_cycle_id, client_id),
  constraint client_ideation_calendar_proposals_cycle_client_fk
    foreign key (ideation_cycle_id, client_id)
    references public.client_ideation_cycles(id, client_id) on delete cascade,
  constraint client_ideation_calendar_proposals_scoring_run_fk
    foreign key (scoring_run_id, ideation_cycle_id, client_id)
    references public.client_ideation_scoring_runs(id, ideation_cycle_id, client_id)
    on delete cascade,
  constraint client_ideation_calendar_proposals_supersedes_fk
    foreign key (supersedes_proposal_id, client_id)
    references public.client_ideation_calendar_proposals(id, client_id) on delete set null
);

create index client_ideation_calendar_proposals_client_created_idx
  on public.client_ideation_calendar_proposals (client_id, created_at desc);
create index client_ideation_calendar_proposals_cycle_created_idx
  on public.client_ideation_calendar_proposals (ideation_cycle_id, created_at desc);
create index client_ideation_calendar_proposals_scoring_run_idx
  on public.client_ideation_calendar_proposals (scoring_run_id, created_at desc);
create trigger client_ideation_calendar_proposals_updated_at
  before update on public.client_ideation_calendar_proposals
  for each row execute function public.set_updated_at();

comment on table public.client_ideation_calendar_proposals is
  'Stage 3 proposed Calendar. Advisory and Ideation-owned: approval is not a commit and creates no operational Calendar or master row.';

create table public.client_ideation_calendar_proposal_slots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  proposal_id uuid not null,
  ideation_cycle_id uuid not null,
  scoring_run_id uuid not null,
  proposal_slot_key text not null,
  proposed_date date not null,
  period_start date not null,
  period_end date not null,
  date_slot_ordinal integer not null,
  required_asset_type text not null,
  calendar_row_type text not null,
  placement_basis text not null,
  candidate_id uuid,
  candidate_score_id uuid,
  candidate_asset_type_snapshot text,
  candidate_content_hash text,
  candidate_rank_snapshot integer,
  candidate_score_snapshot integer,
  candidate_display_reference text,
  placement_rationale text,
  authority_references jsonb not null default '[]'::jsonb,
  evidence_references jsonb not null default '[]'::jsonb,
  slot_warnings jsonb not null default '[]'::jsonb,
  conflict_status text not null default 'clear',
  conflict_details jsonb not null default '{}'::jsonb,
  placement_source text,
  manually_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_ideation_proposal_slots_asset_type_check
    check (required_asset_type in ('reel','carousel','static','story')),
  constraint client_ideation_proposal_slots_row_type_check
    check (calendar_row_type in ('reel','carousels','feed_posts','stories')),
  constraint client_ideation_proposal_slots_basis_check
    check (placement_basis in ('execution_cadence','deterministic_spread')),
  constraint client_ideation_proposal_slots_ordinal_check
    check (date_slot_ordinal >= 1),
  constraint client_ideation_proposal_slots_period_check
    check (period_end >= period_start and proposed_date between period_start and period_end),
  constraint client_ideation_proposal_slots_conflict_check
    check (conflict_status in ('clear','occupied','protected','date_capacity_exceeded','stale_calendar_snapshot')),
  constraint client_ideation_proposal_slots_conflict_details_check
    check (jsonb_typeof(conflict_details) = 'object'),
  constraint client_ideation_proposal_slots_arrays_check
    check (jsonb_typeof(authority_references) = 'array'
      and jsonb_typeof(evidence_references) = 'array'
      and jsonb_typeof(slot_warnings) = 'array'),
  constraint client_ideation_proposal_slots_source_check
    check (placement_source is null or placement_source in ('model','manual','restored')),
  constraint client_ideation_proposal_slots_rationale_check
    check (placement_rationale is null or length(placement_rationale) between 1 and 600),
  -- An assigned slot carries its full immutable placement provenance; an empty
  -- slot carries none of it. There is no half-assigned state.
  constraint client_ideation_proposal_slots_assignment_check
    check (
      (candidate_id is null and candidate_score_id is null
        and candidate_asset_type_snapshot is null and candidate_content_hash is null
        and candidate_rank_snapshot is null and candidate_score_snapshot is null
        and candidate_display_reference is null and placement_source is null)
      or
      (candidate_id is not null and candidate_score_id is not null
        and candidate_asset_type_snapshot is not null and candidate_content_hash is not null
        and candidate_rank_snapshot is not null and candidate_score_snapshot is not null
        and candidate_display_reference is not null and placement_source is not null)
    ),
  -- A candidate may only occupy a slot requiring its own asset type.
  constraint client_ideation_proposal_slots_asset_match_check
    check (candidate_asset_type_snapshot is null
      or candidate_asset_type_snapshot = required_asset_type),
  constraint client_ideation_proposal_slots_hash_check
    check (candidate_content_hash is null or candidate_content_hash ~ '^[0-9a-f]{64}$'),
  constraint client_ideation_proposal_slots_score_check
    check ((candidate_rank_snapshot is null or candidate_rank_snapshot >= 1)
      and (candidate_score_snapshot is null or candidate_score_snapshot between 0 and 100)),
  constraint client_ideation_proposal_slots_display_ref_check
    check (candidate_display_reference is null
      or candidate_display_reference like 'IDEATION/%'),
  constraint client_ideation_proposal_slots_proposal_key
    unique (proposal_id, proposal_slot_key),
  constraint client_ideation_proposal_slots_proposal_candidate_key
    unique (proposal_id, candidate_id),
  constraint client_ideation_proposal_slots_proposal_cycle_client_fk
    foreign key (proposal_id, ideation_cycle_id, client_id)
    references public.client_ideation_calendar_proposals(id, ideation_cycle_id, client_id)
    on delete cascade,
  constraint client_ideation_proposal_slots_candidate_cycle_client_fk
    foreign key (candidate_id, ideation_cycle_id, client_id)
    references public.client_ideation_candidates(id, ideation_cycle_id, client_id)
    on delete restrict,
  constraint client_ideation_proposal_slots_score_run_fk
    foreign key (candidate_score_id, scoring_run_id)
    references public.client_ideation_candidate_scores(id, scoring_run_id)
    on delete restrict
);

create index client_ideation_proposal_slots_proposal_date_idx
  on public.client_ideation_calendar_proposal_slots (proposal_id, proposed_date, date_slot_ordinal);
create index client_ideation_proposal_slots_client_idx
  on public.client_ideation_calendar_proposal_slots (client_id, created_at desc);
create index client_ideation_proposal_slots_candidate_idx
  on public.client_ideation_calendar_proposal_slots (candidate_id);
create trigger client_ideation_calendar_proposal_slots_updated_at
  before update on public.client_ideation_calendar_proposal_slots
  for each row execute function public.set_updated_at();

comment on table public.client_ideation_calendar_proposal_slots is
  'Stage 3 proposed placement. Dates, asset types, conflicts, and ranks are server-owned; an empty slot means the candidate is in the unassigned pool.';

alter table public.client_ideation_calendar_proposals enable row level security;
alter table public.client_ideation_calendar_proposal_slots enable row level security;

revoke all on public.client_ideation_calendar_proposals from public, anon, authenticated;
revoke all on public.client_ideation_calendar_proposal_slots from public, anon, authenticated;
grant select on public.client_ideation_calendar_proposals to authenticated;
grant select on public.client_ideation_calendar_proposal_slots to authenticated;
grant all on public.client_ideation_calendar_proposals to service_role;
grant all on public.client_ideation_calendar_proposal_slots to service_role;

create policy client_ideation_calendar_proposals_select
  on public.client_ideation_calendar_proposals for select to authenticated
  using (client_id = any(public.auth_client_ids()));
create policy client_ideation_calendar_proposal_slots_select
  on public.client_ideation_calendar_proposal_slots for select to authenticated
  using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- Shared helper: recompute derived proposal counters from its slot rows.
-- ---------------------------------------------------------------------------
create or replace function public.recount_ideation_proposal(p_proposal_id uuid)
returns public.client_ideation_calendar_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_assigned integer;
  v_conflicts integer;
  v_unresolved integer;
begin
  select count(*) filter (where candidate_id is not null),
         count(*) filter (where conflict_status <> 'clear'),
         count(*) filter (where conflict_status in ('protected','date_capacity_exceeded','stale_calendar_snapshot'))
  into v_assigned, v_conflicts, v_unresolved
  from public.client_ideation_calendar_proposal_slots
  where proposal_id = p_proposal_id;

  update public.client_ideation_calendar_proposals
  set assigned_slot_count = coalesce(v_assigned, 0),
      unassigned_candidate_count = expected_slot_count - coalesce(v_assigned, 0),
      conflict_count = coalesce(v_conflicts, 0),
      unresolved_conflict_count = coalesce(v_unresolved, 0)
  where id = p_proposal_id
  returning * into v_proposal;
  return v_proposal;
end
$$;

-- ---------------------------------------------------------------------------
-- Generation lifecycle.
-- ---------------------------------------------------------------------------
create or replace function public.begin_ideation_calendar_proposal(
  p_client_id uuid,
  p_ideation_cycle_id uuid,
  p_scoring_run_id uuid,
  p_idempotency_key text,
  p_configuration_hash text,
  p_configuration_snapshot jsonb,
  p_authority_snapshot jsonb,
  p_candidate_snapshot jsonb,
  p_scoring_snapshot jsonb,
  p_slot_manifest jsonb,
  p_calendar_conflict_snapshot jsonb,
  p_calendar_conflict_digest text,
  p_slot_planner_version text,
  p_prompt_digest text,
  p_provider text,
  p_model text,
  p_output_schema_version text,
  p_module_version text,
  p_period_start date,
  p_period_end date,
  p_expected_slot_count integer,
  p_maximum_attempts integer,
  p_supersedes_proposal_id uuid,
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
  v_scoring public.client_ideation_scoring_runs%rowtype;
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_inserted_id uuid;
  v_item jsonb;
  v_version integer := 1;
begin
  if length(trim(p_lease_owner)) < 8 or p_lease_seconds not between 60 and 600 then
    raise exception 'LEASE_CONFIGURATION_INVALID';
  end if;
  if p_maximum_attempts is null or p_maximum_attempts not between 1 and 10 then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end if;
  if p_expected_slot_count is null or p_expected_slot_count < 1 then
    raise exception 'PROPOSAL_EXPECTATION_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_slot_manifest, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_slot_manifest) <> p_expected_slot_count then
    raise exception 'SLOT_MANIFEST_INVALID';
  end if;

  select * into v_cycle from public.client_ideation_cycles
  where id = p_ideation_cycle_id for share;
  if v_cycle.id is null then raise exception 'CYCLE_NOT_FOUND'; end if;
  if v_cycle.client_id <> p_client_id then raise exception 'CYCLE_CLIENT_MISMATCH'; end if;
  if v_cycle.status <> 'completed' or v_cycle.shortfall_count <> 0
    or v_cycle.candidate_count <> v_cycle.expected_candidate_count
    or v_cycle.expected_candidate_count <> p_expected_slot_count then
    raise exception 'CYCLE_NOT_ELIGIBLE';
  end if;
  if v_cycle.period_start <> p_period_start or v_cycle.period_end <> p_period_end then
    raise exception 'PERIOD_MISMATCH';
  end if;

  select * into v_scoring from public.client_ideation_scoring_runs
  where id = p_scoring_run_id for share;
  if v_scoring.id is null then raise exception 'SCORING_RUN_NOT_FOUND'; end if;
  if v_scoring.client_id <> p_client_id then raise exception 'SCORING_RUN_CLIENT_MISMATCH'; end if;
  if v_scoring.ideation_cycle_id <> p_ideation_cycle_id then raise exception 'SCORING_RUN_CYCLE_MISMATCH'; end if;
  if v_scoring.status <> 'completed'
    or v_scoring.failed_candidate_count <> 0
    or v_scoring.scored_candidate_count <> v_scoring.expected_candidate_count then
    raise exception 'SCORING_RUN_NOT_ELIGIBLE';
  end if;

  if p_supersedes_proposal_id is not null then
    select coalesce(max(proposal_version), 0) + 1 into v_version
    from public.client_ideation_calendar_proposals
    where ideation_cycle_id = p_ideation_cycle_id and client_id = p_client_id;
    perform 1 from public.client_ideation_calendar_proposals
    where id = p_supersedes_proposal_id and client_id = p_client_id
      and ideation_cycle_id = p_ideation_cycle_id
      and status in ('draft','approved');
    if not found then raise exception 'REGENERATE_PREDECESSOR_INVALID'; end if;
  end if;

  insert into public.client_ideation_calendar_proposals (
    client_id, ideation_cycle_id, scoring_run_id, proposal_version, supersedes_proposal_id,
    idempotency_key, configuration_hash, configuration_snapshot, authority_snapshot,
    candidate_snapshot, scoring_snapshot, slot_manifest_snapshot,
    calendar_conflict_snapshot, calendar_conflict_digest, slot_planner_version,
    prompt_digest, provider, model, output_schema_version, module_version,
    period_start, period_end, expected_slot_count, unassigned_candidate_count,
    maximum_attempts, created_by, lease_owner, lease_expires_at, last_heartbeat_at
  ) values (
    p_client_id, p_ideation_cycle_id, p_scoring_run_id, v_version, p_supersedes_proposal_id,
    p_idempotency_key, p_configuration_hash, p_configuration_snapshot, p_authority_snapshot,
    p_candidate_snapshot, p_scoring_snapshot, p_slot_manifest,
    p_calendar_conflict_snapshot, p_calendar_conflict_digest, p_slot_planner_version,
    p_prompt_digest, p_provider, p_model, p_output_schema_version, p_module_version,
    p_period_start, p_period_end, p_expected_slot_count, p_expected_slot_count,
    p_maximum_attempts, p_actor_id, p_lease_owner,
    now() + make_interval(secs => p_lease_seconds), now()
  )
  on conflict (client_id, idempotency_key) do nothing
  returning id into v_inserted_id;

  select * into v_proposal from public.client_ideation_calendar_proposals
  where client_id = p_client_id and idempotency_key = p_idempotency_key for update;
  if v_proposal.configuration_hash <> p_configuration_hash then
    raise exception using errcode = '23505', message = 'PROPOSAL_IDEMPOTENCY_CONFLICT';
  end if;

  if v_inserted_id is not null then
    -- Materialise every planned slot immediately, unassigned. The manifest is
    -- server-owned from this point: the model can only fill these rows.
    for v_item in select value from jsonb_array_elements(p_slot_manifest)
    loop
      insert into public.client_ideation_calendar_proposal_slots (
        client_id, proposal_id, ideation_cycle_id, scoring_run_id,
        proposal_slot_key, proposed_date, period_start, period_end,
        date_slot_ordinal, required_asset_type, calendar_row_type, placement_basis,
        conflict_status, conflict_details
      ) values (
        p_client_id, v_proposal.id, p_ideation_cycle_id, p_scoring_run_id,
        v_item->>'proposal_slot_key', (v_item->>'proposed_date')::date,
        p_period_start, p_period_end,
        (v_item->>'date_slot_ordinal')::integer, v_item->>'required_asset_type',
        v_item->>'calendar_row_type', v_item->>'placement_basis',
        coalesce(v_item->>'conflict_status', 'clear'),
        coalesce(v_item->'conflict_details', '{}'::jsonb)
      );
    end loop;
    perform public.recount_ideation_proposal(v_proposal.id);
    select * into v_proposal from public.client_ideation_calendar_proposals where id = v_proposal.id;
    insert into public.activity_log (
      client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
    ) values (
      p_client_id, p_actor_id, 'ideation_calendar_proposal_started',
      'A proposed Ideation Calendar was started.',
      'client_ideation_calendar_proposal', v_proposal.id::text,
      jsonb_build_object('ideation_cycle_id', p_ideation_cycle_id, 'scoring_run_id', p_scoring_run_id,
        'expected_slots', p_expected_slot_count, 'proposal_version', v_proposal.proposal_version)
    );
    return jsonb_build_object('created', true, 'reclaimed', false, 'proposal', to_jsonb(v_proposal));
  end if;

  if v_proposal.status in ('draft','approved','failed','superseded') then
    return jsonb_build_object('created', false, 'reclaimed', false, 'proposal', to_jsonb(v_proposal));
  end if;
  if v_proposal.status = 'running' and v_proposal.lease_expires_at > now() then
    return jsonb_build_object('created', false, 'reclaimed', false, 'proposal', to_jsonb(v_proposal));
  end if;
  if v_proposal.status not in ('running','retryable') then
    raise exception 'PROPOSAL_STATE_INVALID';
  end if;
  if v_proposal.attempt_count >= v_proposal.maximum_attempts then
    update public.client_ideation_calendar_proposals
    set status = 'failed', retryable = false,
        failure_code = 'PROPOSAL_ATTEMPTS_EXHAUSTED',
        failure_message = 'The configured proposal attempt limit was exhausted.',
        failed_at = now(), lease_owner = null, lease_expires_at = null
    where id = v_proposal.id returning * into v_proposal;
    return jsonb_build_object('created', false, 'reclaimed', false,
      'attempts_exhausted', true, 'proposal', to_jsonb(v_proposal));
  end if;

  update public.client_ideation_calendar_proposals
  set status = 'running', retryable = false, attempt_count = attempt_count + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_heartbeat_at = now(), failure_code = null, failure_message = null, failed_at = null
  where id = v_proposal.id returning * into v_proposal;
  return jsonb_build_object('created', true, 'reclaimed', true, 'proposal', to_jsonb(v_proposal));
end
$$;

create or replace function public.renew_ideation_proposal_lease(
  p_proposal_id uuid, p_lease_owner text, p_lease_seconds integer
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_proposal public.client_ideation_calendar_proposals%rowtype;
begin
  if p_lease_seconds not between 60 and 600 then raise exception 'LEASE_CONFIGURATION_INVALID'; end if;
  update public.client_ideation_calendar_proposals
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds), last_heartbeat_at = now()
  where id = p_proposal_id and status = 'running'
    and lease_owner = p_lease_owner and lease_expires_at > now()
  returning * into v_proposal;
  if v_proposal.id is null then raise exception 'PROPOSAL_LEASE_OWNERSHIP_LOST'; end if;
  return to_jsonb(v_proposal);
end
$$;

create or replace function public.persist_ideation_proposal_batch(
  p_proposal_id uuid, p_lease_owner text, p_assignments jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_item jsonb;
  v_candidate public.client_ideation_candidates%rowtype;
  v_score public.client_ideation_candidate_scores%rowtype;
  v_slot public.client_ideation_calendar_proposal_slots%rowtype;
  v_snapshot jsonb;
  v_applied integer := 0;
begin
  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id for update;
  if v_proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.status <> 'running' or v_proposal.lease_owner <> p_lease_owner
    or v_proposal.lease_expires_at <= now() then
    raise exception 'PROPOSAL_LEASE_OWNERSHIP_LOST';
  end if;
  if jsonb_typeof(coalesce(p_assignments, 'null'::jsonb)) <> 'array' then
    raise exception 'PROPOSAL_BATCH_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_assignments)
  loop
    select * into v_slot from public.client_ideation_calendar_proposal_slots
    where proposal_id = v_proposal.id and proposal_slot_key = v_item->>'proposal_slot_key';
    if v_slot.id is null then raise exception 'PROPOSAL_SLOT_NOT_FOUND'; end if;
    if v_slot.candidate_id is not null then raise exception 'PROPOSAL_SLOT_ALREADY_OCCUPIED'; end if;

    select * into v_candidate from public.client_ideation_candidates
    where id = (v_item->>'candidate_id')::uuid;
    if v_candidate.id is null then raise exception 'PROPOSAL_CANDIDATE_NOT_FOUND'; end if;
    if v_candidate.client_id <> v_proposal.client_id then raise exception 'PROPOSAL_CANDIDATE_CLIENT_MISMATCH'; end if;
    if v_candidate.ideation_cycle_id <> v_proposal.ideation_cycle_id then
      raise exception 'PROPOSAL_CANDIDATE_CYCLE_MISMATCH';
    end if;
    if v_candidate.asset_type <> v_slot.required_asset_type then
      raise exception 'PROPOSAL_ASSET_TYPE_INCOMPATIBLE';
    end if;

    select * into v_score from public.client_ideation_candidate_scores
    where scoring_run_id = v_proposal.scoring_run_id and candidate_id = v_candidate.id;
    if v_score.id is null then raise exception 'PROPOSAL_SCORE_NOT_FOUND'; end if;

    -- The candidate must still be the exact proposal input the run began with.
    select value into v_snapshot from jsonb_array_elements(v_proposal.candidate_snapshot)
    where value->>'candidate_id' = v_item->>'candidate_id';
    if v_snapshot is null then raise exception 'PROPOSAL_CANDIDATE_NOT_IN_SNAPSHOT'; end if;
    if v_snapshot->>'content_hash' <> v_score.candidate_content_hash then
      raise exception 'PROPOSAL_CANDIDATE_HASH_MISMATCH';
    end if;
    if (v_snapshot->>'rank')::integer is distinct from v_score.rank
      or (v_snapshot->>'overall_score')::integer is distinct from v_score.overall_score then
      raise exception 'PROPOSAL_SCORE_DRIFTED';
    end if;

    update public.client_ideation_calendar_proposal_slots
    set candidate_id = v_candidate.id,
        candidate_score_id = v_score.id,
        candidate_asset_type_snapshot = v_candidate.asset_type,
        candidate_content_hash = v_score.candidate_content_hash,
        candidate_rank_snapshot = v_score.rank,
        candidate_score_snapshot = v_score.overall_score,
        candidate_display_reference = v_item->>'candidate_display_reference',
        placement_rationale = v_item->>'placement_rationale',
        authority_references = coalesce(v_item->'authority_references', '[]'::jsonb),
        evidence_references = coalesce(v_item->'evidence_references', '[]'::jsonb),
        slot_warnings = coalesce(v_item->'warnings', '[]'::jsonb),
        placement_source = 'model'
    where id = v_slot.id;
    v_applied := v_applied + 1;
  end loop;

  v_proposal := public.recount_ideation_proposal(v_proposal.id);
  return jsonb_build_object('applied', v_applied, 'proposal', to_jsonb(v_proposal));
end
$$;

create or replace function public.complete_ideation_calendar_proposal(
  p_proposal_id uuid, p_lease_owner text, p_warnings jsonb, p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_expected uuid[];
  v_assigned uuid[];
  v_slot_keys integer;
begin
  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id for update;
  if v_proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.status <> 'running' or v_proposal.lease_owner <> p_lease_owner
    or v_proposal.lease_expires_at <= now() then
    raise exception 'PROPOSAL_LEASE_OWNERSHIP_LOST';
  end if;

  -- Exact reconciliation, never an aggregate count.
  select array_agg((value->>'candidate_id')::uuid order by value->>'candidate_id')
  into v_expected from jsonb_array_elements(v_proposal.candidate_snapshot);
  select array_agg(candidate_id order by candidate_id)
  into v_assigned from public.client_ideation_calendar_proposal_slots
  where proposal_id = v_proposal.id and candidate_id is not null;
  if v_expected is distinct from v_assigned then
    raise exception 'PROPOSAL_CANDIDATE_RECONCILIATION_FAILED';
  end if;

  select count(*) into v_slot_keys from public.client_ideation_calendar_proposal_slots
  where proposal_id = v_proposal.id;
  if v_slot_keys <> v_proposal.expected_slot_count then raise exception 'PROPOSAL_SLOT_RECONCILIATION_FAILED'; end if;
  if exists (select 1 from public.client_ideation_calendar_proposal_slots
             where proposal_id = v_proposal.id and candidate_id is null) then
    raise exception 'PROPOSAL_INCOMPLETE';
  end if;

  update public.client_ideation_calendar_proposals
  set status = 'draft', retryable = false, warnings = coalesce(p_warnings, '[]'::jsonb),
      failure_code = null, failure_message = null, failed_at = null,
      generated_at = now(), lease_owner = null, lease_expires_at = null
  where id = v_proposal.id returning * into v_proposal;
  v_proposal := public.recount_ideation_proposal(v_proposal.id);

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    v_proposal.client_id, p_actor_id, 'ideation_calendar_proposal_drafted',
    'A proposed Ideation Calendar is ready for review.',
    'client_ideation_calendar_proposal', v_proposal.id::text,
    jsonb_build_object('assigned_slots', v_proposal.assigned_slot_count,
      'conflicts', v_proposal.conflict_count, 'unresolved', v_proposal.unresolved_conflict_count)
  );
  return to_jsonb(v_proposal);
end
$$;

create or replace function public.fail_ideation_calendar_proposal(
  p_proposal_id uuid, p_lease_owner text, p_failure_code text, p_failure_message text,
  p_retryable boolean, p_warnings jsonb, p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_retryable boolean;
begin
  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id for update;
  if v_proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.status <> 'running' or v_proposal.lease_owner <> p_lease_owner
    or v_proposal.lease_expires_at <= now() then
    raise exception 'PROPOSAL_LEASE_OWNERSHIP_LOST';
  end if;
  v_retryable := coalesce(p_retryable, false) and v_proposal.attempt_count < v_proposal.maximum_attempts;

  update public.client_ideation_calendar_proposals
  set status = case when v_retryable then 'retryable' else 'failed' end,
      retryable = v_retryable, warnings = coalesce(p_warnings, '[]'::jsonb),
      failure_code = p_failure_code, failure_message = left(p_failure_message, 2000),
      failed_at = case when v_retryable then null else now() end,
      lease_owner = null, lease_expires_at = null
  where id = v_proposal.id returning * into v_proposal;
  v_proposal := public.recount_ideation_proposal(v_proposal.id);

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    v_proposal.client_id, p_actor_id,
    case when v_retryable then 'ideation_calendar_proposal_retryable' else 'ideation_calendar_proposal_failed' end,
    'Proposed Ideation Calendar did not complete: ' || left(coalesce(p_failure_message, 'unknown'), 500),
    'client_ideation_calendar_proposal', v_proposal.id::text,
    jsonb_build_object('failure_code', p_failure_code, 'attempt_count', v_proposal.attempt_count)
  );
  return to_jsonb(v_proposal);
end
$$;

-- ---------------------------------------------------------------------------
-- Manual editing. Every edit is optimistic-concurrency guarded and logged.
-- ---------------------------------------------------------------------------
create or replace function public.edit_ideation_proposal_assignment(
  p_proposal_id uuid,
  p_client_id uuid,
  p_action text,
  p_from_slot_key text,
  p_to_slot_key text,
  p_candidate_id uuid,
  p_expected_edit_revision integer,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_from public.client_ideation_calendar_proposal_slots%rowtype;
  v_to public.client_ideation_calendar_proposal_slots%rowtype;
  v_candidate public.client_ideation_candidates%rowtype;
  v_score public.client_ideation_candidate_scores%rowtype;
begin
  if p_action not in ('move','swap','unassign','assign') then
    raise exception 'PROPOSAL_EDIT_ACTION_INVALID';
  end if;
  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id for update;
  if v_proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.client_id <> p_client_id then raise exception 'PROPOSAL_CLIENT_MISMATCH'; end if;
  if v_proposal.status <> 'draft' then raise exception 'PROPOSAL_NOT_EDITABLE'; end if;
  if v_proposal.edit_revision <> p_expected_edit_revision then
    raise exception 'PROPOSAL_EDIT_REVISION_CONFLICT';
  end if;

  if p_action in ('move','swap','unassign') then
    select * into v_from from public.client_ideation_calendar_proposal_slots
    where proposal_id = v_proposal.id and proposal_slot_key = p_from_slot_key for update;
    if v_from.id is null then raise exception 'PROPOSAL_SLOT_NOT_FOUND'; end if;
    if v_from.candidate_id is null then raise exception 'PROPOSAL_CANDIDATE_NOT_ASSIGNED'; end if;
  end if;
  if p_action in ('move','swap','assign') then
    select * into v_to from public.client_ideation_calendar_proposal_slots
    where proposal_id = v_proposal.id and proposal_slot_key = p_to_slot_key for update;
    if v_to.id is null then raise exception 'PROPOSAL_SLOT_NOT_FOUND'; end if;
  end if;

  if p_action = 'move' then
    -- Type incompatibility is reported before occupancy: it is the more
    -- fundamental reason the move can never succeed.
    if v_from.candidate_asset_type_snapshot <> v_to.required_asset_type then
      raise exception 'PROPOSAL_ASSET_TYPE_INCOMPATIBLE';
    end if;
    if v_to.candidate_id is not null then raise exception 'PROPOSAL_SLOT_ALREADY_OCCUPIED'; end if;
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = v_from.candidate_id, candidate_score_id = v_from.candidate_score_id,
      candidate_asset_type_snapshot = v_from.candidate_asset_type_snapshot,
      candidate_content_hash = v_from.candidate_content_hash,
      candidate_rank_snapshot = v_from.candidate_rank_snapshot,
      candidate_score_snapshot = v_from.candidate_score_snapshot,
      candidate_display_reference = v_from.candidate_display_reference,
      placement_rationale = v_from.placement_rationale,
      authority_references = v_from.authority_references,
      evidence_references = v_from.evidence_references,
      slot_warnings = v_from.slot_warnings,
      placement_source = 'manual', manually_edited = true
    where id = v_to.id;
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = null, candidate_score_id = null, candidate_asset_type_snapshot = null,
      candidate_content_hash = null, candidate_rank_snapshot = null,
      candidate_score_snapshot = null, candidate_display_reference = null,
      placement_rationale = null, authority_references = '[]'::jsonb,
      evidence_references = '[]'::jsonb, slot_warnings = '[]'::jsonb,
      placement_source = null, manually_edited = true
    where id = v_from.id;

  elsif p_action = 'swap' then
    if v_to.candidate_id is null then raise exception 'PROPOSAL_CANDIDATE_NOT_ASSIGNED'; end if;
    if v_from.candidate_asset_type_snapshot <> v_to.required_asset_type
      or v_to.candidate_asset_type_snapshot <> v_from.required_asset_type then
      raise exception 'PROPOSAL_ASSET_TYPE_INCOMPATIBLE';
    end if;
    -- Park the source slot so the (proposal_id, candidate_id) uniqueness never
    -- transiently collides mid-swap.
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = null, candidate_score_id = null, candidate_asset_type_snapshot = null,
      candidate_content_hash = null, candidate_rank_snapshot = null, candidate_score_snapshot = null,
      candidate_display_reference = null, placement_rationale = null,
      authority_references = '[]'::jsonb, evidence_references = '[]'::jsonb,
      slot_warnings = '[]'::jsonb, placement_source = null
    where id = v_from.id;
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = v_from.candidate_id, candidate_score_id = v_from.candidate_score_id,
      candidate_asset_type_snapshot = v_from.candidate_asset_type_snapshot,
      candidate_content_hash = v_from.candidate_content_hash,
      candidate_rank_snapshot = v_from.candidate_rank_snapshot,
      candidate_score_snapshot = v_from.candidate_score_snapshot,
      candidate_display_reference = v_from.candidate_display_reference,
      placement_rationale = v_from.placement_rationale,
      authority_references = v_from.authority_references,
      evidence_references = v_from.evidence_references,
      slot_warnings = v_from.slot_warnings,
      placement_source = 'manual', manually_edited = true
    where id = v_to.id;
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = v_to.candidate_id, candidate_score_id = v_to.candidate_score_id,
      candidate_asset_type_snapshot = v_to.candidate_asset_type_snapshot,
      candidate_content_hash = v_to.candidate_content_hash,
      candidate_rank_snapshot = v_to.candidate_rank_snapshot,
      candidate_score_snapshot = v_to.candidate_score_snapshot,
      candidate_display_reference = v_to.candidate_display_reference,
      placement_rationale = v_to.placement_rationale,
      authority_references = v_to.authority_references,
      evidence_references = v_to.evidence_references,
      slot_warnings = v_to.slot_warnings,
      placement_source = 'manual', manually_edited = true
    where id = v_from.id;

  elsif p_action = 'unassign' then
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = null, candidate_score_id = null, candidate_asset_type_snapshot = null,
      candidate_content_hash = null, candidate_rank_snapshot = null, candidate_score_snapshot = null,
      candidate_display_reference = null, placement_rationale = null,
      authority_references = '[]'::jsonb, evidence_references = '[]'::jsonb,
      slot_warnings = '[]'::jsonb, placement_source = null, manually_edited = true
    where id = v_from.id;

  else -- assign
    if v_to.candidate_id is not null then raise exception 'PROPOSAL_SLOT_ALREADY_OCCUPIED'; end if;
    if exists (select 1 from public.client_ideation_calendar_proposal_slots
               where proposal_id = v_proposal.id and candidate_id = p_candidate_id) then
      raise exception 'PROPOSAL_CANDIDATE_ALREADY_ASSIGNED';
    end if;
    select * into v_candidate from public.client_ideation_candidates where id = p_candidate_id;
    if v_candidate.id is null then raise exception 'PROPOSAL_CANDIDATE_NOT_FOUND'; end if;
    if v_candidate.client_id <> v_proposal.client_id
      or v_candidate.ideation_cycle_id <> v_proposal.ideation_cycle_id then
      raise exception 'PROPOSAL_CANDIDATE_CLIENT_MISMATCH';
    end if;
    if v_candidate.asset_type <> v_to.required_asset_type then
      raise exception 'PROPOSAL_ASSET_TYPE_INCOMPATIBLE';
    end if;
    select * into v_score from public.client_ideation_candidate_scores
    where scoring_run_id = v_proposal.scoring_run_id and candidate_id = v_candidate.id;
    if v_score.id is null then raise exception 'PROPOSAL_SCORE_NOT_FOUND'; end if;
    update public.client_ideation_calendar_proposal_slots set
      candidate_id = v_candidate.id, candidate_score_id = v_score.id,
      candidate_asset_type_snapshot = v_candidate.asset_type,
      candidate_content_hash = v_score.candidate_content_hash,
      candidate_rank_snapshot = v_score.rank, candidate_score_snapshot = v_score.overall_score,
      candidate_display_reference = coalesce(
        (select value->>'display_reference' from jsonb_array_elements(v_proposal.candidate_snapshot) value
         where value->>'candidate_id' = p_candidate_id::text),
        'IDEATION/restored'),
      placement_rationale = 'Restored to this slot by an operator.',
      authority_references = '[]'::jsonb, evidence_references = '[]'::jsonb,
      slot_warnings = '[]'::jsonb, placement_source = 'restored', manually_edited = true
    where id = v_to.id;
  end if;

  update public.client_ideation_calendar_proposals
  set edit_revision = edit_revision + 1 where id = v_proposal.id;
  v_proposal := public.recount_ideation_proposal(v_proposal.id);

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    v_proposal.client_id, p_actor_id, 'ideation_calendar_proposal_edited',
    'A proposed Ideation Calendar placement was edited (' || p_action || ').',
    'client_ideation_calendar_proposal', v_proposal.id::text,
    jsonb_build_object('action', p_action, 'from_slot', p_from_slot_key,
      'to_slot', p_to_slot_key, 'candidate_id', p_candidate_id,
      'edit_revision', v_proposal.edit_revision)
  );
  return to_jsonb(v_proposal);
end
$$;

create or replace function public.refresh_ideation_proposal_conflicts(
  p_proposal_id uuid, p_client_id uuid, p_conflicts jsonb,
  p_calendar_conflict_snapshot jsonb, p_calendar_conflict_digest text,
  p_expected_edit_revision integer, p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_item jsonb;
begin
  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id for update;
  if v_proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.client_id <> p_client_id then raise exception 'PROPOSAL_CLIENT_MISMATCH'; end if;
  if v_proposal.status <> 'draft' then raise exception 'PROPOSAL_NOT_EDITABLE'; end if;
  if v_proposal.edit_revision <> p_expected_edit_revision then
    raise exception 'PROPOSAL_EDIT_REVISION_CONFLICT';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_conflicts, '[]'::jsonb))
  loop
    update public.client_ideation_calendar_proposal_slots
    set conflict_status = v_item->>'conflict_status',
        conflict_details = coalesce(v_item->'conflict_details', '{}'::jsonb)
    where proposal_id = v_proposal.id and proposal_slot_key = v_item->>'proposal_slot_key';
  end loop;

  update public.client_ideation_calendar_proposals
  set calendar_conflict_snapshot = coalesce(p_calendar_conflict_snapshot, calendar_conflict_snapshot),
      calendar_conflict_digest = coalesce(p_calendar_conflict_digest, calendar_conflict_digest),
      edit_revision = edit_revision + 1
  where id = v_proposal.id;
  v_proposal := public.recount_ideation_proposal(v_proposal.id);

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    v_proposal.client_id, p_actor_id, 'ideation_calendar_proposal_conflicts_refreshed',
    'Proposed Ideation Calendar conflicts were refreshed against current Calendar state.',
    'client_ideation_calendar_proposal', v_proposal.id::text,
    jsonb_build_object('conflicts', v_proposal.conflict_count,
      'unresolved', v_proposal.unresolved_conflict_count, 'edit_revision', v_proposal.edit_revision)
  );
  return to_jsonb(v_proposal);
end
$$;

create or replace function public.approve_ideation_calendar_proposal(
  p_proposal_id uuid, p_client_id uuid, p_expected_edit_revision integer,
  p_current_calendar_digest text, p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_proposal public.client_ideation_calendar_proposals%rowtype;
  v_cycle public.client_ideation_cycles%rowtype;
  v_scoring public.client_ideation_scoring_runs%rowtype;
  v_expected uuid[];
  v_assigned uuid[];
  v_previous uuid;
begin
  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id for update;
  if v_proposal.id is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.client_id <> p_client_id then raise exception 'PROPOSAL_CLIENT_MISMATCH'; end if;
  if v_proposal.status <> 'draft' then raise exception 'PROPOSAL_NOT_APPROVABLE'; end if;
  if v_proposal.edit_revision <> p_expected_edit_revision then
    raise exception 'PROPOSAL_EDIT_REVISION_CONFLICT';
  end if;
  if v_proposal.calendar_conflict_digest <> p_current_calendar_digest then
    raise exception 'PROPOSAL_CALENDAR_SNAPSHOT_STALE';
  end if;

  select * into v_cycle from public.client_ideation_cycles where id = v_proposal.ideation_cycle_id;
  if v_cycle.status <> 'completed' or v_cycle.shortfall_count <> 0 then raise exception 'CYCLE_NOT_ELIGIBLE'; end if;
  select * into v_scoring from public.client_ideation_scoring_runs where id = v_proposal.scoring_run_id;
  if v_scoring.status <> 'completed' or v_scoring.failed_candidate_count <> 0 then
    raise exception 'SCORING_RUN_NOT_ELIGIBLE';
  end if;

  select array_agg((value->>'candidate_id')::uuid order by value->>'candidate_id')
  into v_expected from jsonb_array_elements(v_proposal.candidate_snapshot);
  select array_agg(candidate_id order by candidate_id)
  into v_assigned from public.client_ideation_calendar_proposal_slots
  where proposal_id = v_proposal.id and candidate_id is not null;
  if v_expected is distinct from v_assigned then raise exception 'PROPOSAL_CANDIDATE_RECONCILIATION_FAILED'; end if;

  if exists (select 1 from public.client_ideation_calendar_proposal_slots
             where proposal_id = v_proposal.id and candidate_id is null) then
    raise exception 'PROPOSAL_INCOMPLETE';
  end if;
  if exists (select 1 from public.client_ideation_calendar_proposal_slots
             where proposal_id = v_proposal.id
               and conflict_status in ('protected','date_capacity_exceeded','stale_calendar_snapshot')) then
    raise exception 'PROPOSAL_UNRESOLVED_CONFLICT';
  end if;
  -- Candidate and score drift since generation blocks approval.
  if exists (
    select 1 from public.client_ideation_calendar_proposal_slots slot
    join public.client_ideation_candidate_scores score on score.id = slot.candidate_score_id
    where slot.proposal_id = v_proposal.id
      and (score.candidate_content_hash <> slot.candidate_content_hash
        or score.rank is distinct from slot.candidate_rank_snapshot
        or score.overall_score is distinct from slot.candidate_score_snapshot)
  ) then
    raise exception 'PROPOSAL_CANDIDATE_DRIFTED';
  end if;

  -- Supersede the previously active approved proposal for this cycle.
  select id into v_previous from public.client_ideation_calendar_proposals
  where ideation_cycle_id = v_proposal.ideation_cycle_id and client_id = v_proposal.client_id
    and status = 'approved' and id <> v_proposal.id
  limit 1;
  if v_previous is not null then
    update public.client_ideation_calendar_proposals
    set status = 'superseded' where id = v_previous;
  end if;

  update public.client_ideation_calendar_proposals
  set status = 'approved', approved_at = now(), approved_by = p_actor_id,
      edit_revision = edit_revision + 1
  where id = v_proposal.id returning * into v_proposal;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    v_proposal.client_id, p_actor_id, 'ideation_calendar_proposal_approved',
    'A proposed Ideation Calendar was approved. No operational Calendar or master row was created.',
    'client_ideation_calendar_proposal', v_proposal.id::text,
    jsonb_build_object('proposal_version', v_proposal.proposal_version,
      'superseded_proposal_id', v_previous, 'assigned_slots', v_proposal.assigned_slot_count)
  );
  return to_jsonb(v_proposal);
end
$$;

revoke all on function public.recount_ideation_proposal(uuid) from public, anon, authenticated;
revoke all on function public.begin_ideation_calendar_proposal(
  uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,text,text,text,text,text,date,date,integer,integer,uuid,text,integer,uuid
) from public, anon, authenticated;
revoke all on function public.renew_ideation_proposal_lease(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.persist_ideation_proposal_batch(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.complete_ideation_calendar_proposal(uuid,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.fail_ideation_calendar_proposal(uuid,text,text,text,boolean,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.edit_ideation_proposal_assignment(uuid,uuid,text,text,text,uuid,integer,uuid) from public, anon, authenticated;
revoke all on function public.refresh_ideation_proposal_conflicts(uuid,uuid,jsonb,jsonb,text,integer,uuid) from public, anon, authenticated;
revoke all on function public.approve_ideation_calendar_proposal(uuid,uuid,integer,text,uuid) from public, anon, authenticated;

grant execute on function public.recount_ideation_proposal(uuid) to service_role;
grant execute on function public.begin_ideation_calendar_proposal(
  uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,text,text,text,text,text,date,date,integer,integer,uuid,text,integer,uuid
) to service_role;
grant execute on function public.renew_ideation_proposal_lease(uuid,text,integer) to service_role;
grant execute on function public.persist_ideation_proposal_batch(uuid,text,jsonb) to service_role;
grant execute on function public.complete_ideation_calendar_proposal(uuid,text,jsonb,uuid) to service_role;
grant execute on function public.fail_ideation_calendar_proposal(uuid,text,text,text,boolean,jsonb,uuid) to service_role;
grant execute on function public.edit_ideation_proposal_assignment(uuid,uuid,text,text,text,uuid,integer,uuid) to service_role;
grant execute on function public.refresh_ideation_proposal_conflicts(uuid,uuid,jsonb,jsonb,text,integer,uuid) to service_role;
grant execute on function public.approve_ideation_calendar_proposal(uuid,uuid,integer,text,uuid) to service_role;
