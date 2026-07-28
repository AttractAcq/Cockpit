-- Phase H1: operational lifecycle foundation.
-- Two additive tables. No source rows are read, moved, or deleted here.
--
--   client_asset_pipeline_state     — one mutable row per (client, month, source_ref)
--                                     recording the stage a piece of content is
--                                     ACTIVE in. Source rows stay in their own tables.
--   client_asset_archive_snapshots  — append-only, immutable snapshots of the data a
--                                     ref held in the stage it just left. Lifecycle
--                                     memory, not a delete/move destination.
--
-- Stages: master → content_creation → assets → distribution → analytics → analysis
--         → completed → archived  (last two are pipeline-state only).
-- RLS follows the Cockpit staff pattern: auth_role() IN ('admin','account_manager','editor').

-- ── Pipeline state ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_asset_pipeline_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  execution_month text NOT NULL CHECK (execution_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  source_ref text NOT NULL,
  asset_group_ref text,
  production_brief_id uuid REFERENCES public.client_production_briefs(id) ON DELETE SET NULL,
  current_stage text NOT NULL DEFAULT 'master'
    CHECK (current_stage IN ('master','content_creation','assets','distribution','analytics','analysis','completed','archived')),
  previous_stage text
    CHECK (previous_stage IS NULL OR previous_stage IN ('master','content_creation','assets','distribution','analytics','analysis','completed','archived')),
  title text,
  asset_format text,
  active boolean NOT NULL DEFAULT true,
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  last_transition_at timestamptz NOT NULL DEFAULT now(),
  transition_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_asset_pipeline_state_ref_unique UNIQUE (client_id, execution_month, source_ref)
);

CREATE INDEX IF NOT EXISTS client_asset_pipeline_state_client_month_idx
  ON public.client_asset_pipeline_state (client_id, execution_month, current_stage);
CREATE INDEX IF NOT EXISTS client_asset_pipeline_state_source_ref_idx
  ON public.client_asset_pipeline_state (client_id, source_ref);
CREATE INDEX IF NOT EXISTS client_asset_pipeline_state_group_ref_idx
  ON public.client_asset_pipeline_state (asset_group_ref);
CREATE INDEX IF NOT EXISTS client_asset_pipeline_state_active_stage_idx
  ON public.client_asset_pipeline_state (client_id, execution_month, active, current_stage);

ALTER TABLE public.client_asset_pipeline_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_asset_pipeline_state FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.client_asset_pipeline_state TO authenticated;

DROP POLICY IF EXISTS client_asset_pipeline_state_staff_select ON public.client_asset_pipeline_state;
CREATE POLICY client_asset_pipeline_state_staff_select ON public.client_asset_pipeline_state
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_asset_pipeline_state_staff_insert ON public.client_asset_pipeline_state;
CREATE POLICY client_asset_pipeline_state_staff_insert ON public.client_asset_pipeline_state
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_asset_pipeline_state_staff_update ON public.client_asset_pipeline_state;
CREATE POLICY client_asset_pipeline_state_staff_update ON public.client_asset_pipeline_state
  FOR UPDATE TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'))
  WITH CHECK (public.auth_role() IN ('admin','account_manager','editor'));

-- ── Archive snapshots (append-only) ─────────────────────────────────────────
-- No UPDATE/DELETE grant: snapshots are immutable once written. Versioning, if
-- ever needed, is a new row — never an overwrite.
CREATE TABLE IF NOT EXISTS public.client_asset_archive_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  execution_month text NOT NULL CHECK (execution_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  source_ref text NOT NULL,
  asset_group_ref text,
  stage text NOT NULL
    CHECK (stage IN ('master','content_creation','assets','distribution','analytics','analysis')),
  title text,
  asset_format text,
  source_table text NOT NULL,
  source_row_id uuid,
  snapshot_data jsonb NOT NULL,
  snapshot_md text,
  snapshot_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS client_asset_archive_snapshots_client_month_idx
  ON public.client_asset_archive_snapshots (client_id, execution_month);
CREATE INDEX IF NOT EXISTS client_asset_archive_snapshots_source_ref_idx
  ON public.client_asset_archive_snapshots (client_id, source_ref);
CREATE INDEX IF NOT EXISTS client_asset_archive_snapshots_group_ref_idx
  ON public.client_asset_archive_snapshots (asset_group_ref);
CREATE INDEX IF NOT EXISTS client_asset_archive_snapshots_stage_idx
  ON public.client_asset_archive_snapshots (stage);
CREATE INDEX IF NOT EXISTS client_asset_archive_snapshots_created_idx
  ON public.client_asset_archive_snapshots (client_id, created_at DESC);

ALTER TABLE public.client_asset_archive_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_asset_archive_snapshots FROM anon;
GRANT SELECT, INSERT ON public.client_asset_archive_snapshots TO authenticated;

DROP POLICY IF EXISTS client_asset_archive_snapshots_staff_select ON public.client_asset_archive_snapshots;
CREATE POLICY client_asset_archive_snapshots_staff_select ON public.client_asset_archive_snapshots
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_asset_archive_snapshots_staff_insert ON public.client_asset_archive_snapshots;
CREATE POLICY client_asset_archive_snapshots_staff_insert ON public.client_asset_archive_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() IN ('admin','account_manager','editor'));
