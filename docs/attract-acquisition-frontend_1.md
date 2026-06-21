# Attract Acquisition — Cockpit Frontend Specification (v1.1)

**Part 2 of 3** of the Claude Code build context. Read alongside:
- `attract-acquisition-system-map.md` — the architecture & every connection (canonical)
- `attract-acquisition-backend.md` — the data layer, edge-function internals, RLS, schedules *(next file)*

This document covers **the AA Cockpit frontend only**: each page (workspace), what it does, how it is laid out, what it reads, what it triggers, and exactly which backend node every UI element connects to. Function internals, table columns, RLS policy SQL, and schedules live in the backend file — here we define the **contract from the frontend side**.

---

## 0. Read this first — the thin-surface contract

The cockpit is a **Vite + React + TypeScript + Tailwind** SPA and one of six AA surfaces. It obeys four non-negotiable rules:

1. **Reads come from Supabase directly** (`supabase.from(...)`, often via realtime). 
2. **Every side-effect or write goes through an edge function** (`supabase.functions.invoke(...)`). The cockpit is the steering wheel; edge functions are the engine.
3. **The frontend never calls an external API** (Meta, 360dialog, Apify, Anthropic, OpenAI, PayFast) and **never reads secret values from the Vault.** Those happen inside edge functions.
4. **Nothing client-facing fires without explicit human approval** (Principle 4) — replies, MJRs, content, campaign changes.

### Notation used throughout

| Mark | Meaning |
|---|---|
| ▶ **invoke** | The UI triggers this edge function via `supabase.functions.invoke(name, …)` |
| ◻ **surface** | The UI only *displays* this node's output; it runs on a cron, a DB trigger, a webhook, or from another surface — the cockpit never calls it |
| ⛔ **approval** | The action requires explicit human approval before it fires |
| ⟳ **realtime** | This data must be a Supabase realtime subscription, not a one-shot fetch |

---

## 1. Global app shell

These exist once and wrap every page.

### 1.1 Routing
| Route | Page | Notes |
|---|---|---|
| `/login` | Auth | Supabase email + password |
| `/` | Cockpit (home) | default after login |
| `/pipeline` | Pipeline | `?stage=` filter; entity drawer via `/pipeline/:entityId` |
| `/conversations` | Conversations | thread via `/conversations/:entityId` |
| `/campaigns` | Campaigns | `?client=` selector |
| `/studio` | Studio | sub-sections via `?tab=` (library / briefs / mjr / approvals) |
| `/operations` | Operations | |
| `/money` | Money | |

### 1.2 Auth & roles
- **Supabase Auth, email + password** (magic-link was abandoned — rate limits). `AuthProvider` exposes the session + the user's role from `team_members`.
- Cockpit roles: **`admin`**, **`distribution`**, **`delivery`**. The **`client`** role is *not* a cockpit user — it belongs to the Client Portal surface. Block `client` from the cockpit entirely.
- Every page and every destructive action is role-gated (matrix in §3).

### 1.3 Layout chrome
- **Left nav** — the 7 workspaces, role-filtered (a `distribution` user does not see Money/Operations).
- **Top bar** — current client/context, user menu, global search (entities + conversations).
- **Always-visible pipeline strip** — a thin global component showing live counts per the 8 stages (`entities` grouped by `stage`, ⟳). Clicking a segment deep-links to `/pipeline?stage=…`. This is the cockpit's persistent representation of the pipeline spine.
- **Notification / agent-trail bell** — recent `agent_events` (⟳).

### 1.4 Global providers & singletons
- `supabaseClient` initialised from env (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) — **never hardcode the project ref** (see open items).
- `RealtimeProvider` — owns channel subscriptions; pages subscribe through it.
- `RoleProvider` — gates UI.
- `<ApprovalModal>` — the shared human-in-the-loop confirm dialog (§1.5).
- `<Toast>` / error boundary.

### 1.5 The approval pattern (used on every outbound action)
Any ⛔ action opens `<ApprovalModal>` showing the exact payload (the message text, the MJR, the campaign change), an editable field where relevant, and **Approve / Edit / Cancel**. Only on Approve does the page call `supabase.functions.invoke(...)`. This single component enforces Principle 4 across triage replies, MJR sends, content approvals, and campaign launches.

