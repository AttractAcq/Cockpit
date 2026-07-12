-- Phase H5: persisted asset-generation job model.
--
-- WHY: multi-image AI assets (carousel slides, story frames) were generated in a
-- single monolithic edge-function invocation — an N-image sequential loop. Each
-- OpenAI image call takes ~35-45s, so a 6-slide carousel needs ~240s of wall
-- clock and is killed by the edge platform's ~150s cap (HTTP 546,
-- WORKER_RESOURCE_LIMIT / WallClockTime), leaving the brief stuck 'producing'
-- with a partial group.
--
-- FIX: split the work. A parent job holds the plan; one child item per slide/
-- frame is generated in its own short invocation. A job is only finalized (and
-- its production brief marked 'produced') once every item is complete.

-- ── Parent job ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_asset_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  production_brief_id uuid NOT NULL REFERENCES public.client_production_briefs(id) ON DELETE CASCADE,
  source_ref text NOT NULL,
  asset_group_ref text NOT NULL UNIQUE,
  asset_format text NOT NULL CHECK (asset_format IN ('carousel','story_sequence','feed_post','ad_static')),
  expected_output_count integer NOT NULL CHECK (expected_output_count > 0),
  completed_output_count integer NOT NULL DEFAULT 0 CHECK (completed_output_count >= 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','partial','complete','failed','cancelled')),
  visual_mode text CHECK (visual_mode IN ('text_only','uploaded_background','uploaded_insert','generated_background')),
  generation_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_asset_generation_jobs_brief_idx
  ON public.client_asset_generation_jobs (production_brief_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_asset_generation_jobs_client_status_idx
  ON public.client_asset_generation_jobs (client_id, status, updated_at DESC);
-- Cron/worker scan: jobs still needing work.
CREATE INDEX IF NOT EXISTS client_asset_generation_jobs_active_idx
  ON public.client_asset_generation_jobs (status, updated_at)
  WHERE status IN ('queued','processing');

-- At most one ACTIVE (queued/processing) job per production brief — server-side
-- duplicate-operation protection: a second Generate click cannot start a rival job.
CREATE UNIQUE INDEX IF NOT EXISTS client_asset_generation_jobs_one_active_per_brief
  ON public.client_asset_generation_jobs (production_brief_id)
  WHERE status IN ('queued','processing');

-- ── Child items (one per slide/frame) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_asset_generation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_job_id uuid NOT NULL REFERENCES public.client_asset_generation_jobs(id) ON DELETE CASCADE,
  sequence_index integer NOT NULL CHECK (sequence_index > 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','complete','failed')),
  prompt_md text NOT NULL CHECK (length(trim(prompt_md)) > 0),
  storage_path text,
  client_asset_id uuid REFERENCES public.client_assets(id) ON DELETE SET NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_asset_generation_items_job_sequence_unique UNIQUE (generation_job_id, sequence_index)
);

CREATE INDEX IF NOT EXISTS client_asset_generation_items_job_idx
  ON public.client_asset_generation_items (generation_job_id, sequence_index);
CREATE INDEX IF NOT EXISTS client_asset_generation_items_job_status_idx
  ON public.client_asset_generation_items (generation_job_id, status);

-- ── Atomic single-item claim ─────────────────────────────────────────────────
-- Claims exactly one queued item for a job and flips it to 'processing' in one
-- statement. FOR UPDATE SKIP LOCKED means concurrent workers (UI driver + cron
-- safety net) never grab the same item — no double-generation.
CREATE OR REPLACE FUNCTION public.claim_next_asset_generation_item(p_job_id uuid)
RETURNS SETOF public.client_asset_generation_items
LANGUAGE sql
AS $$
  UPDATE public.client_asset_generation_items i
  SET status = 'processing', attempt_count = i.attempt_count + 1, updated_at = now()
  WHERE i.id = (
    SELECT c.id FROM public.client_asset_generation_items c
    WHERE c.generation_job_id = p_job_id AND c.status = 'queued'
    ORDER BY c.sequence_index
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING i.*;
$$;

-- Requeue items wedged in 'processing' past a cutoff (worker killed mid-flight).
-- The cron safety net calls this so a stalled job can finish.
CREATE OR REPLACE FUNCTION public.requeue_stale_asset_generation_items(p_job_id uuid, p_older_than interval)
RETURNS integer
LANGUAGE sql
AS $$
  WITH updated AS (
    UPDATE public.client_asset_generation_items
    SET status = 'queued', updated_at = now()
    WHERE generation_job_id = p_job_id
      AND status = 'processing'
      AND updated_at < now() - p_older_than
    RETURNING 1
  )
  SELECT count(*)::int FROM updated;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Writes go through edge functions (service role, bypasses RLS). The operator UI
-- only needs to READ job/item state to render progress, so staff get SELECT.
ALTER TABLE public.client_asset_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_asset_generation_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_asset_generation_jobs FROM anon;
REVOKE ALL ON public.client_asset_generation_items FROM anon;
GRANT SELECT ON public.client_asset_generation_jobs TO authenticated;
GRANT SELECT ON public.client_asset_generation_items TO authenticated;

DROP POLICY IF EXISTS client_asset_generation_jobs_staff_select ON public.client_asset_generation_jobs;
CREATE POLICY client_asset_generation_jobs_staff_select ON public.client_asset_generation_jobs
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_asset_generation_items_staff_select ON public.client_asset_generation_items;
CREATE POLICY client_asset_generation_items_staff_select ON public.client_asset_generation_items
  FOR SELECT TO authenticated
  USING (
    public.auth_role() IN ('admin','account_manager','editor')
    AND EXISTS (SELECT 1 FROM public.client_asset_generation_jobs j WHERE j.id = generation_job_id)
  );

-- Claim/requeue RPCs are only ever invoked by the service role from edge
-- functions; do not expose them to anon.
REVOKE ALL ON FUNCTION public.claim_next_asset_generation_item(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.requeue_stale_asset_generation_items(uuid, interval) FROM anon;
