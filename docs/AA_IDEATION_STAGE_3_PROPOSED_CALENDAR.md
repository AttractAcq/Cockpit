# AA Ideation Stage 3 — Create Proposed Calendar

Active specification for Stage 3 of the locked five-stage Ideation build.

## The locked five-stage plan

| Stage | Scope | State |
| --- | --- | --- |
| 1 | Operational candidate generation | Accepted baseline (`a84eba3`) |
| 2 | Score and sort generated candidates | Complete and deployed (`fb11d16`) |
| 3 | Create and approve a proposed Calendar | **This document** |
| 4 | Commit approved content into Calendar and `organic_master` | Next build, not started |
| 5 | Full end-to-end verification | Not started |

The stages are not redesigned, merged, or reordered. The full Ideation system is
**not** complete.

### IDEATION-D1 — Markdown evidence-span compatibility (still deferred)

Approved Context Files often contain Markdown bullets and tables that do not
consistently satisfy the prose-oriented Stage 1 `support_span` contract, so live
generation can fail validation. This remains **open and deferred** for resolution
no later than Stage 5, together with the first live
generation → scoring → proposal → commit test.

Stage 3 does not weaken Stage 1 grounding, does not re-author approved Context
Files, and does not require live candidate records. It was validated entirely
against deterministic, clearly labelled test-only fixtures in disposable
databases. **No proposal has been generated against production data, and no
synthetic proposal record exists in the linked project.**

## Purpose

An operator opens a completed Ideation run, reviews its completed scoring run,
and clicks **Create Proposed Calendar**. The system rebuilds the exact authority,
plans a deterministic slot manifest, reads existing Calendar occupancy, and asks
the model to place each scored candidate on a slot. The proposal opens in a
review interface where the operator can move, swap, remove, and restore
candidates, refresh conflicts, and finally approve.

An approved proposal is **advisory and Ideation-owned**. Approval is explicitly
not a commit: no `calendar_cells`, `organic_master`, `story_master`, `ads_master`,
production brief, asset, distribution, or analytics row is created or changed.

## Eligibility

A proposal may only be created when the caller is an authorized admin or account
manager for the client and:

- the cycle belongs to that client, is `completed`, has zero shortfall, and its
  generated count equals its expected count;
- the scoring run belongs to that cycle and client, is `completed`, has zero
  failures, and its scored count equals the expected count;
- every expected candidate carries exactly one score in that run;
- ranks are unique and gap-free from 1 through N;
- candidate content and evidence hashes still match the Stage 2 snapshot;
- every allocated Stage 1 slot is filled exactly once by a candidate of the
  allocated asset type;
- the requested period matches the originating cycle exactly.

Failed, partial, retryable, exhausted, cross-client, and cross-cycle inputs are
all rejected with typed non-retryable codes before authority is reconstructed and
before any provider call.

## Authority contract

Stage 3 reconstructs the cycle's exact authority by id, re-verifying `version`
and `sha256(content_md)` against the recorded snapshot, keeping Context,
strategic, and Execution authority separately classified. Any drift fails closed
with `AUTHORITY_SNAPSHOT_MISMATCH`; a materially changed authority version
requires a new Ideation cycle. Stage 3 never mutates `client_context_files`,
`client_execution_files`, `playbooks`, `playbook_runs`, Phase 1 state, or
Phase 2 state.

## Slot manifest — planner `aa.ideation.slot-planner.v1`

Phase 3's `planWindowSlots` is cadence-driven and emits whatever count a weekday
cadence yields. Stage 3 needs the opposite guarantee — exactly the immutable
Stage 1 quantity allocation — so it has its own versioned planner that reuses
Phase 3 conventions verbatim (UTC-safe inclusive date iteration, the same system
default weekday cadence, and the same `{date}:{format}:{ordinal}` key shape).
Phase 3 behaviour is neither modified nor called.

Planning precedence:

