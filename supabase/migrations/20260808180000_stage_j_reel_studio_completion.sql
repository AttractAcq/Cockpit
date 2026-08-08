-- Programme Stage J — Reel Studio Completion.
--
-- Additive only. Builds on the existing Reel Studio Phases A-D (Cinematic AI
-- generation loop, storyboard quality gate, critique/repair) and the
-- already-live Phase 3 final-Reel system (video_project_deliverables,
-- create/complete-final-reel-upload, review-final-reel,
-- create-reel-distribution-draft, resolveReelPublicationEligibility) --
-- none of that is touched or duplicated. This migration adds:
--   1. video_projects.production_strategy — which of the 5 Stage J
--      production strategies this project follows.
--   2. client_reel_styles — the per-client Reel style system (motion
--      presets, typography, evidence treatment, captions, intro/outro,
--      sound), seeded with one "AA Reel style" default row.
--   3. video_shots gains a source-asset path (shot_source_kind +
--      source_storage_bucket/path/mime_type/original_filename/description)
--      so Proof Editorial / Motion Explainer / Footage / Hybrid strategies
--      can attach real, non-AI-generated material to a shot slot instead of
--      only a Higgsfield-generated still/clip.
--   4. video_composition_contracts — the structured timeline/voice/audio/
--      captions/CTA/render-mode contract Stage J calls the "composition
--      contract", one per project, feeding the existing external-editor
--      handoff and manual-upload paths (render_mode maps onto what Phase 3
--      already does for those two modes; automated_template/provider_render
--      are declared but intentionally unimplemented -- see Stage J status
--      report).

-- ---------------------------------------------------------------------------
-- video_projects.production_strategy
-- ---------------------------------------------------------------------------

alter table public.video_projects
  add column if not exists production_strategy text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'video_projects_production_strategy_check') then
    alter table public.video_projects
      add constraint video_projects_production_strategy_check
        check (production_strategy is null or production_strategy in (
          'proof_editorial', 'motion_explainer', 'cinematic_ai', 'footage', 'hybrid'
        ));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- client_reel_styles — per-client Reel style configuration.
-- ---------------------------------------------------------------------------

create table if not exists public.client_reel_styles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  motion_presets jsonb not null default '[]'::jsonb,
  typography jsonb not null default '{}'::jsonb,
  evidence_treatment jsonb not null default '{}'::jsonb,
  caption_system jsonb not null default '{}'::jsonb,
  intro_outro jsonb not null default '{}'::jsonb,
  sound_system jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_reel_styles_name_check check (btrim(name) <> ''),
  constraint client_reel_styles_motion_presets_check check (jsonb_typeof(motion_presets) = 'array'),
  constraint client_reel_styles_typography_check check (jsonb_typeof(typography) = 'object'),
  constraint client_reel_styles_evidence_treatment_check check (jsonb_typeof(evidence_treatment) = 'object'),
  constraint client_reel_styles_caption_system_check check (jsonb_typeof(caption_system) = 'object'),
  constraint client_reel_styles_intro_outro_check check (jsonb_typeof(intro_outro) = 'object'),
  constraint client_reel_styles_sound_system_check check (jsonb_typeof(sound_system) = 'object')
);

-- At most one default style per client.
create unique index if not exists client_reel_styles_one_default_per_client
  on public.client_reel_styles (client_id)
  where is_default = true;

create index if not exists client_reel_styles_client_idx on public.client_reel_styles (client_id);

drop trigger if exists client_reel_styles_updated_at on public.client_reel_styles;
create trigger client_reel_styles_updated_at before update on public.client_reel_styles
  for each row execute function public.set_updated_at();

alter table public.client_reel_styles enable row level security;
revoke all on public.client_reel_styles from public, anon, authenticated;
grant select on public.client_reel_styles to authenticated;
grant all on public.client_reel_styles to service_role;
drop policy if exists client_reel_styles_select on public.client_reel_styles;
create policy client_reel_styles_select on public.client_reel_styles
  for select to authenticated using (client_id = any(public.auth_client_ids()));

alter table public.video_projects
  add column if not exists reel_style_id uuid references public.client_reel_styles(id) on delete set null;

