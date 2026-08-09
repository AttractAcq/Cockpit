-- Programme Stage 1B-D — Facebook Publishing, Scheduling and Reconciliation.
--
-- Extends the canonical distribution state machine (client_distribution_records)
-- for Facebook rather than creating a parallel table -- confirmed across
-- Stages 1B-A/B/C that this table, and the four generic recovery RPCs
-- (schedule_distribution_record, cancel_distribution_record,
-- retry_distribution_record, reconcile_distribution_record — all read this
-- stage, none reference platform or any provider concept), already work for
-- any platform. The only real gap is the SQL-side platform-awareness
-- deferred twice already (Stage 1B-A found it, Stage 1B-B deferred fixing it
-- because Facebook wasn't live yet). It is fixed here, now that Facebook
-- genuinely becomes a live, schedulable platform.

-- ── 1. New columns ────────────────────────────────────────────────────────

alter table public.client_distribution_records
  add column content_item_rendition_id uuid references public.content_item_renditions(id) on delete set null,
  add column provider_processing_state jsonb;

comment on column public.client_distribution_records.content_item_rendition_id is
  'Programme Stage 1B-C/D provenance: the approved content_item_renditions row this record was created from. Null for legacy/Instagram records created before Renditions existed.';
comment on column public.client_distribution_records.provider_processing_state is
  'Async provider processing state for platforms whose async model does not fit Instagram''s dedicated external_container_id/container_status columns (Facebook video: {kind, videoId, videoStatus, processingProgress}; Facebook Reels: {kind, videoId, uploadPhase, videoState}). Null for synchronous publishes (Facebook photo/feed-text) and for Instagram, which keeps using its own dedicated columns unchanged.';

alter table public.client_distribution_records
  add constraint client_distribution_records_provider_processing_state_check
    check (provider_processing_state is null or jsonb_typeof(provider_processing_state) = 'object');

-- Idempotency: at most one non-cancelled distribution record per Rendition —
-- mirrors the spirit of create-distribution-record-from-content-item's own
-- one-record-per-content-item idempotency check, but scoped to the
-- Rendition (not the Content Item), since one Content Item can legitimately
-- have both an Instagram AND a Facebook distribution record simultaneously.
create unique index client_distribution_records_active_rendition_idx
  on public.client_distribution_records (content_item_rendition_id)
  where content_item_rendition_id is not null and publish_status <> 'cancelled';

-- ── 2. Platform-aware capability function ────────────────────────────────
--
-- New 5-arg overload carries the real logic. The existing 4-arg overload now
-- delegates to it with platform='instagram' -- mathematically identical
-- output to every call that already exists, so Instagram behaviour is
-- byte-for-byte unchanged. The 3-arg overload already delegated to the
-- 4-arg one and is untouched.

create or replace function public.distribution_publication_supported(
  p_asset_format text, p_publish_settings jsonb, p_publish_payload jsonb, p_video_deliverable_id uuid, p_platform text
) returns text
language plpgsql
stable
set search_path to ''
as $$
declare
  v_content_type text := upper(coalesce(p_publish_settings ->> 'content_type', 'IMAGE'));
  v_deliverable public.video_project_deliverables;
  v_media_count integer;
begin
  if coalesce(p_platform, 'instagram') = 'facebook' then
    -- Grounded in the Stage 1B-A capability matrix and Stage 1B-C's
    -- validateFacebookRenditionFormat: IMAGE, VIDEO, REELS and TEXT_LINK are
    -- confirmed against Meta's own docs; CAROUSEL and STORIES were not and
    -- stay blocked here too, at the database layer, not just the app layer.
    if v_content_type not in ('IMAGE', 'VIDEO', 'REELS', 'TEXT_LINK') then
      return 'Facebook content type ' || v_content_type || ' is not supported.';
    end if;
    v_media_count := coalesce(jsonb_array_length(coalesce(p_publish_payload -> 'media', '[]'::jsonb)), 0);
    if v_media_count = 0 and v_content_type <> 'TEXT_LINK' then
      return 'At least one media asset is required for Facebook content type ' || v_content_type || '.';
    end if;
    return null;
  end if;

  -- Everything below is byte-for-byte the pre-existing Instagram logic,
  -- unchanged from the 4-arg version this replaces.
  if v_content_type = 'REELS' or p_asset_format = 'reel_video' then
    if p_video_deliverable_id is null then
      return 'Individual Reel Studio shot clips cannot be published. Upload the finished edit to the Reel Studio project, approve it, and publish that instead.';
    end if;
    select * into v_deliverable from public.video_project_deliverables where id = p_video_deliverable_id;
    if not found then
      return 'The linked final Reel no longer exists.';
    end if;
    if v_deliverable.upload_state is distinct from 'uploaded' then
      return 'The linked final Reel has no completed upload.';
    end if;
    if not v_deliverable.is_current or v_deliverable.superseded_at is not null then
      return 'This final Reel version has been superseded by a newer upload; only the current version can be published.';
    end if;
    if v_deliverable.status is distinct from 'approved'::public.review_state then
      return 'The final Reel must be approved before it can be scheduled or published.';
    end if;
    if v_deliverable.mime_type is distinct from 'video/mp4' then
      return 'An Instagram Reel must be an MP4 video.';
    end if;
    return null;
  end if;

  if v_content_type not in ('IMAGE', 'CAROUSEL', 'STORIES') then
    return 'Content type ' || v_content_type || ' is not supported by the current publisher.';
  end if;
  if p_asset_format not in ('feed_post', 'carousel', 'story_sequence', 'ad_static') then
    return 'Asset format ' || p_asset_format || ' is not supported by the current publisher.';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_publish_payload -> 'media', '[]'::jsonb)) item
     where lower(coalesce(item ->> 'mime_type', '')) like 'video/%'
  ) then
    return 'Video publishing is not implemented; only image posts, image carousels and image Stories can be published.';
  end if;
  return null;
