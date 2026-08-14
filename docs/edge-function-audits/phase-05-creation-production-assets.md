# Edge Function Audit - Phase 05: Creation, Production, Assets

Date: 2026-08-13
Mode: Read-only audit

## 1. Phase Scope

This phase audited the Creation, Content, Content Briefs, Production Studio, and Assets functions:

- `generate-phase-3`
- `preview-phase-3-scope`
- `start-phase-3-scope`
- `generate-phase-3-slot`
- `generate-production-brief`
- `set-production-brief-mode`
- `send-production-brief-to-contractor`
- `route-content-brief-to-studio`
- `submit-production-review`
- `generate-ai-background-image`
- `check-ai-background-image`
- `start-carousel-generation`
- `generate-carousel-slide`
- `regenerate-asset-frame`
- `generate-video-storyboard`
- `generate-feed-post-asset`
- `generate-carousel-assets`
- `generate-story-assets`
- `generate-ad-static-asset`
- `process-asset-generation-jobs`

Primary UI/system areas:

- Creation
- Content
- Content Briefs
- Production Studio
- Assets

Audit emphasis:

- Confirm content creation does not bypass approved briefs.
- Confirm AI asset generation has provider failure recovery.
- Confirm asset regeneration preserves versioning and provenance.
- Confirm background job processing cannot generate assets without valid source authority.
- Confirm contractor handoff remains blocked for AI-only flows unless explicitly allowed.

This audit did not invoke live functions and did not make source, schema, configuration, deployment, database, or storage changes.

## 2. Functions Audited

| Function | Role | Current posture |
| --- | --- | --- |
| `generate-phase-3` | Legacy full-month Phase 3 master/calendar generator. | Uses approved Phase 1/2 authority and writes needs-review masters/calendar, but has no in-function user/client authorization. |
| `preview-phase-3-scope` | Read-only preview for scoped Phase 3 slots. | No writes; role-gated, but not client-access gated. |
| `start-phase-3-scope` | Creates scoped Phase 3 run/items for range or single-item generation. | Authority-gated and non-asset-producing; role-gated, but not client-access gated. |
| `generate-phase-3-slot` | Generates one scoped Phase 3 master row and calendar cell. | Uses approved authority and atomic item claim; run finalization can race with in-flight items. |
| `generate-production-brief` | Creates one production brief from an approved master row. | Approved-authority gated and review-gated; overwrites existing brief row in-place on regeneration. |
| `set-production-brief-mode` | Changes production mode on a production brief. | Uses shared mode contract and optimistic timestamp; role-gated, but not client-access gated. |
| `send-production-brief-to-contractor` | Sends an approved production brief to a human contractor by email. | Approved-brief gated; AI-only/newer mode blocking is incomplete and mode is overwritten to `human`. |
| `route-content-brief-to-studio` | Routes approved canonical Content Briefs to a `production_jobs` row. | Uses client-aware access and approved brief gate; production mode constraint is stale for Stage 5E modes. |
| `submit-production-review` | Records production review decisions and server/manual quality checks. | Uses client-aware access; records checks but does not enforce failed server checks or advance job/content state. |
| `generate-ai-background-image` | Submits an approved AI background prompt to OpenAI Batch. | Strong approved-prompt/brief-fingerprint claim via RPC; role-gated, but not client-access gated. |
| `check-ai-background-image` | Checks OpenAI Batch result and stores generated background image metadata. | Does not resubmit work; failure states are recoverable; role-gated, but not client-access gated. |
| `start-carousel-generation` | Creates persisted multi-image generation jobs/items. | Approved production brief gate and no provider call; role-gated, but not client-access gated. |
| `generate-carousel-slide` | Processes one queued carousel/story item. | One-item worker with DB claim and failure state; role-gated, but not client-access gated. |
| `regenerate-asset-frame` | Regenerates one slide/frame as a new asset version. | Preserves versioning and current pointer through RPC; role-gated, but not client-access gated. |
| `generate-video-storyboard` | Generates Reel Studio storyboard from approved brief/context authority. | Strong approved-context/storyboard validation; role-gated, but not client-access gated. |
| `generate-feed-post-asset` | Thin wrapper around shared single-image AI asset generation. | Approved production brief gate through shared helper; role-gated, but not client-access gated. |
| `generate-carousel-assets` | Retired sync multi-image wrapper around shared AI asset generation. | Returns 410 for multi-image sync path; retained for compatibility. |
| `generate-story-assets` | Retired sync multi-image wrapper around shared AI asset generation. | Returns 410 for multi-image sync path; retained for compatibility. |
| `generate-ad-static-asset` | Thin wrapper around shared single-image AI asset generation. | Approved production brief gate through shared helper; role-gated, but not client-access gated. |
| `process-asset-generation-jobs` | Cron safety-net worker for multi-image asset jobs. | Secret-gated, bounded worker; relies on prevalidated job rows and DB RPC guards. |