1. explicit weekday requirements from an approved Execution
   `## Ideation Schedule Contract` section (more than one is ambiguous and fails
   closed);
2. the immutable per-asset-type quantity requirement, always exact;
3. deterministic spread across the inclusive period.

**Deterministic fallback.** For each asset type independently: enumerate every
date in the inclusive period; take the dates matching the cadence weekdays; if
there are at least as many as required, pick exactly `count` of them by
`index → floor(index * candidates.length / count)`, which is stable, monotonic,
and never clusters at one end. If the cadence supplies too few dates, use all of
them and spread the shortfall over the remaining dates by the same formula. Only
when placements exceed available dates may two slots of one asset type share a
date, distinguished by an ascending per-date ordinal.

Guarantees, all asserted by tests: total slots equal the allocation; per-asset
totals reconcile exactly; every slot lies inside the inclusive period; slot keys
are unique; identical inputs always produce an identical manifest; a month
boundary or leap day never shifts a date.

## Calendar conflict snapshot

Stage 3 reads `calendar_cells` for the client and period — a bounded projection
of id, date, row_type, ref, review_state, and updated_at, never a content body.
Conflict states are `clear`, `occupied`, `protected`, `date_capacity_exceeded`,
and `stale_calendar_snapshot`; the last three block approval. An approved or
archived operational row makes a slot `protected`; an unapproved row makes it
merely `occupied`.

The snapshot carries an order-independent digest. At approval the live Calendar
is re-read; if the digest differs, approval fails with
`PROPOSAL_CALENDAR_SNAPSHOT_STALE` and the operator must refresh conflicts and
review again. Operator edits are preserved across a refresh.

## AI responsibility

The model only pairs a registered candidate with a registered slot and writes a
short placement rationale, registered authority references, registered evidence
references, and optional codes from a fixed warning list. Dates, ordinals, asset
types, scores, ranks, conflict states, approval, and every operational
identifier are server-owned; supplying one is rejected as a contract violation
rather than silently ignored. Exact result-set validation applies per batch, a
partial batch never completes, and `stop_reason === "max_tokens"` always fails
with one bounded correction available.

## Persistence and statuses

`client_ideation_calendar_proposals` and
`client_ideation_calendar_proposal_slots`, both service-role write only.

| Status | Meaning |
| --- | --- |
| `running` | Provider-owned, lease held |
| `retryable` | Reclaimable within the attempt cap |
| `failed` | Terminal |
| `draft` | Generated and editable |
| `approved` | Immutable, ready for Stage 4 |
| `superseded` | Historical, read-only |

A proposal reaches `draft` only after exact candidate and slot reconciliation. A
draft **may** hold an unassigned candidate — removing one to the unassigned pool
is a supported edit — and full assignment is re-enforced at approval by both the
approval RPC and a table CHECK.

Database guarantees include: proposal client matches the cycle client; the
scoring run belongs to the cycle; slot client, cycle, and scoring run match the
proposal; the candidate belongs to the same client and cycle; the score belongs
to the same scoring run; one candidate per proposal; one slot key per proposal;
the slot date lies within the proposal period; the candidate asset type equals
the required asset type; a slot is either fully assigned or fully empty; and the
display reference can never imitate an operational master ref.

The one additive change to an existing table is a composite unique constraint on
`client_ideation_candidate_scores (id, scoring_run_id)`, needed for the ownership
foreign key; `id` is already the primary key.

## Transactions

Nine `SECURITY DEFINER` RPCs with `search_path = public`, revoked from
`public`/`anon`/`authenticated` and granted only to `service_role`:
`begin_ideation_calendar_proposal`, `renew_ideation_proposal_lease`,
`persist_ideation_proposal_batch`, `complete_ideation_calendar_proposal`,
`fail_ideation_calendar_proposal`, `edit_ideation_proposal_assignment`,
`refresh_ideation_proposal_conflicts`, `approve_ideation_calendar_proposal`, and
the internal `recount_ideation_proposal`.

