-- Phase G3: reviewable AI-generated image assets stored in a private bucket.
CREATE TABLE IF NOT EXISTS public.client_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  production_brief_id uuid NOT NULL REFERENCES public.client_production_briefs(id) ON DELETE CASCADE,
  source_ref text NOT NULL,
  asset_format text NOT NULL CHECK (asset_format IN ('ad_static','story_sequence','carousel','feed_post')),
  asset_group_ref text NOT NULL,
  sequence_index integer NOT NULL DEFAULT 1 CHECK (sequence_index > 0),
  title text,
  storage_bucket text NOT NULL DEFAULT 'client-assets' CHECK (storage_bucket = 'client-assets'),
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL DEFAULT 'image/png' CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  status public.review_state NOT NULL DEFAULT 'needs_review',
  generation_provider text NOT NULL,
  generation_model text NOT NULL,
  prompt_md text NOT NULL CHECK (length(trim(prompt_md)) > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_assets_group_sequence_unique UNIQUE (production_brief_id, asset_group_ref, sequence_index)
);

CREATE INDEX IF NOT EXISTS client_assets_client_created_idx
  ON public.client_assets (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_assets_brief_group_idx
  ON public.client_assets (production_brief_id, asset_group_ref, sequence_index);
CREATE INDEX IF NOT EXISTS client_assets_source_ref_idx
  ON public.client_assets (client_id, source_ref);

ALTER TABLE public.client_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_assets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_assets TO authenticated;

DROP POLICY IF EXISTS client_assets_staff_all ON public.client_assets;
CREATE POLICY client_assets_staff_all ON public.client_assets
  FOR ALL TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'))
  WITH CHECK (public.auth_role() IN ('admin','account_manager','editor'));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('client-assets', 'client-assets', false, 20971520, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS client_assets_storage_staff_select ON storage.objects;
CREATE POLICY client_assets_storage_staff_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'client-assets' AND public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_assets_storage_staff_insert ON storage.objects;
CREATE POLICY client_assets_storage_staff_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-assets' AND public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_assets_storage_staff_update ON storage.objects;
CREATE POLICY client_assets_storage_staff_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'client-assets' AND public.auth_role() IN ('admin','account_manager','editor'))
  WITH CHECK (bucket_id = 'client-assets' AND public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_assets_storage_staff_delete ON storage.objects;
CREATE POLICY client_assets_storage_staff_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'client-assets' AND public.auth_role() IN ('admin','account_manager','editor'));
