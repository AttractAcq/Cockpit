# Edge Function Audit - Phase 07: Distribution, Publishing, and Paid Distribution

Date: 2026-08-13
Mode: Read-only audit

## 1. Phase Scope

This phase audited the organic distribution, Instagram publishing, scheduled publishing, paid distribution, Ad Studio, legacy Meta ad ops, and Instagram insights collection functions:

- `set-client-distribution-policy`
- `create-distribution-record-from-content-item`
- `publish-instagram-asset`
- `create-reel-distribution-draft`
- `process-scheduled-publishing`
- `create-ad-opportunity`
- `manage-ad-brief`
- `generate-ad-creative-variants`
- `set-ad-budget-policy`
- `create-ad-campaign`
- `launch-ad-campaign`
- `update-ad-campaign-status`
- `update-ad-campaign-budget`
- `meta-ad-ops`
- `collect-instagram-insights`

Primary UI/system areas:

- Distribution
- Paid Distribution
- Ad Studio

Audit emphasis:

- Confirm publishing is policy-gated.
- Confirm scheduled publishing cannot publish unapproved assets.
- Confirm Meta operations require correct secrets and account context.
- Confirm ad campaign launch/update paths are auditable and budget-safe.
- Confirm insight collection is read-only unless explicitly designed to persist analytics.

This audit did not invoke live functions and did not make source, schema, configuration, deployment, database, or storage changes.

## 2. Functions Audited

| Function | Role | Current posture |
| --- | --- | --- |
| `set-client-distribution-policy` | Upserts per-client organic distribution policy: approval mode, auto-scheduling, manual-only mode, blackout periods, and restricted weekdays. | Good validation and client-access gate. |
| `create-distribution-record-from-content-item` | Creates one canonical `client_distribution_records` row from an approved Content Item and approved deliverable. | Strong image-path provenance; video-path relation to Content Item is weaker. |
| `publish-instagram-asset` | Manual "Publish Now" endpoint for Instagram image/carousel/story records. | Authenticated staff-role gate, but no client-access or distribution-policy gate at publish time. |
| `create-reel-distribution-draft` | Creates a draft distribution record for an approved, current final Reel. | Strong final-Reel eligibility checks; staff-role gate only, no client-access gate. |
| `process-scheduled-publishing` | Cron worker that claims due scheduled records and publishes through the shared Instagram/Reels paths. | Strong cron secret, atomic claim, capability, retry, and automation gates; does not re-check current distribution approval policy at publish time. |
| `create-ad-opportunity` | Creates an Ad Opportunity from one of the Stage L origins. | Good origin validation and `organic_winner` provenance enforcement. |
| `manage-ad-brief` | Creates/reviews/approves Ad Briefs. | Good brief/proof validation; approved versions are superseded too early when a new draft is created. |
| `generate-ad-creative-variants` | Generates the Hooks x Visuals x Copy x CTA x Format matrix for an approved Ad Brief. | Good approved-brief gate, matrix cap, idempotency, and DB uniqueness. |
| `set-ad-budget-policy` | Upserts per-client paid safety policy. | Good client-access gate and input validation. |
| `create-ad-campaign` | Creates draft Campaign, one Ad Set, and one local Ad row per selected variant; never calls Meta. | Idempotent and DB-constrained; some invalid budgets fall through to DB errors instead of clean validation. |
| `launch-ad-campaign` | Launches the Meta Campaign and one Ad Set, then activates the campaign. | Gated before credentials, but has launch-flow and geographic-scope gaps. |
| `update-ad-campaign-status` | Pauses/resumes/completes/archives/reconciles campaign status. | Pause/resume call Meta; complete/archive are local-only and can drift from live spend state. |
| `update-ad-campaign-budget` | Updates local campaign budget and pushes daily budget to Meta for live campaigns when an external Ad Set exists. | Re-checks spend limits; can silently update local live budgets when no external Ad Set id exists. |
| `meta-ad-ops` | Legacy/superseded Meta campaign operation function targeting old `campaigns` schema. | Not aligned with current Ad Studio; high risk if deployed/reachable. |
| `collect-instagram-insights` | Cron worker that collects and persists Instagram metric snapshots for published records. | Correctly cron-secret gated and intentionally persists analytics; candidate query and run-finalization need hardening. |

## 3. UI Page / System Role

Distribution caller mapping:

