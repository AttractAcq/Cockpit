-- Ideation nav consolidation, Phase 1: manual / proof-led content commit.
--
-- client_ideation_candidates (the AI-generation scoring/proposal/commit
-- pipeline) is deliberately provenance-locked: ideation_cycle_id,
-- technique_run_id, research_result_id, model_provider, model_name,
-- prompt_version and input_hash are all NOT NULL, chained through composite
-- foreign keys into client_ideation_technique_runs and
-- client_ideation_research_results. A manually-typed idea or a proof-led
-- item has no real AI run to report there, so it does not go through that
-- table — inventing fake provenance would falsify the exact audit trail
-- commit_ideation_content is built to guarantee.
--
-- This is a second, narrower commit path, owned by the Ideation tab (not
-- Content Supply — content_sources ingestion is documented in two places as
-- never writing to the Calendar or production system, and that boundary is
-- untouched here). It reuses ideation_commit_target for the asset-type to
-- master-table/Calendar-lane mapping and allocate_phase3_ref for reference
-- allocation, and mirrors the Calendar protection rules
-- commit_ideation_content enforces (an approved/archived cell blocks its
-- date+lane; at most two placements per date+lane).

create or replace function public.commit_manual_content(
  p_client_id uuid,
  p_actor_id uuid,
  p_asset_type text,
  p_working_title text,
  p_hook text,
  p_core_message text,
  p_cta text,
  p_psychological_angle text,
  p_distribution_date date,
  p_origin text,
  p_content_source_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_source record;
  v_ref text;
  v_master_id uuid;
  v_cell_id uuid;
  v_month text;
  v_existing_count integer;
  v_attempt integer;
  v_source_origin text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'MANUAL_CONTENT_COMMIT_FORBIDDEN';
  end if;

  if p_origin not in ('manual', 'proof_led') then
    raise exception 'MANUAL_CONTENT_INVALID_ORIGIN';
  end if;
  if coalesce(nullif(trim(p_working_title), ''), '') = '' then
    raise exception 'MANUAL_CONTENT_REQUIRED_FIELD_MISSING: working_title';
  end if;
  if coalesce(nullif(trim(p_hook), ''), '') = '' then
    raise exception 'MANUAL_CONTENT_REQUIRED_FIELD_MISSING: hook';
  end if;
  if coalesce(nullif(trim(p_core_message), ''), '') = '' then
    raise exception 'MANUAL_CONTENT_REQUIRED_FIELD_MISSING: core_message';
  end if;
  if coalesce(nullif(trim(p_cta), ''), '') = '' then
    raise exception 'MANUAL_CONTENT_REQUIRED_FIELD_MISSING: cta';
  end if;

  select * into v_target from public.ideation_commit_target(p_asset_type);
  if not found then
    raise exception 'MANUAL_CONTENT_UNSUPPORTED_ASSET_TYPE: %', p_asset_type;
  end if;

  -- Optional evidence link: the content_sources row this item was written
  -- from (a manual idea or a proof item). Locked for the duration of this
  -- transaction so it cannot be committed twice concurrently.
  if p_content_source_id is not null then
    select * into v_source from public.content_sources
    where id = p_content_source_id and client_id = p_client_id
    for update;
    if not found then
      raise exception 'MANUAL_CONTENT_SOURCE_NOT_FOUND';
    end if;
    if v_source.processing_status = 'processed' then
      raise exception 'MANUAL_CONTENT_SOURCE_ALREADY_COMMITTED';
    end if;

    if p_origin = 'manual' then
      if v_source.source_kind <> 'manual_idea' then
        raise exception 'MANUAL_CONTENT_SOURCE_KIND_MISMATCH';
      end if;
    else
      if v_source.source_kind <> 'proof_item' or v_source.proof_item_id is null then
        raise exception 'MANUAL_CONTENT_SOURCE_KIND_MISMATCH';
      end if;
      -- Publishable proof requires verification and consent; withdrawn,
      -- restricted or expired proof is never usable regardless of state.
      perform 1 from public.proof_items
      where id = v_source.proof_item_id
        and verification_status = 'verified'
        and consent_status in ('granted', 'not_required')
        and usage_state not in ('restricted', 'expired');
      if not found then
        raise exception 'MANUAL_CONTENT_PROOF_NOT_USABLE';
      end if;
    end if;
  end if;

  v_month := to_char(p_distribution_date, 'YYYY-MM');
  v_source_origin := case p_origin when 'proof_led' then 'Proof-led manual entry' else 'Manual entry' end;

  -- Same Calendar protection rules the Ideation AI commit enforces: an
  -- approved/archived cell blocks its date+lane, and a date+lane holds at
  -- most two placements.
  perform 1 from public.calendar_cells c
  where c.client_id = p_client_id and c.date = p_distribution_date
    and c.row_type::text = v_target.calendar_row_type
    and c.review_state in ('approved', 'archived');
  if found then
    raise exception 'MANUAL_CONTENT_CALENDAR_CONFLICT';
  end if;

  select count(*) into v_existing_count from public.calendar_cells c
  where c.client_id = p_client_id and c.date = p_distribution_date
    and c.row_type::text = v_target.calendar_row_type;
  if v_existing_count >= 2 then
    raise exception 'MANUAL_CONTENT_CALENDAR_CONFLICT';
  end if;

  v_master_id := null;
  for v_attempt in 1..5 loop
    v_ref := public.allocate_phase3_ref(p_client_id, p_distribution_date, v_target.type_code);
    if v_ref is null then
      raise exception 'MANUAL_CONTENT_REFERENCE_ALLOCATION_FAILED';
    end if;
    begin
      if v_target.master_table = 'story_master' then
        insert into public.story_master (
          client_id, month, ref, review_state, status, story_type,
          story_theme, frame_1, frame_2, frame_3, cta_engagement_prompt,
          source_origin, distribution_date
        ) values (
          p_client_id, v_month, v_ref, 'needs_review', 'idea', 'daily',
          p_working_title, p_hook, p_core_message, p_psychological_angle, p_cta,
          v_source_origin, p_distribution_date
        ) returning id into v_master_id;
      else
        insert into public.organic_master (
          client_id, month, ref, review_state, status, content_type,
          working_title, hook, core_message, cta, psychological_angle,
          source_origin, distribution_date, format_proven
        ) values (
          p_client_id, v_month, v_ref, 'needs_review', 'idea', v_target.type_code,
          p_working_title, p_hook, p_core_message, p_cta, p_psychological_angle,
          v_source_origin, p_distribution_date, false
        ) returning id into v_master_id;
      end if;
      exit;
    exception when unique_violation then
      v_master_id := null;
    end;
  end loop;
  if v_master_id is null then
    raise exception 'MANUAL_CONTENT_REFERENCE_ALLOCATION_FAILED';
  end if;

  insert into public.calendar_cells (client_id, month, date, row_type, ref, review_state)
  values (
    p_client_id, v_month, p_distribution_date,
    v_target.calendar_row_type::public.calendar_row_type, v_ref, 'needs_review'
  ) returning id into v_cell_id;

  if p_content_source_id is not null then
    update public.content_sources
    set processing_status = 'processed', processed_at = now()
    where id = p_content_source_id;
    if v_source.proof_item_id is not null then
      update public.proof_items set usage_state = 'used' where id = v_source.proof_item_id;
    end if;
  end if;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'manual_content_committed',
    'A ' || p_origin || ' content item was added directly in Ideation: ' || v_ref ||
      ' for ' || p_distribution_date::text ||
      '. It enters the normal review workflow; no production, publishing, or distribution was started.',
    v_target.master_table, v_master_id::text,
    jsonb_build_object(
      'ref', v_ref, 'asset_type', p_asset_type, 'origin', p_origin,
      'content_source_id', p_content_source_id
    )
  );

  return jsonb_build_object(
    'ref', v_ref, 'master_table', v_target.master_table,
    'master_id', v_master_id, 'calendar_cell_id', v_cell_id
  );
end;
$$;

comment on function public.commit_manual_content(uuid, uuid, text, text, text, text, text, text, date, text, uuid) is
  'aa.ideation.commit-manual.v1 — commits a manually-typed or proof-led content item directly to the operational Calendar, alongside (not through) the AI-generation candidate pipeline.';

revoke all on function public.commit_manual_content(uuid, uuid, text, text, text, text, text, text, date, text, uuid) from anon;
revoke all on function public.commit_manual_content(uuid, uuid, text, text, text, text, text, text, date, text, uuid) from authenticated;
