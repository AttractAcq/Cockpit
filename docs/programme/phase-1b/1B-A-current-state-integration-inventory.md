# Stage 1B-A — Current-State Integration Inventory

Real, code-traced inventory of every Meta/Instagram touchpoint, from UI to persistence to provider. Every table/function/file below was read directly this stage, not assumed from a name.

## 1. Shared Meta/Instagram modules (`supabase/functions/_shared/`)

| File | Purpose | Platform coupling |
|---|---|---|
| `instagram-publish.ts` | The one synchronous publish path (IMAGE/CAROUSEL/STORIES image), used by both manual publish and the scheduled worker | Hardcoded to Instagram: `resolveMetaConfig` reads an `ig_user_id`; container creation calls are `{ig}/media` (Instagram Graph API shape) |
| `instagram-reels-publish.ts` | Async Reels/Story-video publish state machine (container create → poll → publish), driven by the scheduled worker | Instagram container model (`status_code`: `IN_PROGRESS`/`FINISHED`/`ERROR`/`EXPIRED`/`PUBLISHED`) — **does not match** Facebook's Reels upload-session model (see capability matrix) |
| `instagram-insights.ts` | Metric name lists, snapshot due-timing, Meta insights response normalization | Instagram-specific metric vocabulary (`impressions`, `reach`, `saved`, `profile_visits`, etc.) — Facebook Page Insights uses different metric names, not a drop-in extension |
| `meta-ads.ts` | Paid campaign creation/launch (Stage L, Ad Studio) — separate concern from organic distribution | Also hardcodes `GRAPH_VERSION = "v21.0"` independently; targets the Marketing API surface, not Page publishing |
| `meta-errors.ts` | Error classification from Meta Graph error codes/subcodes/HTTP status into `MetaErrorCategory` | **Already platform-generic** — classifies by raw Graph API error shape (code 190 = auth, 429/4/17/32/613 = rate limit, 5xx/1/2 = server error), not by Instagram-specific concepts. This is the one module that needs no forking to serve Facebook Page publish errors too. |
| `publish-capability.ts` | The single authoritative gate for what `(platform, content type, asset format, media type)` combination can be published | `SUPPORTED_PUBLISH_PLATFORMS = ["instagram"]` is the literal, sole platform gate in the entire codebase — one array, one place. Enforced identically in the frontend, the manual-publish path, and the scheduled worker (all three call `resolveRecordPublishCapability`/`resolvePublishCapability`). |

## 2. Real, unexpected finding: the platform gate is single-layer, not defence-in-depth

`publish-capability.ts`'s own comment states the platform/content/format rule is "enforced in SQL by the `distribution_publication_supported` trigger so a bypassed frontend still cannot schedule an unsupported job." Read directly (live query against `xivewedajschthjlblfb`): the SQL function `public.distribution_publication_supported(asset_format, publish_settings, publish_payload, video_deliverable_id)` checks `content_type`/`asset_format`/media MIME type — **it does not check `platform` at all.** Today this is harmless (nothing ever sets `platform` to anything but `'instagram'`), but it means the SQL-layer safety net the comment describes does not actually cover platform today — only the TypeScript layer does. See the migration/security doc for the recommended fix (a defensive tightening, not new capability).

## 3. Canonical tables already platform-shaped (real, live-queried)

