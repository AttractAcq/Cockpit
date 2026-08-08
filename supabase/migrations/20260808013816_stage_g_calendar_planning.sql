-- Programme Stage G — Calendar Planning and Operational Commitment.
--
-- Additive only. Builds the proposal + commitment layer on top of Stage B's
-- existing calendar_slots/content_requirements/content_items skeleton and
-- Stage F's content_opportunities, generalising the pattern already proven
-- by the Ideation-specific client_ideation_calendar_proposals system rather
-- than duplicating it: a proposal header, per-slot assignment rows with
-- conflict tracking, edit-revision optimistic concurrency, and an atomic
-- commit RPC (this stage's own required output explicitly names "Operational
-- commitment RPCs" — a Postgres function, not client-orchestrated multi-step
-- writes, is the only way to guarantee "failed commitment leaves no partial
-- operational state" from an Edge Function caller).
--
-- Written defensively (IF NOT EXISTS / DROP..IF EXISTS then CREATE) because
-- an earlier apply attempt left one orphaned index (content_items_calendar_
-- slot_unique) on this project with no corresponding migration recorded —
-- this repo has a concurrently-running second session, so re-running this
-- file must be safe regardless of what partial state already exists.

-- ---------------------------------------------------------------------------
-- content_calendar_proposals / content_calendar_proposal_slots
-- ---------------------------------------------------------------------------

create table if not exists public.content_calendar_proposals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  mode text not null default 'assisted',
  edit_revision integer not null default 0,
  generated_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_calendar_proposals_period_check check (period_end >= period_start),
  constraint content_calendar_proposals_status_check
    check (status in ('draft', 'approved', 'superseded')),
  constraint content_calendar_proposals_mode_check
    check (mode in ('manual', 'assisted', 'automatic')),
  constraint content_calendar_proposals_approved_check
    check (status <> 'approved' or (approved_at is not null and approved_by is not null))
);

create index if not exists content_calendar_proposals_client_status_idx
  on public.content_calendar_proposals (client_id, status);

create table if not exists public.content_calendar_proposal_slots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  proposal_id uuid not null references public.content_calendar_proposals(id) on delete cascade,
  calendar_slot_id uuid not null references public.calendar_slots(id) on delete restrict,
  content_opportunity_id uuid references public.content_opportunities(id) on delete set null,
  -- The model's original proposal, preserved so "restore" can revert a
  -- manual edit without re-running the matching engine.
  original_content_opportunity_id uuid references public.content_opportunities(id) on delete set null,
  match_score numeric(6,3),
  match_rationale text,
  conflict_status text not null default 'clear',
  conflict_details jsonb not null default '{}'::jsonb,
  placement_source text,
  manually_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_calendar_proposal_slots_conflict_check
    check (conflict_status in ('clear', 'occupied', 'protected', 'stale_snapshot')),
  constraint content_calendar_proposal_slots_placement_source_check
    check (placement_source is null or placement_source in ('model', 'manual', 'restored')),
  -- One row per Slot per proposal.
  constraint content_calendar_proposal_slots_unique_slot
    unique (proposal_id, calendar_slot_id)
);

-- An Opportunity may appear at most once within a given proposal's
-- assignments — "Manual assignment overrides recommendation without
-- destroying provenance" still holds (original_content_opportunity_id is
-- preserved), but the same Opportunity cannot occupy two Slots at once.
create unique index if not exists content_calendar_proposal_slots_unique_opportunity_per_proposal
  on public.content_calendar_proposal_slots (proposal_id, content_opportunity_id)
  where content_opportunity_id is not null;

create index if not exists content_calendar_proposal_slots_proposal_idx
  on public.content_calendar_proposal_slots (proposal_id);

create index if not exists content_calendar_proposal_slots_opportunity_idx
  on public.content_calendar_proposal_slots (content_opportunity_id)
  where content_opportunity_id is not null;

drop trigger if exists content_calendar_proposals_updated_at on public.content_calendar_proposals;
create trigger content_calendar_proposals_updated_at before update on public.content_calendar_proposals
  for each row execute function public.set_updated_at();
