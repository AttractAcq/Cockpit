# Edge Function Remediation - 10 Step Build Plan

Status: in progress - Step 2 complete; Step 3 not started
Created: 2026-08-13
Scope: remediation of findings from the completed 10-phase read-only Edge Function audit
Function baseline: 109 local Supabase Edge Functions, excluding `_shared`
Supabase project: `xivewedajschthjlblfb`

Current checkpoint: `docs/edge-function-remediation/STEP_02_CHECKPOINT_REPORT.md`

## 1. Purpose

This document is the implementation reference for the build that follows the completed Edge Function audit programme.

The audit established complete local coverage of all 109 Edge Functions and identified active security, correctness, transaction, retry, deployment, and retirement risks. This plan converts those findings into ten controlled engineering steps.

The objective is to make the existing Edge Functions behave safely and consistently according to their original design. This is not a product-expansion plan and does not authorize new business capabilities.

## 2. Source Documents

This plan depends on, and should be read alongside:

- `docs/EDGE_FUNCTION_AUDIT_10_PHASE_PLAN.md`
- `docs/edge-function-audits/phase-01-context-execution-setup.md`
- `docs/edge-function-audits/phase-02-intelligence-os.md`
- `docs/edge-function-audits/phase-03-offers-avatars.md`
- `docs/edge-function-audits/phase-04-ideation-supply-calendar.md`
- `docs/edge-function-audits/phase-05-creation-production-assets.md`
- `docs/edge-function-audits/phase-06-reel-studio-video.md`
- `docs/edge-function-audits/phase-07-distribution-paid.md`
- `docs/edge-function-audits/phase-08-public-webhooks-payments-reporting.md`
- `docs/edge-function-audits/phase-09-background-orphan-legacy.md`
- `docs/edge-function-audits/phase-10-cross-function-reconciliation.md`

The phase documents remain the detailed evidence record. This plan should link findings back to those documents rather than replacing them.

## 3. Governing Scope

### 3.1 In Scope

- Fix confirmed authorization and client-isolation errors.
- Fix incorrect state transitions and authority replacement ordering.
- Make multi-write operations atomic where partial success can corrupt authority or workflow state.
- Fix concurrency, retry, and idempotency errors.
- Reconcile versioned function configuration with intended deployment posture.
- Add missing method, secret, ownership, and lifecycle checks.
- Correct provider orchestration where local state can diverge from provider state.
- Prevent retired functions from being accidentally deployed or invoked.
- Add focused regression tests, deployment checks, and release evidence.

### 3.2 Out of Scope

- New UI pages, products, offer types, intelligence modules, or production modes.
- New external providers or replacement of existing providers.
- Redesigning the operating model of Context, Intelligence, Offers, Avatars, Ideation, Production, Reel Studio, Distribution, or Paid.
- Changing human approval requirements into automatic approval.
- Broad naming, style, or framework refactors unrelated to an audit finding.
- Reintroducing legacy MRR, PayFast, Dialog360, Apify, old Meta, onboarding, entities, campaigns, or ZAR-era architecture.
- Moving or editing anything under `Archive/`.
- Deploying a function simply because it exists locally.

### 3.3 Original-Objective Preservation Rule

Every remediation change must document:

1. The function's current intended role.
2. The audit finding being fixed.
3. The smallest behavioral correction required.
4. Why the change does not expand or contract the function's responsibility.
5. The regression test that proves the correction.

If a proposed change cannot meet all five conditions, it must be removed from this remediation build or separately approved as a new product/build decision.

## 4. Programme Execution Rules

- Complete the steps in order unless a documented dependency requires a narrower reorder.
- Treat every step as an independently reviewable implementation cut.
- Do not combine unrelated cleanup or refactoring with a remediation step.
- Do not print, commit, or expose secret values.
- Never auto-approve generated or regenerated authority.
- Preserve currently approved authority until a replacement has been created and explicitly promoted.
- Fail closed on authorization, ownership, authority, policy, and provider-state uncertainty.
- Use migrations for database contract changes; do not make untracked manual schema edits.
- Use targeted tests first, followed by full typecheck and build before a step is declared complete.
- Deployment and live smoke testing require explicit authorization and occur only in Step 10.
- Update the issue ledger and step status after each completed cut.

## 5. Definition of Done for Every Step

A step is complete only when:

- Its stated deliverables exist.
- Every in-scope audit finding is mapped to a code, migration, configuration, test, documentation, or explicit no-change decision.
- Focused regression tests pass.
- `npm run typecheck` passes.
- `npm run build` passes.
- No unrelated files are changed.
- No approved authority is mutated during testing.
- The step has a short implementation report with changed contracts, verification evidence, residual risks, and rollback notes.
- The change has been reviewed against the original-objective preservation rule.