Maximum attempts is 3; attempt 3 is terminal. Active replay returns the
in-progress proposal; draft, approved, superseded, and failed replays make no
provider call. A retry proposes only the slots still open.

## Idempotency

The configuration hash covers client, cycle id and Stage 1 configuration hash,
scoring run id and Stage 2 configuration hash, every candidate id, content hash,
evidence hash, asset type, technique slug, index, rank and scheduling-relevant
dimension scores, the exact Context/strategic/Execution authority identity, the
quantity contract, the inclusive period, the slot-planner version and manifest,
the Calendar conflict snapshot identity, the prompt construction and digest, the
model, provider budgets, batch strategy, retry configuration, output schema
version, and the Stage 3 module version. Request ids, lease tokens, timestamps,
and worker state are excluded.

The identity is derived entirely server-side:

```
proposal:{cycle}:{scoring_run}:{hash[0:24]}                       initial
proposal:{cycle}:{scoring_run}:{hash[0:24]}:after:{previous_id}   regeneration
```

A caller cannot supply or manipulate it, and unknown request fields are rejected.

## Regeneration

**Regenerate Proposal** requires explicit confirmation, names a real draft or
approved predecessor for the same cycle, creates a new proposal at the next
version, records `supersedes_proposal_id`, and uses the current Calendar
snapshot. History is never overwritten and an approved proposal is never
modified. The scoring run is carried forward explicitly; it is never silently
switched. When a replacement proposal is approved, the previously active approved
proposal becomes `superseded` and both remain auditable.

## Manual editing

Move, swap, remove, and restore, plus refresh conflicts. Every edit checks
proposal and client ownership, requires status `draft`, requires the operator's
loaded `edit_revision` (a stale revision fails with
`PROPOSAL_EDIT_REVISION_CONFLICT` rather than overwriting a newer edit),
re-validates asset-type compatibility and slot occupancy, recomputes conflict
counters, atomically increments the revision, and writes `activity_log`. Asset
type, date, score, and rank are never altered by an edit. Approval is disabled
while any candidate is unassigned. No drag-and-drop is required: every action is
a labelled select plus button.

## Approval

**Approve Proposed Calendar** requires confirmation and transactionally
re-verifies status, ownership, cycle and scoring-run eligibility, exact candidate
reconciliation, full assignment, zero unresolved conflicts, candidate and score
drift, the Calendar digest, and the expected edit revision. It sets `approved_at`
and `approved_by`, preserves every slot, supersedes a prior approved proposal,
and writes `activity_log`. It creates no operational Calendar or master row.

## Authorization and RLS

`admin` and `account_manager` only. The request body cannot spoof role or client
access, and unknown fields are rejected. Authenticated staff may `SELECT`
proposals and slots for accessible clients only; anonymous access and all direct
`INSERT`/`UPDATE`/`DELETE` are denied. Stage 1, Stage 2, Phase 1, Phase 2,
playbooks, Calendar, and master policies are unchanged.

## Candidate display reference

Stage 3 must not create or imitate an operational content ref. It derives a
deterministic Ideation-only reference from immutable identity:
`IDEATION/{cycle8}/{TECH}-{ASSET}-{nn}`, for example
`IDEATION/691f99b6/RMP-RL-01`. The leading segment and slashes make it
unmistakably non-operational; a table CHECK enforces the `IDEATION/` prefix. It
is stable across regeneration and suitable for Stage 4 provenance.

## Explicitly out of scope

Stage 3 adds no Commit Content, operational Calendar write, master write,
content-master reference, production brief, asset generation, Reel Studio
integration, publishing, distribution, analytics, iteration, automatic approval,
candidate rewriting, or scoring change. Automated tests assert that the complete
Stage 3 runtime and migration reach none of those domains and that Stage 1's
generation runtime does not import Stage 2 or Stage 3 modules.

## Next build

**Stage 4 — Commit approved content into Calendar and `organic_master`.** Do not
begin it without explicit sign-off.
