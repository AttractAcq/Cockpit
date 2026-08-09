# Stage 1B-C Status — Facebook Renditions and Platform-Specific Planning

Third stage of Programme Phase 1-B, on top of Stage 1B-B (`31dc899`). One canonical Content Item can now produce an independent Facebook Rendition without mutating the canonical Brief or another platform's Rendition.

## Starting and final commit state

- Branch: `stage-1b-c-facebook-renditions-platform-specific-planning`, created off `stage-1b-b-facebook-page-destinations-authorisation` at `31dc899`.
- Not committed to `main`, per the stage prompt.

## A real bug found and fixed via live testing

`create-facebook-rendition`'s "supersede the previous active rendition" step originally only set `status = 'superseded'`, leaving `approved_by`/`approved_at` untouched. `content_item_renditions_approval_check` is biconditional (`status = 'approved'` **iff** both are set) — superseding an *approved* rendition without clearing those columns violates the constraint, and the update's error wasn't checked, so it failed silently. The next insert then hit the partial unique index (`content_item_renditions_active_platform_idx`, one active row per content item/platform), returning a confusing `INSERT_FAILED` instead of the real cause.

Live-tested end to end (approve a rendition, then create a new version), caught the `500`, traced it to the constraint, fixed the supersede update to also null both columns, redeployed, and re-ran the exact same live sequence to confirm the fix. **The identical pattern exists, unexercised, in the pre-existing `generate-content-brief`'s own "supersede the previous approved brief" step for `content_briefs`** (same biconditional constraint, same unchecked update, copied faithfully from that file as the established convention). Not fixed here — it's Stage H's code, out of this stage's scope per "do not opportunistically refactor unrelated systems" — but flagged clearly since it's a real, live, currently-dormant bug (dormant for the same reason described in Stage P's audit: `content_briefs` has never carried a real approved-then-superseded row in production).

## Architecture and ownership decisions

1. **The Brief stays canonical; the Rendition captures the platform-specific realisation.** `content_briefs.body` already carries a single `platform`/`cta`/`copy_or_script_requirements` (confirmed by reading the real schema) — it was never platform-neutral. Renditions don't change this; they add an independent layer for the actual caption text, CTA, format, and media selection, read-adjacent to the Brief but never writing to it.
2. **Lifecycle mirrors `content_briefs` exactly** (`draft`/`in_review`/`approved`/`superseded`, the same three review actions) rather than inventing new vocabulary — `review-content-brief/index.ts`'s own comment establishes this as the convention for this area of the codebase, and this stage follows it literally.
3. **Versioning also mirrors `content_briefs`**: a new Rendition supersedes the previous active one for the same `(content_item_id, platform)`, enforced by a partial unique index, not `content_item_assets`' `is_current`/`revision_of` pattern — a Rendition's creative-review lifecycle is much closer to a Brief's than to a generated asset's.
4. **Format reuses Stage 1B-A's `RenditionContentType`** (`distribution-platform-contract.ts`) rather than a second vocabulary — the first real use of that contract since it was defined.
5. **Capability validation is grounded in Stage 1B-A's own research, not assumed.** `CAROUSEL` and `STORIES` are blocked (Stage 1B-A explicitly left Facebook's multi-photo album and Stories capability unverified against primary docs) while `IMAGE`/`VIDEO`/`REELS`/`TEXT_LINK` are allowed (confirmed). A rendition in an unsupported format can still be created as a draft (so an operator can see it and understand why), but is blocked at the review gate with a specific, real reason — never silently.
6. **Shared vs platform-specific media is derived, not stored.** `classifyRenditionMedia` treats an asset id referenced by more than one rendition as shared and one referenced only by this rendition as platform-specific — no redundant boolean to drift out of sync.
7. **Calendar integration deliberately kept light.** `calendar_slots.platform` is a single text column, not an array — retrofitting multi-platform slot planning would mean touching Stage G's live `commit_calendar_proposal` RPC and calendar-proposal edge functions for a benefit this stage doesn't actually need (rendition visibility, not calendar-slot planning). Not touched this stage; the real integration point is `ContentItemsPanel.tsx`, where Renditions now live directly under their Brief.
8. **Asset ownership is checked on every write.** Both `create-facebook-rendition` and `update-facebook-rendition` verify every referenced `content_item_asset_id` actually belongs to the same Content Item before accepting it — never trusts an id from the request body.