---

## Step 1 - Freeze the Audit Baseline and Establish Change Control

### Goal

Convert the audit findings into a controlled implementation ledger before modifying runtime behavior. This prevents findings from being lost, duplicated, silently reinterpreted, or expanded into unrelated work.

### Inputs

- All ten audit documents.
- Current local function inventory.
- Current frontend caller map.
- Current migration history and `supabase/config.toml`.
- Current local test inventory.
- Current documented deployment baseline.

### Implementation Tasks

1. Create a remediation issue ledger with one stable identifier per finding, for example `EF-AUTH-001`, `EF-TXN-001`, and `EF-WORKER-001`.
2. Record for every finding:
   - source audit and section;
   - affected function or shared helper;
   - severity;
   - current behavior;
   - expected behavior;
   - original function objective;
   - proposed correction boundary;
   - database/configuration impact;
   - required tests;
   - deployment impact;
   - owner and status.
3. Deduplicate cross-phase findings. A shared root cause should have one primary ledger item with links to all affected functions.
4. Mark every item as one of:
   - `confirmed_fix`;
   - `verification_required`;
   - `documentation_only`;
   - `retirement_required`;
   - `accepted_risk`;
   - `out_of_scope`.
5. Resolve or explicitly hold the architectural questions that affect implementation:
   - whether staff roles are globally trusted or require per-client assignment checks;
   - whether `validate-execution-pack` is operator-callable or internal-only;
   - which file is canonical for deployed JWT posture;
   - which legacy functions, if any, are remotely deployed;
   - the minimum required test level for P1 fixes.
6. Capture the pre-remediation baseline:
   - git revision;
   - local function count;
   - local configuration declarations;
   - current test/typecheck/build status;
   - known remote-state questions, without changing remote state.
7. Define one implementation checkpoint per remaining step so fixes can be reviewed, reverted, and deployed in bounded groups.

### Deliverables

- Canonical remediation issue ledger.
- Decision log for unresolved authority and deployment questions.
- Pre-remediation baseline report.
- Step-to-finding traceability matrix.

### Verification

- Every P1 and P2 finding from Phases 01-10 appears in the ledger.
- Every ledger item links back to audit evidence.
- No item proposes a new capability.
- Totals reconcile with the audit documents and the 109-function inventory.

### Definition of Done

- There are no unowned P1 findings.
- Every later step has an explicit list of ledger IDs assigned to it.
- Open decisions that would change implementation are either resolved by the system's existing authority model or visibly blocked for human decision.
- No runtime, schema, deployment, or secret change has occurred in this step.

### Rollback

This step is documentation and planning only. Rollback is removal or correction of the newly created planning artifacts.

---

## Step 2 - Build the Canonical Edge Function Registry and Static Conformance Check

### Goal

Create one version-controlled registry describing the intended operational contract of every local Edge Function, then enforce completeness and basic configuration consistency automatically.

### Registry Contract

Each of the 109 functions should declare:

- function name;
- UI page or system owner;
- lifecycle: `active`, `internal`, `background`, `held`, or `retired`;
- expected caller: UI, internal function, cron, webhook, operator, or none;
- allowed HTTP methods;
- authentication mode;
- allowed staff roles;
- client-scope requirement;
- JWT verification posture;
- cron/webhook secret requirement;
- service-role usage;
- database domains touched;
- storage buckets touched;
- external providers used;
- required environment variable names, never values;
- whether it may be deployed;
- audit phase and remediation ledger references;
- test coverage reference;
- operational owner.

### Implementation Tasks

1. Choose a machine-readable registry format compatible with the existing toolchain, preferably JSON or TypeScript with a strict schema.
2. Populate all 109 entries from the completed audit evidence.
3. Add a validation script that fails when:
   - a local function folder has no registry entry;
   - a registry entry has no corresponding allowed local function state;
   - a retired function is marked deployable;
   - a background/public function lacks an explicit auth/secret posture;
   - required fields are missing;
   - locally versioned JWT configuration contradicts the registry.
4. Add the registry validation to the normal verification workflow or CI test suite.
5. Keep the registry descriptive rather than using it as a new runtime routing layer. Runtime behavior remains in existing functions and shared helpers.
6. Document how to update the registry whenever a function is added, retired, or changes caller/auth posture.
7. Add an intentionally small exception mechanism for deployment facts that cannot be represented locally, with owner, reason, and expiry/review date.

### Deliverables

- Machine-readable Edge Function registry.
- Registry schema/type definition.
- Static validation script.
- Automated registry conformance test.
- Maintainer instructions.

### Verification

- All 109 functions are represented exactly once.
- The known 90 UI-called and 19 non-UI functions reconcile with registry caller types.
- Function-to-function calls to `validate-execution-pack` and legacy `onboarding` are represented.
- `collect-instagram-insights` and `process-asset-generation-jobs` have explicit worker/JWT posture.
- All retired functions are non-deployable in the registry.

