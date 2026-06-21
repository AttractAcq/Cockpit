# Preflight Readiness

Audit date: 2026-06-13  
Supabase project ref: `iwkhdqqgfjtpdhcbpftu`  
Old verdict: **NOT-READY**  
New verdict: **GREEN-with-external-blocks**

No secret values were printed or written. Only names, digests already emitted by Supabase CLI, status codes, scores, method labels, and pass/fail evidence are recorded.

## Verdict Summary

| Area | Result | Evidence |
|---|---|---|
| Phase 1 - backend/data/core AI | ✅ GREEN | Canonical project confirmed; `AA_USE_STUBS=false`; Anthropic, OpenAI/OpenClaw, lead-score, Apify, Telegram, and cron/service-role checks all pass. |
| Phase 2 - external launch channels | ✅ GREEN-with-external-blocks | Meta, PayFast, 360dialog, and n8n remain approval/deployment gated where applicable. These are external blockers, not backend wiring failures. |
| Overall production preflight | ✅ GREEN-with-external-blocks | All non-external checks passed after the lead-score, Apify, and AICOS model fixes. |

## Checks

| CHECK | RESULT | Evidence |
|---|---|---|
| Project ref | ✅ ready | Connected project ref is `iwkhdqqgfjtpdhcbpftu`, matching canonical production. |
| `AA_USE_STUBS=false` | ✅ ready | Supabase digest for `AA_USE_STUBS` matches SHA-256 of the literal string `false`. |
| `AA_CLAUDE_MODEL` | ✅ ready | Digest matches `claude-sonnet-4-6`. |
| `AA_ICP_MODEL` | ✅ ready | Digest matches `claude-haiku-4-5-20251001`. |
| `AA_AICOS_MODEL` | ✅ ready | Digest matches `gpt-5.4-mini`; live `aicos-act` call returned HTTP 200 with `stub:false`, proving endpoint compatibility. |
| `brief-generator` | ✅ ready | HTTP 200, `ok:true`, `stub:false`, generated brief id. Latency: 11,166 ms. |
| `aicos-act` | ✅ ready | HTTP 200, `ok:true`, `stub:false`, score `0.12`, band `cold`. Latency: 6,021 ms. |
| `lead-score` strong ICP lead | ✅ ready | HTTP 200, `ok:true`, `stub:false`, score `92`, band `hot`, method `prod:anthropic:claude-haiku-4-5-20251001`. Latency: 1,725 ms. |
| `lead-score` weak non-ICP lead | ✅ ready | HTTP 200, `ok:true`, `stub:false`, score `28`, band `cold`, method `prod:anthropic:claude-haiku-4-5-20251001`. Latency: 1,610 ms. |
| `lead-score` upstream failure behavior | ✅ ready | Downloaded deployed source confirms both Anthropic and OpenAI paths check `if (!resp.ok) throw new UpstreamModelError(...)`; handler returns `upstream_model_error` with provider/status/model and HTTP 502. No `score:0` prod fallback remains. |
| Apify metadata/account auth | ✅ ready | Vault token used inside Postgres via `pg_net`; Apify `/v2/users/me` returned HTTP 200 and account username was present. No actor scrape was launched. |
| Telegram `getMe` | ✅ ready | Vault token used inside Postgres via `pg_net`; Telegram returned HTTP 200, `ok:true`, bot username present. |
| Cron/service-role invocation | ✅ ready | `public.cron_invoke_function('campaign-flag')` queued request `286`; response HTTP 200 with `{"ok":true,"checked":0,"flagged":0}`. |
| Cleanup | ✅ ready | Verified zero `TEST_GATE_` rows remain in `entities`, `briefs`, `assets`, `triage_items`, `agent_events`, and `audit_log`. |

## Test Inputs

| Test input | Purpose | Summary |
|---|---|---|
| `TEST_GATE_Preflight_Strong_ICP` | Strong ICP lead | Owner-operated roofing business in Cape Town, website present, moderate review count. |
| `TEST_GATE_Preflight_Weak_ICP` | Weak non-ICP lead | National software franchise in Johannesburg, not owner-operated, high review count. |
| `TEST_GATE tiny` | Brief generation topic | Minimal content-generation probe for `brief-generator`. |
| `TEST_GATE yes please quote` | OpenClaw reply scoring probe | Minimal `aicos-act` probe against `gpt-5.4-mini`. |

All `TEST_GATE_` artifacts were removed after testing.

## Remaining Failures

None among non-external checks rerun in this preflight.

Previously failing items now pass:

| Previous failure | New result |
|---|---|
| `lead-score` sent Claude Haiku model id to OpenAI and swallowed upstream errors | Fixed. Live method is `prod:anthropic:claude-haiku-4-5-20251001`; deployed source has non-2xx guards and `upstream_model_error`. |
| `_GLOBAL_APIFY_API_TOKEN` returned HTTP 401 | Fixed. Apify metadata/account endpoint now returns HTTP 200 with account identity present. |
| `AA_AICOS_MODEL` was stale mini-class model | Fixed. `AA_AICOS_MODEL` now matches `gpt-5.4-mini`; live `aicos-act` call is HTTP 200 and `stub:false`. |

## Remaining BLOCKED-external Items

These are expected-not-ready until external approvals or deployments complete; they are not counted as backend failures.

| Gate | Result | Notes |
|---|---|---|
| Meta BM verification / ad account readiness | 🔵 BLOCKED-external | `_GLOBAL_META_SYSTEM_USER_TOKEN` may be present, but live Meta launch remains approval-gated. |
| PayFast merchant approval | 🔵 BLOCKED-external | `_GLOBAL_PAYFAST_MERCHANT_KEY` may remain absent/placeholder until approval. |
| 360dialog BSP approval / per-client keys | 🔵 BLOCKED-external | Per-client `*_DIALOG360_BSP_KEY` keys remain approval-gated. |
| n8n onboarding webhook deployment/registration | 🔵 BLOCKED-external | `AA_N8N_ONBOARDING_WEBHOOK` is present in env, but full n8n readiness depends on deployment/registration if not already completed. |

