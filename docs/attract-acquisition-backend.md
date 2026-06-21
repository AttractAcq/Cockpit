# Attract Acquisition — Backend Specification (v1.1)

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
- **Project ref:** ⚠️ unconfirmed — docs say `ayfidvycgqorxmlczyxl`; prior live work used `iwkhdqqgfjtpdhcbpftu`. **Confirm before any migration.** All code reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (frontend) and the service-role key (functions) from env — never hardcode.
- One project = the single source of truth. No surface keeps a private copy of client state.

### 1.2 The 18 tables (expected shape — verify against live)

`entities` is the spine: **prospects and clients are the same table**, distinguished only by `stage`. A client is an entity that reached `onboarding`. Nothing is ever migrated as it advances.

**Core**
- `entities` — id (uuid pk), name, industry/niche, location, phone, ig_handle, source, channel, **icp_score** (numeric), **stage** (enum, §1.3), owner_id → team_members, client_slug, metadata (jsonb), created_at, updated_at
- `conversations` — id, entity_id → entities, channel (`whatsapp`|`instagram`), last_message_at, unread (bool), status, created_at
- `messages` — id, conversation_id → conversations, entity_id, direction (`in`|`out`), channel, body, sender, status, external_id, created_at

**Commerce**
- `campaigns` — id, entity_id → entities (client), meta_campaign_id, name, objective, status, budget, created_at, updated_at
- `ad_metrics` — id, campaign_id → campaigns, captured_at, spend, impressions, clicks, ctr, cpa, leads
- `payments` — id, entity_id → entities, payfast_ref, amount, type (`deposit`|`retainer`), status, paid_at, created_at
- `contracts` — id, entity_id → entities, tier (`proof_sprint`|`proof_brand`|`authority_brand`), mrr_amount, start_date, end_date, status, doc_url, created_at

**Operations**
- `triage_items` — id, entity_id → entities, type (`reply`|`decision`), score (0–1), priority, suggested_action, suggested_reply, source (`openclaw`|`campaign_flag`), status (`open`|`resolved`), created_at
- `agent_events` — id, agent (`apify`|`openclaw`|`n8n`|`metasync`|`claude`), action, entity_id (nullable), payload (jsonb), status, created_at
- `automations` — id, type (`onboarding`|`cadence`|…), entity_id → entities, workflow_id (n8n), state (`running`|`done`|`failed`|`dead_letter`), step, retries, started_at, updated_at

**Content**
- `assets` — id, entity_id → entities, type (`mjr`|`reel`|`image`|`proof`), storage_path, name (SOP 13 convention), status (`draft`|`awaiting_approval`|`approved`|`rejected`|`shipped`), created_by, created_at
- `briefs` — id, entity_id → entities, archetype, hook, storyboard, caption, asset_id (nullable), status, created_by, created_at
- `proof_uploads` — id, entity_id → entities, storage_path, job_tag, metadata (jsonb), captured_by (client), captured_at

**Metrics**
- `pulse_metrics` — id, scope (`global`|`client`), entity_id (nullable), metric, value, period, captured_at
- `mrr_snapshots` — id, date, total_mrr, active_clients, breakdown (jsonb), created_at

**Auth**
- `users` — mirrors `auth.users` (id = auth uid, email, created_at)
- `team_members` — id, user_id → auth, role (`admin`|`distribution`|`delivery`|`client`), entity_id (nullable — set for `client` role), display_name, rate, status, created_at
- `audit_log` — id, actor (`user`|`agent`|`system`), actor_id, action, table_name, record_id, before (jsonb), after (jsonb), created_at

### 1.3 Pipeline stage enum (controlled vocabulary on `entities.stage`)

`source · cold · contacted · engaged · booked · onboarding · active · delivering`

Stage is a contract — moving an entity changes which agents act and which automations fire. Transitions:

| Transition | Caused by | Gate |
|---|---|---|
| source → cold | `lead-score` passes ICP ≥ ~65 | automatic |
| cold → contacted | VA starts SOP 01 (`360dialog-send`) | human |
| contacted → engaged | inbound reply via webhook | automatic on reply |
| engaged → booked | Alex books the call | human |
| **booked → onboarding** | **PayFast deposit cleared** | **deposit gate — money must clear** |
| onboarding → active | `onboarding` checklist completes | automatic on completion |
| active → delivering | steady-state reached | human/automatic |

