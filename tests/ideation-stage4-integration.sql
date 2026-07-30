-- Ideation Stage 4 — SQL integration and RLS.
--
-- Runs against a disposable database seeded from the authoritative production
-- schema plus the Stage 4 migration and TEST-ONLY fixtures. Verifies the one
-- atomic commit transaction: mapping, references, Calendar consistency,
-- reconciliation, replay, rollback, and access control.

\set ON_ERROR_STOP on

create or replace function pg_temp.zz_commit(
  p_expected_revision integer default 3,
  p_calendar_digest text default repeat('4', 64),
  p_proposal uuid default 'bb888888-8888-4888-8888-888888888881'
) returns jsonb
language plpgsql
as $$
begin
  return public.commit_ideation_content(
    'bb111111-1111-4111-8111-111111111111'::uuid,
    p_proposal,
    p_expected_revision,
    'bb222222-2222-4222-8222-222222222222'::uuid,
    repeat('e', 64),
    jsonb_build_object('stage', 'ideation.stage4.commit'),
    p_calendar_digest,
    'zz-commit-key',
    'aa.ideation.commit-targets.v1',
    'aa.ideation.commit-mapping.v1',
    'aa.phase3.allocate-ref.v1',
    'aa.ideation.commit-output.v1',
    'aa.ideation.commit.v1'
  );
end;
$$;

-- The commit RPC is service-role only; every check below runs as the service role
-- except the RLS block, which switches role explicitly.
-- Session-scoped so the service-role claim persists across every DO block
-- below; the RPC guard is therefore genuinely exercised, not bypassed.
select set_config('request.jwt.claim.role', 'service_role', false);

-- ==========================================================================
-- 1. Eligibility: every ineligible state is refused BEFORE any write.
-- ==========================================================================
do $$
declare
  v_state text;
  v_before_masters integer;
  v_before_cells integer;
begin
  select count(*) into v_before_masters from public.organic_master;
  select count(*) into v_before_cells from public.calendar_cells;

  -- Draft, failed, retryable, and running proposals are all refused.
  foreach v_state in array array['draft','failed','retryable','running'] loop
    update public.client_ideation_calendar_proposals
    set status = v_state,
        approved_at = case when v_state in ('draft','running','retryable','failed') then null else approved_at end,
        approved_by = case when v_state in ('draft','running','retryable','failed') then null else approved_by end,
        failed_at = case when v_state = 'failed' then now() else null end,
        lease_owner = case when v_state = 'running' then 'zz' else null end,
        lease_expires_at = case when v_state = 'running' then now() + interval '5 minutes' else null end,
        last_heartbeat_at = case when v_state = 'running' then now() else null end
    where id = 'bb888888-8888-4888-8888-888888888881';
    begin
      perform pg_temp.zz_commit();
      raise exception 'ZZ FAIL: % proposal was committed', v_state;
    exception when others then
      if sqlerrm not like '%IDEATION_COMMIT_PROPOSAL_NOT_APPROVED%' then
        raise exception 'ZZ FAIL: % gave %', v_state, sqlerrm;
      end if;
    end;
  end loop;

  update public.client_ideation_calendar_proposals
  set status = 'approved', approved_at = now(),
      approved_by = 'bb222222-2222-4222-8222-222222222222'::uuid,
      failed_at = null, lease_owner = null, lease_expires_at = null
  where id = 'bb888888-8888-4888-8888-888888888881';

  if (select count(*) from public.organic_master) <> v_before_masters
    or (select count(*) from public.calendar_cells) <> v_before_cells then
    raise exception 'ZZ FAIL: an ineligible commit created operational rows';
  end if;
  raise notice 'Stage 4 proposal-status eligibility passed.';
end
$$;