- `src/lib/distribution-policy.ts` invokes `set-client-distribution-policy` and `create-distribution-record-from-content-item`.
- `src/lib/api.ts` invokes `publish-instagram-asset` and `create-reel-distribution-draft`.
- `process-scheduled-publishing` is a cron/worker endpoint, not an ordinary UI action.

Paid Distribution / Ad Studio caller mapping:

- `src/lib/ad-studio.ts` invokes `create-ad-opportunity`, `manage-ad-brief`, `generate-ad-creative-variants`, `set-ad-budget-policy`, `create-ad-campaign`, `launch-ad-campaign`, `update-ad-campaign-status`, and `update-ad-campaign-budget`.
- No current `src/lib` caller was found for `meta-ad-ops`; multiple docs describe it as legacy/superseded, while some older references still list it.
- `collect-instagram-insights` is a cron/worker endpoint, not an ordinary UI action.

## 4. Function-by-Function Findings

### P1: Manual Instagram publishing bypasses client access and current distribution policy

Affected functions:

- `publish-instagram-asset`
- `_shared/instagram-publish.ts`

Positive findings:

- The function requires a bearer token and a staff role before publishing.
- The shared publish path has a duplicate-publication guard and only marks `published` after Meta returns a real external post id.
- Reels and Story video records are redirected away from manual inline publishing.

Issue:

- `publish-instagram-asset` accepts only `distribution_record_id`, checks only staff role, and then calls `publishDistributionRecord` with the service-role client.
- It does not prove the caller has access to the distribution record's `client_id`.
- The shared publish path does not load `client_distribution_policies` and does not apply `checkApprovalModeGate`, `manual_publish_only`, blackout periods, or restricted weekdays immediately before a manual publish.
- This means a record can be manually published even if the current client policy requires explicit client approval and the record has no `client_approved_at`.

Evidence:

- `supabase/functions/publish-instagram-asset/index.ts:19` authenticates the user.
- `supabase/functions/publish-instagram-asset/index.ts:23` checks only `users.role`.
- `supabase/functions/publish-instagram-asset/index.ts:27` accepts only `distribution_record_id`.
- `supabase/functions/publish-instagram-asset/index.ts:31` delegates directly to `publishDistributionRecord`.
- `supabase/functions/_shared/instagram-publish.ts:363` loads the record by id with service-role access.
- `supabase/functions/_shared/instagram-publish.ts:357` through `supabase/functions/_shared/instagram-publish.ts:493` contains no distribution-policy check.

Suggested upgrade:

- Resolve the distribution record first, then verify caller access to `record.client_id` before service-role publishing.
- Re-apply the current `client_distribution_policies` approval gate immediately before both manual and scheduled publishing.
- Add tests proving `client_approval_required` blocks manual publish until `client_approved_at` exists.

### P1: Scheduled publishing does not re-check the current client distribution approval policy at publish time

Affected functions:

- `process-scheduled-publishing`
- `_shared/instagram-publish.ts`
- SQL RPC `claim_due_distribution_records`

Positive findings:

- `process-scheduled-publishing` requires `CRON_SECRET` before creating the service-role client.
- The claim RPC atomically claims scheduled records with `FOR UPDATE SKIP LOCKED`.
- The worker re-checks publication capability, sequence ordering, automation policy, retry caps, and permanent-failure state.
- The SQL claim predicate excludes unsupported publication combinations after the final-Reel capability migration.

Issue:

- A scheduled record is checked against `client_distribution_policies` only when `create-distribution-record-from-content-item` creates it with `scheduled_publish_at`.
- The worker does not reload current `client_distribution_policies` before publishing a claimed record.
- If a policy changes after scheduling, such as switching to `client_approval_required`, adding a blackout, or enabling manual-publish-only, the already scheduled record can still publish.

Evidence:

- `supabase/functions/create-distribution-record-from-content-item/index.ts:160` through `supabase/functions/create-distribution-record-from-content-item/index.ts:169` applies policy checks only during scheduled record creation.
- `supabase/functions/process-scheduled-publishing/index.ts:127` through `supabase/functions/process-scheduled-publishing/index.ts:145` checks automation policy, not distribution approval policy.
- `supabase/functions/process-scheduled-publishing/index.ts:232` calls `publishDistributionRecord`.
- `supabase/migrations/20260728000035_reel_studio_phase3_final_reel.sql:651` through `supabase/migrations/20260728000035_reel_studio_phase3_final_reel.sql:671` defines the final claim predicate without client-approval policy checks.

Suggested upgrade:

- Add a publish-time distribution-policy gate after claim and before any Meta credential lookup.
- If blocked by current approval/manual/blackout policy, release the claim back to `scheduled` or a review-required status without consuming a publish attempt.
- Add tests for policy changes made after scheduling but before the due time.

### P1: `create-reel-distribution-draft` is staff-role gated but not client-access gated

Affected function:

- `create-reel-distribution-draft`

Positive findings:

- Requires authenticated staff role.
- Proves the project belongs to the submitted `client_id`.
- Requires a current final Reel, linked production brief, valid execution month, storage object presence, active Instagram account, and final-Reel eligibility.
- Creates a draft only; it does not schedule or publish.

Issue:

- The function uses service-role reads after checking only staff role.
- It does not prove the caller has access to the submitted `client_id`.

Evidence:

- `supabase/functions/create-reel-distribution-draft/index.ts:34` through `supabase/functions/create-reel-distribution-draft/index.ts:39` authenticates and checks staff role.
- `supabase/functions/create-reel-distribution-draft/index.ts:45` through `supabase/functions/create-reel-distribution-draft/index.ts:48` accepts `client_id` and `video_project_id`.
- No `validateIdeationAccess`-style client access check appears before service-role reads and RPC mutation.

Suggested upgrade:

- Add the same client-access proof pattern used by `validateIdeationAccess` before reading project/deliverable rows.
- Add a cross-client access test proving staff cannot create a Reel distribution draft for a client outside their authorized scope.

### P1: `launch-ad-campaign` can pass the geography gate with an empty requested geography list

Affected functions:

- `launch-ad-campaign`
- `_shared/ad-safety-policy.ts`

Positive findings:

- Launch checks account ownership, payment method, spend limits, geography allowlist, restricted audience flags, client approval, and regulated-category acknowledgement before reading Meta credentials.
- Missing Meta Ads credentials fail closed before any provider request.

Issue:

- `checkGeographyPolicy` fails closed if the policy has no allowed geographies, but it does not require the launch request itself to include at least one requested geography.
- `launch-ad-campaign` defaults missing `requested_geographies` to `[]`.
- An empty request passes when the policy has any allowed geography, and the empty list is then passed to `createAdSetStep`.

Evidence:

- `supabase/functions/_shared/ad-safety-policy.ts:71` through `supabase/functions/_shared/ad-safety-policy.ts:84` documents the intent to prevent spending with no explicit geographic scope, but empty requested geographies produce no disallowed values and return OK.
- `supabase/functions/launch-ad-campaign/index.ts:75` passes `[]` when the body does not contain `requested_geographies`.
- `supabase/functions/launch-ad-campaign/index.ts:130` passes the same value to Meta Ad Set creation.

Suggested upgrade:

- Treat an empty requested-geography list as blocked before credentials or Meta calls.
- Add a unit test proving a configured policy plus empty requested geographies returns `NO_REQUESTED_GEOGRAPHY` or equivalent.

### P1: `launch-ad-campaign` can activate a Meta campaign even if Ad Set creation fails

Affected function:

- `launch-ad-campaign`

Positive findings:

- Meta Campaign creation failure is handled and recorded.
- The function persists `external_campaign_id` only after a real Meta Campaign id is returned.

Issue:

- After Meta Campaign creation succeeds, the function attempts to create an Ad Set if a local Ad Set row exists.
- If `createAdSetStep` fails, the failure is not recorded and does not stop execution.
- The function proceeds to `activateCampaignStep`, so a campaign can be marked active locally even though the expected Ad Set was not created.

Evidence:

- `supabase/functions/launch-ad-campaign/index.ts:125` through `supabase/functions/launch-ad-campaign/index.ts:135` updates the Ad Set only on success and has no failure branch.
- `supabase/functions/launch-ad-campaign/index.ts:137` activates the campaign regardless of Ad Set creation outcome.
- `supabase/functions/launch-ad-campaign/index.ts:143` logs only the final launch result, with `external_ids` containing the campaign id but not the Ad Set id.

Suggested upgrade:

- Fail closed if the expected local Ad Set is missing or Meta Ad Set creation fails.
- Record an `ad_launch_attempts` row with action `create_ad_set`.
- Do not activate the Meta Campaign until the Ad Set creation step succeeds.

### P1: Completing an active paid campaign is local-only and can drift from live spend state

Affected function:

- `update-ad-campaign-status`

Positive findings:

- `pause` and `resume` make real Meta calls and fail closed when configuration is missing.
- `reconcile` follows the established operator-confirmed pattern.
- State transitions are whitelisted.

