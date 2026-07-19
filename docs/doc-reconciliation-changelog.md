# Documentation Reconciliation Changelog

**Date:** 2026-06-21  
**Source of truth:** `docs/reconciliation-report.md` (read-only Supabase MCP introspection)  
**Pass type:** Documentation-only — no code, migrations, edge functions, or database changes.

---

## Files edited

### 1. `attract-acquisition-backend.md` v1.1 → v1.2

| Section | Change |
|---|---|
| Header | Version bump |
| §1.1 | Historical reconciliation superseded; current approved production ref is `xivewedajschthjlblfb`. |
| §1.2 header | 18 tables → 19 tables |
| §1.2 monetary note | Added: all money stored in cents (`amount_cents`, `mrr_cents`, `spend_cents`, `daily_budget_cents`) |
| §1.2 `entities` | `name`→`business_name`; `phone`→`contact_phone`; `client_slug`→`slug` (citext); `metadata`→`notes_signals`; added `contact_name`, `contact_email`, `city`; removed `ig_handle`, `source`, `channel`, `owner_id` (NOT in live) |
| §1.2 `messages` | Removed `entity_id`, `channel`, `status`, `external_id`; added `media_url`, `sent_at`; added NOTE: entity join is via conversations, not direct |
| §1.2 `campaigns` | `meta_campaign_id`→`external_id`; `budget`→`daily_budget_cents`; added `platform`, `started_at`, `ended_at` |
| §1.2 `ad_metrics` | `captured_at`→`metric_date`; `spend`→`spend_cents`; added `conversions`; removed `ctr`, `cpa` (derived, not stored) |
| §1.2 `payments` | `payfast_ref`→`external_ref`; `amount`→`amount_cents`; `type`→`tier`; added `currency` |
| §1.2 `contracts` | `mrr_amount`→`mrr_cents`; `doc_url`→`document_url`; `start_date`→`starts_at`; `end_date`→`ends_at`; added `signed_at`, `updated_at` |
| §1.2 `triage_items` | Removed `type`, `score`, `suggested_action`, `suggested_reply`; added `title`, `detail`, `assigned_to`, `resolved_at`; added ⚠️ OPEN QUESTION block on score/suggested_reply schema gap |
| §1.2 `agent_events` | `action`→`event_type` |
| §1.2 `automations` | `type`→`name`+`trigger_type`; `workflow_id`→`external_id`; `state`→`status`; `started_at`→`last_run_at`; added `platform`, `config`; removed `step`, `retries` (NOT in live) |
| §1.2 `assets` | `type`→`kind`; `name`→`title`; added `metadata` jsonb; removed `created_by` (NOT in live) |
| §1.2 `briefs` | Collapsed `archetype/hook/storyboard/caption/asset_id/created_by` into `title`, `body`, `ref_code` |
| §1.2 `proof_uploads` | `job_tag`→`phase`; added `caption`; removed `metadata`, `captured_by` (NOT in live) |
| §1.2 `pulse_metrics` | `metric`→`metric_key`; `value`→`metric_value`; `period/captured_at`→`metric_date`; removed `scope` |
| §1.2 `users` | Added `full_name`, `updated_at` |
| §1.2 `team_members` | `entity_id`→`client_entity_id`; added `team_id`; removed `display_name`, `rate`, `status` |
| §1.2 `audit_log` | `id` now bigint (not uuid); separate `before/after` columns removed; collapsed into `metadata` jsonb; `actor` text type removed (not stored) |
| §1.2 `credential_registry` | Added as table 19: `(id, client_slug, service, credential_type, vault_name, created_at)`; note on PayFast key gap and n8n webhook pattern |
| §1.3 | `360dialog-send` → `dialog360-send` in stage transition table |
| §1.4 | `proof` bucket → `proof-uploads`; added file-size limits and MIME allow-lists for all 3 buckets |
| §1.5 | Full rewrite: confirmed `_GLOBAL_` prefix convention; listed 6 current vault secrets; documented `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` exception; added PayFast key gap note; added `vaultName()`/`readCredential()` helper reference |
| §1.6 | Removed `get_my_*()` naming caveat entirely; confirmed `auth_role()`, `auth_entity_ids()`, `auth_team_id()` as STABLE SECURITY DEFINER; documented all 19 tables RLS enabled; added `app_role` and `entity_kind` enum values; documented live policy pattern (select + staff_write ALL pattern + known double-SELECT perf issue) |
| §2 all functions | Added `verify_jwt` flag to every function entry; `dialog360-send/webhook` (`verify_jwt=false` on webhook; `true` on send) |
| §3 agents | OpenClaw: `GPT-4.1 mini` → `gpt-5.4-mini`; Claude Content: `Claude Sonnet` → `claude-sonnet-4-6`; added Haiku note for `lead-score` |
| §4 external services | `360dialog` row: `360dialog-send/webhook` → `dialog360-send/webhook` |
| §5 schedules | `360dialog-webhook` → `dialog360-webhook`; added `verify_jwt` annotations; updated PayFast ITN note (verify_jwt mismatch + vault key gap) |
| §7 flows | `360dialog-send` → `dialog360-send` in flows 2, 7; `proof` → `proof-uploads` in flow 5; `payfast_ref` → `external_ref` in flow 3 |
| §8 open items | Items 1–7 updated with live-confirmed status; item 8 (naming) marked RESOLVED; added new item 9 (security advisor findings: anon EXECUTE, leaked-password, double-SELECT RLS, initplan re-evaluation) |