do $$
begin
  -- A stale revision is refused.
  begin
    perform pg_temp.zz_commit(p_expected_revision => 2);
    raise exception 'ZZ FAIL: stale revision committed';
  exception when others then
    if sqlerrm not like '%IDEATION_COMMIT_PROPOSAL_REVISION_CONFLICT%' then raise; end if;
  end;

  -- Calendar drift is refused.
  begin
    perform pg_temp.zz_commit(p_calendar_digest => repeat('f', 64));
    raise exception 'ZZ FAIL: stale Calendar committed';
  exception when others then
    if sqlerrm not like '%IDEATION_COMMIT_CALENDAR_SNAPSHOT_STALE%' then raise; end if;
  end;

  -- Authority drift is refused: the recorded authority file moves to a new
  -- version, exactly as an applied Context patch would move it.
  update public.client_context_files set version = version + 1
  where client_id = 'bb111111-1111-4111-8111-111111111111' and file_number = 2;
  begin
    perform pg_temp.zz_commit();
    raise exception 'ZZ FAIL: authority drift committed';
  exception when others then
    if sqlerrm like 'ZZ FAIL%' then raise; end if;
    if sqlerrm not like '%IDEATION_COMMIT_AUTHORITY_SNAPSHOT_MISMATCH%' then
      raise exception 'ZZ FAIL: authority drift gave %', sqlerrm;
    end if;
  end;
  update public.client_context_files set version = version - 1
  where client_id = 'bb111111-1111-4111-8111-111111111111' and file_number = 2;

  -- An unapproved authority file is drift too.
  update public.client_context_files set status = 'needs_review'
  where client_id = 'bb111111-1111-4111-8111-111111111111' and file_number = 2;
  begin
    perform pg_temp.zz_commit();
    raise exception 'ZZ FAIL: unapproved authority committed';
  exception when others then
    if sqlerrm like 'ZZ FAIL%' then raise; end if;
    if sqlerrm not like '%IDEATION_COMMIT_AUTHORITY_SNAPSHOT_MISMATCH%' then
      raise exception 'ZZ FAIL: unapproved authority gave %', sqlerrm;
    end if;
  end;
  update public.client_context_files set status = 'approved'
  where client_id = 'bb111111-1111-4111-8111-111111111111' and file_number = 2;

  if exists (select 1 from public.client_ideation_commit_runs) then
    raise exception 'ZZ FAIL: a refused commit persisted a run';
  end if;
  raise notice 'Stage 4 drift eligibility passed.';
end
$$;

do $$
begin
  -- An incomplete cycle is refused.
  update public.client_ideation_cycles set candidate_count = 3, shortfall_count = 1
  where id = 'bb333333-3333-4333-8333-333333333333';
  begin
    perform pg_temp.zz_commit();
    raise exception 'ZZ FAIL: incomplete cycle committed';
  exception when others then
    if sqlerrm not like '%IDEATION_COMMIT_CYCLE_NOT_ELIGIBLE%' then raise; end if;
  end;
  update public.client_ideation_cycles set candidate_count = 4, shortfall_count = 0
  where id = 'bb333333-3333-4333-8333-333333333333';

  -- An incomplete scoring run is refused.
  update public.client_ideation_scoring_runs set failed_candidate_count = 1
  where id = 'bb444444-4444-4444-8444-444444444444';
  begin
    perform pg_temp.zz_commit();
    raise exception 'ZZ FAIL: incomplete scoring run committed';
  exception when others then
    if sqlerrm not like '%IDEATION_COMMIT_SCORING_RUN_NOT_ELIGIBLE%' then raise; end if;
  end;
  update public.client_ideation_scoring_runs set failed_candidate_count = 0
  where id = 'bb444444-4444-4444-8444-444444444444';

  raise notice 'Stage 4 upstream eligibility passed.';
end
$$;

do $$
declare
  v_slot uuid := 'bbaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa00';
