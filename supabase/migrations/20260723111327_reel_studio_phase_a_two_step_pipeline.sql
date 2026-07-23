-- Reel Studio Phase A correction: Higgsfield's DoP model family (the only
-- video model confirmed available on the account, categorized "Image to
-- Video" on Higgsfield's own dashboard) requires a source still image plus a
-- camera-motion directive -- it is NOT text-to-video. The real per-shot
-- pipeline is two Higgsfield calls, not one:
--   1. Text-to-image (Soul Standard / Popcorn Auto) from compiled_prompt +
--      brand DNA -> a still frame, downloaded into video-assets.
--   2. Image-to-video (DoP) using that still + a motion directive -> the
--      final clip, downloaded into video-assets (unchanged from Phase A).
--
-- This is an additive migration on top of the already-applied
-- 20260722203942_reel_studio_phase_a_foundations.sql -- that file is never
-- edited in place once applied.

-- ── Still-image stage columns ────────────────────────────────────────────────
ALTER TABLE public.video_shots
  ADD COLUMN IF NOT EXISTS still_image_url text,
  ADD COLUMN IF NOT EXISTS still_image_job_id text,
  ADD COLUMN IF NOT EXISTS still_image_model text,
  ADD COLUMN IF NOT EXISTS motion_type text,
  ADD COLUMN IF NOT EXISTS motion_strength numeric(3,2);

ALTER TABLE public.video_shots
  ADD CONSTRAINT video_shots_still_image_model_check
    CHECK (still_image_model IS NULL OR btrim(still_image_model) <> ''),
  ADD CONSTRAINT video_shots_motion_type_check
    CHECK (motion_type IS NULL OR btrim(motion_type) <> ''),
  ADD CONSTRAINT video_shots_motion_strength_check
    CHECK (motion_strength IS NULL OR motion_strength BETWEEN 0 AND 1);

-- ── Expand the shot lifecycle to the two-stage pipeline ──────────────────────
-- pending -> still_submitted -> still_rendering -> still_complete
--         -> submitted -> rendering -> complete / failed
-- 'failed' is reachable from either stage; there is no separate
-- still-image-failed value so both stages fail into the same terminal state.
ALTER TABLE public.video_shots DROP CONSTRAINT video_shots_status_check;
ALTER TABLE public.video_shots ADD CONSTRAINT video_shots_status_check
  CHECK (status IN (
    'pending',
    'still_submitted', 'still_rendering', 'still_complete',
    'submitted', 'rendering',
    'complete', 'failed'
  ));

-- ── Cron/worker scan index: now also covers the still-image stage ───────────
DROP INDEX IF EXISTS public.video_shots_active_idx;
CREATE INDEX video_shots_active_idx
  ON public.video_shots (status, updated_at)
  WHERE status IN ('still_submitted', 'still_rendering', 'submitted', 'rendering');
