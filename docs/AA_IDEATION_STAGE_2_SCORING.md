# AA Ideation Stage 2 — Score and Sort Content

Active specification for Stage 2 of the locked five-stage Ideation build.

## The locked five-stage plan

| Stage | Scope | State |
| --- | --- | --- |
| 1 | Operational candidate generation | Accepted baseline (commit `a84eba3`) |
| 2 | Score and sort generated candidates | **This document** |
| 3 | Create and approve a proposed Calendar | Built — see `docs/AA_IDEATION_STAGE_3_PROPOSED_CALENDAR.md` |
| 4 | Commit approved content into Calendar and `organic_master` | Not started |
| 5 | Full end-to-end verification | Not started |

The stages are not reordered or redesigned. Stage 2 adds scoring and ranking and
nothing else.

## Stage 1 accepted baseline

Stage 1 is frozen for Stage 2 purposes. Its candidate-generation contract,
grounding validator, technique manifest, quantity allocation, leases, retries,
idempotency, and RLS are unchanged by this stage. The only Stage 1 file Stage 2
modifies is `src/lib/ideation-request-coordinator.ts`, which gains three
additional mutation kinds (`score`, `retry-score`, `rescore`); existing kinds
behave identically.

### IDEATION-D1 — Markdown evidence-span compatibility (deferred)

Approved Context Files use Markdown bullets and tables, while the Stage 1
candidate validator expects a verbatim `support_span` that behaves like prose.
Live model responses can therefore fail Stage 1 validation. This is **consciously
deferred** and must be resolved no later than Stage 5.

Stage 2 does not weaken the Stage 1 grounding validator, does not re-author
approved Context Files, and does not depend on a live completed Stage 1 cycle.
Stage 2 was validated entirely against deterministic, clearly labelled test-only
fixtures in disposable databases. **No Stage 2 scoring has been run against
production candidates, and no synthetic scoring record exists in the linked
project.** The first live generation-to-scoring integration test is deferred to
Stage 5 together with IDEATION-D1.

## Purpose

An operator opens a completed Ideation run, reviews the generated candidate
ideas, and clicks **Score and Sort Content**. Every candidate is evaluated by the
model against the same approved authority the cycle used, scores and reasoning
are persisted, and the set is ranked deterministically from highest to lowest.

Candidates and their scores remain **advisory and non-authoritative**. Stage 2
adds no approval, rejection, dismissal, shortlisting, selection, Calendar
proposal, Calendar allocation, commit, master write, production brief, asset,
publishing, distribution, analytics, or iteration path.

## Scoring eligibility

A cycle may be scored only when all of the following hold:

- the cycle belongs to the requested client and the caller is authorized for it;
- `status = 'completed'`;
- `shortfall_count = 0`;
- `candidate_count = expected_candidate_count`;
- every allocated slot `(technique_slug, candidate_index)` is present exactly once;
- every candidate belongs to the correct cycle, client, and technique run;
- every candidate's asset type matches its allocated slot;
- every candidate carries valid evidence and generation provenance.

Failed, retryable, running, partial, mis-counted, duplicate-slot, missing-slot,
and cross-client cycles are all rejected before any authority is reconstructed
and before any provider call is made. The current live Stage 1 cycles have zero
candidates and are therefore not eligible.

## Scoring authority contract

Scoring never silently uses whatever authority happens to be current. It
reconstructs the exact authority identity recorded in the cycle's
`configuration_snapshot.authority`:

1. each Context, strategic, and Execution file is re-read by id;
2. its `version` must match the snapshot;
3. `sha256(content_md)` must match the snapshot `content_hash`;
4. Context, strategic, and Execution authority stay separately classified,
   preserving the Stage 1 hierarchy;
5. any drift — changed content, changed version, deleted row, malformed or empty
   snapshot — fails closed with `AUTHORITY_SNAPSHOT_MISMATCH` or
   `AUTHORITY_SNAPSHOT_INVALID`.

A changed authority version therefore requires a new Ideation cycle; it can never
silently re-base an old cycle's scoring. Stage 2 never mutates
`client_context_files`, `client_execution_files`, `playbooks`, `playbook_runs`,
Phase 1 state, or Phase 2 state.

## Rubric — `aa.ideation.scoring.v1`

Ten dimensions, each an integer 0–10, weights totalling 100.

