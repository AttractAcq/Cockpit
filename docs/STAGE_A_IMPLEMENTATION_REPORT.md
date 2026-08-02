# Programme Stage A — consolidated remediation report

**Repository:** `AttractAcq/Cockpit`

**Frozen source baseline:** `7d4c1b96cdd7f3a59e28dc9826b44b1aad3b4e5e`

**Route:** B — formal current-state baseline replacement

**Production project:** `xivewedajschthjlblfb` (read-only capture only)

**Live capture:** `2026-08-02T15:11:27.763Z`

## Outcome and safety boundary

Stage A keeps the 47-file production migration ledger unchanged and adds a
separate fresh-environment reconstruction contract. No Stage B feature,
production application source, deployed Edge Function source, active migration,
production database, or production function was changed by this remediation.
Snapshot creation, approval, integration, commit, and push remain
`lifecycle-pending` and owned by Programme Orchestrator.

All executed database behavior described here ran only in the guarded local
Supabase stack and was rolled back or removed. Live Supabase and GitHub Pages
claims are limited to the sanitized read-only capture identified above.

## Route B reconstruction authority

The machine-readable authority is
`supabase/baseline/manifest.json` (`aa.cockpit.stage-a-current-baseline.v2`):

1. **Captured production authority:** `supabase/baseline/current-schema.sql` is
   the exact schema-only captured production snapshot. Its SHA-256 is
   `09a2aaf0d8b65e3954b2e6704f59f99025e05a029905d697614641c575577f5a`,
   equal to the provenance-bound external `remote-schema.sql`. It is evidence
   and a derivation source, not the local-stack execution input.
2. **Canonical executable application reconstruction:**
   `supabase/baseline/application-schema.sql` is deterministically generated
   from the captured authority. Three explicit rules remove only
   Supabase-platform-owned `extensions` schema DDL, `extensions` function DDL,
   and grants/revokes targeting `extensions`. The guarded bootstrap executes
   this projection.
3. **Bootstrap configuration/data:** `supabase/baseline/bootstrap-data.sql`
   installs the two application storage buckets, eight storage policies, and
   two non-secret prompt seed rows omitted by a public schema-only dump.
4. **Post-cutover migrations:** only active migrations whose 14-digit version
   is greater than `20260801000000` run after the projection. The current
   applicable set is zero.

The comment-only historical foundation migration cannot recreate an empty
database, and no available ref or stash contains its missing DDL. Forty-nine of
the current 80 tables are introduced by later migrations; the exact foundation
origin of the other 31 is unprovable. Route B resolves fresh reconstruction
without rewriting history or inventing that provenance.

## Evidence scope

The captured snapshot check is exact byte equality. Projection generation is
deterministic, and its successful application is transcript-confirmed against
disposable PostgreSQL. The 2,912-entry comparison is an **identifier multiset**
comparison covering table, column, constraint, enum and ordered enum-value,
public function, view, trigger, policy, index, RLS-enabled-table, selected
storage, and seed identifiers. It does not compare function bodies, policy
expressions, constraint/index definitions, or ACLs.

The catalogue records 80 tables, 86 public function signatures, 145 public
policies, and RLS enabled on 80/80 public tables. Dedicated SQL confirms those
counts/flags. Policy behavior is representative: the isolation transaction
exercises the `clients` and `organic_master` application path in both
directions. Grant behavior is representative: six restricted RPCs are checked
for service-role-only execution. The 422 captured GRANT/REVOKE statement hashes
are inventoried, but complete ACL equivalence is not asserted.

Constraints, foreign keys, uniqueness, and idempotency are likewise named
representative Stage A cases. This report does not claim that every catalogue
object, policy expression, grant, constraint, foreign key, uniqueness rule, or
idempotency path received behavioral integration testing, and it does not claim
full production-equivalent database behavior.

## Executed database evidence matrix

The authoritative commands, UTC times, tool versions, component exit statuses,
case names, and transcript hashes are in
`docs/evidence/stage-a-local-verification/verification-manifest.json`. The
report references that manifest field rather than copying its fingerprint or
transcript hashes into fingerprinted prose.