## 3. UI Page / System Role

Creation / Phase 3:

- `src/lib/api.ts` invokes `generate-phase-3` for prepare/section/finalize.
- `src/lib/api.ts` invokes `preview-phase-3-scope`, `start-phase-3-scope`, and `generate-phase-3-slot` for scoped retry/rebuild flows.

Production Briefs / Content Creation:

- `src/lib/api.ts` invokes `generate-production-brief`, `set-production-brief-mode`, `send-production-brief-to-contractor`, and the AI image generation functions.
- `src/components/client/ContentCreationPanel.tsx` exposes the Production Brief modal and method selection for Human/AI production.
- Reels are intentionally routed to Reel Studio, not the synchronous AI-image pipeline.

Production Studio:

- `src/lib/production-studio.ts` invokes `route-content-brief-to-studio` and `submit-production-review`.
- The current operations docs state that canonical `production_jobs` are routed but not consumed by a complete real studio pipeline yet.

Assets:

- `src/lib/api.ts` maps `feed_post`, `carousel`, `story_sequence`, and `ad_static` to the asset generation functions.
- Multi-image carousel/story generation uses the persisted job model: `start-carousel-generation` creates job/items; `generate-carousel-slide` processes one item at a time; `process-asset-generation-jobs` is the cron safety net.

## 4. Cross-Cutting Findings

### P1: Several service-role functions are role-gated but not client-access gated

Affected functions:

- `preview-phase-3-scope`
- `start-phase-3-scope`
- `generate-phase-3-slot`
- `generate-production-brief`
- `set-production-brief-mode`
- `send-production-brief-to-contractor`
- `generate-ai-background-image`
- `check-ai-background-image`
- `start-carousel-generation`
- `generate-carousel-slide`
- `regenerate-asset-frame`
- `generate-video-storyboard`
- `generate-feed-post-asset`
- `generate-carousel-assets`
- `generate-story-assets`
- `generate-ad-static-asset`

Positive context:

- Most of these functions do require an authenticated user and a staff role.
- `route-content-brief-to-studio` and `submit-production-review` already use `validateIdeationAccess`, which verifies both role and client visibility using the caller's JWT/RLS before service-role work begins.

Issue:

- The affected functions use service-role queries after checking only that the caller is `admin`, `account_manager`, or `editor`.
- They do not consistently verify that the caller can access the specific `client_id` behind the production brief, run, generation, asset, or video project before reading/writing under service role.
- `generate-phase-3` is weaker than the others because it does not perform in-function authentication/authorization at all; it relies on gateway-level JWT settings and then uses service-role data access.

Why this matters:

- If staff roles are ever narrower than global access, a caller with a valid staff role and a guessed row ID can operate on another client's production objects.
- The repo already has a safer pattern in `validateIdeationAccess`; the inconsistency is the defect.

Suggested upgrade:

- Add a shared `validateClientAccess` helper for Creation/Production functions, or reuse `validateIdeationAccess` where role policy is acceptable.
- For row-ID-only calls, load the row only after resolving its `client_id`, then verify the caller can access that client before continuing with service-role mutations.
- Add tests proving cross-client row IDs return 403 before provider calls, storage writes, or DB mutations.

### P1: Contractor handoff only blocks `reel_video + ai`, not the full AI-only / AI-led mode set

Affected function:

- `send-production-brief-to-contractor`

Positive findings:

- It requires an approved production brief before assignment.
- It escapes markdown into HTML safely.
- It records assignment/email state and activity log entries.

Issue:

- The handoff guard blocks only `brief.asset_format === "reel_video" && brief.production_mode === "ai"`.
- The current production-mode contract includes `ai`, `hybrid`, `avatar_led`, `faceless`, `proof_led`, `static`, and `human_led`.
- The same function then overwrites the brief to `production_mode: "human"` after email success, and also overwrites mode to `human` on failure cleanup.

Why this matters:

- A Reel brief marked `avatar_led`, `faceless`, `proof_led`, or `hybrid` can be sent through the human contractor path even when the mode was chosen to route it elsewhere or require special constraints.
- The silent overwrite bypasses the explicit mode-transition path in `set-production-brief-mode`, including its approved-brief acknowledgement rules.

Suggested upgrade:

- Use the shared production-mode contract to decide whether a brief is contractor-eligible.
- Do not overwrite `production_mode` inside contractor handoff; only set `production_status`.
- If a mode conversion to human production is required, force it through `set-production-brief-mode` first.
- Add tests for `ai`, `hybrid`, `avatar_led`, `faceless`, `proof_led`, and `human_led` handoff behavior.

### P1: Canonical `production_jobs` schema still rejects Stage 5E production modes

Affected function/schema:

- `route-content-brief-to-studio`
- `production_jobs.production_mode`

Positive findings:

- `route-content-brief-to-studio` uses `validateIdeationAccess`.
- It re-enforces that the Content Brief must be `approved`.
- It writes only `production_jobs`, not generated assets.

Issue:

- `route-content-brief-to-studio` types `production_mode` as only `"ai" | "human" | "hybrid"`.
- Migration `20260808024029_stage_i_shared_production_studio.sql` constrains `production_jobs.production_mode` to only `human`, `ai`, or `hybrid`.
- Stage 5E expanded `client_production_briefs.production_mode` to include `avatar_led`, `faceless`, `proof_led`, `static`, and `human_led`, but did not update `production_jobs`.

Why this matters:

- Canonical Content Briefs generated with the newer modes can fail at production routing, even though the broader Production Brief/Reel Studio contract now accepts those modes.
- This is not a feature expansion request; it is a configuration drift between two existing production-mode contracts.

Suggested upgrade:

- Update the `production_jobs_production_mode_check` constraint and TypeScript types to match the current shared production-mode contract.
- Add tests that route approved Content Briefs for every accepted mode, while preserving unsupported-format failures.

### P1: `generate-phase-3-slot` can mark a scoped run terminal while items are still processing

Affected function:

- `generate-phase-3-slot`

Positive findings:

- Uses `claim_next_phase3_scope_item` with `FOR UPDATE SKIP LOCKED`.
- Re-loads approved authority for the claimed item's month.
- Generates exactly one master row and calendar cell, never a production brief or asset.

Issue:

- When the claim RPC returns no queued item, the function computes progress and immediately marks the run `complete`, `partial`, or `failed`.
- The progress helper counts both `queued` and `processing` items as non-terminal, but the no-claim branch does not check that count before finalizing the run.
- In concurrent operation, one worker can have an item in `processing` while another sees no queued items and marks the run complete/partial early.

Why this matters:

- UI state can show a scoped run as terminal while a slot is still generating.
- Late writes can then occur after the run has been shown as complete, making audit/progress state unreliable.

Suggested upgrade:

- In the no-claim branch, if queued/processing count is greater than zero, return the current in-progress progress state and do not mark terminal.
- Add a concurrency test with one processing item and no queued items.

