# Edge Function Audit - Phase 08: Public Intake, Webhooks, Messaging, Payments, and Reporting

Date: 2026-08-13
Mode: Read-only audit

## 1. Phase Scope

This phase audited the public intake, webhook, outbound messaging, payment, reporting, and older automation functions:

- `meta-webhook`
- `dialog360-send`
- `onboarding`
- `payfast-create-link`
- `payfast-webhook`
- `mrr-calc`
- `apify-scrape`
- `mjr-generate`
- `brief-generator`

Primary UI/system areas:

- Public intake
- Webhooks
- WhatsApp / Meta inbound
- Payments
- Reporting
- Older automation paths

Audit emphasis:

- Confirm webhook verification and idempotency.
- Confirm payment webhook safety and replay resistance.
- Confirm outbound messaging is not accidentally public.
- Confirm older lead/prospect and MJR functions are either valid, deprecated, or orphaned.
- Confirm reporting calculations are scheduled/manual safe.

This audit did not invoke live functions and did not make source, schema, configuration, deployment, database, or storage changes.

## 2. Functions Audited

| Function | Role | Current posture |
| --- | --- | --- |
| `meta-webhook` | Intended public Meta webhook for Instagram DMs and leadgen events. | Superseded-era, old-schema path; unsafe if publicly reachable because POST is not signature-verified and not idempotent. |
| `dialog360-send` | Sends outbound WhatsApp through 360dialog and records outbound messages. | Superseded-era, old-schema path; unsafe if reachable because approval is client-supplied and no user/client authorization exists in source. |
| `onboarding` | Starts legacy onboarding after a deposit/payment event. | Superseded-era, old-schema/ZAR path; unsafe if reachable because it advances stage and optionally records payment without user/client authorization. |
| `payfast-create-link` | Creates signed PayFast redirect URLs for legacy deposits. | Superseded-era South Africa/ZAR payment path; payment signing is structured, but the commercial authority is deprecated and source lacks authorization. |
| `payfast-webhook` | Handles PayFast ITN notifications. | Best-authored legacy function in this phase; verifies signature/postback/amount/merchant, but is deprecated by current commercial authority and local config does not declare JWT-disabled webhook status. |
| `mrr-calc` | Rolls up legacy active-contract MRR into snapshots and pulse metrics. | Superseded-era reporting path; no cron secret/auth guard in source and writes ZAR. |
| `apify-scrape` | Scrapes legacy prospects through Apify/Google Places and inserts `entities`. | Superseded-era lead path; no auth/cron guard and unbounded spend/input risk if reachable. |
| `mjr-generate` | Generates Missed Jobs Report copy and inserts a review asset. | Superseded-era generation path; no auth/client access, old South Africa/Cape Town prompt assumptions, no real PDF rendering. |
| `brief-generator` | Generates old faceless reel briefs and inserts `briefs`. | Superseded-era generation path; no auth/client access and replaced by current content/production brief systems. |

## 3. UI Page / System Role

Current active UI caller mapping:

- No active `src/lib` or `src/pages` invocation was found for the nine scoped functions.
- `tests/stage-a-readiness.test.ts` explicitly guards that `apify-scrape`, `brief-generator`, `dialog360-send`, `mjr-generate`, `mrr-calc`, and `onboarding` are not invoked by `src/lib/api.ts`.
- `src/types/pulse.ts` contains the ordinary word `onboarding`, but no function invocation.

Repository status evidence:

- `docs/programme/status/Stage_A_Baseline_Report.md` states that `payfast-create-link`, `payfast-webhook`, `mrr-calc`, `mjr-generate`, `dialog360-send`, `meta-ad-ops`, `meta-webhook`, `apify-scrape`, `brief-generator`, and `onboarding` are never-deployed superseded-era functions.
- `docs/PRE_STAGE_A_REPOSITORY_READINESS_REPORT.md` states that the backing tables `entities`, `campaigns`, `conversations`, `messages`, `briefs`, `assets`, `deposits`, `payments`, and `leads` were confirmed absent from the live database during that readiness pass.
- Local migrations searched in this audit do not define the old operational tables these functions target.

Configuration:

- Local `supabase/config.toml` only declares `collect-instagram-insights` as `verify_jwt = false`.
- `meta-webhook` and `payfast-webhook` source comments say they need public/no-JWT webhook deployment, but local config does not declare that.
- Because this was read-only, remote deployment status was not changed or tested.

## 4. Function-by-Function Findings

### P1: Audit 08 functions are superseded-era code that must not be reactivated accidentally

Affected functions:

- `meta-webhook`
- `dialog360-send`
- `onboarding`
- `payfast-create-link`
- `payfast-webhook`
- `mrr-calc`
- `apify-scrape`
- `mjr-generate`
- `brief-generator`

Positive findings:

- Current active app code does not appear to invoke the scoped functions.
- Stage A readiness tests intentionally guard several retired wrappers from returning to `src/lib/api.ts`.
- Current architecture has replacements for the old content/brief/paid/ad paths, such as current client tables, Content Briefs, Production Briefs, Ad Studio, Reel Studio, and Operations Control.

Issue:

- The source files still live under `supabase/functions`, so they remain locally deployable.
- Most target old `entities`/`campaigns`/`briefs`/`assets`/`payments` style tables that are not current authority.
- Several functions encode deprecated South Africa/ZAR-era business assumptions, conflicting with the current Europe/EUR commercial authority in workspace instructions.

Evidence:

- `docs/programme/status/Stage_A_Baseline_Report.md:84` classifies the scoped functions as never-deployed superseded-era functions.
- `tests/stage-a-readiness.test.ts:18` through `tests/stage-a-readiness.test.ts:27` lists retired functions.
- `tests/stage-a-readiness.test.ts:51` through `tests/stage-a-readiness.test.ts:65` guards against active API invocation.
- `docs/PRE_STAGE_A_REPOSITORY_READINESS_REPORT.md:119` says old backing tables were absent from the live database.
- `supabase/functions/_shared/payfast.ts:219` through `supabase/functions/_shared/payfast.ts:223` defines ZAR deposit tiers, including deprecated `authority_brand`.
- `supabase/functions/mrr-calc/index.ts:17` writes `currency: "ZAR"`.

Suggested upgrade:

- Treat these as legacy-retirement candidates, not active product surfaces.
- In a remediation pass, verify remote deployment state and either retire/hard-disable them or move them out of deployable `supabase/functions`.
- Keep current active replacements untouched; do not expand these legacy functions to become new current workflows.

### P1: `meta-webhook` does not verify POST signatures and is not idempotent

Affected function:

- `meta-webhook`

Positive findings:

- GET webhook verification checks `hub.verify_token` against `AA_META_VERIFY_TOKEN`.
- POST handler returns HTTP 200 for ignored/handled payloads to avoid retry storms.
- Handler catches per-entry failures so one malformed event does not fail the whole webhook.

Issue:

- POST payloads are accepted without validating Meta's `X-Hub-Signature-256` or equivalent app-secret signature.
- The handler writes messages, agent events, and triage records without deduping `message.mid` or `leadgen_id`.
- If deployed as public/no-JWT, anyone could post forged events that create legacy conversations/triage rows.

Evidence:

- `supabase/functions/meta-webhook/index.ts:24` through `supabase/functions/meta-webhook/index.ts:37` verifies only the GET challenge.
- `supabase/functions/meta-webhook/index.ts:42` through `supabase/functions/meta-webhook/index.ts:48` parses and accepts POST JSON without signature validation.
- `supabase/functions/meta-webhook/index.ts:140` inserts messages without checking `msg.message.mid`.
- `supabase/functions/meta-webhook/index.ts:188` and `supabase/functions/meta-webhook/index.ts:212` insert leadgen event/triage records without deduping `leadgen_id`.

Suggested upgrade:

- Do not reactivate until POST signature verification and idempotency are added.
- If retained for a future webhook path, validate `X-Hub-Signature-256` before service-role DB access and store provider event ids under a unique constraint.

### P1: `dialog360-send` can be abused for outbound messaging if reachable

Affected function:

- `dialog360-send`

Positive findings:

- Requires `approved=true` in the request body as a human-approval marker.
- Uses per-client Vault lookup for the 360dialog key.
- Records the outbound message when a conversation exists or can be created.

