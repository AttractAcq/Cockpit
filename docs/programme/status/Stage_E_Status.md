# Programme Stage E — Unified Content Source Layer

**Status: EXIT GATE SATISFIED.**
Date: 2026-08-03 · Project `xivewedajschthjlblfb`

> Exit gate: *"The supply side of content planning is complete."*

Ideas and proof can now enter Cockpit through an operator surface, become canonical sources, and be converted into Content Opportunities — without any supply path reaching the Calendar or production.

## Verification

| Gate | Result |
|---|---|
| Typecheck | PASS |
| Lint | PASS — 0 errors, 4 pre-existing warnings |
| Tests | PASS — 683/683 |
| Build | PASS |
| `git diff --check` | CLEAN |
| Migration parity | 60 repo files = 60 database migrations |
| Live supply chain (fixtures) | PASS — 6 assertions, all fixtures removed |

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Manual Ideas can enter Cockpit | **MET** | `ContentSupplyPanel` → `ingest-content-source` → `content_sources` + `manual_ideas` |
| Proof can be uploaded and structured | **MET** | Proof tab captures claim, kind, evidence detail, URL; Proof Vault list shows verification, consent and usage state |
| Research candidates create canonical sources | **MET (path)** | `ingest-content-source` accepts `research_candidate` with candidate linkage, enforced by `content_sources_adapter_check`. No Ideation-side caller yet — see Deferred. |
| Performance Insights create canonical sources | **MET (path)** | Same, for `performance_insight` |
| Every source → one or more Opportunities | **MET** | `create-content-opportunity`; live test proved one source yielding two opportunities, one composed from two sources |
| No source stream writes to Calendar or production | **MET** | Asserted live: `calendar_slots`, `content_items` and `calendar_cells` counts unchanged across the whole flow |

## Live end-to-end proof

Run against production with disposable fixtures, all removed (`content_sources`, `content_opportunities`, `proof_items` all finished at 0):

1. Manual idea entered → canonical source + `manual_ideas` row created.
2. Proof entered → source + `proof_items` row created.
3. One source produced **two** distinct opportunities; the second composed a second source as `supporting`.
4. Duplicate opportunity-source link **rejected** by unique constraint.
5. Proof confirmed **not publishable** on entry — `unverified` and `not_obtained` consent.
6. `calendar_slots`, `content_items`, `calendar_cells` counts **unchanged** — supply cannot reach the Calendar.

## Delivered this pass

**Edge Functions** (all `verify_jwt: true`, staff role + client access enforced)

- `ingest-content-source` — one entry point for all four streams; idempotent on canonical identity; handles the concurrent-duplicate race; deletes half-built sources on detail-insert failure.
- `process-source-document` — Stage C extraction; deterministic chunking; never leaves a row stuck in `extracting`.
- `create-content-opportunity` — source → opportunity; idempotent on (source, title); rejects cross-client composition; deletes the opportunity if provenance linking fails, because an opportunity without provenance is worse than none.

**Operator UI**

- `ContentSupplyPanel` — three tabs: Add Idea, Add Proof (with Proof Vault list), Sources.
- Source list with **search**, **kind filtering**, **provenance** ("Entered directly in Cockpit" vs derived from candidate/insight/document/proof), raw immutable content view, retry visibility on failed processing, and inline opportunity creation.
- Wired as a new **Content Supply** section; also replaces the previous **Proof Upload** placeholder, which read *"Not yet built."*

**Data access** — `src/lib/supply.ts`. All reads go direct under RLS; every write goes through an edge function, so the browser never writes supply tables directly.

## Deferred (deliberately, not blocking the gate)

- **Ideation and Performance Insight callers.** The ingest path accepts and validates both, and the linkage is enforced in the database, but no Ideation-side code calls it yet. Wiring belongs with Stage F, which consumes candidates.
- **Automated proof extraction.** Structured fields (`happened_what`, `happened_for`, `what_changed`, `claims_supported`) exist and the operator captures evidence detail, but no AI job populates them. Deferred rather than built, because auto-extracting claims risks asserting things the evidence does not support.
- **`ideation_technique_strategies` remains empty** — populating it means writing AA methodology, which I will not invent.

## Known divergence to close

The MCP deploy tool flattens bundle paths, so deployed bundles import `./_shared/...` while repo files correctly use `../_shared/...`. Logic identical. Run `supabase functions deploy` from the repo to converge.

## Not proven

No HTTP-level invocation test of the three functions — each requires an operator JWT that cannot be minted here, and the auth gate was not bypassed to test. The database behaviour they depend on **is** proven live. First real use through the UI is the remaining unknown.
