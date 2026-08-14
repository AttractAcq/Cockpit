# Edge Function Audit Phase 01 - Context, Execution Setup, Source Ingestion, Destructive Planning

Date: 2026-08-13
Mode: Read-only source audit, except for this analysis document.
Scope source: `docs/EDGE_FUNCTION_AUDIT_10_PHASE_PLAN.md`

## Read-Only Confirmation

This phase did not modify source code, Supabase functions, migrations, runtime configuration, schemas, or tests. No edge functions were invoked, deployed, expanded, contracted, renamed, or refactored. The only repository write was this audit document.

The audit standard was: confirm each function is configured and implemented according to its existing role, then identify logic errors, unsafe state transitions, missing guards, retry/idempotency gaps, or observability gaps. Suggested upgrades below are correctness-only and do not change the original function objectives.

## Functions Audited

| Function | UI/system area | Intended role | Assessment |
| --- | --- | --- | --- |
| `generate-phase-1` | Context | Prepare split Phase 1 generation and return the canonical 21-file manifest. | Mostly aligned. Older auth model relies on platform JWT/config plus service role. |
| `generate-phase-1-file` | Context | Generate one context file, validate structured output/citations, store non-approved draft/review state. | Aligned, with a traceability warning path that is not fully fail-closed. |
| `finalize-phase-1` | Context | Verify all 21 context rows exist, then mark Phase 1 complete. | Function matches frozen baseline, but stage completion can be misleading when files still need client input. |
| `generate-phase-2` | Execution Markdown | Prepare, generate each monthly execution file, finalize the 11-file pack. | Strong upstream approval gate; generated completion is separate from human approval but status naming is ambiguous. |
| `validate-execution-pack` | Execution contract | Deterministically validate Phase 2 execution files and Phase 3 master/calendar packs. | Aligned. It validates generation contract, not approval readiness. |
| `generate-execution-config` | Execution config | Derive a structured execution config from approved execution Markdown; write non-approved config/checks. | Strongly aligned. Uses approved Markdown only, reconciles, idempotent by content/source hash. |
| `approve-execution-config` | Execution config | Human-gated approval of structured config; derive operational requirements/slots. | Strongly aligned. Auth, reconciliation, DB approval check, idempotent derivation are present. |
| `record-context-file-provenance` | Context provenance | Rebuild derived provenance rows for a context file without touching approved inferences. | Aligned. Narrow and human-inference-safe. |
| `register-source-document` | Source ingestion | Register text/url/storage source rows as pending, deduped by content hash. | Aligned. Narrow and non-mutating to authority. |
| `process-source-document` | Source ingestion | Extract/chunk text into deterministic document chunks with recoverable failures. | Mostly aligned. Retryable, but concurrent processing is not explicitly locked. |
| `plan-destructive` | Destructive lifecycle | Build and persist dry-run destructive-operation plan. | Aligned with planning role, but source still carries `HELD` deployment warning. |
| `execute-destructive` | Destructive lifecycle | Execute a planned destructive operation after re-deriving the plan. | Aligned with staged execution, but storage-before-DB recovery risk needs an explicit runbook/test. |

## Key Findings

### P1 - `finalize-phase-1` marks `stage1_status = complete` while allowing `needs_client_input`

Evidence:
- `finalize-phase-1` treats `needs_review`, `needs_client_input`, and `approved` as acceptable statuses: `supabase/functions/finalize-phase-1/index.ts:37`.
- It then updates `clients.stage1_status` to `complete`: `supabase/functions/finalize-phase-1/index.ts:141`.
- The frozen baseline says approval remains a separate human boundary: `docs/AA_PHASE_1_PHASE_2_FROZEN_BASELINE.md:75`.

Impact:
- Downstream Phase 2 is still protected because `generate-phase-2` requires all 21 context files to be approved: `supabase/functions/generate-phase-2/index.ts:63`.
- However, the client-level `stage1_status = complete` can mislead the UI/operator when files still contain unresolved client-input gaps. This is a correctness/semantics risk, not an authority bypass.

Suggested correctness-only upgrade:
- Keep the function objective unchanged, but make the state explicit: either avoid `complete` when any file is `needs_client_input`, or add a distinct completion/gap flag that the UI cannot interpret as execution-ready authority.

### P1 - `generate-phase-2` finalizes generated execution files before human approval

