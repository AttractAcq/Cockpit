-- Ideation Stage 4: transactional commit of an approved proposed Calendar into
-- the operational content masters and the operational Calendar.
--
-- Stage 4 is deterministic and has NO AI model call anywhere in its path.
--
-- What this migration deliberately does NOT do:
-- - it does not write, alter, or add a column to public.organic_master,
--   public.story_master, or public.calendar_cells (Stage 4 only INSERTs rows
--   into them at runtime, through the one protected RPC below);
-- - it never touches public.ads_master, paid campaign tables, paid distribution,
--   production briefs, assets, Reel Studio, publishing, or analytics;
-- - it does not restructure Stage 1, Stage 2, or Stage 3. The single additive
--   change to a Stage 3 table is one composite unique constraint on
--   public.client_ideation_calendar_proposal_slots, needed so a commit item can
--   carry a composite ownership foreign key to its slot. (id) is already the
--   primary key, so the constraint adds an index and changes no behaviour;
-- - it does not modify Phase 1, Phase 2, or Phase 3 behaviour. Stage 4 REUSES
--   the existing canonical allocator public.allocate_phase3_ref unchanged;
-- - it implements no part of Stage 5.

alter table public.client_ideation_calendar_proposal_slots
  add constraint client_ideation_proposal_slots_id_proposal_key
  unique (id, proposal_id);


-- ---------------------------------------------------------------------------
-- Target manifest: aa.ideation.commit-targets.v1
--
-- The executable half of the code-owned manifest in
-- supabase/functions/_shared/ideation/commit/targets.ts. A Stage 4 test parses
-- the VALUES rows below and asserts they match the TypeScript manifest exactly,
-- so the two cannot drift apart silently.
--
-- Story is the only asset type that targets story_master and is never coerced
-- into organic_master. No asset type maps to ads_master; 'AD' is not present.
-- ---------------------------------------------------------------------------
create or replace function public.ideation_commit_target(p_asset_type text)
returns table (type_code text, master_table text, calendar_row_type text)
language sql
immutable
set search_path = public
as $$
  select t.type_code, t.master_table, t.calendar_row_type
  from (values
    ('reel',     'RL', 'organic_master', 'reel'),
    ('carousel', 'CR', 'organic_master', 'carousels'),
    ('static',   'FP', 'organic_master', 'feed_posts'),
    ('story',    'ST', 'story_master',   'stories')
  ) as t(asset_type, type_code, master_table, calendar_row_type)
  where t.asset_type = p_asset_type;
$$;

comment on function public.ideation_commit_target(text) is
  'aa.ideation.commit-targets.v1 — Ideation asset type to operational master and Calendar lane. Never maps to ads_master.';


-- ---------------------------------------------------------------------------
-- Commit runs: one row per commit attempt against one approved proposal.
-- ---------------------------------------------------------------------------
create table public.client_ideation_commit_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ideation_cycle_id uuid not null,
  scoring_run_id uuid not null,
  proposal_id uuid not null,
  status text not null default 'running',
  idempotency_key text not null,
  configuration_hash text not null,
  commit_input_snapshot jsonb not null default '{}'::jsonb,
  calendar_digest text not null,
  proposal_version integer not null,
  proposal_edit_revision integer not null,
  target_manifest_version text not null,
  mapping_version text not null,
  reference_allocator_version text not null,
  output_schema_version text not null,
  module_version text not null,
  period_start date not null,
  period_end date not null,
  expected_item_count integer not null,
  committed_item_count integer not null default 0,
  organic_item_count integer not null default 0,
  story_item_count integer not null default 0,
  failed_item_count integer not null default 0,
  failure_code text,
  failure_message text,
  failed_proposal_slot_key text,
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint client_ideation_commit_runs_status_check
    check (status in ('running','completed','failed')),
  constraint client_ideation_commit_runs_idempotency_check
    check (length(idempotency_key) between 1 and 160),
  constraint client_ideation_commit_runs_hash_check
    check (configuration_hash ~ '^[0-9a-f]{64}$' and calendar_digest ~ '^[0-9a-f]{64}$'),
  constraint client_ideation_commit_runs_versions_check
    check (length(target_manifest_version) between 1 and 100
      and length(mapping_version) between 1 and 100
      and length(reference_allocator_version) between 1 and 100
      and length(output_schema_version) between 1 and 100
      and length(module_version) between 1 and 100),
  constraint client_ideation_commit_runs_snapshot_check
    check (jsonb_typeof(commit_input_snapshot) = 'object' and jsonb_typeof(warnings) = 'array'),
  constraint client_ideation_commit_runs_period_check
    check (period_end >= period_start),
  constraint client_ideation_commit_runs_counts_check
    check (expected_item_count >= 1
      and committed_item_count between 0 and expected_item_count
      and organic_item_count >= 0 and story_item_count >= 0 and failed_item_count >= 0
      and organic_item_count + story_item_count = committed_item_count),
  constraint client_ideation_commit_runs_revision_check
    check (proposal_version >= 1 and proposal_edit_revision >= 0),
  -- A completed commit must reconcile exactly and carry no failure.
  constraint client_ideation_commit_runs_completed_check
    check (status <> 'completed'
      or (completed_at is not null
        and committed_item_count = expected_item_count
        and failed_item_count = 0
        and failure_code is null
        and failed_at is null)),
  constraint client_ideation_commit_runs_failed_check
    check ((status = 'failed' and failed_at is not null and failure_code is not null)
      or (status <> 'failed' and failed_at is null and failure_code is null)),
  constraint client_ideation_commit_runs_running_check
    check (status <> 'running' or (completed_at is null and failed_at is null)),

  constraint client_ideation_commit_runs_id_client_key unique (id, client_id),
  -- Ownership: the run's client, cycle, scoring run, and proposal must agree
  -- with the proposal's own lineage, enforced structurally rather than in code.
  constraint client_ideation_commit_runs_proposal_fk
    foreign key (proposal_id, ideation_cycle_id, client_id)
    references public.client_ideation_calendar_proposals(id, ideation_cycle_id, client_id)
    on delete cascade,
  constraint client_ideation_commit_runs_scoring_run_fk
    foreign key (scoring_run_id, ideation_cycle_id, client_id)
    references public.client_ideation_scoring_runs(id, ideation_cycle_id, client_id)
    on delete cascade,
  constraint client_ideation_commit_runs_cycle_fk
    foreign key (ideation_cycle_id, client_id)
    references public.client_ideation_cycles(id, client_id) on delete cascade
);

