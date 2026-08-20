# Stage 2, Phase 05 — Marketing IA Consolidation: Dependency Trace

This document is Phase 05's own exit gate: "a complete, documented dependency trace exists before any table is touched — no exceptions, regardless of how cosmetic the change looks." Written and completed before any migration was applied or any frontend code was written.

## Scope

The plan targets nesting five existing per-client nav groups under one "Marketing" parent, plus one new object, Campaigns. Current structure (`DELIVERY_PAGES` in `ClientDetailPage.tsx`):

| Nav group | Tabs | Underlying tables |
|---|---|---|
| Offer | Main Offers, Seasonal Offers, Offer (hidden legacy) | `client_main_offers`, `client_offer_architecture_releases`, `client_money_model_components`, `client_offer_approval_decisions`, `client_offer_architecture_active_releases`, `client_seasonal_offers`, `client_seasonal_offer_releases`, `client_seasonal_offer_active_releases` |
| Ideation | Content Supply, Calendar, Content Items | Already consolidated (Ideation/Creation nav restructure, PR #22, and Ideation Phase 6, `e826e10`) — no re-trace needed here. |
| Creation | Content Briefs, Reel Studio, Assets | Already consolidated, same as above. |
| Distribution | Organic, Paid | `client_distribution_records`, `client_distribution_accounts`, `client_distribution_account_capabilities`, `client_distribution_policies`, plus Ad Studio's `ad_*` tables for Paid |
| Iteration | Analytics, Performance & Iteration | `client_analytics_records`, `client_performance_analysis_runs`, `client_performance_scores`, `client_performance_insights`, `client_iteration_candidates`, `client_iteration_reviews`, `client_metric_snapshots`, `client_business_signal_snapshots`, `client_insights_collection_runs`/`_attempts` |

Explicitly out of scope, per the plan's own text: Avatars, Website (Lead Magnets/Landing Pages), Intelligence/Strategy. These stay top-level, untouched.

## Method

Same discipline as the original Ideation/Creation consolidation (nav restructure, PR #22 Phase 5) and every migration since: query `information_schema` directly for every inbound foreign key into the Offer/Distribution/Iteration/Avatar table clusters, then read (not just grep) anything unexpected. Avatar releases (`client_avatar_releases`) were included in the trace even though Avatars stays top-level, since Campaigns is meant to reference it.

## Findings

**No external landmines — a genuinely different result from the Ideation/Creation trace.** Every inbound foreign key into these table clusters resolves to another table already inside Marketing's own natural boundary:

- `client_avatar_releases` ← `client_production_briefs`, `video_projects` (Creation consuming an approved avatar — expected, already inside the boundary).
- `client_distribution_records` ← `client_business_signal_snapshots`, `client_context_update_proposals`, `client_insights_collection_attempts`, `client_metric_snapshots`, `client_publish_attempts`, `content_items`, `content_performance` (all Distribution/Iteration's own metrics/publishing pipeline — expected).
- `client_iteration_candidates` ← `client_context_update_proposals`, `client_platform_experiments` (expected).
- `client_main_offers` / `client_offer_architecture_releases` / `client_seasonal_offers` ← `client_ideation_authority_inputs` (Ideation consuming an approved Offer — expected, both sides of this FK are inside Marketing) and `client_money_model_components` (Offer's own sub-table).

**Why this differs from Ideation/Creation's trace:** that consolidation *dropped* tables, so every inbound reference from outside the boundary was a real risk (Ad Studio's `promoted_from_content_opportunity_id`, an Analytics automation writing into `content_opportunities`). Phase 05 drops nothing — per its own steps, the nav change ships "hidden-but-routable first, not deleted," and no table anywhere in this phase's scope is dropped. With nothing being removed, an inbound FK from outside the boundary would still be worth knowing about, but it can't actually break anything — and the trace found none regardless.

**A real naming collision, caught before it happened.** "Campaigns" is already used for two *different* concepts in this schema: `ad_campaigns` (a single-channel paid-execution record, Ad Studio/Distribution's own object) and `client_campaign_periods` / `client_campaign_intelligence_releases` (Campaign Intelligence — a strategic time-window concept, Intelligence-domain, consumed by Ideation and Seasonal Offers). The plan's "Marketing → Campaigns" — an object linking offer, avatar, channel, budget and results — is a third, distinct concept. Naming it plain `campaigns` (or anything colliding with `ad_campaigns`/`client_campaign_*`) would create exactly the kind of ambiguity this discipline exists to prevent. **Decided: `client_marketing_campaigns`.**

## Decisions made from this trace (recorded, both confirmed with Alex, 2026-08-20)

1. **Nav nesting: visual grouping only, no new nav level.** Every existing pill (Offer, Ideation, Creation, Distribution, Iteration) keeps its exact route and one-click reach — this app has never had a 3-level nav (page → sub-page → tab), and introducing one now would add a click to the most-used areas (Ideation, Creation) for a purely organizational win. Cluster the pills together with a shared "Marketing" label above them in the same pill row. Zero routes change, zero risk, fully reversible.

   **Correction found during implementation, not by the trace itself:** the first pass reordered `DELIVERY_PAGES` to make the cluster fully contiguous, moving Avatars out from between Offer and Ideation. That broke a real, pre-existing, deliberate assertion (`tests/avatar-os-stage5.test.ts`: `label: "Offer"[\s\S]*label: "Avatars"[\s\S]*label: "Ideation"`) — caught by the full test suite, not the dependency trace, since it's a UI-ordering concern outside the trace's database-FK scope. Fixed by leaving Avatars in its exact original position and accepting two separate "Marketing"-labeled segments in the pill row (Offer alone, then Campaigns/Ideation/Creation/Distribution/Iteration together) rather than editing a pre-existing test to fit new code. Worth naming as a discipline point of its own: a dependency trace covers database FKs; it does not replace running the full test suite before considering a UI change safe.
2. **Campaigns v1 links offer, avatar, and channel — real, populated FKs.** Budget and results stay explicit empty shells (per the plan's own deferral, pending Finance/08 and real Distribution linkage). Asset linkage is deferred alongside them: no workflow anywhere in this app currently tags an asset as "belonging to a campaign," so building a real many-to-many join table now would be guessing at a shape before any real usage exists to design it against (Principle 01).

## Conclusion

Safe to proceed, additive-only: one new table (`client_marketing_campaigns`), one new admin/staff RPC, one new thin UI panel, and a purely visual nav-grouping change. Nothing is hidden, dropped, or modified in any existing table, route, or component this phase.
