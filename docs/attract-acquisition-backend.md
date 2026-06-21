# Attract Acquisition — Backend Specification (v1.2 · reconciled to live project iwkhdqqgfjtpdhcbpftu on 2026-06-21)

**Part 3 of 3** of the Claude Code build context. Read alongside:
- `attract-acquisition-system-map.md` — the architecture & every connection (canonical)
- `attract-acquisition-frontend.md` — the cockpit UI and which functions it invokes

This document defines the **logic and data layers** of AA-OS: the Supabase database, the 16 edge functions, the 5 agents, the 9 external services, the security model, and the schedules — closing the loop on every connection the first two files reference.

> **The backend is already largely deployed.** Treat the live Supabase project as authoritative: **introspect the schema and existing functions; do not recreate them.** The schemas below are the *expected shape* to verify against, not migrations to run blind. Where a name differs between these docs and the live project, the live project wins — and flag it.

---

## 0. The backend contract (the layering law)

```
Surfaces → Edge functions → Supabase (tables / Storage / Vault) + External APIs
```

- **Surfaces never reach external APIs and never hold secrets.** Only edge functions do.
- **Edge functions are the only code that reads the Vault** (as the service role) and the only code that calls Meta / 360dialog / Apify / Anthropic / OpenAI / PayFast / R2 / Telegram.
- **Isolation is enforced by the database (RLS), not by application code.** It holds even if a surface has a bug.
- **Every mutating function writes an audit record** via `audit-log`. Nothing — human or agent — acts without a trace.

Trigger taxonomy used below: **CRON** (scheduled) · **TRIGGER** (DB insert/update) · **WEBHOOK** (inbound external event) · **INVOKE** (called by a surface or another function).

---

## 1. The data layer — Supabase

### 1.1 Project & environment
- **Project ref:** **`iwkhdqqgfjtpdhcbpftu`** ("Attract") — CONFIRMED ACTIVE_HEALTHY, eu-west-1 (Ireland). `ayfidvycgqorxmlczyxl` ("Attract Acquisition") is INACTIVE — disregard it entirely. Code reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (frontend) and the service-role key (functions) from env — never hardcode the ref.
- One project = the single source of truth. No surface keeps a private copy of client state.

### 1.2 The 19 tables (live schema — confirmed 2026-06-21)

`entities` is the spine: **prospects and clients are the same table**, distinguished only by `stage`. A client is an entity that reached `onboarding`. Nothing is ever migrated as it advances.

> **Monetary values:** All money is stored in cents — `amount_cents`, `mrr_cents`, `spend_cents`, `daily_budget_cents`. Divide by 100 for display. Never store fractional-rand values.

**Core**
- `entities` — id (uuid pk), business_name, niche, city, contact_name, contact_email, contact_phone, **icp_score** (numeric), **stage** (enum §1.3), slug (citext, unique), notes_signals (jsonb), created_at, updated_at. *(NOT in live schema: ig_handle, source, channel, owner_id — do not reference these columns.)*
- `conversations` — id, entity_id → entities, channel (`whatsapp`|`instagram`), last_message_at, unread (bool), status, created_at
- `messages` — id, conversation_id → conversations, direction (`in`|`out`), sender, body, media_url, sent_at, created_at. **NOTE: messages are NOT directly linked to entities. Join path is `messages → conversations → entities` (via `conversations.entity_id`).** *(NOT in live: entity_id, channel, status, external_id.)*

**Commerce**
- `campaigns` — id, entity_id → entities, external_id (platform campaign ID), platform, name, objective, status, daily_budget_cents, started_at, ended_at, created_at, updated_at
- `ad_metrics` — id, campaign_id → campaigns, metric_date, spend_cents, impressions, clicks, leads, conversions, created_at. *(ctr and cpa are DERIVED — not stored: ctr = clicks/impressions (dimensionless ratio); cpa = spend_cents / leads / 100, result in **rand**. Surfaces must NOT apply a further /100 conversion.)*
- `payments` — id, entity_id → entities, external_ref (payment-gateway reference), amount_cents, currency, tier (`deposit`|`retainer`), status, paid_at, created_at
- `contracts` — id, entity_id → entities, tier (`proof_sprint`|`proof_brand`|`authority_brand`), status, document_url, signed_at, starts_at, ends_at, mrr_cents, created_at, updated_at