### Definition of Done

- Adding an unregistered function folder causes the static check to fail.
- Removing or renaming a registered function without updating the registry causes the check to fail.
- A retired function cannot pass registry validation while marked deployable.
- Registry checks run with the existing test/build workflow.

### Non-Goals

- Do not introduce a runtime service registry.
- Do not change function behavior in this step.
- Do not infer remote deployment status without evidence.

### Rollback

Remove the registry check from CI and revert the registry artifacts. Runtime behavior is unaffected.

---

## Step 3 - Enforce Authentication, Authorization, and Client Isolation

### Goal

Close the active P1 access-control gaps created when service-role clients bypass RLS after only a broad staff-role check.

### Primary Targets

- `validate-execution-pack`.
- Production and asset-generation functions identified in Audit 05.
- Reel Studio functions identified in Audit 06.
- Distribution and paid functions identified in Audit 07.
- `create-reel-distribution-draft` and `publish-instagram-asset`.
- Provenance/input functions accepting caller-supplied IDs, including `ingest-content-source`.
- Caller-supplied storage paths and asset references.

### Implementation Tasks

1. Confirm the canonical client-access rule from current tables and existing functions. Do not invent a new tenancy model.
2. Create or reuse one narrowly scoped shared helper that:
   - verifies the bearer token;
   - loads the current operator;
   - verifies the required role;
   - verifies access to the requested client where current policy requires it;
   - returns a consistent fail-closed result.
3. Replace duplicated role-only authorization in affected active functions with the canonical check, without changing their business behavior.
4. For resources identified by child IDs, derive `client_id` from the stored parent/resource before mutation instead of trusting a caller-supplied client ID.
5. For adapter/provenance IDs, verify that referenced rows belong to the same client before inserting cross-table links.
6. For uploaded/storage references:
   - allow only approved buckets;
   - confirm the stored object or asset record belongs to the same client/workflow;
   - reject arbitrary cross-client paths and external references;
   - preserve existing supported input types.
7. Decide and implement the narrow authorization posture for `validate-execution-pack`:
   - either authenticated operator plus client access; or
   - internal-only invocation with a verifiable internal caller contract.
8. Ensure function-to-function calls preserve the required authorization context and do not become an unauthenticated bypass.
9. Standardize responses for unauthenticated, role-denied, client-denied, and ownership-denied requests without leaking whether another client's resource exists.
10. Add audit logging for denied high-risk mutation attempts where the existing logging model supports it.

### Required Tests

- No token returns `401`.
- Unsupported role returns `403`.
- Valid staff role without client access returns `403` or a non-enumerating not-found result according to current policy.
- A resource ID belonging to another client is rejected.
- A valid same-client request still follows the original success path.
- Function-to-function validation calls continue to work only through the approved caller contract.
- Cross-client proof, source, asset, video, project, distribution, and campaign IDs are rejected.
- Arbitrary storage bucket/path input is rejected.

### Deliverables

- Shared access helper or documented reuse of an existing helper.
- Updated active functions with client/resource ownership enforcement.
- Focused negative and positive regression tests.
- Authorization contract documentation in the function registry.

### Definition of Done

- No active UI or internal service-role function in the P1 audit set can read or mutate another client's data using a supplied ID without passing the canonical access check.
- Tests demonstrate denial before any database/storage/provider side effect.
- The fix does not change which authorized operators may perform the original operation beyond enforcing the existing client boundary.

### Rollback

Revert function/helper changes as one cut. No schema rollback should be needed unless a supporting access RPC is introduced; any such migration must include an explicit down/reversal strategy.

---

## Step 4 - Protect Approved Authority and Make Promotion Transactions Atomic

### Goal

Prevent approved or active authority from being mutated, demoted, or temporarily removed when replacement creation or activation fails.

### Primary Targets

- Campaign Intelligence releases.
- Main Offer and Seasonal Offer releases.
- Avatar releases and approved components.
- Content brief regeneration and review.
- Production brief regeneration where approved rows are overwritten.
- `publish-playbook-version`.
- `process-source-document` authority replacement boundaries.
- `manage-ad-brief`.
- `handoff-video-project` and other multi-write authority handoffs.

### Required State Invariants

- Approved records are immutable except through explicit archive/supersede operations.
- A current approved/active record remains current until its replacement is fully created and promoted.
- A failed replacement leaves the previous authority untouched.
- Exactly one active authority pointer exists where the domain requires one.
- Draft regeneration creates a new version rather than overwriting approved work.
- Approval is always a human-triggered transition.

### Implementation Tasks

