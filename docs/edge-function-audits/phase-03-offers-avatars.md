# Edge Function Audit - Phase 03: Offers And Avatars

Date: 2026-08-13
Mode: Read-only audit

## 1. Phase Scope

This phase audited the Offers and Avatars authority-producing functions:

- `run-offers`
- `run-avatar-strategy`
- `run-avatar-appearance`
- `run-avatar-world`
- `run-avatar-operating-context`
- `run-avatar-asset-library`
- `generate-avatar-asset`

Primary UI/system areas:

- Offers page
- Avatars page

Audit emphasis:

- Confirm Main Offers and Seasonal Offers remain separate.
- Confirm Seasonal Offers consume approved Campaign Intelligence and Main Offers only.
- Confirm Avatar OS outputs remain review-gated.
- Confirm asset generation consumes approved Avatar authority only.
- Confirm generated avatar assets are not treated as approved production references without review.

This audit did not make source, schema, configuration, deployment, database, or storage changes.

## 2. Functions Audited

| Function | Role | Current posture |
| --- | --- | --- |
| `run-offers` | Creates review-gated Main Offers or Seasonal Offers scaffolds. | Deterministic scaffold, no provider calls, no auto-approval. |
| `run-avatar-strategy` | Creates the core Avatar Strategy component and Avatar release. | Deterministic scaffold, requires approved upstream Intelligence, no media generation. |
| `run-avatar-appearance` | Creates Appearance component by carrying forward approved strategy. | Deterministic scaffold, requires approved Avatar Strategy release. |
| `run-avatar-world` | Creates Environment, Voice & Personality, and Creative Direction components. | Deterministic scaffold, requires approved Strategy and Appearance release. |
| `run-avatar-operating-context` | Creates Knowledge/Expertise and Content Format components. | Deterministic scaffold, requires approved Strategy, Appearance, Environment, Voice, and Creative Direction release. |
| `run-avatar-asset-library` | Creates Asset Library component and planned asset slots. | Deterministic scaffold, creates no asset rows or media. |
| `generate-avatar-asset` | Creates a review-gated `client_avatar_assets` row for an approved planned asset slot. | No media generation or storage writes; asset status is `needs_review`. |

## 3. UI Page / System Role

Offers:

- `src/lib/offers.ts` calls `run-offers` for `prepare`, `step`, and `finalize` (`src/lib/offers.ts:127`, `src/lib/offers.ts:141`, `src/lib/offers.ts:154`).
- `src/lib/offers.ts` calls the review RPCs, not the edge function, to approve/reject offer releases (`src/lib/offers.ts:184`).
- Tests confirm the page exposes separate Main Offers and Seasonal Offers tabs (`tests/offers-stage4b.test.ts:109`).

Avatars:

- `src/lib/avatar-os.ts` calls each Avatar workflow function with the same `prepare`, `step`, `finalize` pattern (`src/lib/avatar-os.ts:86`, `src/lib/avatar-os.ts:127`, `src/lib/avatar-os.ts:168`, `src/lib/avatar-os.ts:209`, `src/lib/avatar-os.ts:250`).
- `src/lib/avatar-os.ts` calls `generate-avatar-asset` for asset records (`src/lib/avatar-os.ts:291`).
- `src/lib/avatar-os.ts` calls `review_avatar_release` for Avatar release approval (`src/lib/avatar-os.ts:301`).
- `AvatarsPanel` displays planned asset slots and stored asset records (`src/components/client/AvatarsPanel.tsx:526`, `src/components/client/AvatarsPanel.tsx:568`).
- `AvatarsPanel` can create asset records from planned slots (`src/components/client/AvatarsPanel.tsx:777`).

## 4. Function-by-Function Findings

### `run-offers`

Role:

- Main Offers define foundational commercial architecture.
- Seasonal Offers adapt approved Main Offers around approved Campaign Intelligence periods.
- The function creates review-gated scaffolds only (`supabase/functions/run-offers/index.ts:1`).

Positive findings:

- Uses `validateIntelligenceAccess` before work begins (`supabase/functions/run-offers/index.ts:665`).
- Requires `offer_type` to be either `main` or `seasonal` (`supabase/functions/run-offers/index.ts:661`).
- Main Offers require saved `client_inputs.offer_details` and do not require calendar context (`supabase/functions/run-offers/index.ts:110`).
- Seasonal Offers require an approved active Campaign Intelligence release (`supabase/functions/run-offers/index.ts:165`).
- Seasonal Offers require an approved active Main Offers release (`supabase/functions/run-offers/index.ts:200`).
- Seasonal Offers validates that the selected campaign period belongs to the approved active Campaign release (`supabase/functions/run-offers/index.ts:190`).
- Seasonal Offers validates that the selected Main Offer belongs to the approved active Main Offers release (`supabase/functions/run-offers/index.ts:218`).
- Finalization requires at least one offer row before release submission (`supabase/functions/run-offers/index.ts:602`).
- Outputs move to `needs_review`, not `approved` (`supabase/functions/run-offers/index.ts:611`).
- Tests assert no provider/model generation and no direct auto-approval (`tests/offers-stage4b.test.ts:87`).

Findings:

- P1: Seasonal Offers validates the selected `main_offer_id`, but generation uses the first Main Offer row instead of the selected Main Offer. `loadSeasonalAuthority` finds `selectedMainOffer` (`supabase/functions/run-offers/index.ts:218`) and returns it (`supabase/functions/run-offers/index.ts:241`), but `runStep` passes `authority.mainOffers` to `runSeasonalStep` (`supabase/functions/run-offers/index.ts:554`), and `runSeasonalStep` uses `mainOffers[0]` (`supabase/functions/run-offers/index.ts:461`). If the selected offer is not the first by display order, the generated seasonal offer links to the wrong Main Offer.
- P1: Offer release rows do not have release-level lifecycle immutability guards. The migration protects Main Offer and Seasonal Offer child rows after approval (`supabase/migrations/20260812190000_phase_4b_offers_foundation.sql:272`), but not `client_offer_architecture_releases` or `client_seasonal_offer_releases` themselves. `finalize` updates release rows to `needs_review` by id without checking current status (`supabase/functions/run-offers/index.ts:619`). This creates the same approved-release demotion risk identified in Audit 2 for Campaign Intelligence.
- P2: `run-offers` has no `retry_step` path. The current function is single-step and deterministic, so rebuild-only recovery may be acceptable, but that should be intentional/documented rather than accidental (`supabase/functions/run-offers/index.ts:11`).
- P2: Idempotency is lookup-before-insert only. A concurrent prepare can still collide on the generated idempotency key and return a generic insert failure (`supabase/functions/run-offers/index.ts:292`).

Suggested upgrades:

- Pass `selectedMainOffer` into `runSeasonalStep` and write `main_offer_id` from that selected object.
- Add release-level guards equivalent to `protect_approved_intelligence_release` for both offer release tables, allowing lifecycle-only approved-to-superseded/archive transitions.
- Either document Offers as rebuild-only or add a narrow failed-step retry action.
- Handle duplicate idempotency insert errors by re-selecting the existing run.

### `run-avatar-strategy`

Role:

- Creates the first Avatar OS authority release containing the `avatar_strategy` component.
- Defines strategic role, audience relationship, proof relationship, rights-safety notes, and downstream guidance.

Positive findings:

- Requires approved active `market_os`, Intelligence-page `avatar_os`, and `brand_strategist` releases (`supabase/functions/run-avatar-strategy/index.ts:14`).
- Treats `competitor_os` and `association_os` as optional enrichment, not hard blockers (`supabase/functions/run-avatar-strategy/index.ts:15`).
- Can include approved Campaign Intelligence, Main Offers, and Seasonal Offers if active, without requiring them (`supabase/functions/run-avatar-strategy/index.ts:191`).
- Blocks when basic business/customer context is missing (`supabase/functions/run-avatar-strategy/index.ts:164`).
- Writes a draft Avatar release and review-gated component (`supabase/functions/run-avatar-strategy/index.ts:283`, `supabase/functions/run-avatar-strategy/index.ts:348`).
- Explicitly states no media, voice, or existing-character IP generation (`supabase/functions/run-avatar-strategy/index.ts:398`).
- Finalizes to `needs_review`, not `approved` (`supabase/functions/run-avatar-strategy/index.ts:511`).

