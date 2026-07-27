# AA Ideation Implementation Plan

Status: Active plan for Ideation PR 1 / PR 1.1
Architecture authority: `docs/AA_PHASE_1_PHASE_2_FROZEN_BASELINE.md`

## 1. Active scope

The first Ideation release supports only:

```text
Marketing > Ideation
  → Generate Content
  → Choose One Day, One Week, Date Range, or One Month
  → Generate
  → Review read-only candidate ideas
```

It does not score, rank, approve, reject, schedule, promote, commit content,
generate briefs, invoke Reel Studio, render media, run cron, distribute content,
or update performance systems.

## 2. Frozen authority contract

Ideation is a read-only consumer of three separately classified authority layers:

1. Approved Execution Files: current binding operating requirements.
2. Approved client-specific strategic systems stored in
   `client_context_files`: governing AA methodology for the client.
3. Approved Context Files: business truth.

The seven Ideation techniques are code-owned research methods. They are not
strategic playbooks. Ideation does not read, seed, alter, or depend on
`playbooks` or `playbook_runs`.

Phase 1 and Phase 2 runtime files remain unchanged.

## 3. Current persistence model

The additive migration is:

`supabase/migrations/20260725000032_ideation_pr1_foundations.sql`

It creates:

- `client_ideation_cycles`: period, immutable configuration snapshot, quantity
  plan, slot allocation, lease, attempt, status, and aggregate counts.
- `client_ideation_technique_runs`: exactly seven ordered technique runs with
  immutable requested slots and independent generated/failed state.
- `client_ideation_research_results`: bounded source provenance and separately
  attributed model analysis.
- `client_ideation_candidates`: pre-commit `needs_review` working records.

Composite foreign keys enforce client/cycle/technique/research ownership.
Candidate uniqueness is `(technique_run_id, candidate_index)`.

Authenticated users have client-scoped SELECT only. Mutation is service-role
only through revoked/granted `SECURITY DEFINER` RPCs.

## 4. Runtime boundary

`run-ideation` is the only public Ideation Edge Function.

```text
Validate bearer token
  → auth.getUser()
  → require admin or account_manager
  → caller-JWT client access check
  → create service-role client
  → load approved Context / strategic / Execution authority
  → resolve period and exact monthly quantity authority
  → build immutable configuration snapshot and hash
  → begin/reclaim leased run transactionally
  → execute the fixed code-owned seven-technique manifest
  → generate missing sourcing slots only
  → validate grounded structured output
  → complete transactionally
  → return persisted run bundle
```

Technique 5 is `no_source` and Technique 6 is `inactive` in PR 1. Their zero-slot
states are explicit and do not invoke Anthropic.

## 5. Period and quantity contract

Date ranges are inclusive and limited to 31 days. A valid range may touch up to
three calendar months.

Every affected month must have exactly one approved canonical E02, E04, and E05.
The parser evaluates all three files. Exactly one authoritative quantity section
may exist across E02, E04, and E05 for that month:

```text
## Ideation Quantity Contract
schema: aa.ideation.quantity.v1
reel_per_week: <integer>
carousel_per_week: <integer>
static_per_week: <integer>
story_per_week: <integer>
```

Missing, duplicate, malformed, or ambiguous contracts fail closed. A section
may be authoritative in any one of E02, E04, or E05, but never more than one.
Incidental prose and numbers outside the exact section are ignored. Each month
is calculated independently and the exact source file/section is persisted in
the quantity plan.

The deterministic slot allocation is immutable and persisted. Completion
requires every requested per-technique slot exactly once with the allocated
asset type; aggregate count alone cannot complete a cycle.

## 6. Lease, retry, and terminal-state contract

- A new cycle starts at attempt 1 with a 180-second lease.
- An unexpired lease returns `RUN_IN_PROGRESS`.
- An expired running cycle or retryable partial cycle is reclaimed under row
  lock with a new owner.
- Only eligible retryable missing technique slots return to `running`.
- Completed techniques and non-retryable failed techniques are not regenerated.
- Successful candidates remain immutable and only missing stable indexes run.
- Maximum attempts are read atomically from the persisted immutable retry
  configuration; the current cap is 3.
