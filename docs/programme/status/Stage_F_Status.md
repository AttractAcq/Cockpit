# Programme Stage F — Content Opportunity Intelligence

**Status: backbone implemented and deployed, live-verified via schema + deterministic tests. Scope deliberately reduced from the full stage prompt — see "Deferred" below.**
Date: 2026-08-07 · Project `xivewedajschthjlblfb`

## What this stage builds on

Stage B's canonical spine already owned `content_opportunities` / `content_opportunity_sources` as a thin skeleton (title, angle, rationale, status, origin, a single `score` column), and Stage E's `create-content-opportunity` already covered manual single/hybrid-source conversion. Stage F's job was the actual intelligence layer: rich Opportunity fields, deterministic eligibility filtering, a multi-dimension explainable scoring rubric with history, deduplication, and the human-control status workflow — without duplicating or bypassing that existing spine.

## Scope actually implemented (the "backbone")

Agreed with Alex up front: build the real, working core and log deferrals precisely rather than chase the stage prompt's full exhaustive test/verification matrix (contract + DB + integration + UI tests across every state) in one pass.

### Schema — migration `20260807132419_stage_f_opportunity_intelligence.sql` (applied live)
- `content_opportunities` extended with: `core_claim`, `hook_direction`, `audience`, `pain_or_objection`, `belief_before`, `belief_after`, `objective`, `offer_relationship`, `funnel_stage`, `candidate_formats[]`, `candidate_channels[]`, `cta_direction`, `visual_potential` (1-5), `production_requirements`, `eligibility_status`/`eligibility_reason`/`eligibility_checked_at`, `duplicate_of_opportunity_id`/`dedup_reason`, `generated_by`/`provider`/`model`.
- New table `content_opportunity_scores` — append-only scoring history (re-scoring never overwrites; `content_opportunities.score`/`score_method` is a denormalised pointer to the latest row, written explicitly by the scoring function, not a trigger).
- Fully additive: no existing column, constraint, or RLS policy was touched. RLS follows the existing convention exactly (`authenticated` select-only via `auth_client_ids()`, all writes via service role).

### Edge Functions (all three deployed, `verify_jwt: true`)
- **`generate-content-opportunities`** — LLM-backed (Anthropic), one `content_source` in, 1-3 candidate Opportunities out. Grounds the prompt in the client's approved context files (Business Context, Avatar, Offer, Proof Bank excerpts) and explicitly instructs the model to flag `claim_unsupported` rather than fabricate. Every candidate then passes through **deterministic, server-side** eligibility and dedup checks before insert — the model never decides eligibility.
- **`score-content-opportunity`** — model supplies the 8 rubric dimensions (0-100 each); `computeOverallScore` (pure function, unit-tested) is the *only* place the overall score is computed. A model-supplied overall score or rank is never trusted, matching the existing Ideation scoring contract exactly.
- **`update-content-opportunity-status`** — 5 of 8 named human-control actions (see Deferred). Every transition is validated against Stage B's own `CONTENT_OPPORTUNITY_TRANSITIONS` table via a BFS path-finder (`findTransitionPath`), so a single action like "Shortlist" can walk multiple valid hops (`draft → needs_review → shortlisted`) without ever taking an edge the canonical state machine doesn't define.

### Eligibility filters — only signals that actually exist were wired
Implemented (real signal in the current schema): `unsupported_claim` (model self-flag), `missing_consent` (`proof_items.consent_status`), `missing_mandatory_proof` (`proof_items.verification_status`), `conflicting_authority` (unresolved blocking `client_input_conflicts`), `inactive_offer` (proxied via `clients.status = paused/churned` — there is no dedicated offers table).
**Not wired, no fabricated check**: `duplicate_recent_content` (handled instead by the separate dedup mechanism), `prohibited_claim`, `wrong_region`, `expired_source`, `incompatible_format`, `unavailable_required_media` — none of these have a real signal anywhere in the current data model. Building a check against nothing would be exactly the "partial integration" the stage prompt forbids.

### Frontend
- `content-spine.ts` (`ContentOpportunity`) and new `content-opportunity-scoring.ts` extended/added.
- New `OpportunityPoolPanel.tsx`, wired into `ClientDetailPage.tsx` as a new "Opportunity Pool" tab: generate from an existing source, explainable per-dimension score breakdown, search/status filters, and the 5 implemented human-control actions.

