-- Phase H8: scoped Phase 3 generation (date-range + single-item) — additive.
--
-- HELD FOR REVIEW — do not apply until approved.
--
-- The existing month/batch generate-phase-3 engine is UNCHANGED. This adds a
-- scoped path that plans deterministic (date, format) slots inside an inclusive
-- window and generates one master row + one calendar cell per slot, needs_review,
-- with NO brief and NO asset. A scoped run may cross a month boundary, so the
-- month lives on each item (derived from its planned_date), never on the run.

-- ── Run header ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_phase3_scoped_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  generation_mode text NOT NULL CHECK (generation_mode IN ('range','single_item')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  duplicate_policy text NOT NULL DEFAULT 'skip_existing'
    CHECK (duplicate_policy IN ('skip_existing','fill_missing','replace_unapproved')),
  format_filter text[],
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','generating','partial','complete','failed','cancelled')),
  total_slots integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  conflicted_count integer NOT NULL DEFAULT 0,
  created_refs text[] NOT NULL DEFAULT '{}',
  plan jsonb NOT NULL DEFAULT '[]'::jsonb, -- deterministic slot-plan snapshot (audit)
  idempotency_key text,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS client_phase3_scoped_runs_idem
  ON public.client_phase3_scoped_runs (client_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_phase3_scoped_runs_client_idx
  ON public.client_phase3_scoped_runs (client_id, created_at DESC);

-- ── One item per planned slot ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_phase3_scope_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.client_phase3_scoped_runs(id) ON DELETE CASCADE,
  execution_month text NOT NULL CHECK (execution_month ~ '^\d{4}-(0[1-9]|1[0-2])$'), -- from planned_date
  slot_key text NOT NULL,   -- deterministic, e.g. 2026-07-12:feed_post:1 / 2026-07-12:ad_static:lane-1
  planned_date date NOT NULL,
  end_date date,            -- ad stint end; null for single-date formats
  asset_format text NOT NULL CHECK (asset_format IN ('feed_post','carousel','reel_video','story_sequence','ad_static')),
  type_code text NOT NULL CHECK (type_code IN ('FP','CR','RL','ST','AD')),
  action text NOT NULL CHECK (action IN ('create','skip','conflict','replace')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','complete','skipped','failed')),
  planned_ref text,
  created_master_table text,
  created_master_id uuid,
  calendar_cell_id uuid,
  conflict_reason text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_phase3_scope_items_run_slot_unique UNIQUE (run_id, slot_key)
);
CREATE INDEX IF NOT EXISTS client_phase3_scope_items_run_idx
  ON public.client_phase3_scope_items (run_id, status);

-- ── Atomic slot claim ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_next_phase3_scope_item(p_run_id uuid)
RETURNS SETOF public.client_phase3_scope_items
LANGUAGE sql
AS $$
  UPDATE public.client_phase3_scope_items i
  SET status = 'processing', updated_at = now()
  WHERE i.id = (
    SELECT c.id FROM public.client_phase3_scope_items c
    WHERE c.run_id = p_run_id AND c.status = 'queued'
    ORDER BY c.planned_date, c.slot_key
    LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  RETURNING i.*;
$$;

-- ── Concurrency-safe ref allocation ──────────────────────────────────────────
-- Transaction-scoped advisory lock keyed by (client, month, type) serialises
-- allocation; the next ### is max+1 over that month/type across the relevant
-- master table AND any refs already reserved on in-flight scope items. The
-- existing UNIQUE(client_id, ref) constraint on the master tables is the final
-- protection (callers retry on the rare conflict). Shared by both modes.
CREATE OR REPLACE FUNCTION public.allocate_phase3_ref(
  p_client_id uuid, p_planned_date date, p_type_code text
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_month text := to_char(p_planned_date, 'YYYY-MM');
  v_prefix text := upper(to_char(p_planned_date, 'Mon')) || to_char(p_planned_date, 'DD');
  v_pat text := '-' || p_type_code || '-([0-9]+)$';
  v_max int := 0;
  v_master int := 0;
  v_reserved int := 0;
BEGIN
  IF p_type_code NOT IN ('FP','CR','RL','ST','AD') THEN
    RAISE EXCEPTION 'invalid type_code %', p_type_code;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_client_id::text || ':' || v_month || ':' || p_type_code)::bigint);

  IF p_type_code IN ('FP','CR','RL') THEN
    SELECT coalesce(max((substring(ref from v_pat))::int), 0) INTO v_master
    FROM public.organic_master WHERE client_id = p_client_id AND month = v_month AND ref ~ v_pat;
  ELSIF p_type_code = 'ST' THEN
    SELECT coalesce(max((substring(ref from v_pat))::int), 0) INTO v_master
    FROM public.story_master WHERE client_id = p_client_id AND month = v_month AND ref ~ v_pat;
  ELSE
    SELECT coalesce(max((substring(ref from v_pat))::int), 0) INTO v_master
    FROM public.ads_master WHERE client_id = p_client_id AND month = v_month AND ref ~ v_pat;
  END IF;

  -- Refs already reserved on other in-flight scope items (same client/month/type).
  SELECT coalesce(max((substring(i.planned_ref from v_pat))::int), 0) INTO v_reserved
  FROM public.client_phase3_scope_items i
  WHERE i.execution_month = v_month AND i.planned_ref ~ v_pat
    AND i.run_id IN (SELECT id FROM public.client_phase3_scoped_runs WHERE client_id = p_client_id);

  v_max := greatest(v_master, v_reserved);
  RETURN v_prefix || '-' || p_type_code || '-' || lpad((v_max + 1)::text, 3, '0');
END;
$$;

-- ── Transactional replace safety ─────────────────────────────────────────────
-- Re-checks at EXECUTION time that a master row is still safe to replace: still
-- needs_review (unapproved), still only at the Content/master stage, and has NO
-- Content Brief, generated Asset, Distribution, Analytics, or Archive snapshot.
-- Returns true and deletes the master + its calendar cells if safe; false otherwise.
CREATE OR REPLACE FUNCTION public.replace_phase3_master_if_safe(
  p_client_id uuid, p_master_table text, p_ref text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ok boolean := false;
  v_brief int := 0; v_asset int := 0; v_dist int := 0; v_analytics int := 0; v_archive int := 0;
BEGIN
  IF p_master_table NOT IN ('organic_master','story_master','ads_master') THEN
    RAISE EXCEPTION 'invalid master table %', p_master_table;
  END IF;
  -- Master must still exist and be unapproved (needs_review).
  IF p_master_table = 'organic_master' THEN
    SELECT true INTO v_ok FROM public.organic_master WHERE client_id = p_client_id AND ref = p_ref AND review_state = 'needs_review';
  ELSIF p_master_table = 'story_master' THEN
    SELECT true INTO v_ok FROM public.story_master WHERE client_id = p_client_id AND ref = p_ref AND review_state = 'needs_review';
  ELSE
    SELECT true INTO v_ok FROM public.ads_master WHERE client_id = p_client_id AND ref = p_ref AND review_state = 'needs_review';
  END IF;
  IF v_ok IS NOT TRUE THEN RETURN false; END IF;

  -- Any downstream record for this ref blocks replacement.
  SELECT count(*) INTO v_brief FROM public.client_production_briefs WHERE client_id = p_client_id AND source_ref = p_ref;
  SELECT count(*) INTO v_asset FROM public.client_assets WHERE client_id = p_client_id AND source_ref = p_ref;
  SELECT count(*) INTO v_dist FROM public.client_distribution_records WHERE client_id = p_client_id AND source_ref = p_ref;
  SELECT count(*) INTO v_analytics FROM public.client_analytics_records WHERE client_id = p_client_id AND source_ref = p_ref;
  SELECT count(*) INTO v_archive FROM public.client_asset_archive_snapshots WHERE client_id = p_client_id AND source_ref = p_ref;
  IF v_brief > 0 OR v_asset > 0 OR v_dist > 0 OR v_analytics > 0 OR v_archive > 0 THEN
    RETURN false;
  END IF;

  DELETE FROM public.calendar_cells WHERE client_id = p_client_id AND ref = p_ref;
  IF p_master_table = 'organic_master' THEN
    DELETE FROM public.organic_master WHERE client_id = p_client_id AND ref = p_ref;
  ELSIF p_master_table = 'story_master' THEN
    DELETE FROM public.story_master WHERE client_id = p_client_id AND ref = p_ref;
  ELSE
    DELETE FROM public.ads_master WHERE client_id = p_client_id AND ref = p_ref;
  END IF;
  RETURN true;
END;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.client_phase3_scoped_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_phase3_scope_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_phase3_scoped_runs FROM anon;
REVOKE ALL ON public.client_phase3_scope_items FROM anon;
GRANT SELECT ON public.client_phase3_scoped_runs TO authenticated;
GRANT SELECT ON public.client_phase3_scope_items TO authenticated;

DROP POLICY IF EXISTS client_phase3_scoped_runs_staff_select ON public.client_phase3_scoped_runs;
CREATE POLICY client_phase3_scoped_runs_staff_select ON public.client_phase3_scoped_runs
  FOR SELECT TO authenticated USING (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_phase3_scope_items_staff_select ON public.client_phase3_scope_items;
CREATE POLICY client_phase3_scope_items_staff_select ON public.client_phase3_scope_items
  FOR SELECT TO authenticated USING (public.auth_role() IN ('admin','account_manager','editor'));

REVOKE ALL ON FUNCTION public.claim_next_phase3_scope_item(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.allocate_phase3_ref(uuid, date, text) FROM anon;
REVOKE ALL ON FUNCTION public.replace_phase3_master_if_safe(uuid, text, text) FROM anon;