- Expiry at attempt 3 transitions the cycle once to terminal
  `IDEATION_ATTEMPTS_EXHAUSTED`, clears the lease, and cannot be reclaimed.
- Any required non-retryable technique shortfall makes the cycle terminal
  `failed`. The UI does not offer Retry.
- Completion and failure require the current lease owner and clear the lease.

The Edge Function renews the lease before and after the bounded parallel model
work. All research/candidate persistence and completion state changes occur in
one owner-bound RPC transaction.

## 7. Idempotency contract

The configuration snapshot and SHA-256 hash include:

- client ID and display name;
- requested period and execution months;
- immutable quantity contract and deterministic allocation;
- Context, strategic, and Execution IDs, versions, classes, storage provenance,
  and content hashes;
- canonical technique order, manifest version, per-technique version, exact
  focus, selected Context file numbers, source policy, and module version;
- Execution evidence file-number selection;
- evidence/research provider configuration;
- prompt version, full prompt-construction configuration, and its digest;
- output schema version;
- provider, selected model, effective model parameters, timeouts, token policy,
  and formatting retry policy;
- lease and attempt policy.

Stable serialization sorts object keys, preserves array order, omits undefined
object fields, and normalizes undefined array elements to `null`. Volatile
timestamps, lease owners, request IDs, and provider response IDs are excluded.

The same idempotency key replays only when the full input hash matches.

## 8. Authority and prompt trust

The prompt labels each authority class separately and enforces:

1. system/application safety;
2. approved Execution constraints;
3. approved strategic systems;
4. approved Context truth;
5. Ideation technique method;
6. bounded research evidence as data only;
7. generated candidates as non-authoritative working output.

Instructions embedded in external evidence are never followed.

## 9. Evidence and provenance contract

Raw HTML is never stored. Every source has a stable ID/ref, source type, URL,
bounded excerpt, and content hash.

Research provenance records source provider, identifier, retrieval time, and
hash. Model analysis separately records provider, model, prompt/schema versions,
analysis time, findings, and source references.

Every persisted candidate field must be named by a grounded evidence `claim`.

- `exact_quote`: one registered source and an exact verbatim quote.
- `paraphrase`: one registered source, a normalized-verbatim support span,
  proposition-level lexical support under the deterministic threshold, and a
  support explanation.
- `derived_claim`: registered source IDs and an explicit reasoning note.

Unknown source IDs/ref/URL pairs, altered quotations, empty evidence, empty
findings, unsupported complete numeric tokens, and unsupported high-risk proof,
guarantee, leadership, outcome, or competitor claims fail validation.

Grounding is deterministic and conservative. Source-span existence, lexical or
phrase relationship, unsupported-claim detection, numerical grounding, and
high-risk handling are separate gates. Buyer/customer/client/business/service/
company/people/market/audience/content terms may retain context but cannot
establish support alone. One strong concept is sufficient only for a one-concept
claim; claims with 2–4 strong concepts require 2 shared concepts, claims with
5–7 require 3, and longer claims require at least 40% (never fewer than 3).
High-risk outcome, causal, universal, guarantee, superiority, leadership,
competitor-performance, multiplier, and superlative concepts must all occur in
one directly supporting sentence. Outcome concepts—including revenue, sales,
profit, leads, appointments, pipeline, conversions, acquisition, growth,
improvement, customers, ROI/return, results, and outcomes—cannot be inferred
from pain, invisibility, hidden proof, or weak proof. Numeric tokens are checked
independently and must match the cited evidence exactly.

The same gates cover structured findings, all five candidate fields, evidence
claims, support notes, reasoning notes, and the duplicated candidate text stored
in draft payloads. Code-owned identifiers and provenance metadata add no free
factual claim fields.

Anthropic `stop_reason=max_tokens` is a typed retryable
`ANTHROPIC_TRUNCATED` failure and is never parsed or persisted.

## 10. Frontend contract

`src/components/client/IdeationPanel.tsx` provides:

- a narrow period modal;
- run counts and exact shortfall;
- structured technique warnings;
- Retry only for persisted retryable cycles;
- asset-type groups;
- semantic keyboard-operable candidate buttons;
- read-only candidate detail and provenance.