begin
  -- Candidate drift is refused.
  update public.client_ideation_calendar_proposal_slots
  set candidate_content_hash = repeat('b', 64) where id = v_slot;
  begin
    perform pg_temp.zz_commit();
    raise exception 'ZZ FAIL: candidate drift committed';
  exception when others then
    if sqlerrm not like '%IDEATION_COMMIT_CANDIDATE_SNAPSHOT_MISMATCH%' then raise; end if;
  end;
  update public.client_ideation_calendar_proposal_slots
  set candidate_content_hash = repeat('a', 64) where id = v_slot;

  -- Score drift is refused.
  -- The Stage 2 band-matches-score constraint moves the band with the score.
  update public.client_ideation_candidate_scores set overall_score = 55, priority_band = 'low'
  where id = 'bb999999-9999-4999-8999-999999999900';
  begin
    perform pg_temp.zz_commit();
    raise exception 'ZZ FAIL: score drift committed';
  exception when others then
    if sqlerrm not like '%IDEATION_COMMIT_SCORE_SNAPSHOT_MISMATCH%' then raise; end if;
  end;
  update public.client_ideation_candidate_scores set overall_score = 90, priority_band = 'top'
  where id = 'bb999999-9999-4999-8999-999999999900';

  if exists (select 1 from public.client_ideation_commit_items) then
    raise exception 'ZZ FAIL: drift produced commit items';
  end if;
  raise notice 'Stage 4 snapshot-drift eligibility passed.';
end
$$;

-- ==========================================================================
-- 2. Unsupported asset type: refused before any operational write.
-- ==========================================================================
do $$
declare
  v_before integer;
begin
  select count(*) into v_before from public.organic_master;
  -- The slot CHECK constrains required_asset_type, so the manifest is probed
  -- directly: an unmapped type must resolve to no target at all.
  if exists (select 1 from public.ideation_commit_target('ad')) then
    raise exception 'ZZ FAIL: ad resolved to a commit target';
  end if;
  if exists (select 1 from public.ideation_commit_target('ads')) then
    raise exception 'ZZ FAIL: ads resolved to a commit target';
  end if;
  if (select count(*) from public.ideation_commit_target('story')) <> 1 then
    raise exception 'ZZ FAIL: story did not resolve';
  end if;
  if (select master_table from public.ideation_commit_target('story')) <> 'story_master' then
    raise exception 'ZZ FAIL: story did not map to story_master';
  end if;
  if exists (
    select 1 from unnest(array['reel','carousel','static','story']) as t(asset)
    cross join lateral public.ideation_commit_target(t.asset) target
    where target.master_table = 'ads_master'
  ) then
    raise exception 'ZZ FAIL: an asset type mapped to ads_master';
  end if;
  if (select count(*) from public.organic_master) <> v_before then
    raise exception 'ZZ FAIL: target probing wrote a master row';
  end if;
  raise notice 'Stage 4 target manifest passed.';
end
$$;

-- ==========================================================================
-- 3. The happy path: one atomic commit creates everything exactly once.
-- ==========================================================================
do $$
declare
  v_result jsonb;
  v_run uuid;
  v_organic integer;
  v_story integer;
  v_cells integer;
  v_items integer;
begin
  v_result := pg_temp.zz_commit();
  if (v_result->>'replayed')::boolean then raise exception 'ZZ FAIL: first commit replayed'; end if;
  v_run := (v_result->>'commit_run_id')::uuid;

  select count(*) into v_organic from public.organic_master
  where client_id = 'bb111111-1111-4111-8111-111111111111';
  select count(*) into v_story from public.story_master
  where client_id = 'bb111111-1111-4111-8111-111111111111';
  select count(*) into v_cells from public.calendar_cells
  where client_id = 'bb111111-1111-4111-8111-111111111111';
  select count(*) into v_items from public.client_ideation_commit_items where commit_run_id = v_run;

  if v_organic <> 3 then raise exception 'ZZ FAIL: expected 3 organic rows, got %', v_organic; end if;
  if v_story <> 1 then raise exception 'ZZ FAIL: expected 1 story row, got %', v_story; end if;
  if v_cells <> 4 then raise exception 'ZZ FAIL: expected 4 calendar rows, got %', v_cells; end if;
  if v_items <> 4 then raise exception 'ZZ FAIL: expected 4 commit items, got %', v_items; end if;

  if not exists (
    select 1 from public.client_ideation_commit_runs
    where id = v_run and status = 'completed' and committed_item_count = 4
      and organic_item_count = 3 and story_item_count = 1 and failed_item_count = 0
      and completed_at is not null and failure_code is null
  ) then
    raise exception 'ZZ FAIL: the commit run did not complete cleanly';
  end if;

  raise notice 'Stage 4 commit happy path passed.';
