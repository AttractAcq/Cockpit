# Supabase Edge Functions Reference

Project: Attract Acquisition / Attract  
Supabase project ref: `xivewedajschthjlblfb`
Base URL: `https://xivewedajschthjlblfb.supabase.co/functions/v1`
Source reviewed: deployed Edge Function source downloaded from Supabase on 2026-06-19

This document explains the 16 deployed Supabase Edge Functions used by the AA cockpit, automation layer, public lead capture, WhatsApp/Instagram ingest, Meta ads operations, content generation, onboarding, and reporting workflows.

## Shared Runtime Conventions

All functions are Deno Edge Functions. Most import helpers from `supabase/functions/_shared/aa.ts`.

Shared helper behavior:

- `svc()` creates a Supabase client with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- `json(body, status)` returns JSON with permissive CORS headers.
- `cors` allows `POST`, `GET`, and `OPTIONS`.
- `useStubs()` returns true unless `AA_USE_STUBS=false`. This means many AI/external-service functions default to stubbed behavior unless explicitly configured for production.
- `readCredential(sb, clientSlug, service, credentialType)` reads credentials from Vault through `vault_read_credential`.
- `audit(...)` inserts into `audit_log`.
- `agentEvent(...)` inserts into `agent_events`.

Common response behavior:

- `OPTIONS` usually returns `200 ok` for CORS preflight.
- Most invoke-style functions return JSON.
- Most unexpected failures return `500` with `error: String(e)`.
- `meta-webhook` intentionally returns `200` for most POST cases, including ignored/unknown payloads, to avoid Meta retry storms.

Common database tables touched:

- `entities`
- `triage_items`
- `conversations`
- `messages`
- `campaigns`
- `ad_metrics`
- `assets`
- `briefs`
- `contracts`
- `mrr_snapshots`
- `pulse_metrics`
- `payments`
- `proof_uploads`
- `audit_log`
- `agent_events`
- `team_members`

## Function Inventory

| Function | Primary role | Main trigger | Main side effects |
| --- | --- | --- | --- |
| `aicos-act` | OpenClaw/AICOS agent actions | App/function invoke | Creates triage items, agent events, audits |
| `apify-scrape` | Prospect scraping from Apify/Google Places | Manual/scheduled invoke | Inserts source-stage prospects |
| `audit-log` | Generic audit/event logging endpoint | Internal invoke | Inserts audit/event rows |
| `brief-generator` | Generates content/reel briefs | App invoke | Inserts `briefs` rows |
| `campaign-flag` | Detects Meta campaign CPA drift | Scheduled/manual invoke | Creates high-priority triage items |
| `client-portal-sync` | Client portal aggregate view | Authenticated invoke | Reads client metrics/content/contract |
| `dialog360-send` | Sends outbound WhatsApp via 360dialog | App invoke | Sends/records outbound messages |
| `dialog360-webhook` | Receives inbound WhatsApp | Webhook | Creates entities/conversations/messages |
| `lead-score` | Scores ICP fit for prospects | Trigger/manual invoke | Updates entity score/stage, creates triage |
| `meta-ad-ops` | Creates/pauses/reads Meta campaigns | App/agent invoke | Inserts/updates campaigns |
| `meta-webhook` | Receives Instagram DMs and Meta leadgen | Public Meta webhook | Creates messages, triage, ad metric increments |
| `mjr-generate` | Generates Missed Jobs Report copy | App/agent invoke | Inserts review asset |
| `mrr-calc` | Daily MRR rollup | Cron/manual invoke | Upserts snapshots and pulse metrics |
| `onboarding` | Starts client onboarding | App invoke | Records payment, advances stage, calls n8n |
| `proof-capture` | Registers proof/media uploads | App invoke | Inserts proof upload and image asset |
| `public-lead-capture` | Public site MJR lead intake | Public webhook | Creates/dedupes source-stage prospects |

## Shared Helper: `_shared/aa.ts`

This is not a callable Edge Function, but it is important because nearly every function depends on it.

Responsibilities:

- Creates a service-role Supabase client.
- Standardizes CORS and JSON responses.
- Implements stub-mode switching via `AA_USE_STUBS`.
- Builds Vault credential names with `vaultName(clientSlug, service, credentialType)`.
- Reads secrets from Vault through `vault_read_credential`.
- Writes audit rows and agent event rows.

