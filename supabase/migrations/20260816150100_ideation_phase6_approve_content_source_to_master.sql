-- Ideation nav consolidation, Phase 6 (continued): the unified Sources
-- approve/disapprove gate.
--
-- Replaces commit_manual_content (20260815120000) as the only way a
-- content_sources row becomes a master row. Differences from that function,
-- deliberate:
--   * No distribution_date, no calendar_cells write. Approval lands the row
--     in organic_master/story_master unscheduled (needs_review, status
--     'idea', distribution_date null) -- it surfaces in Content Items, and
--     only Distribute to Calendar (20260816120000) ever assigns a date.
--   * Handles all three origins content_sources now carries: manual_idea,
--     proof_item (both already existed) and ideation_candidate (new this
--     phase). ideation_candidate's asset_type/hook/core_message/cta/
--     psychological_angle are pulled from the scored candidate row itself,
--     not asked of the operator -- that content already exists and was
--     already reviewed at the Score stage.
--   * manual_idea/proof_item still require an explicit asset_type from the
--     operator (Add Idea/Add Proof never collect a format), pre-filled from
--     whatever raw text/claim was captured; the operator refines hook/CTA/
--     etc. afterwards in Content Items, same edit surface as any other row.
--
-- The ref allocated here uses today's date as allocate_phase3_ref's month
-- key, purely to mint a valid, uniquely-numbered ref -- it carries no
-- scheduling meaning. This mirrors distribute_content_items_to_calendar
-- (20260816120000), which already deletes and re-mints a fresh date-encoded
-- ref the moment a row is actually scheduled, because refs are date-stamped
-- identities in this schema. Approval-time refs are always superseded at
-- that point.

create or replace function public.approve_content_source_to_master(
  p_client_id uuid,
  p_actor_id uuid,
  p_content_source_id uuid,
  p_asset_type text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.content_sources%rowtype;
  v_candidate public.client_ideation_candidates%rowtype;
  v_proof public.proof_items%rowtype;
  v_target record;
  v_asset_type text;
  v_working_title text;
  v_hook text;
  v_core_message text;
  v_cta text;
  v_psych_angle text;
  v_source_origin text;
  v_month text;
  v_ref text;
  v_master_id uuid;
  v_attempt integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'CONTENT_SOURCE_APPROVE_FORBIDDEN';
  end if;

  select * into v_source from public.content_sources
  where id = p_content_source_id and client_id = p_client_id
  for update;
  if not found then
    raise exception 'CONTENT_SOURCE_NOT_FOUND';
  end if;
  if v_source.processing_status = 'processed' then
    raise exception 'CONTENT_SOURCE_ALREADY_COMMITTED';
  end if;
  if v_source.processing_status = 'skipped' then
    raise exception 'CONTENT_SOURCE_ALREADY_DISAPPROVED';
  end if;

  if v_source.source_kind = 'ideation_candidate' then
    select * into v_candidate from public.client_ideation_candidates
    where id = v_source.ideation_candidate_id;
    if not found then
      raise exception 'CONTENT_SOURCE_CANDIDATE_NOT_FOUND';
    end if;
    perform 1 from public.client_ideation_candidate_scores
    where candidate_id = v_candidate.id;
    if not found then
      raise exception 'CONTENT_SOURCE_CANDIDATE_NOT_SCORED';
    end if;
    v_asset_type := v_candidate.asset_type;
    v_working_title := v_candidate.working_title;
    v_hook := v_candidate.hook;
    v_core_message := v_candidate.core_message;
    v_cta := v_candidate.cta;
    v_psych_angle := v_candidate.psychological_angle;
    v_source_origin := 'AI ideation (scored)';
  elsif v_source.source_kind = 'proof_item' then
    if v_source.proof_item_id is null then
      raise exception 'CONTENT_SOURCE_PROOF_LINK_MISSING';
    end if;
    select * into v_proof from public.proof_items where id = v_source.proof_item_id;
    if not found
      or v_proof.verification_status <> 'verified'
      or v_proof.consent_status not in ('granted', 'not_required')
      or v_proof.usage_state in ('restricted', 'expired') then
      raise exception 'CONTENT_SOURCE_PROOF_NOT_USABLE';
    end if;
    if coalesce(nullif(trim(p_asset_type), ''), '') = '' then
      raise exception 'CONTENT_SOURCE_ASSET_TYPE_REQUIRED';
    end if;
    v_asset_type := p_asset_type;
    v_working_title := v_source.title;
    v_hook := v_proof.claim;
    v_core_message := v_source.raw_content;
    v_source_origin := 'Proof-led manual entry';
  elsif v_source.source_kind = 'manual_idea' then
    if coalesce(nullif(trim(p_asset_type), ''), '') = '' then
      raise exception 'CONTENT_SOURCE_ASSET_TYPE_REQUIRED';
    end if;
    v_asset_type := p_asset_type;
    v_working_title := v_source.title;
    v_hook := v_source.raw_content;
    v_source_origin := 'Manual entry';
  else
    raise exception 'CONTENT_SOURCE_UNSUPPORTED_KIND: %', v_source.source_kind;
  end if;

  select * into v_target from public.ideation_commit_target(v_asset_type);
  if not found then
    raise exception 'CONTENT_SOURCE_UNSUPPORTED_ASSET_TYPE: %', v_asset_type;
  end if;

  v_month := to_char(current_date, 'YYYY-MM');
  v_master_id := null;
  for v_attempt in 1..5 loop
    v_ref := public.allocate_phase3_ref(p_client_id, current_date, v_target.type_code);
    if v_ref is null then
      raise exception 'CONTENT_SOURCE_REFERENCE_ALLOCATION_FAILED';
    end if;
    begin
      if v_target.master_table = 'story_master' then
        insert into public.story_master (
          client_id, month, ref, review_state, status, story_type,
          story_theme, frame_1, frame_2, frame_3, cta_engagement_prompt,
          source_origin
        ) values (
          p_client_id, v_month, v_ref, 'needs_review', 'idea', 'daily',
          v_working_title, v_hook, v_core_message, v_psych_angle, v_cta,
          v_source_origin
        ) returning id into v_master_id;
      else
        insert into public.organic_master (
          client_id, month, ref, review_state, status, content_type,
          working_title, hook, core_message, cta, psychological_angle,
          source_origin, format_proven
        ) values (
          p_client_id, v_month, v_ref, 'needs_review', 'idea', v_target.type_code,
          v_working_title, v_hook, v_core_message, v_cta, v_psych_angle,
          v_source_origin, false
        ) returning id into v_master_id;
      end if;
      exit;
    exception when unique_violation then
      v_master_id := null;
    end;
  end loop;
  if v_master_id is null then
    raise exception 'CONTENT_SOURCE_REFERENCE_ALLOCATION_FAILED';
  end if;

  update public.content_sources
  set processing_status = 'processed', processed_at = now()
  where id = v_source.id;
  if v_source.proof_item_id is not null then
    update public.proof_items set usage_state = 'used' where id = v_source.proof_item_id;
  end if;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'content_source_approved',
    'A Sources item was approved into Content Items: ' || v_ref ||
      '. It is unscheduled and enters the normal review workflow; nothing was scheduled or produced.',
    v_target.master_table, v_master_id::text,
    jsonb_build_object(
      'ref', v_ref, 'asset_type', v_asset_type, 'source_kind', v_source.source_kind,
      'content_source_id', v_source.id
    )
  );

  return jsonb_build_object(
    'ref', v_ref, 'master_table', v_target.master_table, 'master_id', v_master_id
  );