Issue:

- `complete` is allowed from `active` and `paused`.
- The `complete` branch updates only the local `ad_campaigns.status`.
- If an active campaign has a real `external_campaign_id`, this can mark it `completed` locally while the Meta campaign remains active.

Evidence:

- `supabase/functions/update-ad-campaign-status/index.ts:14` through `supabase/functions/update-ad-campaign-status/index.ts:20` allows `complete` from `active`.
- `supabase/functions/update-ad-campaign-status/index.ts:67` through `supabase/functions/update-ad-campaign-status/index.ts:73` applies `complete`/`archive` as local-only updates.
- `supabase/functions/update-ad-campaign-status/index.ts:75` through `supabase/functions/update-ad-campaign-status/index.ts:109` limits real Meta calls to pause/resume.

Suggested upgrade:

- Require active live campaigns to be paused through Meta before they can be completed.
- Alternatively require `reconcile` with explicit operator confirmation before local completion for externally launched campaigns.
- Add tests proving active campaigns with `external_campaign_id` cannot be completed without a real pause or reconciliation.

### P1: Legacy `meta-ad-ops` is unsafe if deployed or reachable

Affected function:

- `meta-ad-ops`

Positive context:

- Stage L documentation says `meta-ad-ops` is dead/superseded and targets the old `campaigns`/`entities` schema.
- Current Ad Studio has separate canonical functions and does not appear to call `meta-ad-ops` from `src/lib`.

Issue:

- The source has no method restriction, JWT/user/staff/client-access check, or cron secret.
- It can insert/update legacy `campaigns` rows and may call Meta if credentials exist.
- Repository documentation is inconsistent: some docs describe it as superseded/not current, while older function references still list it as active/app-invoked.

Evidence:

- `supabase/functions/meta-ad-ops/index.ts:3` through `supabase/functions/meta-ad-ops/index.ts:27` handles requests without an auth gate.
- `supabase/functions/meta-ad-ops/index.ts:13` through `supabase/functions/meta-ad-ops/index.ts:20` can create/pause/read legacy campaigns.
- `supabase/functions/meta-ad-ops/index.ts:30` can use `AA_META_AD_ACCOUNT`.
- `docs/programme/status/Stage_L_Status.md` describes `meta-ad-ops` as dead/superseded.
- `docs/EDGE_FUNCTIONS_REFERENCE.md` still lists `meta-ad-ops` as app/agent invoked.

Suggested upgrade:

- Verify remote deployment status during a non-read-only remediation pass.
- If still deployed, hard-disable or wrap it with explicit authorization before any DB or Meta action.
- Remove/retire stale docs only when the retirement decision is explicitly in scope.

### P2: Video distribution creation does not fully prove the video deliverable belongs to the submitted Content Item

Affected function:

- `create-distribution-record-from-content-item`

Positive findings:

- Image-family assets must belong to the submitted `content_item_id`.
- Video deliverables must be same-client, approved, current, and not superseded.
- The database enforces one canonical distribution record per Content Item.

Issue:

- The video branch checks the deliverable's `client_id`, status, current flag, and supersession state, but does not prove that the deliverable is the final output for the submitted Content Item or its current Content Brief.
- This can allow an approved final Reel from the same client to be attached to a different Content Item's distribution record.

Evidence:

- `supabase/functions/create-distribution-record-from-content-item/index.ts:100` through `supabase/functions/create-distribution-record-from-content-item/index.ts:115` proves image assets belong to the submitted Content Item.
- `supabase/functions/create-distribution-record-from-content-item/index.ts:118` through `supabase/functions/create-distribution-record-from-content-item/index.ts:128` does not load project/brief linkage for the video deliverable.
- `supabase/functions/create-distribution-record-from-content-item/index.ts:195` through `supabase/functions/create-distribution-record-from-content-item/index.ts:200` stores both Content Item and video deliverable ids on the new distribution record.

Suggested upgrade:

- For video-family formats, load the deliverable's project and production/content-brief relationship and verify it matches the submitted Content Item's approved brief lineage.
- If the current schema cannot express that relationship, refuse canonical Content Item video distribution through this path and route via the dedicated Reel distribution draft path until the linkage exists.

### P2: `manage-ad-brief` supersedes the previous approved brief before a replacement is approved

Affected function:

- `manage-ad-brief`

Positive findings:

- Brief body validation is structured.
- Submit/request/approve transitions are constrained.
- Proof-required claims require a verified Proof item at approval time.

