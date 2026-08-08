# Programme Stage I — Shared Production Studio Framework

**Status: backbone implemented and deployed, live-verified against real database constraints with disposable fixtures. Scope deliberately reduced from the full stage prompt — see "Deferred" below.**
Date: 2026-08-08 · Project `xivewedajschthjlblfb`

## What this stage builds on

`production_jobs` (Stage B) already carried almost the entire "Production Job" shared entity this stage asks for — idempotency (`client_id, idempotency_key`) unique constraint, retries, leases, `cost_metadata` — with zero callers anywhere in `src/`. This stage adds the two fields it was missing (`production_mode`, `asset_plan`) and two new tables for the remaining shared entities the stage lists: Generated Asset / Source Asset / Deliverable (one table, `content_item_assets`, differentiated by `kind` rather than three near-identical tables) and Review (`production_reviews`), plus the routing logic that turns an approved Content Brief (Stage H) into a Production Job. It deliberately does not touch `client_asset_generation_jobs`/`client_assets` — the live legacy production system every existing studio (Carousel, Story, Feed Post, Ad, and Reel Studio's own dedicated schema) actually runs on today. This builds the new canonical path in parallel, per the same "preserve working systems" principle Stage H followed for `client_production_briefs`.

## Scope actually implemented (the "backbone")

### Schema — migration `20260808024029_stage_i_shared_production_studio.sql` (applied live)
- `production_jobs.production_mode` (`human`/`ai`/`hybrid`, nullable) and `production_jobs.asset_plan` (jsonb array, default `[]`).
- `content_item_assets` — Generated Asset / Source Asset / Deliverable, differentiated by `kind` (`generated`/`source`/`deliverable`). Revision is modelled as a new row with `revision_of` pointing at what it revises, mirroring `client_assets`' `version`/`is_current` pattern already used elsewhere in the schema.
- `production_reviews` — targets a Job as a whole, or one specific Asset within it (`content_item_asset_id`, nullable), with `quality_checks` as a jsonb array of `{check, passed, detail}`.
- Both tables: RLS enabled, `authenticated` gets `select` scoped to `auth_client_ids()`, all writes via service role only. Additive-only; no existing column, constraint, or RLS policy touched. All `ADD CONSTRAINT` calls wrapped in `DO $$ ... IF NOT EXISTS (SELECT ... pg_constraint) ...` blocks — the defensive-migration practice adopted after Stage G's partial-apply anomaly, since Postgres has no native `ADD CONSTRAINT IF NOT EXISTS`.

### The shared production contract (`_shared/production-studio.ts`)
- **Format router** (`routeToStudio`) — routes a Brief's `format` to one of 5 `StudioCapability` values (`reel_studio`, `carousel_studio`, `story_studio`, `feed_post_studio`, `ad_studio`). Paid content always routes to `ad_studio` regardless of underlying creative format, mirroring the organic/paid separation already present in `calendar_slots`/`content_requirements`.
- **Provider capability registry** (`checkProviderCapability`) — a static map (`anthropic: [text_generation]`, `higgsfield: [still_image_generation, image_to_video, carousel_slide_generation, story_frame_generation]`) that fails cleanly, never throws, for an unknown provider or unsupported capability.
- **Asset-plan contract** (`ASSET_PLAN_CATEGORIES`, `validateAssetPlan`) — 13 categories, strict validation that rejects the whole plan on any unrecognised category or malformed item.
- **Quality checks** (`QUALITY_CHECK_TYPES`, 10 named dimensions) — only the 3 with a real, deterministic signal are actually implemented: `checkCtaPresent` (Brief declares a non-empty CTA), `checkProofAccuracy` (reuses Stage H's exact proof-gate signal — verified Proof linked via the Content Item's Opportunity's sources), `checkAspectRatio` (asset dimensions against a small `PLATFORM_ASPECT_RATIOS` map, with tolerance). The other 7 are named as a contract but not computed — see Deferred.
- **Idempotency key builder** (`buildProductionJobIdempotencyKey`) — deterministic `production:{contentItemId}:{capability}`, reusing `production_jobs_idempotency_unique` for free.

### Edge Functions (both deployed, `verify_jwt: true`)
- **`route-content-brief-to-studio`** — re-enforces Stage H's own acceptance criterion (Brief must be `status === "approved"`) at this stage's entry point, routes via `routeToStudio`, builds the idempotency key, and either replays an existing Job (idempotent replay, `200`) or inserts a new one (`201`). Writes only `production_jobs` — no asset generation happens here.
- **`submit-production-review`** — computes the CTA and proof-accuracy checks server-side (never trusts client-supplied pass/fail for these two), accepts operator-supplied `manual_checks` for the remaining dimensions with no automated signal, and inserts a `production_reviews` row.

### Frontend
- `src/types/production-studio.ts` — full type contract (`ProductionJob`, `ContentItemAsset`, `ProductionReview`, `AssetPlanItem`, `QualityCheckResult`, etc.), mirroring the Deno shared module's shapes.
- `src/lib/production-studio.ts` — data-access layer (`fetchProductionJobsForItem`, `fetchAssetsForJob`, `fetchReviewsForJob`, `routeContentBriefToStudio`, `submitProductionReview`).
- New `ProductionStudioPanel.tsx`, wired into `ClientDetailPage.tsx` as "Production Studio": Content Item list → route an approved Brief to its studio → Job list per item → per-Job Asset list and Review history, with Approve / Request changes / Reject actions.

### Live verification with disposable fixtures (no live HTTP call — see Deferred)
Built the exact real chain both Edge Functions operate on, directly via SQL, since there is no mintable operator JWT in this environment:
1. Created a `content_item` and an **approved** `content_brief` (structured `body` with `format: "reel"`, `organic_or_paid: "organic"`, `cta`, `proof_required: true`) satisfying `content_briefs_approval_check`.
2. Inserted a `production_jobs` row using `route-content-brief-to-studio`'s exact insert shape (`capability: "reel_studio"` — matching `routeToStudio`'s real output for this input, `idempotency_key: "production:{content_item_id}:reel_studio"`, `production_mode`, `asset_plan`) — succeeded against all live constraints (`production_jobs_production_mode_check`, `production_jobs_asset_plan_check`, `production_jobs_idempotency_unique`).
3. Attempted a second insert with the identical `(client_id, idempotency_key)` pair — correctly rejected with `23505 duplicate key value violates unique constraint "production_jobs_idempotency_unique"`, confirming the idempotent-replay branch in `route-content-brief-to-studio` is backed by a real DB-level guarantee, not just application logic.
4. Inserted a `content_item_assets` row (`kind: "generated"`) and a `production_reviews` row using `submit-production-review`'s exact insert shape (`decision: "changes_requested"`, `quality_checks` containing one passing `cta` check and one failing `proof_accuracy` check) — succeeded against `content_item_assets_kind_check` and `production_reviews_decision_check`.
All fixtures deleted afterward; a follow-up count query confirmed zero rows remain across all four tables touched.

### A deploy-tool gotcha reconfirmed, and one self-correction
Both functions deployed cleanly on the first attempt using the by-now-standard explicit `import_map_path: "deno.json"` workaround, combined with naming every shared-file entry in the `files` array using the exact literal relative path the entrypoint's import uses (`../_shared/aa.ts`, not `_shared/aa.ts`) — confirming the gotcha already documented in this repo's `CLAUDE.md`. Separately, the first `submit-production-review` deploy payload used a comment-stripped copy of `_shared/production-studio.ts` (functionally identical, but not byte-identical to the local file) to save size; redeployed immediately with the exact full local file content so `get_edge_function` diffs clean against source, matching the verification standard established in Stage H. Both functions confirmed `ACTIVE`.

### Tests
`tests/production-studio.test.ts` — 26 deterministic unit tests: format routing (all five studios, paid override, case/whitespace normalisation, unroutable-format rejection), provider capability checks (known/unknown provider, supported/unsupported capability), asset-plan validation (accept, empty, reject non-array/bad category/blank description/non-boolean required), all three implemented quality checks (including the "not checked" fallback for an unknown platform/format pair), and idempotency-key determinism. Full suite: **833/833 pass**. `npm run typecheck`, `npm run build`, `npm run lint` all clean — same 4 pre-existing warnings (in files this stage didn't touch), zero new.

## Deferred, with precise reasons

- **7 of 10 quality-check dimensions are not computed** (`claim_accuracy`, `brand_alignment`, `spelling`, `platform_safe_area`, `asset_ownership`, `consent`, `generated_media_disclosure`) — none of these has a deterministic, checkable signal available anywhere in the current schema or a provider response; faking a pass/fail for them would be worse than not implementing them (direct violation of "never fabricate"). `submit-production-review` accepts operator-supplied `manual_checks` for these instead, clearly distinguishable from the server-computed ones.
- **Actual per-studio asset generation is not built** — Reel/Carousel/Story/Feed Post/Ad Studio each still means "the legacy `client_asset_generation_jobs`/`client_assets` pipeline" in terms of what actually produces a usable asset today (Reel Studio's own dedicated Phase A–D pipeline is the sole exception, and it is not wired to `production_jobs` by this stage). `route-content-brief-to-studio` creates the canonical `production_jobs` row and stops there — nothing consumes `pending` Jobs yet.
- **AI-driven asset-plan auto-classification** — `validateAssetPlan` only validates a caller-supplied plan; nothing infers the plan from the Brief's `required_outputs`/`asset_inputs` automatically.
- **Full claim/heartbeat/lease job-execution RPC** — `production_jobs` already has the lease columns from Stage B, but no worker consumes them; deferred since there is no execution consumer yet for this stage to hand a leased Job to.
- **Contract/DB/integration/UI test matrix in full, and a live HTTP-invocation smoke test** — same reasons and same environment constraint (no mintable operator JWT) documented in the Stage F, G, and H reports.

## Confirmation against Stage I acceptance criteria

| Criterion | Status |
|---|---|
| A Content Brief routes deterministically to exactly one studio | Met — `routeToStudio` is pure and total over the format/organic-paid input space; unroutable formats fail closed with `422 UNROUTABLE_FORMAT` rather than guessing |
| Production Jobs are idempotent per Content Item + capability | Met — live-verified: a second insert with the same key is rejected at the DB level, not just the application level |
| Assets and Reviews are shared entities usable by any studio | Structurally true — `content_item_assets`/`production_reviews` carry no studio-specific columns, only `capability` on the parent Job |
| Quality checks with a real signal are always server-computed, never client-trusted | Met — `submit-production-review` computes `cta`/`proof_accuracy` itself from the Brief and linked Proof; a client-supplied `manual_checks` entry for those two types would collide with, not replace, the server-computed one, since both get pushed into the same `checks` array |
| Existing production workflows still function | Met — `client_asset_generation_jobs`, `client_assets`, and Reel Studio's own pipeline are completely untouched |

**Exit gate ("Every format has a canonical, idempotent path from an approved Brief to a reviewable Job"): met for the routing and review layer itself** — deterministic routing, idempotency, and gated review are real, deployed, and live-verified against real constraints. **Bounded by the same unpopulated-pipeline gap Stage H already flagged**: there are zero real Content Items/Briefs for the live client yet (pending Stage D populating `content_requirements`/`calendar_slots`), and no consumer yet turns a `pending` Production Job into an actual Asset.