-- Seed the AA Reel style default for the real Attract Acquisition client.
-- Idempotent: only inserts if this client has no default style yet.
insert into public.client_reel_styles (client_id, name, is_default, motion_presets, typography, evidence_treatment, caption_system, intro_outro, sound_system)
select c.id, 'AA Reel Style', true,
  '["slow_push_in", "handheld_drift", "static_hold"]'::jsonb,
  '{"headline_face": "Inter", "caption_face": "Inter", "weight": "bold", "case": "sentence"}'::jsonb,
  '{"screenshot_frame": "device_bezel", "testimonial_treatment": "quote_card", "document_treatment": "highlight_overlay"}'::jsonb,
  '{"enabled": true, "position": "center_lower_third", "style": "bold_word_by_word", "timing_source": "manual"}'::jsonb,
  '{"intro_style": "none", "outro_style": "cta_card", "outro_duration_sec": 3}'::jsonb,
  '{"music_policy": "licensed_only", "sfx_policy": "minimal", "loudness_standard": "EBU_R128"}'::jsonb
from public.clients c
where c.name = 'Attract Acquisition'
  and not exists (
    select 1 from public.client_reel_styles s where s.client_id = c.id and s.is_default = true
  );

-- ---------------------------------------------------------------------------
-- video_shots: source-asset path for non-AI-generated strategies.
-- ---------------------------------------------------------------------------

alter table public.video_shots
  add column if not exists shot_source_kind text not null default 'ai_generated',
  add column if not exists source_storage_bucket text,
  add column if not exists source_storage_path text,
  add column if not exists source_mime_type text,
  add column if not exists source_original_filename text,
  add column if not exists source_description text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'video_shots_shot_source_kind_check') then
    alter table public.video_shots
      add constraint video_shots_shot_source_kind_check
        check (shot_source_kind in ('ai_generated', 'source_asset'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'video_shots_source_asset_fields_check') then
    alter table public.video_shots
      add constraint video_shots_source_asset_fields_check
        check (shot_source_kind <> 'source_asset' or (source_storage_bucket is not null and source_storage_path is not null));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- video_composition_contracts — the Stage J "composition contract": the
-- structured timeline/voice/audio/captions/CTA/render-mode spec that both
-- the external-editor handoff package and (if ever built) an automated
-- render engine consume. One per project.
-- ---------------------------------------------------------------------------

create table if not exists public.video_composition_contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  video_project_id uuid not null references public.video_projects(id) on delete cascade,
  render_mode text not null default 'human_editor_handoff',
  status text not null default 'draft',
  timeline jsonb not null default '[]'::jsonb,
  voice_track jsonb not null default '{}'::jsonb,
  audio jsonb not null default '{}'::jsonb,
  captions jsonb not null default '{}'::jsonb,
  cta_frame jsonb not null default '{}'::jsonb,
  rendered_deliverable_id uuid references public.video_project_deliverables(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_composition_contracts_project_unique unique (video_project_id),
  constraint video_composition_contracts_render_mode_check
    check (render_mode in ('automated_template', 'provider_render', 'human_editor_handoff', 'manual_upload')),
  constraint video_composition_contracts_status_check
    check (status in ('draft', 'ready', 'rendered')),
  constraint video_composition_contracts_timeline_check check (jsonb_typeof(timeline) = 'array'),
  constraint video_composition_contracts_voice_track_check check (jsonb_typeof(voice_track) = 'object'),
  constraint video_composition_contracts_audio_check check (jsonb_typeof(audio) = 'object'),
  constraint video_composition_contracts_captions_check check (jsonb_typeof(captions) = 'object'),
  constraint video_composition_contracts_cta_frame_check check (jsonb_typeof(cta_frame) = 'object')
);

create index if not exists video_composition_contracts_client_idx on public.video_composition_contracts (client_id);

drop trigger if exists video_composition_contracts_updated_at on public.video_composition_contracts;
create trigger video_composition_contracts_updated_at before update on public.video_composition_contracts
  for each row execute function public.set_updated_at();

alter table public.video_composition_contracts enable row level security;
revoke all on public.video_composition_contracts from public, anon, authenticated;
grant select on public.video_composition_contracts to authenticated;
grant all on public.video_composition_contracts to service_role;
drop policy if exists video_composition_contracts_select on public.video_composition_contracts;
create policy video_composition_contracts_select on public.video_composition_contracts
  for select to authenticated using (client_id = any(public.auth_client_ids()));
