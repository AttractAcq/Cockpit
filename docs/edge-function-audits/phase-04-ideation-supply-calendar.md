# Edge Function Audit - Phase 04: Ideation, Supply, Calendar, Content Items

Date: 2026-08-13
Mode: Read-only audit

## 1. Phase Scope

This phase audited the Ideation, Content Supply, Opportunity Pool, Calendar Planning, and Content Item / Brief functions:

- `ingest-content-source`
- `create-content-opportunity`
- `detect-input-conflicts`
- `resolve-input-conflict`
- `generate-content-opportunities`
- `score-content-opportunity`
- `update-content-opportunity-status`
- `run-ideation`
- `score-ideation-candidates`
- `create-ideation-calendar-proposal`
- `create-calendar-proposal`
- `update-calendar-proposal-slot`
- `approve-calendar-proposal`
- `commit-ideation-content`
- `generate-content-brief`
- `review-content-brief`

Primary UI/system areas:

- Ideation
- Content Supply
- Opportunity Pool
- Calendar Planning
- Content Items

Audit emphasis:

- Confirm Ideation source inputs are optional and provenance is preserved.
- Confirm approved authority is used, not draft authority.
- Confirm conflict detection is non-destructive until explicitly resolved.
- Confirm proposal approval and commit paths have authority-race protection.
- Confirm content brief generation remains review-gated.

This audit did not invoke live functions and did not make source, schema, configuration, deployment, database, or storage changes.

## 2. Functions Audited

| Function | Role | Current posture |
| --- | --- | --- |
| `ingest-content-source` | Canonical intake for Manual Ideas, Proof, Research Candidates, and Performance Insights. | Writes only `content_sources`, `manual_ideas`, `proof_items`; idempotent by source hash. |
| `create-content-opportunity` | Converts canonical sources into draft Content Opportunities. | Preserves source provenance in `content_opportunity_sources`; no calendar writes. |
| `detect-input-conflicts` | Deterministically creates review-queue conflict records. | Non-destructive; writes only `client_input_conflicts`. |
| `resolve-input-conflict` | Records operator conflict decisions. | Non-destructive; writes only conflict status/resolution fields. |
| `generate-content-opportunities` | AI-generates opportunity candidates from one canonical source. | Uses approved context excerpts and deterministic eligibility/dedup checks, then writes Opportunities. |
| `score-content-opportunity` | AI-scores one Opportunity against a server-side rubric. | Appends score history and updates denormalised score pointer. |
| `update-content-opportunity-status` | Applies human status actions to Opportunities. | Uses the canonical status transition table. |
| `run-ideation` | Runs the seven-technique research Ideation cycle. | Uses approved authority; optional strategic inputs include campaign/offer/avatar sources. |
| `score-ideation-candidates` | Scores generated Ideation candidates. | Reconstructs authority from cycle snapshot; server-derived idempotency. |
| `create-ideation-calendar-proposal` | Creates/edits/approves Ideation-specific calendar proposals. | Uses proposal snapshots, live calendar conflict digests, edit revision checks. |
| `create-calendar-proposal` | Creates canonical Content Calendar proposals from eligible Opportunities and open Slots. | Advisory until approved; `automatic` mode fails closed. |
| `update-calendar-proposal-slot` | Edits canonical proposal assignments. | Requires expected edit revision, preserves original placement provenance. |
| `approve-calendar-proposal` | Commits canonical Calendar proposals into Content Items. | Thin wrapper around atomic `commit_calendar_proposal` RPC. |
| `commit-ideation-content` | Commits approved Ideation proposals into operational legacy master/calendar rows. | Atomic RPC path with authority and calendar drift checks. |
| `generate-content-brief` | Generates structured Content Briefs for canonical Content Items. | Creates draft briefs; does not auto-approve. |
| `review-content-brief` | Human review actions for Content Briefs. | Enforces draft/in-review/approved lifecycle and proof gate. |

## 3. UI Page / System Role

Content Supply and Opportunity Pool:

- `src/lib/supply.ts` calls `ingest-content-source` for manual ideas and proof (`src/lib/supply.ts:163`, `src/lib/supply.ts:180`).
- `src/lib/supply.ts` calls `create-content-opportunity` (`src/lib/supply.ts:205`).
- `src/lib/supply.ts` calls conflict detection/review functions (`src/lib/supply.ts:268`, `src/lib/supply.ts:276`).
- `src/lib/supply.ts` calls Opportunity generation, scoring, and status updates (`src/lib/supply.ts:422`, `src/lib/supply.ts:432`, `src/lib/supply.ts:446`).

Canonical Calendar and Content Items:

