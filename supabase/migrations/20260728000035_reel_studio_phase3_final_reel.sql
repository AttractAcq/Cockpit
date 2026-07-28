-- Reel Studio Phase 3 — additive only. Historical migrations remain unchanged.
--
--   1. video_project_deliverables: the single authoritative row for a final
--      edited Reel MP4 (upload, versioning, review).
--   2. video_projects.current_deliverable_id: the explicit answer to
--      "what is the current final Reel?" — never inferred.
--   3. client_distribution_records: Instagram container/publication metadata and
--      the project/deliverable relationships.
--   4. Transactional RPCs for reservation, completion, review and draft creation.
--   5. Capability + worker updates so an approved current final Reel becomes
--      publishable while shot clips stay permanently blocked.
--
-- The final MP4 is deliberately NOT stored in client_assets: that table requires
-- non-null prompt_md / generation_provider / generation_model (a human upload has
-- none), has no reviewer or feedback columns, and already holds Phase 2 shot
-- clips as asset_format='reel_video' — reusing it would make a shot clip and the
-- final deliverable structurally indistinguishable. One MP4, one authoritative
-- row, one table.

-- ── 1. Final Reel deliverables ──────────────────────────────────────────────
create table if not exists public.video_project_deliverables (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  video_project_id uuid not null references public.video_projects(id) on delete cascade,
  client_production_brief_id uuid references public.client_production_briefs(id) on delete set null,
  source_table text,
  source_row_id uuid,

  storage_bucket text not null default 'video-assets',
  storage_path text not null,
  original_filename text,
  mime_type text not null default 'video/mp4',
  file_format text not null default 'mp4',
  file_size_bytes bigint not null,

  -- Null means UNKNOWN. The Deno edge runtime cannot decode video, so these are
  -- browser-reported and advisory; they are never fabricated.
  width integer,
  height integer,
  duration_sec numeric,
  media_metadata_source text not null default 'unknown',

  version integer not null,
  is_current boolean not null default false,
  upload_state text not null default 'reserved',

  status public.review_state not null default 'needs_review',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_feedback text,

  uploaded_by uuid references auth.users(id) on delete set null,
  upload_completed_at timestamptz,
  superseded_at timestamptz,
  superseded_by_deliverable_id uuid references public.video_project_deliverables(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint video_project_deliverables_bucket_check check (storage_bucket = 'video-assets'),
  constraint video_project_deliverables_mime_check check (mime_type = 'video/mp4'),
  constraint video_project_deliverables_format_check check (file_format = 'mp4'),
  constraint video_project_deliverables_size_check check (file_size_bytes > 0),
  constraint video_project_deliverables_version_check check (version > 0),
  constraint video_project_deliverables_width_check check (width is null or width > 0),
  constraint video_project_deliverables_height_check check (height is null or height > 0),
  constraint video_project_deliverables_duration_check check (duration_sec is null or duration_sec > 0),
  constraint video_project_deliverables_metadata_source_check
    check (media_metadata_source in ('unknown', 'client_reported', 'server_probed')),
  constraint video_project_deliverables_upload_state_check
    check (upload_state in ('reserved', 'uploaded')),
  constraint video_project_deliverables_path_check check (btrim(storage_path) <> ''),
  -- A reserved (not yet uploaded) row can never be current or reviewed.
  constraint video_project_deliverables_reserved_not_current
    check (upload_state = 'uploaded' or (is_current = false and superseded_at is null))
);

create unique index if not exists video_project_deliverables_version_uidx
  on public.video_project_deliverables (video_project_id, version);

-- Exactly one current version per project, enforced by the database.
create unique index if not exists video_project_deliverables_one_current_uidx
  on public.video_project_deliverables (video_project_id) where is_current;

create unique index if not exists video_project_deliverables_path_uidx
  on public.video_project_deliverables (storage_bucket, storage_path);

create index if not exists video_project_deliverables_client_idx
  on public.video_project_deliverables (client_id, video_project_id, version desc);

comment on table public.video_project_deliverables is
  'Authoritative record of a final edited Reel MP4 produced by an external editor and uploaded back into Cockpit. One row per version; exactly one is_current per project.';

alter table public.video_project_deliverables enable row level security;

-- Staff read-only, matching the Reel Studio convention. All writes go through the
-- service-role RPCs below.
drop policy if exists video_project_deliverables_staff_select on public.video_project_deliverables;
create policy video_project_deliverables_staff_select on public.video_project_deliverables
  for select to authenticated
  using (public.auth_role() = any (array['admin', 'account_manager', 'editor']));

revoke all on public.video_project_deliverables from anon;
grant select on public.video_project_deliverables to authenticated;

-- ── 2. Explicit project → current final Reel relationship ───────────────────
alter table public.video_projects
  add column if not exists current_deliverable_id uuid
  references public.video_project_deliverables(id) on delete set null;

comment on column public.video_projects.current_deliverable_id is
  'The project''s current final Reel. Never infer the final Reel from timestamps, filenames, asset groups or storage listings.';

-- ── 3. Distribution: project/deliverable link + Instagram container metadata ─
alter table public.client_distribution_records
  add column if not exists video_project_id uuid references public.video_projects(id) on delete set null;
alter table public.client_distribution_records
  add column if not exists video_deliverable_id uuid references public.video_project_deliverables(id) on delete set null;
alter table public.client_distribution_records
  add column if not exists external_container_id text;
alter table public.client_distribution_records
  add column if not exists container_status text;
alter table public.client_distribution_records
  add column if not exists container_created_at timestamptz;
alter table public.client_distribution_records
  add column if not exists container_checked_at timestamptz;
alter table public.client_distribution_records
  add column if not exists container_poll_count integer not null default 0;

alter table public.client_distribution_records
  drop constraint if exists client_distribution_records_container_status_check;
alter table public.client_distribution_records
  add constraint client_distribution_records_container_status_check
  check (container_status is null or container_status in ('IN_PROGRESS', 'FINISHED', 'ERROR', 'EXPIRED', 'PUBLISHED'));

alter table public.client_distribution_records
  drop constraint if exists client_distribution_records_container_poll_count_check;
alter table public.client_distribution_records
  add constraint client_distribution_records_container_poll_count_check
  check (container_poll_count >= 0);

-- One active (non-cancelled, non-failed) Reel publication per deliverable, so a
-- second draft for the same approved final version cannot be created by accident.
create unique index if not exists client_distribution_records_active_deliverable_uidx
  on public.client_distribution_records (video_deliverable_id)
  where video_deliverable_id is not null
    and publish_status in ('ready', 'scheduled', 'publishing', 'published', 'needs_reconciliation');

comment on column public.client_distribution_records.external_container_id is
  'Instagram media container id (creation_id) returned by POST /{ig-user-id}/media. Persisted immediately so a worker timeout never creates a second container.';

-- ── 4. Reservation / completion / review / draft RPCs ───────────────────────

-- Reserve the next version number and its server-built storage path atomically.
-- The row starts `reserved`: it is not current, not reviewable, and does not
-- disturb the existing current version if the upload never completes.
create or replace function public.reserve_final_reel_upload(
  p_client_id uuid,
  p_video_project_id uuid,
  p_storage_path_prefix text,
  p_safe_filename text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_original_filename text,
  p_uploaded_by uuid,
  p_acknowledge_replace_approved boolean default false
)
returns public.video_project_deliverables
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.video_projects;
  v_brief public.client_production_briefs;
  v_current public.video_project_deliverables;
  v_active_publish text;
  v_version integer;
  v_row public.video_project_deliverables;
begin
  select * into v_project
    from public.video_projects
   where id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;
  if v_project.status is distinct from 'handed_off' then
    raise exception 'REEL_PROJECT_NOT_HANDED_OFF: The shot clips must be handed off to Assets before a final Reel can be uploaded (project is %).', v_project.status;
  end if;
  if v_project.client_production_brief_id is null then
    raise exception 'REEL_BRIEF_NOT_BOUND: A final Reel can only be uploaded to a project bound to an approved production brief.';
  end if;

  select * into v_brief
    from public.client_production_briefs
   where id = v_project.client_production_brief_id
   for share;
  if not found or v_brief.client_id is distinct from p_client_id or v_brief.asset_format is distinct from 'reel_video' then
    raise exception 'REEL_BRIEF_BINDING_INVALID: The project''s bound production brief is no longer a valid reel_video brief.';
  end if;

  select * into v_current
    from public.video_project_deliverables
   where video_project_id = p_video_project_id and is_current
   for update;

  if found then
    select d.publish_status into v_active_publish
      from public.client_distribution_records d
     where d.video_deliverable_id = v_current.id
       and d.publish_status in ('publishing', 'published')
     limit 1;
    if v_active_publish is not null then
      raise exception 'REEL_CURRENT_VERSION_PUBLISHING: Version % is % and cannot be replaced.', v_current.version, v_active_publish;
    end if;
    if v_current.status = 'approved'::public.review_state and coalesce(p_acknowledge_replace_approved, false) = false then
      raise exception 'REEL_REPLACE_APPROVED_UNCONFIRMED: Version % is already approved; confirm the replacement explicitly.', v_current.version;
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.video_project_deliverables
   where video_project_id = p_video_project_id;

  insert into public.video_project_deliverables (
    client_id, video_project_id, client_production_brief_id,
    source_table, source_row_id,
    storage_bucket, storage_path, original_filename,
    mime_type, file_format, file_size_bytes,
    version, is_current, upload_state, status, uploaded_by
  ) values (
    p_client_id, p_video_project_id, v_project.client_production_brief_id,
    case when v_project.organic_master_id is not null then 'organic_master'
         when v_project.ads_master_id is not null then 'ads_master' else null end,
    coalesce(v_project.organic_master_id, v_project.ads_master_id),
    'video-assets',
    p_storage_path_prefix || 'v' || v_version::text || '/' || p_safe_filename,
    p_original_filename,
    p_mime_type, 'mp4', p_file_size_bytes,
    v_version, false, 'reserved', 'needs_review'::public.review_state, p_uploaded_by
  )
  returning * into v_row;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    p_client_id, 'reel_studio_final_upload_started',
    'A final Reel upload slot was reserved for version ' || v_version::text || '.',
    'video_project', p_video_project_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id, 'deliverable_id', v_row.id, 'version', v_version,
      'production_brief_id', v_project.client_production_brief_id,
      'file_size_bytes', p_file_size_bytes
    )
  );

  return v_row;
