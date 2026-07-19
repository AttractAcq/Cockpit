# AA-OS Supabase Reconciliation Report

**Generated:** 2026-06-21  
**Current approved production project:** `xivewedajschthjlblfb` ("Cockpit") — West EU (Paris)
**Method:** Read-only SQL via Supabase MCP. No schema changes made.  
**Scope:** Reconcile live Supabase state against `attract-acquisition-backend.md` v1.1, `attract-acquisition-system-map_1.md` v1.1, and `attract-acquisition-frontend_1.md`.

---

## §1 — Project Reference & Region

**RESOLVED.** The `ayfid…` vs `iwkhd…` ambiguity is closed.

| Project ref | Name | Status | Region |
|---|---|---|---|
| `xivewedajschthjlblfb` | Cockpit | **ACTIVE_HEALTHY** | West EU (Paris) |
| `ayfidvycgqorxmlczyxl` | Attract Acquisition | **INACTIVE** | eu-west-1 (Ireland) |
| `fgyvcyksgbivhrqoxkmj` | AICOS | ACTIVE_HEALTHY | eu-west-3 (Paris) |
| `ytixityazjuurkloeqli` | AA Ops | INACTIVE | eu-west-1 |

**Canonical live project:** `xivewedajschthjlblfb`.
Earlier project references are obsolete. All frontend configuration and production operations must target `xivewedajschthjlblfb`.
The Cockpit CLAUDE.md open item #1 is now **RESOLVED** — remove the "⚠️ UNCONFIRMED" caveat and hardcode the ref in docs (keep env vars in code).

---

## §2 — Tables

### 2.1 Table inventory

**Live tables: 19. Expected (backend.md §1.2): 18. Delta: +1.**

All 18 spec-defined tables are present. The extra table is `credential_registry` — undocumented in the spec but present, RLS-enabled, and populated with 8 rows. It is not a stray or accidental table; it maps `(client_slug, service, credential_type)` → `vault_name` and is actively used by the `readCredential()` helper in `_shared/aa.ts`.

| Table | In spec? | RLS | Notes |
|---|---|---|---|
| ad_metrics | ✅ | ✅ | |
| agent_events | ✅ | ✅ | |
| assets | ✅ | ✅ | |
| audit_log | ✅ | ✅ | |
| automations | ✅ | ✅ | |
| briefs | ✅ | ✅ | |
| campaigns | ✅ | ✅ | |
| contracts | ✅ | ✅ | |
| conversations | ✅ | ✅ | |
| **credential_registry** | **❌ undocumented** | ✅ | Maps credentials to vault_name; 8 global rows |
| entities | ✅ | ✅ | |
| messages | ✅ | ✅ | |
| mrr_snapshots | ✅ | ✅ | |
| payments | ✅ | ✅ | |
| proof_uploads | ✅ | ✅ | |
| pulse_metrics | ✅ | ✅ | |
| team_members | ✅ | ✅ | |
| triage_items | ✅ | ✅ | |
| users | ✅ | ✅ | |

### 2.2 Column divergences

The live schema diverges substantially from the column names in backend.md §1.2. The frontend `api.ts` already compensates for the most important differences. The spec needs updating to reflect reality.

#### `entities` (most diverged)

| backend.md spec | Live column | Status |
|---|---|---|
| `name` | `business_name` | RENAMED |
| `phone` | `contact_phone` | RENAMED |
| `client_slug` | `slug` | RENAMED (citext, unique) |
| `metadata (jsonb)` | `notes_signals (jsonb)` | RENAMED |
| `ig_handle` | — | MISSING |
| `source` | — | MISSING |
| `channel` | — | MISSING |
| `owner_id` (→ team_members) | — | MISSING |
| — | `contact_name` | EXTRA |
| — | `contact_email` | EXTRA |

#### `triage_items`

