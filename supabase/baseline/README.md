# Stage A current-state database baseline

This directory contains the machine-readable Route B authority model. Captured
production authority, executable application reconstruction, bootstrap data,
and post-cutover migrations have distinct roles. Nothing here replaces,
renumbers, or repairs the production migration ledger.

## Why Route B

`supabase/migrations/20260702074337_v1_foundation.sql` has always been a
historical stub. Complete Git history, all refs/tags, and the preserved stash
contain no foundation DDL. The stub says 18 enums and 28 tables; the captured
current schema contains 17 enums and 80 public tables. Forty-nine tables are
provably introduced by later active migrations, while the exact cutover origin
of the remaining 31 cannot be proven. Replacing the stub would invent history
and could duplicate later objects.

Route B therefore keeps all 47 historical active migrations byte-for-byte and
adds a separate cutover at version `20260801000000`:

- `current-schema.sql` is the schema-only captured production authority and the
  deterministic projection source. It is retained for exact evidence and is
  **not** executed by the disposable local bootstrap. It is safe to version: it
  contains no dump data section or production-row `COPY`, client rows,
  credentials, connection strings, signed URLs, or project ref. Its SHA-256 is
  `09a2aaf0d8b65e3954b2e6704f59f99025e05a029905d697614641c575577f5a`,
  exactly matching `remote-schema.sql` from the provenance-bound read-only
  capture at `2026-08-02T15:11:27.763Z` for project
  `xivewedajschthjlblfb`.
- `application-schema.sql` is deterministically derived from that snapshot and
  is the canonical executable application reconstruction. The three
  machine-readable rules exclude only Supabase-owned `extensions` schema DDL,
  `extensions` function DDL, and grants/revokes whose target is in
  `extensions`; the local platform retains ownership of those objects.
- `bootstrap-data.sql` restores the two repository-proven private storage
  buckets, eight storage policies, and two required Reel Studio seed rows that
  a public schema-only dump omits.
- `manifest.json` classifies the schema at object/column/constraint level and
  pins every historical migration hash.
- `verify-baseline.sql`, the dedicated RLS/grant/storage/seed checks, and
  `verify-isolation.sql` prove the recorded identifier catalogue/counts and
  selected flags/configuration, representative six-RPC least privilege,
  held-object exclusion, bootstrap prerequisites, and symmetric two-client
  isolation.
- `verify-constraints.sql`, `verify-foreign-keys.sql`,
  `verify-uniqueness.sql`, and `verify-idempotency.sql` execute representative
  behavioral cases against the rebuilt PostgreSQL schema. They do not claim
  exhaustive behavior coverage for all 80 tables or all 647 constraints.

## Safe local rebuild

Start the repository's local Supabase stack, then run:

```bash
STAGE_A_DISPOSABLE_CONFIRM=reset-local-cockpit-disposable npm run baseline:bootstrap:local
```

`supabase/config.toml` disables automatic local migration replay and seeding.
That setting is local-stack-only and is essential to Route B: ordinary startup
provisions Supabase-owned schemas/services, while the guarded command below is
the sole fresh-environment path that installs the current baseline followed by
post-cutover migrations. Linked migration commands and the production ledger
are unchanged.

The script accepts no target URL or project-ref argument. It requires the fixed
local Docker database `supabase_db_cockpit`, verifies its identity, rejects the
production ref `xivewedajschthjlblfb` in environment/link/container metadata,
proves the public schema is empty after the local reset, applies the canonical
executable application projection and bootstrap data, requires zero currently
applicable post-cutover migrations, and runs every named verification SQL
component.
It never calls a linked Supabase command and never prints database credentials.

Before startup, `scripts/run-stage-a-local-evidence.mjs` computes the versioned
`aa.cockpit.stage-a-database-source-binding.v1` identity for the exact guarded
runner, configuration, schema/data/manifest inputs, verification SQL, support
scripts, and dynamically enumerated post-cutover migrations. The shell runner
recomputes and confirms that aggregate before executing those same bound paths;
every component emits its exact command, exit status, and input hashes. The
evidence checker independently recomputes the binding from current bytes.
Filesystem timestamps are not binding inputs.

If Docker or the local stack is unavailable, do not substitute a linked
database. Record the missing prerequisite and leave the rebuild gate blocked.

## Future migrations

All new migration filenames must have a 14-digit version greater than
`20260801000000` and remain in `supabase/migrations/`. The safe bootstrap applies
those files after the baseline in lexical/version order. Add or update
deterministic verification whenever a migration changes a protected contract.

For the existing production database, continue using its unchanged historical
ledger and normal reviewed migration workflow. Never apply `current-schema.sql`
or `bootstrap-data.sql` to that project. Before any future production push, an
authorised operator must run a linked dry-run and confirm that only reviewed
post-cutover migrations are pending.

Do not use ordinary `supabase db reset`/`db push` as the fresh-environment
bootstrap: the historical stub cannot create its missing objects. Use this
guarded script so pre-cutover migrations are incorporated once, not replayed.

## External and operator-managed state

The baseline intentionally does not copy secrets, Vault values, auth users,
provider settings, dashboard toggles, production data, Edge Function
configuration, or cron jobs.

- `publish-worker` (`* * * * *`) and `insights-worker` (`0 * * * *`) are
  historically live-verified external configuration. The existing scheduler
  SQL covers `publish-worker`; an `insights-worker` installer is not yet present
  and remains explicitly deferred. Neither is installed during local bootstrap.
- `generation-worker` remains intentionally unscheduled/commented.
- `CRON_SECRET` and provider keys must be provisioned and rotated out of band;
  only names and responsibilities may be documented in Git.
- Auth accounts, client records, distribution accounts, and other operational
  data must be created through the applicable application/operator workflow.

## Recovery

If a disposable rebuild fails, preserve the first failing command and output,
fix the baseline or a post-cutover migration, regenerate both manifests, and
rerun from the empty-schema step. Never repair or rewrite the production ledger
to make the fresh bootstrap pass.
