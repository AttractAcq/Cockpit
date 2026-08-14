# Edge Function Audit - Phase 06: Reel Studio and Video Handoff

Date: 2026-08-13
Mode: Read-only audit

## 1. Phase Scope

This phase audited the Reel Studio and video production handoff functions:

- `select-reel-production-strategy`
- `create-composition-contract`
- `update-composition-contract`
- `create-shot-source-asset-upload`
- `confirm-shot-source-asset-upload`
- `create-video-project`
- `update-video-project-status`
- `create-video-shot`
- `update-video-shot`
- `delete-video-shot`
- `regenerate-video-shot`
- `list-higgsfield-motions`
- `submit-shot-still-image`
- `check-shot-still-image`
- `submit-shot-generation`
- `check-shot-generation`
- `retry-shot-still-image`
- `retry-shot-video`
- `handoff-video-project`
- `create-final-reel-upload`
- `complete-final-reel-upload`
- `review-final-reel`

Primary UI/system areas:

- Reel Studio
- Video production handoff

Audit emphasis:

- Confirm Reel Studio remains a controlled AI video lane.
- Confirm shot retry paths preserve source assets.
- Confirm Higgsfield provider calls are guarded by state transitions.
- Confirm handoff requires approved/completed project state.
- Confirm final reel review and distribution draft creation are separated.

This audit did not invoke live functions and did not make source, schema, configuration, deployment, database, or storage changes.

## 2. Functions Audited

| Function | Role | Current posture |
| --- | --- | --- |
| `select-reel-production-strategy` | Selects and persists a deterministic production strategy for a Reel project. | Idempotent unless override is confirmed; role-gated, but not client-access gated. |
| `create-composition-contract` | Creates the edit/render composition contract from current shots. | Idempotent and server-owned; render mode validation is partly delegated to DB/update path. |
| `update-composition-contract` | Edits timeline/voice/audio/captions/CTA and transitions contract status. | Strong validation for `ready` and `rendered`; final Reel approval is required before `rendered`. |
| `create-shot-source-asset-upload` | Mints a signed upload URL for real source media attached to a shot. | Server-built storage path and size/mime validation; role-gated, but not client-access gated. |
| `confirm-shot-source-asset-upload` | Confirms source media landed before marking shot source as uploaded asset. | Verifies scoped path and storage object before mutation. |
| `create-video-project` | Creates a Reel Studio project, optionally bound to an approved `reel_video` production brief. | Strong brief/source eligibility and Avatar OS authority binding for `avatar_led`; role-gated, but not client-access gated. |
| `update-video-project-status` | Moves a Reel project through whitelisted lifecycle transitions. | Prevents generic `handed_off`; no client/project access check beyond row id. |
| `create-video-shot` | Adds one pending storyboard shot. | Uses shared shot planning contract; no client/project access check beyond row id. |
| `update-video-shot` | Edits pending shot planning fields and post-still motion fields. | Uses optimistic timestamp and status gates; no client/project access check beyond row id. |
| `delete-video-shot` | Deletes a pending, pre-generation shot. | Delegates atomic deletion to RPC with client/project/shot guards. |
| `regenerate-video-shot` | Regenerates one pending shot without changing its sequence role. | Strong project/shot/status gates and atomic RPC update. |
| `list-higgsfield-motions` | Staff-authenticated wrapper for Higgsfield motion catalog. | Server-side provider credential wrapper; no client data mutation. |
| `submit-shot-still-image` | Claims one pending shot and submits Higgsfield text-to-image. | Atomic shot-status claim; missing parent project lifecycle/access check. |
| `check-shot-still-image` | Polls Higgsfield still job, downloads still into storage, marks shot `still_complete`. | Single-shot poll, unknown provider statuses fail closed, storage object is retained locally. |
| `submit-shot-generation` | Claims one `still_complete` shot and submits Higgsfield image-to-video. | Requires stored still and motion fields; missing parent project lifecycle/access check. |
| `check-shot-generation` | Polls Higgsfield video job, downloads MP4 into storage, marks shot `complete`. | Single-shot poll, unknown provider statuses fail closed, storage object is retained locally. |
| `retry-shot-still-image` | Resets a failed still phase so the existing submit path can create one fresh job. | Reset-only; preserves planning and blocks video-state contamination. |
| `retry-shot-video` | Resets a failed video phase while preserving the stored still image. | Reset-only; preserves still/planning and optional deliberate motion update. |
| `handoff-video-project` | Converts an approved completed Reel Studio project into `client_assets` rows. | Correctly narrow gate, but multi-row handoff is not fully transactional. |
| `create-final-reel-upload` | Reserves a signed upload URL for an externally edited final Reel MP4. | Server-built path, version reservation RPC, replacement guards. |
| `complete-final-reel-upload` | Confirms final Reel object exists and promotes it to current version. | Confirm-before-trust storage check and atomic current-version RPC. |
| `review-final-reel` | Approves or returns the current final Reel for revision. | Separate final-deliverable review; approval does not publish. |

## 3. UI Page / System Role

Reel Studio project and shot operations:

- `src/lib/api.ts` invokes Reel Studio project, shot, Higgsfield, retry, handoff, final upload, and final review functions.
- `src/lib/reel-production.ts` invokes Stage J strategy, composition contract, and shot source upload functions.

Reel Studio production handoff:

- `handoff-video-project` is the only generic path that sets `video_projects.status = handed_off`.
- `update-video-project-status` explicitly excludes `handed_off` from its transition table.
- Final Reel upload/review is implemented on `video_project_deliverables`, not on shot clips in `client_assets`.

Configuration:

- Local `supabase/config.toml` only disables JWT verification for `collect-instagram-insights`.
- The audited Reel Studio functions rely on normal Supabase function JWT verification plus their own in-function bearer-token and staff-role checks.

## 4. Cross-Cutting Findings

### P1: Several service-role Reel Studio functions are role-gated but not client-access gated

Affected functions:

- `select-reel-production-strategy`
- `create-composition-contract`
- `update-composition-contract`
- `create-shot-source-asset-upload`
- `confirm-shot-source-asset-upload`
- `create-video-project`
- `update-video-project-status`
- `create-video-shot`
- `update-video-shot`
- `delete-video-shot`
- `regenerate-video-shot`
- `submit-shot-still-image`
- `check-shot-still-image`
- `submit-shot-generation`
- `check-shot-generation`
- `retry-shot-still-image`
- `retry-shot-video`
- `handoff-video-project`
- `create-final-reel-upload`
- `complete-final-reel-upload`
- `review-final-reel`

Positive context:

- These functions do require an authenticated user and a staff role.
- Most row mutations prove internal row relationships, such as project-to-client, shot-to-project, deliverable-to-project, or brief-to-source.
- The repo already has a stronger user-scoped access pattern in `validateIdeationAccess`, which checks the caller's client visibility before service-role work begins.

Issue:

- The functions use service-role queries after checking only `admin`, `account_manager`, or `editor` role.
- They do not consistently prove that the caller can access the specific client behind the project, shot, source asset, deliverable, or production brief.
- The row-id-only functions are the sharpest cases: `update-video-project-status`, `create-video-shot`, `update-video-shot`, `submit-shot-still-image`, `check-shot-still-image`, `submit-shot-generation`, `check-shot-generation`, and `handoff-video-project` can operate from only a project or shot id once staff role is present.

Why this matters:

- Service-role access bypasses RLS.
- If staff roles are narrower than global all-client access, a valid staff caller with a guessed row id could mutate another client's Reel Studio state.

Suggested upgrade:

- Add a shared client-access helper for Reel Studio functions, equivalent to the safer `validateIdeationAccess` pattern.
- For row-id-only functions, first resolve the row's `client_id`, then verify caller access to that client using the caller's JWT/RLS before continuing with service-role mutation.
- Add tests proving cross-client project, shot, and deliverable ids return 403 before provider calls, storage writes, or DB mutations.

### P1: `handoff-video-project` is not fully transactional

Affected function:

- `handoff-video-project`

Positive findings:

- Requires `video_projects.status = approved`.
- Requires every shot to be `complete` with `clip_url`.
- Requires a real approved `reel_video` production brief.
- Re-applies Reel Studio eligibility before writing produced assets.
- `update-video-project-status` cannot set `handed_off`, preserving handoff as the single intended path.

Issue:

- Handoff inserts one `client_assets` row per shot, updates the production brief to `produced`, archives prior asset groups, then updates the project to `handed_off`.
- On catch, it deletes only the newly inserted asset ids.
- If failure happens after the brief update or previous-asset archive but before project handoff, the catch path does not revert the brief or archive changes.

Why this matters:

- A partial failure can leave the production brief marked produced, older assets archived, and the project still not handed off.
- This would create an operator-visible contradiction that is hard to retry cleanly.

Suggested upgrade:

- Move the handoff write sequence into a single DB RPC transaction, including asset creation, prior asset archiving, brief status update, project status update, and activity logging.
- Keep the existing gates and output shape; this is a consistency fix, not a scope change.
- Add a failure-injection test proving no partial state remains if any step after the first asset insert fails.

### P1: Higgsfield submit functions do not verify parent project lifecycle before provider calls

Affected functions:

- `submit-shot-still-image`
- `submit-shot-generation`

Positive findings:

- `submit-shot-still-image` atomically claims only `pending` shots.
- `submit-shot-generation` atomically claims only `still_complete` shots.
- Retry functions explicitly require the parent project to be `storyboarding` or `generating`.
- `regenerate-video-shot` blocks after the project enters review.

Issue:

- The provider submit functions validate the shot status but do not load and validate the parent `video_projects.status`.
- A leftover `pending` or `still_complete` shot under a project that has already moved to `review`, `approved`, or `handed_off` could still be submitted to Higgsfield by staff with the shot id.

Why this matters:

- The audit objective requires provider calls to be guarded by state transitions.
- Shot-level status alone is not enough; project lifecycle is the controlling workflow state.

Suggested upgrade:

- Before claiming a shot for provider submission, load the parent project and require status `storyboarding` or `generating`.
- Keep polling/check functions able to finish already-submitted jobs, but prevent new provider submissions once project review has started.
- Add tests for submit attempts under `review`, `approved`, and `handed_off` projects.