Important environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AA_USE_STUBS`

Operational note:

- Because `svc()` uses the service role key, function code must enforce authorization itself for any user-facing function. `client-portal-sync` does this. Several internal functions assume trusted invocation.

## `aicos-act`

URL: `/aicos-act`

Purpose:

Runs OpenClaw/AICOS agent commands. It currently supports inbound reply scoring and MJR draft copy generation. It is used as an agent decision endpoint rather than a direct user-facing UI route.

Supported commands:

- `score_reply`
- `draft_mjr`

Request body:

```json
{
  "command": "score_reply",
  "entity_id": "uuid-or-null",
  "message": "Inbound message text",
  "context": {}
}
```

For `draft_mjr`, `context` should include enough business context, such as `business_name`, `niche`, and city/location data.

Validation:

- `command` is required.
- Unknown commands return `400`.

External services and secrets:

- Reads OpenAI key from Vault: `_global / openai / api_key`.
- Uses `AA_AICOS_MODEL`, default `gpt-4.1-mini`.
- Uses stub mode if `AA_USE_STUBS` is true or the OpenAI key is missing.

Behavior:

- `score_reply`
  - Scores text between 0 and 1.
  - Bands score as `hot`, `warm`, or `cold`.
  - Drafts a suggested reply.
  - Inserts an open `triage_items` row with the suggested reply.
  - Does not auto-send.
- `draft_mjr`
  - Produces draft MJR copy.
  - In stub mode, returns placeholder copy based on `context.business_name`.

Database writes:

- `triage_items` for `score_reply`.
- `agent_events` with agent `openclaw`.
- `audit_log` with action `aicos_score_reply` or `aicos_draft_mjr`.

Response shape:

```json
{
  "ok": true,
  "command": "score_reply",
  "stub": true,
  "score": 0.7,
  "band": "hot",
  "suggested_reply": "...",
  "triage_item_id": "uuid",
  "auto_sent": false
}
```

Operational notes:

- This function is intentionally approval-oriented. It creates triage/draft work rather than sending automatically.
- The audit call uses `"triage_items"` as the table name and `entity_id` as the record id, which is semantically imperfect because `entity_id` is not the triage item id.

## `apify-scrape`

URL: `/apify-scrape`

Purpose:

Scrapes local trade/service businesses and inserts new prospects into `entities` at stage `source`.

Request body:

```json
{
  "niches": ["roofing", "plumbing"],
  "locations": ["Cape Town, Western Cape, South Africa"],
  "maxCrawledPlacesPerSearch": 50
}
```

Defaults:

- Niches: `roofing`, `plumbing`, `electrical`, `tiling`
- Locations: Cape Town, Claremont, Bellville, Sea Point
- Max results per search: `50`

External services and secrets:

- Reads Apify token from Vault: `_global / apify / api_token`.
- Uses `AA_APIFY_ACTOR`, default `compass~crawler-google-places`.
- Uses stub leads if `AA_USE_STUBS` is true or token is missing.

Behavior:

- Calls Apify actor with the requested niche/location combinations.
- Filters out obvious chains/franchises by excluding records with `reviewsCount >= 300`.
- Maps Apify rows to a local `Lead` shape.
- Dedupes against existing `entities.business_name`.
- Inserts fresh prospects only.

Database writes:

- `entities`:
  - `kind: prospect`
  - `stage: source`
  - `business_name`
  - `niche`
  - `city`
  - `contact_email`
  - `contact_phone`
  - `notes_signals`
- `agent_events` with agent `apify-scrape`.
- `audit_log` action `apify_scrape`.

Response shape:

```json
{
  "ok": true,
  "found": 100,
  "deduped": 25,
  "inserted": 75
}
```

Operational notes:

- Deduplication is by exact lowercased business name only. It does not dedupe by phone/email.
- `city` is hardcoded to `Cape Town` for real Apify rows, even if the location query is more specific.
- Insert errors are counted implicitly by only incrementing `inserted` when no error occurs; individual insert errors are not returned.

## `audit-log`

URL: `/audit-log`

Purpose:

Generic audit/event logging endpoint for internal workflows.

Request body:

```json
{
  "action": "some_action",
  "table_name": "entities",
  "record_id": "uuid-or-null",
  "metadata": {},
  "agent": "optional-agent-name",
  "entity_id": "optional-entity-id",
  "event_type": "optional-event-type"
}
```

Validation:

- `action` is required.

Database writes:

- Always writes `audit_log`.
- Also writes `agent_events` if both `agent` and `event_type` are provided.

Response shape:

```json
{
  "ok": true,
  "logged": "some_action"
}
```

Operational notes:

- No additional auth guard exists in the function source. Treat it as internal/trusted unless Supabase JWT settings enforce access.

## `brief-generator`

URL: `/brief-generator`

Purpose:

Generates a faceless 9:16 reel/content brief for a client/prospect and stores it as a draft brief.

Request body:

```json
{
  "entity_id": "uuid",
  "topic": "general proof reel",
  "ref_code": "optional-reference-code"
}
```

Validation:

- `entity_id` is required.
- Returns `404` if entity is not found.

External services and secrets:

- Reads Anthropic key from Vault: `_global / anthropic / api_key`.
- Uses `AA_CLAUDE_MODEL`, default `claude-sonnet-4-20250514`.
- Uses stub mode if `AA_USE_STUBS` is true or the Anthropic key is missing.

Behavior:

- Fetches the entity.
- Builds context from `business_name`, `niche`, and `topic`.
- Generates brief body using Claude or stub template.
- Inserts a `briefs` row with status `draft`.

Database writes:

- `briefs`
- `agent_events` with agent `claude-content`, event `brief_generated`
- `audit_log` action `brief_generate`

Response shape:

```json
{
  "ok": true,
  "stub": true,
  "brief_id": "uuid",
  "body": "...",
  "needs_approval": true
}
```

Operational notes:

- Generated briefs always require approval.
- The function stores text in `briefs.body`; it does not create a file asset.

## `campaign-flag`

URL: `/campaign-flag`

Purpose:

Runs a CPA drift sweep across active campaigns and creates triage items when recent CPA is materially worse than baseline.

Trigger:

- Intended for scheduled or manual invocation.

Inputs:

- The function does not currently read request body parameters.

Behavior:

- Selects campaigns where `status = active`.
- Computes CPA over:
  - Recent window: last 48 hours.
  - Baseline window: last 7 days.
- CPA = `spend_cents / conversions`.
- Flags campaigns where recent CPA drift is at least 35 percent above baseline.

Database reads:

- `campaigns`
- `ad_metrics`

Database writes:

- `triage_items` with high priority.
- `agent_events` with agent `metasync`, event `cpa_drift_flagged`.
- `audit_log` action `campaign_flag_sweep`.

Response shape:

```json
{
  "ok": true,
  "checked": 10,
  "flagged": 2
}
```

Operational notes:

- Campaign query uses `status = active`. Other code sometimes uses `live`, `running`, or `paused`, so status normalization matters.
- Campaigns with zero conversions in either window are skipped.
- There is no dedupe check for existing drift triage items, so repeated sweeps can create duplicate triage rows.

## `client-portal-sync`

URL: `/client-portal-sync`

Purpose:

Returns a client-scoped portal snapshot: entity profile, campaign metrics, content awaiting review, and active contract.

Request body:

```json
{
  "entity_id": "uuid"
}
```

Authorization:

- Requires `Authorization: Bearer <jwt>`.
- Uses `sb.auth.getUser(jwt)` to resolve the caller.
- Looks up `team_members` by `user_id`.
- Staff roles can access any entity:
  - `admin`
  - `distribution`
  - `delivery`
- Non-staff users can only access their own `team_members.client_entity_id`.

Validation:

- `entity_id` is required.
- Returns `401` if JWT is invalid/missing.
- Returns `403` if the caller is not linked or not allowed.
- Returns `404` if entity is not found.

Database reads:

- `team_members`
- `entities`
- `campaigns`
- `ad_metrics`
- `assets`
- `contracts`

Database writes:

- `audit_log` action `portal_sync`.

Response shape:

```json
{
  "ok": true,
  "entity_id": "uuid",
  "business_name": "Client Name",
  "stage": "active",
  "metrics": {
    "spend_cents": 100000,
    "leads": 12,
    "conversions": 3,
    "campaigns": 2
  },
  "content_for_review": [],
  "contract": {
    "tier": "proof_brand",
    "mrr_cents": 420000,
    "status": "active",
    "starts_at": "...",
    "ends_at": null
  }
}
```

Operational notes:

- This is one of the few functions with explicit user authorization in source.
- It uses service-role queries after authorization, so the role check is the critical access-control boundary.

## `dialog360-send`

URL: `/dialog360-send`

Purpose:

Sends outbound WhatsApp messages through 360dialog and records the outbound message in the local conversation history.

Request body:

```json
{
  "entity_id": "uuid",
  "conversation_id": "uuid-or-null",
  "to": "+27820000000",
  "body": "Message text",
  "template": null,
  "client_slug": "client-slug",
  "approved": true
}
```

Validation and guardrails:

- `to` and `body` are required.
- `approved` must be `true`. Otherwise returns `403`.
- This is a human-approval guardrail.

External services and secrets:

- Reads client credential from Vault if `client_slug` is provided:
  - `{client_slug} / dialog360 / bsp_key`
- Calls `https://waba-v2.360dialog.io/messages` when not in stub mode.
- Uses stub mode if `AA_USE_STUBS` is true or no key is found.

