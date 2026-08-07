# Programme Stage C — Phase 1 Intelligence Hardening

**Status: EXIT GATE NOT YET SATISFIED.** Ingestion and conflict detection are live; generation-time traceability and the two review UIs are not.
Date: 2026-08-03 · Project `xivewedajschthjlblfb`

> Exit gate: *"Phase 1 is complete when it reliably produces an approved and traceable client authority package suitable for repeated downstream execution."*

## Verification

| Gate | Result |
|---|---|
| Typecheck | PASS |
| Lint | PASS — 0 errors, 4 pre-existing warnings |
| Tests | PASS — **698/698** (+15 Stage C conflict rules this pass) |
| Build | PASS |
| Migration parity | 61 repo files = 61 database migrations — **corrected after an error, see below** |
| Live guarantees (fixtures) | PASS — 5 assertions, all fixtures removed |

## Delivered this pass

**`register-source-document`** (deployed v1, JWT) — lets Phase 1 draw on more than form fields. Accepts a stored file, an external URL, or text pasted by an operator. Dedupes per client on content hash. Inline text is stored but deliberately **not** marked `extracted`, so status stays honest until chunking actually runs.

**`detect-input-conflicts`** (deployed v2, JWT) — deterministic conflict detection whose rules come from your own workspace authority rather than invention:

- ZAR / South Africa references → `region_currency` (CLAUDE.md §3: Europe/EUR is current authority, ZAR is archive only). Escalates to **blocking** when ZAR and EUR appear together.
- Proof Brand Lite, Proof Engine Buildout, maintenance package → `offer_superseded`, blocking (CLAUDE.md §2 and §9).
- Numeric result claims with no verified proof item → `unsupported_result`, blocking.

Re-running never duplicates an unresolved conflict and never erases an operator's acknowledgement.

**Migration `20260803…_stage_c4_document_locator_allows_pasted_text`** — fixes a real defect I introduced in Stage C1: the original locator check assumed every document had a storage path or URL, so an operator pasting a review or customer email would have been rejected. Widened to accept inline text as a third legitimate locator. A document with *no* locator at all is still rejected — verified live.

**Rules extracted to `_shared/supply/conflicts.ts`** and unit tested (15 tests), so the deployed function and the tested code are the same module rather than two copies.

## Live verification (fixtures, all removed)

1. Pasted-text-only document **accepted** — proves the C4 fix.
2. Document with no locator at all **rejected**.
3. Conflict defaults to `open`.
4. Resolving a conflict without a note *and* resolver **rejected** — fails closed.
5. Properly resolved conflict accepted.

## Acceptance criteria

| Criterion | Status |
|---|---|
| Phase 1 can generate from more than form fields | **PARTIAL** — documents can be registered and extracted, but `generate-phase-1-file` does not yet read them |
| Every material Context claim traceable | **NOT MET** — `client_context_file_citations` has no writer |
| Playbook authority versioned and recorded | **NOT MET** — `playbook_versions` has no publisher; `client_context_file_playbooks` has no writer |
| Phase 2 cannot run before Phase 1 approved | **MET** — verified in `generate-phase-2`: requires `stage1_status = complete` **and** all 21 files approved. Currently 0 approved, so Phase 2 is correctly blocked |
| Existing approved files not silently invalidated | **MET** — `classification` is nullable and unbackfilled |

## Second pass — playbook authority (2026-08-06)

**`publish-playbook-version`** (deployed v1, JWT, role-gated not client-scoped since playbooks are AA methodology). Snapshots `playbooks.content_md` into an immutable `playbook_versions` row with a SHA-256 content hash. Identical content is **not** republished — the existing version stays authority. Activation supersedes the current active version first, because the partial unique index permits only one active version per playbook, so ordering matters. Any failure deletes the half-created version rather than leaving orphaned authority.

### Defect found and fixed: `playbook_versions_published_check`

Live testing caught a real defect **in my own Stage C2 migration**. The constraint was written as a biconditional:

```
check ((status = 'active') = (published_at is not null and published_by is not null))
```

That makes superseding a version impossible without **erasing its publication record** — destroying the audit trail that immutable version history exists to provide. `publish-playbook-version` would have failed in production on its supersede step.

