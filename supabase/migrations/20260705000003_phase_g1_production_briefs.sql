-- Phase G1: reviewable, versioned production brief documents.
CREATE TABLE IF NOT EXISTS public.client_production_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  execution_month text NOT NULL CHECK (execution_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  source_table text NOT NULL CHECK (source_table IN ('organic_master','story_master','ads_master')),
  source_row_id uuid NOT NULL,
  source_ref text NOT NULL,
  asset_format text NOT NULL CHECK (asset_format IN ('ad_static','reel_video','story_sequence','carousel','feed_post')),
  title text NOT NULL,
  content_md text NOT NULL CHECK (length(trim(content_md)) > 0),
  status public.review_state NOT NULL DEFAULT 'needs_review',
  production_mode text CHECK (production_mode IN ('human','ai')),
  production_status text NOT NULL DEFAULT 'brief' CHECK (production_status IN ('brief','assigned_human','ai_ready','producing','produced','failed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  generated_by_function text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_production_briefs_source_unique UNIQUE (client_id, execution_month, source_ref, asset_format)
);

CREATE INDEX IF NOT EXISTS client_production_briefs_client_month_idx
  ON public.client_production_briefs (client_id, execution_month, updated_at DESC);
CREATE INDEX IF NOT EXISTS client_production_briefs_source_idx
  ON public.client_production_briefs (source_table, source_row_id);

ALTER TABLE public.client_production_briefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_production_briefs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_production_briefs TO authenticated;

DROP POLICY IF EXISTS client_production_briefs_staff_select ON public.client_production_briefs;
CREATE POLICY client_production_briefs_staff_select ON public.client_production_briefs
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_production_briefs_staff_insert ON public.client_production_briefs;
CREATE POLICY client_production_briefs_staff_insert ON public.client_production_briefs
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_production_briefs_staff_update ON public.client_production_briefs;
CREATE POLICY client_production_briefs_staff_update ON public.client_production_briefs
  FOR UPDATE TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'))
  WITH CHECK (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_production_briefs_staff_delete ON public.client_production_briefs;
CREATE POLICY client_production_briefs_staff_delete ON public.client_production_briefs
  FOR DELETE TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'));