Behavior:

- Sends either text or template payload.
- If `conversation_id` is absent and `entity_id` exists, creates a WhatsApp conversation.
- Inserts outbound message into `messages`.
- Audits send attempt.

Database writes:

- `conversations` if no conversation was supplied.
- `messages`
- `audit_log` action `whatsapp_send`

Response shape:

```json
{
  "ok": true,
  "stub": true,
  "external_ref": "stub-wamid-...",
  "conversation_id": "uuid"
}
```

Operational notes:

- If `client_slug` is omitted, the function will use stub mode because no 360dialog key is loaded.
- The local outbound message is inserted after the external/stub send path, but no delivery status is tracked here.

## `dialog360-webhook`

URL: `/dialog360-webhook`

Purpose:

Receives inbound WhatsApp messages from 360dialog, threads them into entities/conversations, stores messages, and invokes AICOS scoring.

Auth:

- Optional shared-secret auth.
- If `AA_WEBHOOK_SECRET` is set, request header `x-aa-webhook-secret` must match.
- If `AA_WEBHOOK_SECRET` is not set, the webhook accepts requests.

Request:

- `GET` returns `ok`.
- `POST` accepts 360dialog-style payloads or simplified payloads.

Payload extraction:

- Reads `payload.entry[0].changes[0].value`, `payload.value`, or the raw payload.
- Message list comes from `value.messages`, or from the raw payload if it has `from`.