| backend.md spec | Live column | Status |
|---|---|---|
| `type` | — | MISSING |
| `score (0–1)` | — | MISSING |
| `suggested_action` | — | MISSING |
| `suggested_reply` | — | MISSING |
| — | `title` | EXTRA |
| — | `detail` | EXTRA |
| — | `assigned_to` | EXTRA |
| — | `resolved_at` | EXTRA |

`score` and `suggested_reply` — the two fields that would carry OpenClaw's output — do not exist. Either the score lives in `payload` on `agent_events`, or these columns need adding before triage UI can render the fields the frontend spec expects.

#### `messages`

| backend.md spec | Live column | Status |
|---|---|---|
| `entity_id` | — | MISSING |
| `channel` | — | MISSING |
| `status` | — | MISSING |
| `external_id` | — | MISSING |
| — | `media_url` | EXTRA |
| — | `sent_at` | EXTRA |

Messages are linked to entities only through `conversations`, not directly. This affects Conversations workspace queries.

#### `assets`

| backend.md spec | Live | Status |
|---|---|---|
| `type` | `kind` | RENAMED |
| `name` | `title` | RENAMED |
| `created_by` | — | MISSING |
| — | `metadata (jsonb)` | EXTRA |

#### `automations`

| backend.md spec | Live | Status |
|---|---|---|
| `type` | `trigger_type` + `name` | SPLIT |
| `workflow_id (n8n)` | `external_id` | RENAMED |
| `state` | `status` | RENAMED |
| `step` | — | MISSING |
| `retries` | — | MISSING |
| `started_at` | `last_run_at` | RENAMED |
| — | `platform` | EXTRA |
| — | `config (jsonb)` | EXTRA |

#### `campaigns`

| backend.md spec | Live | Status |
|---|---|---|
| `meta_campaign_id` | `external_id` | RENAMED |
| `budget` | `daily_budget_cents` | RENAMED + unit change |
| — | `platform` | EXTRA |
| — | `started_at`, `ended_at` | EXTRA |

#### `payments`

| backend.md spec | Live | Status |
|---|---|---|
| `payfast_ref` | `external_ref` | RENAMED (generalised) |
| `amount` | `amount_cents` | RENAMED + unit change |
| `type` | `tier` | RENAMED |
| — | `currency` | EXTRA |

#### `contracts`

| backend.md spec | Live | Status |
|---|---|---|
| `mrr_amount` | `mrr_cents` | RENAMED + unit change |
| `doc_url` | `document_url` | RENAMED |
| `start_date` | `starts_at` | RENAMED |
| `end_date` | `ends_at` | RENAMED |
| — | `signed_at` | EXTRA |
| — | `updated_at` | EXTRA |

#### `ad_metrics`

| backend.md spec | Live | Status |
|---|---|---|
| `captured_at` | `metric_date` | RENAMED |
| `ctr` | — | MISSING (derived) |
| `cpa` | — | MISSING (derived) |
| `spend` | `spend_cents` | RENAMED + unit change |
| — | `conversions` | EXTRA |

#### `agent_events`

`action` → `event_type` (renamed only).

#### `audit_log`

| backend.md spec | Live | Status |
|---|---|---|
| `actor (text: user/agent/system)` | — | MISSING |
| `before (jsonb)` | — | MISSING |
| `after (jsonb)` | — | MISSING |
| — | `metadata (jsonb)` | EXTRA (combined before/after/context) |
| `id (uuid)` | `id (bigint)` | TYPE CHANGE |

The `log_audit()` trigger packs before/after into a single `metadata` jsonb. The actor type (user vs agent vs system) is not stored.

#### `pulse_metrics`

`scope` column is missing; `metric` → `metric_key`; `value` → `metric_value`; `period/captured_at` → `metric_date`.

#### `briefs`

Spec had granular fields (`archetype`, `hook`, `storyboard`, `caption`, `asset_id`, `created_by`). Live has `title`, `body`, `ref_code` — all narrative content collapsed into `body`. No `created_by`.

#### `proof_uploads`

