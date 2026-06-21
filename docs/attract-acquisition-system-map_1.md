# Attract Acquisition — System Connectivity Map (v1.1, text form)

This is the text twin of the interactive AA-OS connectivity map (`attract-acquisition-system-map.html`), reconciled to the Operating System Reference Manual and Launch Build Plan (v1.0). It exists to be read as context by Claude Code: every node and every connection in the map is written out below. Where this conflicts with anything else, treat the Reference Manual as canonical and flag the conflict.

## The loop (mental model)

```
Workspace → Stage → Supabase → Edge fn / Agent → External service → Supabase → Cockpit
```

People and agents operate **surfaces**; surfaces invoke **edge functions**; edge functions read and write the **single Supabase database** and call **external services**; everything a client moves through is the **8-stage pipeline spine**. Results flow back up to the Cockpit as telemetry.

Load-bearing rules:
- Surfaces are thin — they render data and capture intent. They never call external APIs and never hold secrets.
- Reads come from Supabase (often realtime); writes/side-effects go through edge functions.
- Multi-tenant isolation is enforced by RLS at the database, not in app code.
- Auth: Supabase email + password. Roles: `admin`, `distribution`, `delivery`, `client`.

---

## Node inventory (5 bands)

**01 · Control — Cockpit (7 workspaces):** Cockpit, Pipeline, Conversations, Campaigns, Studio, Operations, Money

**02 · Customer Journey — Pipeline Spine (8 stages):** Source → Cold → Contacted → Engaged → Booked → Onboarding → Active → Delivering
Enum on `entities`: `source · cold · contacted · engaged · booked · onboarding · active · delivering`. Stages 1–5 = acquisition, 6–8 = delivery; the split is the deposit (`booked → onboarding`).

**03 · Single Source of Truth — Supabase:**
- *18 tables* — entities, conversations, messages, campaigns, ad_metrics, payments, contracts, triage_items, agent_events, automations, assets, briefs, proof_uploads, pulse_metrics, mrr_snapshots, users, team_members, audit_log
- *3 storage buckets* (per-client, signed URLs) — MJRs, Reels, Proof Uploads
- *Secrets & rules* — Vault (`{CLIENT_SLUG}_{SERVICE}_{CREDENTIAL_TYPE}`, service-role only), Row-Level Security

**04 · Logic Layer:**
- *16 edge functions* — apify-scrape, lead-score, aicos-act, mjr-generate, brief-generator, 360dialog-send, 360dialog-webhook, meta-webhook, meta-ad-ops, campaign-flag, proof-capture, client-portal-sync, onboarding, mrr-calc, audit-log, public-lead-capture
- *5 agents* — Apify Scraper, OpenClaw (AICOS), n8n Orchestrator, MetaSync, Claude Content
- *4 content playbooks* — Ads, Proof, Story, Closer

**05 · Surfaces & External Services:**
- *6 surfaces* — AA Public Site, AA Cockpit, AA Studio, AA Upload, AA Client Portal, Telegram Control
- *9 external services* — Meta, 360dialog, Apify, Anthropic, OpenAI, PayFast, Google Workspace, Cloudflare R2, Telegram

**Tables by domain:** Core (entities, conversations, messages) · Commerce (campaigns, ad_metrics, payments, contracts) · Operations (triage_items, agent_events, automations) · Content (assets, briefs, proof_uploads) · Metrics (pulse_metrics, mrr_snapshots) · Auth (users, team_members, audit_log).

---

## Workspaces → connections (forward)

### Cockpit
*The morning view — triage queue, in-flight automations, unified inbox, live pulse and agent trail. What needs a human, right now.* Reads almost everything from Supabase and writes almost nothing; every action invokes an edge function.
- **Stages:** all 8
- **Edge functions:** aicos-act, audit-log, mrr-calc, campaign-flag
- **Agents:** OpenClaw, MetaSync, n8n, Apify Scraper, Claude Content
- **Playbooks:** —
- **Tables:** triage_items, agent_events, pulse_metrics, audit_log, automations, conversations, messages
- **Storage:** — · **Secrets & rules:** — · **External:** —
- **Surfaces:** AA Cockpit