Issue:

- There is no in-function user authentication, staff-role check, or client-access check.
- The approval gate is controlled entirely by the caller-provided body.
- The provider response is not checked for HTTP failure; if the response has no message id, the function fabricates a `sent-*` fallback and returns `ok: true`.

Evidence:

- `supabase/functions/dialog360-send/index.ts:6` creates a service-role client before any auth.
- `supabase/functions/dialog360-send/index.ts:7` reads `approved` from the request body.
- `supabase/functions/dialog360-send/index.ts:9` treats body `approved=true` as sufficient approval.
- `supabase/functions/dialog360-send/index.ts:15` through `supabase/functions/dialog360-send/index.ts:17` does not check `resp.ok` and falls back to `sent-${Date.now()}`.

Suggested upgrade:

- Keep retired unless outbound WhatsApp is explicitly brought back into the product.
- If retained, require server-side approval state from a reviewed record, not a body boolean.
- Check provider HTTP status and return failure without recording a successful send when 360dialog rejects the message.

### P1: `onboarding` can mutate legacy entity/payment state without authorization and is not transactional

Affected function:

- `onboarding`

Positive findings:

- Refuses entities already in `onboarding`, `active`, or `delivering`.
- Supports `skip_payment` so `payfast-webhook` can avoid duplicate payment rows after recording a COMPLETE payment.
- Logs agent events and audit records.

Issue:

- No user, role, client-access, or internal-secret check exists in source.
- Direct callers can submit arbitrary `amount_cents`, `tier`, and `skip_payment`.
- The function inserts a payment, advances stage to `onboarding`, then calls n8n; if n8n is missing or fails, the entity remains advanced and the function returns `207`.
- It writes legacy `payments` rows in `ZAR`, conflicting with current commercial authority.

Evidence:

- `supabase/functions/onboarding/index.ts:7` creates a service-role client before auth.
- `supabase/functions/onboarding/index.ts:8` through `supabase/functions/onboarding/index.ts:17` trusts caller-supplied money/tier/skip fields.
- `supabase/functions/onboarding/index.ts:36` through `supabase/functions/onboarding/index.ts:42` inserts a payment row with `currency: "ZAR"`.
- `supabase/functions/onboarding/index.ts:47` through `supabase/functions/onboarding/index.ts:50` advances entity stage before n8n.
- `supabase/functions/onboarding/index.ts:58` through `supabase/functions/onboarding/index.ts:67` returns partial failure after stage advancement when webhook config is missing.

Suggested upgrade:

- Keep retired; current Stage O onboarding uses the `onboard_client` RPC and current `clients` tables.
- If retained as an internal helper, require a signed internal call or service-only RPC path and move payment/stage/webhook work into a transactionally recoverable flow.

### P1: `payfast-create-link` is deprecated commercially and lacks caller authorization in source

Affected function:

- `payfast-create-link`

Positive findings:

- It derives the amount server-side from `TIER_DEPOSIT_CENTS` rather than trusting caller-supplied amount.
- It signs the outbound PayFast URL through shared PayFast helpers.
- It embeds `entity_id` and `tier` into PayFast fields for webhook mapping.

Issue:

- No user/role/client-access check appears in source.
- It uses deprecated South Africa/ZAR PayFast commercial authority.
- It includes deprecated `authority_brand` tier via shared `TIER_DEPOSIT_CENTS`.
- It targets old `entities`, not current `clients` or current offer authority.

Evidence:

- `supabase/functions/payfast-create-link/index.ts:19` creates a service-role client before auth.
- `supabase/functions/payfast-create-link/index.ts:26` uses `TIER_DEPOSIT_CENTS`.
- `supabase/functions/payfast-create-link/index.ts:32` through `supabase/functions/payfast-create-link/index.ts:40` queries `entities`.
- `supabase/functions/payfast-create-link/index.ts:66` and `supabase/functions/payfast-create-link/index.ts:71` create a ZAR PayFast request.
- `supabase/functions/_shared/payfast.ts:219` through `supabase/functions/_shared/payfast.ts:223` defines ZAR legacy tiers.

Suggested upgrade:

- Do not use for current commercial flows.
- During legacy retirement, verify it is not deployed and remove from deployable source or hard-disable.
- If a payment link flow is ever rebuilt, it should use current EUR offer authority and current client tables.

### P1: `mrr-calc` is not scheduled/manual safe if reachable

Affected function:

- `mrr-calc`

Positive findings:

- Uses upsert by date for daily MRR snapshot.
- Uses per-client upsert for pulse metrics.

Issue:

- No method restriction beyond OPTIONS; a GET can trigger writes.
- No cron secret, user auth, staff-role check, or client-access gate exists in source.
- It writes ZAR reporting data from old `contracts`/`mrr_snapshots`/`pulse_metrics` tables, not current EUR commercial authority.
- It ignores database errors from the contracts query and upserts, so a partial/empty rollup could be reported as success.

Evidence:

- `supabase/functions/mrr-calc/index.ts:6` through `supabase/functions/mrr-calc/index.ts:21` performs writes without auth or method gating.
- `supabase/functions/mrr-calc/index.ts:10` reads `contracts`.
- `supabase/functions/mrr-calc/index.ts:15` upserts `pulse_metrics`.
- `supabase/functions/mrr-calc/index.ts:17` writes `currency: "ZAR"`.

Suggested upgrade:

- Keep retired.
- If a reporting rollup is reintroduced, require a cron secret or explicit staff access, validate method, handle query/upsert errors, and use current EUR/accounting authority.

### P1: `apify-scrape` can trigger unbounded scraping/cost and write legacy prospects if reachable

Affected function:

- `apify-scrape`

Positive findings:

- Dedupes by `business_name` before inserting.
- Uses Vault for Apify token and falls back to stubs when token is unavailable or stubs are enabled.

Issue:

- No user auth, staff-role, client-access, cron secret, or method restriction appears in source.
- Caller controls `niches`, `locations`, and `maxCrawledPlacesPerSearch`.
- The nested `niches x locations` loop can drive a large number of Apify actor runs.
- It writes old `entities` prospects and defaults to Cape Town/South Africa assumptions.

Evidence:

- `supabase/functions/apify-scrape/index.ts:54` through `supabase/functions/apify-scrape/index.ts:101` runs without auth or method gating.
- `supabase/functions/apify-scrape/index.ts:59` through `supabase/functions/apify-scrape/index.ts:67` accepts caller-controlled arrays and max results.
- `supabase/functions/apify-scrape/index.ts:75` through `supabase/functions/apify-scrape/index.ts:80` performs nested external calls.
- `supabase/functions/apify-scrape/index.ts:90` inserts legacy `entities`.

Suggested upgrade:

- Keep retired.
- If a prospecting worker is rebuilt, add explicit staff/client scope, caps on input cardinality/results, idempotency keys, and cost ledger integration before provider calls.

### P1: `mjr-generate` and `brief-generator` are unauthorised legacy generation paths

Affected functions:

- `mjr-generate`
- `brief-generator`

Positive findings:

- Both return draft/review outputs rather than approved final authority.
- Both fall back to stubs if Anthropic credentials are missing.

Issue:

- Neither function authenticates the caller or checks client/entity access.
- Both use old `entities` context and old tables (`assets`, `briefs`).
- `mjr-generate` stores a `storage_path` ending in `.pdf` but only inserts metadata/copy; it does not render or upload a PDF.
- Prompts assume old Cape Town/trades positioning.

Evidence:

- `supabase/functions/mjr-generate/index.ts:12` through `supabase/functions/mjr-generate/index.ts:25` reads an entity and writes an asset without auth.
- `supabase/functions/mjr-generate/index.ts:20` contains Cape Town/local trades assumptions.
- `supabase/functions/mjr-generate/index.ts:21` through `supabase/functions/mjr-generate/index.ts:22` creates a `.pdf` storage path but inserts only an `assets` metadata row.
- `supabase/functions/brief-generator/index.ts:12` through `supabase/functions/brief-generator/index.ts:24` reads an entity and writes a brief without auth.
- `supabase/functions/brief-generator/index.ts:4` uses an old faceless reel brief prompt tied to old trade-client assumptions.

Suggested upgrade:

- Keep retired and rely on current Content Brief, Production Brief, Reel Studio, and Avatar OS generation paths.
- If any concept is reused later, port the intent into current client-scoped modules rather than reviving these functions.

### P2: `payfast-webhook` has strong ITN validation but should not be treated as current authority

Affected function:

- `payfast-webhook`

Positive findings:

- Requires POST.
- Validates PayFast MD5 signature through `pfValidSignature`.
- Attempts source IP validation and relies on PayFast server postback as the hard gate.
- Recomputes expected amount from `tier`, verifies merchant id, accepts only `COMPLETE`, maps entity id defensively, and verifies stage after invoking onboarding.
- Uses 200 for permanent rejects and 5xx for transient failures, which matches webhook retry semantics.

Issue:

- The flow is tied to old `entities`, old stage names, old ZAR PayFast tiers, and the retired `onboarding` function.
- Local `supabase/config.toml` does not declare `[functions.payfast-webhook] verify_jwt = false`; if deployed by local config defaults, PayFast cannot call it.
- Idempotency is implemented by querying `payments.external_ref`, but no current migration evidence was found in this repo establishing the old `payments` table or a unique constraint on `external_ref`.

Evidence:

- `supabase/functions/payfast-webhook/index.ts:23` through `supabase/functions/payfast-webhook/index.ts:24` requires POST.
- `supabase/functions/payfast-webhook/index.ts:53` through `supabase/functions/payfast-webhook/index.ts:81` validates signature, source, postback, amount, and merchant.
- `supabase/functions/payfast-webhook/index.ts:91` through `supabase/functions/payfast-webhook/index.ts:106` validates entity mapping and stage.
- `supabase/functions/payfast-webhook/index.ts:109` through `supabase/functions/payfast-webhook/index.ts:113` dedupes by `external_ref`.
- `supabase/functions/payfast-webhook/index.ts:117` invokes the retired `onboarding` function.
- `supabase/config.toml:1` through `supabase/config.toml:4` lists only `collect-instagram-insights` as JWT-disabled locally.

Suggested upgrade:

- Keep retired for current product purposes.
- If temporarily retained, verify remote `verify_jwt=false` only for the webhook and add/verify a unique `payments.external_ref` constraint.
- Do not convert this into a current payment system without an explicit commercial-authority rebuild.

### P2: Local webhook deployment config does not match source comments for `meta-webhook` and `payfast-webhook`

Affected functions:

- `meta-webhook`
- `payfast-webhook`

Issue:

- Both source files state or imply they need public webhook deployment.
- Local Supabase config does not list either function under `verify_jwt=false`.
- If these functions are intentionally retired, this mismatch is harmless but confusing.
- If they are reactivated, this mismatch can either block provider delivery or encourage ad hoc deployment flags outside versioned config.

Evidence:

- `supabase/functions/meta-webhook/index.ts:1` says `verify_jwt MUST be false`.
- `supabase/functions/payfast-webhook/index.ts:1` says `verify_jwt=FALSE`.
- `supabase/config.toml:1` through `supabase/config.toml:4` declares only `collect-instagram-insights` as JWT-disabled.

Suggested upgrade:

- For retired functions, add retirement documentation or remove from deployable source in a scoped cleanup.
- For any webhook intentionally retained, keep `verify_jwt=false` in versioned config and implement the function's own signature/secret validation before service-role use.

## 5. Configuration Checklist

Local config:

- `supabase/config.toml` only sets `verify_jwt=false` for `collect-instagram-insights`.
- No Audit 08 function is locally configured as JWT-disabled.
- No Audit 08 function is locally configured with a cron-only setting.

Expected secrets/env if legacy functions were reactivated:

- `AA_META_VERIFY_TOKEN` for `meta-webhook` GET challenge.
- Meta app secret would be needed for safe POST signature verification, but no such check exists in source.
- `{client_slug} / dialog360 / bsp_key` for `dialog360-send`.
- `AA_N8N_ONBOARDING_WEBHOOK` for `onboarding`.
- PayFast Vault credentials: `_global / payfast / merchant_id`, `merchant_key`, `passphrase`.
- `AA_PAYFAST_SANDBOX`, `AA_PUBLIC_BASE_URL`, `AA_PAYFAST_NOTIFY_URL` for PayFast link/webhook behavior.
- `_global / apify / api_token` and `AA_APIFY_ACTOR` for `apify-scrape`.
- `_global / anthropic / api_key` and `AA_CLAUDE_MODEL` for `mjr-generate` and `brief-generator`.