end
$$;

-- ==========================================================================
-- 4. Target mapping, field mapping, and review state of the created rows.
-- ==========================================================================
do $$
declare
  v_row record;
  v_expected_code text;
begin
  -- Reel, carousel, and static became organic_master rows with the right code.
  for v_row in
    select i.asset_type, i.operational_ref, i.committed_date, m.content_type,
           m.review_state, m.status, m.working_title, m.hook, m.core_message, m.cta,
           m.psychological_angle, m.distribution_date, m.month, m.source_origin,
           m.storyboard_outline, m.caption_script, m.production_brief, m.distribution_channel
    from public.client_ideation_commit_items i
    join public.organic_master m on m.id = i.target_master_id
    where i.target_master_table = 'organic_master'
  loop
    -- Computed first: PL/pgSQL ends an IF expression at its first THEN, so an
    -- inline CASE would be cut short by the CASE's own THEN keywords.
    select target.type_code into v_expected_code
    from public.ideation_commit_target(v_row.asset_type) target;
    if v_row.content_type <> v_expected_code then
      raise exception 'ZZ FAIL: % mapped to content_type %', v_row.asset_type, v_row.content_type;
    end if;
    if v_row.review_state <> 'needs_review' then
      raise exception 'ZZ FAIL: committed master is not needs_review';
    end if;
    if v_row.status <> 'idea' then raise exception 'ZZ FAIL: committed master status is %', v_row.status; end if;
    if v_row.distribution_date <> v_row.committed_date then
      raise exception 'ZZ FAIL: distribution_date does not match the proposed date';
    end if;
    if v_row.month <> to_char(v_row.committed_date, 'YYYY-MM') then
      raise exception 'ZZ FAIL: month does not match the committed date';
    end if;
    if v_row.working_title is null or v_row.hook is null
      or v_row.core_message is null or v_row.cta is null then
      raise exception 'ZZ FAIL: a required candidate field was dropped';
    end if;
    if v_row.psychological_angle is null then
      raise exception 'ZZ FAIL: psychological_angle was dropped';
    end if;
    if v_row.source_origin not like 'Ideation %' then
      raise exception 'ZZ FAIL: provenance marker missing, got %', v_row.source_origin;
    end if;
    -- Nothing is fabricated: production and creative fields stay empty.
    if v_row.storyboard_outline is not null or v_row.caption_script is not null
      or v_row.production_brief is not null or v_row.distribution_channel is not null then
      raise exception 'ZZ FAIL: Stage 4 fabricated production content';
    end if;
  end loop;

  -- Story became a story_master row and was never coerced into organic_master.
  if not exists (
    select 1 from public.client_ideation_commit_items i
    join public.story_master s on s.id = i.target_master_id
    where i.asset_type = 'story' and i.target_master_table = 'story_master'
      and s.review_state = 'needs_review' and s.status = 'idea'
      and s.story_theme is not null and s.frame_1 is not null
      and s.frame_2 is not null and s.cta_engagement_prompt is not null
      and s.distribution_date = i.committed_date
  ) then
    raise exception 'ZZ FAIL: the story row was not mapped correctly';
  end if;
  if exists (
    select 1 from public.client_ideation_commit_items
    where asset_type = 'story' and target_master_table <> 'story_master'
  ) then
    raise exception 'ZZ FAIL: a story was coerced out of story_master';
  end if;
  if exists (select 1 from public.client_ideation_commit_items where target_master_table = 'ads_master') then
    raise exception 'ZZ FAIL: an item targeted ads_master';
  end if;

  -- No production brief, asset, distribution, or analytics row was created.
  if exists (select 1 from public.client_production_briefs
             where client_id = 'bb111111-1111-4111-8111-111111111111') then
    raise exception 'ZZ FAIL: a production brief was created';
  end if;
  if exists (select 1 from public.client_assets
             where client_id = 'bb111111-1111-4111-8111-111111111111') then
    raise exception 'ZZ FAIL: an asset was created';
  end if;
  if exists (select 1 from public.client_distribution_records
             where client_id = 'bb111111-1111-4111-8111-111111111111') then
    raise exception 'ZZ FAIL: a distribution record was created';
  end if;
  if exists (select 1 from public.ads_master
             where client_id = 'bb111111-1111-4111-8111-111111111111') then
    raise exception 'ZZ FAIL: an ads_master row was created';
  end if;

  raise notice 'Stage 4 master and Calendar mapping passed.';