**Operations**
- `triage_items` — id, entity_id → entities, source (`openclaw`|`campaign_flag`), priority, status (`open`|`resolved`), title, detail, assigned_to, created_at, resolved_at. ⚠️ **OPEN QUESTION — triage schema gap:** `score (0–1)` and `suggested_reply` DO NOT EXIST as columns in the live schema. It is undecided whether OpenClaw's score and draft reply live in `agent_events.payload` or need columns added here. **Do not render these fields until resolved with Alex (Stage 1 decision). Do not invent a resolution.**
- `agent_events` — id, entity_id (nullable), agent (`apify`|`openclaw`|`n8n`|`metasync`|`claude`), event_type, payload (jsonb), status, created_at
- `automations` — id, entity_id → entities, name, platform, external_id (e.g. n8n workflow ID), trigger_type, status (`running`|`done`|`failed`|`dead_letter`), last_run_at, config (jsonb), created_at, updated_at. *(NOT in live: step, retries — do not reference.)*

**Content**
- `assets` — id, entity_id → entities, kind (`mjr`|`reel`|`image`|`proof`), title (SOP 13 convention), storage_path, status (`draft`|`awaiting_approval`|`approved`|`rejected`|`shipped`), metadata (jsonb), created_at, updated_at. *(NOT in live: created_by.)*
- `briefs` — id, entity_id → entities, ref_code, title, body (all narrative content — archetype, hook, storyboard, caption are packed into body), status, created_at, updated_at. *(NOT in live: archetype, hook, storyboard, caption, asset_id, created_by.)*
- `proof_uploads` — id, entity_id → entities, phase (e.g. before/during/after), storage_path, caption, captured_at, created_at. *(NOT in live: job_tag, metadata, captured_by.)*

**Metrics**
- `pulse_metrics` — id, entity_id (nullable), metric_key, metric_value, metric_date, created_at. *(NOT in live: scope, metric, value, period, captured_at.)*
- `mrr_snapshots` — id, date, total_mrr, active_clients, breakdown (jsonb), created_at

**Auth**
- `users` — id (= auth uid), email (citext), full_name, created_at, updated_at
- `team_members` — id, user_id → auth, role (`admin`|`distribution`|`delivery`|`client`), team_id (nullable), client_entity_id (nullable — set for `client` role), created_at. *(NOT in live: display_name, rate, status. The `entity_id` column from the spec is `client_entity_id` in live.)*
- `audit_log` — id (**bigint**, not uuid), actor_id (uuid), action, table_name, record_id (text), metadata (jsonb, contains combined before/after/context), created_at. *(NOT in live: separate `actor (text)`, `before (jsonb)`, `after (jsonb)` columns. Actor type — user/agent/system — is not stored as a distinct field. INSERT is trigger-only via SECURITY DEFINER; no INSERT policy exists or is needed.)*

**Credential store (table 19 — undocumented in earlier spec, present and load-bearing)**
- `credential_registry` — id (uuid pk), client_slug (text), service (text), credential_type (text), vault_name (text), created_at. RLS enabled. Maps `(client_slug, service, credential_type) → vault_name`; read by `readCredential()` in `_shared/aa.ts`. Currently 8 `_global` rows for platform credentials. Note: `_GLOBAL_PAYFAST_MERCHANT_KEY` is registered here but NOT yet written to `vault.secrets` (P0 blocker — see §8). The n8n onboarding webhook is stored as a Supabase edge-function secret (`AA_N8N_ONBOARDING_WEBHOOK`), not in vault — that is the correct pattern.

### 1.3 Pipeline stage enum (controlled vocabulary on `entities.stage`)

`source · cold · contacted · engaged · booked · onboarding · active · delivering`

Stage is a contract — moving an entity changes which agents act and which automations fire. Transitions:

