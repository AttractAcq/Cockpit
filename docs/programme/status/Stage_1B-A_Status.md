# Stage 1B-A Status — Facebook Architecture and Capability Baseline

First stage of Programme Phase 1-B (Facebook Distribution), following the completed A–P core programme (now on `main` at `8c32867`). Per this stage's own exit gate, **no Facebook credential or publishing implementation begins this stage** — the deliverables are the reconciled current-state trace, the canonical domain contract, and the migration/security design that 1B-B onward will build against.

## Starting and final commit state

- Branch: `stage-1b-a-facebook-architecture-capability-baseline`, created off `main` at `8c32867` (Phase 1 complete, including the `fix/asset-partial-acceptance-schema` merge).
- No commits to `main`. Per the stage prompt: "Do not commit directly to `main`. Leave the work ready for the Programme Orchestrator verification and approval gate."

## Architecture and ownership decisions

1. **The canonical domain contract is a separate, additive module** (`supabase/functions/_shared/distribution-platform-contract.ts`), not a modification of the live `publish-capability.ts` gate. `SUPPORTED_PUBLISH_PLATFORMS` in that file remains `["instagram"]`, byte-for-byte unchanged. The new module's own `LIVE_PLATFORMS` constant mirrors that same fact, so nothing reading the new contract can mistake "defined" (`ALL_PLATFORMS` — instagram + facebook) for "live" (`LIVE_PLATFORMS` — instagram only). This is the mechanism by which "canonical contracts are agreed in code" without beginning implementation.
2. **A real, found SQL gap was deliberately NOT fixed this stage.** `public.distribution_publication_supported()` (the trigger backing the live worker's claim query) never checks `platform`. Traced its real callers: `enforce_distribution_publish_capability` (the live `BEFORE INSERT/UPDATE` trigger), `claim_due_distribution_records` (the actual `FOR UPDATE SKIP LOCKED` claim query the scheduled-publishing worker runs every minute), and `block_unsupported_scheduled_distribution` (a sweep). Since the gap's current blast radius is zero (nothing ever sets `platform` to non-`'instagram'`) and fixing it correctly means touching the single most sensitive live SQL in the organic-distribution pipeline, I judged this the wrong trade for an audit-and-contracts-only stage and deferred it to 1B-B's first "expand" step, with full reasoning in `docs/programme/phase-1b/1B-A-migration-and-security-model.md`.
3. **Provider processing state is a discriminated union, not a shared shape**, because Instagram's container-and-poll model and Facebook's Reels upload-session model are genuinely different (verified against Meta's own Graph API docs, fetched live this stage), and Facebook's non-Reels publishing is synchronous with no processing state at all. Forcing these into one shape would misrepresent at least two of the three.
4. **The failure taxonomy (`meta-errors.ts`) needs no fork.** `MetaErrorCategory`/`classifyMetaError` already classify by raw Meta Graph error code/subcode/HTTP status, not by Instagram-specific concepts — confirmed by reading the file directly. This was the one place I expected platform-specific duplication and found none needed.

## Migrations, tables, RLS, RPC and Edge Function changes

**None.** Verified live against `xivewedajschthjlblfb`: `client_distribution_records`, `client_distribution_accounts`, and `client_analytics_records` already carry a free-text, unconstrained `platform` column (default `'instagram'`, no CHECK restricting values) — no `ALTER TABLE` was needed to let this stage's contract exist. No migration was written this stage.

## Shared domain, API and frontend changes

- New: `supabase/functions/_shared/distribution-platform-contract.ts` — `DistributionPlatform`, `Destination`, `Rendition`, `PublicationStatus`, `ProviderProcessingState` (discriminated union), `Receipt`, `Publication`, plus `fromLegacyInstagramRow()` mapping a real, live Instagram row losslessly into the contract.
- No frontend changes. No existing shared module was modified.

## Compatibility, backfill and cutover behaviour

No backfill — nothing exists yet to migrate. Compatibility is proven forward, not by migrating data: `fromLegacyInstagramRow()` maps every real `publish_status` value, every real `asset_format` → content-type mapping (`feed_post`/`ad_static`→IMAGE, `carousel`→CAROUSEL, `story_sequence`/`story_video`→STORIES, `reel_video`→REELS), and both in-flight (Instagram container) and terminal (published/failed) row shapes into the canonical contract without loss, verified by test.

## Security and client-isolation verification

- Confirmed via live query: `client_distribution_accounts` already carries the same per-client RLS as every other table (verified clean across all 133 tables in Stage P's hardening pass) — adding a Facebook-platform row later needs no new isolation mechanism.
- Confirmed: the existing Vault-backed Meta credential pattern (`readCredential(sb, clientSlug, "META", "SYSTEM_USER_TOKEN")`) already reads a **Meta**-scoped token, not Instagram-specific — plausibly reusable for Facebook Page permissions, but explicitly **not confirmed live this stage** (would need a real token to test) — flagged as 1B-B's first live-verification task, not assumed.
- Identified a real, new-to-Facebook permission concept (Meta's per-Page `CREATE_CONTENT` task capability, a two-tier model Instagram's integration doesn't use) that the existing `resolveMetaConfig` has no equivalent check for — documented as an open item for 1B-B, not resolved this stage.

## Tests added and complete results

`tests/distribution-platform-contract.test.ts` — 16 tests: platform live/defined boundary (3), publication status machine correctness against the live CHECK constraint (2), duplicate-publication evidence parity with the live guard (1), and compatibility mapping from real Instagram row shapes (10, covering every `asset_format`→content-type mapping, in-flight container state, failed rows, every real `publish_status` value round-tripping, missing-destination handling, and cross-client isolation of the pure mapping function).

Full suite: **997/998 pass** (was 982/982 at the close of Stage P; +16 new, zero regressions). The 1 failure is the pre-existing `instagram-publish.test.ts` Deno-only-import baseline gap, present and unrelated since at least Stage L. One transient failure in `ideation-provider-reliability.test.ts` (an unrelated, pre-existing file this stage never touched) appeared on the first run and did not reproduce on a clean re-run — a timing-sensitive flake, not a regression introduced by this stage.

## Typecheck, lint and build results

- `npm run typecheck` — clean.
- `npm run lint` — 0 errors, 4 pre-existing warnings (unchanged from Stage P, in files this stage did not touch).
- `npm run build` — clean.
- `git diff --check` (staged) — clean.
- Secret scan of every new file — clean.

## External provider actions and live verification

- **Meta's own Graph API reference documentation was fetched live this stage** (not relied on from training knowledge) for: Page video publishing (`/{page_id}/videos`), Page Reels publishing (`/{page_id}/video_reels`, confirmed as a distinct multi-step upload-session model, not Instagram's container model), Page photo/feed posts (`/{page_id}/photos`, `/{page_id}/feed`), and the Graph API version deprecation schedule.
- **One real correction made during research**: an initial secondary-source search result claimed Graph API versions older than v22.0 (including the codebase's hardcoded v21.0) were already being rejected by Meta. This was checked directly against Meta's own official version changelog before being written into any report — it does not hold up; v21.0 actually expires 2027-01-21, still valid. The incorrect claim is not repeated as fact anywhere in this stage's docs.
- **No live Meta API call was made with real credentials** — correct for this stage, since no publishing implementation exists yet to test.
- Multi-photo/carousel-equivalent and Facebook Page Stories were explicitly left unverified (not found in the primary docs checked this stage) rather than assumed present or absent — flagged as open items for 1B-C.

## Deferred or blocked items, with exact reasons

1. **SQL platform-gate defense-in-depth fix** (`distribution_publication_supported` never checks `platform`) — deferred to 1B-B's first "expand" step. Reason: zero live blast radius today; fixing it correctly requires touching the live scheduled-publishing worker's claim query, which is out of proportion for an audit-only stage and carries real regression risk to the one thing this whole programme has been most careful never to break.
2. **Facebook Page multi-photo album mechanism** — not verified against primary documentation this stage. Reason: not reached in the research pass; flagged rather than assumed, since Instagram's `carousel` format has no confirmed Facebook equivalent yet.
3. **Facebook Page Stories** — not verified. Same reasoning as above.
4. **Whether the existing Meta system-user token can serve Facebook Page permissions** — plausible from the credential architecture, not confirmed live. Requires a real token to test, which is 1B-B scope.
5. **Whether `client_distribution_policies` needs to become platform-scoped** — an open design question explicitly deferred to 1B-C ("Renditions and Platform-Specific Planning"), which owns platform-specific planning decisions by name.
6. **`meta-errors.ts` permission-taxonomy gap** (no `meta_permission_denied`-shaped category for the `CREATE_CONTENT` task-capability failure mode) — flagged for resolution against a real 403 response during 1B-B, not guessed at here.

## Confirmation against every acceptance criterion

- **"Current Meta behaviour is traced from UI to persistence and provider."** Done — `docs/programme/phase-1b/1B-A-current-state-integration-inventory.md` traces every shared module, edge function, UI surface, and table, read directly from the live repository and live database this stage.
- **"Facebook capability is not inferred from Instagram capability."** Done — the capability matrix was built from Meta's own Page-publishing documentation, fetched live; where Facebook and Instagram diverge (Reels, most visibly), the matrix and the contract both keep them distinct rather than assuming parity.
- **"Canonical contracts are agreed in code and documentation."** Done — `distribution-platform-contract.ts` plus its three companion docs (capability matrix, integration inventory, migration/security model).
- **"No existing Instagram path regresses."** Confirmed — zero live files were modified (`git status` shows only new, additive files); the new contract module is imported by nothing else in the codebase (verified by grep); full test suite shows zero regressions against Stage P's baseline.
- **"The next stage has an additive migration plan."** Done — the expand/mirror/cutover/contract sequence in the migration doc, plus the specific, reasoned recommendation that 1B-B's first action is the platform-gate SQL fix.

## Confirmation that the stage exit gate is satisfied

> No Facebook credential or publishing implementation begins until the destination, rendition, publication and verification contracts are canonical and tested.

Satisfied: no Facebook credential exists or was requested; no publishing code was written; the destination contract (`Destination`), rendition contract (`Rendition`), publication contract (`Publication`/`PublicationStatus`), and verification/receipt contract (`Receipt`/`ProviderProcessingState`) are all defined in tested code (16/16 passing) plus three supporting documents, ready for 1B-B to build against.