### Pipeline
*The eight-stage board — every entity in its stage, drag to advance.* Every system keys off the stage field; moving an entity changes which agents act and which automations fire.
- **Stages:** all 8
- **Edge functions:** lead-score, apify-scrape, public-lead-capture, onboarding, audit-log
- **Agents:** Apify Scraper, OpenClaw
- **Playbooks:** —
- **Tables:** entities, triage_items, audit_log
- **Storage:** — · **Secrets & rules:** — · **External:** Apify
- **Surfaces:** AA Cockpit, AA Public Site

### Conversations
*The unified inbox across WhatsApp and Instagram DM, threaded per entity.* Unified because every message converges on the same messages and conversations tables.
- **Stages:** Contacted, Engaged, Delivering
- **Edge functions:** 360dialog-send, 360dialog-webhook, meta-webhook, aicos-act, audit-log
- **Agents:** OpenClaw, MetaSync
- **Playbooks:** Closer
- **Tables:** conversations, messages, entities, triage_items
- **Storage:** — · **Secrets & rules:** Vault · **External:** 360dialog, Meta
- **Surfaces:** AA Cockpit

### Campaigns
*Meta campaign performance per client, with the metrics that drive the CPA-drift watch.* MetaSync polls hourly; campaign-flag raises a decision card on ~35% CPA drift (SOP 10).
- **Stages:** Active, Delivering
- **Edge functions:** meta-ad-ops, meta-webhook, campaign-flag, audit-log
- **Agents:** MetaSync
- **Playbooks:** Ads
- **Tables:** campaigns, ad_metrics, triage_items, pulse_metrics, automations
- **Storage:** — · **Secrets & rules:** Vault · **External:** Meta
- **Surfaces:** AA Cockpit

### Studio
*The asset and brief library — MJRs, briefs and ad creatives; AI brief generation and the editor handoff.* Briefs out, finished reels back for approval before anything reaches Meta; enforces asset naming (SOP 13).
- **Stages:** Booked, Active, Delivering
- **Edge functions:** brief-generator, mjr-generate, proof-capture, audit-log
- **Agents:** Claude Content, OpenClaw
- **Playbooks:** Ads, Proof, Story
- **Tables:** briefs, assets, proof_uploads, pulse_metrics
- **Storage:** MJRs, Reels, Proof Uploads · **Secrets & rules:** Vault · **External:** Anthropic, Cloudflare R2
- **Surfaces:** AA Studio, AA Cockpit, AA Upload

### Operations
*The automation and agent control panel — what is running, what is paused, the agent event history.* n8n runs 15–20 concurrent sprints with retries and a dead-letter path; every mutation is audited.
- **Stages:** all 8
- **Edge functions:** apify-scrape, aicos-act, campaign-flag, onboarding, audit-log
- **Agents:** Apify Scraper, OpenClaw, n8n, MetaSync, Claude Content
- **Playbooks:** —
- **Tables:** automations, agent_events, audit_log, triage_items
- **Storage:** — · **Secrets & rules:** Vault, Row-Level Security · **External:** Apify, OpenAI, Telegram, Meta
- **Surfaces:** AA Cockpit, Telegram Control

### Money
*MRR, revenue by client, the commercial picture.* PayFast deposit is the gate; mrr-calc rolls up active-client MRR daily into mrr_snapshots.
- **Stages:** Booked, Onboarding, Active, Delivering
- **Edge functions:** mrr-calc, onboarding, audit-log
- **Agents:** —
- **Playbooks:** —
- **Tables:** payments, mrr_snapshots, contracts, pulse_metrics
- **Storage:** — · **Secrets & rules:** — · **External:** PayFast
- **Surfaces:** AA Cockpit

---

## Pipeline stages → connections (forward)