`job_tag` → `phase`; no `metadata`; no `captured_by`; adds `caption`.

#### `team_members`

`entity_id` → `client_entity_id` (clarifying rename); adds `team_id`; drops `display_name`, `rate`, `status`.

#### `users`

Spec had `id, email, created_at` only. Live adds `full_name`, `updated_at`.

#### `conversations`

Spec: `id, entity_id, channel, external_id, status, last_message_at, created_at`. Live includes equivalent fields; minor naming differences but structurally aligned.

#### `credential_registry` (undocumented, exists in live)

Columns: `id, client_slug, service, credential_type, vault_name, created_at`. Current 8 rows are all `_global` entries (platform-level credentials). Used by `readCredential()` in edge functions. Must be added to backend.md §1.2.

---

## §3 — Pipeline Stage Enum

**CONFIRMED EXACT MATCH.**

Live `pipeline_stage` enum values:
```
{source, cold, contacted, engaged, booked, onboarding, active, delivering}
```

Matches backend.md §1.3 exactly: `source · cold · contacted · engaged · booked · onboarding · active · delivering`. All 8 values, correct order.

Also confirmed: `app_role` enum = `{admin, distribution, delivery, client}` ✅  
`entity_kind` enum = `{prospect, client}` ✅

---

## §4 — RLS Helper Functions & Policy Status

### 4.1 Function names

**CONFIRMED.** The helpers are named `auth_role()`, `auth_entity_ids()`, and `auth_team_id()`.  
The `get_my_role()`, `get_my_client_id()`, `get_my_metadata_id()` variants mentioned as uncertain in backend.md §1.6 **do not exist**.

| Function | Schema | Volatility | Security |
|---|---|---|---|
| `auth_role()` | public | STABLE | SECURITY DEFINER |
| `auth_entity_ids()` | public | STABLE | SECURITY DEFINER |
| `auth_team_id()` | public | STABLE | SECURITY DEFINER |

**Confirmed behaviour:**

- `auth_role()` — queries `team_members` for `auth.uid()`, returns `app_role`. Priority-ordered to handle edge cases where a user has multiple team_member rows.
- `auth_entity_ids()` — for `admin/distribution/delivery`: returns all entity UUIDs. For `client`: returns only `client_entity_id` from their `team_members` row. This is the multi-tenant isolation boundary.
- `auth_team_id()` — returns `team_id` from `team_members` for `auth.uid()`.

### 4.2 RLS coverage

**ALL 19 TABLES have RLS enabled.** No table is unprotected.

### 4.3 Policy pattern

The dominant pattern across tables:
- `{table}_select` — `auth_entity_ids()` scoping for client isolation
- `{table}_staff_write` — `ALL` for `admin/distribution/delivery` roles (note: `ALL` includes SELECT, creating a second SELECT path for staff — see §9)
- `audit_log` — admin-only SELECT; no INSERT policy (trigger-only writes via SECURITY DEFINER)
- `team_members` — admin ALL + `team_members_self_select` for own row
- `users` — admin ALL + self-select + self-update

---

## §5 — Edge Functions

### 5.1 Deployment status

**All 16 expected functions are deployed and ACTIVE.**

| Function | verify_jwt | Versions | Notes |
|---|---|---|---|
| apify-scrape | true | v15 | Cron: 01:00 UTC daily |
| audit-log | true | v1 | Invoked by triggers |
| brief-generator | true | v1 | |
| campaign-flag | true | v1 | Cron: hourly |
| client-portal-sync | true | v14 | |
| **dialog360-send** | true | v1 | See naming note ↓ |
| **dialog360-webhook** | **false** | v1 | Inbound webhook — no JWT ✅ |
| lead-score | true | v15 | |
| **meta-webhook** | **false** | v14 | Inbound webhook — no JWT ✅ |
| meta-ad-ops | true | v1 | |
| mjr-generate | true | v1 | |
| mrr-calc | true | v1 | Cron: 01:30 UTC daily |
| onboarding | true | v14 | |
| aicos-act | true | v1 | |
| proof-capture | true | v1 | |
| **public-lead-capture** | **false** | v1 | Public form — no JWT ✅ |