| Transition | Caused by | Gate |
|---|---|---|
| source → cold | `lead-score` passes ICP ≥ ~65 | automatic |
| cold → contacted | VA starts SOP 01 (`dialog360-send`) | human |
| contacted → engaged | inbound reply via webhook | automatic on reply |
| engaged → booked | Alex books the call | human |
| **booked → onboarding** | **PayFast deposit cleared** | **deposit gate — money must clear** |
| onboarding → active | `onboarding` checklist completes | automatic on completion |
| active → delivering | steady-state reached | human/automatic |

The deposit gate is the only hard, money-backed transition. The frontend must not allow it manually.

### 1.4 Storage (3 buckets)
Per-client buckets, served via **signed URLs** (time-limited, scoped — never public):

| Bucket | Max file size | Allowed MIME types | Written by |
|---|---|---|---|
| `mjrs` | 50 MB | PDF, PNG, JPEG | `mjr-generate` |
| `reels` | 500 MB | MP4, MOV, JPEG, PNG | editor upload |
| `proof-uploads` | 25 MB | JPEG, PNG, WEBP, HEIC | `proof-capture` |

Note: the bucket slug is `proof-uploads` (not `proof`). The Upload PWA and `proof-capture` function already use this name.

Files are referenced from `assets` / `proof_uploads`; the tables hold the path, Storage holds the bytes.

### 1.5 Vault (credential store)
**Readable only by the service role** that edge functions run as. Read at call time, discarded after. **No surface ever reads the Vault.**

**Naming conventions (CONFIRMED):**
- **Platform credentials:** `_GLOBAL_{SERVICE}_{CREDENTIAL_TYPE}` — leading underscore. Example: `_GLOBAL_ANTHROPIC_API_KEY`.
- **Exception:** `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` — no leading underscore (documented exception).
- **Per-client credentials:** `{CLIENT_SLUG}_{SERVICE}_{CREDENTIAL_TYPE}`. None yet — no paying clients onboarded.

**Current vault secrets (6 of 8 registered):**

| vault_name | Service |
|---|---|
| `_GLOBAL_ANTHROPIC_API_KEY` | Anthropic |
| `_GLOBAL_APIFY_API_TOKEN` | Apify |
| `_GLOBAL_META_SYSTEM_USER_TOKEN` | Meta |
| `_GLOBAL_OPENAI_API_KEY` | OpenAI |
| `_GLOBAL_TELEGRAM_BOT_TOKEN` | Telegram |
| `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` | Supabase (no leading underscore — documented exception) |

**Gap:** `_GLOBAL_PAYFAST_MERCHANT_KEY` is registered in `credential_registry` but NOT written to `vault.secrets`. PayFast cannot operate until this is populated. (P0 blocker — §8 item 1.)

**Access helpers** in `_shared/aa.ts`: `vaultName(clientSlug, service, credentialType)` builds the key; `readCredential(clientSlug, service, credentialType)` reads from vault via service role. These are the only permitted vault-read paths.

Functions that read the Vault: `dialog360-send`, `meta-ad-ops`, `mjr-generate`, `brief-generator`, `aicos-act`, `apify-scrape`. **No surface ever reads it.** Setting up a new client's Vault entries is SOP 14.

### 1.6 Row-Level Security (the isolation keystone)
- Enforced by the database, not app code. **All 19 tables have RLS enabled.**
- Four roles (`app_role` enum): **`admin`** (all clients), **`distribution`** (prospect/conversation data for outreach), **`delivery`** (content/briefs/assets for assigned clients), **`client`** (only their own rows).
- Entity kind (`entity_kind` enum): **`prospect`** | **`client`** — same `entities` table, same RLS; stage is the distinguishing field.
- **Three helper functions (CONFIRMED names — all STABLE SECURITY DEFINER):**
  - **`auth_role()`** — returns `app_role` for the current `auth.uid()` via `team_members`
  - **`auth_entity_ids()`** — for admin/distribution/delivery: all entity UUIDs; for client: only their `client_entity_id`
  - **`auth_team_id()`** — returns `team_id` from `team_members` for `auth.uid()`
  - **The `get_my_role()` / `get_my_client_id()` / `get_my_metadata_id()` variants DO NOT EXIST.** Do not reference them.

**Live policy pattern:**

