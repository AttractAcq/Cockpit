# AA-OS Gate Validation Report
**Date**: 2026-06-11  
**Project ref confirmed**: `xivewedajschthjlblfb` ("Cockpit") — approved production project
**Phases covered**: Phase 1 (Backend & Data) + Phase 2 (AI & Automation)  
**Validator**: Claude Code automated gate pass (read-only + TEST_GATE_ synthetic data only)

---

## STEP 0 — INVENTORY

### Project Ref

| Ref | Name | Status |
|-----|------|--------|
| `xivewedajschthjlblfb` | Cockpit | **ACTIVE_HEALTHY** ← canonical |
| `ayfidvycgqorxmlczyxl` | Attract Acquisition | INACTIVE (legacy) |
| `ytixityazjuurkloeqli` | AA Ops | INACTIVE (legacy) |

Confirmed canonical via `.env` (`VITE_SUPABASE_URL`) and `src/types/common.ts` comment.

### Tables: 19 found vs 18 expected — PASS (+1 intentional extra)

All 18 expected tables present with RLS enabled:

`entities` `conversations` `messages` `campaigns` `ad_metrics` `payments` `contracts` `triage_items` `agent_events` `automations` `assets` `briefs` `proof_uploads` `pulse_metrics` `mrr_snapshots` `users` `team_members` `audit_log`

Extra table: **`credential_registry`** (intentional — maps service credentials to vault names; has RLS, admin-only).

### Pipeline Enum: PASS

`entities.stage` enum `pipeline_stage` — **8 stages confirmed in order**:  
`source` → `cold` → `contacted` → `engaged` → `booked` → `onboarding` → `active` → `delivering`

### Edge Functions: 16 deployed vs 15 expected — PASS (+1 bonus, 1 naming delta)

| Expected | Deployed | Status | Notes |
|----------|----------|--------|-------|
| audit-log | audit-log | ACTIVE ✓ | |
| lead-score | lead-score | ACTIVE ✓ | |
| apify-scrape | apify-scrape | ACTIVE ✓ | |
| aicos-act | aicos-act | ACTIVE ✓ | |
| mjr-generate | mjr-generate | ACTIVE ✓ | |
| brief-generator | brief-generator | ACTIVE ✓ | |
| 360dialog-send | **dialog360-send** | ACTIVE ✓ | Slug can't start with digit |
| 360dialog-webhook | **dialog360-webhook** | ACTIVE ✓ | Slug can't start with digit |
| meta-webhook | meta-webhook | ACTIVE ✓ | verify_jwt=false ✓ |
| meta-ad-ops | meta-ad-ops | ACTIVE ✓ | |
| campaign-flag | campaign-flag | ACTIVE ✓ | |
| proof-capture | proof-capture | ACTIVE ✓ | |
| client-portal-sync | client-portal-sync | ACTIVE ✓ | |
| onboarding | onboarding | ACTIVE ✓ | |
| mrr-calc | mrr-calc | ACTIVE ✓ | |
| *(extra)* | **public-lead-capture** | ACTIVE ✓ | Content-engine bonus fn |

---

## TEST 1 — RLS ISOLATION

**Method**: SQL role simulation — `SET LOCAL ROLE authenticated` + `SET LOCAL "request.jwt.claims"` — identical to what PostgREST does on JWT arrival. Three simulated identities: client_a, client_b, distribution.

### Client A vs Client B cross-isolation

| Query | client_a sees | client_b sees | Result |
|-------|--------------|--------------|--------|
| Own entity | 1 | 1 | ✓ PASS |
| Other's entity | 0 | 0 | ✓ PASS |
| Other's asset | 0 | 0 | ✓ PASS |
| Other's payments | 0 | 0 | ✓ PASS |
| Other's contracts | 0 | 0 | ✓ PASS |
| Other's briefs | 0 | 0 | ✓ PASS |
| Other's proof_uploads | 0 | 0 | ✓ PASS |
| Other's pulse_metrics | 0 | 0 | ✓ PASS |
| Other's conversations | 0 | 0 | ✓ PASS |
| total test entities visible | 1 | 1 | ✓ PASS |
| mrr_snapshots | 0 | 0 | ✓ PASS (client-blocked) |
| audit_log | 0 | 0 | ✓ PASS (client-blocked) |
| agent_events | 0 | 0 | ✓ PASS (client-blocked) |

### Distribution role spot-check