Issue:

- On creating any new brief version after version 1, the function immediately marks prior approved briefs as `superseded`.
- The new version is only a draft at this point.
- If the new draft is abandoned or invalid later, the opportunity may have no approved authority even though no new approved version replaced it.

Evidence:

- `supabase/functions/manage-ad-brief/index.ts:49` through `supabase/functions/manage-ad-brief/index.ts:51` computes the next version.
- `supabase/functions/manage-ad-brief/index.ts:53` through `supabase/functions/manage-ad-brief/index.ts:56` supersedes prior approved versions before inserting the new draft.
- `supabase/functions/manage-ad-brief/index.ts:58` through `supabase/functions/manage-ad-brief/index.ts:63` inserts the replacement as `draft`.

Suggested upgrade:

- Keep the existing approved brief as authority until the replacement version is approved.
- Move supersession into the approval transition, ideally in one transaction with approving the new version.

### P2: Regulated category acknowledgement is not propagated to Meta special ad categories

Affected function:

- `launch-ad-campaign`

Positive findings:

- Regulated category acknowledgement is checked before launch.
- The gate can block unacknowledged regulated categories.

Issue:

- The function hard-codes `specialAdCategories: []` when creating the Meta Campaign.
- If a regulated category is acknowledged and launch proceeds, the category is not mapped into the Meta Campaign creation payload.

Evidence:

- `supabase/functions/_shared/ad-safety-policy.ts:102` through `supabase/functions/_shared/ad-safety-policy.ts:110` defines the regulated-category acknowledgement gate.
- `supabase/functions/launch-ad-campaign/index.ts:77` through `supabase/functions/launch-ad-campaign/index.ts:78` accepts `regulated_category` and acknowledgement.
- `supabase/functions/launch-ad-campaign/index.ts:114` always sends `specialAdCategories: []`.

Suggested upgrade:

- Map acknowledged regulated categories into the correct Meta `special_ad_categories` values before campaign creation.
- Add tests proving acknowledged regulated categories are both accepted by policy and present in the provider payload.

### P2: Live budget updates can succeed locally without changing Meta when no external Ad Set id exists

Affected function:

- `update-ad-campaign-budget`

Positive findings:

- Rejects negative budgets at request validation.
- Re-checks spend limits before updating.
- Pushes daily budget to Meta when the campaign has an external campaign id and the local Ad Set has an external Ad Set id.

Issue:

- If a live campaign has `external_campaign_id` but its local Ad Set lacks `external_ad_set_id`, the function skips the Meta update and still updates the local budget.
- This is especially risky in combination with the `launch-ad-campaign` Ad Set failure gap.

Evidence:

- `supabase/functions/update-ad-campaign-budget/index.ts:62` through `supabase/functions/update-ad-campaign-budget/index.ts:84` attempts a Meta update only when `adSet.data?.external_ad_set_id` exists.
- `supabase/functions/update-ad-campaign-budget/index.ts:86` through `supabase/functions/update-ad-campaign-budget/index.ts:88` updates local budget regardless.

Suggested upgrade:

- For externally launched campaigns, require the external Ad Set id before accepting a daily budget update.
- If total-budget-only updates are intentionally local planning metadata, return a response flag or audit message that no Meta budget was changed.

### P2: `collect-instagram-insights` can leave collection runs stuck `running` after top-level failures

Affected function:

- `collect-instagram-insights`

Positive findings:

- `verify_jwt = false` is documented in source and protected by `CRON_SECRET` before service-role client creation.
- It intentionally persists analytics via `persist_instagram_insights_collection`, which is in-scope for its design.
- Per-record collection failures are recorded in `client_insights_collection_attempts`.

Issue:

- After inserting `client_insights_collection_runs.status = running`, the function does not wrap the remaining run in a top-level `try/finally` or catch that marks the run failed.
- A failure outside the per-record try/catch can leave a run permanently `running`.

Evidence:

- `supabase/functions/collect-instagram-insights/index.ts:94` through `supabase/functions/collect-instagram-insights/index.ts:95` creates the running collection row.
- `supabase/functions/collect-instagram-insights/index.ts:97` through `supabase/functions/collect-instagram-insights/index.ts:126` has per-record handling only.
- `supabase/functions/collect-instagram-insights/index.ts:131` finalizes the run only on normal continuation.

Suggested upgrade:

- Wrap post-run-creation work in a top-level catch/finalizer and mark the run `failed` or `completed_with_errors` with a safe error message.
- Add a failure-injection test for an error between run creation and final update.

