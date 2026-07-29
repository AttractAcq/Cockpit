-- Ideation Stage 3 — integration and RLS behaviour against the applied schema.
-- Requires tests/ideation-stage3-fixtures.sql to have run first.

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

-- Assigns every candidate to a type-compatible slot in one batch. Slots and
-- candidates are ranked independently, then paired by (asset_type, rank).
create or replace function pg_temp.zz3_assign_all(p_proposal uuid, p_owner text)
returns void language plpgsql as $$
declare
  v_payload jsonb;
begin
  with open_slots as (
    select proposal_slot_key, required_asset_type,
      row_number() over (partition by required_asset_type order by proposal_slot_key) as rn
    from public.client_ideation_calendar_proposal_slots
    where proposal_id = p_proposal and candidate_id is null
  ),
  free_candidates as (
    select c.id, c.asset_type,
      row_number() over (partition by c.asset_type order by c.id) as rn
    from public.client_ideation_candidates c
    where c.ideation_cycle_id = 'aa333333-3333-4333-8333-333333333333'
      and not exists (
        select 1 from public.client_ideation_calendar_proposal_slots s
        where s.proposal_id = p_proposal and s.candidate_id = c.id
      )
  )
  select jsonb_agg(jsonb_build_object(
    'proposal_slot_key', open_slots.proposal_slot_key,
    'candidate_id', free_candidates.id,
    'candidate_display_reference', 'IDEATION/aa333333/ZZZ-XX-01',
    'placement_rationale', 'ZZ placement rationale.',
    'authority_references', '[]'::jsonb,
    'evidence_references', '[]'::jsonb,
    'warnings', '[]'::jsonb
  ))
  into v_payload
  from open_slots
  join free_candidates
    on free_candidates.asset_type = open_slots.required_asset_type
   and free_candidates.rn = open_slots.rn;

  if v_payload is null then return; end if;
  perform public.persist_ideation_proposal_batch(p_proposal, p_owner, v_payload);
end
$$;

-- ---------------------------------------------------------------------------
-- Happy path: begin -> assign -> draft -> approve.
-- ---------------------------------------------------------------------------
do $$
declare
  v_begin jsonb; v_proposal uuid; v_row record; v_actor uuid := 'aa222222-2222-4222-8222-222222222222';
begin
  v_begin := pg_temp.zz3_begin('zz3-p1', repeat('5', 64), 'zz3-owner-1', null);
  if (v_begin->>'created')::boolean is not true then raise exception 'BEGIN_DID_NOT_CREATE'; end if;
  v_proposal := (v_begin->'proposal'->>'id')::uuid;

  if (select count(*) from public.client_ideation_calendar_proposal_slots where proposal_id = v_proposal) <> 8 then
    raise exception 'SLOTS_NOT_MATERIALISED';
  end if;
  if (select unassigned_candidate_count from public.client_ideation_calendar_proposals where id = v_proposal) <> 8 then
    raise exception 'UNASSIGNED_COUNT_WRONG';
  end if;

  -- Completion is impossible while any slot is empty.
  begin
    perform public.complete_ideation_calendar_proposal(v_proposal, 'zz3-owner-1', '[]'::jsonb, v_actor);
    raise exception 'INCOMPLETE_PROPOSAL_COMPLETED';
  exception when others then
    if sqlerrm not like '%PROPOSAL_%' then raise; end if;
  end;

  perform pg_temp.zz3_assign_all(v_proposal, 'zz3-owner-1');
  if (select count(*) from public.client_ideation_calendar_proposal_slots
      where proposal_id = v_proposal and candidate_id is null) <> 0 then
    raise exception 'ASSIGNMENT_INCOMPLETE';
  end if;

  perform public.complete_ideation_calendar_proposal(v_proposal, 'zz3-owner-1', '[]'::jsonb, v_actor);
  select * into v_row from public.client_ideation_calendar_proposals where id = v_proposal;
  if v_row.status <> 'draft' then raise exception 'NOT_DRAFT'; end if;
  if v_row.assigned_slot_count <> 8 or v_row.unassigned_candidate_count <> 0 then
    raise exception 'DRAFT_COUNTS_WRONG';
  end if;
  if v_row.lease_owner is not null then raise exception 'LEASE_NOT_CLEARED'; end if;

  raise notice 'Stage 3 happy path passed.';
end
$$;

-- ---------------------------------------------------------------------------
-- Manual editing with optimistic concurrency.
-- ---------------------------------------------------------------------------
do $$
declare
  v_proposal uuid; v_actor uuid := 'aa222222-2222-4222-8222-222222222222';
  v_client uuid := 'aa111111-1111-4111-8111-111111111111';
  v_from text; v_to text; v_candidate uuid; v_revision integer; v_swap text;