Migration `20260806112728_stage_c5_fix_playbook_published_check` replaces it with the real rule: a draft is never published; an active version carries publisher and timestamp; a **superseded version retains its original publication record**.

Verified live with fixtures, all removed — 6 assertions:

1. Two active versions for one playbook **rejected**.
2. draft → supersede → activate leaves **exactly one** active.
3. The superseded version **keeps** its `published_at` and `published_by`.
4. An active version with no publisher **rejected**.
5. A draft carrying a publication record **rejected**.
6. Cleanup complete — 0 playbooks, 0 versions remaining.

This is the second defect that only surfaced by exercising the schema against real Postgres rather than trusting the migration. Both were in constraints I wrote.

## Third pass — provenance recording (2026-08-06)

**`record-context-file-provenance`** (deployed v1, JWT). Records what a context file was actually built from: every populated `client_inputs` field, every `extracted` source document, every research source, plus the active playbook version and its content hash.

**Design decision — derived, not model-reported.** The obvious implementation is to ask the model to emit its own citations. I deliberately did not: a model asserting where a claim came from is precisely how an unsupported claim acquires a *false* provenance. This function records only sources that demonstrably exist in the database. It cannot invent an attribution because it never asks for one.

Consequence, stated plainly: this gives **file-level** provenance (this file was built from these real sources), not **claim-level** attribution (this sentence came from that source). The Stage C criterion asks for the latter.

Returns `playbook_authority_missing: true` when no active playbook version exists, rather than silently recording nothing.

Verified live with fixtures against a real context file, all removed (citations finished at 0, all 21 context files intact):

1. A human-approved inference **survives re-derivation** — the delete is scoped to exclude `approved_inference`.
2. Derived citations **are** cleared and rebuilt.
3. An inference without approver and timestamp **rejected**.
4. A `client_input` citation with no field **rejected**.

## Fourth pass — conflict review UI (2026-08-06)

**`resolve-input-conflict`** (deployed v1, JWT) — records an operator decision on a detected conflict. Mirrors `client_input_conflicts_resolved_check` in the function layer, so resolving or dismissing without a written reason is rejected before it reaches the database. An already-decided conflict returns 409 rather than being silently overwritten. The decision changes **only** the conflict's own status: it never edits client inputs, context files, masters, calendar or approval state.

**Conflicts tab in `ContentSupplyPanel`** — lists every conflict with severity, type and the input field it came from; a "Scan inputs for conflicts" button invoking `detect-input-conflicts`; and per-conflict Acknowledge / Resolve / Dismiss with a required reason. The tab header shows the count of **unresolved blocking** conflicts, and the panel states plainly that those should hold Phase 1 approval.

Stage C required output "conflict review UI" is now met.

Verification: typecheck clean, lint 0 errors, 698/698 tests, build passes, migration parity **62 = 62 (checked fresh)**.

## Fifth pass — claim-level citations at generation (2026-08-06)

**`generate-phase-1-file` now emits and validates claim-level citations.** Written to the repo, typecheck/tests/build clean. **NOT YET DEPLOYED — see below.**

What changed, minimally and without reshaping working code:

- `ModelFile` gains an optional `citations[]`. The citation rules were extracted to `_shared/supply/citations.ts` so they are unit tested rather than buried in a 700-line handler.
- A **citable source inventory** is built before generation: populated `client_inputs` fields, `extracted` documents, and research sources. The prompt states this list is exhaustive.
- The citation contract and the inventory are **appended** to the existing system prompt and user message at the call site, rather than rewriting `buildSystemPrompt` / `buildUserMessage`. Less surface disturbed.
- `validateFile` now rejects any citation naming a source that does not exist. This is an **error**, so the existing 422 path applies and **no file is written**.
- The model cannot emit `approved_inference` — that origin requires a named human approver and is rejected if the model attempts it.
- A file returning zero citations is written but carries a warning that its claims are untraceable and it cannot be approved as authority.
- The upsert now returns the row id, and provenance is recorded after a successful write: citations plus every active playbook version and content hash. Re-generation replaces derived citations but **never** a human's `approved_inference`.
- If no active playbook version exists, the response says so explicitly rather than silently recording nothing.