1. Add missing release-level immutability guards for Campaign Intelligence, Offers, and Avatars.
2. Review existing component-level guards to ensure they protect the intended statuses without preventing legitimate draft edits.
3. Replace multi-request promotion sequences with transactional database RPCs where partial success can remove authority.
4. Use transaction ordering that:
   - validates the proposed replacement;
   - creates or confirms the replacement;
   - locks/checks the current active row;
   - promotes the replacement;
   - supersedes the former active row;
   - updates the active pointer;
   - commits all changes together.
5. Add compare-and-set status conditions to prevent stale finalize/review requests from demoting approved releases.
6. Change regeneration of approved content/production briefs to append a new draft version while retaining the approved version.
7. Ensure old drafts cannot be approved after a newer current version has replaced them unless the operator explicitly promotes that version through an allowed path.
8. Preserve evidence links, provenance, reviewer identity, timestamps, and version lineage through promotion.
9. Make active-pointer uniqueness enforceable at the database level where practical.
10. Add structured failure responses that distinguish validation, stale version, immutable authority, and transaction failure.

### Required Tests

- Simulate replacement insert failure and confirm previous authority remains active.
- Simulate active-pointer update failure and confirm no partial supersession commits.
- Attempt to finalize an approved release and confirm rejection.
- Attempt concurrent approvals and confirm exactly one valid result.
- Regenerate an approved brief and confirm the approved row remains unchanged.
- Approve a stale brief/release version and confirm rejection.
- Confirm human approval remains the only path to approved status.

### Deliverables

- Database migrations for guards, uniqueness, and transactional RPCs.
- Updated functions calling the transactional contracts.
- Version lineage and active-pointer tests.
- Migration verification and rollback notes.

### Definition of Done

- No audited authority replacement path can leave the system without its prior valid authority after a failed replacement.
- Approved releases and records cannot be mutated by finalize/retry/regenerate actions.
- Authority promotion behavior is atomic and covered by failure-injection tests.

### Rollback

Roll back function callers before removing supporting RPCs or constraints. Never drop a guard while functions still depend on it. Preserve all authority rows created during migration testing.

---

## Step 5 - Correct Domain Logic and Workflow State Machines

### Goal

Fix confirmed logic errors where functions produce the wrong output, accept an invalid transition, or report a misleading terminal state.

### Primary Corrections

#### Context and Execution

- Strengthen `finalize-phase-1` so `needs_client_input` is not treated as execution-ready.
- Ensure Phase 2 generated execution files remain draft/review-gated and are not treated as approved authority merely because generation completed.
- Preserve split-generation resumability and the existing 21-file manifest design.

#### Intelligence

- Make retry cleanup fail safely when step-scoped deletes fail.
- Preserve unaffected successful modules when retrying an individual Intelligence module.
- Keep retry/rebuild behavior aligned with the existing page controls and approved-release immutability.

#### Offers and Avatars

- Fix Seasonal Offers so generation uses the explicitly selected Main Offer rather than the first offer by display order.
- Make rebuild-only versus component-retry behavior explicit where no `retry_step` exists; add a retry action only where it is already part of the approved UI/module design.
- Keep Avatar assets review-gated and expose only the already-designed review transitions.

#### Ideation and Calendar

- Stop generation/scoring when required approved-context queries fail instead of silently interpreting errors as empty context.
- Require the intended scoring/eligibility contract for calendar candidates.
- Ensure review applies only to the current brief/version.

#### Production

- Prevent `generate-phase-3-slot` from marking a scoped run terminal while items remain processing.
- Align canonical production-mode database constraints with the already-built Stage 5E modes: `avatar_led`, `faceless`, `proof_led`, `static`, and `human_led`, plus any still-valid existing value required by current code.
- Correct contractor handoff gates so all AI-only/AI-led modes remain blocked from human-contractor routing where intended.
- Stop contractor handoff from silently rewriting a production mode as a side effect.

#### Reel Studio

- Require the parent project's valid lifecycle state before submitting still/video provider work.
- Validate selected motion against the provider-supported/current motion contract before submission.
- Keep standalone projects from entering an impossible or misleading handoff path.

### Implementation Tasks

1. Convert each correction into an explicit before/after invariant in the issue ledger.
2. Patch the smallest responsible function, shared helper, or database constraint.
3. Preserve current request and response contracts unless the audit proves the contract itself is incorrect.
4. Return explicit recoverable errors for invalid state rather than silently coercing state.
5. Ensure every failure path clears or preserves running state according to the workflow's existing recovery model.
6. Add migration-safe compatibility for any production-mode constraint correction.
7. Update UI error mapping only where a new explicit backend error would otherwise be unusable.

### Required Tests