---

### 2. `attract-acquisition-frontend_1.md` v1.1 → v1.2

| Section | Change |
|---|---|
| Header | Version bump |
| §1.4 | Removed "never hardcode project ref (see open items)" — ref confirmed; env-var rule kept |
| §2.1 Triage queue | Added ⚠️ OPEN QUESTION: `score` and `suggested_reply` do not exist in live `triage_items`; listed actual live columns; flagged do-not-render until schema resolved |
| §2.1 Actions | `360dialog-send` → `dialog360-send` |
| §2.3 Actions | `360dialog-send` → `dialog360-send`; `dialog360-webhook` in ◻ list; added message query-path note (join via conversations, not direct entity_id) |
| §2.3 Connections | `360dialog-send/webhook` → `dialog360-send/webhook` |
| §2.5 Studio Actions | `360dialog-send` → `dialog360-send` |
| §4 call reference | `360dialog-send` → `dialog360-send` in invoke table; `360dialog-webhook` → `dialog360-webhook` in surfaced list |
| §5 open items | Item 5 (project ref) changed to RESOLVED; added new item 7 (triage schema gap cross-reference) |

---

### 3. `attract-acquisition-system-map_1.md` v1.1 → v1.2

| Section | Change |
|---|---|
| Header | Version bump |
| §03 table count | 18 → 19; added `credential_registry` to table list |
| §03 storage | Added bucket slugs in parens: `mjrs`, `reels`, `proof-uploads` |
| §03 vault | Updated convention description to `_GLOBAL_` prefix pattern |
| §04 edge functions list | `360dialog-send` → `dialog360-send`; `360dialog-webhook` → `dialog360-webhook` |
| Conversations workspace | `360dialog-send/webhook` → `dialog360-send/webhook` |
| Stage 3 Contacted | `360dialog-send/webhook` → `dialog360-send/webhook` in primary systems and Edge list |
| Stage 4 Engaged | `360dialog-webhook` → `dialog360-webhook` |
| Stage 5 Booked | `360dialog-send` → `dialog360-send` |
| Stage 8 Delivering | `360dialog-send` → `dialog360-send` |
| Reverse lookup — edge functions | `360dialog-send/webhook` rows renamed to `dialog360-send/webhook` |
| Reverse lookup — agents | OpenClaw: `GPT-4.1 mini` → `gpt-5.4-mini`; Claude Content: `Claude Sonnet` → `claude-sonnet-4-6` |
| Open items | Item 1 (project ref): RESOLVED; item 2 (billing): STILL OPEN; added item 3 (PayFast ITN P0); items 3–5 renumbered 4–6 |
| Reconciliation notes | Added v1.1→v1.2 section summarising all changes |

---

### 4. `CLAUDE.md` (root) — no version line; updated in-place

| Section | Change |
|---|---|
| Backend — table count | 18 → 19 tables; added `credential_registry` to list |
| Architecture rules — RLS | `auth_admin` → `auth_team_id()` (was wrong); updated to confirmed names with STABLE SECURITY DEFINER note; added "all 19 tables" |
| Open items | Expanded from 3 to 5 items: added PayFast ITN P0 as item 1; added security audit findings as item 5 |

---

### 5. `Application Surfaces/Cockpit/CLAUDE.md` — updated in-place

| Section | Change |
|---|---|
| Data layer — project ref | Current approved production ref: `xivewedajschthjlblfb` |
| Data layer — table count | 18 → 19; added `credential_registry` |
| Data layer — storage | Added bucket slugs: `mjrs`, `reels`, `proof-uploads` |
| Data layer — vault | Updated convention to `_GLOBAL_` prefix; added `vaultName()`/`readCredential()` helpers |
| Edge functions — invoke list | `360dialog-send` → `dialog360-send` |
| Edge functions — background list | `360dialog-webhook` → `dialog360-webhook` |
| Open items | Item 1 (project ref): RESOLVED; added item 2 (PayFast ITN P0); renumbered; added item 7 (security findings) |

---

## What was NOT changed

- No code, edge functions, `.env` files, or SQL migrations touched
- All open questions explicitly left open (triage score/suggested_reply schema, backup/DR, recurring billing, IG-DM outbound, agent control, refund/cancellation)
- The `reconciliation-report.md` source document was not modified
- Existing doc structure, notation (▶/◻/⛔/⟳), and prose style preserved throughout