-- At most ONE completed commit may ever exist for a proposal. This is the
-- structural guarantee behind duplicate-commit prevention; concurrency and
-- replay both rely on it rather than on application-level checks alone.
create unique index client_ideation_commit_runs_one_completed_idx
  on public.client_ideation_commit_runs (proposal_id)
  where status = 'completed';

create index client_ideation_commit_runs_client_idx
  on public.client_ideation_commit_runs (client_id, created_at desc);
create index client_ideation_commit_runs_proposal_idx
  on public.client_ideation_commit_runs (proposal_id, status);
create index client_ideation_commit_runs_cycle_idx
  on public.client_ideation_commit_runs (ideation_cycle_id);

comment on table public.client_ideation_commit_runs is
  'Ideation Stage 4: one commit attempt per approved proposal. A completed run is the sole evidence that operational content was created.';


-- ---------------------------------------------------------------------------
-- Commit items: one row per committed proposal slot, carrying exact provenance
-- from the Ideation candidate through to the operational master and Calendar row.
-- ---------------------------------------------------------------------------
create table public.client_ideation_commit_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  commit_run_id uuid not null,
  ideation_cycle_id uuid not null,
  scoring_run_id uuid not null,
  proposal_id uuid not null,
  proposal_slot_id uuid not null,
  proposal_slot_key text not null,
  candidate_id uuid not null,
  candidate_score_id uuid not null,
  candidate_content_hash text not null,
  candidate_rank_snapshot integer not null,
  candidate_score_snapshot integer not null,
  asset_type text not null,
  target_master_table text not null,
  target_master_id uuid not null,
  target_calendar_cell_id uuid not null,
  calendar_row_type text not null,
  operational_ref text not null,
  committed_date date not null,
  execution_month text not null,
  master_payload_hash text not null,
  calendar_payload_hash text not null,
  created_at timestamptz not null default now(),

  constraint client_ideation_commit_items_asset_type_check
    check (asset_type in ('reel','carousel','static','story')),
  -- Canonical targets only. ads_master and every downstream domain are absent
  -- by construction: no value outside this pair can ever be persisted.
  constraint client_ideation_commit_items_target_check
    check (target_master_table in ('organic_master','story_master')),
  -- Story never lands in organic_master, and no organic type lands in story_master.
  constraint client_ideation_commit_items_target_pairing_check
    check ((asset_type = 'story' and target_master_table = 'story_master' and calendar_row_type = 'stories')
      or (asset_type = 'reel' and target_master_table = 'organic_master' and calendar_row_type = 'reel')
      or (asset_type = 'carousel' and target_master_table = 'organic_master' and calendar_row_type = 'carousels')
      or (asset_type = 'static' and target_master_table = 'organic_master' and calendar_row_type = 'feed_posts')),
  constraint client_ideation_commit_items_hash_check
    check (candidate_content_hash ~ '^[0-9a-f]{64}$'
      and master_payload_hash ~ '^[0-9a-f]{64}$'
      and calendar_payload_hash ~ '^[0-9a-f]{64}$'),
  constraint client_ideation_commit_items_score_check
    check (candidate_rank_snapshot >= 1
      and candidate_score_snapshot between 0 and 100),
  constraint client_ideation_commit_items_ref_check
    check (length(operational_ref) between 1 and 100),
  constraint client_ideation_commit_items_month_check
    check (execution_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
      and execution_month = to_char(committed_date, 'YYYY-MM')),

  -- Exact reconciliation: one item per slot, one item per candidate.
  constraint client_ideation_commit_items_run_slot_key unique (commit_run_id, proposal_slot_id),
  constraint client_ideation_commit_items_run_candidate_key unique (commit_run_id, candidate_id),
  -- A created master, Calendar row, or operational ref can be claimed once only.
  constraint client_ideation_commit_items_master_key unique (target_master_table, target_master_id),
  constraint client_ideation_commit_items_calendar_key unique (target_calendar_cell_id),
  constraint client_ideation_commit_items_ref_key unique (client_id, operational_ref),

  constraint client_ideation_commit_items_run_fk
    foreign key (commit_run_id, client_id)
    references public.client_ideation_commit_runs(id, client_id) on delete cascade,
  constraint client_ideation_commit_items_slot_fk
    foreign key (proposal_slot_id, proposal_id)
    references public.client_ideation_calendar_proposal_slots(id, proposal_id) on delete cascade,
  constraint client_ideation_commit_items_proposal_fk
    foreign key (proposal_id, ideation_cycle_id, client_id)
    references public.client_ideation_calendar_proposals(id, ideation_cycle_id, client_id)
    on delete cascade,
  constraint client_ideation_commit_items_candidate_fk
    foreign key (candidate_id, ideation_cycle_id, client_id)
    references public.client_ideation_candidates(id, ideation_cycle_id, client_id) on delete cascade,
  constraint client_ideation_commit_items_score_fk
    foreign key (candidate_score_id, scoring_run_id)
    references public.client_ideation_candidate_scores(id, scoring_run_id) on delete cascade
);