The deposit gate is the only hard, money-backed transition. The frontend must not allow it manually.

### 1.4 Storage (3 buckets)
Per-client buckets, served via **signed URLs** (time-limited, scoped — never public):
- `mjrs` — generated Missed Jobs Report PDFs (written by `mjr-generate`)
- `reels` — finished vertical reels
- `proof` — before/after field captures (written by `proof-capture`)

Files are referenced from `assets` / `proof_uploads`; the tables hold the path, Storage holds the bytes.

### 1.5 Vault (credential store)
- Naming convention: **`{CLIENT_SLUG}_{SERVICE}_{CREDENTIAL_TYPE}`**; **readable only by the service role** that edge functions run as. Read at call time, discarded after.
- **Per-client** credentials: Meta system-user token, 360dialog number config. (A leak here = acting on the wrong client's account — isolation is deliberate and absolute.)
- **Platform-level** credentials (AA's own): Anthropic, OpenAI, Apify, Telegram, Cloudflare R2 keys (use a reserved slug, e.g. `AA_…`).
- Functions that read the Vault: `360dialog-send`, `meta-ad-ops`, `mjr-generate`, `brief-generator`, `aicos-act`, `apify-scrape`. **No surface ever reads it.** Setting up a new client's Vault entries is SOP 14.

### 1.6 Row-Level Security (the isolation keystone)
- Enforced by the database, not app code. Four roles: **`admin`** (all clients), **`distribution`** (prospect/conversation data for outreach), **`delivery`** (content/briefs/assets for assigned clients), **`client`** (only their own rows).
- Three helper functions referenced by every policy: **`auth_role()`**, **`auth_entity_ids()`**, **`auth_team_id()`**.
  > ⚠️ Naming check: the live project may use `get_my_role()` / `get_my_client_id()` / `get_my_metadata_id()`. **Confirm the actual function names before writing policies.**
- Policy pattern by table group:

| Table group | Scoped by | Rule |
|---|---|---|
| entities, conversations, messages, campaigns, ad_metrics, payments, contracts, assets, briefs, proof_uploads, triage_items, automations | `auth_entity_ids()` | a `client` sees only their entity's rows; staff see per role/assignment |
| pulse_metrics | `auth_entity_ids()` (client scope) / `auth_role()` (global) | clients see only their slice |
| agent_events, audit_log, mrr_snapshots | `auth_role()` | admin/internal only |
| users, team_members | `auth_role()` | admin only |

The guarantee (Principle 5): a client opening the portal **physically cannot** retrieve another client's rows — the database refuses rows that fail `auth_entity_ids()`, regardless of what the request asks for. **Test this explicitly** with two client users (Phase 1 gate / Phase 6 security review).

---

## 2. The 16 edge functions

Notation: **invoker** = who calls it (▶ from the cockpit UI, or auto). Every mutating function also writes via `audit-log`.

### Ingestion & intelligence

**`apify-scrape`** — *CRON, daily 03:00 SAST*
Orchestrates the Google Maps scrape over Cape Town clusters, applies the owner-operator filter, **dedupes against `entities`**, enriches, and writes genuinely new prospects at `source`.
Reads: Apify (Vault key). Writes: `entities`, `agent_events`. Invoker: cron (Apify Scraper agent). Surfaced in: Pipeline, Operations.

**`lead-score`** — *TRIGGER, on `entities` insert/update*
Assigns an ICP fit score (industry, location, lead-absorption signals). ≥ ~65 → `cold` queue; below → parked. The gate that protects founder time.
Reads/Writes: `entities`. Invoker: DB trigger.

**`aicos-act`** — *INVOKE*
The bridge to OpenClaw. Routes a message/command to OpenClaw, returns a hot/warm/cold score (0–1) + suggested reply/draft, and creates triage items.
Reads: OpenAI, Telegram (Vault). Writes: `triage_items`, `agent_events`. Invoker: ▶ Cockpit, Conversations, Operations.

### Messaging

**`360dialog-send`** — *INVOKE*
Sends WhatsApp messages (template + freeform), rate-limited, reading the client's number config from the Vault.
Reads: 360dialog, Vault. Writes: `messages`. Invoker: ▶ Conversations / Cockpit / Studio (⛔ human-approved).

**`360dialog-webhook`** — *WEBHOOK*
Receives inbound WhatsApp; threads into a `conversation` tied to the entity; can advance `contacted → engaged`.
Reads: 360dialog. Writes: `messages`, `conversations`. Invoker: 360dialog inbound.

**`meta-webhook`** — *WEBHOOK*
Receives Instagram DMs and ad-lead events.
Reads: Meta. Writes: `messages`, `ad_metrics`. Invoker: Meta inbound.

### Ad operations

**`meta-ad-ops`** — *INVOKE*
Creates / pauses / edits campaigns and reads insights, using the client's Meta token from the Vault at call time.
Reads: Meta, Vault. Writes: `campaigns`. Invoker: ▶ Campaigns (⛔). Also called by MetaSync to pull insights.

**`campaign-flag`** — *CRON*
Compares trailing 48-hour CPA against the 7-day baseline; a ~35% jump raises a decision card under SOP 10.
Reads: `ad_metrics`. Writes: `triage_items`. Invoker: cron (paired with MetaSync). Surfaced in: Campaigns, Cockpit.

### Content & proof

**`mjr-generate`** — *INVOKE*
Assembles the competitor/market picture, calls Claude for the narrative copy, renders the PDF to Storage, records it in `assets`.
Reads: Anthropic, Vault. Writes: `assets`, Storage (`mjrs`). Invoker: ▶ Studio / Cockpit (⛔ to send).

**`brief-generator`** — *INVOKE*
Generates reel/content briefs from the client's brand context (AA voice constrained).
Reads: Anthropic, Vault. Writes: `briefs`. Invoker: ▶ Studio.

**`proof-capture`** — *INVOKE*
Ingests AA Upload captures (authenticated by the client's JWT), uploads to Storage, extracts metadata, writes records.
Writes: `proof_uploads`, `assets`, Storage (`proof`). Invoker: **AA Upload** (not the cockpit). Surfaced in: Studio.

### Client, finance & audit

**`client-portal-sync`** — *INVOKE*
Aggregates client-scoped metrics *behind the RLS boundary* and returns a client-scoped view (the portal dashboard).
Reads: `ad_metrics`, `assets`, `campaigns` (RLS-scoped). Invoker: **AA Client Portal** (not the cockpit).

**`onboarding`** — *INVOKE (fired by the cleared deposit)*
Runs the day 1–7 checklist: hands the sequence to n8n, walks Meta access handoff (SOP 06), brand-asset collection, and Vault setup (SOP 14); advances `booked → onboarding → active`.
Reads: n8n. Writes: `entities` (stage), `automations`. Invoker: deposit (PayFast ITN) → see §5 gap. Surfaced in: Pipeline, Money, Operations.

**`mrr-calc`** — *CRON, daily*
Rolls up active-client MRR.
Writes: `mrr_snapshots`, `pulse_metrics`. Invoker: cron. Surfaced in: Money, Cockpit.

**`audit-log`** — *TRIGGER, called by every mutating function*
Writes the immutable, tamper-evident record.
Writes: `audit_log`, `agent_events`. Invoker: every mutation.

### Lead capture (the 16th — beyond the docs' 15)

**`public-lead-capture`** — *WEBHOOK / INVOKE (public POST from the site)*
Receives the MJR lead-magnet form submission from **AA Public Site** and writes a new prospect into `entities` at `source` (then `lead-score` fires). **This is the documented gap the map fixes** — without it the public site has no path into the pipeline.
Writes: `entities`. Invoker: AA Public Site form. Surfaced in: Pipeline.

---

## 3. The 5 agents

Guardrails (all agents): **propose, humans dispose** on anything client-facing; **every action logged** to `agent_events` via `audit-log`; **brand-constrained** content generation.

| Agent | Runtime | Cadence / trigger | Role | Calls / writes |
|---|---|---|---|---|
| **Apify Scraper** | Apify · Maps | daily 03:00 SAST | top-of-funnel sourcing, dedupe | `apify-scrape` → `entities` |
| **OpenClaw (AICOS)** | GPT-4.1 mini + Telegram | event-driven (on inbound) | scores replies (0–1), drafts MJRs/replies, creates triage items | `aicos-act` → `triage_items`, `agent_events` |
| **n8n Orchestrator** | Docker self-host | cron + event; 15–20 concurrent | multi-step workflows: onboarding, cadences; retries + dead-letter | `onboarding`, `automations` |
| **MetaSync** | Meta Graph API | hourly | polls spend/CTR/CPA, flags drift | `meta-ad-ops` (read) → `ad_metrics`; pairs with `campaign-flag` |
| **Claude Content** | Claude Sonnet | on request | drafts briefs, MJR copy, client comms (AA voice) | `brief-generator`, `mjr-generate` |

---

## 4. External services (9) — auth & touchpoints

| Service | Auth model | Credential home | Touched by functions |
|---|---|---|---|
| **Meta** Graph API | system-user token | Vault (per client) | `meta-ad-ops`, `meta-webhook` |
| **360dialog** | BSP key per number | Vault (per number) | `360dialog-send`, `360dialog-webhook` |
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
- `360dialog-webhook` ← 360dialog (WhatsApp inbound)
- `meta-webhook` ← Meta (IG DM + ad lead events)
- **PayFast ITN** → writes `payments` and fires `onboarding` — **⚠️ no named function in the 16 receives the ITN.** Either `onboarding` doubles as the ITN endpoint or a `payfast-webhook` is missing. **Resolve before launch** (Phase 7 gate depends on the ITN firing onboarding).
- `public-lead-capture` ← AA Public Site form POST

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
2. **MJR Generation → Send** — Alex → `mjr-generate` → Anthropic → `assets`+Storage(`mjrs`) → ⛔ → `360dialog-send` → 360dialog → `messages` → `audit_log`.
3. **Deposit → Active** — PayFast ITN → `payments` → `onboarding` → n8n → `automations`+`entities`(stage) → Active *(SOP 05/06; ITN handler — see §5)*.
4. **CPA Drift → Decision** — Meta → MetaSync(`meta-ad-ops`) → `ad_metrics` → `campaign-flag` → `triage_items` → Cockpit → Alex *(SOP 10)*.
5. **Client Proof Upload** — AA Upload → `proof-capture` (client JWT) → Storage(`proof`)+`proof_uploads`+`assets` → Studio → Alex.
6. **Client Portal View** — AA Client Portal → `client-portal-sync` → **[RLS: `auth_entity_ids()`]** → `ad_metrics`+`assets`+`campaigns` → client (own rows only).
7. **Weekly Client Review** — Alex → Cockpit → `pulse_metrics` → Claude → ⛔ → `360dialog-send` → 360dialog *(SOP 09/17)*.

---

## 8. Backend open items / gaps to build or decide

1. **PayFast ITN handler** — no named function receives the ITN to write `payments` / fire `onboarding`. Define it (the deposit gate depends on it).
2. **IG-DM outbound** — no Instagram send function exists (only `360dialog-send` for WhatsApp). The Conversations composer needs one.
3. **Agent control** — no edge function pauses/resumes agents; Operations toggles need a backing mechanism (n8n controls / `automations` state).
4. **Recurring retainer billing** — no mechanism collects the monthly retainer `mrr-calc` reports (only the deposit gate exists). Revenue-critical; decide the mechanism (recurring PayFast vs invoicing).
5. **Refund / cancellation (SOP 16)** — no function backs it.
6. **Backup / DR** — single Supabase project, no documented backup/PITR. Add before real client data lands.
7. **Monitoring / alerting** — no proactive agent/function failure alerting or "machine down" runbook beyond audit + n8n dead-letter.
8. **Naming confirmations** — Supabase project ref (`ayfid…` vs `iwkhd…`); RLS helper names (`auth_*()` vs `get_my_*()`); model string (`claude-sonnet-4-6`). Confirm against the live project before generating any migration or policy.

---

*End of backend spec. Together with the system map and the frontend spec, this defines AA-OS end to end — surfaces, logic, and data, with every connection traced and every gap flagged. Introspect the live project, reconcile against these three files, and build against the verified reality.*
