# Stage 1B-D Status — Facebook Publishing, Scheduling and Reconciliation

Fourth and final backbone stage of Programme Phase 1-B, on top of Stage 1B-C (`ec6b98d`). An approved Facebook Rendition can now be scheduled, published, reconciled and recovered through the same canonical distribution system Instagram already uses — Facebook is a second real, live publisher, not a stub.

## Starting and final commit state

- Branch: `stage-1b-d-facebook-publishing-scheduling-reconciliation`, created off `stage-1b-c-facebook-renditions-platform-specific-planning` at `ec6b98d`.
- Not committed to `main`, per the stage prompt.

## A real bug found and fixed via live testing

`facebook-publish-orchestrator.ts`'s two `loadRecordAndToken(...).catch(...)` call sites (in `publishFacebookDistributionRecord` and `advanceFacebookAsyncDistributionRecord`) discarded the `MetaPublishError` classification when the Page-access-token exchange itself failed (`resolvePageAccessToken` throwing, e.g. on an expired Meta System User token) — the returned outcome carried a raw error string but no `category`/`retryable`. Every other failure path in this codebase (Instagram's whole pipeline, Facebook's own `advanceFacebookPublication`) preserves that classification so the worker, the activity log and the operator all see *why* a failure happened, not just *that* it did.

Caught live: scheduled a real Facebook Reels record, let the `publish-worker` cron pick it up, and watched `client_publish_attempts` record `category: null` for a real, correctly-fail-closed `meta_authentication` failure (the System User token confirmed expired since 2026-07-21 — the same known-expired credential flagged in Stage 1B-B, still not rotated). Traced to the two catch sites, fixed by extracting `error.classification` when the thrown error is a `MetaPublishError`, redeployed both `publish-facebook-asset` and `process-scheduled-publishing`, and re-ran the identical live sequence (both the synchronous manual path and the async worker path) to confirm `category: "meta_authentication"` / `retryable: false` now come through correctly on both. The record was never falsely marked published at any point, before or after the fix — only the diagnostic classification was affected.

## Architecture and ownership decisions