Configuration conclusion:

- The correct current posture is retirement/non-use.
- If any of these become active again, configuration must be made explicit in versioned config and paired with proper in-function auth/signature gates.

## 6. Security / Auth / RLS Notes

High-risk source patterns:

- Most functions create a service-role client before validating caller identity or webhook authenticity.
- Most functions do not check user role or client/entity access.
- Public CORS is shared through `_shared/aa.ts`.
- `AA_USE_STUBS` defaults to enabled in `_shared/aa.ts`, which can create fake success paths in legacy functions if they are reachable without provider credentials.

Webhook-specific notes:

- `payfast-webhook` has strong own-function validation, but the flow is deprecated.
- `meta-webhook` has GET token verification only; POST event validation is missing.

RLS/current schema notes:

- These functions use service role, so RLS would not protect old tables even if present.
- Current repository evidence says old backing tables are absent from the live DB, so most of these paths would fail or be inert if invoked against the current project.

## 7. Secrets / Environment Variables Required

| Function | Required config if active |
| --- | --- |
| `meta-webhook` | `AA_META_VERIFY_TOKEN`; also needs Meta app secret verification added before safe POST use. |
| `dialog360-send` | Vault `{client_slug} / dialog360 / bsp_key`. |
| `onboarding` | `AA_N8N_ONBOARDING_WEBHOOK`. |
| `payfast-create-link` | Vault `_global / payfast / merchant_id`, `merchant_key`, optional `passphrase`; `AA_PAYFAST_SANDBOX`; `AA_PUBLIC_BASE_URL`; `AA_PAYFAST_NOTIFY_URL`. |
| `payfast-webhook` | Vault `_global / payfast / merchant_id`, optional `passphrase`; `AA_PAYFAST_SANDBOX`; provider access to JWT-disabled webhook. |
| `mrr-calc` | None visible beyond service-role Supabase env; should require `CRON_SECRET` if ever active. |
| `apify-scrape` | Vault `_global / apify / api_token`; `AA_APIFY_ACTOR`. |
| `mjr-generate` | Vault `_global / anthropic / api_key`; `AA_CLAUDE_MODEL`. |
| `brief-generator` | Vault `_global / anthropic / api_key`; `AA_CLAUDE_MODEL`. |

## 8. Database Tables / Storage Buckets Touched

Legacy tables referenced:

- `entities`
- `campaigns`
- `conversations`
- `messages`
- `triage_items`
- `payments`
- `contracts`
- `pulse_metrics`
- `mrr_snapshots`
- `assets`
- `briefs`
- `agent_events`
- `audit_log`

Current-state note:

- Repository readiness documentation says the old core backing tables were absent from the live database. This audit did not re-query the live database.

Storage:

- `mjr-generate` creates a `storage_path` string for an MJR PDF but does not upload a file.
- No Audit 08 function was found to upload or read storage objects directly.

## 9. Error Handling / Retry / Idempotency Notes

Good patterns:

- `payfast-webhook` separates permanent webhook rejections from transient retry-worthy failures.
- `payfast-webhook` verifies actual entity stage after invoking onboarding.
- `mrr-calc` uses upserts for daily/reporting rows.

Gaps:

- `meta-webhook` has no provider-event idempotency.
- `dialog360-send` reports success despite provider failures if a response lacks a message id.
- `onboarding` can leave partial state after n8n failure.
- `apify-scrape` has no job id/idempotency or bounded cost model.
- `mjr-generate` and `brief-generator` have no generation run id, client access gate, or current structured output contract.

## 10. CORS / Method / Input Validation Notes

Good patterns:

- All scoped functions handle OPTIONS.
- `payfast-webhook` requires POST.
- `payfast-create-link` derives payment amount server-side.
- `payfast-webhook` rejects unknown tiers, mismatched amounts, merchant mismatch, and non-COMPLETE status.