| Policy | Applies to | Rule |
|---|---|---|
| `{table}_select` | Most tables | Scoped via `auth_entity_ids()` — clients see only their entity's rows; staff see per-role |
| `{table}_staff_write` | Most tables | `ALL` for admin/distribution/delivery ⚠️ *`ALL` includes SELECT, creating two permissive SELECT paths for staff. Known performance issue — change to `INSERT, UPDATE, DELETE` before real traffic (§8 security advisors)* |
| `audit_log` | audit_log | admin-only SELECT; INSERT is trigger-only (no policy needed — trigger runs as SECURITY DEFINER) |
| `users` / `team_members` | users, team_members | admin ALL + self-select policy for own row; users also has self-update |
| `pulse_metrics` | pulse_metrics | `auth_entity_ids()` (client) / `auth_role()` (global) |
| `agent_events`, `mrr_snapshots` | — | `auth_role()` — admin/internal only |
| `credential_registry` | — | RLS enabled; service-role access only (no client-facing reads) |

| Table group | Scoped by | Rule |
|---|---|---|
| entities, conversations, messages, campaigns, ad_metrics, payments, contracts, assets, briefs, proof_uploads, triage_items, automations, credential_registry | `auth_entity_ids()` | client sees only their entity's rows; staff per role |
| pulse_metrics | `auth_entity_ids()` / `auth_role()` | clients see only their slice |
| agent_events, audit_log, mrr_snapshots | `auth_role()` | admin/internal only |
| users, team_members | `auth_role()` | admin + self-select |

The guarantee (Principle 5): a client opening the portal **physically cannot** retrieve another client's rows — the database refuses rows that fail `auth_entity_ids()`, regardless of what the request asks for. **Test this explicitly** with two client users (Phase 1 gate / Phase 6 security review).

---

## 2. The 16 edge functions

Notation: **invoker** = who calls it (▶ from the cockpit UI, or auto). Every mutating function also writes via `audit-log`.

### Ingestion & intelligence

**`apify-scrape`** — *CRON, daily 03:00 SAST* · `verify_jwt=true`
Orchestrates the Google Maps scrape over Cape Town clusters, applies the owner-operator filter, **dedupes against `entities`**, enriches, and writes genuinely new prospects at `source`.
Reads: Apify (Vault key). Writes: `entities`, `agent_events`. Invoker: cron (Apify Scraper agent). Surfaced in: Pipeline, Operations.

**`lead-score`** — *TRIGGER, on `entities` insert/update* · `verify_jwt=true`
Assigns an ICP fit score (industry, location, lead-absorption signals). ≥ ~65 → `cold` queue; below → parked. The gate that protects founder time.
Reads/Writes: `entities`. Invoker: DB trigger.

**`aicos-act`** — *INVOKE* · `verify_jwt=true`
The bridge to OpenClaw. Routes a message/command to OpenClaw, returns a hot/warm/cold score (0–1) + suggested reply/draft, and creates triage items.
Reads: OpenAI, Telegram (Vault). Writes: `triage_items`, `agent_events`. Invoker: ▶ Cockpit, Conversations, Operations.

### Messaging

**`dialog360-send`** — *INVOKE* · `verify_jwt=true`
Sends WhatsApp messages (template + freeform), rate-limited, reading the client's number config from the Vault.
Reads: 360dialog, Vault. Writes: `messages`. Invoker: ▶ Conversations / Cockpit / Studio (⛔ human-approved).

**`dialog360-webhook`** — *WEBHOOK* · `verify_jwt=false` (inbound from 360dialog — no Supabase JWT)
Receives inbound WhatsApp; threads into a `conversation` tied to the entity; can advance `contacted → engaged`.
Reads: 360dialog. Writes: `messages`, `conversations`. Invoker: 360dialog inbound.

**`meta-webhook`** — *WEBHOOK* · `verify_jwt=false` (inbound from Meta — no Supabase JWT)
Receives Instagram DMs and ad-lead events.
Reads: Meta. Writes: `messages`, `ad_metrics`. Invoker: Meta inbound.

### Ad operations

**`meta-ad-ops`** — *INVOKE* · `verify_jwt=true`
Creates / pauses / edits campaigns and reads insights, using the client's Meta token from the Vault at call time.
Reads: Meta, Vault. Writes: `campaigns`. Invoker: ▶ Campaigns (⛔). Also called by MetaSync to pull insights.