- `src/lib/calendar-planning.ts` calls `create-calendar-proposal`, `update-calendar-proposal-slot`, and `approve-calendar-proposal` (`src/lib/calendar-planning.ts:40`, `src/lib/calendar-planning.ts:49`, `src/lib/calendar-planning.ts:61`).
- `src/lib/content-items.ts` reads Content Items/Briefs directly under RLS and sends writes through `generate-content-brief` / `review-content-brief` (`src/lib/content-items.ts:12`, `src/lib/content-items.ts:23`, `src/lib/content-items.ts:33`, `src/lib/content-items.ts:40`).

Research Ideation:

- `src/lib/api.ts` calls `run-ideation`, `score-ideation-candidates`, `create-ideation-calendar-proposal`, and `commit-ideation-content` (observed by repository search).
- Current operations docs explicitly state the Research/Ideation path is real but separate from the canonical Content Item spine (`docs/operations/architecture-guide.md:40`).

## 4. Function-by-Function Findings

### `ingest-content-source`

Role:

- Canonical source ingestion for four supply streams.
- Must not reach Calendar, Content Items, production, or distribution.

Positive findings:

- The function states and respects a narrow write boundary: `content_sources`, `manual_ideas`, and `proof_items` only (`supabase/functions/ingest-content-source/index.ts:1`).
- Uses `validateIdeationAccess` before service-role writes (`supabase/functions/ingest-content-source/index.ts:106`).
- Validates source kind, title, raw content, and adapter linkage before insert (`supabase/functions/ingest-content-source/index.ts:86`).
- Uses canonical duplicate identity: `client_id + raw_content_hash` (`supabase/functions/ingest-content-source/index.ts:114`).
- Newly created proof enters unverified and without consent, which fails closed for downstream proof use (`supabase/functions/ingest-content-source/index.ts:201`).
- The raw source mutation trigger makes `raw_content` and `client_id` immutable (`supabase/migrations/20260803021320_stage_e1_unified_source_contract.sql:49`).

Findings:

- P1: Caller-supplied adapter IDs are shape-validated but not ownership-validated before service-role insert. `proof_item_id`, `source_document_id`, `ideation_candidate_id`, and `performance_insight_id` are accepted into `content_sources` (`supabase/functions/ingest-content-source/index.ts:148`) after only `linkageValid` checks the kind/id combination (`supabase/functions/ingest-content-source/index.ts:53`). The database FKs point to target IDs but are not composite client-scoped FKs (`supabase/migrations/20260803021320_stage_e1_unified_source_contract.sql:16`). If an ID from another client is supplied, the function can persist cross-client provenance.
- P2: After creating a new `proof_items` row, the function updates `content_sources.proof_item_id` but does not inspect that update error (`supabase/functions/ingest-content-source/index.ts:211`). If that update fails, the proof row exists but the source pointer may remain null.

Suggested upgrades:

- Validate ownership for every supplied adapter ID before insertion.
- Check the proof pointer update result and roll back the source/proof pair if it fails.

### `create-content-opportunity`

Role:

- Convert one or more same-client content sources into a draft Content Opportunity.
- Preserve provenance; do not write calendar or production state.

Positive findings:

- Explicitly writes only Opportunity and Opportunity-source tables (`supabase/functions/create-content-opportunity/index.ts:1`).
- Validates all referenced sources exist and belong to the same client before insert (`supabase/functions/create-content-opportunity/index.ts:56`).
- Creates a source-to-opportunity provenance link for every source (`supabase/functions/create-content-opportunity/index.ts:104`).
- Deletes the Opportunity if provenance link insertion fails (`supabase/functions/create-content-opportunity/index.ts:110`).

Findings:

- P2: The duplicate lookup ignores lookup errors. The function checks `existing` but does not capture or handle an `error` from the `content_opportunity_sources` query (`supabase/functions/create-content-opportunity/index.ts:76`). If the lookup fails transiently, a duplicate Opportunity can be inserted instead of returning a controlled error.

Suggested upgrades:

- Capture and fail closed on the duplicate lookup error before inserting.

### `detect-input-conflicts`

Role:

- Deterministic, non-destructive conflict detection.
- Writes only `client_input_conflicts`.

Positive findings:

- Function comments and code keep the write boundary confined to `client_input_conflicts` (`supabase/functions/detect-input-conflicts/index.ts:1`).
- Uses `validateIdeationAccess` before service-role work (`supabase/functions/detect-input-conflicts/index.ts:22`).
- Does not mutate source inputs, context files, masters, calendar, or approvals.
- De-duplicates existing unresolved conflicts and preserves acknowledged conflicts (`supabase/functions/detect-input-conflicts/index.ts:45`).