### P2: `collect-instagram-insights` loads all eligible published Instagram records before slicing to batch size

Affected function:

- `collect-instagram-insights`

Issue:

- The function queries every published Instagram record with external post evidence, then loads snapshots and expired attempts for all candidate ids, then slices due work to batch size in memory.
- This can become expensive as distribution history grows.

Evidence:

- `supabase/functions/collect-instagram-insights/index.ts:62` through `supabase/functions/collect-instagram-insights/index.ts:64` loads all matching records.
- `supabase/functions/collect-instagram-insights/index.ts:67` through `supabase/functions/collect-instagram-insights/index.ts:76` loads snapshot/attempt context for all candidate ids.
- `supabase/functions/collect-instagram-insights/index.ts:81` through `supabase/functions/collect-instagram-insights/index.ts:84` slices to `batchSize` only after in-memory due calculation.

Suggested upgrade:

- Push more filtering into SQL or add a bounded candidate window before snapshot lookups.
- Keep the same snapshot schedule and persistence behavior; this is an operational hardening change, not a change to objective.

### P3: `create-ad-campaign` relies on database CHECK constraints for invalid campaign budgets

Affected function:

- `create-ad-campaign`

Positive findings:

- The database enforces non-negative `ad_campaigns.budget_daily`, `ad_campaigns.budget_total`, and `ad_sets.budget_daily`.
- The function is DB-only and never calls Meta.

Issue:

- The function does not validate negative campaign/ad-set budget inputs before insert.
- Invalid values will be rejected by DB constraints, but the API returns generic `INSERT_FAILED` instead of a clean request validation response.

Evidence:

- `supabase/functions/create-ad-campaign/index.ts:59` through `supabase/functions/create-ad-campaign/index.ts:64` inserts campaign budget values directly.
- `supabase/functions/create-ad-campaign/index.ts:69` through `supabase/functions/create-ad-campaign/index.ts:75` inserts Ad Set budget values directly.
- `supabase/migrations/20260809120000_stage_l_ad_studio_paid_distribution.sql:233` through `supabase/migrations/20260809120000_stage_l_ad_studio_paid_distribution.sql:234` enforce campaign budget CHECK constraints.
- `supabase/migrations/20260809120000_stage_l_ad_studio_paid_distribution.sql:273` through `supabase/migrations/20260809120000_stage_l_ad_studio_paid_distribution.sql:274` enforce Ad Set budget CHECK constraints.

Suggested upgrade:

- Add request-level numeric validation for `budget_daily`, `budget_total`, and `ad_set.budget_daily`.
- Return `INVALID_BUDGET` with HTTP 400 before DB mutation.

### P3: `create-distribution-record-from-content-item` ignores failure to update the Content Item back-reference

Affected function:

- `create-distribution-record-from-content-item`

Issue:

- After inserting the distribution record, the function attempts to update `content_items.distribution_record_id` but does not inspect the update result.

Evidence:

- `supabase/functions/create-distribution-record-from-content-item/index.ts:206` through `supabase/functions/create-distribution-record-from-content-item/index.ts:208` awaits the update without checking `error`.

Suggested upgrade:

- Check and log/audit failure of the back-reference update.
- Consider wrapping distribution insert and Content Item back-reference update in one RPC transaction.

## 5. Configuration Checklist

Local Supabase config:

- `supabase/config.toml` sets `project_id = "cockpit"`.
- The only locally declared audit-scope JWT-disabled function is `collect-instagram-insights` via `[functions.collect-instagram-insights] verify_jwt = false`.
- `process-scheduled-publishing` keeps default JWT behavior locally and also requires `x-cron-secret`.

Deployment/config notes from repository docs:

- `docs/REEL_STUDIO_PRODUCTION_DEPLOYMENT_REPORT.md` says `process-scheduled-publishing` keeps `verify_jwt: true` plus `x-cron-secret`.
- `docs/PRE_STAGE_A_REPOSITORY_READINESS_REPORT.md` identifies cron targets for `process-scheduled-publishing` and `collect-instagram-insights`.
- `docs/programme/status/Stage_L_Status.md` says no live Meta ad account credentials have been configured and `launch-ad-campaign` should fail closed at missing config.
- `meta-ad-ops` has conflicting documentation: older references list it, while Stage L describes it as superseded/retired.

## 6. Security / Auth / RLS Notes

Good patterns:

- Most current Stage K/L functions use `validateIdeationAccess`, which verifies the caller's client access before service-role mutation.
- Paid tables enable RLS, revoke broad authenticated writes, and grant writes only to service role.
- Publishing and paid launch paths generally avoid frontend direct provider calls.

Gaps:

- `publish-instagram-asset` and `create-reel-distribution-draft` are staff-role gated but not client-access gated.
- `meta-ad-ops` has no in-function auth gate and targets legacy tables.
- Manual and scheduled publishing do not re-apply current distribution policy immediately before publication.

## 7. Secrets / Environment Variables Required

Organic publishing and insights:

- `CRON_SECRET`: required by `process-scheduled-publishing` and `collect-instagram-insights`.
- `_GLOBAL_META_SYSTEM_USER_TOKEN` or `META_SYSTEM_USER_TOKEN`: accepted by the shared Instagram publisher.
- Vault fallback: `{client_slug} / META / SYSTEM_USER_TOKEN`.
- Vault/global fallback: `_GLOBAL / META / SYSTEM_USER_TOKEN`.
- Instagram user id can come from `publish_settings.meta.ig_user_id`, numeric destination, or Vault `{client_slug} / META / IG_USER_ID`.

Paid distribution:

- Vault credential: `{client_slug} / META_ADS / ACCESS_TOKEN`.
- `ad_budget_policies.ad_account_id` is the campaign-specific ad account source used by Stage L.

Legacy/superseded:

- `meta-ad-ops` reads `_global / meta / system_user_token`, `{client_slug} / meta / access_token`, and `AA_META_AD_ACCOUNT`. These lowercase credential keys do not match the current Stage L `META_ADS` convention.

## 8. Database Tables / Storage Buckets Touched

Organic distribution:

- `client_distribution_policies`
- `client_distribution_records`
- `client_distribution_accounts`
- `client_publish_attempts`
- `content_items`
- `content_briefs`
- `content_item_assets`
- `video_projects`
- `video_project_deliverables`
- `client_production_briefs`
- `activity_log`
- `client_exception_queue` via `file_exception`
- Analytics handoff tables through `_shared/instagram-publish.ts`

Paid distribution:

- `ad_opportunities`
- `ad_briefs`
- `ad_creative_variants`
- `ad_budget_policies`
- `ad_campaigns`
- `ad_sets`
- `ads`
- `ad_launch_attempts`
- `proof_items`
- `content_opportunities`
- `clients`
- `activity_log`

Insights:

- `client_distribution_records`
- `client_metric_snapshots`
- `client_insights_collection_runs`
- `client_insights_collection_attempts`
- `clients`

Legacy:

- `meta-ad-ops` targets legacy `campaigns` and agent/audit event tables.

Storage:

- `create-reel-distribution-draft` checks final Reel objects in the final-Reel bucket.
- `publish-instagram-asset` signs media storage paths before Meta publishing.
- `collect-instagram-insights` does not touch storage.

## 9. Error Handling / Retry / Idempotency Notes

Good patterns:

- `create-distribution-record-from-content-item` is idempotent by unique Content Item distribution record.
- SQL `claim_due_distribution_records` uses atomic claim and `SKIP LOCKED`.
- `process-scheduled-publishing` has retry classification, backoff, stale recovery, permanent failure marking, and exception filing.
- `generate-ad-creative-variants` is idempotent at code level and backed by a DB uniqueness constraint.
- `create-ad-campaign` uses `(client_id, idempotency_key)` and rolls back the campaign row if Ad Set or Ads insert fails.
- `launch-ad-campaign` writes `ad_launch_attempts` for blocked launch and campaign-create failure.

Hardening needed:

- Add policy-block handling to scheduled worker after claim.
- Add failure handling for `launch-ad-campaign` Ad Set creation.
- Add run-finalization catch/finally for `collect-instagram-insights`.
- Move Ad Brief supersession into approval-time transaction semantics.

## 10. CORS / Method / Input Validation Notes

Good patterns:

- Current Stage K/L functions consistently handle OPTIONS and reject non-POST methods.
- `collect-instagram-insights` accepts empty JSON for cron use and rejects unauthorized cron headers.
- `set-client-distribution-policy` validates blackout periods and weekdays.
- `set-ad-budget-policy` validates arrays and non-negative spend limits.

Gaps:

- `meta-ad-ops` handles OPTIONS but does not reject non-POST methods or authenticate callers.
- `create-ad-campaign` relies on DB constraints instead of request-level validation for negative budgets.
- `launch-ad-campaign` does not reject empty requested geographies.