end;
$$;

comment on function public.approve_content_source_to_master(uuid, uuid, uuid, text) is
  'aa.ideation.approve-source.v1 — approves a content_sources row (manual idea, proof item, or scored AI candidate) into an unscheduled master row. Supersedes commit_manual_content.';

revoke all on function public.approve_content_source_to_master(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_content_source_to_master(uuid, uuid, uuid, text) to service_role;

-- Disapprove: park the source, never touch a master table.
create or replace function public.reject_content_source(
  p_client_id uuid,
  p_actor_id uuid,
  p_content_source_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.content_sources%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'CONTENT_SOURCE_REJECT_FORBIDDEN';
  end if;

  select * into v_source from public.content_sources
  where id = p_content_source_id and client_id = p_client_id
  for update;
  if not found then
    raise exception 'CONTENT_SOURCE_NOT_FOUND';
  end if;
  if v_source.processing_status = 'processed' then
    raise exception 'CONTENT_SOURCE_ALREADY_COMMITTED';
  end if;

  update public.content_sources
  set processing_status = 'skipped',
      failure_code = 'operator_rejected',
      failure_message = nullif(trim(p_reason), '')
  where id = v_source.id;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'content_source_rejected',
    'A Sources item was disapproved and will not enter Content Items.',
    'content_sources', v_source.id::text,
    jsonb_build_object('source_kind', v_source.source_kind, 'reason', p_reason)
  );

  return jsonb_build_object('content_source_id', v_source.id, 'processing_status', 'skipped');
end;
$$;

comment on function public.reject_content_source(uuid, uuid, uuid, text) is
  'aa.ideation.reject-source.v1 — disapproves a content_sources row; it never reaches a master table.';

revoke all on function public.reject_content_source(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reject_content_source(uuid, uuid, uuid, text) to service_role;