Findings:

- P2: Secondary lookup errors are ignored. The function checks `inputsRes.error` only (`supabase/functions/detect-input-conflicts/index.ts:32`) and does not check `proofRes.error` or `openRes.error` from the same `Promise.all` (`supabase/functions/detect-input-conflicts/index.ts:27`). A proof lookup failure can create false proof-gap findings; an open-conflict lookup failure can duplicate existing unresolved conflicts.

Suggested upgrades:

- Fail closed on `proofRes.error` and `openRes.error`.
- Add a unique unresolved-conflict guard in the database if repeat scans can run concurrently.

### `resolve-input-conflict`

Role:

- Record an operator decision on an existing conflict.
- Do not edit underlying authority or source data.

Positive findings:

- Writes only conflict status/resolution fields (`supabase/functions/resolve-input-conflict/index.ts:1`).
- Requires a written reason for terminal decisions (`supabase/functions/resolve-input-conflict/index.ts:29`).
- Rejects already terminal conflicts before update (`supabase/functions/resolve-input-conflict/index.ts:50`).

Findings:

- P2: The update is not guarded by the status that was read. Two operators can read the same open conflict, then write conflicting terminal decisions because the update filters only by id (`supabase/functions/resolve-input-conflict/index.ts:66`).

Suggested upgrades:

- Add `.eq("status", conflict.status)` to the update and return a stale-state 409 if no row updates.

### `generate-content-opportunities`

Role:

- Generate 1-3 Opportunity candidates from one canonical source.
- Ground generation in approved context and deterministic eligibility/dedup checks.

Positive findings:

- Uses `validateIdeationAccess` and fails closed when AI generation is not configured (`supabase/functions/generate-content-opportunities/index.ts:70`, `supabase/functions/generate-content-opportunities/index.ts:73`).
- Requires the source to belong to the requested client (`supabase/functions/generate-content-opportunities/index.ts:79`).
- Loads approved context files only (`supabase/functions/generate-content-opportunities/index.ts:94`).
- The system prompt forbids invented facts and asks the model to flag unsupported claims (`supabase/functions/generate-content-opportunities/index.ts:31`).
- Deterministic eligibility checks block unsupported claims, missing proof/consent, blocking conflicts, and inactive client status (`supabase/functions/_shared/opportunity-intelligence.ts:212`).
- Every inserted Opportunity is linked back to its source; link failure deletes the Opportunity (`supabase/functions/generate-content-opportunities/index.ts:217`).

Findings:

- P1: The function ignores `contextRes.error`, `existingRes.error`, and `proofRes.error` after the parallel load (`supabase/functions/generate-content-opportunities/index.ts:91`). A context read failure silently becomes "no approved context files available" (`supabase/functions/generate-content-opportunities/index.ts:128`), and an existing-opportunity read failure silently removes deduplication data (`supabase/functions/generate-content-opportunities/index.ts:120`).

Suggested upgrades:

- Fail closed on context, existing-opportunity, and proof lookup errors before calling the model.
- Add tests proving lookup failures do not lead to provider calls or inserts.

### `score-content-opportunity`

Role:

- Score one eligible Opportunity and append score history.
- Compute the overall score server-side.

Positive findings:

- Blocks ineligible, rejected, and expired Opportunities (`supabase/functions/score-content-opportunity/index.ts:111`).
- Loads approved context files only (`supabase/functions/score-content-opportunity/index.ts:118`).
- Ignores any model-supplied overall score and computes the score server-side (`supabase/functions/score-content-opportunity/index.ts:160`).
- Appends score history before updating the denormalised Opportunity pointer (`supabase/functions/score-content-opportunity/index.ts:171`).

Findings:

- P2: The approved-context lookup does not capture or check `error` (`supabase/functions/score-content-opportunity/index.ts:118`). If that read fails, scoring proceeds with no approved context.
- P2: The score-history insert and Opportunity pointer update are not atomic (`supabase/functions/score-content-opportunity/index.ts:171`, `supabase/functions/score-content-opportunity/index.ts:190`). If the pointer update fails, an append-only score row exists but `content_opportunities.score` remains stale.

Suggested upgrades:

- Fail closed on context lookup errors.
- Move score insert plus pointer update into an RPC transaction, or mark pointer update failure as recoverable with a reconciliation job/test.

### `update-content-opportunity-status`

Role:

- Apply human control actions to the Opportunity status lifecycle.

Positive findings:

- Validates action names and source/target client ownership (`supabase/functions/update-content-opportunity-status/index.ts:40`, `supabase/functions/update-content-opportunity-status/index.ts:49`).
- Uses the canonical transition table instead of writing arbitrary statuses (`supabase/functions/update-content-opportunity-status/index.ts:61`).
- Reject and merge require explicit control data where needed (`supabase/functions/update-content-opportunity-status/index.ts:78`, `supabase/functions/update-content-opportunity-status/index.ts:110`).

Findings:

- P2: Status updates are not guarded by the status that was read. Example: shortlist/select updates filter only by id (`supabase/functions/update-content-opportunity-status/index.ts:72`). Concurrent actions can validate from the same stale state and then overwrite each other.

Suggested upgrades:

- Require an expected current status or updated-at token from the caller, or add `.eq("status", currentStatus)` to each update.

### `run-ideation`

Role:

- Generate research candidates through the seven Ideation techniques.
- Treat Campaign Intelligence, Offers, and Avatar OS as optional strategic inputs rather than mandatory linear drivers.

Positive findings:

- Auth, client id validation, idempotency, quantity planning, and provider configuration checks occur before run creation (`supabase/functions/run-ideation/handler.ts:399`, `supabase/functions/run-ideation/handler.ts:409`, `supabase/functions/run-ideation/handler.ts:413`).
- Authority is loaded and validated before generation (`supabase/functions/run-ideation/handler.ts:427`).
- Optional strategic inputs default to Campaign Intelligence, Main Offer, Seasonal Offer, and Avatar but are still stored as an Ideation Hub input snapshot, not mandatory pipeline control (`supabase/functions/run-ideation/handler.ts:464`).
- Tests assert Avatar strategic input remains optional (`tests/ideation-stage4c.test.ts:51`).

Findings:

- No role/objective drift found in read-only inspection. The function remains a research Ideation generator, not an offer generator, campaign generator, or content committer.

Suggested upgrades:

- Keep tests around optional strategic-input provenance as new source kinds are added.

### `score-ideation-candidates`

Role:

- Score completed Ideation candidates from a prior cycle.

Positive findings:

- Reconstructs authority from the cycle configuration snapshot and approved authority rows before scoring (`supabase/functions/score-ideation-candidates/handler.ts:321`).
- Uses server-derived idempotency based on immutable configuration and predecessor identity (`supabase/functions/score-ideation-candidates/handler.ts:351`).
- Does not import or execute proposal/commit modules, preserving stage separation; tests assert this separation in the Ideation suite.

Findings:

- No major logic/configuration issue found in read-only inspection.

Suggested upgrades:

- Continue keeping scoring independent from proposal/commit modules.

### `create-ideation-calendar-proposal`

Role:

- Create, edit, refresh, and approve Ideation-specific calendar proposals.

Positive findings:

- Edit/refresh/approval actions require `expected_edit_revision` (`supabase/functions/create-ideation-calendar-proposal/handler.ts:321`).
- Approval re-reads the live calendar, compares the current calendar digest, and passes the expected revision into the approval RPC (`supabase/functions/create-ideation-calendar-proposal/handler.ts:336`, `supabase/functions/create-ideation-calendar-proposal/handler.ts:370`).
- Generation stores configuration, authority, candidate, scoring, slot, and calendar-conflict snapshots (`supabase/functions/create-ideation-calendar-proposal/handler.ts:571`).
- Idempotency is server-derived from cycle/scoring/configuration (`supabase/functions/create-ideation-calendar-proposal/handler.ts:554`).

Findings:

- No major role/objective drift found. This function is still an Ideation proposal function, not a canonical Content Item commit function.

Suggested upgrades:

- Keep the live-calendar digest check in any future proposal approval changes.

### `create-calendar-proposal`

Role:

- Generate canonical Calendar proposals by matching eligible Opportunities to open operational Slots.
- Advisory only until approved.

Positive findings:

- Explicitly does not touch Content Items, Calendar Slot status, or Opportunity status (`supabase/functions/create-calendar-proposal/index.ts:1`).
- Fails closed on `automatic` mode because no client policy configuration exists yet (`supabase/functions/create-calendar-proposal/index.ts:34`).
- Uses only open, operational slots (`supabase/functions/create-calendar-proposal/index.ts:49`).
- Checks all lookup errors in the main Slot/Requirement/Opportunity/Score/Claimed loads (`supabase/functions/create-calendar-proposal/index.ts:58`, `supabase/functions/create-calendar-proposal/index.ts:89`).

Findings:

- P2: The function comment says it matches "eligible, scored Content Opportunity" rows (`supabase/functions/create-calendar-proposal/index.ts:1`), but the candidate query does not require a score row or `content_opportunities.score` value (`supabase/functions/create-calendar-proposal/index.ts:73`). In `_shared/calendar-planning.ts`, unscored Opportunities can still clear `MIN_MATCH_SCORE` because missing proof strength defaults to `0` but all other dimensions still score (`supabase/functions/_shared/calendar-planning.ts:92`, `supabase/functions/_shared/calendar-planning.ts:188`).

Suggested upgrades:

- Filter candidate Opportunities to rows with a current score or at least one score-history row before assisted matching.

### `update-calendar-proposal-slot`

Role:

- Move, swap, remove, or restore assignments inside a draft canonical Calendar proposal.

Positive findings:

- Requires a numeric expected edit revision (`supabase/functions/update-calendar-proposal-slot/index.ts:36`).
- Rejects non-draft proposals and stale revisions at preflight (`supabase/functions/update-calendar-proposal-slot/index.ts:51`).
- Preserves original model placement for restore (`supabase/functions/update-calendar-proposal-slot/index.ts:1`).
- Checks moved/restored Opportunities still belong to the client and are not already committed (`supabase/functions/update-calendar-proposal-slot/index.ts:86`).

Findings:

- P1: The expected-revision check is not atomic with the slot updates and proposal revision increment. The function reads `edit_revision`, checks it in application code, writes slot rows, then updates the proposal by id only (`supabase/functions/update-calendar-proposal-slot/index.ts:54`, `supabase/functions/update-calendar-proposal-slot/index.ts:104`, `supabase/functions/update-calendar-proposal-slot/index.ts:116`). Two concurrent edits can both pass the same revision check and cause lost updates.

Suggested upgrades:

- Move canonical proposal edits into a transactional RPC, or make the final proposal update conditional on `.eq("edit_revision", expectedRevision)` and roll back/repair slot edits if the revision update loses the race.

### `approve-calendar-proposal`

Role:

- Commit a draft canonical Calendar proposal into Content Items.

Positive findings:

- Requires `expected_edit_revision` in the request (`supabase/functions/approve-calendar-proposal/index.ts:24`).
- Delegates operational writes to the atomic `commit_calendar_proposal` RPC (`supabase/functions/approve-calendar-proposal/index.ts:39`).
- The RPC locks the proposal row, rejects stale revisions, validates every assigned slot before writing, inserts Content Items, fills slots, advances Opportunity status, and marks the proposal approved in one transaction (`supabase/migrations/20260808013816_stage_g_calendar_planning.sql:180`).
- Unique indexes prevent duplicate slot/opportunity/proposal-slot commitment (`supabase/migrations/20260808013816_stage_g_calendar_planning.sql:123`).

Findings:

- No major approval-race issue found in the canonical commit path. The main edit-race issue is upstream in `update-calendar-proposal-slot`.

Suggested upgrades:

- Keep this function thin; hardening belongs in the RPC and edit function.

### `commit-ideation-content`

Role:

- Commit an approved Ideation proposal into operational content/calendar records.

Positive findings:

- Explicit `confirm_commit: true` is required (`supabase/functions/commit-ideation-content/handler.ts:322`).
- Requires expected edit revision (`supabase/functions/commit-ideation-content/handler.ts:309`).
- Recomputes live calendar digest before commit (`supabase/functions/commit-ideation-content/handler.ts:382`).
- Preflight verifies recorded authority; the Stage 5 migration then locks recorded authority rows and recomputes content hashes inside the transaction (`supabase/functions/commit-ideation-content/index.ts:138`, `supabase/migrations/20260731000041_ideation_stage5_authority_race.sql:139`).
- The commit RPC locks the proposal row, validates proposal/cycle/scoring completeness, rejects stale calendar and authority, then inserts operational records in one transaction (`supabase/migrations/20260731000041_ideation_stage5_authority_race.sql:72`).

Findings:

- Architecture note, not counted as a function defect: this path intentionally writes into `organic_master`, `story_master`, and `calendar_cells`, not the canonical `content_items` / `calendar_slots` spine (`supabase/migrations/20260731000041_ideation_stage5_authority_race.sql:303`, `supabase/migrations/20260731000041_ideation_stage5_authority_race.sql:315`, `supabase/migrations/20260731000041_ideation_stage5_authority_race.sql:336`). The operations guide already documents this as a deliberate parallel pipeline (`docs/operations/architecture-guide.md:43`). Re-pointing it would be a product/architecture decision, not a read-only audit fix.

Suggested upgrades:

- No logic fix suggested inside this phase. Keep the documented split visible until a separate migration/cutover project is authorized.