### 5.2 Naming divergence — ACTION REQUIRED

**Backend.md and system-map consistently write `360dialog-send` and `360dialog-webhook`. The live deployed names are `dialog360-send` and `dialog360-webhook` (prefix order reversed).**

The frontend `api.ts` already calls `invokeFn("dialog360-send", ...)` — it is correct for the live names. The spec documents need updating.

### 5.3 pg_cron jobs

Three scheduled jobs confirmed:

| Job name | Schedule | Invokes |
|---|---|---|
| apify-scrape | `0 1 * * *` (01:00 UTC = 03:00 SAST) | `apify-scrape` |
| campaign-flag | `0 * * * *` (hourly) | `campaign-flag` |
| mrr-calc | `30 1 * * *` (01:30 UTC daily) | `mrr-calc` |

---

## §6 — Auth Method

**CONFIRMED: Email + password only.**

All 8 users in `auth.users` have `raw_app_meta_data->>'provider' = 'email'`. No OAuth, no magic-link, no SSO. This matches the CLAUDE.md note that magic-link was abandoned due to rate limits.

---

## §7 — Storage Buckets & Vault

### 7.1 Storage buckets

**3 buckets, all private (`public = false`):**

| Bucket name | File size limit | Allowed MIME types |
|---|---|---|
| `mjrs` | 50 MB | application/pdf, image/png, image/jpeg |
| `reels` | 500 MB | video/mp4, video/quicktime, image/jpeg, image/png |
| `proof-uploads` | 25 MB | image/jpeg, image/png, image/webp, image/heic |

**Naming gap:** backend.md §1.4 refers to the third bucket as `proof`. The live bucket is `proof-uploads`. The Upload app (`src/App.tsx`) already uses `supabase.storage.from("proof-uploads")` — the code is correct. The spec needs updating.

### 7.2 Vault naming convention

**CONFIRMED convention: `_GLOBAL_{SERVICE}_{CREDENTIAL_TYPE}` (leading underscore for platform keys).**

Current vault contents (6 secrets):

| vault_name | Service |
|---|---|
| `_GLOBAL_ANTHROPIC_API_KEY` | Anthropic |
| `_GLOBAL_APIFY_API_TOKEN` | Apify |
| `_GLOBAL_META_SYSTEM_USER_TOKEN` | Meta |
| `_GLOBAL_OPENAI_API_KEY` | OpenAI |
| `_GLOBAL_TELEGRAM_BOT_TOKEN` | Telegram |
| `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` | Supabase (no leading underscore — documented exception) |

**credential_registry has 8 rows but vault has only 6 secrets. Two gaps:**

1. `_GLOBAL_PAYFAST_MERCHANT_KEY` — registered in `credential_registry`, **not in vault.secrets**. PayFast cannot be used until this is populated.
2. `edge_fn_secret:AA_N8N_ONBOARDING_WEBHOOK` — stored as a Supabase edge-function secret (not vault), which is the correct pattern for n8n.

**Per-client credentials:** No `{CLIENT_SLUG}_*` keys yet — expected, as there are no paying clients. The convention is confirmed from the `vaultName()` helper in `_shared/aa.ts`.

---

## §8 — Backend Open Items Assessment

The 8 open items from backend.md §8, assessed against live state:

### 8.1 PayFast ITN handler (deposit gate, `booked → onboarding`)
**STILL OPEN — CRITICAL PATH.**  
No edge function handles PayFast ITN (instant-payment notification). The `onboarding` function exists with `verify_jwt=true`, making it unsuitable for raw PayFast webhooks without a signature-verification wrapper. The merchant key is registered in `credential_registry` but **not yet written to vault.secrets**. The deposit gate — the transition that separates acquisition from delivery — has no backend implementation.