- `needs_client_input` blocks execution readiness.
- Phase 2 completion does not equal approval.
- Seasonal generation uses the requested Main Offer ID.
- Failed retry cleanup does not requeue a partially cleaned Intelligence step.
- Missing/failed context reads stop generation rather than producing context-free output.
- Scoped Phase 3 runs remain running while any item is pending/processing.
- Every existing Stage 5E production mode can be persisted and routed correctly.
- AI-led work cannot be sent to the human contractor path.
- Higgsfield submission is rejected from invalid project states.

### Deliverables

- Focused logic corrections.
- Any required constraint migration.
- State-machine regression tests.
- Updated error-code documentation.

### Definition of Done

- Every confirmed wrong-result or invalid-transition P1 finding assigned to this step is closed.
- No correction broadens the module's existing responsibility.
- Operators receive recoverable, specific errors instead of stuck or falsely terminal state.

### Rollback

Revert by domain-sized changes. Constraint migrations must support returning to the prior accepted value set without deleting valid rows created under the corrected contract.

---

## Step 6 - Make Concurrency, Retry, and Idempotency Deterministic

### Goal

Ensure duplicate requests, concurrent operators, worker retries, and provider retries cannot create duplicate versions, lose updates, overwrite terminal decisions, or corrupt counters.

### Primary Targets

- `process-source-document` claim and finalization.
- Offer prepare/idempotency collisions.
- Avatar asset version allocation.
- Input-conflict resolution.
- Content Opportunity status updates.
- Calendar proposal revision and slot updates.
- Content brief and review transitions.
- Scoped Phase 3 item claiming and run counters.
- Asset-generation jobs and retries.
- Scheduled publishing attempts.
- Reel Studio still/video retries.
- Score row and current-score pointer updates.

### Implementation Tasks

1. Define an idempotency contract for every target mutation:
   - stable operation key;
   - unique database constraint;
   - replay response;
   - conflict response;
   - retryable versus terminal errors.
2. Replace lookup-before-insert races with unique constraints plus controlled conflict handling.
3. Allocate versions atomically, including Avatar asset versions.
4. Add compare-and-set filters for status transitions, reviews, and conflict resolution.
5. Make calendar `expected_revision` validation and slot mutation one transaction.
6. Use database-side atomic increments or recomputation for concurrent run counters.
7. Add a claim token/lease or equivalent guarded transition for source documents and background work items.
8. Ensure retries preserve completed unaffected items and regenerate only the requested failed unit.
9. Require workers to revalidate current authority/fingerprint before executing a previously queued job.
10. Scope cleanup operations by client, parent workflow, and item/version rather than broad group identifiers alone.
11. Record provider request IDs and attempt numbers so polling/retry cannot accidentally create a second provider job.
12. Make retry exhaustion produce a clear recoverable terminal state and operator-visible reason.

### Required Tests

- Two simultaneous prepare requests return one created record and one deterministic replay/conflict response.
- Two concurrent review/status actions cannot both win.
- Two Avatar asset generations cannot receive the same version.
- Two calendar edits with the same expected revision produce one success and one stale-revision failure.
- Concurrent Phase 3 workers produce accurate item/run counters.
- Retried worker jobs do not operate on superseded or unapproved authority.
- Provider polling retries do not submit duplicate jobs.
- Cleanup for one client/workflow cannot delete another client's assets.

### Deliverables

- Unique constraints and transactional/CAS helpers.
- Deterministic idempotency and retry behavior.
- Concurrency-focused tests.
- Retry/error classification documentation.

### Definition of Done

- Target operations have database-enforced race protection rather than application timing assumptions.
- Retry behavior is safe after network timeout, duplicate delivery, or operator double-click.
- Completed work remains preserved when an individual component is retried.

### Rollback

Roll back callers before removing new constraints or RPCs. Retain idempotency records and provider attempt history; do not delete them during rollback.

---

## Step 7 - Reconcile Background Workers, Methods, Secrets, and Deployment Configuration

### Goal

Make the operational posture of cron/background functions explicit, version-controlled, fail-closed, and consistent with the registry and deployed configuration.

### Primary Targets

- `collect-instagram-insights`.
- `process-asset-generation-jobs`.
- `process-scheduled-publishing`.
- Any internal helper exposed as an HTTP Edge Function.
- `supabase/config.toml` and deployment scripts/docs.

### Implementation Tasks