### 1 · Source — *Acquisition*
Owner: **Apify Scraper agent** · Primary systems: `apify-scrape · entities`
A lead has entered the system but is not yet qualified. The daily 03:00 SAST scrape sources Cape Town owner-operators, dedupes against existing entities, and writes new prospects at Source.
- **Owned by:** Cockpit, Pipeline, Operations
- **Edge:** apify-scrape, lead-score, audit-log · **Agents:** Apify Scraper · **Playbooks:** —
- **Tables:** entities, agent_events, audit_log · **Storage:** — · **Secrets:** Vault
- **External:** Apify · **Surfaces:** AA Cockpit

### 2 · Cold — *Acquisition*
Owner: **VA / OpenClaw** · Primary systems: `lead-score · entities`
Qualified by ICP score, sitting in the queue, not yet contacted. lead-score assigns an ICP fit score; above ~65 enters the cold queue and below is parked — the gate that protects the founder's time.
- **Owned by:** Cockpit, Pipeline, Operations
- **Edge:** lead-score, audit-log · **Agents:** OpenClaw · **Playbooks:** —
- **Tables:** entities, triage_items, audit_log · **Storage:** — · **Secrets:** —
- **External:** — · **Surfaces:** AA Cockpit

### 3 · Contacted — *Acquisition*
Owner: **VA · Distribution** · Primary systems: `360dialog-send · SOP 01` · People: VA (Distribution) · SOPs: 01
First outreach sent; the sequence is running. The VA picks up the cold queue under SOP 01 and begins the five-message WhatsApp sequence — ownership passes machine → human for the first time.
- **Owned by:** Cockpit, Pipeline, Conversations, Operations
- **Edge:** 360dialog-send, 360dialog-webhook, audit-log · **Agents:** n8n · **Playbooks:** Closer
- **Tables:** messages, conversations, entities, automations, audit_log · **Storage:** — · **Secrets:** Vault
- **External:** 360dialog · **Surfaces:** AA Cockpit

### 4 · Engaged — *Acquisition*
Owner: **Alex** · Primary systems: `aicos-act · triage_items` · People: Alex · SOPs: 02
The lead has replied; the conversation is scored and triaged. OpenClaw scores the reply hot/warm/cold and surfaces it as a triage item in the cockpit for a human decision.
- **Owned by:** Cockpit, Pipeline, Conversations, Operations
- **Edge:** aicos-act, meta-webhook, 360dialog-webhook, audit-log · **Agents:** OpenClaw · **Playbooks:** —
- **Tables:** triage_items, agent_events, messages, conversations, entities, audit_log · **Storage:** — · **Secrets:** Vault
- **External:** Meta, 360dialog, OpenAI, Telegram · **Surfaces:** AA Cockpit

### 5 · Booked — *Acquisition*
Owner: **Alex** · Primary systems: `mjr-generate · SOP 04` · People: Alex · SOPs: 03, 04
Sales call scheduled; the MJR is generated and shared ahead of the call as the proof artifact that earns the meeting. The highest-leverage transition in the business.
- **Owned by:** Cockpit, Pipeline, Studio, Money, Operations
- **Edge:** mjr-generate, 360dialog-send, audit-log · **Agents:** Claude Content, OpenClaw · **Playbooks:** Closer
- **Tables:** assets, messages, entities, audit_log · **Storage:** MJRs · **Secrets:** Vault
- **External:** Anthropic, 360dialog · **Surfaces:** AA Cockpit, AA Studio

### 6 · Onboarding — *Delivery*
Owner: **n8n agent** · Primary systems: `onboarding · SOP 05/06` · People: Alex · SOPs: 05, 06, 14
Deposit cleared; access and assets are being gathered (day 1–7). The PayFast deposit is the single gate that flips prospect → client and fires the n8n onboarding orchestration. Nothing in delivery runs until money clears.
- **Owned by:** Cockpit, Pipeline, Money, Operations
- **Edge:** onboarding, audit-log · **Agents:** n8n · **Playbooks:** —
- **Tables:** payments, entities, automations, contracts, audit_log · **Storage:** — · **Secrets:** Vault
- **External:** PayFast, Meta · **Surfaces:** AA Cockpit, AA Client Portal, AA Upload

