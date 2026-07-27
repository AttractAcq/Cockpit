# AA Ideation — PR 1 / PR 1.1 Implementation

Status: Stage 1 exact-schema validation and linked database/Edge release complete; frontend operational smoke pending
Date: 2026-07-27
Public Edge Function: `run-ideation`
Frozen authority baseline: `docs/AA_PHASE_1_PHASE_2_FROZEN_BASELINE.md`

## Scope

The user-facing flow remains deliberately upstream-only:

```text
Marketing > Client > Ideation
        ↓
Generate Content
        ↓
One Day / One Week / Date Range / One Month
        ↓
run-ideation
        ↓
approved Context + strategic playbook + Execution authority
        ↓
internal seven-technique orchestration
        ↓
bounded research + needs_review candidates
        ↓
read-only grouped candidate UI
```

There is no scoring, ranking, review decision, promotion, Calendar creation,
master creation, brief generation, production, distribution, cron, automation,
Reel Studio, Higgsfield, storyboard, video, or render integration.

## Data Architecture

- `IDEATION_TECHNIQUE_MANIFEST` is the code-owned fixed technique registry.
- `client_ideation_technique_runs` is the Ideation-only per-technique execution,
  requested-slot, failure, and retry envelope.
- `client_ideation_cycles` is the period run, immutable configuration snapshot,
  lease owner, quantity plan, slot allocation, and aggregate status.
- `client_ideation_research_results` retains deterministic source provenance and
  separately attributed model-analysis provenance.
- `client_ideation_candidates` retains only pre-Calendar `needs_review` drafts.

The additive migration was validated against an authorised, read-only,
schema-only export of the linked project in a clean disposable PostgreSQL 17
environment before it was applied on 2026-07-27. The synthetic fixture remains
useful for isolated SQL behavior, but it is not migration-safety proof. The
project-specific schema export was stored only in a temporary ignored path and
contains no table data.

## Fixed Seven-Technique Contract

The canonical order is:

1. `persona`
2. `review-mined-pain-language`
3. `competitor-objections`
4. `end-customer-complaints`
5. `live-objection-log`
6. `trigger-event`
7. `format-swipe`

The Edge Function loads exactly these code-owned definitions, validates their
slugs, versions, order, prompt template, output schema, model/source policies,
module version, and uniqueness, then passes that exact snapshot into
`begin_ideation_run`.

The begin RPC rejects missing, duplicate, changed, or unexpected configuration
and creates exactly seven `client_ideation_technique_runs`. Records in the
frozen strategic-system authority cannot create technique runs. Completion rejects
missing, duplicate, unexpected, or non-terminal result sets.

Techniques 2–4 receive deterministic slot allocation. Technique 5 is `No source`,
Technique 6 is `Inactive`, and both receive no generation slots. Techniques 1 and
7 provide standing reference authority and receive no direct candidate slots.

## Period and Quantity Contract

Every inclusive period up to 31 days is accepted. A valid Date Range may touch
one, two, or three calendar months. The server, UI, and database all use the same
31-inclusive-day and maximum-three-month contract.

Quantity does not scan prose. For each touched month, approved E02, E04, and E05
must be present exactly once, and exactly one of those files must contain:

```text
## Ideation Quantity Contract
schema: aa.ideation.quantity.v1
reel_per_week: 4
carousel_per_week: 2
static_per_week: 2
story_per_week: 7
```

All four keys are required and accept integers from 0 through 14. Missing,
duplicate, malformed, or ambiguous sections fail closed. Incidental numbers
outside the exact section are ignored. Different months may carry different
valid quotas.

The plan is calculated per calendar month and then combined. The cycle persists
monthly quotas, requested-period contributions, exact source file ID/name/version,
source section/fields, total quantity, and deterministic per-technique allocation.
There is no silent default.

Existing approved Execution Files that predate this contract must be updated and
re-approved through the existing authority workflow before Ideation can generate.
PR 1.1 does not mutate those files or change Phase 2.

## Lease, Ownership, and Retry Model

`begin_ideation_run` atomically creates or locks the cycle by
`(client_id,idempotency_key)`.

- New runs receive `lease_owner`, `lease_expires_at`, `last_heartbeat_at`, and
  `attempt_count=1`.
- A concurrent start with an unexpired lease returns `RUN_IN_PROGRESS`.
- An expired `running` run or a `retryable` run may be atomically reclaimed.
- Reclamation changes the owner and increments cycle/run attempts.
- Reclamation reads the immutable configured maximum under the cycle row lock.
- Expiry at attempt 3 transitions once to terminal
  `IDEATION_ATTEMPTS_EXHAUSTED`; it cannot create attempt 4.
- Only retryable shortfall runs are reclaimed. Non-retryable technique failures
  preserve their state and make the required cycle terminal.
- `renew_ideation_run_lease` heartbeats before and after model work.
- Only the current owner may complete or fail.
- Completion/failure clears the lease.
- `completed` and `failed` are terminal and cannot be reclaimed.
- Worker termination cannot permanently strand the idempotency key because the
  lease expires.