Evidence:
- Section generation writes `status: "draft"` and `review_state: "needs_review"`: `supabase/functions/generate-phase-2/index.ts:229`.
- Finalize validates file presence/content and then sets `clients.stage2_status = "complete"`: `supabase/functions/generate-phase-2/index.ts:256`.
- `validate-execution-pack` allows `needs_review` as a valid execution-file review state during `execution_files` validation: `supabase/functions/validate-execution-pack/index.ts:14`.
- `generate-execution-config`, the later structured authority step, reads only `review_state = "approved"` execution files: `supabase/functions/generate-execution-config/index.ts:89`.

Impact:
- The approval boundary is preserved for structured/operational execution config.
- The risk is operator/state ambiguity: `stage2_status = complete` can mean "all 11 files generated and validated", not "all 11 execution files approved."

Suggested correctness-only upgrade:
- Preserve function scope, but clarify the status model or UI copy so "complete" cannot be mistaken for approved execution authority. A low-risk option is to expose generated-vs-approved counts wherever `stage2_status` is rendered.

### P2 - `generate-phase-1-file` downgrades provenance write failures to warnings after saving the file

Evidence:
- The generator validates structured output and citations before writing: `supabase/functions/generate-phase-1-file/index.ts:688`.
- After upsert, citation/playbook recording failures are appended to warnings, not treated as a failed generation: `supabase/functions/generate-phase-1-file/index.ts:729`.
- The comment acknowledges the consequence: "the file is not traceable without it": `supabase/functions/generate-phase-1-file/index.ts:731`.
- The success response still returns `ok: true`: `supabase/functions/generate-phase-1-file/index.ts:803`.

Impact:
- A context file can be saved as valid but lack persisted traceability if citation/playbook writes fail. That conflicts with the broader "source citations remain traceable" goal covered by tests in `tests/phase1-intelligence.test.ts` and `tests/citation-validation.test.ts`.

Suggested correctness-only upgrade:
- Keep the same generation objective, but fail closed or mark the row non-authoritative when provenance cannot be persisted. If preserving successful writes is preferred, add a machine-readable `provenance_status`/blocking warning that prevents finalization or approval until repaired.

### P2 - `process-source-document` has no explicit concurrent claim guard

Evidence:
- The function loads the document, then updates `processing_status = "extracting"` and increments `attempt_count`: `supabase/functions/process-source-document/index.ts:59`.
- The update does not include a status/attempt precondition in the `eq(...)` filters: `supabase/functions/process-source-document/index.ts:78`.
- Re-extraction deletes/replaces chunks wholesale: `supabase/functions/process-source-document/index.ts:96`.

Impact:
- In ordinary operator use this is recoverable and deterministic.
- Under double-click/concurrent invocation, two workers can both process the same row and race on chunk deletion/insertion/status updates. The likely result is failed duplicate chunk inserts or an unnecessary attempt increment, not authority corruption.

Suggested correctness-only upgrade:
- Add an atomic claim condition to the existing update path, e.g. update only from `pending`/retryable `failed` and require exactly one updated row before processing. This keeps the function's original scope intact.

### P2 - Destructive functions still carry `HELD` deployment comments while frontend wrappers exist

Evidence:
- `plan-destructive` says "HELD - do not deploy until the H9 migration is applied": `supabase/functions/plan-destructive/index.ts:1`.
- `execute-destructive` has the same warning: `supabase/functions/execute-destructive/index.ts:1`.
- Frontend API wrappers call both functions: `src/lib/api.ts:1015`.

Impact:
- If these functions are deployed without the H9 migration/RPCs, execution may fail at runtime. If they are intentionally live, the comments are stale and undermine deployment confidence.

Suggested correctness-only upgrade:
- Confirm local comments, docs, and deployment state agree. If H9 is applied and functions are intentionally live, update documentation/comments in a future change. If not, gate or hide the UI entry point until migration/function availability is proven.

### P2 - `execute-destructive` requires a recovery runbook for storage-before-DB failure

Evidence:
- Runtime re-derives the plan and blocks if the new plan is not allowed: `supabase/functions/execute-destructive/index.ts:58`.
- Storage is deleted before the database RPC: `supabase/functions/execute-destructive/index.ts:67`.
- If the DB call then fails, the operation records `recovery_required: true`: `supabase/functions/execute-destructive/index.ts:80`.

Impact:
- The implementation is deliberate and avoids DB mutation when storage deletion fails.
- The remaining risk is operational: if DB fails after storage deletion, the system records recovery-required state, but this audit did not find a local runbook or automated recovery function in scope.

Suggested correctness-only upgrade:
- Add a test/runbook that proves operators can identify and recover `recovery_required: true` destructive operations. This does not change the destructive function's objective.

