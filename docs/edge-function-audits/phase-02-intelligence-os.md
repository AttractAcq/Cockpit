# Edge Function Audit - Phase 02: Intelligence OS

Date: 2026-08-13
Mode: Read-only audit

## Scope

This phase audited the Intelligence-page authority functions:

- `run-market-os`
- `run-avatar-os`
- `run-competitor-os`
- `run-association-os`
- `run-brand-strategist`
- `run-campaign-intelligence`
- `record-research-run`

Primary UI/system area:

- Intelligence page
- Market OS
- Avatar OS
- Competitor OS
- Association OS
- Brand Strategist
- Campaign Intelligence

Audit emphasis:

- Confirm `prepare -> step -> finalize` orchestration is consistent.
- Confirm `retry_step` is correctly configured where expected.
- Confirm approved releases are immutable.
- Confirm draft outputs remain review-gated.
- Confirm upstream authority dependencies are enforced.
- Confirm source/evidence/finding cleanup is step-scoped.

This audit did not make source, schema, configuration, or deployment changes.

## Executive Summary

The five main Intelligence OS edge functions are broadly aligned with the intended authority-production model. `run-market-os`, `run-avatar-os`, `run-competitor-os`, `run-association-os`, and `run-brand-strategist` all implement the expected `prepare`, `step`, `finalize`, and `retry_step` action contract, use leased step claiming, enforce upstream authority dependencies, write review-gated draft releases, and rely on a human review RPC to promote authority.

The main correctness concern is in `run-campaign-intelligence`: Campaign Intelligence has separate release tables and review logic, but it does not currently have the same release-level immutability protection as the generic Intelligence OS release table. Its `finalize` action can update a release to `needs_review` by id without constraining the current release status to `draft`.

The second recurring concern is retry cleanup. The five main OS functions all attempt step-scoped cleanup before requeueing a failed module, but the cleanup helper does not check delete errors. If cleanup fails, retry can proceed with stale records/findings/evidence still attached to the release.

## Function Roles

| Function | Role | Current orchestration |
| --- | --- | --- |
| `run-market-os` | Builds evidence-backed market authority from approved Client Context OS files. | `prepare -> step -> finalize -> human review`; supports `retry_step`. |
| `run-avatar-os` | Builds buyer-role / ICP decision authority from approved context plus approved Market OS. | `prepare -> step -> finalize -> human review`; supports `retry_step`. |
| `run-competitor-os` | Builds competitor/alternative authority from approved context plus approved Market and Avatar OS. | `prepare -> step -> finalize -> human review`; supports `retry_step`. |
| `run-association-os` | Builds buyer association/signal authority from approved context plus approved Market, Avatar, and Competitor OS. | `prepare -> step -> finalize -> human review`; supports `retry_step`. |
| `run-brand-strategist` | Synthesizes approved Market, Avatar, Competitor, and Association OS into strategic recommendations. | `prepare -> step -> finalize -> human review`; supports `retry_step`. |
| `run-campaign-intelligence` | Builds a review-gated campaign calendar from approved Intelligence authority. | `prepare -> step -> finalize -> campaign review`; no `retry_step`. |
| `record-research-run` | Records user-supplied research sources/runs; it does not generate intelligence. | Single request writes run plus sources, then completes run. |

## Positive Controls Confirmed

### Authentication and Client Access

- The main Intelligence OS functions use `validateIntelligenceAccess`, which requires a bearer token, validates the Supabase user, restricts access to `admin` / `account_manager`, and checks client access through RLS-backed client selection (`supabase/functions/_shared/intelligence/auth.ts:8`).
- Local Supabase config does not disable JWT verification for these Intelligence functions. The only explicit local `verify_jwt = false` entry is unrelated to this phase.

### Lease-Safe Step Execution

- The shared `claim_client_research_step` RPC uses `for update skip locked`, lease ownership, and attempt counting before a function performs module work (`supabase/migrations/20260812140000_phase_2a_a_intelligence_foundation.sql:110`).
- The OS functions call this claim RPC before running a step, which reduces duplicate worker execution risk.