### P2: Scoped Phase 3 run counters can be lost under concurrent workers

Affected function:

- `generate-phase-3-slot`

Issue:

- The function increments `created_count`, `skipped_count`, and `conflicted_count` using values from the initially loaded run row.
- Concurrent workers can load the same count values and overwrite each other's increments.

Suggested upgrade:

- Use SQL-level increments or recalculate counters from `client_phase3_scope_items` after each item.
- Treat run counters as derived state where possible.

### P2: Production brief regeneration overwrites the existing row in-place

Affected function:

- `generate-production-brief`

Positive findings:

- Requires approved Phase 1 context files and approved Phase 2 execution files.
- Requires a matching master row and calendar source.
- Generated briefs are saved as `needs_review`, not approved.
- Uses mode-specific heading contracts and proof-violation checks.

Issue:

- Existing production briefs are updated in place with new `content_md`, `status: "needs_review"`, and `version + 1`.
- There is no separate immutable history row or snapshot of the previously approved brief.

Why this matters:

- If the existing brief was approved, regeneration destroys the prior approved markdown in the same row.
- This weakens review traceability and makes it harder to prove exactly which approved instructions produced downstream assets or contractor handoffs.

Suggested upgrade:

- Preserve prior approved brief content before overwrite, or move production briefs to append-only versions with an active pointer.
- At minimum, block in-place regeneration of a `produced`, `assigned_human`, or distributed brief unless an explicit archive/versioning path records the previous approved state.

### P2: AI visual input paths are not ownership-validated server-side

Affected functions:

- `start-carousel-generation`
- shared `serveAiAssetFunction`
- `regenerate-asset-frame`

Positive findings:

- Frontend uploads visual inputs under a client/month/source-ref path.
- Multi-image start validates that an uploaded image is readable before creating job items.
- Regeneration reuses the stored input path from existing asset metadata.

Issue:

- The edge functions accept/download `uploaded_image_path` or metadata-stored input paths from the private bucket without verifying that the path belongs to the same client/source/brief.
- `start-carousel-generation` checks readability via signed URL, but readability is not ownership.

Why this matters:

- With a valid staff session and path knowledge, the generation path can potentially use another client's private uploaded image as visual input.

Suggested upgrade:

- Validate storage paths server-side against the owning brief/client before signed URL/download.
- Store uploaded visual inputs in a DB table with client ownership and reference that row ID instead of trusting a raw path.

### P2: `submit-production-review` records approval even if server-computed checks fail or cannot be computed

Affected function:

- `submit-production-review`

Positive findings:

- Uses `validateIdeationAccess`.
- Validates optional asset ownership against the production job.
- Computes CTA and proof-accuracy checks server-side when it can load the brief/item/proof context.

Issue:

- Lookup errors for `content_briefs`, `content_items`, source links, and proof counts are ignored.
- If the content brief lookup fails or returns null, no server checks are pushed, but a review can still be inserted.
- If server-computed checks fail, the function still records `decision: "approved"` when supplied by the caller.
- The function records a review row but does not update `production_jobs`, `content_item_assets`, or `content_items` state.

Why this matters:

- A production review can claim approval while carrying failed or missing deterministic checks.
- The docs already note that real `content_items.status` advancement is a known follow-on gap; this audit confirms the edge function itself still only records reviews.

Suggested upgrade:

- Fail closed if deterministic server checks cannot be computed.
- If `decision === "approved"`, reject when any server-computed check fails unless an explicit override/audit reason exists.
- Add state advancement only if that is the original accepted meaning of this review path; otherwise document that this is a review log, not an approval gate.

### P2: `route-content-brief-to-studio` idempotency can replay an old brief for a regenerated Content Item

Affected function:

- `route-content-brief-to-studio`

Issue:

- The idempotency key is based on `content_item_id + studio`, not `content_brief_id` or brief version.
- If a Content Item receives a new approved brief for the same studio, routing returns the existing job for the previous brief instead of detecting the stale job/brief mismatch.