## 11. Frontend Caller Mapping

| Frontend module | Functions invoked |
| --- | --- |
| `src/lib/distribution-policy.ts` | `set-client-distribution-policy`, `create-distribution-record-from-content-item` |
| `src/lib/api.ts` | `publish-instagram-asset`, `create-reel-distribution-draft` |
| `src/lib/ad-studio.ts` | `create-ad-opportunity`, `manage-ad-brief`, `generate-ad-creative-variants`, `set-ad-budget-policy`, `create-ad-campaign`, `launch-ad-campaign`, `update-ad-campaign-status`, `update-ad-campaign-budget` |
| Cron/worker | `process-scheduled-publishing`, `collect-instagram-insights` |
| Legacy/no current app caller found | `meta-ad-ops` |

Known UI/server mismatch:

- `docs/operations/architecture-guide.md` notes the Ad Studio UI exposes `organic_winner` creation without selecting/passing a real `promoted_from_content_opportunity_id`, while `create-ad-opportunity` correctly requires that provenance.

## 12. Tests / Existing Coverage

Existing useful coverage:

- `tests/distribution-policy.test.ts` covers distribution approval policy gates.
- `tests/ad-studio.test.ts` covers Ad Brief validation, creative matrix generation, paid safety policy gates, and dependency-injected Meta Ads adapter helpers.
- `tests/reel-studio-phase3.test.ts` includes source-level checks around `create-reel-distribution-draft` and scheduled publishing/Reel paths.

Coverage gaps:

- No test proves `publish-instagram-asset` enforces client access or current distribution approval policy.
- No test proves `process-scheduled-publishing` re-checks distribution approval/manual/blackout policy after claim.
- No test proves empty requested geographies are blocked.
- No test proves `launch-ad-campaign` stops on Ad Set creation failure.
- No test proves active externally launched campaigns cannot be completed locally without pause/reconcile.
- No test proves `create-reel-distribution-draft` rejects client ids outside caller access.
- No test proves `collect-instagram-insights` finalizes runs on top-level failures.

No tests were run as part of this audit; the phase was read-only aside from writing this analysis document.

## 13. Suggested Upgrades

Priority order:

1. Add client-access checks to `publish-instagram-asset` and `create-reel-distribution-draft`.
2. Add current distribution-policy checks immediately before manual and scheduled publishing.
3. Fix `launch-ad-campaign` to reject empty requested geographies and fail closed on Ad Set creation failure.
4. Block local-only completion of active external campaigns unless paused or operator-reconciled.
5. Verify and retire/harden `meta-ad-ops` if it is deployed or reachable.
6. Move Ad Brief supersession from draft creation to replacement approval.
7. Harden `update-ad-campaign-budget` for externally launched campaigns without external Ad Set ids.
8. Add top-level run finalization and bounded candidate scanning to `collect-instagram-insights`.
9. Add request-level budget validation to `create-ad-campaign`.
10. Check/audit the Content Item back-reference update in `create-distribution-record-from-content-item`.

These are correctness, safety, authorization, observability, and test-hardening recommendations. They do not expand or contract the original product objectives.

## 14. Open Questions

- Are all staff roles intended to have global all-client publishing access? If yes, document that explicitly; if no, the client-access findings should be treated as release blockers.
- Should distribution approval policy be evaluated only at scheduling time, or should current policy always control actual publication time? The audit assumes actual publication must respect current policy.
- Is `meta-ad-ops` deployed in the current Supabase project? The repo has conflicting legacy/status references, so remote status should be verified during a non-read-only remediation pass.
- Should Meta special ad categories be derived from internal `regulated_categories`, or should launch explicitly require a Meta-compatible category field?
- Is total budget for live campaigns intentionally local planning metadata, or should total-budget updates also be pushed/reconciled with Meta?

## 15. Overall Phase Risk Rating

Risk rating: High.

Reasoning:

- Organic publishing has strong duplicate-post and real-success safeguards, but manual and scheduled publication do not currently re-apply the active distribution approval policy at the moment of publish.
- Paid distribution correctly fails closed on missing credentials and has a solid DB spine, but launch/status/budget edge cases could create local/Meta drift or activate incomplete campaigns once credentials are configured.
- The legacy `meta-ad-ops` function is out of alignment with the current Ad Studio design and is unsafe if reachable.

The system is structurally close to the intended architecture, but the findings above should be remediated before enabling real paid Meta credentials or relying on current-policy enforcement for manual/scheduled publishing.