### Review-Gated Authority

- The five main OS finalizers set releases to `needs_review`, not `approved`.
- Tests assert the edge functions do not call `review_intelligence_release` directly (`tests/market-os.test.ts`, `tests/avatar-os.test.ts`, `tests/competitor-os.test.ts`, `tests/association-os.test.ts`, `tests/brand-strategist.test.ts`).
- Generic Intelligence approval is performed by `review_intelligence_release`, which requires `needs_review`, requires structured records before approval, supersedes the previous active release, updates the active pointer, and records the decision (`supabase/migrations/20260812140000_phase_2a_a_intelligence_foundation.sql:660`).

### Approved Generic Intelligence Releases Are Immutable

- Generic Intelligence releases have a DB immutability trigger preventing approved release mutation (`supabase/migrations/20260812140000_phase_2a_a_intelligence_foundation.sql:524`).
- Generic child rows are also protected after approval, including records, findings, evidence links, and evidence records (`supabase/migrations/20260812140000_phase_2a_a_intelligence_foundation.sql:558`).
- Generic approval decisions are append-only (`supabase/migrations/20260812140000_phase_2a_a_intelligence_foundation.sql:640`).

### Upstream Authority Dependencies

- `run-market-os` requires all 21 approved Client Context OS files and complete Stage 1 state before preparing a run (`supabase/functions/run-market-os/index.ts:97`).
- `run-avatar-os` requires approved Market OS authority in addition to approved context (`supabase/functions/run-avatar-os/index.ts:149`).
- `run-competitor-os` requires approved Market OS and Avatar OS authority in addition to approved context (`supabase/functions/run-competitor-os/index.ts:203`).
- `run-association-os` requires approved Market, Avatar, and Competitor authority in addition to approved context (`supabase/functions/run-association-os/index.ts:226`).
- `run-brand-strategist` requires approved Market, Avatar, Competitor, and Association authority in addition to approved context (`supabase/functions/run-brand-strategist/index.ts:295`).
- `run-campaign-intelligence` requires active approved Market, Avatar, Competitor, Association, and Brand Strategist releases (`supabase/functions/run-campaign-intelligence/index.ts:132`).

### Retry Contract Exists For The Five Main Intelligence OS Domains

- The frontend retry helper maps all five Intelligence domains to edge functions and sends `action: "retry_step"` (`src/lib/intelligence.ts:305`).
- Backend `retry_step` action support exists in:
  - `run-market-os` (`supabase/functions/run-market-os/index.ts:16`)
  - `run-avatar-os` (`supabase/functions/run-avatar-os/index.ts:19`)
  - `run-competitor-os` (`supabase/functions/run-competitor-os/index.ts:17`)
  - `run-association-os` (`supabase/functions/run-association-os/index.ts:18`)
  - `run-brand-strategist` (`supabase/functions/run-brand-strategist/index.ts:16`)
- The recovery test confirms the helper contract and board status for all five backend retry paths (`tests/intelligence-recovery.test.ts:8`).

## Findings

### P1 - Campaign Intelligence Releases Are Not Protected Like Generic Intelligence Releases

`run-campaign-intelligence` finalizes a release by updating it to `needs_review` using only the release id (`supabase/functions/run-campaign-intelligence/index.ts:535`). Unlike the five main OS functions, it does not guard the update with `.eq("status", "draft")` and does not return early for an already finalized release.

The Campaign Intelligence migration protects approved child rows in `client_campaign_periods` and `client_campaign_period_source_links` (`supabase/migrations/20260812180000_phase_4a_campaign_intelligence.sql:160`), but it does not define an equivalent release-level immutable trigger for `client_campaign_intelligence_releases`.

Impact:

- If `finalize` is invoked again with a known run id after approval, the function can attempt to demote an approved/superseded/archived Campaign Intelligence release back to `needs_review`.
- This violates the architecture principle that approved authority is immutable.
- The generic Intelligence OS path has the correct protection; Campaign Intelligence is the schema/function parity gap.

