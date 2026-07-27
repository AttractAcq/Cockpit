# AA Ideation PR 1.1 — Reliability, Integrity, and Release Hardening

Date: 2026-07-27
Status: final remediation implemented; exact-schema compatibility validation blocked pending an authoritative dump
Frozen authority baseline: `docs/AA_PHASE_1_PHASE_2_FROZEN_BASELINE.md`

## Review Finding Resolution

| Finding | Resolution |
|---|---|
| Three-month range failure | Server/UI/DB accept up to 31 inclusive days and up to three touched months |
| Permanently running cycles | Owner-bound 180-second lease, heartbeat, atomic expiry reclamation, terminal owner checks |
| Open-ended run creation | Canonical ordered seven-slug module; exact validated payload passed to begin; exact result-set completion |
| Ambiguous quantity | Exact `aa.ideation.quantity.v1` section parsed once per month; no prose scan or fallback |
| Ungrounded evidence | Source registry plus verified exact quote/paraphrase/derived claim contracts and numerical-claim checks |
| Permanent partial completion | Stable slot allocation, retained successes, `retryable` cycle, missing-index retry, three-attempt cap |
| Incomplete idempotency | Immutable snapshot hashes separately classified authority plus technique/prompt/model/schema/module/quantity/retry configuration |
| Execution trust inversion | Approved Execution is trusted operating authority; external evidence is non-instructional data |
| Editor inconsistency | Edge eligibility limited to admin/account manager; no global editor-policy change |
| Provenance conflation | Separate source and analysis columns/JSON with provider/model/version/timestamp attribution |
| Global policy regression | Ideation no longer alters `playbooks` or `playbook_runs`; dedicated technique-run writes remain service-only |
| Stale frontend requests | AbortController plus monotonic request token and complete client-state reset |
| Weak release tests | Behavioral Node tests plus disposable PostgreSQL migration/RLS/lifecycle tests |
| Incomplete compiler/Edge checks | Lockfile snapshot typecheck/build and local Edge Runtime bundle |
| Modal focus | Unique ARIA IDs, initial/trapped/restored focus, Escape/backdrop cleanup |
| Dead API success check | `invokeFn` remains the throwing failure boundary; `runIdeation` returns success only |

## Lease State Machine

```text
new
  → running(owner, expiry, attempt 1)
      → completed                 terminal
      → retryable                 lease cleared
      → failed                    terminal

running + expired
  → running(new owner, attempt + 1)

retryable
  → running(new owner, attempt + 1)
```

An unexpired lease returns `RUN_IN_PROGRESS`. Only the current owner can
heartbeat, complete, or fail. A dead worker cannot block the key permanently:
after expiry a new invocation atomically takes ownership. Successful candidate
indexes persist and only missing retryable indexes are generated. The immutable
three-attempt cap is checked under row lock; final expiry becomes terminal
`IDEATION_ATTEMPTS_EXHAUSTED`. A required non-retryable technique shortfall makes
the cycle terminal and is never regenerated.

## Allocation Integrity

The completion RPC derives the technique run from the cycle and canonical slug,
then validates the candidate index against that run’s immutable
`requested_slots`. The allocated asset type must match exactly. Composite foreign
keys bind candidate → research → technique run → cycle → client, and the
transaction rejects wrong-run, wrong-cycle, cross-technique, duplicate,
out-of-range, or already-filled slots.

A cycle completes only when every requested slot for every technique is present
once, every asset matches its allocation, every technique has zero failed slots,
and the per-technique totals reconcile with the immutable quantity plan.
Aggregate candidate count is never sufficient.

## Quantity Authority

The exact required section is:

```text
## Ideation Quantity Contract
schema: aa.ideation.quantity.v1
reel_per_week: <0..14>
carousel_per_week: <0..14>
static_per_week: <0..14>
story_per_week: <0..14>
```

One and only one approved E02/E04/E05 file per month may contain the section.
All three relevant files must exist exactly once. Numbers outside the section
are ignored. Monthly configurations may differ and their requested-period
contributions are persisted independently.

## Evidence and Trust

Each evidence source contains a stable ID/ref, source type/URL, bounded excerpt,
and content hash. Candidate evidence must be one of:

- a verbatim `exact_quote`;
- a `paraphrase` with a registered normalized-verbatim support span tied to the
  exact persisted candidate-field claim;
- a reasoned `derived_claim`.

Source IDs, ref/URL pairs, quotation text, support spans, evidence presence,
non-empty findings, complete normalized numeric tokens, and high-risk claims are
validated across findings, candidate fields, and evidence notes. Weak generic
business nouns cannot independently establish support. Deterministic thresholds
require 2 shared strong concepts for 2–4-concept claims, 3 for 5–7, and at least
40% (minimum 3) for longer claims. Outcome, causal, universal, guarantee,
certainty, leadership, superiority, multiplier, superlative, and
competitor-performance propositions require direct same-sentence support;
numbers remain an independent exact-token gate. Approved
Execution instructions remain
binding; approved client-specific strategic playbooks remain a separate governing
authority class above Context and technique logic. External research can contain hostile instructions but is always
presented as untrusted data and cannot override application rules.

## Policy Compatibility

New domain tables remain caller-RLS SELECT-only and service-role mutation-only.
RPC execution is service-role only. The migration makes no schema, grant, policy,
or data change to `playbooks` or `playbook_runs`; direct Ideation technique-run
mutation is rejected.

Deployment-time recheck:

1. Confirm `playbooks` and `playbook_runs` definitions, row counts, grants, and
   policies are unchanged.
2. Confirm the Phase 1 strategic-system file set matches the frozen classifier.
3. Confirm Phase 2 still consumes the established `contextFileNumbers`.
4. Confirm the code-owned seven-technique manifest version.
5. Confirm approved quantity authority for intended smoke-test months.

## Validation Boundary

The explicitly synthetic `tests/ideation-pr1-baseline.sql` remains useful only
for isolated SQL behavior. It is not deployed-schema compatibility proof.

For the authorised Stage 1 operational release, a schema-only export of the
linked project was stored in a temporary ignored path and supplied to
`tests/validate-ideation-pr1-schema.sh` through `IDEATION_SCHEMA_BASELINE`. The
script restored that exact baseline into a fresh disposable PostgreSQL 17
container, ran dependency and collision preflight, snapshotted frozen objects,
applied the migration with `ON_ERROR_STOP=1`, ran
postflight/integration/RLS/adversarial/concurrency validation, compared the
frozen snapshot, and removed the container. No table data was exported.

That exact-schema route passed on 2026-07-27. The additive Ideation migration
was subsequently applied as the sole pending release migration, post-deployment
postflight and frozen-schema comparison passed, and `run-ideation` was deployed
with JWT verification enabled.

Local results on 2026-07-27:

- Node behavioral suite: 26/26 passed.
- Handler-level Edge suite: 13/13 passed.
- Clean disposable baseline, migration, integration, adversarial RLS/allocation,
  and two-worker concurrency SQL: passed with `ON_ERROR_STOP=1`.
- Full TypeScript check: passed.
- Production Vite build: passed (existing chunk-size warning only).
- Complete `run-ideation` Edge Runtime eszip bundle: passed.

## Prohibited Systems

The transitive runtime and migration contain no reference or mutation path to
organic, story, ads, Calendar, production briefs, Reel Studio, video, storyboard,
render, distribution, analytics, or performance tables. Legacy Phase 3 and all
existing downstream behavior remain unchanged.