Behavior:

- Finds entity by `entities.contact_phone = from`.
- If no entity exists, creates a prospect:
  - `kind: prospect`
  - `stage: engaged`
  - `business_name: WhatsApp {from}`
  - `contact_phone: from`
- Finds or creates an open WhatsApp conversation for the entity.
- Inserts inbound message.
- Invokes `aicos-act` with `command: score_reply`.
- Audits inbound processing.

Database writes:

- `entities` when contact is new.
- `conversations`
- `messages`
- `audit_log`
- Indirectly, `aicos-act` may create `triage_items` and `agent_events`.

Response shape:

```json
{
  "ok": true,
  "processed": 1
}
```

Operational notes:

- Phone matching is exact, so normalization is important.
- Inbound text defaults to empty string if not present.
- AICOS invocation errors are swallowed.

## `lead-score`

URL: `/lead-score`

Purpose:

Scores an entity's ICP fit from 0 to 100, updates the entity, and advances qualified source-stage leads into the cold queue.

Request body:

```json
{
  "entity_id": "uuid"
}
```

Validation:

- `entity_id` is required.
- Returns `404` if entity is not found.

Scoring modes:

- Stub mode:
  - Calls Postgres RPC `compute_icp_score(p_niche, p_city, p_signals)`.
  - Method is `stub:compute_icp_score`.
- Production mode:
  - Reads `AA_ICP_MODEL`, default `claude-haiku-4-5-20251001`.
  - If model starts with `claude-`, reads Vault `_global / anthropic / api_key`.
  - Otherwise reads Vault `_global / openai / api_key`.
  - Calls Anthropic Messages API or OpenAI Chat Completions.
  - Requires strict JSON from model: `score`, `reason`, `band`.

Behavior:

- Clamps and rounds score to `0..100`.
- Banding:
  - `hot`: score >= 85
  - `warm`: score >= 65
  - `cold`: score < 65
- Updates `entities.icp_fit_score`.
- If score >= 65 and current stage is `source`, advances entity to `cold`.
- If advanced, creates a triage item for the qualified lead.

Database writes:

- `entities`
- `triage_items` if advanced.
- `agent_events` with agent `lead-score`, event `icp_scored`.
- `audit_log` action `lead_score`.

Response shape:

```json
{
  "ok": true,
  "entity_id": "uuid",
  "score": 88,
  "band": "hot",
  "reason": "Owner-operated Cape Town trade business",
  "method": "stub:compute_icp_score",
  "advanced": true,
  "stub": true
}
```

Error behavior:

- Missing model credential returns `500` with `missing_credential`.
- Upstream model HTTP failures return `502` with provider, status, and model.

Operational notes:

- The function only advances from `source` to `cold`; it does not move already-contacted leads.
- This function relies on `notes_signals` for richer scoring input.

## `meta-ad-ops`

URL: `/meta-ad-ops`

Purpose:

Performs Meta campaign operations for agents or UI workflows: create campaign, pause campaign, read insights.

Request body:

```json
{
  "action": "create_campaign",
  "entity_id": "uuid",
  "client_slug": "client-slug",
  "campaign_id": "uuid-or-null",
  "params": {}
}
```

Supported actions:

- `create_campaign`
- `pause`
- `read_insights`

Validation:

- `action` and `entity_id` are required.
- Unknown actions return `400`.

External services and secrets:

- If `client_slug` is provided, reads `{client_slug} / meta / access_token`.
- Otherwise reads `_global / meta / system_user_token`.
- Uses `AA_META_AD_ACCOUNT` if `params.ad_account_id` is absent.
- Calls Graph API `v21.0/act_{ad_account}/campaigns` for real campaign creation.
- Uses stub mode if `AA_USE_STUBS` is true or no token is found.

Behavior:

- `create_campaign`
  - Creates a Meta campaign externally or stub id.
  - Inserts local `campaigns` row with status `draft`.
- `pause`
  - Updates local campaign status to `paused`.
  - Does not call Meta pause endpoint in the current source.
- `read_insights`
  - Returns stub spend when stubbed.
  - Production implementation currently returns spend `0`.

Database writes:

- `campaigns`
- `agent_events` with agent `metasync`
- `audit_log` action `meta_{action}`

Response shape:

```json
{
  "ok": true,
  "action": "create_campaign",
  "stub": true,
  "campaign_id": "uuid",
  "external_id": "stub-camp-..."
}
```

Operational notes:

- `pause` is local-only in current code. If the external Meta campaign must pause, this function needs a Graph API pause call.
- `read_insights` is a placeholder in production mode.

## `meta-webhook`

URL: `/meta-webhook`

Purpose:

Handles Meta webhook traffic for Instagram DMs and Meta Lead Ads leadgen events.

Important deployment requirement:

- `verify_jwt` must be false. Meta sends unauthenticated webhook requests.

GET verification:

- Reads `hub.mode`, `hub.verify_token`, and `hub.challenge`.
- Compares token with `AA_META_VERIFY_TOKEN`.
- Returns the challenge as plain text when valid.
- Returns `403` if invalid.

POST behavior:

- Accepts objects where `payload.object` is `instagram` or `page`.
- Ignores unknown objects with HTTP 200.
- Processes:
  - `entry.messaging[]` for Instagram DMs.
  - `entry.changes[]` where `field = leadgen`.

Instagram DM handling:

- Finds the receiving entity by `entities.notes_signals->>ig_page_id = msg.recipient.id`.
- If no entity is found:
  - Inserts `agent_events` event `ig_message_unmatched`.
  - Inserts high-priority `triage_items` row instructing staff to set `notes_signals.ig_page_id`.
  - Does not create a conversation.
- If entity is found:
  - Finds latest open Instagram conversation for entity.
  - Creates one if missing.
  - Inserts inbound `messages` row with text/media.
  - Inserts `agent_events` event `ig_message_received`.

Leadgen handling:

- Finds campaign by `campaigns.external_id = value.ad_id`.
- If campaign is found:
  - Calls RPC `increment_ad_lead(p_campaign_id, p_metric_date)` for today's metric.