drop trigger if exists content_calendar_proposal_slots_updated_at on public.content_calendar_proposal_slots;
create trigger content_calendar_proposal_slots_updated_at before update on public.content_calendar_proposal_slots
  for each row execute function public.set_updated_at();

alter table public.content_calendar_proposals enable row level security;
alter table public.content_calendar_proposal_slots enable row level security;

revoke all on public.content_calendar_proposals from public, anon, authenticated;
revoke all on public.content_calendar_proposal_slots from public, anon, authenticated;

grant select on public.content_calendar_proposals to authenticated;
grant select on public.content_calendar_proposal_slots to authenticated;
grant all on public.content_calendar_proposals to service_role;
grant all on public.content_calendar_proposal_slots to service_role;

drop policy if exists content_calendar_proposals_select on public.content_calendar_proposals;
create policy content_calendar_proposals_select on public.content_calendar_proposals
  for select to authenticated using (client_id = any(public.auth_client_ids()));
drop policy if exists content_calendar_proposal_slots_select on public.content_calendar_proposal_slots;
create policy content_calendar_proposal_slots_select on public.content_calendar_proposal_slots
  for select to authenticated using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- content_items: commitment identity + idempotency
-- ---------------------------------------------------------------------------

alter table public.content_items
  add column if not exists source_proposal_slot_id uuid references public.content_calendar_proposal_slots(id) on delete set null;

-- "One Slot cannot be filled twice" / "prevent duplicate commitment" as hard
-- DB constraints, not just application checks.
create unique index if not exists content_items_calendar_slot_unique
  on public.content_items (calendar_slot_id)
  where calendar_slot_id is not null;
create unique index if not exists content_items_opportunity_unique
  on public.content_items (content_opportunity_id)
  where content_opportunity_id is not null;
create unique index if not exists content_items_source_proposal_slot_unique
  on public.content_items (source_proposal_slot_id)
  where source_proposal_slot_id is not null;

-- ---------------------------------------------------------------------------
-- content_item_legacy_projections — the "compatibility record" required so
-- existing Organic/Story/Ads master + Calendar (calendar_cells) consumers
-- keep working, per the stage's "Legacy compatibility" requirement.
-- This pass implements the organic_master projection path only (the
-- dominant case); story_master/ads_master projection is a documented
-- deferral — see the Stage G implementation report.
-- ---------------------------------------------------------------------------

create table if not exists public.content_item_legacy_projections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  legacy_table text not null,
  legacy_row_id uuid not null,
  calendar_cell_id uuid,
  created_at timestamptz not null default now(),
  constraint content_item_legacy_projections_table_check
    check (legacy_table in ('organic_master', 'story_master', 'ads_master')),
  constraint content_item_legacy_projections_unique_item
    unique (content_item_id)
);

create index if not exists content_item_legacy_projections_client_idx
  on public.content_item_legacy_projections (client_id);

alter table public.content_item_legacy_projections enable row level security;
revoke all on public.content_item_legacy_projections from public, anon, authenticated;
grant select on public.content_item_legacy_projections to authenticated;
grant all on public.content_item_legacy_projections to service_role;
drop policy if exists content_item_legacy_projections_select on public.content_item_legacy_projections;
create policy content_item_legacy_projections_select on public.content_item_legacy_projections
  for select to authenticated using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- commit_calendar_proposal — the atomic commitment RPC.
--
-- Validates every assigned slot in the proposal BEFORE writing anything (a
-- single bad slot aborts the whole call with no partial state — Postgres
-- rolls back the entire function body on any raised exception since it runs
-- in one implicit transaction). Only Opportunities already at shortlisted/
-- selected are committable: this RPC advances them to scheduled, it does not
-- silently skip the human shortlist/select review step Stage F built.
-- ---------------------------------------------------------------------------