### 1.6 Conventions
- **Loading**: skeletons per panel, never a full-page spinner.
- **Empty**: each list defines an empty state ("No triage items — the queue is clear").
- **Error**: edge-function failures surface a toast + inline retry; reads fall back gracefully.
- **Optimistic UI** is allowed for stage drags and approvals, reconciled against the realtime echo.
- **Design tokens**: bg `#0A0E0D`, teal `#00E5C3` (primary), amber `#FFB454` (telemetry/secondary). Fonts: Archivo Expanded (display), Archivo (body), JetBrains Mono (data/mono).

---

## 2. The 7 workspaces (pages)

Each page below lists: **Purpose → Layout & components → Reads → Actions (with edge-function mapping) → Cross-surface → Connections (per the map)**. The Connections block mirrors `attract-acquisition-system-map.md` exactly so the two files stay in lockstep.

---

### 2.1 Cockpit (home) — `/`

**Purpose.** The morning view: *what needs a human, right now.* Triage queue, in-flight automations, unified inbox preview, live pulse, agent trail. Reads almost everything from Supabase and writes almost nothing — it routes operators into the other pages.

**Layout & components**
- **Triage queue** (primary, ⟳) — list of `triage_items`, each showing the entity, channel (WhatsApp/IG), OpenClaw score (hot/warm/cold, 0–1) and the suggested draft. This is the heart of the page.
- **In-flight automations** (⟳) — running `automations` (n8n onboarding sequences, outreach cadences) with progress/state.
- **Unified inbox preview** (⟳) — latest threads from `conversations`/`messages`; "open" deep-links to Conversations.
- **Live pulse** — KPI tiles from `pulse_metrics` (lead count, reply rate, active campaigns, MRR snapshot).
- **Agent trail** (⟳) — recent `agent_events`: what the machines just did.

**Reads.** `triage_items` ⟳, `automations` ⟳, `conversations` ⟳, `messages` ⟳, `pulse_metrics`, `agent_events` ⟳, `audit_log`.

**Actions → edge functions**
- **Reply to a triaged conversation** ⛔ → ▶ `360dialog-send` (WhatsApp). *IG-DM outbound has no named function in the 16 — flag for backend (see §5).*
- **Re-score / fetch a fresh suggestion** → ▶ `aicos-act` (routes the message to OpenClaw, returns score + draft).
- **Generate MJR for this entity** ⛔ → ▶ `mjr-generate` (then continues in Studio).
- **Advance the entity's stage** → direct write to `entities.stage` (RLS-guarded; `audit-log` fires via DB trigger ◻). The `booked → onboarding` move is **deposit-gated — block it manually** (show "awaiting deposit").
- ◻ `mrr-calc`, ◻ `campaign-flag` — cron; their output feeds the pulse tiles and the triage queue (drift cards). Never invoked here.

**Cross-surface.** None directly; it aggregates state produced elsewhere.

**Connections (per the map).** Stages: all 8 · Edge: aicos-act ▶, audit-log ◻, mrr-calc ◻, campaign-flag ◻ · Agents: OpenClaw, MetaSync, n8n, Apify Scraper, Claude Content (all ◻, trail only) · Playbooks: — · Tables: triage_items, agent_events, pulse_metrics, audit_log, automations, conversations, messages · Storage: — · Secrets: — · External: — · Surfaces: AA Cockpit.

---

### 2.2 Pipeline — `/pipeline`

**Purpose.** The 8-stage board — every entity in its stage, drag to advance. The pipeline spine made visible. Every system keys off `entities.stage`, so this page is where the controlled vocabulary is operated.

**Layout & components**
- **8-column kanban** (⟳): `source · cold · contacted · engaged · booked · onboarding · active · delivering`. Columns 1–5 grouped visually as *acquisition*, 6–8 as *delivery*, split at the deposit.
- **Entity card** — name, niche, ICP score, owner, last activity, channel badges, triage flag.
- **Filters** — niche, ICP score band, owner, stage.
- **Entity detail drawer** (`/pipeline/:entityId`) — full `entities` record, linked conversation, MJRs/assets, and the stage-transition history from `audit_log`.

**Reads.** `entities` ⟳, `triage_items` (badges), `audit_log` (drawer history).

**Actions → edge functions**
- **Drag card to next stage** → direct write to `entities.stage` (`audit-log` ◻ fires). Guard `booked → onboarding` (deposit-gated); guard against skipping stages.
- **Run onboarding** (for a booked + paid entity, if exposed) ⛔ → ▶ `onboarding` — *normally auto-fired by the PayFast deposit (◻); a manual trigger is a fallback only.*
- New `source` cards **appear automatically** from the daily scrape (◻ `apify-scrape`) and from the public site lead magnet (◻ `public-lead-capture`); new entities are scored on insert (◻ `lead-score`, trigger).