Successful candidates survive a retryable partial result. Requested slot indexes
are stable and `(technique_run_id,candidate_index)` prevents duplication.
Re-invoking the same run generates only missing indexes. The maximum is three
cycle attempts; an unresolved shortfall then becomes non-retryable `failed`.

## Idempotency Snapshot

The SHA-256 input hash covers:

- client ID, client display name, and requested period;
- resolved execution months;
- complete monthly quantity plan and slot allocation;
- separately sorted Context, strategic-playbook, and Execution row IDs,
  versions, authority classes, storage provenance, and content hashes;
- exact technique-manifest order, slugs, versions, effective focus, selected
  Context file numbers, prompt templates, output schemas, model policies, and
  source policies;
- selected Execution evidence files and research/provider configuration;
- provider, selected model, and effective token/timeout/retry parameters;
- application prompt/output schema version, exact prompt-construction
  configuration, and its digest;
- internal module version;
- canonical technique order;
- lease/retry policy.

The complete immutable snapshot is stored on the cycle. Any authority, model,
prompt, technique, schema, module, quantity, or ordering change causes
`IDEMPOTENCY_CONFLICT` rather than replaying obsolete output.

## Trust and Grounding Contract

Prompt priority is:

1. System and application safety rules.
2. Approved Execution Files as trusted operating constraints.
3. Approved client-specific strategic playbooks as governing AA methodology.
4. Approved Context Files as trusted business truth.
5. Ideation technique logic as a research method.
6. External research as untrusted data only.
7. Generated candidates as non-authoritative working output.

The model is told to follow approved Execution channel, format, messaging,
compliance, cadence, and output constraints. Commands embedded in external
research/reviews/scraped text are explicitly ignored.

Each model call receives an allowed evidence registry with stable source ID,
source ref, source type, source URL, bounded excerpt, and SHA-256 content hash.
Every candidate reference must resolve to the registry.

Supported evidence types:

- `exact_quote`: one source, verbatim quoted text verified inside its excerpt.
- `paraphrase`: one valid source, a normalized-verbatim support span,
  proposition-level lexical support under the deterministic claim-length
  threshold, and a concise support note;
  no quoted text.
- `derived_claim`: one or more sources plus explicit reasoning; never represented
  as a quotation.

Every persisted candidate field must be named by an evidence claim. Unknown IDs,
filenames, URL pairs, altered quotations, absent/irrelevant support spans,
unsupported complete numeric tokens, unsupported high-risk proof/guarantee/
leadership/outcome/competitor claims, empty evidence, and all-empty findings are
rejected.
Raw HTML is never stored.

Grounding uses five independent deterministic gates: source-span existence;
lexical/phrase relationship; unsupported-claim detection; exact numerical-token
grounding; and direct high-risk support. Weak business nouns (buyer, customer,
client, business, service, company, people, market, audience, and content,
including plurals) never establish support alone. Claims with 2–4 strong
concepts require 2 supported concepts, claims with 5–7 require 3, and longer
claims require at least 40% with a minimum of 3. A one-concept claim requires
that non-generic concept itself.

Revenue/sales/profit/lead/appointment/pipeline/conversion/acquisition/growth/
improvement/customer/ROI/return/result/outcome concepts and high-risk causal,
universal, guarantee, certainty, multiplier, leadership, superiority,
superlative, or competitor-performance language must be directly supported
together in one cited sentence. Pain, invisibility, or hidden/weak proof cannot
stand in for a business outcome. The validator applies these rules to structured
findings, working title, hook, core message, psychological angle, CTA, evidence
claims, support notes, reasoning notes, and duplicated candidate draft text.
Exact quotes retain verbatim validation; derived claims retain explicit
reasoning but cannot bypass numerical or direct high-risk support.

## Research and Analysis Provenance

Source provenance is stored separately:

- `source_provider`
- `source_identifier`
- `source_type`
- `source_url`
- bounded `source_excerpt`
- `retrieved_at`
- `content_hash`
- `source_findings`

Model analysis is independently attributable:

- `analysis_provider`
- `analysis_model`
- `analysis_prompt_version`
- `analysis_output_schema_version`
- `analyzed_at`
- `analysis_findings`
- `analysis_source_references`

Anthropic findings are never labelled as if they came directly from
`approved_client_authority`.

## Authentication, RLS, and Policies

Authentication order:

1. Validate bearer token through `auth.getUser()`.
2. Require `admin` or `account_manager`.
3. Read the client with the caller JWT under existing `clients` RLS.
4. Create the service-role client only after those checks pass.

`editor` is intentionally excluded because current `auth_client_ids()` gives
editors no client IDs. PR 1.1 does not change global editor access.

New Ideation tables are authenticated SELECT-only under
`client_id = ANY(auth_client_ids())`; mutations are service-role only. RPC execute
is service-role only.

