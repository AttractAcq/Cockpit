-- Batch B additions — 2026-07-02
-- client_inputs: 6 missing section columns
ALTER TABLE public.client_inputs
  ADD COLUMN IF NOT EXISTS sales_process              text,
  ADD COLUMN IF NOT EXISTS current_marketing          text,
  ADD COLUMN IF NOT EXISTS brand_voice                text,
  ADD COLUMN IF NOT EXISTS competitors                text,
  ADD COLUMN IF NOT EXISTS constraints_approval_rules text,
  ADD COLUMN IF NOT EXISTS raw_notes                  text;

-- story_master: story_type column
ALTER TABLE public.story_master
  ADD COLUMN IF NOT EXISTS story_type text
    CHECK (story_type IN ('daily','sequence','poll','dm_prompt','proof','offer','bts','faq'));

-- client_execution_files: review_state column
ALTER TABLE public.client_execution_files
  ADD COLUMN IF NOT EXISTS review_state public.review_state NOT NULL DEFAULT 'needs_review';