Findings:

- P1: Avatar release rows do not have release-level lifecycle immutability guards. The migration has `prevent_approved_avatar_release_mutation`, but it is attached only to `client_avatar_components` (`supabase/migrations/20260812210000_stage_5_avatar_os_foundations.sql:184`, `supabase/migrations/20260812210000_stage_5_avatar_os_foundations.sql:205`). `run-avatar-strategy` finalizes by updating the release row to `needs_review` by id without requiring the release to still be `draft` (`supabase/functions/run-avatar-strategy/index.ts:511`).
- P2: No `retry_step` action exists. Failures are marked terminal/non-retryable (`supabase/functions/run-avatar-strategy/index.ts:470`). If rebuild-only is the intended recovery model for Stage 5 scaffolds, this should be documented.

Suggested upgrades:

- Add release-level immutability/lifecycle protection for `client_avatar_releases`.
- Add finalize `.eq("status", "draft")` guards and idempotent "already finalized" responses.
- Document or add retry behavior for failed single-step Avatar generation runs.

### `run-avatar-appearance`

Role:

- Creates a new Avatar release that carries forward approved strategy and adds the Appearance component.

Positive findings:

- Requires an approved active Avatar release (`supabase/functions/run-avatar-appearance/index.ts:103`).
- Requires the active release to contain an `avatar_strategy` component (`supabase/functions/run-avatar-appearance/index.ts:129`).
- Deletes/replaces only the draft release's components/assets during the step, then inserts a carried-forward strategy snapshot plus the appearance component (`supabase/functions/run-avatar-appearance/index.ts:307`).
- Finalizes to `needs_review`, not `approved` (`supabase/functions/run-avatar-appearance/index.ts:499`).

Findings:

- P1: Same Avatar release-level immutability gap as above. Finalize updates release rows by id without a draft-status guard (`supabase/functions/run-avatar-appearance/index.ts:499`).
- P2: No `retry_step` path; recovery is full rebuild/new release.

### `run-avatar-world`

Role:

- Creates Environment, Voice & Personality, and Creative Direction components.

Positive findings:

- Requires approved Strategy and Appearance components from the active Avatar release (`supabase/functions/run-avatar-world/index.ts:156`).
- The function includes the missing `creative_direction` component as part of the world/creative workflow (`supabase/functions/run-avatar-world/index.ts:504`).
- Tests assert it does not generate media, audio, scripts, or provider calls (`tests/avatar-os-stage5c-world.test.ts:41`).
- Finalizes to `needs_review`, not `approved` (`supabase/functions/run-avatar-world/index.ts:694`).

Findings:

- P1: Same Avatar release-level immutability gap. Finalize updates release rows by id without a draft-status guard (`supabase/functions/run-avatar-world/index.ts:694`).
- P2: No `retry_step` path; recovery is full rebuild/new release.

### `run-avatar-operating-context`

Role:

- Creates Knowledge/Expertise and Content Format components.

Positive findings:

- Requires approved Strategy, Appearance, Environment, Voice & Personality, and Creative Direction components (`supabase/functions/run-avatar-operating-context/index.ts:159`).
- Tests assert no content ideation, script generation, media generation, or invented proof/expertise (`tests/avatar-os-stage5c-operating-context.test.ts:44`).
- Finalizes to `needs_review`, not `approved` (`supabase/functions/run-avatar-operating-context/index.ts:715`).

Findings:

- P1: Same Avatar release-level immutability gap. Finalize updates release rows by id without a draft-status guard (`supabase/functions/run-avatar-operating-context/index.ts:715`).
- P2: No `retry_step` path; recovery is full rebuild/new release.

### `run-avatar-asset-library`

Role:

- Creates the Asset Library foundation component and planned asset slots.
- It intentionally does not create `client_avatar_assets` rows, media, audio, or storage objects.

Positive findings:

- Requires approved full Avatar OS component authority before preparing Asset Library (`supabase/functions/run-avatar-asset-library/index.ts:146`).
- Requires all prior component types except `asset_library` before proceeding (`supabase/functions/run-avatar-asset-library/index.ts:172`).
- Explicitly marks image/video/audio/storage writes and `client_avatar_assets` rows as excluded (`supabase/functions/run-avatar-asset-library/index.ts:325`).
- Blocks creation of asset rows from this function itself (`supabase/functions/run-avatar-asset-library/index.ts:635`).
- Tests assert the function creates planned slots only and no generated asset rows (`tests/avatar-os-stage5d-assets-foundation.test.ts:31`).