**`campaign-flag`** — *CRON* · `verify_jwt=true`
Compares trailing 48-hour CPA against the 7-day baseline; a ~35% jump raises a decision card under SOP 10.
Reads: `ad_metrics`. Writes: `triage_items`. Invoker: cron (paired with MetaSync). Surfaced in: Campaigns, Cockpit.

### Content & proof

**`mjr-generate`** — *INVOKE* · `verify_jwt=true`
Assembles the competitor/market picture, calls Claude for the narrative copy, renders the PDF to Storage, records it in `assets`.
Reads: Anthropic, Vault. Writes: `assets`, Storage (`mjrs`). Invoker: ▶ Studio / Cockpit (⛔ to send).

**`brief-generator`** — *INVOKE* · `verify_jwt=true`
Generates reel/content briefs from the client's brand context (AA voice constrained).
Reads: Anthropic, Vault. Writes: `briefs`. Invoker: ▶ Studio.

**`proof-capture`** — *INVOKE* · `verify_jwt=true`
Ingests AA Upload captures (authenticated by the client's JWT), uploads to Storage, extracts metadata, writes records.
Writes: `proof_uploads`, `assets`, Storage (`proof`). Invoker: **AA Upload** (not the cockpit). Surfaced in: Studio.

### Client, finance & audit

**`client-portal-sync`** — *INVOKE* · `verify_jwt=true`
Aggregates client-scoped metrics *behind the RLS boundary* and returns a client-scoped view (the portal dashboard).
Reads: `ad_metrics`, `assets`, `campaigns` (RLS-scoped). Invoker: **AA Client Portal** (not the cockpit).

**`onboarding`** — *INVOKE (fired by the cleared deposit)* · `verify_jwt=true`
Runs the day 1–7 checklist: hands the sequence to n8n, walks Meta access handoff (SOP 06), brand-asset collection, and Vault setup (SOP 14); advances `booked → onboarding → active`.
Reads: n8n. Writes: `entities` (stage), `automations`. Invoker: deposit (PayFast ITN) → see §5 gap. Surfaced in: Pipeline, Money, Operations.

**`mrr-calc`** — *CRON, daily* · `verify_jwt=true`
Rolls up active-client MRR.
Writes: `mrr_snapshots`, `pulse_metrics`. Invoker: cron. Surfaced in: Money, Cockpit.

**`audit-log`** — *TRIGGER, called by every mutating function* · `verify_jwt=true`
Writes the immutable, tamper-evident record.
Writes: `audit_log`, `agent_events`. Invoker: every mutation.

### Lead capture (the 16th — beyond the docs' 15)

**`public-lead-capture`** — *WEBHOOK / INVOKE (public POST from the site)* · `verify_jwt=false` (unauthenticated form POST from the public site)
Receives the MJR lead-magnet form submission from **AA Public Site** and writes a new prospect into `entities` at `source` (then `lead-score` fires). **This is the documented gap the map fixes** — without it the public site has no path into the pipeline.
Writes: `entities`. Invoker: AA Public Site form. Surfaced in: Pipeline.

---

## 3. The 5 agents

Guardrails (all agents): **propose, humans dispose** on anything client-facing; **every action logged** to `agent_events` via `audit-log`; **brand-constrained** content generation. Note: `lead-score` uses `claude-haiku-4-5-20251001` for fast ICP scoring on entity insert.

| Agent | Runtime | Cadence / trigger | Role | Calls / writes |
|---|---|---|---|---|
| **Apify Scraper** | Apify · Maps | daily 03:00 SAST | top-of-funnel sourcing, dedupe | `apify-scrape` → `entities` |
| **OpenClaw (AICOS)** | `gpt-5.4-mini` + Telegram | event-driven (on inbound) | scores replies (0–1), drafts MJRs/replies, creates triage items | `aicos-act` → `triage_items`, `agent_events` |
| **n8n Orchestrator** | Docker self-host | cron + event; 15–20 concurrent | multi-step workflows: onboarding, cadences; retries + dead-letter | `onboarding`, `automations` |
| **MetaSync** | Meta Graph API | hourly | polls spend/CTR/CPA, flags drift | `meta-ad-ops` (read) → `ad_metrics`; pairs with `campaign-flag` |
| **Claude Content** | `claude-sonnet-4-6` | on request | drafts briefs, MJR copy, client comms (AA voice) | `brief-generator`, `mjr-generate` |

---

## 4. External services (9) — auth & touchpoints

| Service | Auth model | Credential home | Touched by functions |
|---|---|---|---|
| **Meta** Graph API | system-user token | Vault (per client) | `meta-ad-ops`, `meta-webhook` |
| **360dialog** | BSP key per number | Vault (per number) | `dialog360-send`, `dialog360-webhook` |
| **Apify** | API token | Vault (platform) | `apify-scrape` |
| **Anthropic** | API key | Vault (platform) | `mjr-generate`, `brief-generator` |
| **OpenAI** | API key | Vault (platform) | `aicos-act` (OpenClaw runtime) |
| **PayFast** | merchant + ITN webhook | merchant portal + Vault | deposit gate → `onboarding` (see §5) |
| **Google Workspace** | OAuth per user | OAuth | infra (Drive/Gmail/Calendar); not wired to a specific function in the map |
| **Cloudflare R2** | S3-compatible keys | Vault (platform) | asset/video CDN delivery (Storage/Studio) |
| **Telegram** | Bot API token | Vault (platform) | `aicos-act` (OpenClaw transport) |

Meta and 360dialog are the two AA operates *on behalf of clients* — hence per-client Vault isolation. PayFast is the third critical one: its ITN is the single signal that turns a prospect into a client.

---

## 5. Schedules & webhooks (consolidated)

**Cron (pg_cron — ~3 jobs):**
- `apify-scrape` — daily 03:00 SAST
- MetaSync poll + `campaign-flag` — hourly
- `mrr-calc` — daily

**Inbound webhooks to register:**
- `dialog360-webhook` ← 360dialog (WhatsApp inbound) · `verify_jwt=false`
- `meta-webhook` ← Meta (IG DM + ad lead events) · `verify_jwt=false`
- **PayFast ITN** — **⚠️ STILL OPEN (P0).** No function currently receives the ITN. `onboarding` has `verify_jwt=true` making it unsuitable for raw PayFast webhooks. A new function with `verify_jwt=false` and HMAC-SHA1 signature verification is required — it writes `payments` and calls `onboarding`. The vault key (`_GLOBAL_PAYFAST_MERCHANT_KEY`) is also not yet written. **Resolve before launch** (Phase 7 gate depends on the ITN firing `onboarding`).
- `public-lead-capture` ← AA Public Site form POST · `verify_jwt=false`

---

## 6. Security, compliance & governance

The four structural protections (Principle 5 / §13):
1. **Surfaces hold no secrets and cannot reach the internet** — every external call/credential read is inside an edge function.
2. **Credentials vaulted, service-role-only** — read at call time, not persisted elsewhere.
3. **Isolation at the database** — RLS via 3 helpers + 4 roles; holds even if app code is wrong.
4. **Every mutation audited** — `audit-log` writes an immutable record to `audit_log` + `agent_events`.

**POPIA:** one controlled store, role-based access, logged access; client/contractor agreements (Adriaans) carry the data terms; annual compliance audit is SOP 22.
**Offboarding (SOP 16):** revoke the client's Vault credentials, remove portal/upload access, retain or delete data per their agreement. Centralised Vault → clean revocation.

---

## 7. The 7 end-to-end flows (backend sequences)

1. **Inbound IG DM → Triage** — Meta → `meta-webhook` → `messages`+`conversations` → OpenClaw (`aicos-act`) → `triage_items`+`agent_events` → Cockpit → Alex.
2. **MJR Generation → Send** — Alex → `mjr-generate` → Anthropic → `assets`+Storage(`mjrs`) → ⛔ → `dialog360-send` → 360dialog → `messages` → `audit_log`.
3. **Deposit → Active** — PayFast ITN → `payments` (external_ref) → `onboarding` → n8n → `automations`+`entities`(stage) → Active *(SOP 05/06; ITN handler still open — see §5)*.
4. **CPA Drift → Decision** — Meta → MetaSync(`meta-ad-ops`) → `ad_metrics` → `campaign-flag` → `triage_items` → Cockpit → Alex *(SOP 10)*.
5. **Client Proof Upload** — AA Upload → `proof-capture` (client JWT) → Storage(`proof-uploads`)+`proof_uploads`+`assets` → Studio → Alex.
6. **Client Portal View** — AA Client Portal → `client-portal-sync` → **[RLS: `auth_entity_ids()`]** → `ad_metrics`+`assets`+`campaigns` → client (own rows only).
7. **Weekly Client Review** — Alex → Cockpit → `pulse_metrics` → Claude → ⛔ → `dialog360-send` → 360dialog *(SOP 09/17)*.

---

## 8. Backend open items / gaps to build or decide

1. **PayFast ITN handler — STILL OPEN (P0, blocks revenue).** No function receives the PayFast ITN. `onboarding` has `verify_jwt=true` so it cannot accept raw PayFast webhooks. Two steps needed: (a) write `_GLOBAL_PAYFAST_MERCHANT_KEY` to `vault.secrets` (registered in `credential_registry` but absent from vault); (b) build a new `payfast-webhook` function with `verify_jwt=false`, HMAC-SHA1 signature verification, writes `payments`, and invokes `onboarding`. The deposit gate (`booked → onboarding`) has no backend until this lands.
2. **IG-DM outbound — STILL OPEN.** No Instagram send function exists (only `dialog360-send` for WhatsApp). The Conversations composer must block IG send until a function is defined.
3. **Agent control — STILL OPEN.** No edge function pauses/resumes agents; Operations toggles need a backing mechanism (n8n API controls / `automations.status` write).
4. **Recurring retainer billing — STILL OPEN.** No mechanism collects the monthly retainer `mrr-calc` reports (only the deposit gate exists). Revenue-critical; decide the mechanism (recurring PayFast subscription vs manual invoicing) before onboarding the first retainer client.
5. **Refund / cancellation (SOP 16) — STILL OPEN.** No function backs it. Surface as "manual / TBD" in Money.
6. **Backup / DR — STILL OPEN (unverifiable via SQL).** Single Supabase project. PITR status must be confirmed in the Supabase dashboard (Settings → Backups). No documented recovery runbook. Resolve before any paying client's data lands.
7. **Monitoring / alerting — STILL OPEN.** pg_cron failures log to `audit_log` but there is no external alerting path. The Operations workspace is the closest thing to monitoring; no "machine down" runbook exists.
8. **Naming confirmations — RESOLVED.** Project ref = `iwkhdqqgfjtpdhcbpftu` ✓; RLS helpers = `auth_role()`, `auth_entity_ids()`, `auth_team_id()` ✓; live function names = `dialog360-send`, `dialog360-webhook` ✓ (docs updated). Model strings confirmed from README: `gpt-5.4-mini` (OpenClaw), `claude-sonnet-4-6` (Claude Content), `claude-haiku-4-5-20251001` (lead-score ICP) ✓.
9. **Security advisor findings (audited 2026-06-21 — fix before real traffic):**
   - **Revoke anon EXECUTE** on `increment_ad_lead`, `trg_lead_score_before`, `trg_lead_score_after` — these are callable by unauthenticated users as SECURITY DEFINER (data integrity and privilege-escalation risk).
   - **Enable leaked-password protection** (HaveIBeenPwned check) in Supabase Auth settings — currently disabled.
   - **Fix double-SELECT paths** — `{table}_staff_write` policies use `ALL` (which includes SELECT), creating two permissive SELECT policy paths for every staff read. Change to `INSERT, UPDATE, DELETE` on all 13 affected tables.
   - **Fix RLS initplan re-evaluation** — `users_self_select`, `users_self_update`, `team_members_self_select` call bare `auth.uid()` (re-evaluated per row). Replace with `(SELECT auth.uid())` to allow the optimiser to lift it above the row scan.

---

*End of backend spec. Together with the system map and the frontend spec, this defines AA-OS end to end — surfaces, logic, and data, with every connection traced and every gap flagged. Introspect the live project, reconcile against these three files, and build against the verified reality.*