begin
  select id, edit_revision into v_proposal, v_revision
  from public.client_ideation_calendar_proposals where idempotency_key = 'zz3-p1';

  select proposal_slot_key, candidate_id into v_from, v_candidate
  from public.client_ideation_calendar_proposal_slots
  where proposal_id = v_proposal and required_asset_type = 'reel' order by proposal_slot_key limit 1;

  -- Remove sends the candidate to the unassigned pool and bumps the revision.
  perform public.edit_ideation_proposal_assignment(
    v_proposal, v_client, 'unassign', v_from, null, null, v_revision, v_actor);
  if (select candidate_id from public.client_ideation_calendar_proposal_slots
      where proposal_id = v_proposal and proposal_slot_key = v_from) is not null then
    raise exception 'UNASSIGN_DID_NOT_CLEAR';
  end if;
  select edit_revision into v_revision from public.client_ideation_calendar_proposals where id = v_proposal;
  if (select unassigned_candidate_count from public.client_ideation_calendar_proposals where id = v_proposal) <> 1 then
    raise exception 'UNASSIGNED_POOL_WRONG';
  end if;

  -- A stale revision must fail rather than overwrite the newer edit.
  begin
    perform public.edit_ideation_proposal_assignment(
      v_proposal, v_client, 'assign', null, v_from, v_candidate, v_revision - 1, v_actor);
    raise exception 'STALE_REVISION_ACCEPTED';
  exception when others then
    if sqlerrm not like '%PROPOSAL_EDIT_REVISION_CONFLICT%' then raise; end if;
  end;

  -- Restore back into the same compatible slot.
  perform public.edit_ideation_proposal_assignment(
    v_proposal, v_client, 'assign', null, v_from, v_candidate, v_revision, v_actor);
  if (select candidate_id from public.client_ideation_calendar_proposal_slots
      where proposal_id = v_proposal and proposal_slot_key = v_from) <> v_candidate then
    raise exception 'RESTORE_FAILED';
  end if;
  select edit_revision into v_revision from public.client_ideation_calendar_proposals where id = v_proposal;

  -- An incompatible target asset type must fail.
  select proposal_slot_key into v_to from public.client_ideation_calendar_proposal_slots
  where proposal_id = v_proposal and required_asset_type = 'story' order by proposal_slot_key limit 1;
  begin
    perform public.edit_ideation_proposal_assignment(
      v_proposal, v_client, 'move', v_from, v_to, null, v_revision, v_actor);
    raise exception 'INCOMPATIBLE_MOVE_ACCEPTED';
  exception when others then
    if sqlerrm not like '%PROPOSAL_ASSET_TYPE_INCOMPATIBLE%' then raise; end if;
  end;

  -- An occupied target must fail.
  select proposal_slot_key into v_swap from public.client_ideation_calendar_proposal_slots
  where proposal_id = v_proposal and required_asset_type = 'reel'
    and proposal_slot_key <> v_from and candidate_id is not null order by proposal_slot_key limit 1;
  begin
    perform public.edit_ideation_proposal_assignment(
      v_proposal, v_client, 'move', v_from, v_swap, null, v_revision, v_actor);
    raise exception 'OCCUPIED_MOVE_ACCEPTED';
  exception when others then
    if sqlerrm not like '%PROPOSAL_SLOT_ALREADY_OCCUPIED%' then raise; end if;
  end;

  -- A compatible swap succeeds and exchanges both candidates.
  perform public.edit_ideation_proposal_assignment(
    v_proposal, v_client, 'swap', v_from, v_swap, null, v_revision, v_actor);
  if (select candidate_id from public.client_ideation_calendar_proposal_slots
      where proposal_id = v_proposal and proposal_slot_key = v_swap) <> v_candidate then
    raise exception 'SWAP_DID_NOT_EXCHANGE';
  end if;
  if (select count(*) from public.client_ideation_calendar_proposal_slots
      where proposal_id = v_proposal and candidate_id is null) <> 0 then
    raise exception 'SWAP_LOST_A_CANDIDATE';
  end if;

  -- Every successful edit is written to the activity log. Three succeeded here
  -- (unassign, restore, swap); the three rejected edits log nothing.
  if (select count(*) from public.activity_log
      where object_id = v_proposal::text and event_type = 'ideation_calendar_proposal_edited') <> 3 then
    raise exception 'EDITS_NOT_LOGGED';
  end if;

  raise notice 'Stage 3 manual editing passed.';
end
$$;

-- ---------------------------------------------------------------------------
-- Conflict refresh and approval.
-- ---------------------------------------------------------------------------
do $$
declare
  v_proposal uuid; v_actor uuid := 'aa222222-2222-4222-8222-222222222222';
  v_client uuid := 'aa111111-1111-4111-8111-111111111111';
  v_revision integer; v_digest text := repeat('7', 64); v_row record; v_slot text;