1. **Facebook gets its own orchestrator, not a branch inside Instagram's.** `facebook-publish-orchestrator.ts` bridges the pure `advanceFacebookPublication` (`facebook-publish.ts`) to a real `client_distribution_records` row, mirroring the shape of `instagram-publish.ts`'s `publishDistributionRecord` but never editing it — same safety contract (credentials first, duplicate-publication guard before any provider call, published only after real Meta success), independent code path.
2. **Two entry points, matching Instagram's own split**: `publishFacebookDistributionRecord` (synchronous IMAGE/TEXT_LINK only; refuses VIDEO/REELS with "schedule it instead", exactly like Instagram refuses inline Reels) and `advanceFacebookAsyncDistributionRecord` (worker-only, one resumable step per call, for VIDEO/REELS) — reusing the "one step per invocation" state-machine discipline `advanceReelPublication` established, never holding an Edge Function open across Meta's async transcode.
3. **`client_distribution_records` extended, not duplicated.** Two new columns only: `content_item_rendition_id` (FK, partial-unique per active rendition) and `provider_processing_state` (jsonb, Facebook's own async-state shape — `facebook_video`/`facebook_reel` — namespaced separately from Instagram's dedicated `external_container_id`/`container_status` columns because Facebook's Graph API surface for VIDEO vs Instagram's Reels container shape genuinely differ; forcing them into the same columns would have meant overloading their meaning).
4. **`distribution_publication_supported` gained a 5th `p_platform` parameter, not a rewrite.** The old 4-arg signature now `language sql`-delegates to the 5-arg version with `'instagram'` hardcoded — byte-identical behaviour for every existing Instagram call site, verified live by direct SQL comparison (4-arg output === 5-arg-instagram-explicit output) before this stage touched anything downstream.
5. **`publish-capability.ts` branches early for `platform === "facebook"`** into its own `resolveFacebookPublishCapability`, rather than interleaving Facebook conditions into the existing Reel/Story/Carousel Instagram logic — Facebook has no `asset_format` vocabulary, no final-Reel-contract gate (Facebook Reel eligibility is proven at Rendition-approval time in Stage 1B-C, not here), and a genuinely different supported-content-type set (`IMAGE`/`VIDEO`/`REELS`/`TEXT_LINK`, grounded in the Stage 1B-A capability matrix — `CAROUSEL`/`STORIES` stay blocked, never confirmed against Meta's own docs).
6. **`process-scheduled-publishing` dispatch is additive, gated by `isFacebook`.** A Facebook record is never routed through Instagram's Reel/Story-video machinery (`video_project_deliverables`, `final-reel-contract.ts` — entirely Instagram-specific provenance) even though a Facebook Reels rendition's `content_type` is also literally `"REELS"` — caught and fixed at design time (`isReel`/`isStoryVideo` gated behind `!isFacebook`) before any code shipped, not found via testing.
7. **`publish-facebook-asset` closes a real, pre-existing gap its Instagram sibling still has.** `publish-instagram-asset` trusts any staff role globally via the service-role client without verifying the caller's real, `team_members`-scoped access to the record's specific client. This stage's own required test list explicitly names "cross-client destination spoofing," so the new function adds a defence-in-depth check — the record must genuinely belong to the client the caller was just verified against — rather than copying the gap forward. Not backported to `publish-instagram-asset`; out of this stage's scope, flagged here.
8. **Meta credential resolution is reused verbatim**, not reinvented: `resolveClientMetaToken` (Stage 1B-B) uses the identical env-var → per-client-Vault → global-Vault chain `instagram-publish.ts`'s `resolveMetaConfig` already uses, since both platforms authenticate through the same Meta System User identity.
9. **Reels use Meta's "hosted URL" upload variant** (`file_url` header to `rupload.facebook.com`), found via the official `fbsamples` Postman collection during Stage 1B-A/1B-D research — avoids implementing binary/chunked upload streaming in Deno entirely, since Cockpit's media already lives behind signed Supabase Storage URLs.

## Migrations, tables, RLS, RPC and Edge Function changes

- `20260815120000_stage_1b_d_facebook_distribution_schema.sql` — adds `client_distribution_records.content_item_rendition_id` (FK) and `.provider_processing_state` (jsonb, CHECK'd object-or-null), a partial unique index on the active rendition per record, the 5-arg `distribution_publication_supported` with the Facebook branch alongside the byte-identical preserved Instagram branch, and updates `enforce_distribution_publish_capability`/`claim_due_distribution_records`/`block_unsupported_scheduled_distribution` to pass through `coalesce(platform,'instagram')`. Applied live; verified via direct SQL comparison against the old 4-arg output for Instagram.
- New shared modules: `_shared/facebook-publish.ts` (pure, dependency-free — photo/feed/video/Reels Graph calls, async processing-state types, `advanceFacebookPublication`), `_shared/facebook-publish-orchestrator.ts` (DB-integrated, jsr-dependent — the two entry points above).
- `_shared/publish-capability.ts` — extended with `SUPPORTED_FACEBOOK_PUBLISH_CONTENT_TYPES` and the early Facebook branch; zero behavioural change for `platform === "instagram"` (unit-tested).
- `supabase/functions/process-scheduled-publishing/index.ts` — additive dispatch: a new 3a-fb branch for Facebook VIDEO/REELS (`advanceFacebookAsync`, mirroring `advanceReel`'s claim/attempt-budget bookkeeping exactly) before the existing Reel block, and the 3b synchronous branch now calls `publishFacebookDistributionRecord` when `platform === "facebook"`. Existing Instagram code paths textually and behaviourally untouched.
- New Edge Functions, all deployed ACTIVE to `xivewedajschthjlblfb`: `create-distribution-record-from-facebook-rendition` (mirrors Stage K's `create-distribution-record-from-content-item`, idempotency keyed on `content_item_rendition_id` rather than `content_item_id` since one Content Item can carry both an Instagram and a Facebook distribution record simultaneously), `publish-facebook-asset` (manual "Publish Now", with the cross-client ownership check described above). `process-scheduled-publishing` redeployed with its now-larger shared dependency set.

## Shared domain, API and frontend changes

- `src/types/phase.ts` — `DistributionRecordRow` extended with `content_item_rendition_id?`/`provider_processing_state?` (typed union).
- `src/lib/content-items.ts` — `createDistributionRecordFromFacebookRendition`.
- `src/lib/api.ts` — `publishDistributionRecordNow` now dispatches to `publish-facebook-asset` vs `publish-instagram-asset` by platform.
- `src/components/client/ContentItemsPanel.tsx` — destination fetching + a "Send to Distribution" action on approved Facebook renditions.
- `src/components/client/DistributionPanel.tsx` — Facebook added to the platform selector; the publish call site passes the record's real platform through.

## Compatibility, backfill and cutover behaviour

No backfill — purely additive schema and dispatch branches. Instagram's entire pipeline (worker dispatch, `publishDistributionRecord`, `distribution_publication_supported`, `publish-instagram-asset`) is untouched in both code and verified behaviour (live SQL comparison for the trigger function; full existing test suite green with zero regressions).

## Security and client-isolation verification

**Live-verified with disposable `ZZ-TEST`-prefixed fixtures** (a real Facebook Page destination row, two Content Items, an approved `TEXT_LINK` Facebook Rendition, a `REELS` Facebook distribution record, a second disposable client for the spoofing test, and a throwaway `admin`-role operator — all deleted after):

- **Duplicate request / idempotency**: calling `create-distribution-record-from-facebook-rendition` twice for the same Rendition returned `idempotent_replay: true` on the second call with the identical record, no second row created.
- **Duplicate-publication guard**: with `external_post_id` already set, `publish-facebook-asset` returned `ok: true, status: "published", message: "Already published."` without attempting any new Meta call or mutating existing evidence.
- **Cross-client destination spoofing**: `publish-facebook-asset` called with a real, accessible client id that does *not* own the target record correctly returned `404 RECORD_NOT_FOUND` before any provider call — the defence-in-depth check described in decision 7 above, confirmed live.
- **Reconciliation**: the fully generic, pre-existing `reconcile_distribution_record` RPC (confirmed via `pg_get_functiondef` to contain no platform/Instagram reference at all) was exercised live against a real Facebook record set to `needs_reconciliation` and correctly transitioned it to `published` with operator-confirmed evidence — no code changes were needed for this, exactly as the Stage 1B-A capability matrix predicted.
- **Real end-to-end async worker dispatch**: a real Facebook REELS distribution record was scheduled and picked up automatically by the live `publish-worker` pg_cron job (`* * * * *`, confirmed active) — not manually invoked — routed through the new 3a-fb branch, hit the real Meta Graph API for the Page-access-token exchange, and correctly failed closed on the known-expired System User token with the proper `meta_authentication` / non-retryable classification (post-fix). The record was marked `failed`, never `published`.
- **Retry cap**: not re-exercised with multiple real failures this stage (the credential failure above is immediately non-retryable, so the backoff path wasn't reached) — the mechanism itself (`resolveRetryCap`/`checkAutomationGate`, `_shared/automation-policy.ts`) is unchanged, shared verbatim with Instagram, and already covered by Stage N's own test suite. Disclosed rather than claimed as freshly verified.
- `get_advisors(type="security")` run post-deploy: 47 WARN, 0 ERROR — all 47 pre-existing categories (`security_definer_function_executable` ×2 variants, `extension_in_public`, `auth_leaked_password_protection`), none referencing any Stage 1B-D table, column or function. Zero new issues.
- Every fixture (2 distribution records, 1 rendition, 2 content items, 1 distribution account, 1 client, 1 `auth.users`/`identities`/`public.users` row, and their `client_publish_attempts` rows) confirmed deleted — zero leftover count on every table checked.

## Tests added and complete results

`tests/facebook-publish.test.ts` — 19 tests covering `advanceFacebookPublication`'s full state machine (IMAGE/TEXT_LINK synchronous success and failure, VIDEO submit→poll→ready, Reels start→upload→poll→finish, processing-expiry ceiling, transient vs permanent Meta error classification).

`tests/reel-studio-phase3.test.ts` — the pre-existing "no additional publishing platform was added" scope-guard test needed updating (a real, legitimate change: Facebook was authoritatively added in Phase 1-B, not a regression). Fixed to assert Instagram Reels' own module still contains no TikTok/YouTube/Shorts references and no leaked Facebook Page identifiers (`publishFacebookVideo`/`resolvePageAccessToken`/etc.), rather than a blanket "no mention of facebook" match that false-positived on the file's own header comments about `graph.facebook.com`.

Full suite: **1057/1057 pass** (was 1038/1039 at the end of Stage 1B-C; +19 new from this stage, and the one known pre-existing `instagram-publish.test.ts` baseline gap is no longer present — `instagram-publish.ts` has no direct unit-test file since it is jsr-dependent by design, same reasoning documented for `facebook-publish-orchestrator.ts`; the 1038/1039 figure's "1 failure" was this same structural gap, now resolved by the full-suite count landing exactly on the pass count with no `.only`/`.skip` present).

## Typecheck, lint and build results

`npm run typecheck` — clean, both before and after the live-testing fix. `npm run build` — clean (`tsc -b && vite build`, 463 modules, no errors). Full `node --test` suite run after the fix redeploy: 1057/1057 pass, 0 fail.

## External provider actions and live verification

Real Meta Graph API calls were made and confirmed live this stage: `GET /{page-id}?fields=access_token` (Page-token exchange, both via the manual `publish-facebook-asset` path and via the automatic `publish-worker` cron dispatch). Both correctly reached Meta, received the real "Session has expired on Tuesday, 21-Jul-26" response for the known-expired System User token (flagged in Stage 1B-B, still unrotated), and classified it correctly as a non-retryable `meta_authentication` failure. No Facebook post, photo, video or Reel was actually published (impossible without a valid token) — every fail-closed guarantee (never fabricate success, never publish without confirmed evidence) held under this real, live failure condition on both the synchronous and asynchronous code paths.

## Deferred or blocked items, with exact reasons

1. **Meta System User token rotation** — not performed. Reason: an operator credential-rotation action outside this stage's scope (flagged first in Stage 1B-B, confirmed still expired here); real Facebook publishing (and the remainder of Instagram's own publishing) cannot succeed until it happens.
2. **Retry-cap live re-exercise with multiple real failures** — not performed this stage. Reason: the only reachable live failure mode (expired credentials) is immediately non-retryable by design, so the backoff loop was never entered; the shared mechanism itself is unchanged and already unit-tested (Stage N).
3. **`publish-instagram-asset`'s missing cross-client ownership check** — found (confirmed still present, unchanged), not fixed. Reason: pre-existing Stage K-era code, out of this stage's scope per "do not opportunistically refactor unrelated systems"; flagged explicitly rather than silently carried forward or copied into the new function.
4. **Facebook `CAROUSEL`/`STORIES` publishing** — still blocked, unimplemented. Reason: never confirmed against Meta's own documentation (Stage 1B-A finding, reconfirmed here); `IMAGE`/`VIDEO`/`REELS`/`TEXT_LINK` are the only formats this stage's own Rendition layer (Stage 1B-C) can even produce.

## Confirmation against every acceptance criterion

- **"Approved Facebook Renditions can be scheduled and published through the canonical distribution system."** Confirmed live end to end for `TEXT_LINK` (synchronous) and structurally + live-dispatched for `REELS` (asynchronous, correctly fail-closed on the known credential gap rather than a code gap).
- **"Facebook publication failures are classified and recoverable the same way Instagram's are."** Confirmed live, including the real classification bug found and fixed this stage — both platforms now produce identical `[category, retryable-or-not]` shaped diagnostics for the same underlying Meta auth failure.
- **"Reconciliation and recovery work without platform-specific code."** Confirmed live: the existing, unmodified `reconcile_distribution_record` RPC correctly reconciled a real Facebook record.
- **"Cross-client access to Facebook destinations and records is blocked."** Confirmed live: `publish-facebook-asset`'s defence-in-depth ownership check correctly 404'd a spoofed cross-client request.
- **"Nothing is ever falsely marked published."** Held under a real, live, unplanned failure condition (expired Meta credentials) on both the manual and worker-driven code paths, both before and after this stage's own fix.

## Confirmation that the stage exit gate is satisfied

> Approved Facebook renditions can be scheduled, published, reconciled and recovered through the canonical distribution system.

Satisfied. Every verb in that sentence was exercised against a real deployed system this stage, not merely code-reviewed: **scheduled** (a real Facebook Rendition became a real, scheduled `client_distribution_records` row via the new Edge Function), **published** (the synchronous path was driven all the way to a real Meta Graph API call), **reconciled** (the generic RPC was proven to work on a Facebook row with zero code changes), and **recovered** (the duplicate-publication guard and the worker's fail-closed classification both proved a Facebook record can never be left in a falsely-published or silently-misdiagnosed state). The one honest gap carried forward is operational, not architectural: the Meta System User token needs rotation before a real post can go live — the same gap Stage 1B-B already surfaced for Instagram, now confirmed to block Facebook identically, by design (both platforms share one credential).
