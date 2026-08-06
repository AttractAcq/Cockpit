# Programme Stage D — Phase 2 Executable Contract: Implementation Report

**Status: implementation complete and verified. Exit gate NOT yet satisfied — live
end-to-end verification is outstanding.** See §11.

| Field | Value |
|---|---|
| Stage | D — Phase 2 Executable Contract |
| Branch | `baseline/stage-a-2026-08-03` |
| Baseline commit | `23ff87d` |
| Commits | `72f4db4` (prerequisite), `8525ee0` (runtime), `ec995df` (platform authority fix) |
| Supabase project | `xivewedajschthjlblfb` |
| Working tree | Clean |
| Date | 2026-08-06 / 2026-08-07 |

---

## 1. What Stage D found, and what it added

Stage D already had schema (3 migrations), a contract module (`src/types/execution-config.ts`)
and 27 passing tests. It had **no runtime, no API layer and no UI** — `execution_config`
appeared in exactly one file in the whole repository. This work added the operating half.

It also required one prerequisite fix outside Stage D's own scope, recorded in §2.

## 2. Prerequisite: the base schema was unversioned

`20260702074337_v1_foundation.sql` was a 14-line comment stub containing **no SQL**. The
migration had been applied via the Supabase MCP tool on 2026-07-02 and its statements were
never captured. Consequences while the stub stood:

- `supabase db reset` rebuilt nothing — 17 enums, 31 tables, 84 RLS policies and seed data
  existed only in production.
- `auth_role()` and `auth_client_ids()` had no definition in version control, while 37
  migrations reference them.

Recovered byte-exact from `supabase_migrations.schema_migrations` (md5
`94aa19dbe0b497c58528956bd6a42d9a`, 54,967 chars) using `supabase db query --linked` writing
straight to disk. Both helpers now sit at lines 145/152 of the first migration, ahead of all
callers.

**Note for anyone reading the old handoff §10 item 4:** "add a migration defining them" would
NOT have fixed this. A new migration lands after first use and still fails a reset.

All 62 migrations were scanned; this was the only stub.

## 3. Architecture and data-model decisions

**Generation contains no model call.** Every number written is read from the machine-readable
`## Ideation Quantity Contract` block (`schema: aa.ideation.quantity.v1`) in the approved
`05_Content_Calendar.md`, parsed by the existing strict parser in
`_shared/ideation/period.ts`. Nothing is inferred, so nothing can be fabricated. This
satisfies workspace `CLAUDE.md` §11 structurally rather than by prompt discipline.

**Reconciliation is deliberately non-circular.** Comparing the config back against the block
it was generated from would prove nothing. Instead it is reconciled against the independent
human-authored Rule 2 (Monthly Slot Targets), Rule 3 (Weekly Theme Sequencing) and Rule 4
(Pillar Rotation Requirements) tables in the same approved file. When an operator edits one
representation and not the other, a blocking check fires and
`client_execution_configs_approval_check` makes approval impossible **at the database level**.

**Objectives are declared, not invented.** The objective vocabulary is Rule 3's weekly themes.
Only the distribution across them is computed. If a calendar declares no themes, generation
refuses (422) rather than inventing a taxonomy to satisfy the "objective mix must sum to
quantity" rule.

**The approved Execution file is the authority for the month.** The declared
`**Primary platform:**` wins over `clients.primary_platform`, which is only a fallback. See §9.

**Reuse over parallel implementation.** `deriveIdeationQuantityPlan` is reused rather than
re-implemented, so there is no second quantity parser and no second source of truth. Both edge
functions import the derivation from `src/types/execution-config.ts`, so the frontend, the
functions and the contract tests share one implementation.

## 4. Migrations

| Migration | Content |
|---|---|
| `20260806211830_stage_d4_requirement_derivation_identity` | Partial unique index `content_requirements_derived_identity` on `(execution_config_id, platform, channel, asset_format)` making derivation idempotent; `content_requirements_derived_platform_check` so SQL's NULL-distinct rule cannot defeat it; `calendar_slots_requirement_operational_idx` |

Additive and backwards compatible: the index is partial on `execution_config_id is not null`,
so every pre-Stage-D row is untouched. Migration parity after: **63 files = 63 applied**.

## 5. Edge functions

| Function | Behaviour |
|---|---|
| `generate-execution-config` | Staff-gated. Reads approved Markdown, derives exact quantities, validates, reconciles, writes config + checks. Idempotent on `(content_hash, source_execution_files_hash)`. Never writes `approved`. |
| `approve-execution-config` | Staff-gated, authorised against the config's own client. Mirrors the DB approval check, supersedes the incumbent, derives requirements and slots, promotes slots to operational. |

**Fail-closed paths:**

| Condition | Response |
|---|---|
| No approved execution file for the month | `409 NO_APPROVED_EXECUTION_AUTHORITY` |
| Quantity contract missing/duplicated/wrong schema version | `422 QUANTITY_AUTHORITY_INVALID` |
| No platform declared anywhere | `422 PLATFORM_NOT_DECLARED` |
| Calendar declares no weekly themes | `422 OBJECTIVE_AUTHORITY_MISSING` |
| Reconciliation not passed | `409 RECONCILIATION_NOT_PASSED` |
| Config superseded or rejected | `409 CONFIG_NOT_APPROVABLE` |
| Checks fail to persist | Config row deleted; `500`. No config without its evidence. |

Superseding stands down only `open` slots. A `reserved` or `filled` slot represents committed
work and is left exactly as it is.

## 6. Frontend