1. Reconcile the intended remote JWT posture with local configuration, especially the documented `verify_jwt = false` posture for `process-asset-generation-jobs`.
2. Add explicit `POST` enforcement to cron/background workers after handling `OPTIONS` where applicable.
3. Require `CRON_SECRET` using constant-time comparison where the runtime/tooling supports it.
4. Reject missing or empty configured worker secrets; never silently fall back to unauthenticated operation.
5. Ensure service-role initialization occurs only after method and worker-secret validation.
6. Bound worker batches at the query level rather than loading all eligible records and slicing in memory.
7. Add deterministic claim ordering and maximum batch limits.
8. Ensure top-level exceptions finalize worker run records instead of leaving them `running`.
9. Record counts for claimed, succeeded, skipped, retryable-failed, and terminal-failed items.
10. Document secret names, rotation owner, deployment posture, schedule owner, and expected invocation path in the registry.
11. Add a static check that every JWT-disabled function is explicitly classified as worker/webhook/public and has an alternate authentication contract.
12. Verify no browser/UI caller depends on a cron-secret-only function.

### Required Tests

- GET/PUT/PATCH/DELETE requests are rejected.
- Missing, incorrect, and empty cron secrets are rejected before database access.
- Correct secret plus POST reaches the worker path.
- Batch size is enforced by the database query.
- A top-level provider/database failure closes the run with a failure summary.
- Concurrent worker invocations cannot claim the same item.
- Registry and `supabase/config.toml` mismatch causes static validation failure.

### Deliverables

- Corrected local function configuration.
- Hardened worker entry points.
- Bounded query/claim behavior.
- Worker run finalization and metrics.
- Worker configuration tests and operations documentation.

### Definition of Done

- Every active background worker has one documented caller, one explicit method, one alternate authentication contract, and deterministic claim/finalization behavior.
- Version-controlled configuration matches intended deployment posture.
- No worker can remain indefinitely `running` because of an uncaught top-level failure.

### Non-Goals

- Do not add new schedules or background workflows.
- Do not rotate secrets as part of code implementation unless separately authorized.

### Rollback

Revert worker code and config as one deployable unit. If JWT posture changes remotely, rollback must restore both function code and deployment configuration together.

---

## Step 8 - Reconcile External Provider Operations with Local Policy and State

### Goal

Prevent OpenAI, Higgsfield, Meta, Instagram, and Resend operations from occurring when local authority, lifecycle, ownership, or policy no longer permits them, and prevent partial provider success from being represented as complete local success.

### Provider Areas

#### OpenAI / AI Asset Generation

- Revalidate approved production brief authority and fingerprint when queued work executes.
- Validate source asset ownership before provider calls.
- Preserve prompt/model/provider request metadata needed for retries and audit.
- Add explicit provider timeouts and classify retryable errors.

#### Higgsfield / Reel Studio

- Verify project and shot lifecycle immediately before submit/retry calls.
- Validate motion support before video submission.
- Preserve provider IDs across polling/retry.
- Prevent handoff until all required rendered clips and the approved production brief contract are valid.

#### Instagram Distribution

- Re-check current client distribution approval policy at both manual and scheduled publish time.
- Confirm the asset/deliverable belongs to the submitted Content Item and client.
- Keep publish attempts idempotent and auditable.

#### Meta Paid Operations

- Require non-empty requested geography and enforce it against the approved budget/policy scope.
- Do not activate a campaign if required child Ad Set/creative creation fails.
- Represent partial provider creation as a recoverable partial state, not active success.
- Propagate regulated-category acknowledgement to the correct provider special-ad-category contract.
- Reject live budget updates when there is no provider Ad Set identifier instead of recording a false local success.
- Reconcile campaign completion with live provider spend/state rather than making a local-only terminal transition.

#### Resend / Contractor Handoff

- Add an explicit request timeout.
- Prevent duplicate contractor emails through idempotency.
- Preserve the original production mode and record the handoff attempt separately.

### Implementation Tasks

1. Add a common provider-call checklist to affected functions: authorization, client ownership, approved authority, current policy, valid lifecycle, idempotency key, timeout, and attempt logging.
2. Perform all checks immediately before the irreversible/provider side effect, not only when the draft/job was created.
3. Store external identifiers before subsequent dependent provider operations where needed for reconciliation.
4. Model partial provider success explicitly using existing workflow states or the smallest necessary state correction.
5. Add compensating/recovery guidance where provider rollback is impossible.
6. Never infer provider success from an HTTP request alone when asynchronous status polling is required.
7. Ensure logs and responses do not expose provider secrets or sensitive payloads.

### Required Tests

- Policy revoked after scheduling prevents publish.
- Superseded production brief prevents queued asset execution.
- Invalid Reel Studio lifecycle prevents provider submission.
- Meta Ad Set creation failure prevents campaign activation.
- Empty geography cannot pass the launch gate.
- Missing external Ad Set ID prevents a local-only budget success.
- Duplicate publish/handoff requests do not create duplicate external actions.
- Provider timeout leaves a retryable, reconciliable state.

### Deliverables

- Provider preflight/revalidation checks.
- Corrected partial-success state handling.
- Timeout/idempotency protections.
- Provider failure and reconciliation tests.
- Updated provider runbook entries.

