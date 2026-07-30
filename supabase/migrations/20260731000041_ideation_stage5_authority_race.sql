-- Ideation Stage 5: close the Stage 4 authority-integrity race.
--
-- Forward migration only. The deployed Stage 4 migration 20260730000040 is not
-- edited; this replaces one function definition in place.
--
-- Stage 4 verified full authority content hashes in the Edge preflight and
-- re-checked identity, approval, and version inside the transaction. A content
-- edit that did not increment a version could therefore, in principle, land
-- between the two checks. The commit transaction now locks each recorded
-- authority row FOR SHARE and recomputes its content hash itself, so a
-- concurrent authority write either happens before the commit reads it (and is
-- detected as a mismatch) or waits until the commit finishes.
--
-- Nothing else about Stage 4 changes: no table is altered, no authority row is
-- mutated, no lock is taken on unrelated client authority, and every operational
-- write still happens in the same single transaction.

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
  v_authority_version integer;
  v_authority_state text;
  v_authority_hash text;
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
  -- Re-verify the authority the proposal recorded, INSIDE this transaction and
  -- under a row lock.
  --
  -- Stage 5 closes the preflight-to-transaction race: the Edge preflight
  -- verifies full content hashes, but a content edit that did not increment a
  -- version could previously slip through between preflight and commit. Each
  -- recorded authority row is now locked FOR SHARE — the narrowest lock that
  -- blocks a concurrent writer while leaving other readers unaffected — and its
  -- content hash is recomputed here. The hash is sha256 of the full content_md,
  -- exactly as reconstructScoringAuthority computes it, so the two halves agree
  -- byte for byte. Locks are held only for this transaction, and no authority
  -- row is ever modified.
  for v_authority in
    select entry->>'id' as id, (entry->>'version')::integer as version,
           entry->>'content_hash' as content_hash, 'context' as kind
    from jsonb_array_elements(coalesce(v_proposal.authority_snapshot->'context', '[]'::jsonb)) entry
    union all
    select entry->>'id', (entry->>'version')::integer, entry->>'content_hash', 'context'
    from jsonb_array_elements(coalesce(v_proposal.authority_snapshot->'strategic_playbooks', '[]'::jsonb)) entry
    union all
    select entry->>'id', (entry->>'version')::integer, entry->>'content_hash', 'execution'
    from jsonb_array_elements(coalesce(v_proposal.authority_snapshot->'execution', '[]'::jsonb)) entry
  loop
    if v_authority.kind = 'context' then
      select version, status, encode(sha256(convert_to(coalesce(content_md, ''), 'UTF8')), 'hex')
      into v_authority_version, v_authority_state, v_authority_hash
      from public.client_context_files
      where id = v_authority.id::uuid and client_id = p_client_id
      for share;
    else
      select version, review_state::text, encode(sha256(convert_to(coalesce(content_md, ''), 'UTF8')), 'hex')
      into v_authority_version, v_authority_state, v_authority_hash
      from public.client_execution_files
      where id = v_authority.id::uuid and client_id = p_client_id
      for share;
    end if;
    if not found
      or v_authority_state <> 'approved'
      or v_authority_version <> v_authority.version
      or (v_authority.content_hash is not null and v_authority_hash <> v_authority.content_hash) then
      raise exception 'IDEATION_COMMIT_AUTHORITY_SNAPSHOT_MISMATCH';
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
      'candidate_id', v_candidate.id, 'candidate_content_hash', v_candidate.input_hash,
      'mapping_version', p_mapping_version,
      -- Story type provenance. Approved authority defines no deterministic
      -- candidate-to-story-type rule, so Stage 4 uses the same neutral canonical
      -- default Phase 3 falls back to. Recording it here makes the choice, and
      -- the fact that it is a default rather than derived authority, auditable.
      'story_type', case when v_slot.master_table = 'story_master' then 'daily' else null end,
      'story_type_source', case when v_slot.master_table = 'story_master'
        then 'neutral_canonical_default' else null end);
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