Why this matters:

- Production can remain attached to old approved instructions after a brief has been regenerated/re-approved.

Suggested upgrade:

- On idempotent replay, verify `existing.content_brief_id === briefId`.
- If it differs, return a stale-job conflict or create a new versioned job according to the original production-job design.

### P2: Background job worker trusts pre-existing jobs and does not revalidate brief authority at execution time

Affected functions:

- `process-asset-generation-jobs`
- shared `processNextItem`

Positive findings:

- Worker is `CRON_SECRET` gated and fails closed if `CRON_SECRET` or `OPENAI_API_KEY` is missing.
- It processes at most three items per invocation and stops before the edge wall-clock cap.
- `processNextItem` uses atomic item claiming, closed-job checks, partial-acceptance checks, and DB RPC persistence.
- `persist_asset_generation_result` blocks closed jobs, approved asset groups, and publication conflicts.

Issue:

- The worker does not revalidate that the originating production brief is still approved/current immediately before generating each item.
- It relies on `start-carousel-generation` having created only valid jobs.

Why this matters:

- If a brief is demoted or changed after job creation but before the cron worker resumes, the worker can continue generating from queued item prompts.
- This may be intended for resumable jobs, but it should be explicit because it affects source authority guarantees.

Suggested upgrade:

- Decide and document whether job creation freezes authority for the whole job.
- If authority must remain live-current, revalidate the production brief/fingerprint before processing each item.
- If frozen authority is intended, persist a brief fingerprint/snapshot on the job and verify it during processing.

## 5. Function-by-Function Notes

### `generate-phase-3`

Role:

- Full-month generator for Phase 3 masters and calendar cells.
- It prepares by clearing month outputs, generates bounded sections, then finalizes counts and invokes `validate-execution-pack`.

Positive findings:

- Requires complete/approved Phase 1 and Phase 2 authority before generation.
- Every generated row is `needs_review`.
- Finalize verifies expected master/calendar counts and proof-honesty patterns.
- Calendar generation is deterministic from generated masters.

Findings:

- P1: No in-function authentication, role check, or client-access check before service-role reads/writes.
- P2: `prepare` destructively deletes existing month masters/calendar cells without checking downstream production/distribution references. This may be expected for the legacy full-month generator, but it is materially broader than the newer scoped replace checks.

Suggested upgrades:

- Add the same authenticated client-access gate used by newer canonical functions.
- Add a preflight that refuses full-month prepare when existing refs have downstream production, asset, distribution, analytics, or archive records, unless the original full-regeneration design explicitly allows wiping only unapproved rows.

### `preview-phase-3-scope`

Role:

- Preview scoped Phase 3 slots without writes.

Positive findings:

- No mutations.
- Uses deterministic planning, cadence resolution, duplicate classification, and authority counts.

Findings:

- P1: Role-gated but not client-access gated.

Suggested upgrade:

- Use client-aware access validation before service-role preview queries.

### `start-phase-3-scope`

Role:

- Create a scoped generation run and item rows.

Positive findings:

- Requires approved authority for every month in the planned slots.
- Inserts skipped/conflict items instead of silently dropping them.
- Rollbacks parent run if item insert fails.

Findings:

- P1: Role-gated but not client-access gated.
- P2: Requires AI configuration even for a run that may contain only skip/conflict items; this is conservative but can block a planning/state operation unrelated to provider work.

Suggested upgrades:

- Add client-aware access validation.
- Consider checking AI configuration only when at least one item action is `create` or `replace`.

### `generate-phase-3-slot`

Role:

- Generate one scoped master/calendar item per invocation.

Positive findings:

- Atomic queued-item claim.
- Revalidates duplicate state before generation.
- Uses approved authority and creates no brief/asset.

Findings:

- P1: Role-gated but not client-access gated.
- P1: Can mark the run terminal while items remain processing.
- P2: Run counters can race under concurrent workers.

