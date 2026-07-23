# CLAUDE.md — AA Cockpit (Reel Studio era)

This file gives Claude Code persistent context for the **Cockpit repo**. Read it at the start of every session.

**Everything below section "Superseded" in this file describing a 7-workspace / `entities` / `campaigns` / MRR architecture is retired.** That architecture does not exist in the live database and its referenced spec docs (`docs/attract-acquisition-backend.md`, `-frontend_1.md`, `-system-map_1.md`) no longer exist in this repo. Do not rebuild it.

## Repo / remote / project identity — verify every session

- **This repo is the working repo for Cockpit app code.** Repo root: `/Users/alex/Desktop/Attract Acq/Application Surfaces/Cockpit`
- **Remote:** `https://github.com/AttractAcq/Cockpit` (origin)
- **Production Supabase project:** `xivewedajschthjlblfb`
- Broader workspace/business instructions live in the root `CLAUDE.md` at `/Users/alex/Desktop/Attract Acq/CLAUDE.md` — that file wins on positioning, offers, commercial authority, and workspace-wide build-track status. This file wins on Cockpit repo/app specifics.

**Before starting any build session, verify:**
1. `pwd` and `git rev-parse --show-toplevel` match the repo root above.
2. `git remote -v` includes `AttractAcq/Cockpit`.
3. `git status --short` is clean (or every non-clean entry is explained/expected).
4. The target Supabase project is `xivewedajschthjlblfb`.
5. Stop and report if any of the above don't match — do not proceed from the wrong repo/project.

## Golden architecture rules (load-bearing — never violate)

- **Surfaces are thin.** This app renders data and captures intent. It does **not** call external APIs (Meta, Higgsfield, Anthropic, OpenAI, etc.) directly and **never holds secrets**.
- **Every action that touches the outside world or mutates state invokes an edge function** via `supabase.functions.invoke(...)`.
- **Reads come from Supabase directly**; **writes go through edge functions.**
- **Multi-tenant isolation is enforced by RLS at the database**, not in app code.
- Read Supabase URL + anon key from env (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Do not hardcode credentials.
- No secrets printed to logs or committed to the repo. No credentials stored in client-facing settings tables.

## Build & commands

```bash
npm install
npm run dev        # local dev server
npm run typecheck  # tsc --noEmit — run after every change
npm run build      # production build
```

Conventions: named function exports, one component per file, PascalCase filenames; absolute imports via `@/`; never `any` (prefer `unknown` + narrow); Tailwind utility classes only; never replace a real Supabase query with a mock to make something pass.

## Current build status

**All previous Cockpit build tracks (Client Context OS Phase 1/2, Batch A–D1) are closed** unless explicitly reopened by Alex.

**Active authorized build: Reel Studio (AI video generation).**

- **Phase A (schema): complete, live.** Migration `20260722203942_reel_studio_phase_a_foundations.sql` — tables `brand_prompt_blocks`, `video_projects`, `video_shots`, `generation_credits_ledger`; storage bucket `video-assets` (private). RLS: staff (`admin`/`account_manager`/`editor`) SELECT-only; writes intended via edge functions (service role). No anon access. No Higgsfield credentials or video jobs exist yet.
- **Phase B (single-shot Higgsfield generation loop): draft written, not deployed, not live-tested.** Higgsfield's real API surface is now **confirmed** from official docs (`docs.higgsfield.ai`) and the official `higgsfield-ai` GitHub org — see memory file `higgsfield-api.md` for full detail. Summary: auth is `Authorization: Key {api_key}:{api_key_secret}`; submit is `POST https://platform.higgsfield.ai/{model_id}`; status is `GET https://platform.higgsfield.ai/requests/{request_id}/status`; async queue lifecycle `queued → in_progress → completed/failed/nsfw`; webhooks via `?hf_webhook={url}` query param, retried 2h, **no signature verification documented** (must re-fetch status ourselves rather than trust the webhook body). Real open gaps: no documented draft/final tier flag (may just be model_id choice), no per-model parameter reference, generated files retained only 7 days minimum (confirms we must download into `video-assets` promptly).
  - Draft code: `supabase/functions/_shared/higgsfield.ts` (plain-`fetch` REST adapter, no SDK), `supabase/functions/submit-shot-generation/index.ts` (claims one `pending` `video_shots` row, submits it, stores `higgsfield_job_id`), `supabase/functions/check-shot-generation/index.ts` (polls one `submitted`/`rendering` shot, downloads the completed clip into `video-assets`, marks `complete`/`failed`). Both follow the `generate-ai-background-image`/`check-ai-background-image` claim/submit/poll convention (conditional `UPDATE ... WHERE status = X` as the atomic claim, no new RPC/migration added).
  - Config uses plain Supabase secrets (`Deno.env.get(...)`), matching the existing `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` convention — **not** the per-tenant `vault_read_credential`/`_GLOBAL_` Vault convention (that convention is for client-scoped service credentials; global AI-provider keys in this codebase are already plain env secrets). Required secrets, none set yet: `HIGGSFIELD_API_KEY` + `HIGGSFIELD_API_SECRET` (read as two separate secrets and assembled into the documented `Key {api_key}:{api_key_secret}` header — never one pre-joined value), `HIGGSFIELD_MODEL_DRAFT`, `HIGGSFIELD_MODEL_FINAL` (model_id per render tier — fails closed with a 503 if unset rather than guessing a model_id).
  - Not yet done: no webhook wiring (poll-only, deliberately, given the unverified-webhook gap); no `generation_credits_ledger` writes (Higgsfield's status response has no documented per-request credit-cost field); neither function has been deployed or called against a real Higgsfield account.
- **Phase C (orchestration + Studio UI): not started.**
- **Phase D (handoff + telemetry): not started.**

### The `reel_video` / `humanOnly` gate

The live codebase currently hard-rejects `reel_video`-format production briefs as human-only (`_shared/ai-asset-generation.ts`, `_shared/production-brief-contract.ts`, and 7 other touchpoints — see the reconciliation history for the full list). **Reel Studio is intended to eventually supersede this gate**, but:
- **Do not casually remove or relax this gate.** It is a known, deliberate product rule today.
- It may only be relaxed in the correct later phase (Phase D), with tests, and with an explicit go-ahead.
- No video generation, publishing, scheduling, Phase 3 changes, or worker/cron changes should happen without an explicit gate/sign-off.

## Reference docs (load on demand)

- `docs/EDGE_FUNCTIONS_REFERENCE.md`, `docs/PHASE_3_COCKPIT_WIRING_PLAN.md`, `docs/PREFLIGHT_READINESS.md`, `docs/VAULT_SECRET_RECONCILIATION.md` — current-era references; verify against live state before trusting fully.
- `docs/reconciliation-report.md` is **deprecated** (describes the retired 7-workspace/`entities`/`campaigns` architecture as of 2026-06-21; superseded by the Client Context OS schema and now by Reel Studio). See the deprecation notice at the top of that file.