| # | Dimension | Weight |
| --- | --- | --- |
| 1 | Execution-plan alignment | 20 |
| 2 | Business and positioning alignment | 15 |
| 3 | Audience and pain relevance | 15 |
| 4 | Proof and evidence strength | 15 |
| 5 | Hook and attention strength | 10 |
| 6 | Commercial potential | 10 |
| 7 | Specificity and clarity | 5 |
| 8 | Originality and distinctiveness | 5 |
| 9 | Platform and format fit | 3 |
| 10 | Production feasibility | 2 |

### Server-calculated overall score

The model supplies **only** the ten dimension scores. The server calculates:

```
overall_score = round( sum( (dimension_score / 10) * dimension_weight ) )
```

Evaluated as `round(sum(score * weight) / 10)` so the intermediate sum stays an
exact integer. Always an integer in 0–100. A model-supplied `overall_score`,
`priority_band`, or `rank` is **rejected as a contract violation**, not silently
ignored.

### Priority bands

| Score | Band |
| --- | --- |
| 90–100 | top |
| 75–89 | high |
| 60–74 | medium |
| 0–59 | low |

Derived server-side and additionally enforced by a database CHECK, so even a
service-role write cannot persist a band the rubric would not produce.

### Deterministic ranking

After every expected candidate is scored exactly once, ranks are assigned
transactionally. Rank 1 is highest. Tie-breaks, in order:

1. `overall_score` descending
2. execution-plan alignment descending
3. proof and evidence strength descending
4. audience and pain relevance descending
5. canonical technique order ascending
6. `candidate_index` ascending
7. candidate UUID ascending (final stable fallback)

The ordering is total, so the same complete score set always produces the same
ranking regardless of input order. Ranks are unique per scoring run (database
constraint) and gap-free from 1 to N (verified at completion).

## Persistence

Two tables, both service-role write only:

- `client_ideation_scoring_runs` — one scoring batch per attempt chain, carrying
  status, rubric identity, configuration hash and snapshot, authority snapshot,
  candidate snapshot, prompt digest, model identity, expected/scored/failed
  counts, attempt and maximum attempts, retryability, warnings, failure code and
  message, lease, timestamps, and `supersedes_scoring_run_id`.
- `client_ideation_candidate_scores` — one row per candidate per scoring run,
  carrying the candidate content and evidence hashes, all ten dimensions, the
  calculated overall score, band and rank, rationale, strengths, risks, authority
  references, evidence references, and model/rubric/prompt provenance.

Database guarantees include: score client and cycle must match the run; the
candidate must belong to the same client and cycle (composite ownership foreign
keys); one score per candidate per run; one rank per run; dimensions 0–10;
overall 0–100; band consistent with the score; candidate hash must match the
immutable snapshot; a completed run must have every expected candidate exactly
once; leases are owner-bound; stale workers cannot persist, complete, or fail.

The single additive change to a Stage 1 table is one composite unique constraint
on `client_ideation_candidates (id, ideation_cycle_id, client_id)`, required for
the ownership foreign key. `id` is already the primary key, so this adds an index
and changes no existing behaviour.

## Transactions

`begin_ideation_scoring_run`, `renew_ideation_scoring_lease`,
`persist_ideation_score_batch`, `complete_ideation_scoring_run`, and
`fail_ideation_scoring_run` are `SECURITY DEFINER` with `search_path = public`,
revoked from `public`/`anon`/`authenticated`, and granted only to `service_role`.

- Maximum attempts: **3**. Attempt 3 is terminal and can never become attempt 4.
- Active replay returns the in-progress run rather than starting a second.
- Completed replay returns the existing run and makes **no provider call**.
- A retry processes only missing candidates; completed scores are never rescored.
- A non-retryable failure is terminal.
- Ranking happens only when the scored set exactly equals the snapshot set —
  exact reconciliation, never an aggregate count.
- A partial run is never presented as completed.

## Idempotency

The configuration hash covers: client, cycle id, the Stage 1 cycle configuration
hash, every candidate id, content hash, evidence hash, asset type, technique slug
and index, the exact Context/strategic/Execution authority identity (ids,
versions, classifications, hashes), rubric slug/version/dimensions/weights, the
prompt construction and digest, model identity, provider configuration, output
token policy, provider time budgets, batch policy, retry configuration, output
schema version, and the Stage 2 module version. Request ids, lease tokens,
timestamps, and worker state are excluded.

The scoring identity is derived **entirely server-side**:

```
scoring:{cycle_id}:{configuration_hash[0:32]}                      initial
scoring:{cycle_id}:{configuration_hash[0:32]}:after:{previous_id}  re-score
```

A caller cannot supply or manipulate it. An identical accidental resubmission
replays the same run; a changed candidate, rubric, prompt, model, or authority
produces a different hash and therefore a conflict rather than silent reuse.