| Table | `platform` column? | Constraint | Notes |
|---|---|---|---|
| `client_distribution_records` | `text`, default `'instagram'` | No CHECK on values | The one record-per-publication-attempt table. Already carries `destination` (today: IG business account id), `publish_payload`/`publish_settings` (jsonb, format-agnostic), status machine (`ready`/`scheduled`/`publishing`/`published`/`failed`/`cancelled`/`needs_reconciliation` — already generic), plus Instagram-container-shaped columns (`external_container_id`, `container_status` CHECK'd to Instagram's exact vocabulary, `container_poll_count`). |
| `client_distribution_accounts` | `text`, default `'instagram'` | Non-empty only | **Already real, live, generically-shaped destination registry** — full CRUD exists (`fetchClientDistributionAccounts`/`saveClientDistributionAccount` in `src/lib/api.ts`), surfaced in `ClientSettingsPanel.tsx`, and is a real prerequisite check in `create-reel-distribution-draft`. The UI's platform `<select>` currently renders exactly one hardcoded `<option value="instagram">`. This table needs no schema change to hold a Facebook Page destination — only a UI option and validation to add (1B-B's job, not 1B-A's). |
| `client_distribution_policies` | none | — | Client-wide, not platform-scoped (`approval_mode`, `blackout_periods`, `restricted_weekdays`). A real open design question for 1B-B/C: does Facebook need its own policy row, or does one client-wide policy correctly govern both platforms? Not decided this stage — flagged for 1B-C (Renditions and Platform-Specific Planning), since that stage explicitly owns "platform-specific planning." |
| `client_analytics_records` | `text`, default `'instagram'` | No CHECK | Already generic-shaped (`metrics`/`metadata` jsonb, `collection_status`). `handoffToAnalytics` in `instagram-publish.ts` hardcodes `platform: record.platform ?? "instagram"` as a fallback — reads the record's real platform first, so this is already correctly platform-passthrough, not platform-hardcoded, despite the fallback default. |
| `client_business_signal_snapshots` | none directly | — | Keyed via `distribution_record_id`, so it inherits platform scoping indirectly through the parent record. No change needed. |

**Summary: the data model was built more platform-generically than the application code that uses it.** Every core distribution/analytics table already tolerates a `platform` value other than `'instagram'` at the schema level. The real work of Phase 1-B is almost entirely in the application/contract layer (capability gates, provider adapters, UI), not in undoing Instagram-specific schema — a materially better starting position than the stage's own risk framing assumed going in.

## 4. Edge functions touching Meta/Instagram

| Function | Role | Facebook impact |
|---|---|---|
| `publish-instagram-asset` | Manual/on-demand publish trigger, calls `publishDistributionRecord` | Name itself is Instagram-specific — a Facebook equivalent needs its own function or this needs generalizing (1B-D decision) |
| `process-scheduled-publishing` | The one worker for all clients/all records, cron-driven | Currently dispatches unconditionally to `publishDistributionRecord` (Instagram-only path); has no platform-based dispatch branch today. Already correctly blocks non-instagram platforms via the capability gate (fail-closed), so no regression risk — but no Facebook dispatch path exists to route to yet. |
| `collect-instagram-insights` | Analytics collection worker | Instagram-specific by name and by metric vocabulary; Facebook Page Insights needs its own collector (1B-E) |
| `create-distribution-record-from-content-item` | Bridges canonical `content_items`/briefs into a `client_distribution_records` row | Platform-agnostic already — reads `platform` from context rather than hardcoding it, per the record read this stage |
| `create-reel-distribution-draft` | Reel Studio → distribution handoff, checks `client_distribution_accounts` for an active Instagram destination | Platform-filtered (`.eq("platform", "instagram")`) by design — correctly scoped, would need a parallel Facebook check when Facebook Reels-equivalent handoff exists |
| `set-client-distribution-policy` | Writes `client_distribution_policies` | Client-wide, not platform-scoped (see above) |
| `meta-ad-ops` | **Legacy, pre-canonical** — targets the old retired `campaigns` table, not `ad_campaigns` | Confirmed dead/orphaned relative to the current Ad Studio (Stage L) chain — out of scope, not touched |
| `meta-webhook` | Not read in depth this stage | Scope for a future stage if Facebook needs webhook-driven state (not required by the capability matrix's verified publish flow, which is poll-based like Instagram) |

## 5. UI surfaces

- `ClientSettingsPanel.tsx` — Facebook destination onboarding UI does not exist; the platform selector is a single hardcoded option (see §3).
- `AdStudioPanel.tsx` — paid distribution, separate concern (Stage L), out of this stage's scope.
- No `DistributionPanel.tsx`-equivalent surface displays per-platform rendition state today — organic distribution status is read generically off `client_distribution_records`.

## 6. Tests

Existing coverage: `tests/distribution-policy.test.ts`, `tests/reel-production.test.ts`, `tests/reel-studio-phase*.test.ts`. No test file exercises platform branching (unsurprising — there is currently exactly one platform). The known pre-existing baseline gap (`instagram-publish.test.ts` failing under `node --test` due to a Deno-only import) is unrelated to this stage and untouched.