create index client_ideation_commit_items_run_idx
  on public.client_ideation_commit_items (commit_run_id, committed_date);
create index client_ideation_commit_items_client_idx
  on public.client_ideation_commit_items (client_id, execution_month);
create index client_ideation_commit_items_master_idx
  on public.client_ideation_commit_items (target_master_table, target_master_id);
create index client_ideation_commit_items_proposal_idx
  on public.client_ideation_commit_items (proposal_id);

comment on table public.client_ideation_commit_items is
  'Ideation Stage 4: exact provenance from proposal slot and candidate to the created operational master and calendar_cells row.';


-- ---------------------------------------------------------------------------
-- RLS: staff read for accessible clients only. Every mutation is service-role.
-- ---------------------------------------------------------------------------
alter table public.client_ideation_commit_runs enable row level security;
alter table public.client_ideation_commit_items enable row level security;

create policy client_ideation_commit_runs_staff_select
  on public.client_ideation_commit_runs for select to authenticated
  using (client_id = any(public.auth_client_ids()));

create policy client_ideation_commit_items_staff_select
  on public.client_ideation_commit_items for select to authenticated
  using (client_id = any(public.auth_client_ids()));

revoke all on public.client_ideation_commit_runs from anon, authenticated;
revoke all on public.client_ideation_commit_items from anon, authenticated;
grant select on public.client_ideation_commit_runs to authenticated;
grant select on public.client_ideation_commit_items to authenticated;
grant all on public.client_ideation_commit_runs to service_role;
grant all on public.client_ideation_commit_items to service_role;