**12 new tests, all adversarial in emphasis** (`tests/citation-validation.test.ts`): invented document ids, invented research ids, unsupplied input fields, empty inventory, missing ids, blank excerpts, attempted `approved_inference`, unknown source types, and one bad citation among good ones still failing the file.

Suite now **710/710**.

### Deployment required — repo is ahead of production for this function

This was **deliberately not deployed via the MCP tool**, which flattens `_shared` import paths and would re-introduce the repo-vs-deployed drift flagged in the Stage A audit. Deploy from the repo instead:

```
cd "/Users/alex/Desktop/Attract Acq/Application Surfaces/Cockpit"
supabase functions deploy generate-phase-1-file
```

Until that runs, production still executes the previous version, which does not record citations. **The gate is not closed until this is deployed and exercised on a real generation.**

## Sixth pass — research runs and provenance UI (2026-08-06)

**`record-research-run`** (deployed v1, JWT). Records a controlled research run with full provenance per source: url, title, publisher, retrieved_at, quoted-vs-paraphrased evidence, confidence and use restriction.

**Evidence is supplied, never generated.** A model asked to produce research URLs will invent them, and a fabricated citation that looks real is worse than none. This records what an operator — or a future real search integration — actually retrieved. Every source is validated *before* anything is written, so a run is all-or-nothing; if source insertion fails the run is marked `failed` and retryable rather than left stuck in `running`; and **a run with no sources is rejected outright** so an empty run can never appear completed.

Verified live with fixtures, all removed (5 assertions): completing a run without a timestamp rejected; invalid `confidence` rejected; invalid `evidence_kind` rejected; proper completion accepted; duplicate idempotency key per client rejected.

**Provenance tab** in `ContentSupplyPanel`. Per context file: status, version, citation count, playbook authority (or "no playbook authority" in warning colour), classification, the citations themselves with their originating field or source type, and the active playbook version with content-hash prefix. The tab header shows the count of files with **zero citations**, and the panel states plainly that such a file cannot be approved as authority.

Suite **710/710**, typecheck clean, lint 0 errors, build passes.

## Remaining for the gate

1. **Claim-level attribution at generation time.** `record-context-file-provenance` now covers file-level provenance, but the criterion asks that each *material claim* trace to a source. That needs `generate-phase-1-file` to emit per-claim citations and fail closed when a cited source does not exist. The function plus its imports is **43 KB**, and the change touches system prompt, output schema and validator together — it needs a session with full context, not the tail of one.
2. ~~`publish-playbook-version`~~ — **done** (see second pass above).
3. ~~Research run worker~~ — **done** (sixth pass above). Automated retrieval from a real search provider remains future work; the recording path and its guarantees exist.
4. ~~Conflict review UI~~ — **done** (fourth pass).
5. ~~Context-file provenance UI~~ — **done** (sixth pass).

**All Stage C required outputs are now built.** The gate closes on live confirmation only — see below.

## Correction — parity claim was wrong when first written

The first version of this document asserted "61 repo files = 61 database migrations". That was **false at the time of writing**, and I asserted it without re-checking after applying migration C4.

Two artefacts had been applied or deployed but never written to the repo:

- `20260806111537_stage_c4_document_locator_allows_pasted_text.sql` — applied to the database, missing from `supabase/migrations/`
- `supabase/functions/register-source-document/index.ts` — deployed, missing from the repo

The consequence was the exact drift flagged as HIGH severity in the Stage A audit: the database ahead of the repo, and a live Edge Function with no tracked source. The Stage C commit (`8f3a299`) therefore contained only 3 files when it should have contained 5.

Both files have since been written and the count re-verified: repo 61, database 61. **They require a follow-up commit** — they were not in `8f3a299`.

Process failure worth naming: I wrote the verification table from memory of what I had done, rather than from a fresh check. Parity claims must be re-run immediately before the status document is written, not inferred.

## Honest note

I did not reach the gate this pass. Items 1 and 2 are the load-bearing ones: until generation writes citations and playbook references, "traceable authority package" is not true, and I would rather leave the gate open than mark it met. Item 1 means modifying a live generation function that currently works, which deserves its own careful pass rather than being rushed at the end of a long session.