### `generate-content-brief`

Role:

- Generate a review-gated structured Content Brief for a canonical Content Item.

Positive findings:

- Uses `validateIdeationAccess` and fails closed if AI generation is disabled (`supabase/functions/generate-content-brief/index.ts:89`, `supabase/functions/generate-content-brief/index.ts:92`).
- Verifies the Content Item belongs to the client (`supabase/functions/generate-content-brief/index.ts:98`).
- Loads linked Opportunity, Calendar Slot, existing Briefs, approved context, and verified proof excerpts (`supabase/functions/generate-content-brief/index.ts:107`).
- Inserts new briefs as `draft`, not `approved` (`supabase/functions/generate-content-brief/index.ts:176`).
- Links verified proof provenance into `content_item_proof` (`supabase/functions/generate-content-brief/index.ts:200`).

Findings:

- P1: Re-generation supersedes the previous approved brief before the replacement insert succeeds (`supabase/functions/generate-content-brief/index.ts:169`). If the later insert or pointer update fails (`supabase/functions/generate-content-brief/index.ts:176`, `supabase/functions/generate-content-brief/index.ts:194`), the existing approved brief can be left demoted to `superseded` without a usable replacement.
- P1: Approved context and proof-provenance lookup errors are ignored. The function checks Opportunity, Slot, and existing-Brief errors (`supabase/functions/generate-content-brief/index.ts:121`) but not `contextRes.error`; later source-link and verified-proof queries also ignore errors (`supabase/functions/generate-content-brief/index.ts:128`, `supabase/functions/generate-content-brief/index.ts:134`, `supabase/functions/generate-content-brief/index.ts:202`). This can generate with missing context/proof provenance when reads fail.

Suggested upgrades:

- Move supersede/insert/pointer/provenance work into a single RPC transaction, or insert the new draft successfully before superseding any approved brief.
- Fail closed on approved-context, source-link, and verified-proof lookup errors before provider generation or persistence.

### `review-content-brief`

Role:

- Submit, approve, or request changes for a structured Content Brief.

Positive findings:

- Enforces the current four-state Brief lifecycle: `draft -> in_review -> approved`, with request-changes returning to `draft` (`supabase/functions/review-content-brief/index.ts:44`).
- Approval checks verified proof count when the structured brief says proof is required (`supabase/functions/review-content-brief/index.ts:63`).
- Approval writes `approved_by` and `approved_at` together (`supabase/functions/review-content-brief/index.ts:76`).

Findings:

- P2: Review transitions update by brief id only, not by the status that was read (`supabase/functions/review-content-brief/index.ts:46`, `supabase/functions/review-content-brief/index.ts:54`, `supabase/functions/review-content-brief/index.ts:76`). Concurrent review actions can overwrite each other.
- P2: Approval does not verify that the brief is the Content Item's current brief. Since regeneration can leave old draft/in-review versions around, an older in-review brief can still be approved after a newer current draft exists (`supabase/functions/review-content-brief/index.ts:35`).

Suggested upgrades:

- Add status-conditional updates for all review actions.
- On approval, verify `content_items.current_content_brief_id = content_brief_id` before approving.

## 5. Configuration Checklist

| Check | Status |
| --- | --- |
| Expected caller | UI via `src/lib/supply.ts`, `src/lib/api.ts`, `src/lib/calendar-planning.ts`, and `src/lib/content-items.ts`. |
| Public/private posture | Private operator functions; require authenticated staff token plus service-role backend. |
| Auth verification | All audited functions use `validateIdeationAccess`. |
| Service-role usage | All audited functions use `svc()` for DB reads/writes after authorization. |
| CORS handling | All audited functions handle `OPTIONS`; shared CORS advertises `POST, GET, OPTIONS`. |
| Allowed HTTP methods | Audited functions reject non-POST methods after OPTIONS. |
| Request body validation | Basic validation exists; several ownership/expected-state validations need hardening as noted above. |
| Idempotency | Strong in research Ideation run/scoring/proposal/commit paths; weaker lookup-before-insert pattern in canonical supply/opportunity paths. |
| Retry behaviour | Research Ideation uses leased/idempotent run patterns. Canonical supply/calendar functions are action endpoints, not long-running retry workflows. |
| Timeout/provider handling | Provider-backed functions fail closed on missing AI config and provider errors. |
| Error responses | Mostly structured JSON; several secondary read errors are ignored in canonical supply/brief functions. |
| Audit logging | Most state-changing endpoints write audit/activity events. |
| Secrets/env vars | Supabase URL/service-role/anon key required; Anthropic required for generation/scoring functions. |
| Database writes | Writes source, conflict, Opportunity, score, proposal, Content Item, Brief, Ideation cycle/scoring/proposal/commit tables. |
| Storage writes | None in this phase's audited functions. |
| RLS assumptions | Service-role writes bypass RLS; function-level auth and explicit ownership checks are critical. |
| Function-to-function calls | No direct Edge Function chaining observed; commit wrappers delegate to SQL RPCs. |
| Tests | Good coverage for Ideation research/scoring/proposal/commit and pure content-brief/calendar helpers; thinner coverage for canonical supply endpoint failure paths. |
| Orphaned status | All audited functions appear to have frontend callers or are part of documented Research/Ideation workflow. |

