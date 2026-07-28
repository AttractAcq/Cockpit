-- Phase H9: destructive lifecycle controls — additive. HELD FOR REVIEW.
--
-- Adds an audit/recovery table, archive-supersede columns, a published-protection
-- helper, and four TRANSACTIONAL apply RPCs (the DB half of each staged operation;
-- storage deletion is done by the Edge Function before the RPC runs). No existing
-- constraint is weakened, no new cascade is added, no RLS is loosened.

-- ── Audit / recovery log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_destructive_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  operation_type text NOT NULL CHECK (operation_type IN ('delete_asset','delete_phase3_content','reject_asset','reject_content_brief')),
  target_type text NOT NULL,
  target_id uuid,
  target_ref text,
  reason text,
  dry_run boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','pending','complete','failed','blocked')),
  requested_by uuid,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS client_destructive_operations_client_idx ON public.client_destructive_operations (client_id, created_at DESC);

-- ── Archive supersede (immutable audit; never hard-deleted) ───────────────────
ALTER TABLE public.client_asset_archive_snapshots
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_reason text,
  ADD COLUMN IF NOT EXISTS superseded_by_operation_id uuid;

-- ── Published-protection helper ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.phase_ref_is_published(p_client_id uuid, p_source_ref text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_distribution_records
    WHERE client_id = p_client_id AND source_ref = p_source_ref
      AND (publish_status = 'published' OR external_post_id IS NOT NULL OR published_at IS NOT NULL OR published_url IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.client_analytics_records
    WHERE client_id = p_client_id AND source_ref = p_source_ref
      AND (external_post_id IS NOT NULL OR published_at IS NOT NULL OR published_url IS NOT NULL)
  );
$$;

-- ── C: delete one asset/version (storage removed by caller first) ─────────────
-- Promotes the latest remaining version to current if the deleted row was current
-- and the frame still has versions; removes exclusive unpublished downstream only
-- when this was the last asset for the ref. Blocks on any publication evidence.
CREATE OR REPLACE FUNCTION public.apply_delete_asset(p_operation_id uuid, p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  a record; v_remaining int; v_promoted uuid; v_dist int := 0; v_analytics int := 0; v_snap int := 0;
BEGIN
  SELECT * INTO a FROM public.client_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('assets_deleted',0,'note','already absent'); END IF;
  IF public.phase_ref_is_published(a.client_id, a.source_ref) THEN
    RAISE EXCEPTION 'BLOCKED: % is published; local deletion is refused.', a.source_ref;
  END IF;

  DELETE FROM public.client_assets WHERE id = p_asset_id;  -- generation_items.client_asset_id → SET NULL

  SELECT count(*) INTO v_remaining FROM public.client_assets
    WHERE production_brief_id = a.production_brief_id AND asset_group_ref = a.asset_group_ref AND sequence_index = a.sequence_index;

  IF a.is_current AND v_remaining > 0 THEN
    SELECT id INTO v_promoted FROM public.client_assets
      WHERE production_brief_id = a.production_brief_id AND asset_group_ref = a.asset_group_ref AND sequence_index = a.sequence_index
      ORDER BY version DESC LIMIT 1;
    UPDATE public.client_assets SET is_current = true, updated_at = now() WHERE id = v_promoted;
  END IF;

  -- Only clean downstream when the whole ref has no assets left (unpublished only).
  IF NOT EXISTS (SELECT 1 FROM public.client_assets WHERE client_id = a.client_id AND source_ref = a.source_ref) THEN
    WITH d AS (DELETE FROM public.client_distribution_records WHERE client_id = a.client_id AND source_ref = a.source_ref
      AND publish_status <> 'published' AND external_post_id IS NULL AND published_at IS NULL AND published_url IS NULL RETURNING 1)
    SELECT count(*) INTO v_dist FROM d;
    WITH an AS (DELETE FROM public.client_analytics_records WHERE client_id = a.client_id AND source_ref = a.source_ref
      AND external_post_id IS NULL AND published_at IS NULL AND published_url IS NULL RETURNING 1)
    SELECT count(*) INTO v_analytics FROM an;
    WITH s AS (UPDATE public.client_asset_archive_snapshots SET superseded_at = now(), superseded_reason = 'asset permanently deleted', superseded_by_operation_id = p_operation_id
      WHERE client_id = a.client_id AND source_ref = a.source_ref AND superseded_at IS NULL RETURNING 1)
    SELECT count(*) INTO v_snap FROM s;
  END IF;

  RETURN jsonb_build_object('assets_deleted',1,'promoted_version',v_promoted,'remaining_versions',v_remaining,
    'distribution_deleted',v_dist,'analytics_deleted',v_analytics,'snapshots_superseded',v_snap);
END;
$$;

-- ── E: delete a Content-stage master (blocks on approval / any downstream) ────
CREATE OR REPLACE FUNCTION public.apply_delete_phase3_content(p_operation_id uuid, p_client_id uuid, p_master_table text, p_ref text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_state text; v_cells int := 0; v_scope int := 0;
BEGIN
  IF p_master_table NOT IN ('organic_master','story_master','ads_master') THEN RAISE EXCEPTION 'invalid master table %', p_master_table; END IF;
  EXECUTE format('SELECT review_state FROM public.%I WHERE client_id=$1 AND ref=$2', p_master_table) INTO v_state USING p_client_id, p_ref;
  IF v_state IS NULL THEN RETURN jsonb_build_object('master_deleted',0,'note','already absent'); END IF;
  IF v_state = 'approved' THEN RAISE EXCEPTION 'BLOCKED: % is approved (immutable in this slice).', p_ref; END IF;
  IF EXISTS (SELECT 1 FROM public.client_production_briefs WHERE client_id=p_client_id AND source_ref=p_ref)
     OR EXISTS (SELECT 1 FROM public.client_assets WHERE client_id=p_client_id AND source_ref=p_ref)
     OR EXISTS (SELECT 1 FROM public.client_distribution_records WHERE client_id=p_client_id AND source_ref=p_ref)
     OR EXISTS (SELECT 1 FROM public.client_analytics_records WHERE client_id=p_client_id AND source_ref=p_ref)
     OR public.phase_ref_is_published(p_client_id, p_ref) THEN
    RAISE EXCEPTION 'BLOCKED: % has downstream records.', p_ref;
  END IF;
  WITH c AS (DELETE FROM public.calendar_cells WHERE client_id=p_client_id AND ref=p_ref RETURNING 1) SELECT count(*) INTO v_cells FROM c;
  EXECUTE format('DELETE FROM public.%I WHERE client_id=$1 AND ref=$2', p_master_table) USING p_client_id, p_ref;
  UPDATE public.client_phase3_scope_items SET created_master_id = NULL, updated_at = now()
    WHERE created_master_table = p_master_table AND created_master_id IN (
      SELECT created_master_id FROM public.client_phase3_scope_items i JOIN public.client_phase3_scoped_runs r ON r.id=i.run_id
      WHERE r.client_id = p_client_id) AND planned_ref = p_ref;
  GET DIAGNOSTICS v_scope = ROW_COUNT;
  RETURN jsonb_build_object('master_deleted',1,'calendar_cells_deleted',v_cells,'scope_items_unlinked',v_scope);
END;
$$;

-- ── F1: reject asset group → back to Content Briefs ──────────────────────────
-- Deletes CURRENT frames (storage removed by caller), marks historical versions
-- rejected (is_current already false), removes unpublished downstream, supersedes
-- asset-stage snapshots, and returns the brief to production-ready. No promotion.
CREATE OR REPLACE FUNCTION public.apply_reject_asset(p_operation_id uuid, p_client_id uuid, p_asset_group_ref text, p_brief_id uuid, p_source_ref text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_cur int := 0; v_hist int := 0; v_dist int := 0; v_analytics int := 0; v_snap int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.client_assets WHERE client_id=p_client_id AND asset_group_ref=p_asset_group_ref) AND public.phase_ref_is_published(p_client_id, p_source_ref) THEN
    RAISE EXCEPTION 'BLOCKED: % is published; rejection rollback is refused.', p_source_ref;
  END IF;
  WITH d AS (DELETE FROM public.client_assets WHERE client_id=p_client_id AND asset_group_ref=p_asset_group_ref AND is_current = true RETURNING 1) SELECT count(*) INTO v_cur FROM d;
  WITH h AS (UPDATE public.client_assets SET status='rejected', updated_at=now() WHERE client_id=p_client_id AND asset_group_ref=p_asset_group_ref AND is_current = false AND status <> 'rejected' RETURNING 1) SELECT count(*) INTO v_hist FROM h;
  WITH dd AS (DELETE FROM public.client_distribution_records WHERE client_id=p_client_id AND asset_group_ref=p_asset_group_ref
    AND publish_status <> 'published' AND external_post_id IS NULL AND published_at IS NULL AND published_url IS NULL RETURNING 1) SELECT count(*) INTO v_dist FROM dd;
  WITH an AS (DELETE FROM public.client_analytics_records WHERE client_id=p_client_id AND asset_group_ref=p_asset_group_ref
    AND external_post_id IS NULL AND published_at IS NULL AND published_url IS NULL RETURNING 1) SELECT count(*) INTO v_analytics FROM an;
  WITH s AS (UPDATE public.client_asset_archive_snapshots SET superseded_at=now(), superseded_reason='asset group rejected', superseded_by_operation_id=p_operation_id
    WHERE client_id=p_client_id AND asset_group_ref=p_asset_group_ref AND stage='assets' AND superseded_at IS NULL RETURNING 1) SELECT count(*) INTO v_snap FROM s;
  IF p_brief_id IS NOT NULL THEN
    UPDATE public.client_production_briefs SET production_status='brief', production_mode=NULL, updated_at=now() WHERE id=p_brief_id;
  END IF;
  RETURN jsonb_build_object('current_frames_deleted',v_cur,'historical_versions_rejected',v_hist,'distribution_deleted',v_dist,'analytics_deleted',v_analytics,'snapshots_superseded',v_snap);
END;
$$;

-- ── F2: reject Content Brief → back to Content (brief retained as rejected) ───
CREATE OR REPLACE FUNCTION public.apply_reject_content_brief(p_operation_id uuid, p_client_id uuid, p_brief_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_ref text; v_assets int := 0; v_jobs int := 0; v_dist int := 0; v_analytics int := 0; v_snap int := 0;
BEGIN
  SELECT source_ref INTO v_ref FROM public.client_production_briefs WHERE id=p_brief_id AND client_id=p_client_id;
  IF v_ref IS NULL THEN RETURN jsonb_build_object('note','brief absent'); END IF;
  IF public.phase_ref_is_published(p_client_id, v_ref) THEN RAISE EXCEPTION 'BLOCKED: % has published downstream content.', v_ref; END IF;
  -- Retain the brief as immutable rejected evidence (never hard-deleted → no cascade).
  UPDATE public.client_production_briefs SET status='rejected', production_status='failed', updated_at=now() WHERE id=p_brief_id;
  -- Remove non-published generated assets that belong only to this brief (storage removed by caller).
  WITH d AS (DELETE FROM public.client_assets WHERE client_id=p_client_id AND production_brief_id=p_brief_id RETURNING 1) SELECT count(*) INTO v_assets FROM d;
  WITH j AS (DELETE FROM public.client_asset_generation_jobs WHERE client_id=p_client_id AND production_brief_id=p_brief_id RETURNING 1) SELECT count(*) INTO v_jobs FROM j; -- items cascade
  WITH dd AS (DELETE FROM public.client_distribution_records WHERE client_id=p_client_id AND production_brief_id=p_brief_id
    AND publish_status <> 'published' AND external_post_id IS NULL AND published_at IS NULL AND published_url IS NULL RETURNING 1) SELECT count(*) INTO v_dist FROM dd;
  WITH an AS (DELETE FROM public.client_analytics_records WHERE client_id=p_client_id AND source_ref=v_ref
    AND external_post_id IS NULL AND published_at IS NULL AND published_url IS NULL RETURNING 1) SELECT count(*) INTO v_analytics FROM an;
  WITH s AS (UPDATE public.client_asset_archive_snapshots SET superseded_at=now(), superseded_reason='content brief rejected', superseded_by_operation_id=p_operation_id
    WHERE client_id=p_client_id AND source_ref=v_ref AND superseded_at IS NULL RETURNING 1) SELECT count(*) INTO v_snap FROM s;
  RETURN jsonb_build_object('brief_retained_rejected',true,'assets_deleted',v_assets,'generation_jobs_deleted',v_jobs,'distribution_deleted',v_dist,'analytics_deleted',v_analytics,'snapshots_superseded',v_snap);
END;
$$;

-- ── RLS + grants ─────────────────────────────────────────────────────────────
ALTER TABLE public.client_destructive_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_destructive_operations FROM anon;
GRANT SELECT ON public.client_destructive_operations TO authenticated;
DROP POLICY IF EXISTS client_destructive_operations_staff_select ON public.client_destructive_operations;
CREATE POLICY client_destructive_operations_staff_select ON public.client_destructive_operations
  FOR SELECT TO authenticated USING (public.auth_role() IN ('admin','account_manager','editor'));

-- apply RPCs are invoked only by the service role from the Edge Functions.
REVOKE ALL ON FUNCTION public.apply_delete_asset(uuid, uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.apply_delete_phase3_content(uuid, uuid, text, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.apply_reject_asset(uuid, uuid, text, uuid, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.apply_reject_content_brief(uuid, uuid, uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.phase_ref_is_published(uuid, text) FROM anon;