| Table | distribution sees | Expected | Result |
|-------|-----------------|----------|--------|
| entities (all) | 11 | all | ✓ PASS |
| conversations | 1 | all | ✓ PASS |
| triage_items | 1 | all | ✓ PASS |
| agent_events | 3 | all | ✓ PASS |
| mrr_snapshots | 1 | yes | ✓ PASS |
| **payments** | **1** | **blocked** | **✗ FAIL** |
| audit_log | 0 | blocked | ✓ PASS |

**FAIL detail**: `payments_select` policy uses `auth_entity_ids()` which returns ALL entity IDs for admin/distribution/delivery roles. Distribution can therefore read all payments rows. Gate spec requires distribution cannot read payments.

### Vault access by non-service user

```
ERROR: 42501: permission denied for schema vault
```
✓ **PASS** — authenticated role is fully blocked from `vault` schema.

### TEST 1 VERDICT: **FAIL** — one RLS policy gap (distribution reads payments)

---

## TEST 2 — VAULT & SECRET HYGIENE

### Vault contents

```sql
SELECT name FROM vault.secrets; -- returns 0 rows
```

**FAIL — CRITICAL**: Vault is empty. All 6 `credential_registry` entries reference secrets that do not exist:

| vault_name | Status |
|-----------|--------|
| `_GLOBAL_ANTHROPIC_API_KEY` | ✗ MISSING |
| `_GLOBAL_APIFY_API_TOKEN` | ✗ MISSING |
| `_GLOBAL_META_SYSTEM_USER_TOKEN` | ✗ MISSING |
| `_GLOBAL_OPENAI_API_KEY` | ✗ MISSING |
| `_GLOBAL_PAYFAST_MERCHANT_KEY` | ✗ MISSING |
| `_GLOBAL_TELEGRAM_BOT_TOKEN` | ✗ MISSING |
| `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` | ✗ MISSING (referenced by `cron_invoke_function`, not in credential_registry) |

Root cause cascade: empty vault → `cron_invoke_function` retrieves NULL key → all pg_cron-triggered functions return 401 → all AI functions run in stub mode.

### Secret naming convention

`credential_registry` entries follow `{CLIENT_SLUG_UPPER}_{SERVICE_UPPER}_{CREDENTIAL_TYPE_UPPER}`. All 6 entries comply. ✓ PASS

**Note**: `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` in `cron_invoke_function` uses a different pattern (no leading `_`) and is absent from `credential_registry`. Should be added and standardised.

### Vault read as non-service user

```
ERROR: 42501: permission denied for schema vault
```
✓ **PASS**

### Hardcoded secrets in repo

Grep for `eyJ…` JWTs, `sk-…`, `service_role`, committed `.env` secrets across all `.ts/.tsx/.js/.json` source files:

- `.env` contains `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — anon key is public by design ✓
- `.env.example` contains only placeholder strings ✓
- No service_role key, no API keys, no sk-… strings in any source file ✓

**PASS**

### Storage buckets

| Bucket | Public | Result |
|--------|--------|--------|
| `mjrs` | false | ✓ private |
| `proof-uploads` | false | ✓ private |
| `reels` | false | ✓ private |

Unsigned fetch against `mjrs` bucket: `HTTP 400/403` — access blocked ✓ PASS  
Anon upload attempt: `403 Unauthorized: permission denied for function auth_entity_ids` ✓ PASS  
Anon signed-URL request: `403 Unauthorized: permission denied for function auth_role` ✓ PASS

All three storage buckets correctly deny unauthenticated access.

### Security advisors (flagged by Supabase linter)

| Finding | Level | Detail |
|---------|-------|--------|
| `trg_lead_score_before` callable by anon | WARN | SECURITY DEFINER trigger function exposed to anon via REST |
| `trg_lead_score_after` callable by anon | WARN | Same — anon can call via `/rest/v1/rpc/trg_lead_score_after` |
| `compute_icp_score` mutable search_path | WARN | Missing `SET search_path = public` |
| Leaked password protection disabled | WARN | HaveIBeenPwned check not enabled |

### TEST 2 VERDICT: **FAIL** — vault is empty (root cause of all downstream stubs and 401s)

---

## TEST 3 — INGESTION CHAIN

### Apify leg

**BLOCKED-external**: No Apify API token in vault. Apify account not provisioned.  
Probe substituted: synthetic `TEST_GATE_LeadScore_Probe` entity inserted at `stage='source'`.

### Lead-score pipeline (DB trigger chain)

Entity inserted: `kind=prospect`, `stage=source`, `niche=roofing`, `city=Cape Town`, `notes_signals={owner_operated:true, has_website:true, review_count:45}`

**BEFORE trigger** (`trg_lead_score_before`):
```
compute_icp_score: 40 base + 30 (roofing) + 18 (Cape Town) + 12 (owner_operated) + 4 (has_website) + 6 (review_count 5–150) = 110 → capped at 100
stage: source → cold (score 100 ≥ threshold 65)
```
✓ **PASS** — score computed, stage advanced

**AFTER trigger** (`trg_lead_score_after`):
```
agent_events: agent=lead-score, event_type=icp_scored, status=processed, payload={score:100, threshold:65}
triage_items: source=agent, priority=high (score ≥ 85), status=open, title="New qualified lead: TEST_GATE_LeadScore_Probe"
```
✓ **PASS** — agent_event and triage_item written with no manual intervention

### Inbound reply → aicos-act (via dialog360-webhook)

Test payload: 360dialog-format inbound message from `+27600000001`

```
POST /functions/v1/dialog360-webhook → HTTP 200 {"ok":true,"processed":1}
```

Downstream DB writes (no manual action):
- `conversations`: 1 created ✓
- `messages`: 1 created ✓
- `agent_events`: agent=openclaw, event_type=score_reply, status=processed, payload={score:0.7, band:"hot", auto_sent:false, suggested_reply:"Thanks for getting back to us! Are you free for a quick 10-min call this week to walk through it?"} ✓
- `triage_items`: priority=high, title="Inbound scored hot (0.70)" ✓
- `audit_log`: `whatsapp_inbound` + `aicos_score_reply` entries ✓

`stub:true` in all AI payloads — correct degraded behaviour when vault is empty (templates used, no Claude/OpenAI call made).

### TEST 3 VERDICT: **PASS** (Apify leg BLOCKED-external; all DB writes + trigger chains confirmed)

---

## TEST 4 — AGENTS ON SCHEDULE

### Apify Scraper

- pg_cron job: `aa-apify-scrape-daily`, schedule `0 1 * * *` (01:00 UTC = **03:00 SAST** ✓)
- Last invocation evidence: edge-function log entry `POST 401` at `2026-06-11T11:36:04` (within 24h)
- Failure reason: `cron_invoke_function` reads `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` from vault → NULL → 401

**BLOCKED-external** (no Apify account) + **FAIL-auth** (cron key not in vault)

### aicos-act (OpenClaw)

Event-driven, triggered by `dialog360-webhook`. ✓ **PASS** — proven by Test 3.

### n8n

- `automations` table: 0 rows
- pg_cron: no n8n-related jobs
- No n8n URL or workflow references anywhere in codebase or database

**FAIL** — n8n instance is not provisioned or registered. Onboarding workflow and outreach sequences cannot be verified.

### MetaSync (campaign-flag)

- pg_cron job: `aa-campaign-flag-hourly`, schedule `0 * * * *` (every hour ✓)
- Last-run evidence: **24 consecutive hourly invocations** in edge-function logs (all `POST 401`)
- Timestamps span from `~2026-06-10T12:00` to `2026-06-11T12:00` — confirms hourly cadence active

**BLOCKED-external** (no live Meta BM token) + **FAIL-auth** (cron key not in vault)

### mrr-calc

- pg_cron job: `aa-mrr-calc-daily`, schedule `30 1 * * *` (01:30 UTC daily ✓)
- Edge-function log: one `POST 401` invocation visible in 24h window

**FAIL-auth** (cron key not in vault)

### Claude Content (brief-generator)

```
POST /functions/v1/brief-generator {entity_id: "aa000000-...", title: "TEST_GATE_Brief_Probe"}
→ HTTP 200 {"ok":true,"stub":true,"brief_id":"977eb74f-...","needs_approval":true}
```

- Brief row written to `briefs` table ✓
- `agent_events` entry: agent=claude-content, event_type=brief_generated, status=processed ✓
- `stub:true` — no Anthropic API key in vault; template-based brief generated instead

**PARTIAL PASS** — deployment, routing, and DB writes confirmed; AI generation blocked by vault.

### TEST 4 VERDICT: **FAIL** — n8n absent; all cron-triggered functions fail auth (root cause: vault empty)

---

## TEST 5 — AUDIT COVERAGE

### Audit trigger inventory

| Table | Has DB trigger | Edge-fn logs | Result |
|-------|---------------|-------------|--------|
| entities | ✓ trg_audit_entities | — | ✓ covered |
| team_members | ✓ trg_audit_team | — | ✓ covered |
| contracts | ✓ trg_audit_contracts | — | ✓ covered |
| payments | ✓ trg_audit_payments | — | ✓ covered |
| messages | ✗ | whatsapp_inbound | ✓ covered (via fn) |
| triage_items | ✗ | aicos_score_reply | ✓ covered (via fn) |
| briefs | ✗ | brief_generate | ✓ covered (via fn) |
| **assets** | **✗** | **none seen** | **✗ GAP** |
| **conversations** | **✗** | **none seen** | **✗ GAP** |
| users | ✗ | none | ✗ GAP |
| campaigns | ✗ | none | ✗ GAP |
| ad_metrics | ✗ | none | ✗ GAP |
| proof_uploads | ✗ | none | ✗ GAP |
| pulse_metrics | ✗ | none | ✗ GAP |
| mrr_snapshots | ✗ | none | ✗ GAP |
| automations | ✗ | none | ✗ GAP |
| agent_events | ✗ | (they are the audit trail) | acceptable |

### Mutations performed during this gate pass

| Mutation | audit_log entry | agent_events entry | Covered? |
|----------|----------------|-------------------|---------|
| INSERT entities (TEST_GATE_Business_A/B) | `INSERT/entities` ✓ | lead-score icp_scored ✓ | ✓ |
| INSERT entities (TEST_GATE_LeadScore_Probe) | `INSERT/entities` ✓ | lead-score icp_scored ✓ | ✓ |
| INSERT team_members (test users) | `INSERT/team_members` ✓ | — | ✓ |
| DELETE team_members (cleanup) | `DELETE/team_members` ✓ | — | ✓ |
| INSERT assets (TEST_GATE_Asset_A/B) | **none** | **none** | **✗ UNTRACED** |
| INSERT conversations (via webhook) | **none** | — | **✗ UNTRACED** |
| INSERT messages (via webhook) | `whatsapp_inbound` ✓ | — | ✓ |
| INSERT triage_items (lead-score trigger) | — | `icp_scored` ✓ | ✓ |
| INSERT triage_items (aicos-act) | `aicos_score_reply` ✓ | `score_reply` ✓ | ✓ |
| INSERT briefs (brief-generator) | `brief_generate` ✓ | `brief_generated` ✓ | ✓ |

**Untraced mutations**: `assets` INSERT and `conversations` INSERT leave no audit_log or agent_events entry.

### TEST 5 VERDICT: **FAIL** — assets and conversations writes are untraced

---

## SUMMARY TABLE

| Test | Verdict | Key Evidence |
|------|---------|-------------|
| STEP 0 — Inventory | **PASS** | 18/18 tables ✓, 8 stages ✓, 16 edge fns ✓ |
| TEST 1 — RLS Isolation | **FAIL** | Distribution reads payments (policy uses auth_entity_ids) |
| TEST 2 — Vault & Secrets | **FAIL** | vault.secrets = 0 rows; 7 secrets missing |
| TEST 3 — Ingestion Chain | **PASS** | Score 100, stage advanced, triage+events written; Apify BLOCKED-external |
| TEST 4 — Agents on Schedule | **FAIL** | n8n absent; cron 401s (cron key not in vault) |
| TEST 5 — Audit Coverage | **FAIL** | assets and conversations untraced |

---

## PHASE VERDICTS

### Phase 1 — Backend & Data: 🔴 RED

Three structural failures block go-live:
1. RLS policy gap (distribution reads payments)
2. Vault empty (cascades to all external integrations)
3. Audit gaps on assets and conversations

Schema, enum, functions deployed, and client-isolation are solid. This phase goes **GREEN** as soon as items 1, 2, and 3 in the fix list below are resolved.

### Phase 2 — AI & Automation: 🔴 RED

Two independent failures:
1. Vault empty — all AI functions (Claude, OpenAI, Apify, Meta) fall back to stub mode; all pg_cron invocations return 401
2. n8n not provisioned — onboarding and outreach sequences cannot be verified

External blockers (360dialog BSP, Meta BM verification, PayFast ITN) are **BLOCKED-external** and do not affect the verdict. Webhook endpoints exist, respond correctly, and handle the BLOCKED-external legs gracefully (auto_sent=false, stub content).

Once vault is populated and n8n is provisioned, Phase 2 should flip to **GREEN-with-external-blocks**.

---

## ORDERED FIX LIST

### FIX 1 — Populate vault (unlocks all cron + all AI) — HIGHEST IMPACT

Add these 7 secrets to `vault.secrets` (names only listed here; add values via Supabase Dashboard → Vault):

```
GLOBAL_SUPABASE_SERVICE_ROLE_KEY   ← cron_invoke_function uses this; add to credential_registry too
_GLOBAL_ANTHROPIC_API_KEY
_GLOBAL_APIFY_API_TOKEN
_GLOBAL_META_SYSTEM_USER_TOKEN
_GLOBAL_OPENAI_API_KEY
_GLOBAL_PAYFAST_MERCHANT_KEY
_GLOBAL_TELEGRAM_BOT_TOKEN
```

Also: add `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` to `credential_registry` with `client_slug='_global'`, `service='supabase'`, `credential_type='service_role_key'` and correct the vault_name to `_GLOBAL_SUPABASE_SERVICE_ROLE_KEY` (add leading `_` to match convention, then update the function).

**Re-run**: After adding, run `SELECT public.cron_invoke_function('campaign-flag')` and confirm the next edge-function log entry is 200, not 401.

---

### FIX 2 — Payments RLS: block distribution SELECT

The `payments_select` policy currently allows distribution to read all payments via `auth_entity_ids()`. Restrict to admin only (or add a separate admin-only policy):

```sql
-- In a migration:
DROP POLICY IF EXISTS payments_select ON public.payments;

