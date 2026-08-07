# Stages A–E — Outstanding Work Ledger

Date: 2026-08-03 · Project `xivewedajschthjlblfb`
Purpose: an accurate, non-flattering account of what runtime work is **done** and what is **not**, after the "complete all A–E outstanding work" pass.

## Verification at time of writing

| Gate | Result |
|---|---|
| Typecheck | PASS |
| Tests | PASS — 683/683 |
| Lint | PASS — 0 errors, 4 pre-existing warnings |
| Build | PASS |
| Migration parity | 60 repo files = 60 database migrations |

No new tables were created in this pass, so no new RLS surface was introduced.

---

## DONE this pass

### 1. `ingest-content-source` — deployed, v1, `verify_jwt: true`

The Stage E runtime that was blocking everything downstream. One entry point for all four supply streams.

- Canonical identity computed server-side as SHA-256 of raw content; **idempotent** — resubmitting identical material returns the existing source instead of creating a duplicate.
- Handles the concurrent-duplicate race explicitly (`23505` → re-read → return existing).
- Validates adapter linkage **before** hitting the database, mirroring `content_sources_adapter_check`.
- Proof created through this path enters `unverified` / `not_obtained` consent / `unused` — fails closed by construction.
- On detail-insert failure it **deletes the half-built source** rather than leaving an orphan.
- Writes only to `content_sources`, `manual_ideas`, `proof_items`. It cannot reach the Calendar or production — Stage E acceptance criterion 6.

### 2. `process-source-document` — deployed, v1, `verify_jwt: true`

The Stage C extraction runtime.

- Deterministic paragraph-aware chunking with hard-split fallback for oversized paragraphs.
- Per-chunk SHA-256 and contiguous indexes; re-extraction deletes and rewrites chunks so indexes never fragment.
- **Never leaves a row stuck in `extracting`** — every failure path lands in `failed` with a `failure_code`, and the response reports whether a retry remains.
- Refuses to proceed past `maximum_attempts` (409 `RETRY_LIMIT_REACHED`).

Both functions reuse the existing staff-role + client-access gate rather than duplicating auth logic.

---

## NOT DONE — remaining outstanding work

### Stage C
- `detect-input-conflicts` worker — nothing writes `client_input_conflicts`.
- Research run worker — nothing writes `client_research_runs` / `client_research_sources`.
- Context-file provenance UI.
- Conflict review UI.
- Confirmation that Phase 2 gating still blocks on unapproved Phase 1 files.

### Stage D
- `generate-execution-config` — nothing writes `client_execution_configs` or `client_execution_config_checks`. The validation and reconciliation logic exists and is tested in `src/types/execution-config.ts`, but no function calls it.
- Side-by-side Markdown/structured review UI with approval linkage.
- Adapting the Ideation quantity contract to consume `content_requirements`.

### Stage E
- Manual Idea entry UI.
- Proof Vault UI.
- Proof extraction job (what happened / who for / what changed / claims supported).
- Source search, filtering, provenance view.
- Runtime adapters wired to live Ideation candidates and Performance Insights (the ingest function accepts them; nothing calls it for those streams yet).
- **`ideation_technique_strategies` is still empty** — deliberately. Populating it means writing AA methodology, which I will not invent.

### Cross-cutting
- No end-to-end invocation test of either deployed function. Both require a signed-in operator JWT, which I cannot mint, and I will not bypass the auth gate to test. The DB-level guarantees they depend on **were** verified live with disposable fixtures (Stage E), but the HTTP paths are unexercised.
- `chunkText` and `linkageValid` are pure and testable but are **not yet under unit test** — they live inside the function entrypoints. They should move to `_shared/supply/contract.ts` and be covered from `tests/`.

---

## Known divergence to close

The Supabase MCP deploy tool flattens bundle paths, so the **deployed** bundles import `./_shared/...` while the **repo** files correctly use `../_shared/...`. Logic is identical; only the import prefix differs. Deploying from the repo with `supabase functions deploy` will converge them and is the correct long-term path. This is the same class of repo-vs-deployed drift flagged as HIGH severity in the Stage A audit, so it should not be left indefinitely.

---

## Honest summary

Two of roughly a dozen outstanding runtime items are done. They were chosen deliberately: `ingest-content-source` is the single dependency that unblocks the most downstream work, and `process-source-document` is the other. The remaining items — six UI surfaces in particular — are substantially more work than what was completed here and were not attempted rather than half-built.
