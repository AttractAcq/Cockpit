-- Reel Studio Phase A: schema foundations for the Higgsfield-driven AI video
-- production lane. Mirrors the persisted job/item pattern from Phase H5
-- (client_asset_generation_jobs/items): writes happen through edge functions
-- (service role, bypasses RLS); staff get SELECT only via RLS.
--
-- Guardrails enforced in schema, not just convention:
--   - shot_class is NOT NULL with no default -- every shot must declare
--     metaphor/atmosphere/abstract; no accidental blank value.
--   - human_presence defaults to 'none'; only 'hands_only' is otherwise
--     allowed -- no AI-generated faces.
--   - proof_master is structurally excluded: nothing in this migration
--     references proof_master, so a proof asset has no column, FK, or path
--     into video_projects/video_shots.

-- ── Brand cinematography DNA (versioned) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_prompt_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_type text NOT NULL DEFAULT 'brand_dna' CHECK (block_type IN ('brand_dna','brand_sting')),
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (btrim(name) <> ''),
  grade_block text,
  lens_block text,
  mood_block text,
  motion_block text,
  negative_block text,
  prompt_block text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_prompt_blocks_type_version_unique UNIQUE (block_type, version),
  CONSTRAINT brand_prompt_blocks_dna_fields CHECK (
    block_type <> 'brand_dna' OR (
      btrim(coalesce(grade_block,'')) <> '' AND btrim(coalesce(lens_block,'')) <> '' AND
      btrim(coalesce(mood_block,'')) <> '' AND btrim(coalesce(motion_block,'')) <> '' AND
      btrim(coalesce(negative_block,'')) <> ''
    )
  ),
  CONSTRAINT brand_prompt_blocks_sting_fields CHECK (
    block_type <> 'brand_sting' OR btrim(coalesce(prompt_block,'')) <> ''
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS brand_prompt_blocks_one_active_per_type
  ON public.brand_prompt_blocks (block_type) WHERE is_active;

CREATE TRIGGER brand_prompt_blocks_updated_at
  BEFORE UPDATE ON public.brand_prompt_blocks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Video projects (one per reel) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  organic_master_id uuid REFERENCES public.organic_master(id) ON DELETE SET NULL,
  ads_master_id uuid REFERENCES public.ads_master(id) ON DELETE SET NULL,
  client_production_brief_id uuid REFERENCES public.client_production_briefs(id) ON DELETE SET NULL,
  archetype text NOT NULL CHECK (archetype IN ('A1','A2','A3','A4','A5')),
  awareness_stage text NOT NULL CHECK (awareness_stage IN ('unaware','problem_aware','solution_aware','product_aware','most_aware')),
  target_duration_sec integer NOT NULL CHECK (target_duration_sec BETWEEN 22 AND 34),
  brand_prompt_block_id uuid NOT NULL REFERENCES public.brand_prompt_blocks(id),
  brand_prompt_block_version integer NOT NULL CHECK (brand_prompt_block_version > 0),
  status text NOT NULL DEFAULT 'storyboarding'
    CHECK (status IN ('storyboarding','generating','review','approved','handed_off')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  -- Exactly one source row: organic_master OR ads_master, never both/neither.
  CONSTRAINT video_projects_source_pair CHECK (
    (organic_master_id IS NOT NULL AND ads_master_id IS NULL) OR
    (organic_master_id IS NULL AND ads_master_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS video_projects_client_status_idx
  ON public.video_projects (client_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS video_projects_organic_idx ON public.video_projects (organic_master_id);
CREATE INDEX IF NOT EXISTS video_projects_ads_idx ON public.video_projects (ads_master_id);

CREATE TRIGGER video_projects_updated_at
  BEFORE UPDATE ON public.video_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Video shots (one row per generated Higgsfield beat) ──────────────────────
CREATE TABLE IF NOT EXISTS public.video_shots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_project_id uuid NOT NULL REFERENCES public.video_projects(id) ON DELETE CASCADE,
  shot_number integer NOT NULL CHECK (shot_number > 0),
  beat_description text NOT NULL CHECK (btrim(beat_description) <> ''),
  compiled_prompt text NOT NULL CHECK (btrim(compiled_prompt) <> ''),
  -- No fake proof: every shot must declare its class; no default value.
  shot_class text NOT NULL CHECK (shot_class IN ('metaphor','atmosphere','abstract')),
  -- Faceless format: defaults to no human presence at all.
  human_presence text NOT NULL DEFAULT 'none' CHECK (human_presence IN ('none','hands_only')),
  model text,
  render_tier text NOT NULL DEFAULT 'draft' CHECK (render_tier IN ('draft','final')),
  higgsfield_job_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','rendering','complete','failed')),
  clip_url text,
  source_url text,
  duration_sec numeric(5,2) CHECK (duration_sec IS NULL OR duration_sec > 0),
  credits_spent integer NOT NULL DEFAULT 0 CHECK (credits_spent >= 0),
  approved_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_shots_project_shot_unique UNIQUE (video_project_id, shot_number)
);

CREATE INDEX IF NOT EXISTS video_shots_project_idx ON public.video_shots (video_project_id, shot_number);
-- Cron/worker scan: shots still needing polling.
CREATE INDEX IF NOT EXISTS video_shots_active_idx
  ON public.video_shots (status, updated_at) WHERE status IN ('submitted','rendering');

CREATE TRIGGER video_shots_updated_at
  BEFORE UPDATE ON public.video_shots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Generation credits ledger (append-only spend per generation) ────────────
CREATE TABLE IF NOT EXISTS public.generation_credits_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_shot_id uuid NOT NULL REFERENCES public.video_shots(id) ON DELETE CASCADE,
  model text NOT NULL CHECK (btrim(model) <> ''),
  render_tier text NOT NULL CHECK (render_tier IN ('draft','final')),
  credits integer NOT NULL CHECK (credits > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generation_credits_ledger_shot_idx ON public.generation_credits_ledger (video_shot_id);
CREATE INDEX IF NOT EXISTS generation_credits_ledger_created_idx ON public.generation_credits_ledger (created_at DESC);

-- ── RLS: writes go through edge functions (service role bypasses RLS); staff
-- get SELECT only via RLS, mirroring client_asset_generation_jobs/items. ─────
ALTER TABLE public.brand_prompt_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_credits_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.brand_prompt_blocks FROM anon;
REVOKE ALL ON public.video_projects FROM anon;
REVOKE ALL ON public.video_shots FROM anon;
REVOKE ALL ON public.generation_credits_ledger FROM anon;

GRANT SELECT ON public.brand_prompt_blocks TO authenticated;
GRANT SELECT ON public.video_projects TO authenticated;
GRANT SELECT ON public.video_shots TO authenticated;
GRANT SELECT ON public.generation_credits_ledger TO authenticated;

DROP POLICY IF EXISTS brand_prompt_blocks_staff_select ON public.brand_prompt_blocks;
CREATE POLICY brand_prompt_blocks_staff_select ON public.brand_prompt_blocks
  FOR SELECT TO authenticated USING (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS video_projects_staff_select ON public.video_projects;
CREATE POLICY video_projects_staff_select ON public.video_projects
  FOR SELECT TO authenticated USING (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS video_shots_staff_select ON public.video_shots;
CREATE POLICY video_shots_staff_select ON public.video_shots
  FOR SELECT TO authenticated USING (
    public.auth_role() IN ('admin','account_manager','editor')
    AND EXISTS (SELECT 1 FROM public.video_projects p WHERE p.id = video_project_id)
  );

DROP POLICY IF EXISTS generation_credits_ledger_staff_select ON public.generation_credits_ledger;
CREATE POLICY generation_credits_ledger_staff_select ON public.generation_credits_ledger
  FOR SELECT TO authenticated USING (
    public.auth_role() IN ('admin','account_manager','editor')
    AND EXISTS (SELECT 1 FROM public.video_shots s WHERE s.id = video_shot_id)
  );

-- ── Storage bucket for downloaded clips (never rely on Higgsfield CDN URLs) ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('video-assets', 'video-assets', false, 209715200, ARRAY['video/mp4','video/quicktime','video/webm'])
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS video_assets_storage_staff_select ON storage.objects;
CREATE POLICY video_assets_storage_staff_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'video-assets' AND public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS video_assets_storage_staff_insert ON storage.objects;
CREATE POLICY video_assets_storage_staff_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'video-assets' AND public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS video_assets_storage_staff_update ON storage.objects;
CREATE POLICY video_assets_storage_staff_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'video-assets' AND public.auth_role() IN ('admin','account_manager','editor'))
  WITH CHECK (bucket_id = 'video-assets' AND public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS video_assets_storage_staff_delete ON storage.objects;
CREATE POLICY video_assets_storage_staff_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'video-assets' AND public.auth_role() IN ('admin','account_manager','editor'));

-- ── Seed: v1 brand cinematography DNA + brand sting (from build brief §1) ────
INSERT INTO public.brand_prompt_blocks
  (block_type, version, name, grade_block, lens_block, mood_block, motion_block, negative_block, is_active)
VALUES (
  'brand_dna', 1, 'AA Reel Studio Brand DNA v1',
  'Near-black background #0A0E0D, desaturated, single teal accent light #00E5C3.',
  '35mm feel, shallow depth of field.',
  'Dusk / overcast Cape Town light, premium, restrained. World: South African trade context -- job sites, bakkies, tools, pool renovations, roofing, workshops.',
  'Cinematic motion: slow dolly, push-in, crane, tracking -- deliberate, unhurried camera moves only.',
  'No faces, no readable fake signage or logos, no fake client branding, no text baked into footage.',
  true
)
ON CONFLICT (block_type, version) DO NOTHING;

INSERT INTO public.brand_prompt_blocks (block_type, version, name, prompt_block, is_active)
VALUES (
  'brand_sting', 1, 'AA Reel Studio Brand Sting v1',
  'Closing brand sting, 2-3 seconds: same camera move and teal light hit (#00E5C3) as the AA Reel Studio Brand DNA v1 grade, near-black background (#0A0E0D), no faces, no readable text or logos.',
  true
)
ON CONFLICT (block_type, version) DO NOTHING;