- Always logs an agent event `leadgen_received`.
- Always inserts a triage item:
  - Normal priority if campaign/entity matched.
  - High priority if no campaign match.

Database writes:

- `conversations`
- `messages`
- `triage_items`
- `agent_events`
- `ad_metrics` indirectly through `increment_ad_lead`

Response behavior:

- Returns plain text `received` with HTTP 200 for most POST cases.
- Catches per-event errors and continues processing remaining events.

Operational notes:

- The function intentionally avoids non-200 POST responses to prevent Meta retry storms.
- Instagram threading depends on `notes_signals.ig_page_id`; missing mappings become triage.
- Leadgen threading depends on `campaigns.external_id` matching the Meta ad id.

## `mjr-generate`

URL: `/mjr-generate`

Purpose:

Generates Missed Jobs Report copy for an entity and stores it as a review asset.

Request body:

```json
{
  "entity_id": "uuid"
}
```

Validation:

- `entity_id` is required.
- Returns `404` if entity is not found.

External services and secrets:

- Reads Anthropic key from Vault: `_global / anthropic / api_key`.
- Uses `AA_CLAUDE_MODEL`, default `claude-sonnet-4-20250514`.
- Uses stub mode if `AA_USE_STUBS` is true or key is missing.

Behavior:

- Fetches entity context.
- Generates MJR copy using Claude or stub template.
- Creates a storage path like `{entity_id}/mjr/mjr_{timestamp}.pdf`.
- Inserts an `assets` row with:
  - `kind: mjr`
  - `status: review`
  - metadata containing generated copy, stub flag, generated timestamp.

Database writes:

- `assets`
- `agent_events` with agent `claude-content`, event `mjr_generated`
- `audit_log` action `mjr_generate`

Response shape:

```json
{
  "ok": true,
  "stub": true,
  "asset_id": "uuid",
  "storage_path": "entity/mjr/mjr_...",
  "copy": "...",
  "needs_approval": true
}
```

Operational notes:

- Despite the `.pdf` storage path, this function does not generate/upload an actual PDF file. It stores copy and planned path in the asset row.

## `mrr-calc`

URL: `/mrr-calc`

Purpose:

Daily MRR rollup from active contracts into `mrr_snapshots` and per-client `pulse_metrics`.

Trigger:

- Intended cron/daily invocation.
- Can also be manually invoked.

Inputs:

- No request body is used.

Behavior:

- Selects active contracts.
- Sums `mrr_cents`.
- Counts unique active client entities.
- For each active contract, upserts a `pulse_metrics` row with:
  - `metric_key: mrr_cents`
  - `metric_date: today`
  - `metric_value: contract mrr`
- Upserts a daily `mrr_snapshots` row.

Database writes:

- `pulse_metrics`
- `mrr_snapshots`
- `agent_events` with agent `mrr-calc`, event `snapshot_written`
- `audit_log` action `mrr_calc`

Response shape:

```json
{
  "ok": true,
  "date": "2026-06-19",
  "mrr_cents": 1270000,
  "active_clients": 3
}
```

Operational notes:

- Idempotent for `mrr_snapshots` by `snapshot_date`.
- Upsert for `pulse_metrics` uses conflict target `entity_id,metric_date,metric_key`.
- It writes multiple `mrr_cents` metric rows per day, one per entity. UI consumers must dedupe/aggregate if they expect one metric per key.

## `onboarding`

URL: `/onboarding`

Purpose:

Starts onboarding after a deposit/payment event, advances entity stage, and triggers the n8n onboarding workflow.

Request body:

```json
{
  "entity_id": "uuid",
  "amount_cents": 420000,
  "tier": "proof_brand"
}
```

Validation:

- `entity_id` is required.
- `amount_cents` is required and must be greater than 0.
- Returns `404` if entity is not found.
- Returns `409` if entity is already in `onboarding`, `active`, or `delivering`.

External services and secrets:

- Reads `AA_N8N_ONBOARDING_WEBHOOK`.
- Calls that webhook with entity/contact/payment/tier payload.

Behavior:

1. Fetches entity.
2. Inserts a pending `payments` row.
3. Updates entity stage to `onboarding`.
4. Calls n8n onboarding webhook.
5. Writes agent event and audit log.