## Re-scoring

After a completed run the main action becomes **Re-score Content**, which
requires explicit confirmation in a dialog. A re-score:

- creates a new scoring run;
- must name a real, completed, same-cycle predecessor, validated server-side
  (`RESCORE_PREDECESSOR_INVALID` otherwise);
- records it in `supersedes_scoring_run_id`;
- never overwrites historical scores — every previous run and all of its scores
  remain readable;
- surfaces which run is active (the newest) and how many runs are in history.

Re-scoring is not a way to bypass terminal failure rules: the attempt cap and
terminal-state rules apply to each run independently.

## Authorization and RLS

`admin` and `account_manager` are allowed; every other role is denied. The
request body cannot spoof role or client access — both come from the caller's
JWT, and the service-role client is created only after authorization succeeds.

Authenticated staff may `SELECT` scoring runs and scores for accessible clients
only. Anonymous access, cross-client reads, and all direct `INSERT`/`UPDATE`/
`DELETE` are denied; mutations occur only through the service-role RPCs.

## Structured failures

Failures preserve error code, message, `scoring_run_id`, `ideation_cycle_id`,
retryability, run status, expected/scored/failed counts, shortfall, attempt and
maximum attempts, warnings (including per-batch candidate ids), and persisted run
state. HTTP status and retryability stay independent. No stack trace, service
credential, API key, prompt, provider payload, raw authority, or lease owner is
ever returned.

Typed codes distinguish malformed request, unauthorized, forbidden client, cycle
not found, cycle not eligible, authority snapshot mismatch, candidate set
invalid, scoring configuration invalid, prompt budget exceeded, provider timeout,
provider truncation, provider transient failure, model output invalid, lease
lost, attempts exhausted, and persistence failure.

## Model call architecture

One public Edge Function, `score-ideation-candidates`. Candidates are scored in
deterministic bounded batches of 5, cut from canonical order (technique order,
candidate index, candidate id), so a one-month candidate set never depends on a
single oversized response. The batch strategy is part of the configuration hash.

Stage 2 reuses the Stage 1 hardened Anthropic adapter and provider time budgets
rather than duplicating provider infrastructure. Each batch is validated against
its exact expected candidate set — a batch that scores only some of its
candidates is a failure, never a partial success. `stop_reason === "max_tokens"`
is always rejected, including when the truncated body parses as valid JSON, and
earns one bounded correction at a larger capped output allowance.

The prompt separates system constraints, Execution authority, strategic
authority, business Context, candidate content, candidate evidence, the rubric,
and the output schema. Candidate text is explicitly material under evaluation and
carries no authority; instructions found inside it are never followed. Stage 1
prompt-compaction applies: each bounded excerpt appears exactly once and the
registry block carries identifiers only. Required authority that cannot fit the
prompt budget fails closed. Prompts and authority are never logged.

## Frontend behaviour

- Eligible completed run, no scoring run → **Score and Sort Content**.
- Active run → actions disabled, progress and expected/scored/failed counts,
  attempt number, and current status shown.
- Retryable partial run → **Retry Scoring**.
- Completed run → candidates default to rank order; rank, overall score, priority
  band, and a compact strength/risk indicator appear on each card; the main action
  becomes **Re-score Content**; the active scoring run and rubric version are
  shown; an **Original order (audit)** toggle preserves generation order.
- The candidate modal adds overall score, rank, all ten dimensions, rationale,
  strengths, risks, scoring authority references, candidate evidence references,
  rubric version, scoring-run identity, and model/prompt provenance.

All three scoring mutations use the existing client-owned request coordinator, so
a client change, an unmount, or a duplicate click can never apply a stale result.

Accessibility: the actions are semantic buttons with `aria-busy` and an
`aria-describedby` progress status region; ranked cards remain keyboard
accessible with a descriptive `aria-label` including band and rank; the re-score
dialog traps and restores focus; priority is always conveyed as words, never by
colour alone.

## Explicitly out of scope

Stage 2 must not, and does not, write `organic_master`, `story_master`,
`ads_master`, `calendar_cells`, production briefs, assets, distribution, or
analytics; and adds no approval, rejection, dismissal, shortlisting, selection,
Calendar proposal, Calendar allocation, or Commit Content path. An automated test
asserts that the complete Stage 2 runtime and migration reach none of those
domains.

## Next build

**Stage 4 — Commit approved content into Calendar and `organic_master`.** Stage 3
is built; do not begin Stage 4 without explicit sign-off. The full Ideation
system is **not** complete.