-- ---------------------------------------------------------------------------
-- The one atomic commit transaction.
--
-- Everything the operator's single click does happens here, in one transaction:
-- lock, revalidate, re-check the live Calendar, allocate refs, insert masters,
-- insert Calendar rows, insert provenance, reconcile exactly, log. Any failure
-- raises, which rolls back every operational write — there is no partial state
-- and no per-slot round trip.
-- ---------------------------------------------------------------------------
create or replace function public.commit_ideation_content(
  p_client_id uuid,
  p_proposal_id uuid,
  p_expected_edit_revision integer,
  p_actor_id uuid,
  p_configuration_hash text,
  p_commit_input_snapshot jsonb,
  p_calendar_digest text,
  p_idempotency_key text,
  p_target_manifest_version text,
  p_mapping_version text,
  p_reference_allocator_version text,
  p_output_schema_version text,
  p_module_version text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.client_ideation_calendar_proposals;
  v_cycle public.client_ideation_cycles;
  v_scoring public.client_ideation_scoring_runs;
  v_run_id uuid;
  v_slot record;
  v_candidate public.client_ideation_candidates;
  v_score public.client_ideation_candidate_scores;
  v_target record;
  v_authority record;
  v_ref text;
  v_master_id uuid;
  v_cell_id uuid;
  v_month text;
  v_existing_completed uuid;
  v_slot_total integer := 0;
  v_organic integer := 0;
  v_story integer := 0;
  v_placed integer;
  v_existing integer;
  v_protected integer;
  v_master_payload jsonb;
  v_calendar_payload jsonb;
  v_refs text[] := '{}';
  v_attempt integer;
begin
  -- coalesce: a caller with no role claim at all must fail closed, not slip
  -- through on a NULL comparison.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'IDEATION_COMMIT_FORBIDDEN';
  end if;

  -- 1. Lock the proposal for the whole transaction. Two simultaneous commits
  -- serialise here; the loser then finds the completed run at step 3.
  select * into v_proposal
  from public.client_ideation_calendar_proposals
  where id = p_proposal_id and client_id = p_client_id
  for update;
  if not found then raise exception 'IDEATION_COMMIT_PROPOSAL_NOT_FOUND'; end if;

  -- 2. Approved, active, and exactly the revision the operator confirmed.
  if v_proposal.status = 'superseded' then raise exception 'IDEATION_COMMIT_PROPOSAL_SUPERSEDED'; end if;
  if exists (
    select 1 from public.client_ideation_calendar_proposals
    where supersedes_proposal_id = v_proposal.id and client_id = p_client_id and status <> 'failed'
  ) then
    raise exception 'IDEATION_COMMIT_PROPOSAL_SUPERSEDED';
  end if;
  if v_proposal.status <> 'approved' then raise exception 'IDEATION_COMMIT_PROPOSAL_NOT_APPROVED'; end if;
  if v_proposal.approved_at is null or v_proposal.approved_by is null then
    raise exception 'IDEATION_COMMIT_PROPOSAL_NOT_APPROVED';
  end if;
  if v_proposal.edit_revision <> p_expected_edit_revision then
    raise exception 'IDEATION_COMMIT_PROPOSAL_REVISION_CONFLICT';
  end if;

  -- 3. A completed commit already exists: replay, never duplicate.
  select id into v_existing_completed
  from public.client_ideation_commit_runs
  where proposal_id = v_proposal.id and status = 'completed';
  if v_existing_completed is not null then
    return jsonb_build_object('replayed', true, 'commit_run_id', v_existing_completed);
  end if;

  -- 4. Cycle and scoring run must still be complete and reconciled.
  select * into v_cycle from public.client_ideation_cycles
  where id = v_proposal.ideation_cycle_id and client_id = p_client_id;
  if not found or v_cycle.status <> 'completed'
    or v_cycle.candidate_count <> v_cycle.expected_candidate_count
    or v_cycle.shortfall_count <> 0 then
    raise exception 'IDEATION_COMMIT_CYCLE_NOT_ELIGIBLE';
  end if;

  select * into v_scoring from public.client_ideation_scoring_runs
  where id = v_proposal.scoring_run_id and client_id = p_client_id
    and ideation_cycle_id = v_cycle.id;
  if not found or v_scoring.status <> 'completed'
    or v_scoring.scored_candidate_count <> v_scoring.expected_candidate_count
    or v_scoring.failed_candidate_count <> 0 then
    raise exception 'IDEATION_COMMIT_SCORING_RUN_NOT_ELIGIBLE';
  end if;

  -- 5. Proposal-level completeness.
  if v_proposal.unassigned_candidate_count <> 0 then raise exception 'IDEATION_COMMIT_PROPOSAL_INCOMPLETE'; end if;
  if v_proposal.unresolved_conflict_count <> 0 then raise exception 'IDEATION_COMMIT_PROPOSAL_CONFLICTS_UNRESOLVED'; end if;

  select count(*) into v_slot_total
  from public.client_ideation_calendar_proposal_slots where proposal_id = v_proposal.id;
  if v_slot_total <> v_proposal.expected_slot_count
    or v_proposal.assigned_slot_count <> v_proposal.expected_slot_count then
    raise exception 'IDEATION_COMMIT_PROPOSAL_SNAPSHOT_MISMATCH';
  end if;
  if exists (
    select 1 from public.client_ideation_calendar_proposal_slots
    where proposal_id = v_proposal.id and (candidate_id is null or candidate_score_id is null)
  ) then
    raise exception 'IDEATION_COMMIT_PROPOSAL_INCOMPLETE';
  end if;

  -- 6. Authority and Calendar drift since approval.
  -- Re-verify the authority the proposal actually recorded. Comparing the
  -- proposal's own hash to itself would prove nothing, so every recorded file is
  -- checked to still exist, still be approved, and still be at the same version.
  -- (Content-level hash equality is verified by the caller's preflight, which
  -- reuses the same reconstruction Stages 2 and 3 use.)
  for v_authority in
    select entry->>'id' as id, (entry->>'version')::integer as version, 'context' as kind
    from jsonb_array_elements(coalesce(v_proposal.authority_snapshot->'context', '[]'::jsonb)) entry
    union all
    select entry->>'id', (entry->>'version')::integer, 'context'
    from jsonb_array_elements(coalesce(v_proposal.authority_snapshot->'strategic_playbooks', '[]'::jsonb)) entry
    union all
    select entry->>'id', (entry->>'version')::integer, 'execution'
    from jsonb_array_elements(coalesce(v_proposal.authority_snapshot->'execution', '[]'::jsonb)) entry
  loop
    if v_authority.kind = 'context' then
      if not exists (
        select 1 from public.client_context_files
        where id = v_authority.id::uuid and client_id = p_client_id
          and status = 'approved' and version = v_authority.version
      ) then
        raise exception 'IDEATION_COMMIT_AUTHORITY_SNAPSHOT_MISMATCH';
      end if;
    else
      if not exists (
        select 1 from public.client_execution_files
        where id = v_authority.id::uuid and client_id = p_client_id
          and review_state = 'approved' and version = v_authority.version
      ) then
        raise exception 'IDEATION_COMMIT_AUTHORITY_SNAPSHOT_MISMATCH';
      end if;
    end if;
  end loop;
  if v_proposal.calendar_conflict_digest <> p_calendar_digest then
    raise exception 'IDEATION_COMMIT_CALENDAR_SNAPSHOT_STALE';
  end if;

  -- 7. Every asset type must be supported BEFORE any operational write.
  if exists (
    select 1 from public.client_ideation_calendar_proposal_slots s
    where s.proposal_id = v_proposal.id
      and not exists (select 1 from public.ideation_commit_target(s.required_asset_type))
  ) then
    raise exception 'IDEATION_COMMIT_UNSUPPORTED_ASSET_TYPE';
  end if;

  -- 8. Re-check the live Calendar inside the transaction, using exactly the
  -- Stage 3 rules: an approved or archived row protects a date and lane, and a
  -- date and lane cannot carry more than two placements.
  for v_slot in
    select s.*, t.calendar_row_type as target_row_type
    from public.client_ideation_calendar_proposal_slots s
    cross join lateral public.ideation_commit_target(s.required_asset_type) t
    where s.proposal_id = v_proposal.id
    order by s.proposed_date, s.proposal_slot_key
  loop
    if v_slot.calendar_row_type <> v_slot.target_row_type then
      raise exception 'IDEATION_COMMIT_MASTER_MAPPING_INVALID: %', v_slot.proposal_slot_key;
    end if;

    select count(*) into v_protected
    from public.calendar_cells c
    where c.client_id = p_client_id and c.date = v_slot.proposed_date
      and c.row_type::text = v_slot.calendar_row_type
      and c.review_state in ('approved','archived');
    if v_protected > 0 then
      raise exception 'IDEATION_COMMIT_CALENDAR_CONFLICT: %', v_slot.proposal_slot_key;
    end if;

    select count(*) into v_existing
    from public.calendar_cells c
    where c.client_id = p_client_id and c.date = v_slot.proposed_date
      and c.row_type::text = v_slot.calendar_row_type;
    select count(*) into v_placed
    from public.client_ideation_calendar_proposal_slots s2
    where s2.proposal_id = v_proposal.id and s2.proposed_date = v_slot.proposed_date
      and s2.calendar_row_type = v_slot.calendar_row_type;
    if v_placed > 1 and v_placed + v_existing > 2 then
      raise exception 'IDEATION_COMMIT_CALENDAR_CONFLICT: %', v_slot.proposal_slot_key;
    end if;
  end loop;

  -- 9. Open the commit run. It reaches 'completed' inside this same transaction,
  -- so 'running' is never externally observable; it exists for audit only.
  insert into public.client_ideation_commit_runs (
    client_id, ideation_cycle_id, scoring_run_id, proposal_id, status,
    idempotency_key, configuration_hash, commit_input_snapshot, calendar_digest,
    proposal_version, proposal_edit_revision,
    target_manifest_version, mapping_version, reference_allocator_version,
    output_schema_version, module_version,
    period_start, period_end, expected_item_count, created_by
  ) values (
    p_client_id, v_cycle.id, v_scoring.id, v_proposal.id, 'running',
    p_idempotency_key, p_configuration_hash, coalesce(p_commit_input_snapshot, '{}'::jsonb), p_calendar_digest,
    v_proposal.proposal_version, v_proposal.edit_revision,
    p_target_manifest_version, p_mapping_version, p_reference_allocator_version,
    p_output_schema_version, p_module_version,
    v_proposal.period_start, v_proposal.period_end, v_proposal.expected_slot_count, p_actor_id
  ) returning id into v_run_id;

  -- 10. Create the operational content, deterministically ordered.
  for v_slot in
    select s.*, t.type_code, t.master_table, t.calendar_row_type as target_row_type
    from public.client_ideation_calendar_proposal_slots s
    cross join lateral public.ideation_commit_target(s.required_asset_type) t
    where s.proposal_id = v_proposal.id
    order by s.proposed_date, s.proposal_slot_key
  loop
    select * into v_candidate from public.client_ideation_candidates
    where id = v_slot.candidate_id and client_id = p_client_id and ideation_cycle_id = v_cycle.id;
    if not found then raise exception 'IDEATION_COMMIT_CANDIDATE_SNAPSHOT_MISMATCH: %', v_slot.proposal_slot_key; end if;
    if v_candidate.asset_type <> v_slot.required_asset_type
      or v_candidate.asset_type <> v_slot.candidate_asset_type_snapshot
      or v_candidate.input_hash <> v_slot.candidate_content_hash then
      raise exception 'IDEATION_COMMIT_CANDIDATE_SNAPSHOT_MISMATCH: %', v_slot.proposal_slot_key;
    end if;

    select * into v_score from public.client_ideation_candidate_scores
    where id = v_slot.candidate_score_id and scoring_run_id = v_scoring.id and client_id = p_client_id;
    if not found then raise exception 'IDEATION_COMMIT_SCORE_SNAPSHOT_MISMATCH: %', v_slot.proposal_slot_key; end if;
    if v_score.candidate_id <> v_slot.candidate_id
      or v_score.rank is distinct from v_slot.candidate_rank_snapshot
      or v_score.overall_score <> v_slot.candidate_score_snapshot
      or v_score.candidate_content_hash <> v_slot.candidate_content_hash then
      raise exception 'IDEATION_COMMIT_SCORE_SNAPSHOT_MISMATCH: %', v_slot.proposal_slot_key;
    end if;

    -- Mandatory operational content must already exist on the candidate. It is
    -- never invented here, and a gap fails the whole commit before insertion.
    if coalesce(nullif(trim(v_candidate.working_title), ''), '') = '' then
      raise exception 'IDEATION_COMMIT_REQUIRED_FIELD_MISSING: working_title (%)', v_slot.proposal_slot_key;
    end if;
    if coalesce(nullif(trim(v_candidate.hook), ''), '') = '' then
      raise exception 'IDEATION_COMMIT_REQUIRED_FIELD_MISSING: hook (%)', v_slot.proposal_slot_key;
    end if;
    if coalesce(nullif(trim(v_candidate.core_message), ''), '') = '' then
      raise exception 'IDEATION_COMMIT_REQUIRED_FIELD_MISSING: core_message (%)', v_slot.proposal_slot_key;
    end if;
    if coalesce(nullif(trim(v_candidate.cta), ''), '') = '' then
      raise exception 'IDEATION_COMMIT_REQUIRED_FIELD_MISSING: cta (%)', v_slot.proposal_slot_key;
    end if;

    v_month := to_char(v_slot.proposed_date, 'YYYY-MM');

    -- Canonical operational reference, allocated under the existing Phase 3
    -- advisory lock. The rare UNIQUE race re-allocates rather than failing.
    v_master_id := null;
    for v_attempt in 1..5 loop
      v_ref := public.allocate_phase3_ref(p_client_id, v_slot.proposed_date, v_slot.type_code);
      if v_ref is null then raise exception 'IDEATION_COMMIT_REFERENCE_ALLOCATION_FAILED: %', v_slot.proposal_slot_key; end if;
      if v_ref = any(v_refs) then continue; end if;
      begin
        if v_slot.master_table = 'story_master' then
          insert into public.story_master (
            client_id, month, ref, review_state, status, story_type,
            story_theme, frame_1, frame_2, frame_3, cta_engagement_prompt,
            source_origin, distribution_date
          ) values (
            p_client_id, v_month, v_ref, 'needs_review', 'idea', 'daily',
            v_candidate.working_title, v_candidate.hook, v_candidate.core_message,
            v_candidate.psychological_angle, v_candidate.cta,
            'Ideation ' || left(v_cycle.id::text, 8), v_slot.proposed_date
          ) returning id into v_master_id;
        else
          insert into public.organic_master (
            client_id, month, ref, review_state, status, content_type,
            working_title, hook, core_message, cta, psychological_angle,
            source_origin, distribution_date, format_proven
          ) values (
            p_client_id, v_month, v_ref, 'needs_review', 'idea', v_slot.type_code,
            v_candidate.working_title, v_candidate.hook, v_candidate.core_message,
            v_candidate.cta, v_candidate.psychological_angle,
            'Ideation ' || left(v_cycle.id::text, 8), v_slot.proposed_date, false
          ) returning id into v_master_id;
        end if;
        exit;
      exception when unique_violation then
        v_master_id := null;
      end;
    end loop;
    if v_master_id is null then
      raise exception 'IDEATION_COMMIT_REFERENCE_ALLOCATION_FAILED: %', v_slot.proposal_slot_key;
    end if;
    v_refs := v_refs || v_ref;

    insert into public.calendar_cells (client_id, month, date, row_type, ref, review_state)
    values (p_client_id, v_month, v_slot.proposed_date, v_slot.calendar_row_type::public.calendar_row_type,
            v_ref, 'needs_review')
    returning id into v_cell_id;

    v_master_payload := jsonb_build_object(
      'master_table', v_slot.master_table, 'client_id', p_client_id, 'month', v_month, 'ref', v_ref,
      'review_state', 'needs_review', 'status', 'idea', 'asset_type', v_slot.required_asset_type,
      'type_code', v_slot.type_code, 'distribution_date', v_slot.proposed_date,
      'candidate_id', v_candidate.id, 'candidate_content_hash', v_candidate.input_hash);
    v_calendar_payload := jsonb_build_object(
      'client_id', p_client_id, 'month', v_month, 'date', v_slot.proposed_date,
      'row_type', v_slot.calendar_row_type, 'ref', v_ref, 'review_state', 'needs_review');

    insert into public.client_ideation_commit_items (
      client_id, commit_run_id, ideation_cycle_id, scoring_run_id, proposal_id,
      proposal_slot_id, proposal_slot_key, candidate_id, candidate_score_id,
      candidate_content_hash, candidate_rank_snapshot, candidate_score_snapshot,
      asset_type, target_master_table, target_master_id, target_calendar_cell_id,
      calendar_row_type, operational_ref, committed_date, execution_month,
      master_payload_hash, calendar_payload_hash
    ) values (
      p_client_id, v_run_id, v_cycle.id, v_scoring.id, v_proposal.id,
      v_slot.id, v_slot.proposal_slot_key, v_candidate.id, v_score.id,
      v_slot.candidate_content_hash, v_slot.candidate_rank_snapshot, v_slot.candidate_score_snapshot,
      v_slot.required_asset_type, v_slot.master_table, v_master_id, v_cell_id,
      v_slot.calendar_row_type, v_ref, v_slot.proposed_date, v_month,
      -- Built-in sha256(bytea); no pgcrypto dependency is introduced.
      encode(sha256(convert_to(v_master_payload::text, 'UTF8')), 'hex'),
      encode(sha256(convert_to(v_calendar_payload::text, 'UTF8')), 'hex')
    );

    if v_slot.master_table = 'story_master' then
      v_story := v_story + 1;
    else
      v_organic := v_organic + 1;
    end if;
  end loop;

  -- 11. Exact reconciliation, per record and never by aggregate alone.
  if v_organic + v_story <> v_proposal.expected_slot_count then
    raise exception 'IDEATION_COMMIT_RECONCILIATION_FAILED';
  end if;
  if (select count(*) from public.client_ideation_commit_items where commit_run_id = v_run_id)
     <> v_proposal.expected_slot_count then
    raise exception 'IDEATION_COMMIT_RECONCILIATION_FAILED';
  end if;
  if exists (
    select 1 from public.client_ideation_calendar_proposal_slots s
    where s.proposal_id = v_proposal.id
      and not exists (
        select 1 from public.client_ideation_commit_items i
        where i.commit_run_id = v_run_id and i.proposal_slot_id = s.id
      )
  ) then
    raise exception 'IDEATION_COMMIT_RECONCILIATION_FAILED';
  end if;
  if (select count(distinct candidate_id) from public.client_ideation_commit_items where commit_run_id = v_run_id)
     <> v_proposal.expected_slot_count then
    raise exception 'IDEATION_COMMIT_RECONCILIATION_FAILED';
  end if;

  update public.client_ideation_commit_runs
  set status = 'completed',
      committed_item_count = v_organic + v_story,
      organic_item_count = v_organic,
      story_item_count = v_story,
      failed_item_count = 0,
      completed_at = now(),
      updated_at = now()
  where id = v_run_id;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'ideation_content_committed',
    'Ideation content was committed: ' || (v_organic + v_story)::text ||
      ' operational Content records and ' || (v_organic + v_story)::text ||
      ' Calendar records were created for ' || v_proposal.period_start::text || ' to ' ||
      v_proposal.period_end::text || '. They enter the normal review workflow; no production, publishing, or distribution was started.',
    'client_ideation_commit_run', v_run_id::text,
    jsonb_build_object(
      'proposal_id', v_proposal.id, 'commit_run_id', v_run_id,
      'ideation_cycle_id', v_cycle.id, 'scoring_run_id', v_scoring.id,
      'item_count', v_organic + v_story, 'organic_count', v_organic, 'story_count', v_story,
      'period_start', v_proposal.period_start, 'period_end', v_proposal.period_end,
      'operational_refs', to_jsonb(v_refs[1:50]))
  );

  return jsonb_build_object('replayed', false, 'commit_run_id', v_run_id);