begin
  select id, edit_revision into v_proposal, v_revision
  from public.client_ideation_calendar_proposals where idempotency_key = 'zz3-p1';

  -- A stale Calendar digest must block approval.
  begin
    perform public.approve_ideation_calendar_proposal(v_proposal, v_client, v_revision, repeat('0', 64), v_actor);
    raise exception 'STALE_CALENDAR_APPROVED';
  exception when others then
    if sqlerrm not like '%PROPOSAL_CALENDAR_SNAPSHOT_STALE%' then raise; end if;
  end;

  -- An unresolved protected conflict must block approval.
  select proposal_slot_key into v_slot from public.client_ideation_calendar_proposal_slots
  where proposal_id = v_proposal order by proposal_slot_key limit 1;
  perform public.refresh_ideation_proposal_conflicts(
    v_proposal, v_client,
    jsonb_build_array(jsonb_build_object('proposal_slot_key', v_slot,
      'conflict_status', 'protected',
      'conflict_details', jsonb_build_object('reason', 'ZZ approved content occupies this date.'))),
    '{}'::jsonb, v_digest, v_revision, v_actor);
  select edit_revision into v_revision from public.client_ideation_calendar_proposals where id = v_proposal;
  if (select unresolved_conflict_count from public.client_ideation_calendar_proposals where id = v_proposal) <> 1 then
    raise exception 'CONFLICT_NOT_COUNTED';
  end if;
  begin
    perform public.approve_ideation_calendar_proposal(v_proposal, v_client, v_revision, v_digest, v_actor);
    raise exception 'UNRESOLVED_CONFLICT_APPROVED';
  exception when others then
    if sqlerrm not like '%PROPOSAL_UNRESOLVED_CONFLICT%' then raise; end if;
  end;

  -- Resolving the conflict allows approval.
  perform public.refresh_ideation_proposal_conflicts(
    v_proposal, v_client,
    jsonb_build_array(jsonb_build_object('proposal_slot_key', v_slot,
      'conflict_status', 'clear', 'conflict_details', '{}'::jsonb)),
    '{}'::jsonb, v_digest, v_revision, v_actor);
  select edit_revision into v_revision from public.client_ideation_calendar_proposals where id = v_proposal;

  perform public.approve_ideation_calendar_proposal(v_proposal, v_client, v_revision, v_digest, v_actor);
  select * into v_row from public.client_ideation_calendar_proposals where id = v_proposal;
  if v_row.status <> 'approved' then raise exception 'NOT_APPROVED'; end if;
  if v_row.approved_at is null or v_row.approved_by is null then raise exception 'APPROVAL_PROVENANCE_MISSING'; end if;

  -- An approved proposal is immutable.
  begin
    perform public.edit_ideation_proposal_assignment(
      v_proposal, v_client, 'unassign', v_slot, null, null, v_row.edit_revision, v_actor);
    raise exception 'APPROVED_PROPOSAL_EDITED';
  exception when others then
    if sqlerrm not like '%PROPOSAL_NOT_EDITABLE%' then raise; end if;
  end;

  -- Approval creates no operational Calendar or master row.
  if (select count(*) from public.calendar_cells where client_id = v_client) <> 2 then
    raise exception 'APPROVAL_WROTE_CALENDAR';
  end if;

  raise notice 'Stage 3 approval passed.';
end
$$;

-- ---------------------------------------------------------------------------
-- Regeneration preserves history and supersedes the previous approved proposal.
-- ---------------------------------------------------------------------------
do $$
declare
  v_previous uuid; v_new uuid; v_begin jsonb;
  v_actor uuid := 'aa222222-2222-4222-8222-222222222222';
  v_client uuid := 'aa111111-1111-4111-8111-111111111111';
  v_revision integer; v_digest text := repeat('7', 64);