Suggested correctness-only upgrade:

- Add a Campaign Intelligence release-level immutable trigger mirroring `prevent_approved_intelligence_release_mutation`.
- Add a finalize guard that only updates releases currently in `draft`.
- Return an idempotent "already finalized" response for `needs_review` / `approved` releases.

This does not expand or contract Campaign Intelligence; it only enforces the already-stated authority lifecycle.

### P1 - Retry Cleanup Ignores Delete Errors Before Requeueing Failed Steps

The five main OS functions clean step-scoped artifacts before resetting a failed step, but their cleanup helpers do not inspect delete errors:

- `run-market-os`: cleanup helper at `supabase/functions/run-market-os/index.ts:274`, called before requeue at `supabase/functions/run-market-os/index.ts:697`.
- `run-avatar-os`: cleanup helper at `supabase/functions/run-avatar-os/index.ts:412`, called before requeue at `supabase/functions/run-avatar-os/index.ts:879`.
- `run-competitor-os`: cleanup helper at `supabase/functions/run-competitor-os/index.ts:562`, called before requeue at `supabase/functions/run-competitor-os/index.ts:1109`.
- `run-association-os`: cleanup helper at `supabase/functions/run-association-os/index.ts:608`, called before requeue at `supabase/functions/run-association-os/index.ts:1203`.
- `run-brand-strategist`: cleanup helper at `supabase/functions/run-brand-strategist/index.ts:786`, called before requeue at `supabase/functions/run-brand-strategist/index.ts:1390`.

Impact:

- If a delete fails because of RLS, FK constraints, a transient DB issue, or malformed metadata, retry proceeds anyway.
- The retried module can then coexist with stale records/findings/evidence from the failed attempt.
- This weakens the "retry one module while preserving successful modules" guarantee.

Suggested correctness-only upgrade:

- Make cleanup helpers return a structured result or throw on any delete error.
- Abort `retry_step` if cleanup fails.
- Include the cleanup failure in the step/run failure message so the operator sees a recoverable system error instead of silently mixing artifacts.

### P2 - Campaign Intelligence Has No Module-Level Retry Action

`run-campaign-intelligence` only accepts `prepare`, `step`, and `finalize` (`supabase/functions/run-campaign-intelligence/index.ts:10`). Its dispatcher has no `retry_step` branch (`supabase/functions/run-campaign-intelligence/index.ts:568`), and failed step handling marks the single step as non-retryable by setting `attempt_count` to `maximum_attempts` and `retryable` to false (`supabase/functions/run-campaign-intelligence/index.ts:492`).

The current function is deterministic and single-step, so a full rebuild path may be acceptable. However, the broader Intelligence-page recovery model is "failed module -> retry module -> preserve successful modules -> resume/finalize OS." Campaign Intelligence is the only audited Intelligence authority surface without that action.

Impact:

- Operators cannot retry the failed Campaign Intelligence step directly.
- Recovery is via rebuild/new version rather than step retry.
- This is probably intentional for the Stage 4A scaffold, but it should be documented or implemented consistently.

Suggested correctness-only upgrade:

- Either explicitly document Campaign Intelligence as rebuild-only because it has one deterministic step, or add a narrow `retry_step` action with the same failed-step validation and release status restrictions used by the five main OS functions.

### P2 - Market, Avatar, And Brand Strategist Backend Retry Is Not Exposed In Their Panels

Backend retry exists for all five main Intelligence OS domains, and the helper maps all five (`src/lib/intelligence.ts:305`). The UI currently exposes module retry controls in Competitor OS and Association OS:

- Competitor imports `retryIntelligenceResearchStep` and provides retry buttons (`src/components/client/CompetitorOSPanel.tsx:7`, `src/components/client/CompetitorOSPanel.tsx:126`, `src/components/client/CompetitorOSPanel.tsx:187`, `src/components/client/CompetitorOSPanel.tsx:259`).
- Association imports `retryIntelligenceResearchStep` and provides retry buttons (`src/components/client/AssociationOSPanel.tsx:7`, `src/components/client/AssociationOSPanel.tsx:133`, `src/components/client/AssociationOSPanel.tsx:196`, `src/components/client/AssociationOSPanel.tsx:268`).

