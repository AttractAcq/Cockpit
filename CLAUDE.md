# CLAUDE.md — AA Cockpit

This file gives Claude Code persistent context for the **Attract Acquisition Cockpit** — the operator command centre from which the whole agency is run. Read it at the start of every session. It is the canonical build spec; if it conflicts with anything in `/docs`, **this file wins**, and surface the conflict to Alex.

## What this repo is

The AA Cockpit: a **Vite + React + TypeScript + Tailwind** single-page app, deployed to GitHub Pages. It is the *operator surface* of AA-OS — one of six surfaces. The Supabase backend (18 tables, RLS, Vault, Storage, 16 edge functions, 5 agents) **already exists and is deployed**; this repo's job is to **wire the operator UI to that backend**, not to rebuild it. Frame all work as "connect surface → existing edge functions + Supabase," per **Phase 3** of the Launch Build Plan.

## Golden architecture rules (load-bearing — never violate)

- **Surfaces are thin.** This app renders data and captures intent. It does **not** call external APIs (Meta, 360dialog, Apify, Anthropic, OpenAI, PayFast) and **never holds secrets**.
- **Every action that touches the outside world or mutates state invokes an edge function** via `supabase.functions.invoke(...)`. The cockpit is the steering wheel; edge functions are the engine.
- **Reads come from Supabase directly** (often via realtime subscriptions); **writes go through edge functions.**
- **Multi-tenant isolation is enforced by RLS at the database**, not in app code. Never filter client data in the frontend and assume that makes it safe — rely on RLS + the user's role.
- **Auth is Supabase email + password** (magic-link was abandoned — rate limits). Four roles: `admin`, `distribution`, `delivery`, `client`. Gate every workspace by role.
- Read Supabase URL + anon key from env (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). **Do not hardcode the project ref** (see Open items).

## Build & commands

Confirm against `package.json`. Typical Vite scripts:
- `npm run dev` — local dev server
- `npm run build` — production build
- `npm run preview` — preview the build
- `npm run typecheck` (or `tsc --noEmit`) — run after every change set
- Deploy: GitHub Pages — confirm the deploy script / Action before pushing.

## The 7 workspaces (the UI spec)

Each workspace reads live Supabase data and triggers edge functions for actions.

1. **Cockpit (home)** — triage queue, in-flight automations, unified inbox, live pulse, agent trail. Reads: `triage_items, automations, conversations, messages, pulse_metrics, agent_events`. Realtime: triage queue, inbox, in-flight panel. The "what needs a human, right now" view.
2. **Pipeline** — the 8-stage board; every entity in its stage; drag to advance. Reads: `entities`. Advancing a stage is deliberate and logged (it changes which agents/automations fire). The `booked → onboarding` transition is gated behind the deposit.
3. **Conversations** — unified inbox across WhatsApp (360dialog) + Instagram DM (Meta), threaded per entity. Reads: `conversations, messages`. Send → `dialog360-send`. All channels converge on the same two tables.
4. **Campaigns** — Meta campaign performance per client; the CPA-drift metrics. Reads: `campaigns, ad_metrics`. Launch/pause/edit → `meta-ad-ops`. CPA-drift cards come from `campaign-flag` into `triage_items` (SOP 10).
5. **Studio** — asset & brief library; AI brief generation; editor handoff; asset naming (SOP 13). Reads: `briefs, assets, proof_uploads` + Storage (MJRs/Reels/Proof). Generate MJR → `mjr-generate`; generate brief → `brief-generator`. Approvals happen here before anything reaches Meta.
6. **Operations** — agent & automation control panel: what's running/paused, agent event history. Reads: `automations, agent_events, audit_log`. Controls the 5 agents (Apify Scraper, OpenClaw, n8n, MetaSync, Claude Content).
7. **Money** — MRR, revenue by client, commercial picture. Reads: `payments, mrr_snapshots, contracts, pulse_metrics`. Deposit gate = PayFast ITN → `onboarding`. `mrr-calc` rolls up MRR daily.

## Pipeline stage enum (exact controlled vocabulary on `entities`)

`source` → `cold` → `contacted` → `engaged` → `booked` → `onboarding` → `active` → `delivering`

Stages 1–5 = acquisition; 6–8 = delivery. The split is the deposit (`booked → onboarding`). `entities` holds both prospects and clients, distinguished only by stage.