### Definition of Done

- No audited provider operation can execute using stale approval, invalid client ownership, invalid lifecycle, or revoked policy.
- Local state distinguishes complete, partial, retryable failure, and terminal failure accurately.
- Provider retries are safe and traceable.

### Rollback

Provider-facing changes must be deployable per provider domain. Rollback must not erase provider IDs or attempt records needed to reconcile actions already sent externally.

---

## Step 9 - Quarantine Retired Functions and Verify the Deployment Surface

### Goal

Ensure superseded functions cannot be accidentally deployed, invoked, or mistaken for current architecture while preserving their historical code outside the active deployment surface.

### Retired/Superseded Set

- `apify-scrape`
- `brief-generator`
- `dialog360-send`
- `meta-ad-ops`
- `meta-webhook`
- `mjr-generate`
- `mrr-calc`
- `onboarding`
- `payfast-create-link`
- `payfast-webhook`

Additional held/internal functions must be classified from the registry rather than assumed retired.

### Implementation Tasks

1. Verify the remote deployment list for all 109 local function names, with explicit authorization before any remote query that exceeds the read-only build preparation boundary.
2. Compare remote deployment state with the registry and produce a mismatch report.
3. For retired functions:
   - remove them from the deployable `supabase/functions` surface without placing them under `Archive/`; or
   - replace them with an explicit non-operational tombstone only if historical deployment compatibility requires the endpoint to exist.
4. Ensure no frontend, active function, script, cron, webhook, CI job, or deployment command references a retired function.
5. Break the legacy `payfast-webhook -> onboarding` function-to-function path as part of retirement, not by repairing/reviving it.
6. Extend static readiness checks to cover all retired names, including both PayFast functions.
7. Add deployment allowlisting so ordinary deploy commands cannot publish retired or held functions.
8. Document how historical code can be inspected without being considered current authority.
9. If any retired function is unexpectedly deployed, produce a separate decommission checklist covering traffic, schedules, webhooks, secrets, and safe removal. Do not delete remote functions without explicit authorization.
10. Reconcile held destructive functions separately; do not classify them as retired merely because deployment comments are stale.

### Required Tests

- Registry validation rejects any retired function marked deployable.
- Source scan finds no active caller to retired names.
- Deployment tooling excludes retired functions.
- Stage/readiness tests fail if a retired API wrapper is reintroduced.
- No current commercial path references PayFast, ZAR, old MRR, old onboarding, or legacy entity/campaign architecture.

### Deliverables

- Deployment-surface reconciliation report.
- Retired-function quarantine/tombstone implementation.
- Deployment allowlist/guard.
- Expanded retirement regression tests.
- Explicit held-versus-retired classification.

### Definition of Done

- Retired functions are not part of the ordinary deployable surface.
- No active code path can invoke them.
- Any unexpected remote deployment has a documented, explicitly authorized decommission action.
- No retired feature has been repaired or reactivated.

### Rollback

Historical source movement is reversible through git. Remote decommissioning, if separately authorized, requires its own rollback decision based on whether traffic or external webhook configuration still exists.

---

## Step 10 - Full Verification, Controlled Deployment, Smoke Test, and Release Evidence

### Goal

Prove that the remediation build closes the assigned findings without regressing existing Stage 4, Stage 5, Reel Studio, production, distribution, or approval behavior.

### Pre-Deployment Verification

1. Run the registry/static conformance check.
2. Run all focused regression tests added in Steps 3-9.
3. Run existing test suites covering Context, Intelligence, Offers, Avatars, Ideation, Production, Reel Studio, Distribution, and Paid.
4. Run migration validation against an isolated/local database where available.
5. Run `npm run typecheck`.
6. Run `npm run build`.
7. Review the final diff for unrelated changes, secret exposure, generated artifacts, and accidental `Archive/` edits.
8. Reconcile every remediation ledger item to evidence or an explicit accepted-risk decision.

### Deployment Plan

1. Require explicit human authorization before deploying migrations or Edge Functions.
2. Capture pre-deployment remote function versions and relevant schema migration state.
3. Deploy in dependency order:
   - schema guards, constraints, and transactional RPCs;
   - shared authorization/contract changes;
   - low-provider-impact active functions;
   - production/Reel Studio functions;
   - distribution/paid provider functions;
   - background workers and configuration;
   - retirement/decommission actions only when separately authorized.
4. Verify each deployment batch before continuing.
5. Do not rotate or remove secrets unless the step has a separately approved secret-change procedure.

### Controlled Smoke Test Matrix

Use disposable or explicitly approved test fixtures. Do not mutate approved client authority for convenience.

#### Authorization

- Authenticated valid client operation succeeds.
- Cross-client operation is denied before side effects.
- Worker secret and method gates behave correctly.

