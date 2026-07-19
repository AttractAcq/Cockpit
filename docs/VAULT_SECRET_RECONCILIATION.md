# Vault Secret Reconciliation

Audit date: 2026-06-13  
Project ref: `xivewedajschthjlblfb`
Scope: repo files, n8n workflow files, deployed Supabase Edge Function source downloaded read-only to `/private/tmp/aa-os-functions-audit`, live Supabase Vault/function env metadata, and live database functions/credential registry. Names only; no secret values were printed.

## Supabase Inventory

### Vault

`vault.secrets` / `vault.decrypted_secrets` names: none. The live query returned 0 rows.

### Edge Function Env / Project Secrets

| Store | Name |
|---|---|
| Function env | `SUPABASE_ANON_KEY` |
| Function env | `SUPABASE_DB_URL` |
| Function env | `SUPABASE_JWKS` |
| Function env | `SUPABASE_PUBLISHABLE_KEYS` |
| Function env | `SUPABASE_SECRET_KEYS` |
| Function env | `SUPABASE_SERVICE_ROLE_KEY` |
| Function env | `SUPABASE_URL` |

## Code Reads Found

### Fixed Vault Names

| Expected name | Read by (function/file) | Exists in Supabase? | Status |
|---|---|---|---|
| `_GLOBAL_ANTHROPIC_API_KEY` | `brief-generator` `Deno.serve` via `readCredential(sb, "_global", "anthropic", "api_key")`, deployed `supabase/functions/brief-generator/index.ts:18`; `mjr-generate` `Deno.serve`, deployed `supabase/functions/mjr-generate/index.ts:18`; registry row in `credential_registry` | NO | ❌ MISSING |
| `_GLOBAL_APIFY_API_TOKEN` | `apify-scrape` `Deno.serve` via `readCredential(sb, "_global", "apify", "api_token")`, deployed `supabase/functions/apify-scrape/index.ts:25`; registry row in `credential_registry` | NO | ❌ MISSING |
| `_GLOBAL_META_SYSTEM_USER_TOKEN` | `meta-ad-ops` `Deno.serve` fallback via `readCredential(sb, "_global", "meta", "system_user_token")`, deployed `supabase/functions/meta-ad-ops/index.ts:9`; registry row in `credential_registry` | NO | ❌ MISSING |
| `_GLOBAL_OPENAI_API_KEY` | `aicos-act` `Deno.serve` via `readCredential(sb, "_global", "openai", "api_key")`, deployed `supabase/functions/aicos-act/index.ts:26`; `lead-score` `Deno.serve`, deployed `supabase/functions/lead-score/index.ts:12`; registry row in `credential_registry` | NO | ❌ MISSING |
| `_GLOBAL_PAYFAST_MERCHANT_KEY` | registry row in `credential_registry`; no direct deployed code read found | NO | ❌ MISSING |
| `_GLOBAL_TELEGRAM_BOT_TOKEN` | registry row in `credential_registry`; no direct deployed code read found | NO | ❌ MISSING |
| `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` | live DB function `public.cron_invoke_function`; corroborated in `GATE_VALIDATION_REPORT.md:512` | Function env has near-name `SUPABASE_SERVICE_ROLE_KEY`; Vault has none | ⚠️ MISMATCH: code reads Vault key `GLOBAL_SUPABASE_SERVICE_ROLE_KEY`, but Supabase env contains `SUPABASE_SERVICE_ROLE_KEY`; gate report recommends convention name `_GLOBAL_SUPABASE_SERVICE_ROLE_KEY` |

### Dynamic Vault Name Patterns

These are per-client templates, not fixed names to paste without a concrete client slug.

| Expected pattern | Literal parts | Read by (function/file) | Exists in Supabase? | Status |
|---|---|---|---|---|
| `${norm(client_slug)}_DIALOG360_BSP_KEY` | service `dialog360`, credential type `bsp_key` | `dialog360-send` `Deno.serve` via `readCredential(sb, client_slug, "dialog360", "bsp_key")`, deployed `supabase/functions/dialog360-send/index.ts:10` | NO | ❌ MISSING for any concrete client slug; dynamic pattern |
| `${norm(client_slug)}_META_ACCESS_TOKEN` | service `meta`, credential type `access_token` | `meta-ad-ops` `Deno.serve` via `readCredential(sb, client_slug, "meta", "access_token")`, deployed `supabase/functions/meta-ad-ops/index.ts:9` | NO | ❌ MISSING for any concrete client slug; dynamic pattern |
| `${norm(clientSlug)}_${norm(service)}_${norm(credentialType)}` | generic helper template | `vaultName()` helper, deployed `supabase/functions/_shared/aa.ts:8`; consumed by `readCredential()`, deployed `supabase/functions/_shared/aa.ts:9` | NO | Dynamic naming helper |

### Edge Function Env Names

These are `Deno.env.get(...)` reads. They are environment settings, not Vault keys unless you intentionally move them behind Vault reads.

