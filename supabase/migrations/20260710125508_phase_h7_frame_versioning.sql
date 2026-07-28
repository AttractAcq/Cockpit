-- Phase H7: per-frame asset versioning.
--
-- HELD FOR REVIEW — do not apply until the schema + backfill plan is approved.
--
-- Today each carousel slide / story frame is a single client_assets row, unique
-- on (production_brief_id, asset_group_ref, sequence_index). To regenerate one
-- frame as a NEW version (v2, v3) without overwriting history, each frame becomes
-- a stack of rows sharing (brief, group, sequence) but differing by `version`,
-- with exactly one flagged `is_current`.
--
-- Fully backward-compatible: existing rows backfill to version=1, is_current=true
-- (the column defaults do this), so every current group renders unchanged.

-- 1) Version columns.
ALTER TABLE public.client_assets
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  -- Per-frame regeneration lock (stale-recoverable) so two regenerations of the
  -- same frame cannot run at once. Cleared when regeneration settles.
  ADD COLUMN IF NOT EXISTS regen_started_at timestamptz;

-- 2) Relax the per-frame uniqueness to include version (a frame may now hold
--    several versions), and enforce exactly ONE current version per frame.
ALTER TABLE public.client_assets
  DROP CONSTRAINT IF EXISTS client_assets_group_sequence_unique;
ALTER TABLE public.client_assets
  ADD CONSTRAINT client_assets_group_sequence_version_unique
  UNIQUE (production_brief_id, asset_group_ref, sequence_index, version);

-- One current version per (brief, group, sequence). This partial unique index is
-- also the concurrency backstop for "promote to current".
CREATE UNIQUE INDEX IF NOT EXISTS client_assets_one_current_per_frame
  ON public.client_assets (production_brief_id, asset_group_ref, sequence_index)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS client_assets_frame_versions_idx
  ON public.client_assets (production_brief_id, asset_group_ref, sequence_index, version DESC);

-- 3) Atomically make one version the current one for its frame (used by "Make
--    current" and by the regenerate function). SECURITY INVOKER (default) so the
--    existing staff-only RLS policy on client_assets governs it — no privilege
--    escalation; a non-staff caller simply updates nothing.
CREATE OR REPLACE FUNCTION public.activate_asset_version(p_asset_id uuid)
RETURNS SETOF public.client_assets
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_brief uuid; v_group text; v_seq integer;
BEGIN
  SELECT production_brief_id, asset_group_ref, sequence_index
    INTO v_brief, v_group, v_seq
  FROM public.client_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'asset % not found', p_asset_id; END IF;

  -- Clear the current flag on the frame first (avoids a two-current window
  -- against the partial unique index), then set it on the requested version.
  UPDATE public.client_assets
    SET is_current = false, updated_at = now()
  WHERE production_brief_id = v_brief AND asset_group_ref = v_group
    AND sequence_index = v_seq AND id <> p_asset_id AND is_current;

  UPDATE public.client_assets
    SET is_current = true, updated_at = now()
  WHERE id = p_asset_id;

  RETURN QUERY SELECT * FROM public.client_assets WHERE id = p_asset_id;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_asset_version(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.activate_asset_version(uuid) TO authenticated;
