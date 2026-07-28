-- Reel Studio Phase D (2026-07-23), applied live on xivewedajschthjlblfb but never
-- captured in this repo. Reconstructed on 2026-07-27 from the ACTUAL deployed
-- constraint definition (pg_get_constraintdef), not from an approximation:
--
--   client_assets_asset_format_check
--   CHECK ((asset_format = ANY (ARRAY['ad_static'::text, 'reel_video'::text,
--           'story_sequence'::text, 'carousel'::text, 'feed_post'::text])))
--
-- Reason it exists: the original constraint predated Reel Studio and omitted
-- 'reel_video' (unlike the equivalent constraint on client_production_briefs,
-- which already allowed it), so handoff-video-project could not insert a clip row.
--
-- This file is idempotent and matches the deployed state exactly; re-applying it
-- is a no-op against the live database.

alter table public.client_assets drop constraint if exists client_assets_asset_format_check;
alter table public.client_assets add constraint client_assets_asset_format_check
  check (asset_format = any (array['ad_static'::text, 'reel_video'::text, 'story_sequence'::text, 'carousel'::text, 'feed_post'::text]));
