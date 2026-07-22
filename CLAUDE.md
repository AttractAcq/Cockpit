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
- **Phase B (single-shot Higgsfield generation loop): not started.** Higgsfield's real API surface (auth, job lifecycle, polling/webhook contract) is **not confirmed** — no first-party docs verified. **Do not write code against guessed Higgsfield endpoints. Do not call Higgsfield until authoritative API docs or dashboard details are supplied.**
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
