# Stage A local execution evidence

`verification-manifest.json` (`aa.cockpit.stage-a-local-verification.v3`) is the machine-readable authority for the exact
commands, UTC bounds, tool/runtime versions, source bindings, test totals,
component exit statuses, named SQL cases, cleanup results, and transcript
SHA-256 values. Fingerprinted reports reference its fields instead of copying
the intended-tree fingerprint or local transcript hashes and creating a
recursive dependency.

The preserved raw transcripts cover:

- production build execution;
- the exact pinned Node 20.19.4 CI commands in
  `node:20.19.4-bookworm`, including `npm ci`;
- 20 provider-reliability runs and 10 complete-suite runs;
- a final standalone complete suite;
- a separate complete suite in a copied repository with all write bits removed
  and no writable temporary-fixture path (`TSX_DISABLE_CACHE=1` also prevents
  the pinned loader from creating its optional transform cache);
- the exact evidence checker running in a byte-identical synthesized checkout
  whose source-file mtimes are deliberately newer than every preserved test
  transcript;
- disposable Route B reconstruction and cleanup.

The database transcript separately records empty application schema,
application of canonical `application-schema.sql`, bootstrap data, zero current
post-cutover migrations, identifier-catalogue comparison, RLS flags/policy
count, representative six-RPC grants, storage/seeds/held-object absence,
symmetric two-client isolation, and the named representative
constraint/foreign-key/uniqueness/`begin_ideation_run` idempotency cases. Every
synthetic behavioral SQL scenario is transactional and rolled back.

The database run is independently byte-bound by
`aa.cockpit.stage-a-database-source-binding.v1`. Before starting the disposable
stack, the runner records the frozen base, deterministic enumeration rule,
sorted path-set hash, sorted `path NUL exact-bytes NUL` aggregate hash, exact
path count and per-file hashes, the applicable post-cutover migration set and
hashes, and dedicated hashes for executable schema, captured authority,
baseline manifest, and Supabase configuration. Each database component records
its exact command, status, and bound input paths/hashes. The checker recomputes
the whole binding from current repository bytes and rejects any path, byte,
migration-set, command, component-input, or schema-version mismatch.

The 2,912-entry catalogue comparison is exhaustive only for its documented
identifier multiset. It is not function-body, policy-expression,
constraint/index-definition, or ACL equivalence, and it is not exhaustive
behavioral integration of the 80-table schema.

The evidence validator rehashes every transcript, rejects nonzero or missing
component statuses, verifies every named `STAGE_A_CASE ... PASS` marker, binds
test evidence to current source/test/package/workflow bytes, and binds database
evidence to the current runner/configuration/schema/data/manifest/verification/
migration bytes. It fails if
raw output, runtime versions, totals, zero-skip status, residue results, or the
read-only transcript are missing. `STAGE_A_EVIDENCE_REGENERATION=1` is accepted
only by the controlled evidence runner to avoid validating an output while it
is being replaced; ordinary `npm test` performs the strict final validation.

Test evidence uses the explicit
`aa.cockpit.stage-a-test-source-binding.v1` contract: frozen base identity,
reproducible Git enumeration rule, path-set hash, aggregate sorted
`path NUL exact-bytes NUL` hash, file count, exclusions, and exact test/package/
workflow hashes. UTC transcript timestamps prove when commands ran. Filesystem
`mtime`, `ctime`, birth time, checkout time, copy time, directory time, and
wall-clock comparisons with source files are deliberately excluded from
freshness decisions because Git does not version them. Run
`npm run evidence:stage-a:portability` to regenerate the sanitized copied-tree
proof; it uses no dependency install or network access.

Database evidence uses its separate database-source-binding contract above.
Transcript UTC bounds prove when PostgreSQL commands ran; those timestamps do
not determine whether byte-identical database inputs remain current.

No transcript is evidence of an independent verifier decision.