end
$$;

-- ==========================================================================
-- 5. Reference allocation and Calendar/master agreement.
-- ==========================================================================
do $$
declare
  v_item record;
begin
  for v_item in select * from public.client_ideation_commit_items loop
    -- Canonical Phase 3 format: {MON}{DD}-{TYPE}-{NNN}.
    if v_item.operational_ref !~ '^[A-Z]{3}[0-9]{2}-(RL|CR|FP|ST)-[0-9]{3}$' then
      raise exception 'ZZ FAIL: non-canonical operational ref %', v_item.operational_ref;
    end if;
    if v_item.operational_ref like 'IDEATION/%' then
      raise exception 'ZZ FAIL: the Ideation display reference was used operationally';
    end if;
    -- The Calendar row and the master agree on client, date, ref, and lane.
    if not exists (
      select 1 from public.calendar_cells c
      where c.id = v_item.target_calendar_cell_id
        and c.client_id = v_item.client_id
        and c.date = v_item.committed_date
        and c.ref = v_item.operational_ref
        and c.row_type::text = v_item.calendar_row_type
        and c.review_state = 'needs_review'
        and c.month = v_item.execution_month
    ) then
      raise exception 'ZZ FAIL: the Calendar row disagrees with its commit item (%)', v_item.operational_ref;
    end if;
  end loop;

  -- Refs are unique, and the type code matches the asset type.
  if (select count(distinct operational_ref) from public.client_ideation_commit_items) <> 4 then
    raise exception 'ZZ FAIL: operational refs are not unique';
  end if;
  if exists (
    select 1 from public.client_ideation_commit_items
    where split_part(operational_ref, '-', 2) <> case asset_type
      when 'reel' then 'RL' when 'carousel' then 'CR'
      when 'static' then 'FP' when 'story' then 'ST' end
  ) then
    raise exception 'ZZ FAIL: an operational ref used the wrong type code';
  end if;

  -- No orphan master and no orphan Calendar row exists.
  if exists (
    select 1 from public.calendar_cells c
    where c.client_id = 'bb111111-1111-4111-8111-111111111111'
      and not exists (select 1 from public.organic_master m where m.client_id = c.client_id and m.ref = c.ref)
      and not exists (select 1 from public.story_master s where s.client_id = c.client_id and s.ref = c.ref)
  ) then
    raise exception 'ZZ FAIL: an orphan Calendar row exists';
  end if;
  if exists (
    select 1 from public.organic_master m
    where m.client_id = 'bb111111-1111-4111-8111-111111111111'
      and not exists (select 1 from public.calendar_cells c where c.client_id = m.client_id and c.ref = m.ref)
  ) then
    raise exception 'ZZ FAIL: an orphan organic master exists';
  end if;

  raise notice 'Stage 4 reference allocation and Calendar consistency passed.';
end
$$;

-- ==========================================================================
-- 6. Exact reconciliation: per record, never by aggregate alone.
-- ==========================================================================
do $$
declare
  v_run uuid;