### Tests
`tests/content-opportunity-intelligence.test.ts` — 35 deterministic unit tests, no DB/network: `computeOverallScore` (weighting, range rejection), JSON extraction robustness, candidate schema validation, all 5 eligibility branches, dedup matching, the transition path-finder, and 3 parity tests guarding the Deno/frontend rubric-and-transition-table duplication (see below) against drift. Full suite: **767 tests, 766 pass** — the 1 failure (`ideation-provider-reliability.test.ts`, a real-time deadline budget check) is pre-existing flakiness unrelated to this stage; confirmed by re-running that file alone, where all 25 of its tests pass. `npm run typecheck`, `npm run build`, and `npm run lint` are all clean (lint: the same 4 pre-existing warnings as the Stage A baseline, zero new).

## A real deploy-tooling constraint, disclosed rather than hidden

`score-content-opportunity` and `update-content-opportunity-status` originally cross-imported `computeOverallScore` and `CONTENT_OPPORTUNITY_TRANSITIONS` directly from `src/types/`, following a precedent already in this repo (`approve-execution-config`). The Supabase MCP deploy tool's bundler flattens paths and could not resolve that import at deploy time (a documented instance of the same class of issue already flagged for Ideation scoring in `AE_Outstanding_Work_Ledger.md`). Fixed by duplicating the rubric and transition table into the Deno-side `_shared/opportunity-intelligence.ts` — the same pattern the existing Ideation scoring system already uses for the same reason. Three parity tests now guard both copies against silent drift. Deploying via `supabase functions deploy` from the repo instead (not this MCP tool) would not flatten paths and could make the cross-import safe again — noted for whoever next changes the rubric.

## Deferred, with precise reasons

- **"Add Proof"** — needs a proof-item picker UI beyond a status-action button. The underlying server capability (linking an additional `content_source` via `content_opportunity_sources`) already exists in principle; the picker itself was out of scope for this pass.
- **"Request another angle"** — no dedicated action. The same effect is already reachable by re-invoking `generate-content-opportunities` against the same source.
- **"Promote for Ads"** — no downstream consumer exists yet (Stage L, Ad Studio, is unbuilt). Adding a flag nobody reads would be exactly the "table without callers" partial-integration the stage prompt forbids.
- **AI-driven hybrid opportunities** (multiple sources synthesised by the model into one Opportunity) — `generate-content-opportunities` is single-source per call. Manual hybrid creation remains available via the existing `create-content-opportunity` (Stage E).
- **Contract/DB/integration/UI test matrix** the stage prompt asks for in full — deliberately reduced to solid deterministic unit coverage per the agreed scope for this pass.
- **Live HTTP invocation smoke test** — every new function requires a real signed-in operator JWT to call; this environment has no way to mint one (the exact same constraint `AE_Outstanding_Work_Ledger.md` already documented for the Stage C/E functions). Verified instead via: live schema application + introspection, full deterministic test suite, and clean typecheck/build/lint against the real deployed code.

## Confirmation against Stage F acceptance criteria

| Criterion | Status |
|---|---|
| All source types appear in one Opportunity Pool | Met — `generate-content-opportunities` accepts any `content_sources.source_kind` |
| Scores are explainable | Met — 8 named dimensions + rationale/strengths/risks, shown in the UI |
| Opportunities can be manually selected | Met — `select_for_planning` action |
| Opportunities remain advisory until selected | Met — Stage B's transition table is unchanged; nothing here writes Calendar/Content Item tables |
| Existing Ideation scoring can be mapped into the universal system | Met — rubric deliberately mirrors `IDEATION_SCORE_DIMENSIONS`' shape and "server always computes overall" contract |
| Opportunity history and provenance are immutable | Met — `content_opportunity_scores` is append-only; `content_opportunity_sources` links are never mutated |

**Exit gate ("Cockpit has one canonical supply pool from which Calendar planning can operate"): substantively met for the backbone scope.** Stage G can query `content_opportunities` by status/score today. Full exit-gate confidence is bounded by the deferred items above, particularly the missing live HTTP-invocation evidence.