begin
  select id into v_previous from public.client_ideation_calendar_proposals
  where idempotency_key = 'zz3-p1';

  v_begin := pg_temp.zz3_begin('zz3-p2', repeat('4', 64), 'zz3-owner-2', v_previous);
  if (v_begin->>'created')::boolean is not true then raise exception 'REGENERATE_NOT_CREATED'; end if;
  v_new := (v_begin->'proposal'->>'id')::uuid;
  if (v_begin->'proposal'->>'supersedes_proposal_id')::uuid <> v_previous then
    raise exception 'PREDECESSOR_NOT_RECORDED';
  end if;
  if (v_begin->'proposal'->>'proposal_version')::integer <= 1 then raise exception 'VERSION_NOT_INCREMENTED'; end if;

  -- The previous approved proposal and all its placements are untouched.
  if (select status from public.client_ideation_calendar_proposals where id = v_previous) <> 'approved' then
    raise exception 'HISTORY_LOST';
  end if;
  if (select count(*) from public.client_ideation_calendar_proposal_slots where proposal_id = v_previous) <> 8 then
    raise exception 'HISTORICAL_SLOTS_LOST';
  end if;

  perform pg_temp.zz3_assign_all(v_new, 'zz3-owner-2');
  perform public.complete_ideation_calendar_proposal(v_new, 'zz3-owner-2', '[]'::jsonb, v_actor);
  select edit_revision into v_revision from public.client_ideation_calendar_proposals where id = v_new;
  update public.client_ideation_calendar_proposals set calendar_conflict_digest = v_digest where id = v_new;
  perform public.approve_ideation_calendar_proposal(v_new, v_client, v_revision, v_digest, v_actor);

  if (select status from public.client_ideation_calendar_proposals where id = v_new) <> 'approved' then
    raise exception 'REGENERATED_NOT_APPROVED';
  end if;
  if (select status from public.client_ideation_calendar_proposals where id = v_previous) <> 'superseded' then
    raise exception 'PREVIOUS_NOT_SUPERSEDED';
  end if;
  if (select count(*) from public.client_ideation_calendar_proposal_slots where proposal_id = v_previous) <> 8 then
    raise exception 'SUPERSEDED_SLOTS_LOST';
  end if;

  raise notice 'Stage 3 regeneration and supersession passed.';
end
$$;

-- ---------------------------------------------------------------------------
-- Idempotent replay.
-- ---------------------------------------------------------------------------
do $$
declare v_before integer; v_replay jsonb;
begin
  select count(*) into v_before from public.client_ideation_calendar_proposals;
  v_replay := pg_temp.zz3_begin('zz3-p1', repeat('5', 64), 'zz3-owner-9', null);
  if (v_replay->>'created')::boolean is not false then raise exception 'REPLAY_CREATED_DUPLICATE'; end if;
  if (select count(*) from public.client_ideation_calendar_proposals) <> v_before then
    raise exception 'REPLAY_ADDED_A_PROPOSAL';
  end if;
  raise notice 'Stage 3 idempotent replay passed.';
end
$$;

-- ---------------------------------------------------------------------------
-- RLS.
-- ---------------------------------------------------------------------------
do $$
declare
  v_manager uuid := 'aa222222-2222-4222-8222-2222222222ff';
  v_actor uuid := 'aa222222-2222-4222-8222-222222222222';
  v_proposal uuid;
begin
  select id into v_proposal from public.client_ideation_calendar_proposals limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_manager::text, true);

  if (select count(*) from public.client_ideation_calendar_proposals) < 1 then
    raise exception 'STAFF_SELECT_DENIED_UNEXPECTEDLY';
  end if;
  if (select count(*) from public.client_ideation_calendar_proposal_slots) < 1 then
    raise exception 'STAFF_SLOT_SELECT_DENIED_UNEXPECTEDLY';
  end if;
  if exists (select 1 from public.client_ideation_calendar_proposals
             where client_id = 'aa111111-1111-4111-8111-1111111111ff') then
    raise exception 'CROSS_CLIENT_SELECT_LEAKED';
  end if;

  begin
    update public.client_ideation_calendar_proposals set status = 'approved' where id = v_proposal;
    raise exception 'AUTHENTICATED_UPDATE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.client_ideation_calendar_proposals where id = v_proposal;
    raise exception 'AUTHENTICATED_DELETE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.client_ideation_calendar_proposal_slots set candidate_id = null where proposal_id = v_proposal;
    raise exception 'AUTHENTICATED_SLOT_UPDATE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.client_ideation_calendar_proposal_slots where proposal_id = v_proposal;
    raise exception 'AUTHENTICATED_SLOT_DELETE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.approve_ideation_calendar_proposal(v_proposal, 'aa111111-1111-4111-8111-111111111111', 0, repeat('7',64), v_actor);
    raise exception 'AUTHENTICATED_RPC_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.edit_ideation_proposal_assignment(
      v_proposal, 'aa111111-1111-4111-8111-111111111111', 'unassign', 'x', null, null, 0, v_actor);
    raise exception 'AUTHENTICATED_EDIT_RPC_ALLOWED';
  exception when insufficient_privilege then null;
  end;

  reset role;
  raise notice 'Stage 3 RLS passed.';
end
$$;

do $$
begin
  set local role anon;
  begin
    perform 1 from public.client_ideation_calendar_proposals limit 1;
    raise exception 'ANON_SELECT_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.client_ideation_calendar_proposal_slots limit 1;
    raise exception 'ANON_SLOT_SELECT_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'Stage 3 anonymous denial passed.';
end
$$;