CREATE POLICY payments_select ON public.payments
  FOR SELECT USING (
    auth_role() IN ('admin') 
    OR entity_id IN (SELECT auth_entity_ids())  -- clients only see own
  );
```

**Re-run**: Repeat the distribution RLS spot-check query — `payments_visible` must return 0.

---

### FIX 3 — Audit triggers for assets and conversations

```sql
-- Migration: add audit triggers to cover the two gaps
CREATE OR REPLACE FUNCTION public.trg_audit_generic()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.audit_log(action, table_name, record_id)
  VALUES (TG_OP, TG_TABLE_NAME, (CASE TG_OP WHEN 'DELETE' THEN OLD.id::text ELSE NEW.id::text END));
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_assets
  AFTER INSERT OR UPDATE OR DELETE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_generic();

CREATE TRIGGER trg_audit_conversations
  AFTER INSERT OR UPDATE OR DELETE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_generic();
```

**Re-run**: Insert one TEST_GATE_ asset + conversation, confirm `audit_log` has matching rows, delete.

---

### FIX 4 — Provision n8n and register workflows

1. Deploy n8n instance (self-hosted or cloud); store URL + API key in vault as `_GLOBAL_N8N_API_KEY`.
2. Import/create: onboarding workflow, cold-outreach sequence, follow-up sequence.
3. Register each workflow in `public.automations` with `platform='n8n'`, `trigger_type`, `external_id` (n8n workflow ID), `status='active'`.

**Re-run**: Confirm `SELECT count(*) FROM public.automations WHERE platform='n8n' AND status='active'` ≥ 2; trigger onboarding workflow against a TEST_GATE_ entity in dry-run mode and confirm the `automations.last_run_at` updates.

---

### FIX 5 — Security hardening (advisor items)

```sql
-- a) Revoke anon execute from trigger functions (they are triggers, not RPC endpoints)
REVOKE EXECUTE ON FUNCTION public.trg_lead_score_before() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_lead_score_after() FROM anon;

