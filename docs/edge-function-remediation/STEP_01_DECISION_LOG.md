# Edge Function Remediation Decision Log

Status: active baseline
Created: 2026-08-13
Applies to: `docs/EDGE_FUNCTION_REMEDIATION_10_STEP_BUILD_PLAN.md`

## 1. Purpose

This log records the architecture and release decisions needed before runtime remediation begins. Decisions are constrained to preserving the current product and function objectives.

Statuses:

- `decided`: existing architecture provides sufficient authority.
- `held`: implementation must not proceed until the named evidence or owner decision exists.
- `release_gate`: applies during deployment/release rather than local implementation.

## 2. Decisions

### `EF-D-001` - Staff role does not replace client access validation

- Status: `decided`
- Decision: Any active UI-callable function that uses a service-role client must verify both the existing allowed staff role and the caller's access to the target client/resource before service-role reads, writes, storage operations, or provider calls.
- Basis: The repo already uses the stronger `validateIdeationAccess` pattern. The audit identified inconsistent use of that established boundary, not a need for a new tenancy model.
- Constraint: Step 3 must reuse the current client-visibility model. It must not invent account teams, new assignments, or new role types.
- Affected ledger: `EF-AUTH-001`, `EF-AUTH-002`, `EF-AUTH-003`, `EF-OWNERSHIP-002`, `EF-OWNERSHIP-004`.

### `EF-D-002` - `validate-execution-pack` remains a validation helper with authenticated client scope

- Status: `decided`
- Decision: Preserve `validate-execution-pack` as the validation helper called by `generate-phase-2` and `generate-phase-3`. It must verify the authenticated caller and target client; no new public/operator workflow will be added.
- Basis: Local source shows only the two current function-to-function callers and no UI caller.
- Constraint: Step 3 must preserve the original bearer/client context or introduce an equally narrow verifiable internal-caller contract. It must not rely on an unscoped service-role request.
- Affected ledger: `EF-AUTH-004`.

### `EF-D-003` - Canonical intended function posture is version-controlled locally

- Status: `decided`
- Decision: The Step 2 registry is the canonical intended posture for caller, lifecycle, deployment eligibility, JWT mode, method, and alternate authentication. `supabase/config.toml` remains the canonical locally versioned Supabase function configuration where supported.
- Basis: Audit 10 found no single registry and a known mismatch between local config and documented remote worker posture.
- Constraint: The registry documents intent; it does not become a runtime router. Verified remote state is evidence to reconcile in Step 9, not a substitute for version-controlled intent.
- Affected ledger: `EF-WORKER-003`, `EF-WORKER-004`, `EF-RETIRE-002`.

### `EF-D-004` - Retired functions are quarantined, not repaired

- Status: `decided`
- Decision: The ten superseded-era functions identified by the audit are retired. Their authorization, webhook, payment, messaging, scraping, and old-schema defects will not be repaired as active features.
- Retired set: `apify-scrape`, `brief-generator`, `dialog360-send`, `meta-ad-ops`, `meta-webhook`, `mjr-generate`, `mrr-calc`, `onboarding`, `payfast-create-link`, `payfast-webhook`.
- Constraint: Step 9 may quarantine, tombstone, exclude, or decommission these functions. It may not reactivate PayFast, ZAR, old Meta, Dialog360, old MRR, old onboarding, or old entity/campaign architecture.
- Affected ledger: `EF-RETIRE-001`, `EF-RETIRE-002`.

### `EF-D-005` - Remote deployment status is unknown until explicitly verified

- Status: `held`
- Owner: Alex for authorization; Cockpit engineering for read-only collection and report.
- Decision needed: Confirm which of the 109 local function names are deployed remotely and whether any retired/held function is live.
- Current rule: Do not infer deployment from local folders, comments, old docs, or frontend callers. Do not deploy/delete anything to answer the question.
- Resolution point: Step 9, using an explicitly authorized read-only remote inventory before any decommission proposal.
- Affected ledger: `EF-DESTRUCT-001`, `EF-WORKER-003`, `EF-RETIRE-001`, `EF-RETIRE-002`.

### `EF-D-006` - P1 test bar

- Status: `decided`
- Decision: Every P1 correction requires:
  1. a focused regression test proving the original failure;
  2. a success-path test preserving the function objective;
  3. a failure-before-side-effect test for auth/policy/provider boundaries;
  4. a concurrency/failure-injection test for transaction/race findings;
  5. the full deterministic test suite;
  6. `npm run typecheck`;
  7. `npm run build`.
- Provider tests must use injected/mocked dependencies before Step 10; no live spend, publish, email, generation, storage mutation, or authority mutation is authorized during Steps 1-9.
- Affected ledger: every P1 item.