end;
$$;

comment on function public.commit_ideation_content(uuid, uuid, integer, uuid, text, jsonb, text, text, text, text, text, text, text) is
  'Ideation Stage 4: the one atomic transaction that turns an approved proposal into operational masters and calendar_cells. Never writes ads_master, briefs, assets, distribution, or analytics.';


-- ---------------------------------------------------------------------------
-- Failure audit. Called only AFTER the commit transaction has already rolled
-- back, so it records the attempt without holding any operational state.
-- ---------------------------------------------------------------------------
create or replace function public.record_ideation_commit_failure(
  p_client_id uuid,
  p_proposal_id uuid,
  p_actor_id uuid,
  p_failure_code text,
  p_failure_message text,
  p_failed_proposal_slot_key text,
  p_configuration_hash text,
  p_calendar_digest text,
  p_idempotency_key text,
  p_target_manifest_version text,
  p_mapping_version text,
  p_reference_allocator_version text,
  p_output_schema_version text,
  p_module_version text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.client_ideation_calendar_proposals;
  v_run_id uuid;
begin
  -- coalesce: a caller with no role claim at all must fail closed, not slip
  -- through on a NULL comparison.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'IDEATION_COMMIT_FORBIDDEN';
  end if;

  select * into v_proposal from public.client_ideation_calendar_proposals
  where id = p_proposal_id and client_id = p_client_id;
  if not found then return null; end if;

  -- Never record a failure over a proposal that did in fact commit.
  if exists (select 1 from public.client_ideation_commit_runs
             where proposal_id = v_proposal.id and status = 'completed') then
    return null;
  end if;

  insert into public.client_ideation_commit_runs (
    client_id, ideation_cycle_id, scoring_run_id, proposal_id, status,
    idempotency_key, configuration_hash, commit_input_snapshot, calendar_digest,
    proposal_version, proposal_edit_revision,
    target_manifest_version, mapping_version, reference_allocator_version,
    output_schema_version, module_version,
    period_start, period_end, expected_item_count,
    failure_code, failure_message, failed_proposal_slot_key, failed_at, created_by
  ) values (
    p_client_id, v_proposal.ideation_cycle_id, v_proposal.scoring_run_id, v_proposal.id, 'failed',
    p_idempotency_key, p_configuration_hash, '{}'::jsonb, p_calendar_digest,
    v_proposal.proposal_version, v_proposal.edit_revision,
    p_target_manifest_version, p_mapping_version, p_reference_allocator_version,
    p_output_schema_version, p_module_version,
    v_proposal.period_start, v_proposal.period_end, greatest(v_proposal.expected_slot_count, 1),
    p_failure_code, left(coalesce(p_failure_message, ''), 2000), p_failed_proposal_slot_key, now(), p_actor_id
  ) returning id into v_run_id;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'ideation_content_commit_failed',
    'An Ideation content commit was refused. No operational Content or Calendar records were created.',
    'client_ideation_commit_run', v_run_id::text,
    jsonb_build_object('proposal_id', v_proposal.id, 'commit_run_id', v_run_id, 'failure_code', p_failure_code)
  );

  return v_run_id;