create or replace function public.commit_calendar_proposal(
  p_client_id uuid,
  p_proposal_id uuid,
  p_expected_edit_revision integer,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal record;
  v_slot record;
  v_new_item_id uuid;
  v_context_version integer;
  v_execution_version integer;
  v_created_items uuid[] := '{}';
begin
  select * into v_proposal
    from content_calendar_proposals
    where id = p_proposal_id and client_id = p_client_id
    for update;
  if not found then
    raise exception 'PROPOSAL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_proposal.status <> 'draft' then
    raise exception 'PROPOSAL_NOT_DRAFT' using errcode = 'P0002';
  end if;
  if v_proposal.edit_revision <> p_expected_edit_revision then
    raise exception 'STALE_EDIT_REVISION' using errcode = 'P0003';
  end if;

  select max(version) into v_context_version
    from client_context_files where client_id = p_client_id and status = 'approved';
  select max(version) into v_execution_version
    from client_execution_files where client_id = p_client_id and review_state = 'approved';

  -- Validation pass: every assigned slot must be committable, or nothing commits.
  for v_slot in
    select s.id, s.calendar_slot_id, s.content_opportunity_id, cs.status as slot_status
    from content_calendar_proposal_slots s
    join calendar_slots cs on cs.id = s.calendar_slot_id
    where s.proposal_id = p_proposal_id and s.content_opportunity_id is not null
  loop
    if v_slot.slot_status <> 'open' then
      raise exception 'SLOT_ALREADY_FILLED:%', v_slot.calendar_slot_id using errcode = 'P0004';
    end if;
    if exists (select 1 from content_items where calendar_slot_id = v_slot.calendar_slot_id) then
      raise exception 'SLOT_ALREADY_COMMITTED:%', v_slot.calendar_slot_id using errcode = 'P0004';
    end if;
    if exists (select 1 from content_items where content_opportunity_id = v_slot.content_opportunity_id) then
      raise exception 'OPPORTUNITY_ALREADY_COMMITTED:%', v_slot.content_opportunity_id using errcode = 'P0005';
    end if;
    if not exists (
      select 1 from content_opportunities
      where id = v_slot.content_opportunity_id and status in ('shortlisted', 'selected')
    ) then
      raise exception 'OPPORTUNITY_NOT_READY:%', v_slot.content_opportunity_id using errcode = 'P0006';
    end if;
  end loop;

  -- Commit pass.
  for v_slot in
    select id, calendar_slot_id, content_opportunity_id
    from content_calendar_proposal_slots
    where proposal_id = p_proposal_id and content_opportunity_id is not null
  loop
    insert into content_items (
      client_id, content_opportunity_id, calendar_slot_id, source_proposal_slot_id,
      title, status, context_version, execution_version, created_by
    )
    select p_client_id, v_slot.content_opportunity_id, v_slot.calendar_slot_id, v_slot.id,
           o.title, 'planned', v_context_version, v_execution_version, p_actor
    from content_opportunities o
    where o.id = v_slot.content_opportunity_id
    returning id into v_new_item_id;

    insert into content_item_sources (client_id, content_item_id, content_source_id)
    select p_client_id, v_new_item_id, cos.content_source_id
    from content_opportunity_sources cos
    where cos.content_opportunity_id = v_slot.content_opportunity_id;

    update calendar_slots set status = 'filled', filled_at = now()
      where id = v_slot.calendar_slot_id;

    -- Chain shortlisted -> selected -> scheduled in order so both hops apply
    -- correctly regardless of which state the Opportunity is in going in.
    update content_opportunities set status = 'selected', selected_at = now()
      where id = v_slot.content_opportunity_id and status = 'shortlisted';
    update content_opportunities set status = 'scheduled'
      where id = v_slot.content_opportunity_id and status = 'selected';

    v_created_items := v_created_items || v_new_item_id;
  end loop;

  update content_calendar_proposals
    set status = 'approved', approved_at = now(), approved_by = p_actor, edit_revision = edit_revision + 1
    where id = p_proposal_id;

  return jsonb_build_object('ok', true, 'created_content_item_ids', to_jsonb(v_created_items));
end;
$$;

revoke all on function public.commit_calendar_proposal(uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.commit_calendar_proposal(uuid, uuid, integer, uuid) to service_role;