Market OS, Avatar OS, and Brand Strategist still render failed workflow steps as status-only rows with no retry action (`src/components/client/MarketOSPanel.tsx:197`, `src/components/client/AvatarOSPanel.tsx:197`, `src/components/client/BrandStrategistPanel.tsx:235`).

Impact:

- The edge functions are configured for retry, but operators cannot use the retry path from three of the five Intelligence OS panels.
- This matches the repo recovery board's documented UI gap (`docs/AA_INTELLIGENCE_OS_RECOVERY_BOARD_PLAN.md:36`).

Suggested correctness-only upgrade:

- Mirror the existing Competitor/Association retry UI in Market, Avatar, and Brand Strategist panels.
- Keep the same backend contract; no edge-function redesign is needed.

### P2 - `record-research-run` Has Stale Domain And Idempotency Edges

`record-research-run` is intentionally not a generator: it records supplied research sources and fails closed on empty source input. That role is consistent.

Issues found:

- Its hard-coded domain allowlist is limited to older research domains (`supabase/functions/record-research-run/index.ts:15`). It does not include the newer Intelligence OS domains added elsewhere in the system.
- It checks for an existing run by idempotency key before insert, but there is no duplicate-key recovery if concurrent requests race between the lookup and insert (`supabase/functions/record-research-run/index.ts:68`).
- If source insertion succeeds but the final status update fails, the function can return `COMPLETE_FAILED` after leaving the run in `running` (`supabase/functions/record-research-run/index.ts:112`).

Impact:

- The function may not be usable for newer Intelligence OS research evidence unless the older domain set is intentional.
- Duplicate concurrent submissions can produce a 500 instead of returning the existing idempotent run.
- A completed source write can leave an operationally confusing `running` run.

Suggested correctness-only upgrade:

- Align the domain allowlist with the current `client_research_runs.research_domain` contract, if this function is still intended to support Intelligence research recording.
- Handle duplicate idempotency insert errors by re-selecting the existing row.
- If the final status update fails, mark the run `failed` or `retryable` where possible instead of leaving it `running`.

### P3 - Finalizers Query More Client Records Than Necessary

Several finalizers load records/findings broadly for the client and then filter to the release in application code. Example: `run-market-os` loads records/findings then filters release-specific rows later (`supabase/functions/run-market-os/index.ts:602`).

Impact:

- This is not currently a lifecycle correctness failure.
- It can become a performance and memory issue as client evidence grows.
- It slightly increases the risk of future mistakes where a non-release-filtered row is accidentally included in finalize logic.

Suggested correctness-only upgrade:

- Push `release_id` filtering into Supabase queries wherever the table schema supports it.
- Keep the output contract and function responsibilities unchanged.

## Function-By-Function Notes

### `run-market-os`

Status: Correctly aligned with the core OS pattern, with cleanup error handling caveat.

- Requires approved context authority.
- Supports `prepare`, `step`, `finalize`, and `retry_step`.
- Checks authority snapshot drift before running steps.
- Finalizes to `needs_review`; approval remains human-gated.
- Retry resets failed steps to queued and keeps successful modules.
- Needs cleanup error checks before requeue.

### `run-avatar-os`

Status: Correctly aligned with the core OS pattern, with cleanup error handling caveat.

- Requires approved Market OS and approved context authority.
- Supports `prepare`, `step`, `finalize`, and `retry_step`.
- Checks Market/context drift before running steps.
- Finalizes to `needs_review`; approval remains human-gated.
- Needs cleanup error checks before requeue.
- Backend retry is present, but the Avatar OS panel does not expose retry buttons.

### `run-competitor-os`

Status: Correctly aligned with the core OS pattern, with cleanup error handling caveat.

- Requires approved Market OS, Avatar OS, and context authority.
- Supports dynamic follow-up steps.
- Supports `retry_step`.
- UI exposes single-module and all-failed retry controls.
- Needs cleanup error checks before requeue.