begin
  select id into v_run from public.client_ideation_commit_runs where status = 'completed';

  if exists (
    select 1 from public.client_ideation_calendar_proposal_slots s
    where s.proposal_id = 'bb888888-8888-4888-8888-888888888881'
      and not exists (
        select 1 from public.client_ideation_commit_items i
        where i.commit_run_id = v_run and i.proposal_slot_id = s.id)
  ) then
    raise exception 'ZZ FAIL: a proposal slot has no commit item';
  end if;
  if (select count(distinct proposal_slot_id) from public.client_ideation_commit_items
      where commit_run_id = v_run) <> 4 then
    raise exception 'ZZ FAIL: slots did not reconcile one-to-one';
  end if;
  if (select count(distinct candidate_id) from public.client_ideation_commit_items
      where commit_run_id = v_run) <> 4 then
    raise exception 'ZZ FAIL: candidates did not reconcile one-to-one';
  end if;
  if (select count(distinct target_master_id) from public.client_ideation_commit_items
      where commit_run_id = v_run) <> 4 then
    raise exception 'ZZ FAIL: target master ids are not unique';
  end if;
  if (select count(distinct target_calendar_cell_id) from public.client_ideation_commit_items
      where commit_run_id = v_run) <> 4 then
    raise exception 'ZZ FAIL: target Calendar ids are not unique';
  end if;
  -- Provenance is exact in both directions.
  if exists (
    select 1 from public.client_ideation_commit_items i
    join public.client_ideation_calendar_proposal_slots s on s.id = i.proposal_slot_id
    where i.candidate_id <> s.candidate_id
      or i.candidate_score_id <> s.candidate_score_id
      or i.candidate_rank_snapshot <> s.candidate_rank_snapshot
      or i.candidate_score_snapshot <> s.candidate_score_snapshot
      or i.committed_date <> s.proposed_date
      or i.asset_type <> s.required_asset_type
  ) then
    raise exception 'ZZ FAIL: commit-item provenance does not match its slot';
  end if;

  raise notice 'Stage 4 exact reconciliation passed.';
end
$$;

-- ==========================================================================
-- 7. Idempotent replay: a completed commit creates nothing further.
-- ==========================================================================
do $$
declare
  v_result jsonb;
  v_run uuid;
  v_masters integer;
  v_cells integer;
  v_items integer;
  v_runs integer;
begin
  select id into v_run from public.client_ideation_commit_runs where status = 'completed';
  select count(*) into v_masters from public.organic_master;
  select count(*) into v_cells from public.calendar_cells;
  select count(*) into v_items from public.client_ideation_commit_items;
  select count(*) into v_runs from public.client_ideation_commit_runs;

  v_result := pg_temp.zz_commit();
  if not (v_result->>'replayed')::boolean then raise exception 'ZZ FAIL: the replay was not flagged'; end if;
  if (v_result->>'commit_run_id')::uuid <> v_run then
    raise exception 'ZZ FAIL: the replay returned a different commit run';
  end if;
  if (select count(*) from public.organic_master) <> v_masters
    or (select count(*) from public.calendar_cells) <> v_cells
    or (select count(*) from public.client_ideation_commit_items) <> v_items
    or (select count(*) from public.client_ideation_commit_runs) <> v_runs then
    raise exception 'ZZ FAIL: the replay created new rows';
  end if;

  -- A completed commit can never be recommitted, even at a different revision.
  begin
    perform pg_temp.zz_commit(p_expected_revision => 4);
    raise exception 'ZZ FAIL: a committed proposal was recommitted';
  exception when others then
    if sqlerrm like 'ZZ FAIL%' then raise; end if;
  end;

  raise notice 'Stage 4 idempotent replay passed.';
end
$$;

-- ==========================================================================
-- 8. Activity logging.
-- ==========================================================================
do $$
declare
  v_message text;
  v_metadata jsonb;
begin
  select plain_english_message, metadata into v_message, v_metadata
  from public.activity_log
  where event_type = 'ideation_content_committed'
    and client_id = 'bb111111-1111-4111-8111-111111111111';
  if v_message is null then raise exception 'ZZ FAIL: no commit activity was logged'; end if;
  if v_message not like '%Content%' or v_message not like '%Calendar%' then
    raise exception 'ZZ FAIL: the activity message does not state what was created';
  end if;
  if v_message not like '%no production, publishing, or distribution was started%' then
    raise exception 'ZZ FAIL: the activity message does not state what did NOT happen';
  end if;
  if (v_metadata->>'item_count')::integer <> 4
    or (v_metadata->>'organic_count')::integer <> 3
    or (v_metadata->>'story_count')::integer <> 1 then
    raise exception 'ZZ FAIL: activity metadata counts are wrong';
  end if;
  if v_metadata->>'proposal_id' is null or v_metadata->>'ideation_cycle_id' is null
    or v_metadata->>'scoring_run_id' is null then
    raise exception 'ZZ FAIL: activity metadata is missing provenance';
  end if;
  -- No candidate body, authority body, or secret is logged.
  if v_metadata::text like '%ZZ message%' or v_metadata::text like '%approved context body%' then
    raise exception 'ZZ FAIL: activity metadata leaked content';
  end if;

  raise notice 'Stage 4 activity logging passed.';