Database writes:

- `payments`
- `entities`
- `agent_events`
- `audit_log`

Response behavior:

- Success:

```json
{
  "ok": true,
  "entity_id": "uuid",
  "stage": "onboarding",
  "n8n_response": {}
}
```

- If webhook is missing or returns an error, function returns HTTP `207` with `ok: false` because the entity was already advanced.

Operational notes:

- Stage advancement is not rolled back if n8n fails.
- Payment is inserted with `status: pending`.

## `proof-capture`

URL: `/proof-capture`

Purpose:

Registers uploaded proof media and creates a corresponding image asset.

Request body:

```json
{
  "entity_id": "uuid",
  "phase": "before",
  "storage_path": "entity-id/proof/file.jpg",
  "caption": "optional",
  "captured_at": "optional ISO timestamp",
  "exif": {}
}
```

Validation:

- `entity_id`, `phase`, and `storage_path` are required.
- `storage_path` must start with `{entity_id}/`.

Behavior:

- Inserts `proof_uploads` row.
- Inserts `assets` row:
  - `kind: image`
  - `title: Proof {phase}`
  - `status: draft`
  - metadata includes `source: proof-capture`, `phase`, and `exif`.
- Audits the capture.

Database writes:

- `proof_uploads`
- `assets`
- `audit_log` action `proof_capture`

Response shape:

```json
{
  "ok": true,
  "proof_upload_id": "uuid",
  "asset_id": "uuid"
}
```

Operational notes:

- This function assumes the file has already been uploaded to storage. It records metadata only.

## `public-lead-capture`

URL: `/public-lead-capture`

Purpose:

Public MJR lead magnet intake from the website. Validates and dedupes lead submissions, then creates a source-stage prospect if needed.

Important deployment requirement:

- Intended public/webhook usage. The source comments indicate `verify_jwt:false`.

Request body:

```json
{
  "business_name": "Roofing Co",
  "contact_name": "Owner Name",
  "contact_email": "owner@example.com",
  "contact_phone": "+27820000000",
  "niche": "roofing",
  "city": "Cape Town"
}
```

Validation:

- Method must be `POST`.
- `business_name` is required.
- At least one valid email or phone is required.
- Input lengths are capped:
  - business name: 200 chars
  - contact name: 120 chars
  - email: 200 chars
  - phone: 40 chars
  - niche: 80 chars
  - city: 80 chars

Dedupe:

- First checks `entities.contact_email`.
- Then checks `entities.contact_phone`.
- If either exists, it reuses that entity id and does not create a duplicate.

Database writes:

- `entities` if no existing contact is found:
  - `kind: prospect`
  - `stage: source`
  - `business_name`
  - contact fields
  - `niche`
  - `city`
  - `notes_signals.source: public_site_mjr`
- `audit_log` action `public_lead_capture`.

Response shape:

```json
{
  "ok": true,
  "message": "Thanks - your Missed Jobs Report request is in. We'll be in touch shortly."
}
```

Operational notes:

- The response intentionally returns no sensitive record details.
- The comments say an insert trigger should ICP-score the lead automatically; verify the database trigger exists before relying on that behavior.

## Cross-Function Workflows

### Public Lead to Pipeline

1. `public-lead-capture` receives website MJR form.
2. It inserts or dedupes an `entities` prospect at `source`.
3. Database trigger or manual process invokes `lead-score`.
4. `lead-score` updates `icp_fit_score`.
5. If score >= 65 and entity is still `source`, it advances to `cold` and creates triage.

### Scrape to Pipeline

1. `apify-scrape` collects businesses and inserts new prospects at `source`.
2. Those entities can be scored by `lead-score`.
3. Qualified leads move to `cold`.
4. Outreach and replies can flow through WhatsApp/Instagram functions.

### WhatsApp Inbound to Triage

1. `dialog360-webhook` receives inbound WhatsApp.
2. It finds or creates entity and open WhatsApp conversation.
3. It inserts inbound message.
4. It invokes `aicos-act` with `score_reply`.
5. `aicos-act` scores the reply and creates a triage item with suggested response.

### Instagram/Meta Inbound

1. `meta-webhook` verifies GET challenge for setup.
2. For Instagram DMs:
   - Threads by `notes_signals.ig_page_id`.
   - Creates/updates conversations/messages.
   - Creates triage if page is unmatched.
