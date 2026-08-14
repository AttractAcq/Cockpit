# Attract Acquisition Cockpit — Stage 4 Build Context

Status: Built locally, schema applied to the linked Supabase project, with live generation dependent on Edge Function deployment.

Stage 4 is the Campaign Intelligence + Offers + Ideation integration build. Its architectural purpose is to keep Campaign Intelligence, Offers, and Ideation as separate authority-producing modules with explicit handoffs. It must not become a rigid campaign-to-offer-to-content pipeline.

## Core Principle

Stage 4 preserves separation of concerns:

- Campaign Intelligence answers: what matters when, and why?
- Main Offers answer: what is the underlying commercial engine?
- Seasonal Offers answer: what should we package or sell around this campaign moment?
- Ideation answers: given all available inputs, what should we create?

Ideation remains a hub. It may consume Campaign Intelligence, Main Offers, and Seasonal Offers, but none of those inputs are mandatory and none of them should dominate every idea.

## Stage 4A — Campaign Intelligence Foundations

Purpose: create the strategic calendar authority layer.

Build scope:

- Add schema for Campaign Intelligence releases, campaign periods, source/evidence links, approval decisions, and active releases.
- Add `run-campaign-intelligence`.
- Consume only approved upstream Intelligence authority.
- Output review-gated draft campaign periods.
- Preserve human approval as the promotion mechanism.

Campaign Intelligence should define strategic periods with fields such as:

- theme
- timing
- ICP context
- emotional state
- pain-point salience
- desired outcome
- awareness shift
- strategic messaging direction
- positioning direction
- campaign objective
- previous-period relationship
- evidence/source references

It does not generate offers or content ideas.

## Stage 4B — Campaign Intelligence UI

Purpose: make Campaign Intelligence reviewable and operable.

Build scope:

- Add a Campaign Intelligence surface under Intelligence.
- Show period/timeline views.
- Show period detail.
- Show evidence/authority context.
- Show draft, needs review, approved, superseded, and archived states.
- Support approval and review flow.

Draft campaign periods are not downstream authority. Only approved Campaign Intelligence can inform downstream modules.

## Stage 4C — Main Offers

Purpose: create foundational commercial architecture.

Build scope:

- Add an Offers page with Main Offers and Seasonal Offers tabs.
- Implement Main Offers first.
- Add versioned offer architecture releases.
- Add main offer rows beneath each release.
- Add review/approval mechanics.
- Keep Money Model fields separate from campaign fields.

Main Offers model the stable economic engine of the business:

- core/front-end offers
- problem solved
- ICP fit
- dream outcome
- perceived likelihood of achievement
- time delay
- effort and sacrifice
- price/risk/friction
- bonuses
- guarantees/risk reversals
- upsells
- downsells
- continuity offers
- sequencing
- money model mechanics

Main Offers are not calendar-dependent and should not be rewritten just because campaign timing changes.

## Stage 4D — Seasonal Offers

Purpose: adapt approved Main Offers to approved Campaign Intelligence moments.

Build scope:

- Add Seasonal Offers tab.
- Allow Seasonal Offers to consume an approved Campaign Intelligence period and an approved Main Offer.
- Generate/package seasonal offer drafts.
- Store the relationship:

```text
seasonal_offer -> campaign_period -> main_offer
```

Seasonal Offers can adapt:

- angle
- packaging
- urgency
- bonus stack
- positioning
- mechanism
- reason to act now
- CTA
- constraints
- offer risk

Seasonal Offers do not rewrite the core offer architecture unless a human explicitly promotes that learning back into Main Offers later.

## Stage 4E — Ideation Integration

Purpose: let Ideation consume approved strategic inputs without becoming controlled by them.

Build scope:

- Extend Ideation authority/source inputs.
- Add optional Campaign Intelligence input.
- Add optional Main Offer input.
- Add optional Seasonal Offer input.
- Persist strategic input provenance for each Ideation run.
- Keep Ideation source policy optional and configurable.

Ideation may now draw from:

- proof
- manual ideas
- strategic research / seven techniques
- Campaign Intelligence
- Main Offers
- Seasonal Offers

An idea can be campaign-aligned, offer-supporting, proof-led, manually supplied, research-led, or a blend. It does not need to sell an offer.

## Guardrails

- Campaign Intelligence does not generate offers.
- Offers do not generate content ideas.
- Ideation does not become purely campaign-driven or offer-driven.
- Drafts are not authority.
- Approval is the only promotion mechanism.
- No invented business facts, market events, buyer psychology, seasonal claims, proof, or commercial claims.
- Every generated strategic object needs structured evidence/source references.
- Downstream modules consume approved structured authority, not free-form prose scraped from drafts.

## Implementation Artifacts

Primary migrations:

- `supabase/migrations/20260812180000_phase_4a_campaign_intelligence.sql`
- `supabase/migrations/20260812190000_phase_4b_offers_foundation.sql`
- `supabase/migrations/20260812200000_phase_4c_ideation_strategic_inputs.sql`

Primary Edge Functions:

- `supabase/functions/run-campaign-intelligence`
- `supabase/functions/run-offers`
- `supabase/functions/run-ideation`

Primary frontend surfaces:

- `src/components/client/CampaignIntelligencePanel.tsx`
- `src/components/client/OffersPanel.tsx`
- `src/components/client/IdeationPanel.tsx`

Primary tests:

- `tests/campaign-intelligence.test.ts`
- `tests/offers-stage4b.test.ts`
- `tests/ideation-stage4c.test.ts`

## Live Deployment Note

During the Stage 5 engineering release DoD, the Stage 4 database migrations were applied to the linked Supabase project and migration history was repaired for the applied versions.

The linked project schema includes the Campaign Intelligence, Offers, and Ideation strategic-input tables. However, generation buttons require the Stage 4 Edge Function slugs to be deployed:

- `run-campaign-intelligence`
- `run-offers`

If those slugs are missing from the live Supabase function list, Stage 4 is schema-ready but not fully operational live.