end
$$;

-- ==========================================================================
-- 9. RLS: staff read for their own client only; no direct writes at all.
-- ==========================================================================
do $$
declare
  v_visible integer;
begin
  -- Admin sees the commit rows.
  perform set_config('request.jwt.claim.sub', 'bb222222-2222-4222-8222-222222222222', false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  set local role authenticated;
  select count(*) into v_visible from public.client_ideation_commit_runs;
  if v_visible < 1 then raise exception 'ZZ FAIL: an admin cannot read commit runs'; end if;
  select count(*) into v_visible from public.client_ideation_commit_items;
  if v_visible < 4 then raise exception 'ZZ FAIL: an admin cannot read commit items'; end if;
  reset role;

  -- A manager scoped to another client sees nothing.
  perform set_config('request.jwt.claim.sub', 'bb222222-2222-4222-8222-2222222222ee', false);
  set local role authenticated;
  select count(*) into v_visible from public.client_ideation_commit_runs;
  if v_visible <> 0 then raise exception 'ZZ FAIL: cross-client commit runs are visible'; end if;
  select count(*) into v_visible from public.client_ideation_commit_items;
  if v_visible <> 0 then raise exception 'ZZ FAIL: cross-client commit items are visible'; end if;
  reset role;

  -- Anonymous sees nothing.
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'anon', false);
  set local role anon;
  begin
    select count(*) into v_visible from public.client_ideation_commit_runs;
    if v_visible <> 0 then raise exception 'ZZ FAIL: anonymous can read commit runs'; end if;
  exception when insufficient_privilege then
    null; -- denial by grant is equally acceptable
  end;
  reset role;

  perform set_config('request.jwt.claim.role', 'service_role', false);
  raise notice 'Stage 4 RLS read isolation passed.';
end
$$;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'bb222222-2222-4222-8222-222222222222', false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  set local role authenticated;

  begin
    insert into public.client_ideation_commit_runs (
      client_id, ideation_cycle_id, scoring_run_id, proposal_id, idempotency_key,
      configuration_hash, calendar_digest, proposal_version, proposal_edit_revision,
      target_manifest_version, mapping_version, reference_allocator_version,
      output_schema_version, module_version, period_start, period_end, expected_item_count
    ) values (
      'bb111111-1111-4111-8111-111111111111', 'bb333333-3333-4333-8333-333333333333',
      'bb444444-4444-4444-8444-444444444444', 'bb888888-8888-4888-8888-888888888881',
      'zz-direct', repeat('a', 64), repeat('b', 64), 1, 3, 'v', 'v', 'v', 'v', 'v',
      '2026-08-01', '2026-08-07', 4
    );
    raise exception 'ZZ FAIL: authenticated INSERT into commit runs succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.client_ideation_commit_runs set status = 'failed';
    raise exception 'ZZ FAIL: authenticated UPDATE of commit runs succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.client_ideation_commit_items;
    raise exception 'ZZ FAIL: authenticated DELETE of commit items succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.commit_ideation_content(
      'bb111111-1111-4111-8111-111111111111'::uuid,
      'bb888888-8888-4888-8888-888888888881'::uuid, 3,
      'bb222222-2222-4222-8222-222222222222'::uuid, repeat('e', 64), '{}'::jsonb,
      repeat('4', 64), 'k', 'v', 'v', 'v', 'v', 'v');
    raise exception 'ZZ FAIL: authenticated EXECUTE of the commit RPC succeeded';
  exception when insufficient_privilege then null;
  end;

  reset role;
  perform set_config('request.jwt.claim.role', 'service_role', false);
  raise notice 'Stage 4 RLS write lockdown passed.';
end
$$;

select 'Stage 4 SQL integration and RLS passed.' as result;
