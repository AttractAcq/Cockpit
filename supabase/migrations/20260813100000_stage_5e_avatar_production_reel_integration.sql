-- Stage 5E: Avatar OS downstream production and Reel Studio integration.
--
-- This is intentionally additive. Existing production modes remain valid, while
-- Avatar OS can be attached to production work only as approved, optional
-- authority. Draft avatar outputs are never downstream authority.

alter table public.client_production_briefs
  drop constraint if exists client_production_briefs_production_mode_check;

alter table public.client_production_briefs
  add constraint client_production_briefs_production_mode_check
  check (production_mode is null or production_mode = any (array[
    'human'::text,
    'ai'::text,
    'hybrid'::text,
    'avatar_led'::text,
    'faceless'::text,
    'proof_led'::text,
    'static'::text,
    'human_led'::text
  ]));

alter table public.client_production_briefs
  add column if not exists avatar_release_id uuid,
  add column if not exists avatar_component_ids uuid[] not null default '{}'::uuid[],
  add column if not exists avatar_asset_ids uuid[] not null default '{}'::uuid[],
  add column if not exists avatar_reference_payload jsonb not null default '{}'::jsonb;

alter table public.client_production_briefs
  drop constraint if exists client_production_briefs_avatar_release_fk;

alter table public.client_production_briefs
  add constraint client_production_briefs_avatar_release_fk
  foreign key (avatar_release_id, client_id)
  references public.client_avatar_releases(id, client_id)
  on delete restrict;

alter table public.client_production_briefs
  drop constraint if exists client_production_briefs_avatar_reference_payload_check;

alter table public.client_production_briefs
  add constraint client_production_briefs_avatar_reference_payload_check
  check (jsonb_typeof(avatar_reference_payload) = 'object');

create index if not exists client_production_briefs_avatar_release_idx
  on public.client_production_briefs (client_id, avatar_release_id)
  where avatar_release_id is not null;

alter table public.video_projects
  add column if not exists avatar_release_id uuid,
  add column if not exists avatar_asset_ids uuid[] not null default '{}'::uuid[],
  add column if not exists avatar_reference_payload jsonb not null default '{}'::jsonb;

alter table public.video_projects
  drop constraint if exists video_projects_avatar_release_fk;

alter table public.video_projects
  add constraint video_projects_avatar_release_fk
  foreign key (avatar_release_id, client_id)
  references public.client_avatar_releases(id, client_id)
  on delete restrict;

alter table public.video_projects
  drop constraint if exists video_projects_avatar_reference_payload_check;

alter table public.video_projects
  add constraint video_projects_avatar_reference_payload_check
  check (jsonb_typeof(avatar_reference_payload) = 'object');

create index if not exists video_projects_avatar_release_idx
  on public.video_projects (client_id, avatar_release_id)
  where avatar_release_id is not null;

comment on column public.client_production_briefs.avatar_release_id is
  'Optional approved Avatar OS release used as production authority. Draft releases must not be referenced by application code.';

comment on column public.client_production_briefs.avatar_reference_payload is
  'Structured approved Avatar OS context exposed to production. It is a reference pack, not generated content.';

comment on column public.video_projects.avatar_release_id is
  'Optional approved Avatar OS release available to Reel Studio generation when production_mode is avatar_led.';

comment on column public.video_projects.avatar_reference_payload is
  'Optional approved Avatar OS prompt/reference pack for Reel Studio; empty for normal faceless AI projects.';