### `EF-D-007` - Approved authority is preserved until atomic promotion

- Status: `decided`
- Decision: A replacement draft never displaces current approved/active authority. Supersession and active-pointer movement occur only as one atomic human approval/promotion transaction.
- Basis: This matches the existing human-review principle and fixes the cross-module drift identified by Audits 02-09.
- Constraint: No remediation may auto-approve a generated replacement.
- Affected ledger: `EF-AUTHORITY-001` through `EF-AUTHORITY-007`, plus `EF-TXN-003` where handoff creates downstream authority.

### `EF-D-008` - Retry preserves unaffected approved work

- Status: `decided`
- Decision: Where an existing module-level retry is part of the approved design, retry must be step-scoped, non-destructive, and preserve unaffected successful/approved components. Full rebuild remains a separate action.
- Constraint: Missing retry functionality is not blanket authorization to add a new retry model. Items marked `verification_required` must first prove the intended recovery contract from current UI/docs.
- Affected ledger: `EF-RETRY-001`, `EF-RECOVERY-001`, `EF-RECOVERY-002`, `EF-RECOVERY-003`, `EF-RECOVERY-004`.

### `EF-D-009` - Asset job authority requires an explicit frozen/current contract

- Status: `held`
- Owner: Cockpit engineering to establish existing intended behavior from migrations/docs; Alex only if evidence remains ambiguous.
- Decision needed: Determine whether an asset-generation job freezes the approved brief authority at job creation or must revalidate that authority before every queued item.
- Safe interim rule: No change may silently switch between models. Step 6 must persist/verify a fingerprint if frozen, or revalidate current approved authority if live-current.
- Affected ledger: `EF-WORK-AUTHORITY-001`.

### `EF-D-010` - Production review remains fail-closed; state advancement is held

- Status: `held`
- Owner: Cockpit engineering to reconcile current Production Studio docs and state machine.
- Decision: Step 5 may fix missing/failed deterministic checks so an invalid approval cannot be recorded. It may not add downstream status advancement unless the original accepted contract proves the review is a gating transition rather than an audit log.
- Affected ledger: `EF-PRODUCTION-003`.

### `EF-D-011` - Destructive functions require posture confirmation before runtime changes

- Status: `held`
- Owner: Alex for intended deployability; Cockpit engineering for evidence.
- Decision needed: Reconcile `HELD` source comments, UI wrappers, and actual remote deployment posture for `plan-destructive` and `execute-destructive`.
- Safe interim rule: Add no feature, deploy no function, and remove no UI action until posture is confirmed. Recovery documentation may proceed.
- Affected ledger: `EF-DESTRUCT-001`, `EF-DESTRUCT-002`.

### `EF-D-012` - No risk is accepted silently

- Status: `decided`
- Decision: Step 1 assigns zero items to `accepted_risk`. Any future accepted risk requires Alex's explicit decision, rationale, owner, review date, and compensating control.
- Affected ledger: all items.

### `EF-D-013` - Existing dirty worktree must be checkpointed before Step 2 implementation

- Status: `release_gate`
- Decision: The pre-remediation worktree contains uncommitted Stage 4/5, audit, migration, frontend, function, and test changes. Step 1 documents them but does not alter them. Before Step 2 changes begin, those existing changes must be intentionally committed/pushed, separated, or otherwise checkpointed under explicit instruction.
- Reason: Without a checkpoint, remediation diffs cannot be reliably isolated or rolled back.
- Constraint: Step 1 itself does not commit or push.

### `EF-D-014` - Deployment and live smoke testing occur only in Step 10

- Status: `release_gate`
- Decision: Steps 1-9 may implement and verify locally. Migrations, function deploys, secret changes, live provider calls, and live smoke tests require explicit authorization and the Step 10 release procedure.
- Constraint: Read-only remote inventory in Step 9 also requires explicit authorization under this programme.

## 3. Held Decision Exit Criteria

| Decision | Exit evidence |
| --- | --- |
| `EF-D-005` | Authorized remote function inventory reconciled with registry. |
| `EF-D-009` | Current job schema/docs/tests establish frozen-authority or live-current behavior; otherwise Alex decides. |
| `EF-D-010` | Current Production Studio state-machine authority establishes whether review is gating or logging. |
| `EF-D-011` | Current intended destructive-function posture and remote deployment evidence agree. |
| `EF-D-013` | Existing dirty worktree has an intentional checkpoint or isolated remediation branch/worktree. |

## 4. Change-Control Rule

Any future decision that changes a function's original objective must not be added to this log as a remediation decision. It must be raised as a separate product/build proposal outside the ten-step remediation programme.