-- b) Fix mutable search_path on compute_icp_score
ALTER FUNCTION public.compute_icp_score(text, text, jsonb) SET search_path = public;
```

Enable leaked password protection: Supabase Dashboard → Auth → Password Security → enable HaveIBeenPwned check.

**Re-run**: `get_advisors` security — confirm the 4 findings are resolved.

---

## RE-RUN STEPS (after all fixes)

```sql
-- 1. Confirm vault populated
SELECT name FROM vault.secrets ORDER BY name;
-- Expected: 7 rows

-- 2. Confirm cron auth works
SELECT public.cron_invoke_function('campaign-flag');
-- Then check edge-function logs: expect 200, not 401

-- 3. Re-run RLS distribution payments check
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"<a-distribution-user-id>","role":"authenticated","iss":"supabase"}';
SELECT count(*) FROM public.payments; -- expect 0

-- 4. Re-run audit gap check
INSERT INTO public.assets (entity_id, kind, title, status)
  VALUES ('<any-entity-id>', 'creative', 'TEST_GATE_AuditFix', 'draft')
  RETURNING id;
-- Then: SELECT * FROM audit_log WHERE table_name='assets' ORDER BY created_at DESC LIMIT 1;
-- Expect 1 matching row; clean up

-- 5. Re-run brief-generator (after Anthropic key in vault)
-- POST /functions/v1/brief-generator {entity_id: "...", title: "..."}
-- Expect stub:false in response