## Data layer

- **Supabase project ref:** `xivewedajschthjlblfb` — approved production project. Still read from env vars; do not hardcode credentials in code.
- **19 tables:** entities, conversations, messages, campaigns, ad_metrics, payments, contracts, triage_items, agent_events, automations, assets, briefs, proof_uploads, pulse_metrics, mrr_snapshots, users, team_members, audit_log, credential_registry.
- **Storage buckets (per-client, signed URLs):** MJRs (`mjrs`), Reels (`reels`), Proof Uploads (`proof-uploads`).
- **Vault:** platform keys `_GLOBAL_{SERVICE}_{CREDENTIAL_TYPE}` (leading underscore); per-client `{CLIENT_SLUG}_{SERVICE}_{CREDENTIAL_TYPE}`. Service-role only. **The frontend never reads the Vault.** Helpers: `vaultName()`, `readCredential()` in `_shared/aa.ts`.

## Edge functions the cockpit interacts with (16)

- **Invoke from UI actions:** `mjr-generate`, `brief-generator`, `meta-ad-ops`, `dialog360-send`, `onboarding`, `client-portal-sync`, `aicos-act`, `proof-capture`, `public-lead-capture`.
- **Background (do NOT call from UI; just surface their output):** `apify-scrape` (cron), `lead-score` (trigger), `campaign-flag` (cron), `mrr-calc` (cron), `audit-log` (trigger), `dialog360-webhook` / `meta-webhook` (inbound).

## Brand tokens (CONFIRMED — use these, not the docs' DM stack)

- Background `#0A0E0D` · teal `#00E5C3` (primary / outbound) · amber `#FFB454` (return / telemetry)
- Fonts: **Archivo Expanded** (display), **Archivo** (body), **JetBrains Mono** (mono / data)
- Note: `/docs/Launch_Build_Plan` says "#07100E + DM Serif/DM Sans/DM Mono" — that is **STALE**. The stack above (and the System Map) is canonical.

## Repo etiquette / known hazards

- **One canonical repo, one Supabase project.** A prior incident had two repos sharing one Supabase project — do not reintroduce that. If unsure which repo/project is canonical, stop and ask.
- Typecheck before declaring a change done. **Don't replace a real Supabase query with a mock to make something pass.**
- When swapping mock → real data, **keep call signatures identical** (Phase 3 instruction).

## Open items — DO NOT silently resolve; flag to Alex

1. **Supabase project ref — RESOLVED.** Confirmed `xivewedajschthjlblfb`. Env var rule still applies; ambiguity closed.
2. **PayFast ITN (P0 — blocks revenue)** — `_GLOBAL_PAYFAST_MERCHANT_KEY` registered in `credential_registry` but NOT in `vault.secrets`. No ITN handler function exists. `onboarding` is verify_jwt=true so unsuitable for raw webhooks. Needs a new `payfast-webhook` function (verify_jwt=false, HMAC-SHA1) + vault key populated. Deposit gate does not work until resolved.
3. **Recurring billing** — only the deposit gate exists; there is no mechanism to charge the monthly retainer that `mrr-calc` reports. Don't invent one without sign-off.
4. **Backup / DR** — single Supabase project, no documented backup/PITR. Check Supabase dashboard (Settings → Backups) — cannot confirm via SQL. Note if any work increases this risk.
5. **Monitoring** — no agent/function alerting or "machine down" runbook. The Operations workspace is the closest thing; don't assume external alerting exists.
6. **Cold WhatsApp + POPIA §69** — outreach (SOP 01) carries account-ban + consent risk; relevant if building outreach UI.
7. **Security (2026-06-21 audit)** — anon EXECUTE on `increment_ad_lead`, `trg_lead_score_before/after` must be revoked; leaked-password protection must be enabled; double-SELECT RLS policies need fixing before real traffic.

## Reference docs (load on demand)

@docs/attract-acquisition-backend.md — backend spec: schema, RLS, edge functions, vault
@docs/attract-acquisition-frontend_1.md — frontend spec: workspace-by-workspace UI contract
@docs/attract-acquisition-system-map_1.md — the visual connectivity map
@docs/reconciliation-report.md — live-state source of truth (2026-06-21 introspection vs. the specs above; where they conflict, this wins)