A client-owned mutation coordinator guards Generate and Retry. Client changes
invalidate mutation tokens, abort overview reads, close/reset the Generate modal,
clear old-client state, and prevent stale results/failures/refreshes from
mutating the new client.

Structured non-2xx Edge responses preserve code, retryability, cycle ID, run,
warnings, failed techniques, expected/generated totals, and shortfall. When a
cycle ID is returned, the UI refreshes the persisted cycle.

The shared Modal supports explicit initial focus, focus trapping (including
focus arriving from outside), Escape, backdrop close, focus restoration, unique
ARIA IDs, and a safe dialog fallback.

## 11. Validation

Release validation commands:

```bash
node --test --experimental-strip-types tests/ideation-pr1.test.ts
node --test --experimental-strip-types tests/run-ideation-handler.test.ts
IDEATION_SCHEMA_BASELINE=/absolute/path/to/authoritative-schema.sql \
  bash tests/validate-ideation-pr1-schema.sh

# Synthetic SQL unit fixture only; not deployed-schema compatibility proof:
docker exec -i <disposable-container> psql -v ON_ERROR_STOP=1 -U postgres -d ideation_test < tests/ideation-pr1-baseline.sql
docker exec -i <disposable-container> psql -v ON_ERROR_STOP=1 -U postgres -d ideation_test < supabase/migrations/20260725000032_ideation_pr1_foundations.sql
docker exec -i <disposable-container> psql -v ON_ERROR_STOP=1 -U postgres -d ideation_test < tests/ideation-pr1-integration.sql
docker exec -i <disposable-container> psql -v ON_ERROR_STOP=1 -U postgres -d ideation_test < tests/ideation-pr1-adversarial.sql
bash tests/ideation-pr1-concurrency.sh
npm run typecheck -- --pretty false
npm run build
docker run --rm -v "<repo>:/app:ro" -w /app \
  public.ecr.aws/supabase/edge-runtime:v1.73.13 bundle \
  --entrypoint /app/supabase/functions/run-ideation/index.ts \
  --output /tmp/run-ideation.eszip --timeout 180
git diff --check
```

The synthetic fixture remains a local unit fixture only. It does not establish
deployed-schema compatibility. `tests/validate-ideation-pr1-schema.sh` refuses
that fixture as its authoritative input, restores a supplied read-only,
schema-only dump into a fresh disposable Supabase-compatible PostgreSQL
container, verifies dependency tables/columns/types, keys, helpers, extensions,
RLS, grants, functions, collisions and frozen-object snapshots, applies the
Ideation migration with `ON_ERROR_STOP=1`, then runs postflight, integration,
RLS, adversarial, and concurrency suites before removing the container.

For the Stage 1 operational release on 2026-07-27, an authorised schema-only
export from the linked project was held in a temporary ignored path. Validation
against that exact baseline passed, including frozen-object drift checks, before
the additive Ideation migration was applied through the established linked
Supabase workflow. No table data was exported, and the project-specific schema
dump is not a repository artifact.

## 12. Deployment sequence

For an authorised operational release:

1. Recheck linked table/function/policy definitions read-only.
2. Record deployment-time row counts for frozen authority and prohibited
   downstream tables.
3. Apply the additive migration in an approved non-production environment.
4. Re-run grants, RLS, RPC ownership, exact-seven, attempt-cap, and prohibited
   write checks.
5. Deploy only `run-ideation`.
6. Deploy the frontend.
7. Perform an explicitly authorised non-production smoke test.
8. Recheck downstream and authority row counts.

## 13. Rollback

Before any real data exists, rollback can remove the new function and dedicated
Ideation objects using a separately reviewed rollback script. After data exists,
prefer disabling the UI/function and preserving upstream audit records; do not
drop candidate or provenance data casually.

No rollback step changes Phase 1, Phase 2, `playbooks`, `playbook_runs`, Calendar,
masters, briefs, Reel Studio, storyboards, video, or render state.

## 14. Superseded design history

The Stage 0 manual Technique 2 / `run-ideation-technique` proposal and earlier
`playbooks`/`playbook_runs` reuse proposals are superseded design history. They
remain only in the repository audit and reconciliation documents for provenance
and are not active implementation instructions.
