-- Reel Studio Phase 2 — additive only. Historical migrations remain unchanged.
--
--   A. Production-mode contract: allow 'hybrid' alongside 'human'/'ai'.
--   C. Provider failure recovery: per-phase failure tracking on video_shots plus
--      two concurrency-safe recovery RPCs (still reset / video reset).
--   E. Distribution capability gate: a trigger that refuses to move an
--      unsupported publication (Reels / video media) into a scheduled or
--      publishing state, so the server enforces the rule even if the frontend
--      and the scoped RPCs are bypassed.

-- ── A. Production mode: human | ai | hybrid ─────────────────────────────────
alter table public.client_production_briefs drop constraint if exists client_production_briefs_production_mode_check;
alter table public.client_production_briefs add constraint client_production_briefs_production_mode_check
  check (production_mode is null or production_mode = any (array['human'::text, 'ai'::text, 'hybrid'::text]));

-- ── C. Per-phase provider failure tracking ──────────────────────────────────
-- A single `failed` status cannot tell an operator which half of the two-stage
-- Higgsfield pipeline broke. These columns are nullable and additive: rows that
-- failed before this migration keep failure_stage NULL and are classified by the
-- derivation below (same rule as _shared/reel-studio-recovery.ts).
alter table public.video_shots add column if not exists failure_stage text;
alter table public.video_shots add column if not exists failed_at timestamptz;
alter table public.video_shots add column if not exists still_attempt_count integer not null default 0;
alter table public.video_shots add column if not exists video_attempt_count integer not null default 0;
alter table public.video_shots add column if not exists last_still_attempt_at timestamptz;
alter table public.video_shots add column if not exists last_video_attempt_at timestamptz;

alter table public.video_shots drop constraint if exists video_shots_failure_stage_check;
alter table public.video_shots add constraint video_shots_failure_stage_check
  check (failure_stage is null or failure_stage = any (array[
    'still_submit'::text, 'still_render'::text, 'still_download'::text,
    'video_submit'::text, 'video_render'::text, 'video_download'::text
  ]));

alter table public.video_shots drop constraint if exists video_shots_still_attempt_count_check;
alter table public.video_shots add constraint video_shots_still_attempt_count_check check (still_attempt_count >= 0);
alter table public.video_shots drop constraint if exists video_shots_video_attempt_count_check;
alter table public.video_shots add constraint video_shots_video_attempt_count_check check (video_attempt_count >= 0);

comment on column public.video_shots.failure_stage is
  'Which provider phase produced the current failed status. NULL on pre-Phase-2 failures; derive with reel_shot_failure_phase().';

-- Derivation for rows with no recorded stage: a clip means nothing is left to
-- recover; a video job or a stored still means the video half broke; otherwise
-- the still half broke. Mirrors classifyReelShotFailure() in TypeScript.
create or replace function public.reel_shot_failure_phase(p_shot public.video_shots)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_shot.status is distinct from 'failed' then null
    when p_shot.failure_stage like 'still\_%' then 'still'
    when p_shot.failure_stage like 'video\_%' then 'video'
    when p_shot.higgsfield_job_id is not null or p_shot.still_image_url is not null then 'video'
    else 'still'
  end;
$$;

-- Reset a terminally-failed STILL phase so a fresh still job can be submitted.
-- Concurrency: FOR UPDATE + an expected updated_at. Two simultaneous retries can
-- never both succeed, so no duplicate provider job is ever created.
create or replace function public.reset_failed_reel_shot_still(
  p_client_id uuid,
  p_video_project_id uuid,
  p_shot_id uuid,
  p_expected_updated_at timestamptz
)
returns public.video_shots
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.video_projects;
  v_shot public.video_shots;
  v_updated public.video_shots;
