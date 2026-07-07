-- Phase H3: distribution records + a minimal analytics landing table.
-- Assets never physically leave client_assets. When an asset group is approved
-- it gets a client_distribution_records row (publish_status = 'ready'); only a
-- real publish success advances it to analytics (client_analytics_records).
-- RLS follows the Cockpit staff pattern: auth_role() IN ('admin','account_manager','editor').

-- ── Distribution records ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_distribution_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  execution_month text NOT NULL CHECK (execution_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  source_ref text NOT NULL,
  asset_group_ref text NOT NULL,
  production_brief_id uuid REFERENCES public.client_production_briefs(id) ON DELETE SET NULL,
  asset_format text NOT NULL,
  title text,
  publish_status text NOT NULL DEFAULT 'ready'
    CHECK (publish_status IN ('ready','scheduled','publishing','published','failed','cancelled')),
  publish_mode text CHECK (publish_mode IN ('publish_now','scheduled')),
  planned_publish_date date,
  scheduled_publish_at timestamptz,
  published_at timestamptz,
  published_url text,
  external_post_id text,
  platform text DEFAULT 'instagram',
  destination text,
  publish_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  publish_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_distribution_records_group_unique UNIQUE (client_id, asset_group_ref)
);

CREATE INDEX IF NOT EXISTS client_distribution_records_client_month_idx
  ON public.client_distribution_records (client_id, execution_month, publish_status);
CREATE INDEX IF NOT EXISTS client_distribution_records_source_ref_idx
  ON public.client_distribution_records (client_id, source_ref);
-- The scheduled worker scans this: due = scheduled AND scheduled_publish_at <= now().
CREATE INDEX IF NOT EXISTS client_distribution_records_due_idx
  ON public.client_distribution_records (publish_status, scheduled_publish_at);

ALTER TABLE public.client_distribution_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_distribution_records FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.client_distribution_records TO authenticated;

DROP POLICY IF EXISTS client_distribution_records_staff_select ON public.client_distribution_records;
CREATE POLICY client_distribution_records_staff_select ON public.client_distribution_records
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_distribution_records_staff_insert ON public.client_distribution_records;
CREATE POLICY client_distribution_records_staff_insert ON public.client_distribution_records
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_distribution_records_staff_update ON public.client_distribution_records;
CREATE POLICY client_distribution_records_staff_update ON public.client_distribution_records
  FOR UPDATE TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'))
  WITH CHECK (public.auth_role() IN ('admin','account_manager','editor'));

-- ── Analytics landing (minimal — H4 builds the UI) ──────────────────────────
-- Only a genuinely published asset lands here. Never populated for ready /
-- scheduled / failed / cancelled records.
CREATE TABLE IF NOT EXISTS public.client_analytics_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  execution_month text NOT NULL CHECK (execution_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  source_ref text NOT NULL,
  asset_group_ref text NOT NULL,
  distribution_record_id uuid REFERENCES public.client_distribution_records(id) ON DELETE SET NULL,
  production_brief_id uuid,
  asset_format text,
  title text,
  platform text DEFAULT 'instagram',
  published_at timestamptz NOT NULL,
  published_url text,
  external_post_id text,
  collection_status text NOT NULL DEFAULT 'active'
    CHECK (collection_status IN ('active','paused','closed')),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_analytics_records_group_unique UNIQUE (client_id, asset_group_ref)
);

CREATE INDEX IF NOT EXISTS client_analytics_records_client_month_idx
  ON public.client_analytics_records (client_id, execution_month);
CREATE INDEX IF NOT EXISTS client_analytics_records_source_ref_idx
  ON public.client_analytics_records (client_id, source_ref);

ALTER TABLE public.client_analytics_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_analytics_records FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.client_analytics_records TO authenticated;

DROP POLICY IF EXISTS client_analytics_records_staff_select ON public.client_analytics_records;
CREATE POLICY client_analytics_records_staff_select ON public.client_analytics_records
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_analytics_records_staff_insert ON public.client_analytics_records;
CREATE POLICY client_analytics_records_staff_insert ON public.client_analytics_records
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS client_analytics_records_staff_update ON public.client_analytics_records;
CREATE POLICY client_analytics_records_staff_update ON public.client_analytics_records
  FOR UPDATE TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'))
  WITH CHECK (public.auth_role() IN ('admin','account_manager','editor'));
