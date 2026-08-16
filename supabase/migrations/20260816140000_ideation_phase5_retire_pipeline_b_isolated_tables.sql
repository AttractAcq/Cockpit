-- Ideation nav consolidation, Phase 5: drop the Pipeline B tables/function
-- confirmed genuinely isolated to the now-retired Opportunity Pool /
-- Calendar Planning / Production Studio panels.
--
-- Deliberately NOT included here (kept indefinitely, already fully
-- disconnected from the UI since Phase 4 hid every panel that wrote to
-- them): content_opportunities (live FK from ad_opportunities.
-- promoted_from_content_opportunity_id, Stage L; and a Stage M
-- analytics-closed-loop function that actively INSERTs into it), and
-- content_items / content_briefs / content_item_assets (Stage K added
-- nullable FK columns for all three onto the live client_distribution_
-- records table). Dropping any of those requires separately-scoped work
-- touching Ad Studio / Analytics / Distribution, not this nav consolidation.
--
-- Traced every foreign key and RPC across src/, supabase/functions/, and
-- every migration mentioning these table names before drafting this --
-- every table/function dropped here has no dependent outside Pipeline B's
-- own family, with two narrow exceptions caught by Postgres itself on a
-- first dry-run attempt (information_schema's own FK view confirmed these
-- are the only two): content_items.source_proposal_slot_id (nullable) and
-- content_item_assets.production_job_id (not null, but content_item_assets
-- has zero rows and its only writer, Production Studio, is retired in this
-- same phase). Both content_items and content_item_assets are kept
-- (excluded from this drop, see above) as already-frozen historical
-- tables, so CASCADE here only drops the two now-meaningless FK
-- constraints -- it deletes no rows in either table.
--
-- Dropped child-before-parent: content_calendar_proposal_slots before
-- content_calendar_proposals; production_reviews before production_jobs.

drop table if exists public.content_calendar_proposal_slots cascade;
drop table if exists public.content_calendar_proposals;
drop table if exists public.content_opportunity_scores;
drop table if exists public.content_opportunity_sources;
drop table if exists public.content_item_legacy_projections;
drop table if exists public.production_reviews;
drop table if exists public.production_jobs cascade;

drop function if exists public.commit_calendar_proposal(uuid, uuid, integer, uuid);