### 7 · Active — *Delivery*
Owner: **Alex / MetaSync** · Primary systems: `meta-ad-ops · SOP 07/08` · People: Alex · SOPs: 07, 08
Ads launching, first content shipped (week 1–2). The first campaign goes live and is watched for CPA drift; the first reels are briefed and shipped.
- **Owned by:** Cockpit, Pipeline, Campaigns, Studio, Money, Operations
- **Edge:** meta-ad-ops, meta-webhook, campaign-flag, brief-generator, proof-capture, audit-log · **Agents:** MetaSync, Claude Content · **Playbooks:** Ads, Story
- **Tables:** campaigns, ad_metrics, briefs, assets, entities, audit_log · **Storage:** Reels · **Secrets:** Vault
- **External:** Meta, Anthropic · **Surfaces:** AA Cockpit, AA Studio, AA Upload

### 8 · Delivering — *Delivery*
Owner: **Alex / portal** · Primary systems: `client-portal-sync · SOP 09` · People: Alex, Editor, Client · SOPs: 09, 10, 12, 17
Steady-state retainer; ongoing optimisation and reporting. ~25 reels/month, continuous CPA-drift watch, and weekly reviews backed by the client's live dashboard. The tier-upgrade watch (Proof → Authority) sits here under SOP 12.
- **Owned by:** Cockpit, Pipeline, Conversations, Campaigns, Studio, Money, Operations
- **Edge:** client-portal-sync, meta-ad-ops, campaign-flag, proof-capture, brief-generator, mjr-generate, mrr-calc, 360dialog-send, audit-log · **Agents:** MetaSync, Claude Content, n8n · **Playbooks:** Ads, Proof, Story, Closer
- **Tables:** campaigns, ad_metrics, assets, briefs, proof_uploads, pulse_metrics, mrr_snapshots, contracts, audit_log · **Storage:** Reels, Proof Uploads, MJRs · **Secrets:** Vault, Row-Level Security
- **External:** Meta, 360dialog, Anthropic, Cloudflare R2 · **Surfaces:** AA Cockpit, AA Client Portal, AA Upload, AA Studio

---

## Reverse lookups (which workspaces / stages touch each node)

### Edge functions

| Function | Trigger | Used by workspaces | Fires in stages |
|---|---|---|---|
| apify-scrape | CRON | Pipeline, Operations | Source |
| lead-score | TRIGGER | Pipeline | Source, Cold |
| aicos-act | INVOKE | Cockpit, Conversations, Operations | Engaged |
| mjr-generate | INVOKE | Studio | Booked, Delivering |
| brief-generator | INVOKE | Studio | Active, Delivering |
| 360dialog-send | INVOKE | Conversations | Contacted, Booked, Delivering |
| 360dialog-webhook | WEBHOOK | Conversations | Contacted, Engaged |
| meta-webhook | WEBHOOK | Conversations, Campaigns | Engaged, Active |
| meta-ad-ops | INVOKE | Campaigns | Active, Delivering |
| campaign-flag | CRON | Cockpit, Campaigns, Operations | Active, Delivering |
| proof-capture | INVOKE | Studio | Active, Delivering |
| client-portal-sync | INVOKE | (serves Client Portal surface) | Delivering |
| onboarding | INVOKE | Pipeline, Operations, Money | Onboarding |
| mrr-calc | CRON | Cockpit, Money | Delivering |
| audit-log | TRIGGER | all 7 | all 8 |
| public-lead-capture | INVOKE | Pipeline (+ Public Site surface) | (feeds Source via the site) |

### Agents

| Agent | Runtime / cadence | Used by workspaces | Acts in stages |
|---|---|---|---|
| Apify Scraper | Apify · daily 03:00 SAST | Cockpit, Pipeline, Operations | Source |
| OpenClaw (AICOS) | GPT-4.1 mini · event-driven | Cockpit, Pipeline, Conversations, Studio, Operations | Cold, Engaged, Booked |
| n8n Orchestrator | Docker self-host · cron + event | Cockpit, Operations | Contacted, Onboarding, Delivering |
| MetaSync | Meta Graph API · hourly | Cockpit, Conversations, Campaigns, Operations | Active, Delivering |
| Claude Content | Claude Sonnet · on request | Cockpit, Studio, Operations | Booked, Active, Delivering |

