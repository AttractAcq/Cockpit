# Stage C — Live Confirmation Brief (for Claude Code, run locally)

Hand this to Claude Code inside the Cockpit repo. It has shell access, your `.env`, and network access, so it can do what a sandboxed agent cannot: authenticate and POST to the Edge Functions.

**Do not paste keys, tokens or passwords back into any chat.** Everything here runs locally and only *results* need reporting.

Project: `xivewedajschthjlblfb`
Repo: `/Users/alex/Desktop/Attract Acq/Application Surfaces/Cockpit`

---

## Prerequisites to check first

1. `.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. Confirm whether `AA_AI_GENERATION_ENABLED` is true and the Anthropic secret is set on the project (`supabase secrets list`). Test 3 cannot run without both.
3. `public.playbooks` is **empty**. Test 2 needs a playbook row to exist first — its content is AA methodology and must be written by Alex, not generated.

## Getting a token

Sign in as a staff user (role must be `admin` or `account_manager` — anything else is rejected by design) and capture the access token in a shell variable. Do not echo it.

---

## Test 1 — Source ingestion (should PASS today)

POST `/functions/v1/ingest-content-source` with:

```json
{ "client_id": "<client uuid>", "source_kind": "manual_idea",
  "title": "Live test idea", "raw_content": "clients keep asking about turnaround time" }
```

**Expect:** `201`, `duplicate: false`, a `content_source_id`, a `manual_idea_id`.

**Then send the identical request again.**
**Expect:** `200`, `duplicate: true`, the *same* `content_source_id`. This proves canonical identity and dedupe.

Cleanup: delete the created `content_sources` row (cascades to `manual_ideas`).

## Test 2 — Playbook authority

Only after a real playbook row exists. POST `/functions/v1/publish-playbook-version` with `{ "playbook_id": "<uuid>" }`.

**Expect:** `201`, version 1, `status: "active"`, a 64-char `content_hash`.

Call it again unchanged. **Expect:** `200`, `unchanged: true` — identical content must not create a second version.

## Test 3 — Claim-level citations (the gate item)

Requires AI generation enabled. Regenerate one Phase 1 file via `generate-phase-1-file`.

**Expect on success:** the file writes, and `client_context_file_citations` gains rows for that `context_file_id`. Check the **Provenance** tab in Content Supply shows them.

**Adversarial check (the important one):** the model must not be able to cite a source that does not exist. Verify by inspecting the returned `warnings` and confirming any citation present resolves to a real `client_inputs` field / `client_source_documents.id` / `client_research_sources.id`. If a citation names something absent, the function should have returned **422 and written nothing**.

Note: Client 001 has no extracted documents and no research sources, so only `client_input` citations are legitimate right now. Any `source_document` or `research_source` citation would be an invented one and should have caused rejection.

## Test 4 — Conflict detection

POST `/functions/v1/detect-input-conflicts` with `{ "client_id": "<uuid>" }`.

**Expect:** `200` with `scanned_fields`, `found`, `inserted`. Re-run it — `inserted` should be `0` and `already_open` should equal `found`, proving re-runs don't duplicate.

---

## What to report back

For each test: status code, the response body with any ids **truncated to 8 characters**, and whether it matched the expectation. No tokens, no keys.

## Open question that outranks all of this

All 21 `client_context_files` are currently `approved` with **zero citations**, generated from placeholder inputs. Workspace `CLAUDE.md` §7 records them as 17 `needs_client_input` / 4 `needs_review` / **zero approved**.

Their approval has opened Phase 2's gate, so `generate-phase-2` will now run against placeholder business context. Confirm whether that approval was deliberate before anything downstream is generated.