-- 6. Confirm n8n workflows registered
SELECT name, platform, status FROM public.automations WHERE platform='n8n';
-- Expect ≥ 2 active rows

-- 7. Re-run security advisors
-- Supabase MCP: get_advisors(type='security')
-- Expect: 0 WARN items remaining
```

---

## EVIDENCE APPENDIX

### RLS simulation method
```sql
-- Executed as each identity (connection runs as service role but SET LOCAL ROLE
-- drops to authenticated, which is what PostgREST does with a user JWT):
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"<user-id>","role":"authenticated","iss":"supabase"}';
SELECT ... FROM public.entities WHERE id = '<other-entity-id>';  -- returns 0
```

### Lead-score trigger chain proof
```
INSERT entity (stage=source, niche=roofing, city=Cape Town) at 10:56:50 UTC
→ trg_lead_score_before fires: score=100, stage→cold
→ trg_lead_score_after fires: agent_events row (lead-score/icp_scored/processed)
→ trg_lead_score_after: triage_items row (high priority, "New qualified lead")
All confirmed by SELECT on entity + agent_events + triage_items with entity_id filter.
```

### cron_invoke_function (explains all 401s)
```sql
-- Source of the 401 cascade:
select decrypted_secret into v_key from vault.decrypted_secrets
  where name = 'GLOBAL_SUPABASE_SERVICE_ROLE_KEY';
-- vault is empty → v_key = NULL
-- Authorization: Bearer <empty> → 401
```

### Cleanup confirmation
All 10 tables checked — zero TEST_GATE_ artifacts remain post-cleanup.

---

# FIX PASS — 2026-06-12

Executed against the then-current project during the historical validation. Current production is `xivewedajschthjlblfb`. Three migrations applied; two n8n workflow files written. Fix 1 (vault secrets) remains human-only.

## Fix pass summary

| Fix | Scope | Migration | Status | Remaining human action |
|-----|-------|-----------|--------|----------------------|
| FIX 1 | Vault secrets | — | ⏳ PENDING | Add 7 secrets via Supabase Dashboard |
| FIX 2 | Payments RLS | `gate_fix_2_payments_rls` | ✅ DONE | None |
| FIX 3 | Audit triggers | `gate_fix_3_audit_assets_conversations` | ✅ DONE | None |
| FIX 4 | n8n scaffolding | n/a (JSON files written) | ✅ SCAFFOLDED | Deploy n8n host, import JSONs, register in `automations` |
| FIX 5a | Revoke anon EXECUTE | `gate_fix_5_security_hardening` | ✅ DONE | None |
| FIX 5b | search_path hardening | `gate_fix_5_security_hardening` | ✅ DONE | None |
| FIX 5c | HaveIBeenPwned toggle | — | ⏳ PENDING | Dashboard only (see below) |

---

## FIX 2 — Payments RLS

**Decision**: client role retains read on own rows (consistent with contracts, briefs, all other child tables).

### SQL applied (`gate_fix_2_payments_rls`)

```sql
DROP POLICY IF EXISTS payments_select ON public.payments;

-- Admin sees all payment rows
CREATE POLICY payments_admin_select ON public.payments
  FOR SELECT
  USING (auth_role() = 'admin');

-- Client sees only rows for their own linked entity
CREATE POLICY payments_client_select ON public.payments
  FOR SELECT
  USING (
    auth_role() = 'client'
    AND entity_id IN (SELECT auth_entity_ids())
  );
```

### Verification evidence

**Distribution role — payments visible after fix:**
```
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"f0000000-...","role":"authenticated","iss":"supabase"}';
SELECT count(*) FROM public.payments;
→ 0   ✓ (was 1 before fix)
```

**Client role — own vs. other payments:**
```
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a0000000-...","role":"authenticated","iss":"supabase"}';
SELECT
  (SELECT count(*) FROM public.payments WHERE entity_id = '<own>')   AS own_payment_visible,
  (SELECT count(*) FROM public.payments WHERE entity_id != '<own>')  AS other_payments_visible;
