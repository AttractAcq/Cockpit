-- Phase H6: per-frame distribution records for Instagram image Stories.
--
-- Meta requires ONE image per Story container, so a multi-frame Story sequence
-- (several frames under one asset_group_ref) must be published as separate
-- Stories. We therefore represent each Story frame as its own distribution
-- record. This relaxes the "one record per asset group" uniqueness to
-- "one record per (asset group, sequence_index)".
--
-- Fully backward-compatible: every non-Story format keeps a single record with
-- sequence_index = 1, so existing rows and flows are unchanged.

-- ── Distribution records: add sequence columns, relax uniqueness ─────────────
ALTER TABLE public.client_distribution_records
  ADD COLUMN IF NOT EXISTS sequence_index integer NOT NULL DEFAULT 1 CHECK (sequence_index > 0),
  ADD COLUMN IF NOT EXISTS sequence_count integer CHECK (sequence_count IS NULL OR sequence_count > 0);

ALTER TABLE public.client_distribution_records
  DROP CONSTRAINT IF EXISTS client_distribution_records_group_unique;
ALTER TABLE public.client_distribution_records
  ADD CONSTRAINT client_distribution_records_group_seq_unique
  UNIQUE (client_id, asset_group_ref, sequence_index);

CREATE INDEX IF NOT EXISTS client_distribution_records_group_seq_idx
  ON public.client_distribution_records (client_id, asset_group_ref, sequence_index);

-- ── Analytics records: same per-frame keying so each frame lands separately ──
ALTER TABLE public.client_analytics_records
  ADD COLUMN IF NOT EXISTS sequence_index integer NOT NULL DEFAULT 1 CHECK (sequence_index > 0);

ALTER TABLE public.client_analytics_records
  DROP CONSTRAINT IF EXISTS client_analytics_records_group_unique;
ALTER TABLE public.client_analytics_records
  ADD CONSTRAINT client_analytics_records_group_seq_unique
  UNIQUE (client_id, asset_group_ref, sequence_index);