end;
$$;


-- Audit-only: records that an operator re-requested a commit that had already
-- completed. It creates no content and mutates no commit run.
create or replace function public.log_ideation_commit_replay(
  p_client_id uuid,
  p_commit_run_id uuid,
  p_actor_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- coalesce: a caller with no role claim at all must fail closed, not slip
  -- through on a NULL comparison.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'IDEATION_COMMIT_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.client_ideation_commit_runs
    where id = p_commit_run_id and client_id = p_client_id and status = 'completed'
  ) then
    return;
  end if;
  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'ideation_content_commit_replayed',
    'An already-completed Ideation content commit was requested again; the existing result was returned and nothing new was created.',
    'client_ideation_commit_run', p_commit_run_id::text,
    jsonb_build_object('commit_run_id', p_commit_run_id)
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- Privileges: service role only, for every Stage 4 mutation path.
-- ---------------------------------------------------------------------------
revoke all on function public.commit_ideation_content(uuid, uuid, integer, uuid, text, jsonb, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.commit_ideation_content(uuid, uuid, integer, uuid, text, jsonb, text, text, text, text, text, text, text) to service_role;

revoke all on function public.record_ideation_commit_failure(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_ideation_commit_failure(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text) to service_role;

revoke all on function public.log_ideation_commit_replay(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.log_ideation_commit_replay(uuid, uuid, uuid) to service_role;

revoke all on function public.ideation_commit_target(text) from public, anon, authenticated;
grant execute on function public.ideation_commit_target(text) to service_role;