### External services

| Service | Used by workspaces | Touched in stages |
|---|---|---|
| Meta | Conversations, Campaigns, Operations | Engaged, Onboarding, Active, Delivering |
| 360dialog | Conversations | Contacted, Engaged, Booked, Delivering |
| Apify | Pipeline, Operations | Source |
| Anthropic | Studio | Booked, Active, Delivering |
| OpenAI | Operations | Engaged |
| PayFast | Money | Onboarding |
| Google Workspace | — (infra: email/Drive/Calendar) | — |
| Cloudflare R2 | Studio | Delivering |
| Telegram | Operations | Engaged |

### Surfaces

| Surface | Auth | Used by workspaces | Appears in stages |
|---|---|---|---|
| AA Public Site | none | Pipeline | (top-of-funnel capture) |
| AA Cockpit | admin/distro/delivery | all 7 | all 8 |
| AA Studio | admin/delivery | Studio | Booked, Active, Delivering |
| AA Upload | client | Studio | Onboarding, Active, Delivering |
| AA Client Portal | client (RLS-scoped) | (portal) | Onboarding, Delivering |
| Telegram Control | admin | Operations | — |

### Storage, secrets & playbooks

| Node | Used by workspaces | Used in stages |
|---|---|---|
| Storage · MJRs | Studio | Booked, Delivering |
| Storage · Reels | Studio | Active, Delivering |
| Storage · Proof Uploads | Studio | Delivering |
| Vault | Conversations, Campaigns, Studio, Operations | Source, Contacted, Engaged, Booked, Onboarding, Active, Delivering |
| Row-Level Security | Operations | Delivering |
| Ads Playbook | Campaigns, Studio | Active, Delivering |
| Proof Playbook | Studio | Delivering |
| Story Playbook | Studio | Active, Delivering |
| Closer Playbook | Conversations | Contacted, Booked, Delivering |

> The seven canonical end-to-end data flows (Inbound DM → Triage; MJR → Send; Deposit → Active; CPA Drift → Decision; Proof Upload; Portal View; Weekly Review) are written out in the Operating System Reference Manual, §12.

---

## Reconciliation notes (v1.0 photo-map → v1.1)

- **Pipeline spine** is now the canonical 8 stages (Source → Delivering), replacing the earlier service-funnel stages.
- **Seven workspaces** — the previous eighth "Clients" tab is folded into Pipeline + Client Portal.
- **360dialog** is the WhatsApp BSP, not ManyChat.
- **External services** aligned to the documented nine — added Google Workspace, Cloudflare R2, Telegram; dropped Railway; Supabase and n8n moved to their own layers, not "external".
- **Data layer** — campaigns table restored; credentials moved to the Vault (credential-registry table dropped); Vault + RLS shown explicitly.
- **Surfaces** — shown as the six documented (added Public Site, Studio, Telegram control).
- **public-lead-capture** kept as the 16th edge function (the docs' 15 omit the web lead-magnet path).

## Open items — flagged, not resolved (do not silently decide)

1. **Supabase project ref** — docs say `ayfidvycgqorxmlczyxl`; prior live work used `iwkhdqqgfjtpdhcbpftu`. Confirm before building; use env vars meanwhile.
2. **Recurring billing** — only the deposit gate exists; nothing collects the monthly retainer that `mrr-calc` rolls up.
3. **Backup / DR** — single Supabase project, no documented backup/PITR/disaster-recovery.
4. **Monitoring** — no proactive agent/function alerting and no "machine is down" runbook; the Operations workspace is the closest thing.
5. **Cold WhatsApp + POPIA §69** — outreach (SOP 01) carries account-ban and consent risk, not yet mitigated.

## Brand tokens (confirmed)

Background `#0A0E0D` · teal `#00E5C3` (primary/outbound) · amber `#FFB454` (return/telemetry). Fonts: Archivo Expanded (display), Archivo (body), JetBrains Mono (mono/data). (The Launch Build Plan's "#07100E + DM" stack is stale; this is canonical.)