end;
$$;

revoke all on function public.distribution_publication_supported(text, jsonb, jsonb, uuid, text) from public, anon;
grant execute on function public.distribution_publication_supported(text, jsonb, jsonb, uuid, text) to authenticated, service_role;

-- The existing 4-arg overload now delegates -- identical behaviour for every
-- existing caller, zero duplicated logic to drift out of sync.
create or replace function public.distribution_publication_supported(
  p_asset_format text, p_publish_settings jsonb, p_publish_payload jsonb, p_video_deliverable_id uuid
) returns text
language sql
stable
set search_path to ''
as $$
  select public.distribution_publication_supported(p_asset_format, p_publish_settings, p_publish_payload, p_video_deliverable_id, 'instagram');
$$;

-- ── 3. Update the three real call sites to pass platform ─────────────────

create or replace function public.enforce_distribution_publish_capability()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_block text;
begin
  if new.publish_status not in ('scheduled', 'publishing') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.publish_status = new.publish_status then
    return new;
  end if;

  v_block := public.distribution_publication_supported(
    new.asset_format, new.publish_settings, new.publish_payload, new.video_deliverable_id, coalesce(new.platform, 'instagram'));
  if v_block is null then
    return new;
  end if;

  raise exception 'UNSUPPORTED_PUBLICATION: %', v_block
    using errcode = 'check_violation',
          hint = 'A Reel can only be scheduled from an approved, current final Reel uploaded to its Reel Studio project.';
end;
$$;

create or replace function public.claim_due_distribution_records(p_worker_id text, p_limit integer)
returns setof public.client_distribution_records
language plpgsql
security definer
set search_path = ''
as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 10);
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then raise exception 'REFUSED: worker id required'; end if;
  return query
  update public.client_distribution_records d
  set publish_status='publishing', claimed_at=now(), claimed_by=p_worker_id, attempt_count=d.attempt_count+1, last_error=null, updated_at=now()
  where d.id in (
    select c.id from public.client_distribution_records c
    where c.publish_status='scheduled' and c.scheduled_publish_at is not null and c.scheduled_publish_at <= now()
      and (c.next_attempt_at is null or c.next_attempt_at <= now())
      and c.external_post_id is null and c.published_at is null and c.published_url is null and c.permanent_failure = false
      and public.distribution_publication_supported(c.asset_format, c.publish_settings, c.publish_payload, c.video_deliverable_id, coalesce(c.platform, 'instagram')) is null
      and not exists (select 1 from public.client_distribution_records e where e.client_id=c.client_id and e.asset_group_ref=c.asset_group_ref and e.sequence_index < c.sequence_index and e.publish_status <> 'published')
    order by c.scheduled_publish_at limit v_limit for update skip locked)
  returning d.*;
end; $$;

create or replace function public.block_unsupported_scheduled_distribution()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  with blocked as (
    select c.id,
           public.distribution_publication_supported(c.asset_format, c.publish_settings, c.publish_payload, c.video_deliverable_id, coalesce(c.platform, 'instagram')) as reason
      from public.client_distribution_records c
     where c.publish_status = 'scheduled'
       and c.external_post_id is null and c.published_at is null and c.published_url is null
  ),
  updated as (
    update public.client_distribution_records d
       set publish_status = 'failed', permanent_failure = true,
           claimed_at = null, claimed_by = null, next_attempt_at = null,
           last_error = '[unsupported_capability, non-retryable] ' || b.reason,
           updated_at = now()
      from blocked b
     where d.id = b.id and b.reason is not null
    returning d.id
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;