→ own_payment_visible=1, other_payments_visible=0   ✓
```

**Policies now on `payments`:**

| Policy | Command | Condition |
|--------|---------|-----------|
| `payments_admin_select` | SELECT | `auth_role() = 'admin'` |
| `payments_client_select` | SELECT | `auth_role() = 'client' AND entity_id IN (auth_entity_ids())` |
| `payments_staff_write` | ALL | `auth_role() IN ('admin','distribution')` (unchanged) |

**TEST_GATE_ data**: TEST_GATE_fix2client user + payment + team_member row created for test and fully deleted. Zero artifacts remain.

---

## FIX 3 — Audit triggers for assets and conversations

### SQL applied (`gate_fix_3_audit_assets_conversations`)

```sql
-- Mirrors existing pattern: AFTER INSERT OR DELETE OR UPDATE, FOR EACH ROW,
-- calling the shared log_audit() SECURITY DEFINER function.

CREATE TRIGGER trg_audit_assets
  AFTER INSERT OR DELETE OR UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER trg_audit_conversations
  AFTER INSERT OR DELETE OR UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION log_audit();
```

`log_audit()` is the existing shared function used by entities, team_members, contracts, payments. It inserts `(auth.uid(), tg_op, tg_table_name, coalesce(new.id::text, old.id::text), '{}')` into `audit_log`.

### Verification evidence

Test entity `cc000000-0000-0000-0099-000000000099` inserted. Then:

```sql
INSERT INTO public.assets (id, entity_id, kind, title, status)
VALUES ('ee000000-0000-0000-0099-000000000099', 'cc000000-...', 'creative', 'TEST_GATE_Fix3_Asset', 'draft');

INSERT INTO public.conversations (id, entity_id, channel, status)
VALUES ('dd000000-0000-0000-0099-000000000099', 'cc000000-...', 'whatsapp', 'open');

SELECT action, table_name, record_id FROM public.audit_log
WHERE record_id IN ('ee000000-0000-0000-0099-000000000099','dd000000-0000-0000-0099-000000000099');
```

**Result:**
```
action  | table_name    | record_id
--------+---------------+------------------------------------------
INSERT  | assets        | ee000000-0000-0000-0099-000000000099   ✓
INSERT  | conversations | dd000000-0000-0000-0099-000000000099   ✓
```

Both triggers fire correctly. **TEST_GATE_ data fully cleaned up** (entities=0, assets=0, conversations=0, users=0, auth_users=0 confirmed).

### Audit trigger coverage after fix

| Table | Covered | Method |
|-------|---------|--------|
| entities | ✓ | `trg_audit_entities` → `log_audit()` |
| team_members | ✓ | `trg_audit_team` → `log_audit()` |
| contracts | ✓ | `trg_audit_contracts` → `log_audit()` |
| payments | ✓ | `trg_audit_payments` → `log_audit()` |
| **assets** | **✓ NEW** | **`trg_audit_assets` → `log_audit()`** |
| **conversations** | **✓ NEW** | **`trg_audit_conversations` → `log_audit()`** |
| messages | ✓ | edge-fn `whatsapp_inbound` explicit insert |
| triage_items | ✓ | edge-fn `aicos_score_reply` explicit insert |
| briefs | ✓ | edge-fn `brief_generate` explicit insert |

---

## FIX 5 — Security hardening

### SQL applied (`gate_fix_5_security_hardening`)

```sql
-- 5a: Revoke anon EXECUTE on trigger functions
REVOKE EXECUTE ON FUNCTION public.trg_lead_score_before() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_lead_score_after() FROM anon;

-- 5b: Explicit search_path on compute_icp_score
ALTER FUNCTION public.compute_icp_score(text, text, jsonb)
  SET search_path = public;
```

### Verification evidence

```sql
SELECT proname, proconfig, array_to_string(proacl::text[], ',') AS acl
FROM pg_proc
WHERE proname IN ('trg_lead_score_before','trg_lead_score_after','compute_icp_score')
  AND pronamespace = 'public'::regnamespace;