| Expected name | Read by (function/file) | Exists in Supabase? | Status |
|---|---|---|---|
| `SUPABASE_URL` | `SUPABASE_URL` module constant, deployed `supabase/functions/_shared/aa.ts:2`; n8n `$env.SUPABASE_URL`, `n8n/workflows/onboarding_day1_7_checklist.json:49`, `n8n/workflows/outreach_cadence_5msg.json:63` | env | ✅ MATCH |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_KEY` module constant, deployed `supabase/functions/_shared/aa.ts:3` | env | ✅ MATCH |
| `AA_USE_STUBS` | `useStubs()`, deployed `supabase/functions/_shared/aa.ts:5` | NO | ❌ MISSING as env config |
| `AA_AICOS_MODEL` | `callOpenClaw()`, deployed `supabase/functions/aicos-act/index.ts:4` | NO | ❌ MISSING as env config |
| `AA_APIFY_ACTOR` | `fetchFromApify()`, deployed `supabase/functions/apify-scrape/index.ts:12` | NO | ❌ MISSING as env config |
| `AA_CLAUDE_MODEL` | `claudeBrief()`, deployed `supabase/functions/brief-generator/index.ts:4`; `claudeCopy()`, deployed `supabase/functions/mjr-generate/index.ts:4` | NO | ❌ MISSING as env config |
| `AA_ICP_MODEL` | `Deno.serve` handler, deployed `supabase/functions/lead-score/index.ts:17` | NO | ❌ MISSING as env config |
| `AA_META_AD_ACCOUNT` | `metaCreate()`, deployed `supabase/functions/meta-ad-ops/index.ts:30` | NO | ❌ MISSING as env config |
| `AA_WEBHOOK_SECRET` | `authed()`, deployed `supabase/functions/dialog360-webhook/index.ts:4` | NO | ❌ MISSING as env secret |
| `AA_META_VERIFY_TOKEN` | `Deno.serve` GET verification handler, deployed `supabase/functions/meta-webhook/index.ts:10` | NO | ❌ MISSING as env secret/config |
| `AA_N8N_ONBOARDING_WEBHOOK` | `Deno.serve` handler, deployed `supabase/functions/onboarding/index.ts:24` | NO | ❌ MISSING as env config/secret URL |
| `SUPABASE_SERVICE_KEY` | n8n `$env.SUPABASE_SERVICE_KEY`, `n8n/workflows/onboarding_day1_7_checklist.json:66`, `n8n/workflows/outreach_cadence_5msg.json:67` | Function env has near-name `SUPABASE_SERVICE_ROLE_KEY`; n8n env not queryable from Supabase | ⚠️ MISMATCH: n8n expects `SUPABASE_SERVICE_KEY`, Supabase function env has `SUPABASE_SERVICE_ROLE_KEY` |

### Other Repo Env Reads

These are frontend/build or GitHub Actions names found in the repo. They are not Vault targets.

| Expected name | Read by (function/file) | Exists in Supabase? | Status |
|---|---|---|---|
| `VITE_SUPABASE_URL` | frontend module scope, `src/lib/supabase.ts:7`; declared `src/vite-env.d.ts:4`; GitHub Actions secret ref `.github/workflows/deploy.yml:40` | NO as Supabase function env; local `.env` has name | Not a Vault target |
| `VITE_SUPABASE_ANON_KEY` | frontend module scope, `src/lib/supabase.ts:8`; declared `src/vite-env.d.ts:5`; GitHub Actions secret ref `.github/workflows/deploy.yml:41` | NO as Supabase function env; local `.env` has name | Not a Vault target |
| `VITE_PORTAL_URL` | `ProtectedRoute`, `src/components/auth/ProtectedRoute.tsx:32`; declared `src/vite-env.d.ts:6`; GitHub Actions secret ref `.github/workflows/deploy.yml:42` | NO as Supabase function env; local `.env` has name | Not a Vault target |

## Orphans In Supabase

These exist in Supabase function env/project secrets but no deployed edge function, n8n workflow, database Vault read, or frontend repo code reads the exact name.

| Existing name | Store | Status |
|---|---|---|
| `SUPABASE_ANON_KEY` | Function env | 🔵 ORPHAN |
| `SUPABASE_DB_URL` | Function env | 🔵 ORPHAN |
| `SUPABASE_JWKS` | Function env | 🔵 ORPHAN |
| `SUPABASE_PUBLISHABLE_KEYS` | Function env | 🔵 ORPHAN |
| `SUPABASE_SECRET_KEYS` | Function env | 🔵 ORPHAN |

Vault orphans: none, because Vault is empty.

## Names To Add

### Add To Vault Now

These are the fixed Vault keys required to match the current live code/registry exactly:

```text
GLOBAL_SUPABASE_SERVICE_ROLE_KEY
_GLOBAL_ANTHROPIC_API_KEY
_GLOBAL_APIFY_API_TOKEN
_GLOBAL_META_SYSTEM_USER_TOKEN
_GLOBAL_OPENAI_API_KEY
_GLOBAL_PAYFAST_MERCHANT_KEY
_GLOBAL_TELEGRAM_BOT_TOKEN
```

For concrete clients, also add per-client keys generated by the helper convention:

```text
{CLIENT_SLUG_NORMALIZED}_DIALOG360_BSP_KEY
{CLIENT_SLUG_NORMALIZED}_META_ACCESS_TOKEN
```

Normalization is: replace every non-alphanumeric run with `_`, then uppercase. Example shape only: client slug `acme-co` becomes `ACME_CO`.

### Add To Edge Function Env / External n8n Env If Needed

These are not Vault reads in the current code:

```text
AA_USE_STUBS
AA_AICOS_MODEL
AA_APIFY_ACTOR
AA_CLAUDE_MODEL
AA_ICP_MODEL
AA_META_AD_ACCOUNT
AA_WEBHOOK_SECRET
AA_META_VERIFY_TOKEN
AA_N8N_ONBOARDING_WEBHOOK
SUPABASE_SERVICE_KEY
```

`SUPABASE_SERVICE_KEY` is an n8n environment variable name, not a deployed Supabase Edge Function env name.

## Names To Rename / Standardize

| Current / near name | Desired name | Reason |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` in function env, while DB function reads `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` from Vault | Either add Vault key `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` exactly, or change DB function + registry to `_GLOBAL_SUPABASE_SERVICE_ROLE_KEY` | Current live DB function will only read `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` from Vault. Gate report notes this breaks the registry convention. |
| `SUPABASE_SERVICE_KEY` in n8n workflows | Consider `SUPABASE_SERVICE_ROLE_KEY` if you want one naming convention across Supabase and n8n | n8n workflows use `SUPABASE_SERVICE_KEY`; Supabase function env uses `SUPABASE_SERVICE_ROLE_KEY`. |