## Migrations, tables, RLS, RPC and Edge Function changes

- `20260814120000_stage_1b_c_content_item_renditions.sql` — new `content_item_renditions` table, RLS (`SELECT` scoped by `client_id = ANY(auth_client_ids())`, matching the exact pattern already live on `content_items`/`content_briefs`/`content_item_assets`; no direct authenticated write policy — writes go through service-role Edge Functions only), a partial unique index enforcing at most one active rendition per `(content_item_id, platform)`, and a biconditional approval CHECK (the one this stage's real bug was found in).
- New Edge Functions, all deployed ACTIVE to `xivewedajschthjlblfb`: `create-facebook-rendition` (v2, after the live fix), `update-facebook-rendition`, `review-facebook-rendition`.
- New shared module: `_shared/facebook-rendition-contract.ts` (format capability, media classification, readiness gating, status transitions — all pure).

## Shared domain, API and frontend changes

- `src/types/content-brief.ts` — `ContentItemRendition`, `RenditionFormat`, `RenditionPlatform`, `RenditionStatus`, `RenditionCapabilitySnapshot`.
- `src/lib/content-items.ts` — `fetchRenditionsForItem`, `createFacebookRendition`, `updateFacebookRendition`, `reviewFacebookRendition`.
- `src/lib/production-studio.ts` — new `fetchAssetsForItem` (content-item-scoped, for the rendition media picker; the existing `fetchAssetsForJob` is job-scoped and untouched).
- `src/components/client/ContentItemsPanel.tsx` — new `RenditionsSection`: create a Facebook rendition (format picker, copy/CTA, media checkboxes from the item's real current assets), list active renditions with status/capability badges, inline edit while draft, submit/approve/request-changes actions. Mounted directly under the existing Brief display; nothing about the existing Brief UI was changed.

## Compatibility, backfill and cutover behaviour

No backfill — this is new, additive schema with no prior data. Instagram needs no Rendition row to keep publishing exactly as it does today (`content_items`/`client_distribution_records` path, untouched); `platform IN ('instagram','facebook')` on the table is forward-consistent with `client_distribution_accounts` (Stage 1B-B) but nothing requires an Instagram row to exist.

## Security and client-isolation verification

**Live-verified with disposable fixtures** (a `ZZ-TEST-1B-C` client, a real Content Item, a real disposable operator with an `account_manager` role and a `team_members` grant — all deleted after):

- Full real lifecycle exercised end to end through the deployed functions: create (draft) → readiness-gate refusal on empty copy/CTA/media (`409`) → edit → submit for review → approve, with `approved_by`/`approved_at` genuinely set by the real operator.
- Versioning/supersede proven live: creating a second rendition for the same platform correctly superseded the first (confirmed via direct query); attempting to edit the now-superseded rendition correctly refused (`409 NOT_EDITABLE`).
- Capability gate proven live: a `CAROUSEL` rendition was created as a draft (capability snapshot `supported: false` with the real reason) and correctly refused at `submit_for_review`.
- Cross-client rejection proven live: a request naming a client the operator has no `team_members` grant for was refused (`403 CLIENT_ACCESS_DENIED`) before any table write.
- RLS proven live via direct PostgREST query with the real operator's JWT: all three renditions visible for the granted client.
- `get_advisors(type="security")`, run twice (before and after the live-fix redeploy): 47 WARN, 0 ERROR both times — identical to the pre-stage baseline.
- Every fixture (client, content item, renditions, `auth.users`/`identities`, `team_members`) confirmed deleted — zero leftover count on every table checked.

## Tests added and complete results

`tests/facebook-rendition-contract.test.ts` — 22 tests: every required test named in the stage prompt (multiple renditions on one Content Item, independent copy/CTA, shared vs platform-specific asset classification, unsupported format blocking clearly with a real reason, every approval-boundary transition including the superseded-is-terminal rule, and format-specific readiness rules like `TEXT_LINK` needing no media).

Full suite: **1038/1039 pass** (was 1016/1017 at the end of Stage 1B-B; +22 new, zero regressions). The 1 failure is the same pre-existing `instagram-publish.test.ts` baseline gap.

## Typecheck, lint and build results

`npm run typecheck` — clean. `npm run lint` — 0 errors, the same 4 pre-existing warnings in files this stage did not touch. `npm run build` — clean. `git diff --check` (staged) — clean. Secret scan of the full staged diff — clean.

## External provider actions and live verification

None — this stage is entirely internal to Cockpit's own canonical spine (Content Items, Briefs, Renditions). No Meta/Facebook API call was made; capability validation is a pure, documentation-grounded function, not a live provider check (that's 1B-D's job for actual publishing).

## Deferred or blocked items, with exact reasons

1. **The identical supersede/approval-check bug in `generate-content-brief`** — found, not fixed. Reason: pre-existing Stage H code, out of this stage's scope; flagged explicitly above rather than silently left undocumented.
2. **`content_briefs` requirement before rendition creation** — not enforced. A rendition can be created for a Content Item with no Brief yet. Reason: a deliberate scope decision, not an oversight — the natural workflow (Brief first) is guided by UI ordering, not hard-gated, matching how loosely `content_items.status` itself is enforced elsewhere in the canonical spine (per Stage P's audit).
3. **Calendar Planning surface multi-platform display** — not built. Reason: `calendar_slots.platform` is a single column; retrofitting it touches Stage G's live commit RPC for a benefit (pre-commit platform visibility) this stage doesn't need. Documented as a real, deliberate scope boundary, not silently skipped.
4. **`RenditionMedia`'s richer shape from the Stage 1B-A contract** (`storageBucket`/`storagePath`/`width`/`height` per item) — the live table stores plain `content_item_asset_id` references instead, since `content_item_assets` already carries that metadata and duplicating it would be redundant, unsynced state. The contract's richer shape remains available for 1B-D if a denormalized view is ever needed.

## Confirmation against every acceptance criterion

- **"Facebook is represented as an independent rendition."** Confirmed structurally (its own table, own lifecycle) and live (created, edited, reviewed, approved independently of the Brief).
- **"Content lineage remains canonical and traceable."** Every rendition FKs to its real `content_item_id`; `content_briefs` was never written to by any rendition function (verified by code inspection — no rendition function ever references the `content_briefs` table).
- **"Operators can review Facebook output before publishing."** The full draft → in_review → approved flow is real, deployed, and live-tested.
- **"Unsupported destination capabilities block publication clearly."** Live-verified: `CAROUSEL` blocked at the review gate with a specific, real, documentation-grounded reason, not a generic error.
- **"Instagram and Facebook data cannot overwrite one another."** Structurally guaranteed — the partial unique index is scoped per `(content_item_id, platform)`, so an Instagram rendition (if one is ever created) and a Facebook rendition for the same Content Item are entirely independent rows; nothing in any of the three new functions ever touches a row for a platform other than the one in the request.

## Confirmation that the stage exit gate is satisfied

> An approved Content Item can produce an approved, capability-valid Facebook rendition ready for publication.

Satisfied for the Rendition half of this sentence: a real Facebook rendition was taken live, end to end, from creation through approval, with a genuine capability check gating readiness at every review step. The "approved Content Item" half carries forward the honest caveat from Stage P's audit: `content_items.status` advancement to `'approved'` has no real code path anywhere in the canonical spine today, so this was tested against a real Content Item that exists but is not itself `'approved'` — the Rendition layer built this stage does not depend on that status and would work identically once that gap (documented, not this stage's to fix) is closed.
