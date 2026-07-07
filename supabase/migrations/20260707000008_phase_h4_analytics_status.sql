-- Phase H4: extend the H3 analytics landing table with an explicit analytics
-- lifecycle status and free-text notes. Additive only — the existing
-- collection_status column and all H3 rows are left untouched.
--
-- analytics_status: awaiting_metrics → metrics_partial → complete (or failed).
-- Only a genuinely published distribution record ever creates an analytics row,
-- so this status only ever describes real, published assets.
ALTER TABLE public.client_analytics_records
  ADD COLUMN IF NOT EXISTS analytics_status text NOT NULL DEFAULT 'awaiting_metrics'
    CHECK (analytics_status IN ('awaiting_metrics','metrics_partial','complete','failed')),
  ADD COLUMN IF NOT EXISTS notes text;