Findings:

- P1: Same Avatar release-level immutability gap. Finalize updates release rows by id without a draft-status guard (`supabase/functions/run-avatar-asset-library/index.ts:640`).
- P2: No `retry_step` path; recovery is full rebuild/new release.

### `generate-avatar-asset`

Role:

- Creates one review-gated `client_avatar_assets` row for a planned slot from an approved Avatar Asset Library release.
- It does not generate media, write storage, or approve production references.

Positive findings:

- Uses `validateIntelligenceAccess` before work begins (`supabase/functions/generate-avatar-asset/index.ts:300`).
- Requires an approved active Avatar release (`supabase/functions/generate-avatar-asset/index.ts:174`).
- Requires all Avatar component types, including `asset_library` (`supabase/functions/generate-avatar-asset/index.ts:189`).
- Requires the requested `asset_type` to appear in the approved Asset Library planned slots (`supabase/functions/generate-avatar-asset/index.ts:306`).
- Inserts assets with `status: "needs_review"` and `approved_at: null` (`supabase/functions/generate-avatar-asset/index.ts:330`).
- Prompt payload states media generation and storage writes were not performed (`supabase/functions/generate-avatar-asset/index.ts:254`).
- Tests assert no provider calls, no storage writes, and no approved status (`tests/avatar-os-stage5d-generate-asset.test.ts:44`).

Findings:

- P2: There is an asset review RPC in the migration, but no frontend helper or panel action currently calls `review_avatar_asset`. The UI displays stored assets but does not expose approve/request-changes/archive controls for asset rows (`src/components/client/AvatarsPanel.tsx:568`). This preserves the review gate, but it also means generated asset records cannot be promoted through the visible Avatars UI.
- P2: Asset row versioning is computed by reading the latest version and adding one (`supabase/functions/generate-avatar-asset/index.ts:212`). Concurrent generation requests for the same asset type can race and create duplicate version numbers because no unique `(release_id, asset_type, version)` constraint is visible in the audited migration.
- P2: Caller-supplied `storage_bucket`, `storage_path`, and `external_url` are accepted as text and stored without path/bucket ownership validation (`supabase/functions/generate-avatar-asset/index.ts:323`). The function does not write storage, which is good, but approved visual/reference assets later depend on these references.

Suggested upgrades:

- Add `reviewAvatarAsset` frontend helper and asset review controls in the Avatars panel.
- Add a DB uniqueness constraint for `(release_id, asset_type, version)` or use an atomic version allocator.
- Validate storage bucket/path and external URL shape before saving asset references.

## 5. Configuration Checklist

| Check | Status |
| --- | --- |
| Expected caller | UI via `src/lib/offers.ts` and `src/lib/avatar-os.ts`. |
| Public/private posture | Private operator functions; require authenticated staff token plus service-role backend. |
| Auth verification | All audited functions call `validateIntelligenceAccess`. |
| Service-role usage | All audited functions use `svc()` for DB writes. |
| CORS handling | All audited functions handle `OPTIONS`; shared CORS advertises `POST, GET, OPTIONS`. |
| Allowed HTTP methods | Audited functions reject non-POST methods after OPTIONS. |
| Request body validation | Basic validation exists for action, client id, offer type, and asset type. |
| Idempotency | Prepare flows use idempotency keys, but duplicate insert races are not handled. Asset generation intentionally versions rows but lacks atomic uniqueness. |
| Retry behaviour | Functions are deterministic single-step builds; no `retry_step` action exists. |
| Timeout/provider failure handling | No external AI/provider calls in audited functions, so timeout exposure is low. |
| Error responses | Most failures return structured JSON; some insert/update failures leave partial run/release state. |
| Audit logging | Prepare/finalize/asset generation paths write audit events. |
| Secrets/env vars | Uses Supabase URL/service-role key via shared helper; no provider secrets required. |
| Database writes | Writes offer releases/rows, avatar releases/components/assets, research runs/steps, audit log. |
| Storage writes | None in audited functions. |
| RLS assumptions | Service-role writes bypass RLS; function-level auth/client checks are therefore critical. |
| Function-to-function calls | None observed. |
| Tests | String/contract tests exist for Offers and Avatar stages. |
| Orphaned status | All audited functions are called from frontend libraries or panel actions. |