end;
$$;

-- Promote a reserved row to the current version after the object is confirmed in
-- storage. Locks the project so two concurrent uploads can never both become
-- current; the loser fails on the one-current unique index or the lock.
create or replace function public.complete_final_reel_upload(
  p_client_id uuid,
  p_video_project_id uuid,
  p_deliverable_id uuid,
  p_verified_size_bytes bigint,
  p_width integer,
  p_height integer,
  p_duration_sec numeric,
  p_metadata_source text
)
returns public.video_project_deliverables
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.video_projects;
  v_row public.video_project_deliverables;
  v_previous public.video_project_deliverables;
  v_completed timestamptz := now();
begin
  select * into v_project
    from public.video_projects
   where id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;

  select * into v_row
    from public.video_project_deliverables
   where id = p_deliverable_id and video_project_id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_DELIVERABLE_NOT_FOUND: Final Reel upload slot does not belong to this project.';
  end if;
  if v_row.upload_state = 'uploaded' then
    -- Idempotent: a duplicate completion call returns the row unchanged.
    return v_row;
  end if;

  select * into v_previous
    from public.video_project_deliverables
   where video_project_id = p_video_project_id and is_current
   for update;

  if found then
    if exists (
      select 1 from public.client_distribution_records d
       where d.video_deliverable_id = v_previous.id and d.publish_status in ('publishing', 'published')
    ) then
      raise exception 'REEL_CURRENT_VERSION_PUBLISHING: The current version is publishing or published and cannot be superseded.';
    end if;
    update public.video_project_deliverables
       set is_current = false, superseded_at = v_completed,
           superseded_by_deliverable_id = p_deliverable_id, updated_at = v_completed
     where id = v_previous.id;
  end if;

  update public.video_project_deliverables
     set upload_state = 'uploaded',
         is_current = true,
         upload_completed_at = v_completed,
         file_size_bytes = coalesce(p_verified_size_bytes, file_size_bytes),
         width = p_width,
         height = p_height,
         duration_sec = p_duration_sec,
         media_metadata_source = coalesce(p_metadata_source, 'unknown'),
         status = 'needs_review'::public.review_state,
         updated_at = v_completed
   where id = p_deliverable_id
  returning * into v_row;

  update public.video_projects
     set current_deliverable_id = p_deliverable_id, updated_at = v_completed
   where id = p_video_project_id;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    p_client_id, 'reel_studio_final_version_created',
    'Final Reel version ' || v_row.version::text || ' was uploaded and is awaiting review.',
    'video_project', p_video_project_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id, 'deliverable_id', p_deliverable_id, 'version', v_row.version,
      'production_brief_id', v_row.client_production_brief_id,
      'superseded_version', case when v_previous.id is not null then v_previous.version else null end,
      'file_size_bytes', v_row.file_size_bytes,
      'media_metadata_source', v_row.media_metadata_source
    )
  );

  return v_row;