No existing Vault key can be renamed today because Vault is empty.

## Stage Mapping

| Name / pattern | Stage |
|---|---|
| `_GLOBAL_ANTHROPIC_API_KEY` | Stage A - Anthropic |
| `_GLOBAL_OPENAI_API_KEY` | Stage A - OpenAI |
| `_GLOBAL_APIFY_API_TOKEN` | Stage A - Apify |
| `_GLOBAL_TELEGRAM_BOT_TOKEN` | Stage A - Telegram |
| `GLOBAL_SUPABASE_SERVICE_ROLE_KEY` | Platform infra - required now for `cron_invoke_function` |
| `_GLOBAL_META_SYSTEM_USER_TOKEN` | Stage B - Meta |
| `${norm(client_slug)}_META_ACCESS_TOKEN` | Stage B - Meta per-client |
| `_GLOBAL_PAYFAST_MERCHANT_KEY` | Stage B - PayFast |
| `${norm(client_slug)}_DIALOG360_BSP_KEY` | Stage B - 360dialog per-client |

## Convention Check

AA platform keys and per-client keys mostly use the same helper convention:

```text
{CLIENT_SLUG_UPPER}_{SERVICE_UPPER}_{CREDENTIAL_TYPE_UPPER}
```

Evidence: deployed helper `vaultName(clientSlug, service, credentialType)` returns `${norm(clientSlug)}_${norm(service)}_${norm(credentialType)}` in `supabase/functions/_shared/aa.ts:8`; live DB function `public.register_credential` uses the same three-part uppercase/underscore construction; live `credential_registry` contains `_GLOBAL_ANTHROPIC_API_KEY`, `_GLOBAL_APIFY_API_TOKEN`, `_GLOBAL_META_SYSTEM_USER_TOKEN`, `_GLOBAL_OPENAI_API_KEY`, `_GLOBAL_PAYFAST_MERCHANT_KEY`, and `_GLOBAL_TELEGRAM_BOT_TOKEN`.

The exception is `GLOBAL_SUPABASE_SERVICE_ROLE_KEY`: live `public.cron_invoke_function` reads that exact Vault name without the leading `_`, and it is absent from `credential_registry`. That differs from `_global` convention output, which would be `_GLOBAL_SUPABASE_SERVICE_ROLE_KEY`.

## Gate Report Cross-Check

`GATE_VALIDATION_REPORT.md` says Vault has 0 rows and 7 missing secrets. The live audit confirms that exact fixed Vault count:

1. `GLOBAL_SUPABASE_SERVICE_ROLE_KEY`
2. `_GLOBAL_ANTHROPIC_API_KEY`
3. `_GLOBAL_APIFY_API_TOKEN`
4. `_GLOBAL_META_SYSTEM_USER_TOKEN`
5. `_GLOBAL_OPENAI_API_KEY`
6. `_GLOBAL_PAYFAST_MERCHANT_KEY`
7. `_GLOBAL_TELEGRAM_BOT_TOKEN`

The deployed edge functions also contain additional missing env/config names and dynamic per-client Vault patterns. Those do not change the gate report's "7 missing secrets" count because that count is specifically the fixed Vault set: six `credential_registry` entries plus the one hard-coded Vault read in `cron_invoke_function`.