## 6. Security / Auth / RLS Notes

- The audited functions are not anonymous: each validates the caller through `validateIntelligenceAccess`.
- Review RPCs allow `admin`, `account_manager`, and `editor` roles (`supabase/migrations/20260812190000_phase_4b_offers_foundation.sql:321`, `supabase/migrations/20260812210000_stage_5_avatar_os_foundations.sql:222`), while edge generation uses `validateIntelligenceAccess`, which is stricter based on Audit 2. If editors are intended to operate Offers/Avatars generation, role policy is inconsistent; if not, the stricter edge posture is fine.
- The biggest security/lifecycle risk is service-role mutation of approved release rows because Offers and Avatar release tables lack the generic Intelligence release guard pattern.
- `generate-avatar-asset` should validate stored/external asset references before allowing later human approval to rely on them.

## 7. Secrets / Environment Variables Required

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` indirectly through `validateIntelligenceAccess`

Not required by audited functions:

- OpenAI keys
- Anthropic keys
- Higgsfield keys
- Storage provider keys
- External scraping/search provider keys

These functions are scaffold/record workflows, not provider-generation workflows.

## 8. Database Tables / Storage Buckets Touched

Offers:

- `client_research_runs`
- `client_research_steps`
- `client_offer_architecture_releases`
- `client_main_offers`
- `client_money_model_components`
- `client_offer_architecture_active_releases`
- `client_seasonal_offer_releases`
- `client_seasonal_offers`
- `client_seasonal_offer_active_releases`
- `client_campaign_intelligence_active_releases`
- `client_campaign_intelligence_releases`
- `client_campaign_periods`
- `client_offer_approval_decisions`
- `audit_log`

Avatars:

- `client_research_runs`
- `client_research_steps`
- `client_avatar_releases`
- `client_avatar_components`
- `client_avatar_assets`
- `client_avatar_approval_decisions`
- `client_avatar_active_releases`
- `client_intelligence_active_releases`
- `client_intelligence_releases`
- `client_campaign_intelligence_active_releases`
- `client_campaign_intelligence_releases`
- `client_offer_architecture_active_releases`
- `client_offer_architecture_releases`
- `client_seasonal_offer_active_releases`
- `client_seasonal_offer_releases`
- `audit_log`

Storage:

- No storage buckets are written by this phase's audited functions.

## 9. Error Handling / Retry / Idempotency Notes

- All build functions use the shared leased step claim RPC before executing step work.
- All build functions are single-step deterministic scaffold workflows and mark failures terminal/non-retryable.
- No audited build function supports module-level `retry_step`.
- Prepare functions attempt run resumption by matching authority hash and run state.
- Prepare idempotency keys are deterministic per authority hash and version, but duplicate insert races are not recovered.
- Asset generation does not have an idempotency key; repeated calls intentionally create new versions, but the version allocation is not atomic.

## 10. CORS / Method / Input Validation Notes

- All audited functions support `OPTIONS`.
- All audited functions reject non-POST requests.
- Shared CORS advertises `POST, GET, OPTIONS`, while these functions only support POST (`supabase/functions/_shared/aa.ts:16`). This is not a functional bug but is broader than necessary.
- `run-offers` validates `action`, `client_id`, and `offer_type`.
- Avatar build functions validate `action` and `client_id`.
- `generate-avatar-asset` validates `client_id` and `asset_type`.
- `generate-avatar-asset` does not validate URL scheme or storage path ownership for caller-supplied references.

## 11. Frontend Caller Mapping

| Function | Frontend caller |
| --- | --- |
| `run-offers` | `src/lib/offers.ts`, used by `src/components/client/OffersPanel.tsx`. |
| `run-avatar-strategy` | `src/lib/avatar-os.ts`, used by `src/components/client/AvatarsPanel.tsx`. |
| `run-avatar-appearance` | `src/lib/avatar-os.ts`, used by `src/components/client/AvatarsPanel.tsx`. |
| `run-avatar-world` | `src/lib/avatar-os.ts`, used by `src/components/client/AvatarsPanel.tsx`. |
| `run-avatar-operating-context` | `src/lib/avatar-os.ts`, used by `src/components/client/AvatarsPanel.tsx`. |
| `run-avatar-asset-library` | `src/lib/avatar-os.ts`, used by `src/components/client/AvatarsPanel.tsx`. |
| `generate-avatar-asset` | `src/lib/avatar-os.ts`, used by `src/components/client/AvatarsPanel.tsx`. |

Missing caller:

- `review_avatar_asset` exists in SQL, but no frontend helper/panel action was found.

## 12. Tests / Existing Coverage

Observed tests:

- `tests/offers-stage4b.test.ts`
- `tests/avatar-os-stage5.test.ts`
- `tests/avatar-os-stage5c.test.ts`
- `tests/avatar-os-stage5c-world.test.ts`
- `tests/avatar-os-stage5c-operating-context.test.ts`
- `tests/avatar-os-stage5d-assets-foundation.test.ts`
- `tests/avatar-os-stage5d-generate-asset.test.ts`

Coverage strengths:

- Tests confirm separation between Main Offers and Seasonal Offers.
- Tests confirm Seasonal Offers reference Campaign Intelligence and Main Offers.
- Tests confirm Avatar OS is a separate Avatars surface after Offers and before Ideation.
- Tests confirm no provider/media generation occurs in scaffold functions.
- Tests confirm outputs remain `needs_review`, not `approved`.
- Tests confirm `generate-avatar-asset` consumes approved Avatar authority and creates review-gated rows.

Coverage gaps:

- No test catches Seasonal Offers selecting one Main Offer but generating against `mainOffers[0]`.
- No test proves Offer release rows are immutable after approval.
- No test proves Avatar release rows are immutable after approval.
- No test proves finalize cannot demote approved/superseded/archived Offer or Avatar releases.
- No test covers duplicate prepare races.
- No test covers concurrent avatar asset version allocation.
- No test covers asset reference validation.
- No test confirms a UI/RPC path exists to review avatar assets.

## 13. Suggested Upgrades

Correctness-only upgrades, preserving original function roles:

1. Fix Seasonal Offers to use the selected Main Offer, not the first Main Offer row.
2. Add release-level lifecycle immutability guards for:
   - `client_offer_architecture_releases`
   - `client_seasonal_offer_releases`
   - `client_avatar_releases`
3. Add finalize guards requiring `status = 'draft'`, plus idempotent handling for already-finalized releases.
4. Decide/document whether Offers and Avatar scaffold functions are rebuild-only, or add narrow `retry_step` actions.
5. Add `reviewAvatarAsset` frontend support so asset records can be promoted/rejected through the Avatars UI.
6. Make avatar asset version allocation atomic or constrained.
7. Validate `storage_bucket`, `storage_path`, and `external_url` before saving asset references.
8. Add targeted tests for the selected-offer bug, release lifecycle guards, asset review UI, and asset version races.

## 14. Open Questions

- Should editors be allowed to generate Offers/Avatar scaffolds, or only review them? Current generation and review role gates differ.
- Are Offers and Avatar scaffolds intentionally rebuild-only, or should they eventually match the module-level retry pattern used by Intelligence OS?
- Should avatar asset records allow arbitrary external URLs, or only internal storage references and approved external domains?
- Should each planned asset slot allow unlimited versions, or should the UI expose one active candidate per slot plus version history?

## 15. Overall Phase Risk Rating

Risk rating: Medium

Rationale:

- The conceptual architecture is mostly intact: Offers and Avatars remain separate, deterministic, review-gated, and free of provider/media generation in the audited functions.
- Seasonal Offers has one concrete logic bug that can attach generated packaging to the wrong selected Main Offer.
- Offers and Avatars share the release-level immutability gap found in Campaign Intelligence: approved child rows are protected, but release rows themselves are not protected with the generic Intelligence lifecycle guard pattern.
- Avatar asset generation correctly remains review-gated, but the asset approval path is not exposed in the observed frontend and asset version/reference validation should be hardened.
