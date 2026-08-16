-- Stage L extension: let an approved paid (ads_master-origin) asset attach as
-- a real creative into the existing Ad Studio pipeline, instead of only
-- reaching client_distribution_records like organic content does.
--
-- Two small additive columns, no behavior change to any existing Ad Studio
-- write path (create-ad-opportunity, manage-ad-brief, generate-ad-creative-
-- variants are all untouched):
--
-- ad_opportunities.ads_master_id -- the only way today to find "is there
-- already an Ad Opportunity for this Calendar ref" is by scanning notes/title
-- text. This is the stable key a new attach-asset-to-ad-creative function
-- uses to find-or-create the opportunity idempotently. Nullable and ON DELETE
-- SET NULL: an opportunity is a real planning record and must survive its
-- originating Calendar row being edited/removed later.
--
-- ad_creative_variants.client_asset_id -- visual_ref has always been free
-- text (an index into the brief's typed visual_variants list); there was no
-- way to attach a real image. This FK makes a variant carry a real approved
-- asset when one produced it. Nullable: operator-typed variants (the existing
-- generate-ad-creative-variants path) never set this.

alter table public.ad_opportunities
  add column ads_master_id uuid references public.ads_master(id) on delete set null;

create unique index ad_opportunities_ads_master_unique
  on public.ad_opportunities (client_id, ads_master_id)
  where ads_master_id is not null;

alter table public.ad_opportunities
  drop constraint ad_opportunities_origin_check,
  add constraint ad_opportunities_origin_check check (origin in (
    'manual_idea', 'proof', 'research', 'campaign_requirement',
    'organic_winner', 'performance_insight', 'offer_launch', 'seasonal_trigger',
    'calendar_planned'
  ));

alter table public.ad_creative_variants
  add column client_asset_id uuid references public.client_assets(id) on delete set null;

create index ad_creative_variants_client_asset_idx
  on public.ad_creative_variants (client_asset_id)
  where client_asset_id is not null;