### P2: Motion selection is only weakly validated before video submission

Affected functions/contracts:

- `create-video-shot`
- `update-video-shot`
- `retry-shot-video`
- `submit-shot-generation`
- `_shared/reel-studio-contract.ts`

Positive findings:

- The UI can retrieve Higgsfield motions through `list-higgsfield-motions`.
- `motion_strength` is bounded between `0` and `1`.
- `submit-shot-generation` requires both `motion_type` and `motion_strength` before calling DoP.

Issue:

- `validatePendingReelShot` accepts any non-empty `motion_type`.
- `submit-shot-generation` sends `motion_type` directly to Higgsfield as a motion id.
- A stale label, malformed value, or unknown id can make the shot fail after it has already been claimed for video submission.

Why this matters:

- This does not expand or contract Reel Studio's objective; it is a provider-call correctness guard.
- The function already treats motion as required; it should also ensure the value is plausibly provider-valid before claiming/submitting.

Suggested upgrade:

- At minimum, require `motion_type` to match UUID shape before storing/submitting.
- Prefer validating against a cached or freshly fetched Higgsfield motion catalog before the `still_complete -> submitted` claim.
- Add tests for malformed motion values and unknown ids.

### P2: Standalone projects reach a confusing handoff path

Affected function:

- `handoff-video-project`

Issue:

- If a standalone project has no `client_production_brief_id`, `organic_master_id`, or `ads_master_id`, the fallback source resolution treats it as `ads_master` with a null source row.
- That eventually fails, but not through a crisp "this project is not bound to a production brief/source" gate.

Why this matters:

- The original handoff objective is narrow: approved Reel Studio project plus real approved `reel_video` production brief.
- A standalone project should fail closed with a clear operator message before source-table inference.

Suggested upgrade:

- Add an explicit early gate: if no bound production brief and no source row id exists, return 409 with a clear `BRIEF_NOT_BOUND` / `SOURCE_NOT_BOUND` style message.
- Keep standalone projects manually operable elsewhere; do not auto-create briefs.

### P3: `create-composition-contract` relies on DB constraint errors for invalid render modes

Affected function:

- `create-composition-contract`

Positive findings:

- `update-composition-contract` validates render modes explicitly.
- `ready` status correctly rejects unsupported render modes.

Issue:

- `create-composition-contract` accepts `render_mode` from the body and inserts it directly.
- Invalid values fail via database constraint as an insert error instead of a controlled 422 validation response.

Suggested upgrade:

- Reuse the same render-mode allowlist used by `update-composition-contract` before insert.
- Preserve the current ability to create draft contracts in future/unsupported render modes only if they are known enum values.

### P3: Staff-role imports are inconsistent

Affected functions:

- `update-video-project-status`
- `list-higgsfield-motions`
- `check-shot-still-image`
- `submit-shot-generation`
- `check-shot-generation`
- `handoff-video-project`

Issue:

- Some functions import `STAFF_ROLES` from `_shared/ai-asset-generation.ts`; others import it from `_shared/staff-roles.ts`.
- The values currently match, so this is not a behavior bug today.

Suggested upgrade:

- Standardize on `_shared/staff-roles.ts` for Reel Studio function role checks.
- Keep provider/asset helpers separate from authorization constants to avoid future drift.

## 5. Positive Controls Confirmed

- Reel Studio remains a controlled video lane. It creates projects, shots, Higgsfield still/video jobs, shot clips, handoff assets, and final Reel deliverables; it does not publish.
- Shot retry paths are reset-only:
  - `retry-shot-still-image` clears failed still state and returns the shot to `pending`.
  - `retry-shot-video` preserves the stored still and returns the shot to `still_complete`.
  - Both rely on locked RPCs with expected timestamp checks.
- Higgsfield checks fail closed on unknown provider statuses and do not trust inbound webhook payloads.
- Generated provider media is copied into the private `video-assets` bucket instead of relying on Higgsfield CDN URLs.
- Source asset uploads use server-built storage paths and confirm-before-trust storage verification.
- Final Reel upload and review are separate from shot clip handoff:
  - Shot clips live as `client_assets`.
  - Final edited reels live as `video_project_deliverables`.
  - `review-final-reel` approval means publishable, not published.
- Final Reel distribution draft creation remains separated from this phase and is not performed by the audited functions.

## 6. Suggested Read-Only Follow-Up Tests

- Cross-client access tests for every Reel Studio mutation path, especially row-id-only project and shot functions.
- Provider submit lifecycle tests proving `submit-shot-still-image` and `submit-shot-generation` reject projects in `review`, `approved`, or `handed_off`.
- Handoff failure-injection test proving no partial brief/assets/project state survives a mid-sequence failure.
- Motion validation tests for malformed and unknown motion ids.
- Composition contract render-mode validation tests for invalid body values.

## 7. Audit Boundary

No live Supabase functions were invoked.
No migrations were run.
No source/config/schema/function/deployment/database/storage changes were made.
Only this audit document was added.