**Cross-surface.** **AA Public Site** feeds the top of this board via `public-lead-capture`.

**Connections (per the map).** Stages: all 8 · Edge: lead-score ◻, apify-scrape ◻, public-lead-capture ◻, onboarding ▶/auto, audit-log ◻ · Agents: Apify Scraper, OpenClaw (◻) · Playbooks: — · Tables: entities, triage_items, audit_log · Storage: — · Secrets: — · External: Apify (◻) · Surfaces: AA Cockpit, AA Public Site.

---

### 2.3 Conversations — `/conversations`

**Purpose.** The unified inbox across WhatsApp (360dialog) and Instagram DM (Meta), threaded per entity. Unified because every message converges on the same `messages` + `conversations` tables.

**Layout & components**
- **Thread list** (left, ⟳) — conversations across both channels, channel badge, unread, triage score.
- **Message thread** (center, ⟳) — full history for the selected entity.
- **Entity context** (right) — pipeline stage, ICP score, quick actions (book call, generate MJR, advance stage).
- **Composer** — free text + **OpenClaw suggested reply** prefilled, editable. The **Closer playbook** is surfaced here as reference framing for replies.

**Reads.** `conversations` ⟳, `messages` ⟳, `entities`, `triage_items`.

**Actions → edge functions**
- **Send WhatsApp message** ⛔ → ▶ `360dialog-send` (the function reads the client's number config from the Vault — backend; the frontend just calls it).
- **Get / refresh AI suggestion** → ▶ `aicos-act` (OpenClaw).
- **Inbound messages** arrive via ◻ `360dialog-webhook` (WhatsApp) and ◻ `meta-webhook` (IG) and stream in ⟳.
- *IG-DM outbound: no named send function exists in the 16 — flag for backend (§5).*

**Cross-surface.** None (channels reach in via webhooks).

**Connections (per the map).** Stages: Contacted, Engaged, Delivering · Edge: 360dialog-send ▶, 360dialog-webhook ◻, meta-webhook ◻, aicos-act ▶, audit-log ◻ · Agents: OpenClaw, MetaSync (◻) · Playbooks: Closer (reference) · Tables: conversations, messages, entities, triage_items · Storage: — · Secrets: Vault (backend-read) · External: 360dialog, Meta · Surfaces: AA Cockpit.

---

### 2.4 Campaigns — `/campaigns`

**Purpose.** Meta campaign performance per client, and the metrics that drive the CPA-drift watch (SOP 10). MetaSync polls hourly; `campaign-flag` raises a decision card on ~35% CPA drift.

**Layout & components**
- **Client selector** + **campaign list** with status.
- **Performance** — spend / CTR / CPA charts and sparklines from `ad_metrics`.
- **Drift alerts** — decision cards raised by `campaign-flag` (surfaced from `triage_items`): *pause / reallocate / let it ride.*
- **Campaign controls** — launch / pause / edit.

**Reads.** `campaigns`, `ad_metrics` (sparklines), `triage_items` (drift cards), `pulse_metrics`, `automations`.

**Actions → edge functions**
- **Launch / pause / edit a campaign** ⛔ → ▶ `meta-ad-ops` (reads the client's Meta token from the Vault — backend).
- **Resolve a CPA-drift card** → *pause* invokes ▶ `meta-ad-ops`; *reallocate* opens the edit flow; *let-it-ride* dismisses the `triage_item`.
- ◻ `campaign-flag` (cron) raises the cards; ◻ MetaSync (hourly) refreshes `ad_metrics`.

**Cross-surface.** None.

**Connections (per the map).** Stages: Active, Delivering · Edge: meta-ad-ops ▶, meta-webhook ◻, campaign-flag ◻, audit-log ◻ · Agents: MetaSync (◻) · Playbooks: Ads (reference) · Tables: campaigns, ad_metrics, triage_items, pulse_metrics, automations · Storage: — · Secrets: Vault (backend-read) · External: Meta · Surfaces: AA Cockpit.

---

### 2.5 Studio — `/studio`

**Purpose.** The asset & brief library: AI brief generation, MJR generation, the editor handoff, and the approval gate. Briefs go out, finished reels come back, **approvals happen here before anything reaches Meta**. Enforces the asset-naming convention (SOP 13).

**Layout & components** (sub-tabs via `?tab=`)
- **Library** — `assets` grid with previews of **Storage** buckets (MJRs / Reels / Proof Uploads) via signed URLs.
- **Briefs** — `briefs` list + the **brief generator** form.
- **MJR generator** — request an MJR for an entity.
- **Approval queue** — content (reels) awaiting approve/reject (SOP 08).
- **Editor handoff** — brief → editor, finished reel back.

**Reads.** `briefs`, `assets`, `proof_uploads`, `pulse_metrics`, + Storage (MJRs, Reels, Proof) via signed URLs.

**Actions → edge functions**
- **Generate MJR** ⛔ → ▶ `mjr-generate` (Claude writes copy; PDF lands in Storage + `assets`).
- **Generate brief** → ▶ `brief-generator` (from the client's brand context).
- **Approve / reject content** ⛔ → direct write to the asset's status (`audit-log` ◻); decision feeds the editor queue and the Client Portal.
- **Send an MJR** ⛔ → ▶ `360dialog-send` (often done from Conversations/Booked instead).
- **Field proof** appears via ◻ `proof-capture` (pushed from **AA Upload**).
- **Asset-name validation** on the frontend (SOP 13 pattern).

**Cross-surface.** **AA Upload** feeds proof in (◻ `proof-capture`); **AA Studio** is itself a surface hosted inside the cockpit; approvals flow out to the **Client Portal**.

**Connections (per the map).** Stages: Booked, Active, Delivering · Edge: brief-generator ▶, mjr-generate ▶, proof-capture ◻, audit-log ◻ · Agents: Claude Content, OpenClaw (▶/◻) · Playbooks: Ads, Proof, Story (references) · Tables: briefs, assets, proof_uploads, pulse_metrics · Storage: MJRs, Reels, Proof Uploads · Secrets: Vault (backend-read) · External: Anthropic, Cloudflare R2 · Surfaces: AA Studio, AA Cockpit, AA Upload.

---

### 2.6 Operations — `/operations`

**Purpose.** The agent & automation control panel: what is running, what is paused, the agent event history. n8n runs 15–20 concurrent sprints with retries and a dead-letter path; every mutation is audited. This is the most sensitive page — **admin-gated**.

**Layout & components**
- **Agent status cards** — the 5 agents (Apify Scraper, OpenClaw, n8n, MetaSync, Claude Content): running/paused, last run, next run, error count.
- **Automation runs** (⟳) — `automations`: in-flight, succeeded, **failed / dead-letter**.
- **Agent event log** (⟳) — `agent_events`.
- **Audit viewer** — `audit_log` (read-only, searchable).
- **Telegram control** — link/embed to the **Telegram Control** surface (founder-only OpenClaw commands).
- **Security panel** — shows *which* Vault keys exist (presence only) and RLS status. **Never renders secret values.**

**Reads.** `automations` ⟳, `agent_events` ⟳, `audit_log`, `triage_items`.

**Actions → edge functions**
- **Pause / resume an agent or automation** → writes agent/`automations` state. *No named edge function controls agents in the 16 — backend to define the control surface (§5).*
- **Retry a failed run** → re-invoke the relevant function / n8n retry.
- **Send OpenClaw a command** → ▶ `aicos-act`.
- ◻ `apify-scrape`, ◻ `campaign-flag`, ◻ `onboarding`, ◻ `audit-log` — surfaced/controlled, not invoked from forms here.

**Cross-surface.** **Telegram Control** (OpenClaw) is the founder's phone-side companion to this page.

**Connections (per the map).** Stages: all 8 · Edge: apify-scrape ◻, aicos-act ▶, campaign-flag ◻, onboarding ◻, audit-log ◻ · Agents: all 5 · Playbooks: — · Tables: automations, agent_events, audit_log, triage_items · Storage: — · Secrets: Vault (presence only), Row-Level Security (status) · External: Apify, OpenAI, Telegram, Meta (health/surface) · Surfaces: AA Cockpit, Telegram Control.

---

### 2.7 Money — `/money`

**Purpose.** MRR, revenue by client, the commercial picture. PayFast deposit is the gate; `mrr-calc` rolls up active-client MRR daily into `mrr_snapshots`. Primarily reporting — **admin-gated**.

**Layout & components**
- **MRR headline + trend** — from `mrr_snapshots`.
- **Revenue by client** — `payments` + `contracts`.
- **Payment / deposit feed** (⟳) — `payments`; a cleared deposit visibly flips a client into Onboarding.
- **MRR sparkline** — `pulse_metrics`.

**Reads.** `payments` ⟳, `mrr_snapshots`, `contracts`, `pulse_metrics`.

**Actions → edge functions**
- **Deposit gate** — PayFast ITN → ◻ `onboarding` (auto). Money *shows* the deposit landing and the stage flip; it does not trigger it.
- ◻ `mrr-calc` (cron) populates `mrr_snapshots`.
- **Refund / cancellation** (SOP 16) → *no named function in the 16 — backend to define (§5).*
- ⚠️ **Recurring retainer billing has no mechanism** — Money will display MRR that nothing is actually collecting. This is the #2 open item; surface it, don't fake it.

**Cross-surface.** None (PayFast reaches in via its ITN webhook → `onboarding`).

**Connections (per the map).** Stages: Booked, Onboarding, Active, Delivering · Edge: mrr-calc ◻, onboarding ◻, audit-log ◻ · Agents: — · Playbooks: — · Tables: payments, mrr_snapshots, contracts, pulse_metrics · Storage: — · Secrets: — · External: PayFast · Surfaces: AA Cockpit.

---

## 3. Role × workspace access matrix

`admin` = Alex / ops leadership · `distribution` = outreach VA · `delivery` = editor / delivery staff · `client` = **portal only, never the cockpit**.

| Workspace | admin | distribution | delivery |
|---|---|---|---|
| Cockpit (home) | full | triage / inbox / pulse | read-only summary |
| Pipeline | full | full (CRM hygiene) | assigned clients (read) |
| Conversations | full | full | — |
| Campaigns | full | — | view (assigned) |
| Studio | full | — | full (assigned clients) |
| Operations | full | — | — |
| Money | full | — | — |

Destructive/outbound actions (send, launch, approve, advance) are additionally gated: `distribution` may send outreach (SOP 01) and run cadences; `delivery` may produce and approve content; only `admin` touches Campaigns controls, Operations, and Money.

---

## 4. Edge-function call reference (frontend perspective)

**Invoked by the cockpit UI** (`supabase.functions.invoke`):

| Function | Invoked from | User action | Approval |
|---|---|---|---|
| `aicos-act` | Cockpit, Conversations, Operations | get OpenClaw score/suggestion; send a command | — |
| `360dialog-send` | Conversations, Cockpit, Studio | send a WhatsApp reply / MJR / review note | ⛔ |
| `mjr-generate` | Studio, Cockpit | generate a Missed Jobs Report | ⛔ |
| `brief-generator` | Studio | generate a reel/content brief | — |
| `meta-ad-ops` | Campaigns | launch / pause / edit a campaign | ⛔ |
| `onboarding` | Pipeline, Money (fallback) | manual onboarding kick (normally auto) | ⛔ |

**Only surfaced (never invoked from the cockpit)** — background nodes whose output the UI displays:
`apify-scrape` (cron) · `lead-score` (insert trigger) · `campaign-flag` (cron) · `mrr-calc` (cron) · `audit-log` (mutation trigger) · `360dialog-webhook` / `meta-webhook` (inbound) · `proof-capture` (from AA Upload) · `client-portal-sync` (from Client Portal) · `public-lead-capture` (from Public Site).

**Realtime subscriptions the cockpit must hold:** `triage_items`, `conversations`, `messages`, `automations`, `agent_events`, `entities` (Pipeline + strip), `ad_metrics` (Campaigns), `payments` (Money).

---

## 5. Frontend-relevant open items / gaps to flag (do not paper over)

1. **IG-DM outbound has no edge function.** WhatsApp replies use `360dialog-send`; the 16 functions contain no Instagram send path. The Conversations composer needs one — **block IG send and flag** until backend defines it.
2. **Agent pause/resume has no edge function.** Operations controls map to `automations`/agent state with no named function — confirm the control mechanism in the backend file before wiring toggles.
3. **Refund / cancellation (SOP 16) has no function.** Money's refund action is unbacked — surface as "manual / TBD".
4. **Recurring retainer billing does not exist.** Money shows MRR with no collection mechanism. Display it; do not invent billing UI without sign-off.
5. **Supabase project ref unconfirmed** (`ayfid…` vs `iwkhd…`). The client reads from env; never hardcode.
6. **Stage transitions are direct `entities` writes** (no transition function). Enforce the legal stage order and the deposit gate on the frontend; rely on RLS for safety, not on the UI alone.

---

*End of frontend spec. The backend file will define, for each of these connection points, the function internals, the table schemas they read/write, the external calls they make, the Vault reads, the RLS policies, and the schedules — closing the loop on every mapping referenced above.*