#### Authority

- Draft generation remains draft.
- Human approval promotes the intended version.
- Failed replacement preserves the previous active authority.
- Retry/regeneration does not mutate approved records.

#### Stage 4 and Stage 5

- Campaign Intelligence, Main Offers, Seasonal Offers, and Ideation handoffs retain their approved-authority boundaries.
- Seasonal Offers use the selected Main Offer.
- Avatar components/assets remain optional, versioned, and review-gated.
- Production modes introduced by Avatar OS remain persistable and correctly routed.

#### Production and Reel Studio

- Scoped jobs do not finish while items are processing.
- Avatar-led and other production modes follow their existing gates.
- Reel Studio submit, retry, render, approval, and handoff paths respect lifecycle and ownership.

#### Distribution and Paid

- Policy is rechecked at publish/launch time.
- Provider partial failure cannot be reported as active success.
- Idempotent replay does not duplicate external actions.

#### Background Workers

- Correct POST plus secret claims a bounded batch.
- Invalid method/secret does nothing.
- Top-level failure closes the run and preserves retry evidence.

### Release Evidence

Produce a final engineering release report containing:

- git commit(s) and deployed function versions;
- migration identifiers;
- registry inventory result;
- tests executed and results;
- smoke-test scenarios and results;
- audit findings closed;
- accepted risks and deferred items;
- rollback commands/procedure by deployment batch;
- confirmation that no function objective was expanded or contracted;
- confirmation that no generated authority was auto-approved;
- confirmation that no retired feature was reactivated.

### Definition of Done

- All P1 remediation ledger items are closed or explicitly blocked/accepted by the authorized owner.
- All assigned P2 items are closed or moved to a documented later backlog with rationale.
- Registry, tests, typecheck, and build pass.
- Controlled deployment completes without unresolved partial state.
- Smoke tests pass using safe fixtures.
- Remote deployment posture matches the registry.
- The final release report is saved in the repo.
- Rollback procedures are verified before the build is declared released.

### Rollback

Rollback must follow deployment order in reverse while preserving data needed for reconciliation. Provider actions already sent externally must be reconciled rather than erased from local history. Authority rollback must promote a known valid version through the approved transaction path, never by directly editing approved rows.

---

## 6. Step Dependency Map

```text
Step 1: Audit baseline and issue ledger
  -> Step 2: Function registry and static checks
    -> Step 3: Authorization and client isolation
      -> Step 4: Authority immutability and transactions
        -> Step 5: Domain logic and workflow states
          -> Step 6: Concurrency, retry, and idempotency
            -> Step 7: Workers and deployment configuration
              -> Step 8: Provider-state integrity
                -> Step 9: Legacy quarantine and deployment reconciliation
                  -> Step 10: Full verification and controlled release
```

Steps 3-9 may contain parallel work inside a step, but the step-level acceptance gate must be completed before the next step is released. Step 10 is the only deployment and live smoke-test step.

## 7. Finding-to-Step Routing Summary

| Finding class | Primary step |
| --- | --- |
| Audit traceability, ownership, scope decisions | Step 1 |
| Function inventory, caller/auth/deployment registry | Step 2 |
| Service-role client access and resource ownership | Step 3 |
| Approved authority immutability and atomic promotion | Step 4 |
| Incorrect results, invalid transitions, stale contracts | Step 5 |
| Races, retries, duplicate delivery, idempotency | Step 6 |
| Cron workers, JWT posture, methods, secrets, run finalization | Step 7 |
| OpenAI, Higgsfield, Meta, Instagram, Resend state alignment | Step 8 |
| Superseded functions and deployable-surface control | Step 9 |
| Full regression, deployment, smoke test, release evidence | Step 10 |

## 8. Final Engineering Release Definition of Done

The complete ten-step build is done only when:

- The registry accounts for all 109 local functions.
- Active service-role functions enforce the current client boundary.
- Approved authority cannot be silently mutated or lost during replacement.
- Multi-write authority transitions are atomic.
- Known workflow state and selected-record logic errors are fixed.
- Concurrent operations and retries are deterministic.
- Background worker configuration is explicit and version-controlled.
- External-provider operations revalidate current policy, authority, ownership, and lifecycle.
- Retired functions are outside the ordinary deployable surface and have no active callers.
- Tests, typecheck, build, controlled deployment, and smoke checks pass.
- Every audit finding is closed, accepted, blocked, or deferred with an owner and rationale.
- No Edge Function has been expanded or contracted beyond its original approved objective.

## 9. Starting Point

The next implementation cut is Step 1 only: create the remediation ledger, resolve the authority/deployment decisions needed by later fixes, and freeze the pre-remediation baseline. Runtime remediation begins only after that checkpoint is reviewed.