## 6. Security / Auth / RLS Notes

- `validateIdeationAccess` requires a bearer token, validates the Supabase user, requires an Ideation staff role, and checks client visibility through caller-scoped RLS before service-role work starts (`supabase/functions/_shared/ideation/auth.ts:11`).
- The highest security concern in this phase is cross-client provenance linking in `ingest-content-source`, because service-role insertion bypasses RLS and the database FKs are not client-scoped.
- The Research/Ideation commit path has strong authority-race protection after the Stage 5 migration: authority rows are locked and content hashes are recomputed inside the transaction.
- The canonical Calendar approval path has strong atomicity through `commit_calendar_proposal`; the edit endpoint preceding it needs stronger concurrency control.

## 7. Secrets / Environment Variables Required

Required by all audited functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` indirectly through `validateIdeationAccess`

Required by provider-backed functions:

- Anthropic configuration for:
  - `generate-content-opportunities`
  - `score-content-opportunity`
  - `run-ideation`
  - `score-ideation-candidates`
  - `create-ideation-calendar-proposal`
  - `generate-content-brief`

Not used by this phase's audited functions:

- OpenAI media keys
- Higgsfield keys
- Storage provider keys
- Meta/advertising credentials

## 8. Database Tables / Storage Buckets Touched

Content Supply / Opportunity:

- `content_sources`
- `manual_ideas`
- `proof_items`
- `client_input_conflicts`
- `content_opportunities`
- `content_opportunity_sources`
- `content_opportunity_scores`
- `audit_log`

Research Ideation:

- `client_ideation_cycles`
- `client_ideation_candidates`
- `client_ideation_candidate_scores`
- `client_ideation_scoring_runs`
- `client_ideation_calendar_proposals`
- `client_ideation_calendar_proposal_slots`
- `client_ideation_commit_runs`
- `client_ideation_commit_items`
- `client_ideation_authority_inputs`
- `organic_master`
- `story_master`
- `calendar_cells`
- `activity_log`

Canonical Calendar / Content Items:

- `calendar_slots`
- `content_calendar_proposals`
- `content_calendar_proposal_slots`
- `content_items`
- `content_item_sources`
- `content_briefs`
- `content_item_proof`
- `content_item_legacy_projections`
- `audit_log`

Storage:

- No storage buckets are written by this phase's audited functions.

## 9. Error Handling / Retry / Idempotency Notes

- Research Ideation has the strongest idempotency posture: run/scoring/proposal/commit identities are either caller-provided with conflict checks or server-derived from immutable snapshots.
- Canonical Calendar approval is atomic inside `commit_calendar_proposal`.
- Canonical proposal editing is not currently atomic around expected edit revision.
- Canonical Opportunity generation/scoring and Content Brief generation have several unchecked secondary read errors.
- Source ingestion and Opportunity creation use lookup-before-insert idempotency; source ingestion handles duplicate insert races, while `create-content-opportunity` does not visibly handle duplicate lookup errors.

## 10. CORS / Method / Input Validation Notes

- All audited functions support `OPTIONS`.
- All audited functions reject non-POST requests after `OPTIONS`.
- Shared CORS advertises `GET` for functions that reject `GET` (`supabase/functions/_shared/aa.ts:16`). This is not a direct bypass but is broader than the actual method contract.
- UUID validation is stronger in the Research/Ideation handlers than in several canonical supply endpoints, which mostly rely on database lookup failure.
- Adapter ID ownership validation is the main missing input validation in `ingest-content-source`.

## 11. Frontend Caller Mapping

| Function | Frontend caller |
| --- | --- |
| `ingest-content-source` | `src/lib/supply.ts`, used by Content Supply UI. |
| `create-content-opportunity` | `src/lib/supply.ts`, used by Content Supply/Opportunity UI. |
| `detect-input-conflicts` | `src/lib/supply.ts`. |
| `resolve-input-conflict` | `src/lib/supply.ts`. |
| `generate-content-opportunities` | `src/lib/supply.ts`. |
| `score-content-opportunity` | `src/lib/supply.ts`. |
| `update-content-opportunity-status` | `src/lib/supply.ts`. |
| `run-ideation` | `src/lib/api.ts`, used by Ideation UI. |
| `score-ideation-candidates` | `src/lib/api.ts`, used by Ideation UI. |
| `create-ideation-calendar-proposal` | `src/lib/api.ts`, used by Ideation UI. |
| `commit-ideation-content` | `src/lib/api.ts`, used by Ideation UI. |
| `create-calendar-proposal` | `src/lib/calendar-planning.ts`. |
| `update-calendar-proposal-slot` | `src/lib/calendar-planning.ts`. |
| `approve-calendar-proposal` | `src/lib/calendar-planning.ts`. |
| `generate-content-brief` | `src/lib/content-items.ts`. |
| `review-content-brief` | `src/lib/content-items.ts`. |

## 12. Tests / Existing Coverage

Observed tests:

- `tests/run-ideation-handler.test.ts`
- `tests/score-ideation-candidates-handler.test.ts`
- `tests/create-ideation-calendar-proposal-handler.test.ts`
- `tests/commit-ideation-content-handler.test.ts`
- `tests/ideation-pr1.test.ts`
- `tests/ideation-stage2.test.ts`
- `tests/ideation-stage3.test.ts`
- `tests/ideation-stage4.test.ts`
- `tests/ideation-stage4c.test.ts`
- `tests/avatar-os-stage5e-ideation.test.ts`
- `tests/calendar-planning.test.ts`
- `tests/content-brief.test.ts`

Coverage strengths:

- Ideation stage separation, authority reconstruction, idempotency, proposal approval, and commit-race behavior are covered by handler/pure tests.
- Calendar matching and proposal edit pure logic are covered.
- Content Brief schema validation, Markdown rendering, and proof gate logic are covered.
- Optional Avatar OS input into Ideation is tested.

Coverage gaps:

- No endpoint-level tests were found for canonical supply functions catching ignored secondary lookup errors.
- No test catches cross-client adapter IDs in `ingest-content-source`.
- No test catches unscored Opportunities being eligible for assisted canonical calendar proposals.
- No test catches non-atomic canonical proposal edit revision races.
- No test catches `generate-content-brief` superseding an approved brief before replacement persistence succeeds.
- No test catches approving a non-current Content Brief version.

## 13. Suggested Upgrades

Correctness-only upgrades, preserving original function roles:

1. Add client ownership validation for all `ingest-content-source` adapter IDs.
2. Fail closed on unchecked secondary read errors in:
   - `detect-input-conflicts`
   - `create-content-opportunity`
   - `generate-content-opportunities`
   - `score-content-opportunity`
   - `generate-content-brief`
3. Make `generate-content-brief` regeneration non-destructive by inserting the replacement before superseding the existing approved version, preferably in one RPC transaction.
4. Make canonical proposal slot edits atomic around `expected_edit_revision`.
5. Add expected-state guards to:
   - `resolve-input-conflict`
   - `update-content-opportunity-status`
   - `review-content-brief`
6. Require canonical assisted Calendar proposals to use scored Opportunities only.
7. Require `review-content-brief` approval to target the current Content Item brief.
8. Add focused endpoint tests for the failure/race cases listed in the coverage gaps.

## 14. Open Questions

- Should canonical supply endpoints adopt the stricter UUID/body validation style used by Research Ideation handlers?
- Should Research/Ideation eventually create canonical `content_opportunities` / `content_items`, or should it remain deliberately legacy-master-backed until a separate migration project is authorized?
- Should Content Item status advancement be implemented before any further canonical pipeline rollout? Current operations docs already identify this as a blocking migration issue.
- Should canonical proposal edits be moved into Postgres RPCs the same way approval/commit already is?

## 15. Overall Phase Risk Rating

Risk rating: Medium-High

Rationale:

- The Research/Ideation path is strong: authority snapshots, optional strategic inputs, idempotency, proposal approval, and commit race protection are well designed and documented.
- The canonical Calendar approval RPC is also strong and correctly atomic.
- The canonical supply/opportunity/brief path has several smaller but real fail-open or sequencing issues: unchecked secondary reads, cross-client adapter ID risk, non-atomic proposal edits, and destructive brief regeneration order.
- Content Brief generation remains review-gated, but the current regeneration sequence can demote an existing approved brief before the replacement is safely persisted.
- The parallel Research/Ideation and canonical content pipelines are documented and intentional today, but remain an operational integration risk for future convergence.