## Positive Controls Observed

- Local Supabase config disables JWT only for `collect-instagram-insights`; none of the Phase 1 audit-scope functions are explicitly listed with `verify_jwt = false`: `supabase/config.toml:1`.
- Newer execution-config/source-ingestion functions use `validateIdeationAccess`, which validates the bearer token, role, and caller access to the target client before service-role work begins: `supabase/functions/_shared/ideation/auth.ts:12`.
- `generate-phase-2` requires Phase 1 complete and all 21 context files approved before Phase 2 can run: `supabase/functions/generate-phase-2/index.ts:56`.
- `generate-phase-2` cleans deprecated offer names and legacy ZAR/Rand pricing from authority snippets before prompt construction: `supabase/functions/generate-phase-2/index.ts:26`.
- `generate-phase-2` server-derives the E05 Ideation Quantity Contract and rejects AI-authored quantity-contract headings: `supabase/functions/generate-phase-2/index.ts:211`.
- `validate-execution-pack` validates exact execution-file count, unique names/numbers, canonical manifest mapping, content length, allowed statuses, and proof honesty: `supabase/functions/validate-execution-pack/index.ts:142`.
- `generate-execution-config` reads approved execution Markdown only and never writes an approved config: `supabase/functions/generate-execution-config/index.ts:89`.
- `generate-execution-config` is idempotent for unchanged authority using content/source hashes: `supabase/functions/generate-execution-config/index.ts:254`.
- `approve-execution-config` authorizes against the config's own client, refuses failed reconciliation, supersedes incumbent approved configs, and derives requirements/slots deterministically: `supabase/functions/approve-execution-config/index.ts:46`.
- The DB enforces structured config approval only when reconciliation passed and a human approver/timestamp exists: `supabase/migrations/20260803020738_stage_d1_execution_configs.sql:40`.
- Derived requirements and slots have idempotent identities in schema: `supabase/migrations/20260806211830_stage_d4_requirement_derivation_identity.sql:1`.
- `register-source-document` is narrow, dedupes by content hash, and stores inline text as pending rather than extracted: `supabase/functions/register-source-document/index.ts:56`.
- `process-source-document` records extraction failures and returns to a retryable terminal state instead of leaving rows stuck in `extracting`: `supabase/functions/process-source-document/index.ts:131`.
- `record-context-file-provenance` deletes/rebuilds only derived provenance and preserves human-approved inferences: `supabase/functions/record-context-file-provenance/index.ts:102`.
- `plan-destructive` and `execute-destructive` both build plans from shared logic, and execution re-derives the plan rather than trusting a stale dry run: `supabase/functions/_shared/destructive.ts:1`.

## Test Coverage Observed

- Phase 1 intelligence tests cover extracted-document usability, recoverability, citation traceability, playbook identity drift, conflicts, and missing required fields: `tests/phase1-intelligence.test.ts`.
- Citation validation tests reject invented source IDs, unknown client input fields, malformed citations, and model-emitted approved inferences: `tests/citation-validation.test.ts`.
- Execution config tests cover reconciliation, slot identity, approval gating, idempotent version semantics, invalid config fail-closed behavior, and human-required slot approval policy: `tests/execution-config.test.ts`.
- Execution proof validation tests cover guaranteed outcome language and invented client outcome claims: `tests/execution-proof-validation.test.ts`.
- Execution quantity rollout tests assert server-derived quantity contracts and explicit legacy/pre-intelligence fallbacks: `tests/execution-quantity-rollout.test.ts`.

## Gaps Not Proven In This Phase

- Live deployment versions and deployed `verify_jwt` flags were not checked; this phase stayed local/read-only.
- No live Supabase calls were made, so migration application status in production was inferred only from repository files.
- I did not find frontend wrappers for `register-source-document`, `process-source-document`, or `record-context-file-provenance` in `src/`; this may mean they are backend/admin-only, unfinished UI wiring, or invoked through another path outside this audit scope.
- Destructive operation RPC definitions were not fully audited here; only the edge function behavior and shared planner were in scope.

## Phase 01 Verdict

Phase 01 functions are broadly aligned with their intended roles and there is no evidence of major design drift. The strongest parts are the Stage D execution-config path and deterministic validation/reconciliation. The main correction areas are semantic/status clarity, provenance fail-closed behavior, source-processing concurrency, and destructive-operation deployment/recovery confidence.

The recommended fixes are targeted logic/guard/documentation improvements only. None require expanding or contracting the original objectives of the audited functions.