Gaps:

- `dialog360-send`, `onboarding`, `payfast-create-link`, `mrr-calc`, `apify-scrape`, `mjr-generate`, and `brief-generator` do not explicitly reject non-POST methods.
- Several functions parse request bodies without robust schema validation.
- `apify-scrape` accepts caller-controlled arrays and max-result settings with no hard cap.
- `onboarding` accepts caller-controlled money amount and tier when not invoked by PayFast.

## 11. Frontend Caller Mapping

| Function | Current frontend caller found? | Notes |
| --- | --- | --- |
| `meta-webhook` | No | Public provider webhook by old design. |
| `dialog360-send` | No | Stage A readiness guards removed/forbid old API wrappers. |
| `onboarding` | No active invocation found | Only ordinary text references remain. |
| `payfast-create-link` | No | Docs say UI wiring was never built. |
| `payfast-webhook` | No | Provider webhook by old design. |
| `mrr-calc` | No | Cron/manual by old design; no current route found. |
| `apify-scrape` | No | Stage A readiness guards forbid old API wrapper reintroduction. |
| `mjr-generate` | No | Stage A readiness guards forbid old API wrapper reintroduction. |
| `brief-generator` | No | Stage A readiness guards forbid old API wrapper reintroduction. |

## 12. Tests / Existing Coverage

Existing useful coverage:

- `tests/stage-a-readiness.test.ts` guards against reintroducing API calls for retired functions.
- No scoped function-specific behavioral test was found for webhook signature/idempotency, PayFast helper behavior, outbound messaging provider failures, or legacy reporting.

Coverage gaps if any function is reactivated:

- Meta webhook POST signature verification and idempotency tests.
- PayFast ITN replay/concurrency tests with a unique `external_ref`.
- Dialog360 provider failure tests.
- Onboarding partial-failure/transaction tests.
- Apify input cap and cost guard tests.
- MRR cron secret/auth/method tests.

No tests were run as part of this audit; the phase was read-only aside from writing this analysis document.

## 13. Suggested Upgrades

Priority order:

1. Verify remote deployment status for all nine Audit 08 functions during a remediation pass.
2. If any are deployed, hard-disable or protect them before further use, especially `meta-webhook`, `dialog360-send`, `onboarding`, `mrr-calc`, `apify-scrape`, `mjr-generate`, and `brief-generator`.
3. Move retired functions out of deployable `supabase/functions` or add explicit non-deployment documentation/guards.
4. Preserve the Stage A readiness tests and extend them to cover `payfast-create-link` and `payfast-webhook` if those are also meant to stay retired.
5. If `meta-webhook` is ever revived, add POST signature verification and unique event idempotency before service-role writes.
6. If `payfast-webhook` is temporarily retained, verify versioned `verify_jwt=false` config and a unique payment `external_ref` constraint.
7. Do not update ZAR/PayFast code into current commercial flows without an explicit new payment architecture plan.

These are retirement, correctness, safety, configuration, and test-hardening recommendations. They do not expand or contract the original objectives of the active product.

## 14. Open Questions

- Are `payfast-create-link` and `payfast-webhook` intentionally kept in deployable source for historical reference, or should they join the retired guard list more explicitly?
- Has remote Supabase deployment state changed since the Stage A baseline described these functions as never deployed?
- Should local `supabase/config.toml` document retired webhook functions as intentionally absent rather than leaving source comments that imply public deployment?
- Is there any remaining external provider configured to call `meta-webhook` or `payfast-webhook`?
- Should Stage P legacy retirement archive these functions alongside the already archived legacy functions?

## 15. Overall Phase Risk Rating

Risk rating: High if reachable; Low-to-Medium in the current app posture.

Reasoning:

- The current active UI appears not to call these functions, and Stage A documentation classifies them as never-deployed superseded-era code.
- If any are deployed or reconnected, several have P1-level authorization, webhook verification, idempotency, cost-control, and commercial-authority problems.
- The safest interpretation is that Audit 08 is a retirement-control phase: keep these functions inactive, verify deployment state, and avoid reviving old ZAR/entities-era paths inside the current Cockpit architecture.