begin
  select * into v_project
    from public.video_projects
   where id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;
  if v_project.status not in ('storyboarding', 'generating') then
    raise exception 'REEL_PROJECT_NOT_EDITABLE: Provider retries are unavailable once the project leaves generation.';
  end if;

  select * into v_shot
    from public.video_shots
   where id = p_shot_id and video_project_id = p_video_project_id
   for update;
  if not found then
    raise exception 'REEL_SHOT_NOT_FOUND: Shot does not belong to the supplied project.';
  end if;
  if v_shot.updated_at is distinct from p_expected_updated_at then
    raise exception 'REEL_SHOT_STALE: Shot changed after this retry was prepared; reload before trying again.';
  end if;
  if v_shot.status is distinct from 'failed' then
    raise exception 'REEL_SHOT_NOT_FAILED: Only a failed shot can be retried (current status %).', v_shot.status;
  end if;
  if public.reel_shot_failure_phase(v_shot) is distinct from 'still' then
    raise exception 'REEL_FAILURE_PHASE_MISMATCH: This shot failed during video generation; use the video retry instead.';
  end if;
  if v_shot.still_image_url is not null then
    raise exception 'REEL_STILL_ALREADY_PRESENT: A still image is already stored for this shot.';
  end if;
  if v_shot.clip_url is not null or v_shot.higgsfield_job_id is not null then
    raise exception 'REEL_VIDEO_STATE_PRESENT: This shot already has video work; the image stage cannot be reset.';
  end if;

  update public.video_shots
     set status = 'pending',
         still_image_job_id = null,
         still_image_model = null,
         error = null,
         failure_stage = null,
         failed_at = null,
         still_attempt_count = v_shot.still_attempt_count + 1,
         last_still_attempt_at = now(),
         updated_at = now()
   where id = p_shot_id
     and status = 'failed'
     and updated_at = p_expected_updated_at
  returning * into v_updated;
  if not found then
    raise exception 'REEL_SHOT_STALE: Shot changed while the retry was being applied; reload before trying again.';
  end if;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    p_client_id,
    'reel_studio_still_retry',
    'A failed Reel Studio image job was reset for retry.',
    'video_shot',
    p_shot_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id,
      'shot_id', p_shot_id,
      'shot_number', v_shot.shot_number,
      'failure_stage', coalesce(v_shot.failure_stage, 'unrecorded'),
      'still_attempt_count', v_updated.still_attempt_count
    )
  );

  return v_updated;
end;
$$;

-- Reset a terminally-failed VIDEO phase. The already-rendered still image, the
-- planning fields, and the selected motion are all preserved — only the failed
-- video job is cleared.
create or replace function public.reset_failed_reel_shot_video(
  p_client_id uuid,
  p_video_project_id uuid,
  p_shot_id uuid,
  p_expected_updated_at timestamptz,
  p_motion_type text default null,
  p_motion_strength numeric default null
)
returns public.video_shots
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.video_projects;
  v_shot public.video_shots;
  v_updated public.video_shots;
  v_motion_type text;
  v_motion_strength numeric;
begin
  select * into v_project
    from public.video_projects
   where id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;
  if v_project.status not in ('storyboarding', 'generating') then
    raise exception 'REEL_PROJECT_NOT_EDITABLE: Provider retries are unavailable once the project leaves generation.';
  end if;

  select * into v_shot
    from public.video_shots
   where id = p_shot_id and video_project_id = p_video_project_id
   for update;
  if not found then
    raise exception 'REEL_SHOT_NOT_FOUND: Shot does not belong to the supplied project.';
  end if;
  if v_shot.updated_at is distinct from p_expected_updated_at then
    raise exception 'REEL_SHOT_STALE: Shot changed after this retry was prepared; reload before trying again.';
  end if;
  if v_shot.status is distinct from 'failed' then
    raise exception 'REEL_SHOT_NOT_FAILED: Only a failed shot can be retried (current status %).', v_shot.status;
  end if;
  if public.reel_shot_failure_phase(v_shot) is distinct from 'video' then
    raise exception 'REEL_FAILURE_PHASE_MISMATCH: This shot failed during image generation; use the image retry instead.';
  end if;
  if v_shot.clip_url is not null then
    raise exception 'REEL_CLIP_ALREADY_PRESENT: A rendered clip already exists for this shot.';
  end if;
  if v_shot.still_image_url is null then
    raise exception 'REEL_STILL_MISSING: No stored still image exists; retry image generation first.';
  end if;

  -- Motion is preserved unless the operator deliberately changes it.
  v_motion_type := coalesce(nullif(btrim(coalesce(p_motion_type, '')), ''), v_shot.motion_type);
  v_motion_strength := coalesce(p_motion_strength, v_shot.motion_strength);
  if v_motion_type is null or v_motion_strength is null then
    raise exception 'REEL_MOTION_MISSING: A motion and strength must be selected before retrying video generation.';
  end if;
  if v_motion_strength < 0 or v_motion_strength > 1 then
    raise exception 'REEL_MOTION_INVALID: motion_strength must be between 0 and 1.';
  end if;

  update public.video_shots
     set status = 'still_complete',
         higgsfield_job_id = null,
         model = null,
         source_url = null,
         error = null,
         failure_stage = null,
         failed_at = null,
         motion_type = v_motion_type,
         motion_strength = v_motion_strength,
         video_attempt_count = v_shot.video_attempt_count + 1,
         last_video_attempt_at = now(),
         updated_at = now()
   where id = p_shot_id
     and status = 'failed'
     and updated_at = p_expected_updated_at
  returning * into v_updated;
  if not found then
    raise exception 'REEL_SHOT_STALE: Shot changed while the retry was being applied; reload before trying again.';
  end if;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    p_client_id,
    'reel_studio_video_retry',
    'A failed Reel Studio video job was reset for retry; the existing still image was preserved.',
    'video_shot',
    p_shot_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id,
      'shot_id', p_shot_id,
      'shot_number', v_shot.shot_number,
      'failure_stage', coalesce(v_shot.failure_stage, 'unrecorded'),
      'motion_changed', (v_motion_type is distinct from v_shot.motion_type)
                        or (v_motion_strength is distinct from v_shot.motion_strength),
      'video_attempt_count', v_updated.video_attempt_count
    )
  );

  return v_updated;