- `src/lib/execution-config.ts` — reads direct under RLS; both writes go through edge functions.
- `src/components/client/ExecutionConfigPanel.tsx` — approved Markdown beside structured
  values, reconciliation evidence, derived requirement/slot counts, approval action. Covers
  loading, empty (no approved files), empty (no config yet), error, blocked-by-failed-
  reconciliation and disabled states.
- New "Execution Contract" section in `ClientDetailPage.tsx`.

## 7. Security and client isolation

Verified by `tests/stage-d-schema-postflight.sql` — **10/10 PASS**:

`approval_check_present` · `single_approved_config` · `requirement_derivation_identity` ·
`derived_platform_not_null` · `slot_identity_unique` · `slots_default_non_operational` ·
`requirement_config_fk_restrict` · `rls_enabled_on_stage_d_tables` ·
`config_select_policy_client_scoped` · `no_direct_write_grants`

Both functions use default `verify_jwt` (only `collect-instagram-insights` disables it) plus
an application-level `admin`/`account_manager` gate. Unauthenticated → `401`; anon key as
bearer → `401 NOT_AUTHENTICATED`.

## 8. Tests

| Suite | Count |
|---|---|
| Baseline | 710 |
| `execution-markdown-authority.test.ts` (new) | 17 |
| `execution-config.test.ts` (pillar rotation + cap) | +5 |
| **Total** | **732 passing, 0 failing** |

A test caught a **wrong claim in my own code comment**: round-robin pillar assignment does not
satisfy "no pillar above 50 percent" for N = 2 pillars with an odd slot count — `ceil(n/2)`
exceeds half, and no assignment can do better. That is a contradiction in the declared
authority (pillar list too short for the declared cap), not a derivation defect.
`pillarCapSatisfiable()` now exposes it. The real authority declares 3 pillars, so the live
path is unaffected.

## 9. A pre-flight catch worth recording

The first dry run hardcoded `instagram`. Checking what the deployed function would actually
resolve revealed `clients.primary_platform` is **NULL** for Client 001 — the authorised live
run would have returned 422 and written nothing.

The column being empty is a data-entry gap, not the authority: the approved E05 declares
`**Primary platform:** Instagram — Reels, Carousels, ...`. Fixed in `ec995df`.

The parser also had to avoid a trap: that same file's secondary platform reads `Unresolved`.
Explicit non-answers return null rather than creating a platform named "unresolved".

## 10. Verification performed

| Gate | Result |
|---|---|
| Typecheck | Clean |
| Tests | 732 / 732 |
| Lint | 0 errors, 4 warnings (all pre-existing, `ReelStudioPanel.tsx`) |
| Production build | Exit 0, 1,295.14 kB (+32 kB vs the 1,263 kB in handoff §8b) |
| Schema postflight | 10 / 10 PASS |
| Migration parity | 63 files = 63 applied |
| `git diff --check` / secret scan | Clean |
| Edge function bundles | Both deploy; auth gates verified |

**Full local dry run** through the real pipeline against Client 001's real approved files,
writing nothing:

| Format | Weekly (contract) | Weekly (Rule 2) | Monthly 2026-07 |
|---|---|---|---|
| reel | 4 | 4 | 17 |
| carousel | 2 | 2 | 10 |
| static | 2 | 2 | 9 |
| story | 7 | 7 | 31 |
| **total** | **15** | **15** | **67** |

All 7 blocking checks pass → `reconciliation_status: passed` → config written as
`needs_review`. 67 slots, 0 duplicate identities, quantities reconcile. Pillar distribution
24/22/21 (max 35.8%, under the 50% cap).

Monthly figures exceed the document's `~16/~8/~8/~30` because they are computed from actual
weekday occurrences in a 31-day July rather than a nominal 4-week month. The document marks
those approximate; the exact weekly figures are what reconciliation checks, and they match.

## 11. Outstanding — why the exit gate is not yet satisfied

Stage D's exit gate is "the system has a reliable demand-side representation for content
planning". That is not provable until real requirements and slots exist.

1. **Live end-to-end run not performed.** Requires a staff JWT. Harness ready at
   `scratchpad/live_verify.sh`; runs generate → regenerate (idempotency) → approve →
   re-approve (no duplicate derivation) against Client 001 for 2026-07, which Alex explicitly
   authorised as a real-client write.
2. **UI not rendered.** Typechecks and lints clean, but no browser verification.
3. **Ideation not yet cut over.** The acceptance criterion "the current Ideation quantity
   contract is replaced or adapted to use this canonical structure" is partially met: Stage D
   reuses the same parser rather than forking it, so there is no second source of truth. But
   Ideation still re-parses Markdown at request time instead of reading `content_requirements`.
   That cutover is deliberately not bundled here — it changes a working, live path and
   deserves its own reviewed change.

## 12. Acceptance criteria

| Criterion | State |
|---|---|
| Phase 2 produces both Markdown and structured authority | Met (pending live run) |
| Cockpit can answer what must be produced without reparsing Markdown | Met in the data model; **Ideation not yet cut over** (§11.3) |
| Open Calendar slots generated deterministically | Met — proven by tests and dry run |
| Ideation quantity contract replaced or adapted | **Partially met** (§11.3) |
| Legacy Phase 3 generation remains a compatibility path | Met — untouched |

## 13. Deployment actions performed

- Migration `20260806211830` pushed via `supabase db push`.
- `generate-execution-config` and `approve-execution-config` deployed via
  `supabase functions deploy` (CLI, not MCP).
- No existing function was redeployed, and no existing behaviour was modified.
- Nothing pushed to `origin`.