| Invariant | Exact named cases | Evidence classification |
|---|---|---|
| Symmetric client isolation | `isolation.client_one_sees_own_exact_record`; `isolation.client_one_cannot_see_client_two`; `isolation.client_two_sees_own_exact_record`; `isolation.client_two_cannot_see_client_one` | Executed against disposable PostgreSQL. Both users use `authenticated` plus the JWT/request GUCs consumed by `auth.uid()`; own identifiers must match exactly and cross-client counts must be zero. |
| Constraints/state domains | `constraints.clients_name_not_null_rejects_null`; `constraints.clients_health_score_check_rejects_101`; `constraints.organic_content_type_check_rejects_video`; `constraints.client_status_domain_rejects_unknown_state`; `constraints.valid_control_row_is_accepted` | Representative executed behavior for `NOT NULL`, named `CHECK`, text-domain, enum state, and valid control writes. |
| Foreign keys/actions | `foreign_keys.organic_valid_client_parent_is_accepted`; `foreign_keys.organic_nonexistent_client_is_rejected`; `foreign_keys.organic_client_delete_cascades`; `foreign_keys.organic_client_update_no_action_rejects` | Representative executed valid/missing parent behavior plus recorded delete cascade and update no-action. |
| Uniqueness | `uniqueness.clients_slug_first_and_distinct_are_accepted`; `uniqueness.clients_slug_duplicate_is_rejected`; `uniqueness.organic_same_client_ref_duplicate_is_rejected`; `uniqueness.organic_same_ref_for_different_clients_is_accepted`; `uniqueness.organic_distinct_ref_for_same_client_is_accepted` | Representative global and `(client_id, ref)` scoped uniqueness, including permitted non-conflicts. |
| Database idempotency | `idempotency.begin_ideation_run_first_request_creates_one_cycle_seven_runs_one_event`; `idempotency.begin_ideation_run_exact_replay_creates_no_duplicates`; `idempotency.begin_ideation_run_exact_replay_returns_same_cycle_and_lease`; `idempotency.begin_ideation_run_conflicting_hash_reuse_fails_closed` | Calls the actual `begin_ideation_run` RPC: first commit, exact replay, stable committed identity/counts, and fail-closed conflicting hash reuse. No Stage A-only API was invented. |

Each behavioral SQL file starts a transaction and ends in `ROLLBACK`. With
`psql -v ON_ERROR_STOP=1`, an assertion error aborts the transaction; disposable
stack removal provides a second cleanup boundary.

The guarded run computes
`aa.cockpit.stage-a-database-source-binding.v1` before startup. That versioned
binding covers the exact runner, Supabase configuration, captured and executable
schemas, bootstrap data, baseline manifest, every verification SQL file,
baseline-generation/comparison support, and every dynamically enumerated
post-cutover migration. It records sorted path-set and exact-byte aggregate
hashes, exact per-file and migration hashes, and component-to-input mappings.
The evidence checker independently recomputes the binding and rejects any
current-byte, path-set, migration-set, component-command, or component-input
mismatch. Transcript SHA-256 identifies captured output; the database source
binding identifies the exact database inputs that produced it. UTC timestamps
record when the run occurred but do not decide byte freshness.

## CI/runtime and read-only test architecture

The former workflow pinned Node 20 but executed raw `.ts` files with
`node --test`. The canonical package command is now
`node --import tsx --test tests/*.test.ts`, with `tsx` pinned to `4.20.3`.
CI calls `npm test`, `actions/setup-node` pins `20.19.4`, and package engines
require Node `>=20.19.4 <21` and npm `>=10.8.2 <11`. A readiness test parses the
workflow, package manifest, and lockfile and rejects divergence.

The prior `EPERM` originated in the inventory commit-stability test in
`tests/stage-a-baseline.test.ts`, which created a fake repository and
`.git/HEAD`. It is now pure: `contentFingerprintEntries()` accepts in-memory
path/byte entries. The test performs mutation, rename, deletion, addition,
identical-byte/commit-identity, and symlink-containment assertions without any
filesystem write or temporary fixture. A separate read-only execution runner
copies the repository and dependencies, removes every write bit, points
`TMPDIR`, `TEMP`, and `TMP` at a nonexistent location inside that non-writable
copy, disables the `tsx` transform cache with its documented
`TSX_DISABLE_CACHE=1` switch, and runs the unchanged canonical `npm test`
command. No test fixture or loader cache needs a writable temporary path.

Final test evidence is source-bound by the versioned
`aa.cockpit.stage-a-test-source-binding.v1` contract: frozen base identity,
the exact Git enumeration rule, an aggregate exact-byte fingerprint, a path-set
fingerprint, bound-file count, exclusions, exact hashes for every
`tests/*.test.ts`, and exact package/workflow hashes. The evidence gate rejects stale fingerprints,
missing totals, absent raw stdout/stderr, nonzero/skip counts, and a read-only
claim without its own transcript. The intended-tree inventory fingerprint is
referenced by JSON pointer, never copied literally into a fingerprinted file.
Transcript UTC bounds prove when commands ran; checkout-local `mtime`, `ctime`,
birth/copy/directory times and wall-clock comparison with source files have no
validity role. A separate sanitized portability transcript proves that the exact
evidence checker passes in a byte-identical synthesized checkout whose source
mtimes are newer than every preserved test transcript.