end;
$$;

-- Approve or return the current final Reel for revision.
create or replace function public.review_final_reel_deliverable(
  p_client_id uuid,
  p_video_project_id uuid,
  p_deliverable_id uuid,
  p_expected_updated_at timestamptz,
  p_next_status text,
  p_feedback text,
  p_reviewed_by uuid
)
returns public.video_project_deliverables
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.video_project_deliverables;
  v_updated public.video_project_deliverables;
  v_now timestamptz := now();
begin
  if p_next_status not in ('approved', 'rejected') then
    raise exception 'REEL_REVIEW_STATUS_INVALID: Review status must be approved or rejected.';
  end if;

  select * into v_row
    from public.video_project_deliverables
   where id = p_deliverable_id and video_project_id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_DELIVERABLE_NOT_FOUND: Final Reel does not belong to this project.';
  end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'REEL_DELIVERABLE_STALE: The final Reel changed after this review started; reload before trying again.';
  end if;
  if v_row.upload_state is distinct from 'uploaded' then
    raise exception 'REEL_DELIVERABLE_NOT_UPLOADED: This version has no completed upload.';
  end if;
  if not v_row.is_current or v_row.superseded_at is not null then
    raise exception 'REEL_DELIVERABLE_NOT_CURRENT: Only the current final Reel version can be reviewed.';
  end if;
  if p_next_status = 'rejected' and length(btrim(coalesce(p_feedback, ''))) < 8 then
    raise exception 'REEL_REVIEW_FEEDBACK_REQUIRED: Revision feedback is required.';
  end if;
  if p_next_status = 'approved' and exists (
    select 1 from public.client_distribution_records d
     where d.video_deliverable_id = p_deliverable_id and d.publish_status = 'published'
  ) then
    raise exception 'REEL_ALREADY_PUBLISHED: This version is already published and cannot be re-reviewed.';
  end if;

  update public.video_project_deliverables
     set status = p_next_status::public.review_state,
         reviewed_by = p_reviewed_by,
         reviewed_at = v_now,
         review_feedback = case when p_next_status = 'rejected' then btrim(p_feedback) else null end,
         updated_at = v_now
   where id = p_deliverable_id
     and updated_at = p_expected_updated_at
  returning * into v_updated;
  if not found then
    raise exception 'REEL_DELIVERABLE_STALE: The final Reel changed while the review was being applied.';
  end if;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    p_client_id,
    case when p_next_status = 'approved' then 'reel_studio_final_approved' else 'reel_studio_final_revision_requested' end,
    case when p_next_status = 'approved'
         then 'Final Reel version ' || v_updated.version::text || ' was approved for distribution.'
         else 'Final Reel version ' || v_updated.version::text || ' was returned for revision.' end,
    'video_project', p_video_project_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id, 'deliverable_id', p_deliverable_id,
      'version', v_updated.version, 'production_brief_id', v_updated.client_production_brief_id,
      'new_status', p_next_status
    )
  );

  return v_updated;