3. For Meta leadgen:
   - Matches `campaigns.external_id` to Meta ad id.
   - Increments ad lead metrics via RPC.
   - Creates triage for follow-up.

### Content Production

1. `mjr-generate` creates review assets for Missed Jobs Reports.
2. `brief-generator` creates draft reel briefs.
3. `proof-capture` registers uploaded proof images and creates draft assets.
4. Review workflows consume `assets` and `briefs`.

### Client Activation and Reporting

1. `onboarding` records payment, advances stage, and triggers n8n.
2. `meta-ad-ops` creates/pauses campaign records and optionally talks to Meta.
3. `campaign-flag` monitors CPA drift and creates triage.
4. `mrr-calc` updates MRR snapshots and pulse metrics.
5. `client-portal-sync` aggregates campaign/content/contract state for portal users.

## Secrets and Environment Variables

Direct environment variables:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | shared helper | Supabase client URL |
| `SUPABASE_SERVICE_ROLE_KEY` | shared helper | Service role access |
| `AA_USE_STUBS` | shared helper, AI/external functions | Enables/disables stub mode |
| `AA_AICOS_MODEL` | `aicos-act` | OpenAI model for AICOS |
| `AA_APIFY_ACTOR` | `apify-scrape` | Apify actor id |
| `AA_CLAUDE_MODEL` | `brief-generator`, `mjr-generate` | Anthropic model |
| `AA_WEBHOOK_SECRET` | `dialog360-webhook` | Optional inbound WhatsApp webhook secret |
| `AA_ICP_MODEL` | `lead-score` | ICP scoring model |
| `AA_META_AD_ACCOUNT` | `meta-ad-ops` | Meta ad account id |
| `AA_META_VERIFY_TOKEN` | `meta-webhook` | Meta webhook verification |
| `AA_N8N_ONBOARDING_WEBHOOK` | `onboarding` | n8n onboarding endpoint |

Vault credentials:

| Credential path | Used by | Purpose |
| --- | --- | --- |
| `_global / openai / api_key` | `aicos-act`, `lead-score` | OpenAI calls |
| `_global / anthropic / api_key` | `brief-generator`, `lead-score`, `mjr-generate` | Anthropic calls |
| `_global / apify / api_token` | `apify-scrape` | Apify actor calls |
| `_global / meta / system_user_token` | `meta-ad-ops` | Meta Graph API fallback |
| `{client_slug} / dialog360 / bsp_key` | `dialog360-send` | 360dialog send API |
| `{client_slug} / meta / access_token` | `meta-ad-ops` | Client-specific Meta token |

## Operational Risks and Follow-Ups

1. Stub mode is default-on.
   - `AA_USE_STUBS` defaults to true unless set exactly to false.
   - Production should explicitly set `AA_USE_STUBS=false` only after credentials and provider behavior are verified.

2. Several internal functions rely on trusted invocation.
   - `audit-log`, `dialog360-send`, `meta-ad-ops`, `onboarding`, and content generators do not perform user-level authorization in source.
   - Supabase JWT verification or upstream app permissions must protect them.

3. `meta-webhook` and `public-lead-capture` are intentionally public.
   - `meta-webhook` must be public for Meta.
   - `public-lead-capture` is public by design.
   - Both should be monitored for abuse.

4. `dialog360-webhook` can be unauthenticated if `AA_WEBHOOK_SECRET` is missing.
   - Set the secret in production.

5. `mrr-calc` creates one `pulse_metrics` row per active contract for `mrr_cents`.
   - UI code should aggregate or dedupe by key/date if it expects global metrics.

6. `campaign-flag` can create duplicate triage items on repeated runs.
   - Consider adding a dedupe key or checking existing open triage for the same campaign/drift window.

7. `meta-ad-ops.pause` is local-only.
   - It updates the local row but does not pause the external Meta campaign.

8. `mjr-generate` does not actually render/upload a PDF.
   - It creates an asset row with a PDF-like path and stores generated copy in metadata.

9. Phone and business-name dedupe are exact-match oriented.
   - Normalize phone numbers and business names before relying on dedupe quality.

10. `onboarding` is not transactional.
    - Payment insert and stage update happen before n8n call.
    - A webhook failure returns `207` but does not roll back the stage.