### `run-association-os`

Status: Correctly aligned with the core OS pattern, with cleanup error handling caveat.

- Requires approved Market OS, Avatar OS, Competitor OS, and context authority.
- Supports dynamic association mapping workflow.
- Supports `retry_step`.
- UI exposes single-module and all-failed retry controls.
- Needs cleanup error checks before requeue.

### `run-brand-strategist`

Status: Correctly aligned with the core OS pattern, with cleanup error handling caveat.

- Requires approved Market, Avatar, Competitor, and Association authority.
- Synthesizes recommendations rather than approving or mutating upstream authority.
- Supports `retry_step`.
- Finalizes to `needs_review`; approval remains human-gated.
- Needs cleanup error checks before requeue.
- Backend retry is present, but the Brand Strategist panel does not expose retry buttons.

### `run-campaign-intelligence`

Status: Mostly aligned with Stage 4A intent, but release immutability needs correction.

- Requires active approved releases from all five upstream Intelligence OS domains.
- Does not generate offers or content ideas.
- Produces review-gated campaign periods and source links.
- Has deterministic scaffold behavior and no provider calls in current implementation.
- Does not support `retry_step`.
- Needs Campaign release-level immutability and stricter finalize status guard.

### `record-research-run`

Status: Role is clear, but domain/idempotency/status handling should be tightened.

- Records supplied sources; does not generate research.
- Fails closed for empty source input.
- Could be stale relative to current Intelligence OS research-domain vocabulary.
- Needs duplicate idempotency handling and stuck-running protection on final update failure.

## Tests And Coverage Observed

Relevant tests exist for:

- Market OS provider/parser/source/immutability strings and orchestration (`tests/market-os.test.ts`).
- Avatar OS action contract and review-gated finalization (`tests/avatar-os.test.ts`).
- Competitor OS retry/action contract and review-gated finalization (`tests/competitor-os.test.ts`).
- Association OS retry/action contract and review-gated finalization (`tests/association-os.test.ts`).
- Brand Strategist retry/action contract and review-gated finalization (`tests/brand-strategist.test.ts`).
- Campaign Intelligence separation, approved upstream requirement, review gate, and "no offers/content generation" contract (`tests/campaign-intelligence.test.ts`).
- Shared Intelligence retry helper mapping (`tests/intelligence-recovery.test.ts`).
- Evidence origin/release id requirements (`tests/intelligence-evidence-origin.test.ts`).

Coverage gaps:

- No test currently proves Campaign Intelligence release rows are immutable after approval.
- No test currently proves `run-campaign-intelligence` finalize cannot demote an approved release.
- No test currently proves cleanup failure aborts `retry_step`.
- No test currently proves Market, Avatar, and Brand Strategist panels expose retry controls.
- No test currently proves `record-research-run` handles duplicate idempotency races.

## Read-Only Recommendation Set

These are correctness/safety upgrades only. They do not change the intended role of any function.

1. Add Campaign Intelligence release-level immutability and finalize status guards.
2. Make all Intelligence `cleanupStepArtifacts` helpers fail closed on delete errors.
3. Decide and document whether Campaign Intelligence is intentionally rebuild-only; if not, add narrow `retry_step`.
4. Expose existing backend retry controls in Market, Avatar, and Brand Strategist UI panels.
5. Tighten `record-research-run` domain alignment, duplicate idempotency handling, and final status failure handling.
6. Push release filtering into finalizer queries where possible.
7. Add targeted regression tests for the above.

## Conclusion

The five main Intelligence OS edge functions meet the core design: structured runs, leased module execution, explicit upstream dependencies, review-gated drafts, human approval, active-release promotion, and backend module retry.

The build has not fully met the audit target for the whole Intelligence authority surface because Campaign Intelligence lacks release-level immutability parity, retry cleanup is not fail-closed, and backend retry parity is not fully exposed in the UI for Market OS, Avatar OS, and Brand Strategist.