Suggested upgrades:

- Add client-aware access validation after loading the run.
- Do not finalize while queued/processing item count is non-zero.
- Use DB-side increments or derived counters.

### `generate-production-brief`

Role:

- Generate production-ready instructions from approved master/calendar/context/execution authority.

Positive findings:

- Uses approved context and execution files only.
- Validates source row/client/month/ref.
- Uses format and mode contracts.
- Produces review-gated `needs_review` briefs.

Findings:

- P1: Role-gated but not client-access gated.
- P2: Existing brief regeneration overwrites the same row and can destroy a prior approved brief version.

Suggested upgrades:

- Add client-aware access validation.
- Preserve prior approved versions or block unsafe in-place regeneration.

### `set-production-brief-mode`

Role:

- Explicit production-mode transition path.

Positive findings:

- Uses the shared production-mode contract.
- Requires `expected_updated_at` optimistic concurrency.
- Requires explicit acknowledgement before changing approved briefs or accepting human-only text conflict.

Findings:

- P1: Role-gated but not client-access gated.

Suggested upgrade:

- Verify caller access to `brief.client_id` before mode mutation.

### `send-production-brief-to-contractor`

Role:

- Assign an approved brief to a human contractor and send email.

Positive findings:

- Requires approved brief.
- Requires active contractor.
- Stores assignment state and failure state.
- Escapes HTML output.

Findings:

- P1: Role-gated but not client-access gated.
- P1: AI/newer-mode blocking is incomplete.
- P1: Silently overwrites `production_mode` to `human` on success/failure.
- P2: Resend request has no explicit timeout.

Suggested upgrades:

- Verify client access.
- Use shared mode contract for contractor eligibility.
- Preserve `production_mode`; only update assignment/production status.
- Add `AbortSignal.timeout` around Resend.

### `route-content-brief-to-studio`

Role:

- Route an approved canonical Content Brief into a `production_jobs` row.

Positive findings:

- Uses `validateIdeationAccess`.
- Enforces `brief.status === "approved"`.
- Writes only `production_jobs`.
- Validates supplied asset plan shape.

Findings:

- P1: `production_jobs.production_mode` contract is stale and rejects Stage 5E modes.
- P2: Idempotent replay can return a job for a previous approved brief on the same Content Item/studio.

Suggested upgrades:

- Align `production_jobs.production_mode` with the shared mode contract.
- Treat mismatched `existing.content_brief_id` as stale replay instead of returning it.

### `submit-production-review`

Role:

- Record production review decisions and checks.

Positive findings:

- Uses `validateIdeationAccess`.
- Validates asset belongs to the job.
- Computes CTA/proof checks server-side where data is available.

Findings:

- P2: Ignores lookup errors for data needed by server-computed checks.
- P2: Allows `approved` review decisions with failed or missing server-computed checks.
- P2: Does not update production/content state, matching current docs but leaving the path non-gating.

Suggested upgrades:

- Fail closed if server-computed checks cannot run.
- Gate `approved` decisions on passing server-computed checks unless explicit override is recorded.
- Document or implement the intended state transition semantics.

### `generate-ai-background-image`

Role:

- Submit an approved AI background prompt to OpenAI Batch.

Positive findings:

- Atomic RPC claim requires approved prompt, matching client, approved production brief, and matching approval-time fingerprint.
- Stores provider batch/input IDs and returns without waiting for bytes.
- On submission failure, marks row `failed`.

Findings:

- P1: Role-gated but not client-access gated.

Suggested upgrade:

- Verify caller access to the generation row's client before batch submission.

### `check-ai-background-image`

Role:

- Check OpenAI Batch result and store generated background image.

Positive findings:

- Does not resubmit generation.
- Running provider states return to `provider_submitted`.
- Terminal provider failures mark the row `failed`.
- Completed image uploads with `upsert: false`.

Findings:

- P1: Role-gated but not client-access gated.
- P2: A failed DB update after upload moves the row to failed and removes the uploaded file, but no explicit operator-facing reconciliation record is written if cleanup itself fails.

Suggested upgrades:

- Verify caller access to the generation row's client before checking provider state.
- Add an activity/audit log entry for cleanup failures if storage removal fails.

### `start-carousel-generation`

Role:

- Create persisted carousel/story generation jobs and prompt items.

Positive findings:

- Does no provider work.
- Requires approved production brief.
- Restricts to multi-image formats.
- Computes one prompt per slide/frame.
- Marks the brief `producing`.

Findings:

- P1: Role-gated but not client-access gated.
- P2: Uploaded visual input path is readability-checked but not ownership-checked.
- P2: On item insert failure, parent job rollback is attempted, but any rollback error is ignored.

Suggested upgrades:

- Verify client access to the brief.
- Validate uploaded input path ownership.
- Check rollback deletion result and return reconciliation detail if it fails.

### `generate-carousel-slide`

Role:

- Process exactly one queued multi-image job item.

Positive findings:

- Uses atomic item claim.
- Processes only one item per invocation.
- Supports retrying failed items.
- Relies on shared job processing for cleanup, finalization, and brief status.

Findings:

- P1: Role-gated but not client-access gated.
- P2: Does not verify caller access to the job's client before processing.

Suggested upgrade:

- Load job/client first and verify caller access before `retryFailedItems` or `processNextItem`.

### `regenerate-asset-frame`

Role:

- Regenerate one carousel slide/story frame as a new version.

Positive findings:

- Uses per-frame lock.
- Blocks partial-accepted/closed/cancelled groups.
- Inserts a new `client_assets` row and switches `is_current` through `persist_regenerated_asset_frame`.
- Preserves prompt/provenance metadata and records activity.

Findings:

- P1: Role-gated but not client-access gated.
- P2: Reused uploaded image path from metadata is downloaded without explicit ownership validation.

Suggested upgrades:

- Verify caller access to the asset's client before locking.
- Validate reused input paths against the asset/client ownership boundary.

### `generate-video-storyboard`

Role:

- Generate a Reel Studio storyboard from an approved Reel production brief and approved context.

Positive findings:

- Resolves an approved Reel brief through `resolveApprovedReelBrief`.
- Uses approved context files and approved execution files.
- Budgeted model calls avoid edge wall-clock overrun.
- Validates story strategy, continuity, shot sequence, compiled prompts, and critique/repair before insert.
- Avatar-led mode uses only the approved Avatar OS reference payload supplied to the video project.
- Atomic insert refuses non-empty storyboards.

Findings:

- P1: Role-gated but not client-access gated.

Suggested upgrade:

- Verify caller access to `project.client_id` before model calls.

### `generate-feed-post-asset`

Role:

- Shared single-image AI asset generation wrapper for feed posts.

Positive findings:

- Uses shared approved-brief gate.
- Stores generated assets as `needs_review`.
- Cleans up storage and asset rows on failure.

Findings:

- P1: Role-gated but not client-access gated.
- P2: Shared cleanup deletes `client_assets` by `asset_group_ref` only instead of also scoping by `client_id`/`production_brief_id`.

Suggested upgrades:

- Add client-access validation in the shared helper.
- Scope failure cleanup by client and brief as well as group ref.

### `generate-carousel-assets`

Role:

- Legacy sync wrapper for carousel asset generation.

Positive findings:

- Shared helper returns 410 for multi-image formats, directing callers to the persisted job path.

Findings:

- No additional function-specific findings beyond shared helper access concerns.

Suggested upgrade:

- Keep wrapper only as compatibility if deployed; ensure UI uses `start-carousel-generation` / `generate-carousel-slide`.

### `generate-story-assets`

Role:

- Legacy sync wrapper for story-sequence asset generation.

Positive findings:

- Shared helper returns 410 for multi-image formats, directing callers to the persisted job path.

Findings:

- No additional function-specific findings beyond shared helper access concerns.

Suggested upgrade:

- Keep wrapper only as compatibility if deployed; ensure UI uses `start-carousel-generation` / `generate-carousel-slide`.

### `generate-ad-static-asset`

Role:

- Shared single-image AI asset generation wrapper for static ads.

Positive findings:

- Uses shared approved-brief gate.
- Stores generated asset as `needs_review`.

Findings:

- P1: Role-gated but not client-access gated.
- P2: Shares the same cleanup scoping and uploaded input path ownership concerns as `generate-feed-post-asset`.

Suggested upgrades:

- Add client-access validation in the shared helper.
- Scope cleanup and visual input ownership checks.

### `process-asset-generation-jobs`

Role:

- Cron safety-net worker for multi-image jobs.

Positive findings:

- Requires `CRON_SECRET`.
- Requires `OPENAI_API_KEY`.
- Scans a bounded number of jobs and processes at most three items per run.
- Requeues stale processing items.
- Uses shared processor and DB RPCs for item claim/persist/finalize.

Findings:

- P2: Relies on prevalidated job rows and does not revalidate current brief approval/fingerprint per item.

Suggested upgrade:

- Store/verify a production brief fingerprint or explicitly document frozen job authority.

## 6. Provider / Failure Recovery Assessment

Positive findings:

- AI background generation is asynchronous and review-gated. `generate-ai-background-image` submits one OpenAI Batch request, and `check-ai-background-image` only checks stored provider IDs.
- AI background rows have terminal failure states and stale recovery documented.
- Multi-image carousel/story generation is split into persisted jobs/items, avoiding edge wall-clock failures.
- `process-asset-generation-jobs` is bounded by item count and time budget.
- `generate-video-storyboard` uses explicit model-call budgets and refuses to insert when validation or critique cannot complete safely.

Gaps:

- Client-aware access is uneven across service-role production functions.
- Current-brief/fingerprint authority is strong for AI backgrounds but weaker for multi-image asset jobs after job creation.
- Contractor handoff has no fetch timeout and can overwrite production mode during failure reconciliation.

## 7. Approved Authority / Review Gate Assessment

Confirmed:

- Phase 3 master/calendar outputs remain `needs_review`.
- Production brief generation uses approved Phase 1/2 authority and writes `needs_review`.
- AI image/asset generation requires approved production briefs.
- AI background generation requires an approved prompt and approval-time production brief fingerprint.
- Reel storyboard generation resolves an approved Reel brief and approved context.
- Asset outputs are stored as `needs_review`.

Not confirmed / gaps:

- `submit-production-review` records a review but does not itself enforce server-check pass/fail or advance content state.
- Multi-image job execution may continue from frozen prompts after the source production brief changes, unless that is accepted as intentional frozen-job semantics.
- Production brief regeneration does not preserve an immutable prior approved version.

## 8. Regression / Test Coverage Gaps

Recommended tests:

- Cross-client authorization denial for every row-ID based production function.
- `generate-phase-3` rejects unauthenticated/non-client callers before any service-role mutation.
- `generate-phase-3-slot` does not finalize when another item is `processing`.
- Concurrent scoped slot workers do not lose counters.
- `send-production-brief-to-contractor` blocks/handles every production mode correctly and never silently rewrites mode.
- `route-content-brief-to-studio` accepts the full Stage 5E production-mode set or fails with a clear contract error.
- `route-content-brief-to-studio` detects stale idempotent replay when a newer approved brief is routed.
- `submit-production-review` refuses approved decisions when server-computed checks fail or cannot be computed.
- Visual input image paths must belong to the same client/brief before use.
- Multi-image job worker behavior when the production brief changes after job creation.

## 9. Read-Only Outcome

No code, schema, configuration, deployment, database, storage, or function invocation changes were made during this audit.

The only intended repository change from this phase is this analysis document:

- `docs/edge-function-audits/phase-05-creation-production-assets.md`