```

**Result:**
```
proname                  | proconfig              | acl (anon presence)
-------------------------+------------------------+---------------------
compute_icp_score        | {search_path=public}   | anon=X/postgres (fine — not SECURITY DEFINER)
trg_lead_score_after     | {search_path=public}   | no anon entry   ✓
trg_lead_score_before    | {search_path=public}   | no anon entry   ✓
```

`anon` no longer has `EXECUTE` on either trigger function. `compute_icp_score` now has `search_path=public` hardened. The Supabase security advisors for these two findings will clear on next advisor refresh.

### FIX 5c — HaveIBeenPwned toggle (human-only)

**Location**: Supabase Dashboard → project `xivewedajschthjlblfb` → **Authentication** → **Providers** → **Email** → scroll to **"Password Security"** section → enable **"Check for leaked passwords (HaveIBeenPwned)"** toggle → Save.

This cannot be applied via SQL or MCP and requires a dashboard action.

---

## FIX 4 — n8n workflow scaffolding

Two importable n8n workflow JSON files written to `n8n/workflows/`:

### `onboarding_day1_7_checklist.json`

- **Trigger**: POST webhook at `/aa-onboarding` — called by the `onboarding` edge function when an entity enters the `onboarding` stage
- **Flow**: 18 nodes across 7 days
  - Day 1: welcome triage_item + agent_event logged
  - Day 2: fetch entity → check `notes_signals.meta_account_connected` → flag if missing
  - Day 3: fetch briefs → check for `status=approved` → flag if still draft
  - Day 5: performance-review triage_item
  - Day 7: `onboarding_7day_complete` agent_event → PATCH entity `stage → active`
- **Cadence**: 24h waits between days (Day 3→5 = 48h, Day 5→7 = 48h)
- All Supabase writes use `$env.SUPABASE_SERVICE_KEY` (set in n8n instance env vars)

### `outreach_cadence_5msg.json`

- **Trigger**: POST webhook at `/aa-outreach` — called for any entity entering the cold outreach queue
- **Flow**: 29 nodes, 5 messages over 24 days max

| Msg | Template | Wait before check | On reply |
|-----|----------|-------------------|---------|
| 1 | `cold_outreach_1` | 3 days | advance to `engaged` → end ✓ |
| 2 | `cold_followup_1` | 4 days | advance to `engaged` → end ✓ |
| 3 | `cold_followup_2_checkin` | 7 days | advance to `engaged` → end ✓ |
| 4 | `cold_followup_3_still_interested` | 7 days | advance to `engaged` → end ✓ |
| 5 | `cold_breakup` | 3 days | advance to `engaged` → end ✓ |
| — | dead-letter | — | agent_event `outreach_exhausted` + triage_item + PATCH `stage → source` |

- Reply detection: GET `/rest/v1/messages?direction=eq.inbound` for the entity's conversations
- Dead-letter branch returns entity to `source` stage for future re-entry

### To activate (human steps)

1. Deploy an n8n instance (self-hosted Docker or n8n Cloud)
2. Set environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
3. Import both JSON files via **n8n → Workflows → Import from file**
4. Activate each workflow; copy the generated webhook URLs
5. Set the outreach webhook URL as `N8N_OUTREACH_WEBHOOK` in edge function env (or vault)
6. Register both workflows in `public.automations`:

```sql
INSERT INTO public.automations (name, platform, trigger_type, status, config)
VALUES
  ('Onboarding Day 1–7 Checklist',    'n8n', 'webhook', 'active',
   '{"webhook_path": "/aa-onboarding", "days": 7}'::jsonb),
  ('5-Message Cold Outreach Cadence', 'n8n', 'webhook', 'active',
   '{"webhook_path": "/aa-outreach", "messages": 5, "total_days": 24}'::jsonb);
```

---

## Revised phase verdicts post-fix pass

| Phase | Was | Now | Remaining blocker |
|-------|-----|-----|-------------------|
| Phase 1 — Backend & Data | 🔴 RED | 🟡 **AMBER** | FIX 1 (vault secrets) + FIX 5c (Auth toggle) |
| Phase 2 — AI & Automation | 🔴 RED | 🟡 **AMBER** | FIX 1 (vault → unblocks all cron + AI) + n8n deployment |

**GREEN condition for Phase 1**: Populate vault (7 secrets) + enable HaveIBeenPwned toggle.  
**GREEN condition for Phase 2**: Vault populated + n8n deployed + workflows imported + `automations` table populated.

All structural code FAILs from the validation pass are now resolved. The remaining blockers are **operational/credential tasks** that require dashboard access or infrastructure provisioning — no further SQL or code changes needed.