end;
$$;

-- Create (or return) the one Reel distribution draft for an approved current
-- final Reel. Service-role only: the eligibility proof lives here, not in the UI.
create or replace function public.create_reel_distribution_draft(
  p_client_id uuid,
  p_video_project_id uuid,
  p_deliverable_id uuid,
  p_execution_month text,
  p_source_ref text,
  p_title text,
  p_planned_date date,
  p_publish_payload jsonb,
  p_publish_settings jsonb
)
returns public.client_distribution_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.video_projects;
  v_deliverable public.video_project_deliverables;
  v_existing public.client_distribution_records;
  v_group_ref text;
  v_row public.client_distribution_records;
begin
  select * into v_project
    from public.video_projects
   where id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;

  select * into v_deliverable
    from public.video_project_deliverables
   where id = p_deliverable_id and video_project_id = p_video_project_id and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_DELIVERABLE_NOT_FOUND: Final Reel does not belong to this project.';
  end if;
  if v_project.current_deliverable_id is distinct from p_deliverable_id or not v_deliverable.is_current then
    raise exception 'REEL_DELIVERABLE_NOT_CURRENT: Only the project''s current final Reel can be distributed.';
  end if;
  if v_deliverable.upload_state is distinct from 'uploaded' then
    raise exception 'REEL_DELIVERABLE_NOT_UPLOADED: This version has no completed upload.';
  end if;
  if v_deliverable.status is distinct from 'approved'::public.review_state then
    raise exception 'REEL_DELIVERABLE_NOT_APPROVED: The final Reel must be approved before a distribution draft can be created.';
  end if;

  -- Idempotent: an existing active record for this exact version is returned.
  select * into v_existing
    from public.client_distribution_records
   where video_deliverable_id = p_deliverable_id
     and publish_status in ('ready', 'scheduled', 'publishing', 'published', 'needs_reconciliation')
   limit 1;
  if found then
    return v_existing;
  end if;

  v_group_ref := p_source_ref || '-final-reel-v' || v_deliverable.version::text;

  insert into public.client_distribution_records (
    client_id, execution_month, source_ref, asset_group_ref, sequence_index, sequence_count,
    production_brief_id, asset_format, title, publish_status, platform, planned_publish_date,
    publish_payload, publish_settings, video_project_id, video_deliverable_id
  ) values (
    p_client_id, p_execution_month, p_source_ref, v_group_ref, 1, 1,
    v_deliverable.client_production_brief_id, 'reel_video', p_title, 'ready', 'instagram', p_planned_date,
    coalesce(p_publish_payload, '{}'::jsonb), coalesce(p_publish_settings, '{}'::jsonb),
    p_video_project_id, p_deliverable_id
  )
  returning * into v_row;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    p_client_id, 'reel_studio_distribution_draft_created',
    p_source_ref || ': distribution draft created from approved final Reel v' || v_deliverable.version::text || '.',
    'client_distribution_record', v_row.id,
    jsonb_build_object(
      'distribution_record_id', v_row.id, 'video_project_id', p_video_project_id,
      'deliverable_id', p_deliverable_id, 'version', v_deliverable.version,
      'production_brief_id', v_deliverable.client_production_brief_id, 'source_ref', p_source_ref
    )
  );

  return v_row;
