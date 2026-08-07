# Stage C — Claim-Level Citations at Generation: Implementation Handoff

Written 2026-08-06. This is the **one remaining item** Stage C's exit gate turns on.
Start a fresh session with this document and `Stage_C_Status.md`.

## The goal

Stage C acceptance criterion 2: *"Every material Context claim is traceable to client input, uploaded source, research source, or approved inference."*

`record-context-file-provenance` already gives **file-level** provenance. This task adds **claim-level** attribution, produced at generation time and failing closed.

## The target

`supabase/functions/generate-phase-1-file/index.ts` — 666 lines, 30,705 bytes.
Imports: `../_shared/aa.ts` (2 KB), `../_shared/anthropic.ts` (10.5 KB). **43 KB total must be re-transmitted to deploy via MCP.**

Known landmarks (line numbers at commit `2d2ca3e`):

| Line | What |
|---|---|
| 181 | `buildSystemPrompt(def)` — where the citation contract must be stated |
| 261 | `buildUserMessage(...)` — where the available source inventory must be listed |
| 352 | `extractJson(text)` — parses the model's JSON |
| 395 | `validateFile(...)` — where citation validation belongs |
| 454 | `Deno.serve(...)` — request handler |
| ~612 | upsert into `client_context_files` — **currently does not return the row id** |

## Required changes

1. **`ModelFile` type** — add optional `citations: Array<{ claim_excerpt, source_type, client_input_field?, source_document_id?, research_source_id? }>`.

2. **`buildUserMessage`** — pass the model an explicit inventory of what it may cite: the populated `client_inputs` field names, the ids of `client_source_documents` with `processing_status = 'extracted'`, and the ids of `client_research_sources`. The model may only cite from this list.

3. **`buildSystemPrompt`** — require a citation for every material claim, restricted to the supplied inventory. State that a claim which cannot be cited must be reported as a gap (existing `missing_inputs` / `proof_gaps` mechanism), **never invented**.

4. **`validateFile`** — validate every citation against the inventory. **Fail closed:** a citation naming a source that does not exist is a validation error, not a warning, and the file is not written. This mirrors the existing behaviour where validation failure returns 422 and writes nothing.

5. **Upsert** — add `.select("id, version").single()` so the context file id is available.

6. **After successful upsert** — insert `client_context_file_citations` rows for the model's citations, and `client_context_file_playbooks` rows for every `playbook_versions` row with `status = 'active'` (id, version, content_hash). Reuse the shape in `record-context-file-provenance/index.ts`.

## Non-negotiables

- **Never let the model invent a source.** The database constraint `client_context_file_citations_origin_check` enforces exactly one origin per citation, but it cannot know whether the id is real. Validation must check existence.
- **`approved_inference` is never model-emitted.** Only a human sets it, with rationale, approver and timestamp. The model must not be able to produce one.
- **Do not weaken existing validation** to make citations pass.
- **Status is never `approved`** — already enforced; keep it.

## Verification before declaring done

1. `npx tsc --noEmit`, `npm run lint`, `node --test tests/*.test.ts`, `npm run build`.
2. Live test with disposable fixtures: generate one file for a test client, confirm citation rows exist and every `source_document_id` / `research_source_id` resolves to a real row.
3. Adversarial test: force a citation naming a non-existent source id and confirm the file is **rejected**, not written.
4. Confirm the 21 existing context files are untouched.
5. Re-run `select count(*) from supabase_migrations.schema_migrations` and compare to `ls supabase/migrations | wc -l` **immediately before** writing any status document.

## Why this was deferred four times

Not avoidance — the change touches prompt, output schema and validator together in a live function that currently works, and the deploy path requires re-sending 43 KB. Two defects in this stage (`playbook_versions_published_check` biconditional, `client_source_documents_locator_check` too narrow) were caught only by exercising the schema against real Postgres. This change deserves the same standard, at the start of a session rather than the end of one.

## After this lands

Stage C's remaining item is the **research run worker** (nothing writes `client_research_runs` / `client_research_sources`) and the **context-file provenance UI**. Then the gate closes and Stage D begins.