The migration does not alter, seed, query, grant, revoke, or replace policies on
`playbooks` or `playbook_runs`. Direct writes to the separate
`client_ideation_technique_runs` table are service-role only.

## Anthropic Failure Handling

The abort timer remains active through headers, complete body read, JSON parsing,
and provider-shape validation. Typed failures distinguish:

- disabled configuration;
- missing key;
- timeout, including stalled body;
- retryable/non-retryable HTTP errors;
- invalid provider JSON;
- empty response;
- refusal;
- max-token truncation, even when the truncated text is valid JSON;
- fetch failure;
- grounded candidate-schema failure.

Malformed or semantically invalid candidate JSON receives one bounded corrective
format retry. A second deterministic validation failure is terminal and
non-retryable. Technique failures become structured slot shortfalls. Unexpected
orchestration errors are persisted with the current lease owner, then the
persisted bundle is reloaded and returned as a non-2xx structured failure. The
response includes the cycle/run, status, technique runs, detailed failures,
counts, shortfall, warnings, attempt/max-attempt values, terminal reason, and
retry permission. If the reload fails, the original orchestration error remains
primary and the terminal RPC row supplies the best available non-retryable
fallback state.

## UI

`IdeationPanel` provides:

- the unchanged Generate Content period modal;
- 31-inclusive-day validation;
- run history;
- exact generated/expected/shortfall counts;
- failed technique, slot, retryability, and error detail;
- `Retry missing ideas` for a retryable run;
- grouped read-only candidate cards;
- grounded evidence type and provenance in candidate detail.

Client changes abort in-flight overview reads and invalidate a client-owned
mutation generation token. Stale Generate, Retry, structured failure, and
post-mutation refresh completions cannot update or abort the new client. The
Generate modal and all prior-client runs, selections, candidate detail, warnings,
notices, errors, retry/loading state are reset.

The shared `Modal` now uses unique ARIA IDs, initial focus, focus trapping,
Escape/backdrop handling, listener cleanup, and focus restoration.

There are still no edit, approve, reject, score, sort, Calendar, commit, brief,
Reel Studio, production, or promotion controls.

## Validation

Local validation includes:

- behavioral Node tests for periods, monthly quantity contracts, malformed and
  duplicate authority, grounding, trust hierarchy, provider timeout/body handling,
  idempotency hashing, fixed technique configuration, and transitive prohibited
  references;
- handler-level tests executing the dependency-injected production orchestration
  path for authorization, request validation, structured provider/authority/
  validation failures, terminal persistence/refresh, leases, replay, redaction,
  response contracts, and stale-client ownership;
- disposable PostgreSQL migration and integration tests for exact seven-run
  creation, leases, owner checks, retryable recovery, terminal protection,
  de-duplication, authority immutability, original-playbook policy preservation,
  and Ideation-only RLS;
- full frontend TypeScript typecheck;
- production Vite build;
- local Supabase Edge Runtime bundle of the complete import graph;
- `git diff --check`.

The disposable synthetic fixture is self-contained, including a minimal
`auth.uid()`, and remains useful for unit behavior only. Adversarial SQL covers
allocation, provenance ownership, retryability, attempt exhaustion, RLS, and
evidence constraints. A separate two-worker concurrency test validates the
final-attempt transition.

The repository intentionally contains no project-specific checked-in schema
dump, and the 14-line foundation migration explicitly omits its SQL. The
reproducible exact-schema interface is
`IDEATION_SCHEMA_BASELINE=/absolute/path/to/schema-only-dump
bash tests/validate-ideation-pr1-schema.sh`; it refuses the synthetic fixture,
restores the supplied baseline into a fresh disposable container, runs
dependency/collision/RLS/grant/function preflight, snapshots frozen objects,
applies the migration with `ON_ERROR_STOP=1`, verifies no frozen-object drift,
runs postflight plus all SQL/concurrency suites, and removes the container.

The authorised 2026-07-27 linked schema-only export passed that complete route.
The linked migration was then applied as the sole pending release migration,
postflight passed, and a pre/post frozen-schema snapshot comparison showed no
drift. `run-ideation` was deployed with JWT verification enabled.

## Deployment-Time Rechecks

Before any linked migration:

1. Recheck that `playbooks` and `playbook_runs` definitions and policies are
   unchanged before and after the migration.
2. Confirm the Phase 1 strategic-system file manifest still matches the frozen
   authority classifier.
3. Confirm Phase 2 still consumes those files through
   `EXECUTION_FILE_MANIFEST.contextFileNumbers`.
4. Apply to a non-production environment and rerun SQL/RLS tests.
5. Confirm approved Execution Files contain the exact quantity contract.
6. Deploy only `run-ideation`, then the frontend.

The Stage 1 operational release applied only the additive Ideation migration and
deployed only `run-ideation`. No provider-backed smoke invocation is represented
by this implementation record; that result belongs to the final release report.