end;
$$;

revoke all on function public.reset_failed_reel_shot_still(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reset_failed_reel_shot_video(uuid, uuid, uuid, timestamptz, text, numeric) from public, anon, authenticated;
grant execute on function public.reset_failed_reel_shot_still(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.reset_failed_reel_shot_video(uuid, uuid, uuid, timestamptz, text, numeric) to service_role;

-- ── E. Distribution capability gate ─────────────────────────────────────────
-- Mirrors resolvePublishCapability() in _shared/publish-capability.ts. Kept
-- narrow on purpose: it only blocks a transition INTO an active publishing state
-- (scheduled / publishing / published). Existing rows stay readable, cancellable
-- and reconcilable, and nothing historical is deleted or rewritten.
create or replace function public.distribution_publication_supported(
  p_asset_format text,
  p_publish_settings jsonb,
  p_publish_payload jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when upper(coalesce(p_publish_settings ->> 'content_type', 'IMAGE')) = 'REELS'
      or p_asset_format = 'reel_video'
      then 'Final Reel assembly and Instagram Reels publishing are not available yet.'
    when upper(coalesce(p_publish_settings ->> 'content_type', 'IMAGE')) not in ('IMAGE', 'CAROUSEL', 'STORIES')
      then 'Content type ' || coalesce(p_publish_settings ->> 'content_type', 'IMAGE') || ' is not supported by the current publisher.'
    when p_asset_format not in ('feed_post', 'carousel', 'story_sequence', 'ad_static')
      then 'Asset format ' || p_asset_format || ' is not supported by the current publisher.'
    when exists (
      select 1
        from jsonb_array_elements(coalesce(p_publish_payload -> 'media', '[]'::jsonb)) item
       where lower(coalesce(item ->> 'mime_type', '')) like 'video/%'
    )
      then 'Video publishing is not implemented; only image posts, image carousels and image Stories can be published.'
    else null
  end;
$$;

create or replace function public.enforce_distribution_publish_capability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_block text;
begin
  -- Only a transition INTO an active publishing state is gated. 'published' is
  -- deliberately excluded: it is reached either through the publisher (which has
  -- already refused an unsupported record before any Meta call) or through
  -- operator reconciliation of a real external post, and blocking it there would
  -- strand a genuinely published record.
  if new.publish_status not in ('scheduled', 'publishing') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.publish_status = new.publish_status then
    return new;
  end if;

  v_block := public.distribution_publication_supported(new.asset_format, new.publish_settings, new.publish_payload);
  if v_block is null then
    return new;
  end if;

  -- Refuse the transition outright. The record keeps its previous state, its
  -- history and its diagnostics; nothing is deleted and nothing is faked. Because
  -- it can never become 'scheduled', claim_due_distribution_records can never
  -- claim it, so the worker cannot retry it in a loop.
  raise exception 'UNSUPPORTED_PUBLICATION: %', v_block
    using errcode = 'check_violation',
          hint = 'Final Reel assembly and Instagram Reels publishing arrive in a later phase. This record stays readable and is not queued.';
end;
$$;

drop trigger if exists enforce_distribution_publish_capability on public.client_distribution_records;
create trigger enforce_distribution_publish_capability
  before insert or update on public.client_distribution_records
  for each row execute function public.enforce_distribution_publish_capability();

revoke all on function public.distribution_publication_supported(text, jsonb, jsonb) from public, anon;
grant execute on function public.distribution_publication_supported(text, jsonb, jsonb) to authenticated, service_role;