### 8.2 IG-DM outbound send
**STILL OPEN.**  
Only `dialog360-send` exists for WhatsApp. No Meta DM send function. The frontend spec (frontend_1.md) flags this as a gap function. Inbound IG DMs arrive via `meta-webhook`, but replies cannot be sent programmatically.

### 8.3 Agent control (pause / resume)
**STILL OPEN.**  
No edge function exposes agent pause/resume controls. The `automations` table has a `status` field, but toggling it requires a direct DB write or a missing function. The Operations workspace UI cannot safely pause agents without a backing function.

### 8.4 Recurring retainer billing
**STILL OPEN.**  
No mechanism exists to charge the monthly retainer that `mrr-calc` reports. `mrr-calc` calculates MRR from contract data; it does not trigger payment. There is no cron job, webhook, or function for recurring billing.

### 8.5 Refund / cancellation (SOP 16)
**STILL OPEN.**  
No edge function implements a refund or cancellation flow. No `refund` or `cancellation` event type in `automations` or `agent_events`. Cannot be wired to frontend until implemented.

### 8.6 Backup / DR
**STILL OPEN (unverifiable from SQL).**  
A single active Supabase project with no multi-region replica. PITR status cannot be confirmed via SQL introspection — requires Supabase dashboard review. No documented recovery runbook. Should be checked at project settings level before launch.

### 8.7 Monitoring / alerting
**STILL OPEN.**  
The three pg_cron jobs are active and will log failures to `audit_log`, but no external alerting (PagerDuty, Telegram bot alert, etc.) is wired. The Operations workspace in the Cockpit is the closest thing to monitoring. There is no "cron failed" alerting path.

### 8.8 Naming confirmations
**PARTIALLY RESOLVED:**

