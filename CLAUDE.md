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

- **Phase A (schema): complete, live.** Migration `20260722203942_reel_studio_phase_a_foundations.sql` — tables `brand_prompt_blocks`, `video_projects`, `video_shots`, `generation_credits_ledger`; storage bucket `video-assets` (private). RLS: staff (`admin`/`account_manager`/`editor`) SELECT-only; writes intended via edge functions (service role). No anon access.
  - **Corrected 2026-07-23** by two additive migrations (never edit `20260722203942` in place): `20260723111327_reel_studio_phase_a_two_step_pipeline.sql` and `20260723111600_reel_studio_still_image_bucket.sql`. Reason: Higgsfield's DoP model family (the only video model confirmed available on the account, labeled "Image to Video" on Higgsfield's own dashboard) is **image-to-video, not text-to-video** — it requires a source still image plus a camera-motion directive. The real per-shot pipeline is two Higgsfield calls, not one: (1) text-to-image (Soul Standard / Popcorn Auto) → still frame, (2) DoP image-to-video using that still + a motion directive → final clip.
  - `video_shots` gained: `still_image_url`, `still_image_job_id`, `still_image_model`, `motion_type`, `motion_strength` (0–1). `status` CHECK expanded to `pending → still_submitted → still_rendering → still_complete → submitted → rendering → complete/failed`. The `video_shots_active_idx` partial index now also covers `still_submitted`/`still_rendering`. The `video-assets` bucket's `allowed_mime_types` now also includes `image/jpeg`/`image/png`/`image/webp` (same bucket holds both stills and clips; RLS unchanged, scoped by `bucket_id` not mime type).
  - No Higgsfield credentials or video jobs exist yet.
- **Phase B (two-step Higgsfield generation loop): draft written, not deployed, not live-tested.** Higgsfield's real API surface is **confirmed** from official docs (`docs.higgsfield.ai`) and the official `higgsfield-ai` GitHub org, plus third-party reseller docs (MindCloud, WaveSpeedAI) corroborating DoP's request shape — see memory file `higgsfield-api.md` for full detail. Summary: auth is `Authorization: Key {api_key}:{api_key_secret}`; submit is `POST https://platform.higgsfield.ai/{model_id}`; status is `GET https://platform.higgsfield.ai/requests/{request_id}/status`; async queue lifecycle `queued → in_progress → completed/failed/nsfw`; webhooks via `?hf_webhook={url}` query param, retried 2h, **no signature verification documented** (must re-fetch status ourselves rather than trust the webhook body). Real open gaps: no official first-party per-model parameter reference for DoP (request shape corroborated by two independent third-party sources + the account's own dashboard category, not first-party-confirmed), no documented per-request credit-cost field, generated files retained only 7 days minimum (confirms we must download into `video-assets` promptly).
  - Draft code, two function pairs (submit + check per stage, same claim/submit/poll convention as `generate-ai-background-image`/`check-ai-background-image` — conditional `UPDATE ... WHERE status = X` as the atomic claim):
    - Stage 1 (still image): `supabase/functions/submit-shot-still-image/index.ts` (claims one `pending` shot, calls `submitHiggsfieldTextToImage` with `HIGGSFIELD_MODEL_STILL`, stores `still_image_job_id`/`still_image_model`), `supabase/functions/check-shot-still-image/index.ts` (polls one `still_submitted`/`still_rendering` shot, downloads the still into `video-assets` as `{clientId}/{video_project_id}/{shotId}-still.<ext>`, sets `still_image_url`, marks `still_complete`/`failed`).
    - Stage 2 (DoP video): `supabase/functions/submit-shot-generation/index.ts` (claims one `still_complete` shot, requires `still_image_url` + `motion_type` + `motion_strength` to already be set — fails closed otherwise, mints a 1h signed URL for the still since the bucket is private, calls `submitHiggsfieldImageToVideo` with `image` + `motions: [{motion, strength}]`, stores `higgsfield_job_id`), `supabase/functions/check-shot-generation/index.ts` (polls one `submitted`/`rendering` shot, downloads the completed clip into `video-assets`, marks `complete`/`failed` — unchanged from the original draft).
    - Shared adapter: `supabase/functions/_shared/higgsfield.ts` (plain-`fetch` REST adapter, no SDK) — `submitHiggsfieldTextToImage` (stage 1, prompt-only), `submitHiggsfieldImageToVideo` (stage 2, requires `image`/`motions`), `checkHiggsfieldGeneration` (shared by both stages — still-image status returns `images`, DoP status returns `video`).
  - Config uses plain Supabase secrets (`Deno.env.get(...)`), matching the existing `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` convention — **not** the per-tenant `vault_read_credential`/`_GLOBAL_` Vault convention (that convention is for client-scoped service credentials; global AI-provider keys in this codebase are already plain env secrets). Required secrets, none set yet: `HIGGSFIELD_API_KEY` + `HIGGSFIELD_API_SECRET` (read as two separate secrets and assembled into the documented `Key {api_key}:{api_key_secret}` header — never one pre-joined value), `HIGGSFIELD_MODEL_STILL` (text-to-image model_id, single, tier-independent), `HIGGSFIELD_MODEL_DRAFT`, `HIGGSFIELD_MODEL_FINAL` (DoP model_id per render tier — fails closed with a 503 if unset rather than guessing a model_id).
  - Not yet done: no `motion_type`/`motion_strength` UI to populate those columns (Phase C); no webhook wiring (poll-only, deliberately, given the unverified-webhook gap); no `generation_credits_ledger` writes (Higgsfield's status response has no documented per-request credit-cost field); none of the four functions have been deployed or called against a real Higgsfield account.
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