## Intended snapshot fingerprint

`scripts/stage-a-intended-tree.mjs` enumerates Git's intended file set with
`git ls-files --cached --others --exclude-standard -z`. It hashes sorted
`path NUL exact-bytes NUL` entries. This includes material SQL, reports,
evidence/transcripts, tests, scripts, packages, workflow files, and Supabase
configuration. The only explicit path exclusion is the generated inventory
itself (`docs/stage-a-current-state-inventory.json`) to prevent recursion.
Ignored dependencies, build outputs, and local metadata are not returned by
Git and therefore are not part of the intended set.

Enumeration fails on a missing file, duplicate/unsafe path, special file, or a
symlink resolving outside the repository. The inventory records intended and
fingerprinted counts, exclusion reasons, frozen base commit, exact content
fingerprint, and the future orchestrator snapshot as `lifecycle-pending`.

## Fresh live provenance

The capture runner first verified both the linked metadata and the CLI-reported
`linked: true` project as `xivewedajschthjlblfb`. It then ran only the recorded
read-only commands: project discovery, linked migration list, linked push dry
run, explicit-project function list, linked lint, linked public/extensions
schema dump, GitHub main SHA, Pages configuration, deployed workflow bytes,
latest successful Pages run, and the live Pages HTTP request.

The repository provenance authority is
`docs/evidence/stage-a-live-provenance-manifest.json`.

The capture at `2026-08-02T15:11:27.763Z` records exact commands, expected and
actual target, UTC bounds, tool versions, exit statuses, sanitized stdout and
stderr, and output hashes. The provenance transcript SHA-256 is
`76aeb1c14d35e20b78fe9a951280fd20aa60f5a616584e14cd1f9e414febc8b0`;
the provenance manifest SHA-256 is
`87ecf5bc13565f877f84ff143a4469a20d5cfab71a3441e4ec210d6ec3771506`.
No linked write, migration repair/application, deployment, or function
invocation was performed.

## Claim-to-evidence audit

| Material claim family | Classification | Limit |
|---|---|---|
| Historical ledger, source inventory, authority model, generation rules | code-confirmed; deterministic-test-confirmed | Historical origin of 31 tables remains unprovable and is not invented. |
| Exact captured snapshot bytes and fresh live project binding | currently live-verified with timestamp and project provenance | Current means the `2026-08-02T15:11:27.763Z` capture, not an open-ended assertion. |
| Executable projection and guarded Route B reconstruction | transcript-confirmed; deterministic database-source-bound; executed against disposable PostgreSQL | Applies to the captured application projection, bootstrap data, and zero current post-cutover migrations. The checker recomputes all bound runner, SQL, configuration, manifest, and migration bytes. |
| Catalogue | deterministic-test-confirmed; transcript-confirmed | Exhaustive only for the documented 2,912 identifier multiset, counts, and selected flags/configuration—not definitions or behavior. |
| RLS/policy/grant behavior | representative; executed against disposable PostgreSQL | Symmetric two-client scenario plus six service-role RPC checks; no complete ACL or policy-expression equivalence claim. |
| Constraint/FK/uniqueness/idempotency behavior | representative; executed against disposable PostgreSQL | Only the named cases in the matrix. |
| Node suite/provider tests | deterministic-test-confirmed; provider responses mocked | CI compatibility additionally requires the pinned Node 20 transcript; provider tests make no live-provider claim. |
| CI workflow/runtime | CI-runtime-confirmed | Bound to `node:20.19.4-bookworm`, npm 10.8.2, final source hashes, exact commands, and cleanup. |
| Read-only compatibility | deterministic-test-confirmed; transcript-confirmed | Bound to its separate non-writable-copy transcript and zero skipped tests. |
| Snapshot checkout portability | deterministic-test-confirmed; transcript-confirmed | Exact evidence check passes with matching content/path fingerprints after all copied source mtimes are made newer than the preserved transcripts; timestamps are informational only. |
| Migration, function, lint, schema, Pages claims | currently live-verified with timestamp and project provenance | Exact commands and project/ref/SHA binding are mandatory in the live provenance manifest. |
| Cron observations | historically live-verified; externally configured | Bootstrap does not install or execute cron. |
| Vault, secrets, Auth/dashboard/provider configuration | externally configured | Excluded from Git and disposable reconstruction. |
| `insights-worker` installer | deferred | Operational installer work is outside this Stage A remediation. |
| Snapshot commit, approval, integration and push | lifecycle-pending | Programme Orchestrator ownership. |

No claim of an independent verifier decision is made here.