end;
$$;

revoke all on function public.reserve_final_reel_upload(uuid, uuid, text, text, text, bigint, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.complete_final_reel_upload(uuid, uuid, uuid, bigint, integer, integer, numeric, text) from public, anon, authenticated;
revoke all on function public.review_final_reel_deliverable(uuid, uuid, uuid, timestamptz, text, text, uuid) from public, anon, authenticated;
revoke all on function public.create_reel_distribution_draft(uuid, uuid, uuid, text, text, text, date, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.reserve_final_reel_upload(uuid, uuid, text, text, text, bigint, text, uuid, boolean) to service_role;
grant execute on function public.complete_final_reel_upload(uuid, uuid, uuid, bigint, integer, integer, numeric, text) to service_role;
grant execute on function public.review_final_reel_deliverable(uuid, uuid, uuid, timestamptz, text, text, uuid) to service_role;
grant execute on function public.create_reel_distribution_draft(uuid, uuid, uuid, text, text, text, date, jsonb, jsonb) to service_role;

-- ── 5. Capability: Reels allowed only for an approved current final Reel ────
-- New 4-argument overload. The Phase 2 3-argument function is preserved and now
-- delegates with a null deliverable, so any legacy caller keeps failing closed.
create or replace function public.distribution_publication_supported(
  p_asset_format text,
  p_publish_settings jsonb,
  p_publish_payload jsonb,
  p_video_deliverable_id uuid
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_content_type text := upper(coalesce(p_publish_settings ->> 'content_type', 'IMAGE'));
  v_deliverable public.video_project_deliverables;
begin
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

create or replace function public.distribution_publication_supported(
  p_asset_format text,
  p_publish_settings jsonb,
  p_publish_payload jsonb
)
returns text
language sql
stable
set search_path = ''
as $$
  select public.distribution_publication_supported(p_asset_format, p_publish_settings, p_publish_payload, null::uuid);
$$;

create or replace function public.enforce_distribution_publish_capability()
returns trigger
language plpgsql
set search_path = ''
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
    new.asset_format, new.publish_settings, new.publish_payload, new.video_deliverable_id);
  if v_block is null then
    return new;
  end if;

  raise exception 'UNSUPPORTED_PUBLICATION: %', v_block
    using errcode = 'check_violation',
          hint = 'A Reel can only be scheduled from an approved, current final Reel uploaded to its Reel Studio project.';
end;
$$;

drop trigger if exists enforce_distribution_publish_capability on public.client_distribution_records;
create trigger enforce_distribution_publish_capability
  before insert or update on public.client_distribution_records
  for each row execute function public.enforce_distribution_publish_capability();

revoke all on function public.distribution_publication_supported(text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.distribution_publication_supported(text, jsonb, jsonb, uuid) to authenticated, service_role;

-- ── 6. Worker: claim safety and container-aware stale recovery ──────────────
-- Records that became ineligible AFTER scheduling are skipped by the claim rather
-- than aborting the whole batch on the trigger's exception. A separate sweep
-- (below) resolves them explicitly so nothing sits scheduled forever.
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
      and public.distribution_publication_supported(c.asset_format, c.publish_settings, c.publish_payload, c.video_deliverable_id) is null
      and not exists (select 1 from public.client_distribution_records e where e.client_id=c.client_id and e.asset_group_ref=c.asset_group_ref and e.sequence_index < c.sequence_index and e.publish_status <> 'published')
    order by c.scheduled_publish_at limit v_limit for update skip locked)
  returning d.*;
end; $$;

-- A record whose media/eligibility changed after scheduling is failed explicitly
-- with a diagnostic instead of silently never being claimed.
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
           public.distribution_publication_supported(c.asset_format, c.publish_settings, c.publish_payload, c.video_deliverable_id) as reason
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
  return coalesce(v_count, 0);
end;
$$;

-- Stale-publishing recovery must not mistake an Instagram container that is still
-- processing for a lost publication: a container is not a published post.
create or replace function public.recover_stale_publishing(p_older_than interval)
returns table(recovered_published integer, flagged_reconcile integer)
language plpgsql
security definer
set search_path = ''
as $$
declare v_pub integer; v_rec integer;
begin
  with stale as (
    select id, (external_post_id is not null or published_at is not null or published_url is not null) as has_evidence
    from public.client_distribution_records
    where publish_status = 'publishing' and claimed_at is not null and claimed_at < now() - p_older_than
      -- Reels: an IN_PROGRESS container younger than Meta's 24h container expiry
      -- is still legitimately processing. Leave it for the polling path.
      and not (
        external_container_id is not null
        and container_status = 'IN_PROGRESS'
        and container_created_at is not null
        and container_created_at > now() - interval '24 hours'
      )
  ),
  pub as (
    update public.client_distribution_records d set publish_status = 'published',
        published_at = coalesce(d.published_at, now()), last_error = null, updated_at = now()
    from stale s where d.id = s.id and s.has_evidence returning d.id
  ),
  rec as (
    update public.client_distribution_records d set publish_status = 'needs_reconciliation',
        last_error = 'Stale publishing claim with no publication evidence — external Instagram state is uncertain; manual reconciliation required before any retry.', updated_at = now()
    from stale s where d.id = s.id and not s.has_evidence returning d.id
  )
  select (select count(*) from pub), (select count(*) from rec) into v_pub, v_rec;
  return query select coalesce(v_pub,0), coalesce(v_rec,0);
end;
$$;

revoke all on function public.block_unsupported_scheduled_distribution() from public, anon, authenticated;
grant execute on function public.block_unsupported_scheduled_distribution() to service_role;