| Sub-item | Status |
|---|---|
| Project ref | **RESOLVED** → `xivewedajschthjlblfb` |
| RLS helper names | **RESOLVED** → `auth_role()`, `auth_entity_ids()`, `auth_team_id()` |
| 360dialog function naming | **RESOLVED with divergence** → live is `dialog360-*`, spec says `360dialog-*`. Code is correct; docs need fixing. |
| Model strings (frontend_1.md §5) | **UNVERIFIABLE from DB** — confirmed IDs are in README.md (`claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `gpt-5.4-mini`); no DB record to check against |

---

## §9 — Security Advisors

### 9.1 Security issues

**WARN — anon-callable SECURITY DEFINER functions (3):**

These functions are granted `EXECUTE` to the `anon` role and run with elevated privileges:

1. **`increment_ad_lead`** — increments a counter on `ad_metrics`. An unauthenticated caller can inflate lead counts. Security risk: data integrity.
2. **`trg_lead_score_before`** and **`trg_lead_score_after`** — trigger functions. While triggers are called by the DB engine, not by clients, these are also callable as RPC by `anon`. The mutable `search_path` on all three is an additional concern (search_path injection vector if schema objects are replaced).

**Remediation:** Revoke `EXECUTE` from `anon` on these three functions. Triggers do not need public RPC access; `increment_ad_lead` should require auth if it needs to be callable externally.

**WARN — leaked password protection disabled:**  
Supabase's HaveIBeenPwned check is not enabled. Given that this is an internal-team app (8 users), impact is low, but it should be enabled as a baseline.

### 9.2 Performance issues

**WARN — multiple permissive SELECT policies (affects 13 of 19 tables):**  
The `{table}_staff_write` policies use `ALL` (which includes SELECT). Combined with the `{table}_select` policy, staff users trigger two parallel SELECT policy checks on every read. This causes suboptimal query planning and is the top-reported performance advisor warning. Remediation: change `_staff_write` policies from `ALL` to `INSERT, UPDATE, DELETE`.

**WARN — RLS initplan re-evaluation on `users` and `team_members`:**  
Policies `users_self_select`, `users_self_update`, and `team_members_self_select` call `auth.uid()` directly rather than `(SELECT auth.uid())`. The optimiser cannot lift the call above the row scan, causing re-evaluation per row. Fix: replace `auth.uid()` with `(SELECT auth.uid())` in the WHERE clauses of those three policies.

**INFO — duplicate index on `ad_metrics`:**  
`ad_metrics_campaign_date_unique` and `ad_metrics_campaign_id_metric_date_key` are functionally identical (same column set). One can be dropped.

**INFO — unused indexes (multiple tables):**  
Expected at this stage — no live traffic yet. Review after first real-data load.

---

## Priority resolution list

Items are ordered by: blocking scope × risk × effort.

### P0 — Blocks the entire deposit gate (no clients can transact)

1. **Write `_GLOBAL_PAYFAST_MERCHANT_KEY` to vault.secrets.** The credential is registered but not stored. PayFast cannot verify any ITN.
2. **Build and deploy PayFast ITN edge function.** Needs `verify_jwt=false`, HMAC-SHA1 signature verification, calls `supabase.rpc("...")` to advance entity from `booked → onboarding` and write to `payments`. This is the revenue unlock for the whole system.

### P1 — Security issues that must be fixed before any real-user traffic

3. **Revoke anon EXECUTE on `increment_ad_lead`, `trg_lead_score_before`, `trg_lead_score_after`.** Unauthenticated mutation/SECURITY DEFINER access should not exist.
4. **Enable leaked password protection** in Supabase Auth settings (one toggle, low effort).

### P2 — Schema gaps that block specific workspaces

5. **Add `score` and `suggested_reply` columns to `triage_items`** (or confirm that this data lives elsewhere). The Cockpit home / triage workspace cannot display AI-scored items without these columns.
6. **Decide on `entity_id` in `messages`** — currently messages are entity-linked only via conversations. The Conversations workspace join path is longer and some query patterns in frontend spec assume direct entity linkage.
7. **Add `owner_id`/`assigned_to` to `entities`** if prospecting-to-distribution hand-off tracking is needed (frontend spec implies it).

### P3 — Doc gaps that will cause future build confusion

8. **Update backend.md §1.2 column names** to match live schema. Every table with a divergence is listed in §2.2 above. Without this, any future Claude Code session will write code against the wrong column names.
9. **Add `credential_registry` to backend.md §1.2** as table 19. It is load-bearing infrastructure.
10. **Fix `360dialog-*` → `dialog360-*`** in backend.md §2 and system-map. Code is already correct; the doc is wrong.
11. **Fix bucket name `proof` → `proof-uploads`** in backend.md §1.4.
12. **Remove project ref ambiguity caveat** from Cockpit CLAUDE.md open item #1. Ref is confirmed.

### P4 — Performance/correctness issues (fix before first real traffic load)

13. **Change `_staff_write` policies from `ALL` to `INSERT, UPDATE, DELETE`** on all 13 affected tables. Two permissive SELECT paths per query is unnecessary overhead.
14. **Replace bare `auth.uid()` with `(SELECT auth.uid())`** in `users_self_select`, `users_self_update`, `team_members_self_select` policies to fix RLS initplan re-evaluation.
15. **Drop duplicate index** `ad_metrics_campaign_date_unique` (keep the `_key` variant as it was likely created by a UNIQUE constraint).

### P5 — Longer-horizon gaps (needed before scale, not before launch)

16. **IG-DM outbound function** — inbound works, outbound does not exist.
17. **Agent pause/resume edge function** — Operations workspace has no control surface.
18. **Recurring billing mechanism** — required before month 2 of any retainer client.
19. **Backup/DR review** — confirm PITR is enabled in Supabase project settings; document RTO/RPO.
20. **Monitoring / cron-failure alerting** — pg_cron failures are silent externally; wire to Telegram bot or similar.

---

*End of reconciliation report. No schema or code changes were made during this introspection pass.*
