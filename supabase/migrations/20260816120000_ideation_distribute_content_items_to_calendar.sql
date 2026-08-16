-- Ideation nav consolidation, Phase 2: distribute selected Content Items
-- across a chosen date range on the Calendar.
--
-- Refs in this system are date-stamped identities (allocate_phase3_ref
-- embeds the target date in the ref string itself, e.g. "SEP14-FP-001"), so
-- moving an item to a different date cannot reuse its old ref -- the same
-- constraint replace_phase3_master_if_safe already works under. This
-- function therefore deletes each eligible row (and its calendar_cells
-- placement) and recreates it at the new date with a freshly allocated ref,
-- carrying its content fields over unchanged. Only a row that is still
-- needs_review and has zero downstream production (mirroring
-- replace_phase3_master_if_safe's own safety check) is eligible to move.
--
-- The actual date assignment (which item lands on which day, respecting
-- content-format cadence and any approved "Ideation Schedule Contract" in
-- Execution authority) is computed in the calling edge function using the
-- existing planIdeationProposalSlots/parseScheduleContract logic already
-- used by create-ideation-calendar-proposal. This function only applies the
-- already-decided assignments, atomically, re-validating each one at write
-- time.

create or replace function public.distribute_content_items_to_calendar(
  p_client_id uuid,
  p_actor_id uuid,
  p_assignments jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_table text;
  v_ref text;
  v_date date;
  v_row record;
  v_asset_type text;
  v_target record;
  v_downstream integer;
  v_existing_count integer;
  v_new_ref text;
  v_new_id uuid;
  v_month text;
  v_attempt integer;
  v_seen_refs text[] := '{}';
  v_moves jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'DISTRIBUTE_CONTENT_ITEMS_FORBIDDEN';
  end if;
  if jsonb_typeof(p_assignments) <> 'array' or jsonb_array_length(p_assignments) = 0 then
    raise exception 'DISTRIBUTE_CONTENT_ITEMS_EMPTY';
  end if;

  for v_item in select * from jsonb_array_elements(p_assignments)
  loop
    v_table := v_item->>'table';
    v_ref := v_item->>'ref';
    v_date := (v_item->>'date')::date;

    if v_table not in ('organic_master', 'story_master') then
      raise exception 'DISTRIBUTE_CONTENT_ITEMS_UNSUPPORTED_TABLE: %', v_ref;
    end if;
    if v_ref is null or v_date is null then
      raise exception 'DISTRIBUTE_CONTENT_ITEMS_INVALID_ASSIGNMENT';
    end if;
    if v_ref = any(v_seen_refs) then
      raise exception 'DISTRIBUTE_CONTENT_ITEMS_DUPLICATE_REF: %', v_ref;
    end if;
    v_seen_refs := v_seen_refs || v_ref;

    if v_table = 'organic_master' then
      select * into v_row from public.organic_master
      where client_id = p_client_id and ref = v_ref for update;
    else
      select * into v_row from public.story_master
      where client_id = p_client_id and ref = v_ref for update;
    end if;
    if not found then
      raise exception 'DISTRIBUTE_CONTENT_ITEMS_NOT_FOUND: %', v_ref;
    end if;
    if v_row.review_state <> 'needs_review' then
      raise exception 'DISTRIBUTE_CONTENT_ITEMS_NOT_REVIEWABLE: %', v_ref;
    end if;

    -- Same downstream guard as replace_phase3_master_if_safe: only a ref
    -- with zero downstream production is safe to move.
    select
      (select count(*) from public.client_production_briefs where client_id = p_client_id and source_ref = v_ref) +
      (select count(*) from public.client_assets where client_id = p_client_id and source_ref = v_ref) +
      (select count(*) from public.client_distribution_records where client_id = p_client_id and source_ref = v_ref) +
      (select count(*) from public.client_analytics_records where client_id = p_client_id and source_ref = v_ref) +
      (select count(*) from public.client_asset_archive_snapshots where client_id = p_client_id and source_ref = v_ref)
    into v_downstream;
    if v_downstream > 0 then
      raise exception 'DISTRIBUTE_CONTENT_ITEMS_HAS_DOWNSTREAM: %', v_ref;
    end if;

    if v_table = 'organic_master' then
      v_asset_type := case v_row.content_type
        when 'FP' then 'static' when 'CR' then 'carousel' when 'RL' then 'reel' else null end;
    else
      v_asset_type := 'story';
    end if;
    select * into v_target from public.ideation_commit_target(v_asset_type);
    if not found then
      raise exception 'DISTRIBUTE_CONTENT_ITEMS_UNSUPPORTED_ASSET_TYPE: %', v_ref;
    end if;

    -- Remove the old placement before checking the target date+lane's
    -- capacity, so moving within the same date+lane never double-counts.
    delete from public.calendar_cells where client_id = p_client_id and ref = v_ref;
    if v_table = 'organic_master' then
      delete from public.organic_master where id = v_row.id;
    else
      delete from public.story_master where id = v_row.id;
    end if;

    perform 1 from public.calendar_cells c
    where c.client_id = p_client_id and c.date = v_date
      and c.row_type::text = v_target.calendar_row_type
      and c.review_state in ('approved', 'archived');
    if found then
      raise exception 'DISTRIBUTE_CONTENT_ITEMS_CALENDAR_CONFLICT: %', v_ref;
    end if;
    select count(*) into v_existing_count from public.calendar_cells c
    where c.client_id = p_client_id and c.date = v_date and c.row_type::text = v_target.calendar_row_type;
    if v_existing_count >= 2 then
      raise exception 'DISTRIBUTE_CONTENT_ITEMS_CALENDAR_CONFLICT: %', v_ref;
    end if;

    v_month := to_char(v_date, 'YYYY-MM');
    v_new_id := null;
    for v_attempt in 1..5 loop
      v_new_ref := public.allocate_phase3_ref(p_client_id, v_date, v_target.type_code);
      if v_new_ref is null then
        raise exception 'DISTRIBUTE_CONTENT_ITEMS_REFERENCE_ALLOCATION_FAILED: %', v_ref;
      end if;
      begin
        if v_table = 'story_master' then
          insert into public.story_master (
            client_id, month, ref, review_state, status, story_type,
            story_theme, frame_1, frame_2, frame_3, cta_engagement_prompt,
            source_origin, distribution_date
          ) values (
            p_client_id, v_month, v_new_ref, 'needs_review', v_row.status, v_row.story_type,
            v_row.story_theme, v_row.frame_1, v_row.frame_2, v_row.frame_3, v_row.cta_engagement_prompt,
            coalesce(v_row.source_origin, '') || ' · rescheduled', v_date
          ) returning id into v_new_id;
        else
          insert into public.organic_master (
            client_id, month, ref, review_state, status, content_type,
            working_title, hook, core_message, cta, psychological_angle,
            source_origin, distribution_date, format_proven
          ) values (
            p_client_id, v_month, v_new_ref, 'needs_review', v_row.status, v_row.content_type,
            v_row.working_title, v_row.hook, v_row.core_message, v_row.cta, v_row.psychological_angle,
            coalesce(v_row.source_origin, '') || ' · rescheduled', v_date, v_row.format_proven
          ) returning id into v_new_id;
        end if;
        exit;
      exception when unique_violation then
        v_new_id := null;
      end;
    end loop;
    if v_new_id is null then
      raise exception 'DISTRIBUTE_CONTENT_ITEMS_REFERENCE_ALLOCATION_FAILED: %', v_ref;
    end if;

    insert into public.calendar_cells (client_id, month, date, row_type, ref, review_state)
    values (p_client_id, v_month, v_date, v_target.calendar_row_type::public.calendar_row_type, v_new_ref, 'needs_review');

    v_moves := v_moves || jsonb_build_object('old_ref', v_ref, 'new_ref', v_new_ref, 'date', v_date);
    v_count := v_count + 1;
  end loop;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'content_items_distributed_to_calendar',
    v_count::text || ' Content Item(s) were distributed onto the Calendar.',
    'calendar_cells', null,
    jsonb_build_object('moves', v_moves, 'count', v_count)
  );

  return jsonb_build_object('count', v_count, 'moves', v_moves);
end;
$$;

comment on function public.distribute_content_items_to_calendar(uuid, uuid, jsonb) is
  'aa.ideation.distribute-content-items.v1 — bulk-reschedules eligible Content Items onto new Calendar dates, reallocating a fresh ref per moved item.';

revoke all on function public.distribute_content_items_to_calendar(uuid, uuid, jsonb) from anon;
revoke all on function public.distribute_content_items_to_calendar(uuid, uuid, jsonb) from authenticated;
