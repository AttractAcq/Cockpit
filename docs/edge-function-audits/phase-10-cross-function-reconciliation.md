# Edge Function Audit - Phase 10: Cross-Function Configuration Reconciliation

Date: 2026-08-13
Mode: Read-only audit

## 1. Phase Scope

This phase reconciles the completed Edge Function audits across the full local Supabase function layer.

Scope:

- 109 local Edge Function folders under `supabase/functions`, excluding `_shared`.
- Phase documents 01 through 09 under `docs/edge-function-audits`.
- Frontend caller references in `src`.
- Function-to-function caller references in `supabase/functions`.
- Local tests/scripts/docs references where useful.
- Local environment-variable and deployment-posture evidence.

Required Phase 10 outputs:

- All Functions Coverage Matrix
- Functions Called By UI
- Functions Not Called By UI
- Function-to-Function Calls
- Secrets Matrix
- Deployment Verification Needed
- Test Coverage Matrix
- Risk Register
- Recommended Upgrade Backlog

This audit did not invoke live functions and did not make source, schema, configuration, deployment, database, storage, or secret changes. The only output is this saved audit document.

## 2. Functions Audited

All 109 local Edge Functions are covered by at least one of the Phase 01 through Phase 09 audit documents.

### All Functions Coverage Matrix

| Audit phase | Primary functions covered |
| --- | --- |
| Phase 01 - Context / execution setup | `generate-phase-1`, `generate-phase-1-file`, `finalize-phase-1`, `generate-phase-2`, `validate-execution-pack`, `generate-execution-config`, `approve-execution-config`, `record-context-file-provenance`, `register-source-document`, `process-source-document`, `plan-destructive`, `execute-destructive` |
| Phase 02 - Intelligence OS | `run-market-os`, `run-avatar-os`, `run-competitor-os`, `run-association-os`, `run-brand-strategist`, `run-campaign-intelligence`, `record-research-run` |
| Phase 03 - Offers / Avatars | `run-offers`, `run-avatar-strategy`, `run-avatar-appearance`, `run-avatar-world`, `run-avatar-operating-context`, `run-avatar-asset-library`, `generate-avatar-asset` |
| Phase 04 - Ideation / supply / calendar | `ingest-content-source`, `create-content-opportunity`, `detect-input-conflicts`, `resolve-input-conflict`, `generate-content-opportunities`, `score-content-opportunity`, `update-content-opportunity-status`, `run-ideation`, `score-ideation-candidates`, `create-ideation-calendar-proposal`, `create-calendar-proposal`, `update-calendar-proposal-slot`, `approve-calendar-proposal`, `commit-ideation-content`, `generate-content-brief`, `review-content-brief` |
| Phase 05 - Creation / production / assets | `generate-phase-3`, `preview-phase-3-scope`, `start-phase-3-scope`, `generate-phase-3-slot`, `generate-production-brief`, `set-production-brief-mode`, `send-production-brief-to-contractor`, `route-content-brief-to-studio`, `submit-production-review`, `generate-ai-background-image`, `check-ai-background-image`, `start-carousel-generation`, `generate-carousel-slide`, `regenerate-asset-frame`, `generate-video-storyboard`, `generate-feed-post-asset`, `generate-carousel-assets`, `generate-story-assets`, `generate-ad-static-asset`, `process-asset-generation-jobs` |
| Phase 06 - Reel Studio / video | `select-reel-production-strategy`, `create-composition-contract`, `update-composition-contract`, `create-shot-source-asset-upload`, `confirm-shot-source-asset-upload`, `create-video-project`, `update-video-project-status`, `create-video-shot`, `update-video-shot`, `delete-video-shot`, `regenerate-video-shot`, `list-higgsfield-motions`, `submit-shot-still-image`, `check-shot-still-image`, `submit-shot-generation`, `check-shot-generation`, `retry-shot-still-image`, `retry-shot-video`, `handoff-video-project`, `create-final-reel-upload`, `complete-final-reel-upload`, `review-final-reel` |
| Phase 07 - Distribution / paid | `set-client-distribution-policy`, `create-distribution-record-from-content-item`, `publish-instagram-asset`, `create-reel-distribution-draft`, `process-scheduled-publishing`, `create-ad-opportunity`, `manage-ad-brief`, `generate-ad-creative-variants`, `set-ad-budget-policy`, `create-ad-campaign`, `launch-ad-campaign`, `update-ad-campaign-status`, `update-ad-campaign-budget`, `meta-ad-ops`, `collect-instagram-insights` |
| Phase 08 - Public / webhooks / legacy | `meta-webhook`, `dialog360-send`, `onboarding`, `payfast-create-link`, `payfast-webhook`, `mrr-calc`, `apify-scrape`, `mjr-generate`, `brief-generator` |
| Phase 09 - Background / orphan / internal | Reconciled unowned/background/internal/legacy functions, especially `publish-playbook-version`, background workers, direct asset wrappers, provenance helpers, and superseded-era functions. |

Coverage result:

- Local functions found: 109.
- Local functions missing from the audit plan: 0.
- Local functions not mentioned in any Phase 01-09 audit document: 0.
- `_shared` modules were not counted as Edge Functions, but shared helper risks were reviewed where they controlled scoped functions.

## 3. UI Page / System Role

### Functions Called By UI

Current direct or resolved frontend Edge Function callers were found for 90 local functions:

`approve-calendar-proposal`, `approve-execution-config`, `check-ai-background-image`, `check-shot-generation`, `check-shot-still-image`, `commit-ideation-content`, `complete-final-reel-upload`, `confirm-shot-source-asset-upload`, `create-ad-campaign`, `create-ad-opportunity`, `create-calendar-proposal`, `create-composition-contract`, `create-content-opportunity`, `create-distribution-record-from-content-item`, `create-final-reel-upload`, `create-ideation-calendar-proposal`, `create-reel-distribution-draft`, `create-shot-source-asset-upload`, `create-video-project`, `create-video-shot`, `delete-video-shot`, `detect-input-conflicts`, `execute-destructive`, `finalize-phase-1`, `generate-ad-creative-variants`, `generate-ad-static-asset`, `generate-ai-background-image`, `generate-avatar-asset`, `generate-carousel-assets`, `generate-carousel-slide`, `generate-content-brief`, `generate-content-opportunities`, `generate-execution-config`, `generate-feed-post-asset`, `generate-phase-1`, `generate-phase-1-file`, `generate-phase-2`, `generate-phase-3`, `generate-phase-3-slot`, `generate-production-brief`, `generate-story-assets`, `generate-video-storyboard`, `handoff-video-project`, `ingest-content-source`, `launch-ad-campaign`, `list-higgsfield-motions`, `manage-ad-brief`, `plan-destructive`, `preview-phase-3-scope`, `publish-instagram-asset`, `regenerate-asset-frame`, `regenerate-video-shot`, `resolve-input-conflict`, `retry-shot-still-image`, `retry-shot-video`, `review-content-brief`, `review-final-reel`, `route-content-brief-to-studio`, `run-association-os`, `run-avatar-appearance`, `run-avatar-asset-library`, `run-avatar-operating-context`, `run-avatar-os`, `run-avatar-strategy`, `run-avatar-world`, `run-brand-strategist`, `run-campaign-intelligence`, `run-competitor-os`, `run-ideation`, `run-market-os`, `run-offers`, `score-content-opportunity`, `score-ideation-candidates`, `select-reel-production-strategy`, `send-production-brief-to-contractor`, `set-ad-budget-policy`, `set-client-distribution-policy`, `set-production-brief-mode`, `start-carousel-generation`, `start-phase-3-scope`, `submit-production-review`, `submit-shot-generation`, `submit-shot-still-image`, `update-ad-campaign-budget`, `update-ad-campaign-status`, `update-calendar-proposal-slot`, `update-composition-contract`, `update-content-opportunity-status`, `update-video-project-status`, `update-video-shot`.

Evidence examples:

- Central invocation wrapper: `src/lib/supabase.ts:65` through `src/lib/supabase.ts:76`.
- Dynamic AI image function map: `src/lib/api.ts:1507` through `src/lib/api.ts:1512`.
- Dynamic Intelligence retry map: `src/lib/intelligence.ts:305` through `src/lib/intelligence.ts:320`.

### Functions Not Called By UI

19 local functions were not found as current direct/resolved frontend callers:

`apify-scrape`, `brief-generator`, `collect-instagram-insights`, `dialog360-send`, `meta-ad-ops`, `meta-webhook`, `mjr-generate`, `mrr-calc`, `onboarding`, `payfast-create-link`, `payfast-webhook`, `process-asset-generation-jobs`, `process-scheduled-publishing`, `process-source-document`, `publish-playbook-version`, `record-context-file-provenance`, `record-research-run`, `register-source-document`, `validate-execution-pack`.

Interpretation:

- Correctly not UI-called background workers: `collect-instagram-insights`, `process-scheduled-publishing`, `process-asset-generation-jobs`.
- Internally/page-adjacent helpers needing owner documentation: `process-source-document`, `publish-playbook-version`, `record-context-file-provenance`, `record-research-run`, `register-source-document`, `validate-execution-pack`.
- Legacy/superseded functions that should remain unreachable: `apify-scrape`, `brief-generator`, `dialog360-send`, `meta-ad-ops`, `meta-webhook`, `mjr-generate`, `mrr-calc`, `onboarding`, `payfast-create-link`, `payfast-webhook`.

### Function-to-Function Calls

Only three function-to-function call sites were found in local Edge Function source:

| Target function | Caller | Status |
| --- | --- | --- |
| `validate-execution-pack` | `generate-phase-2` | Current internal validation call. |
| `validate-execution-pack` | `generate-phase-3` | Current internal validation call. |
| `onboarding` | `payfast-webhook` | Legacy/superseded PayFast path; should remain retired. |

Evidence:

- `generate-phase-2` invokes `validate-execution-pack`: `supabase/functions/generate-phase-2/index.ts:273`.
- `generate-phase-3` invokes `validate-execution-pack`: `supabase/functions/generate-phase-3/index.ts:750`.
- `payfast-webhook` invokes `onboarding`: `supabase/functions/payfast-webhook/index.ts:117`.

## 4. Function-by-Function Findings

Phase 10 does not repeat every phase-level finding. The reconciled function-level posture is:

- All current authority-generation modules are represented in audits and remain review-gated in design.
- The highest-risk active functions are those that combine service-role access with insufficient client-scope validation or non-transactional authority transitions.
- Legacy functions are not currently wired into the active UI, but remain locally deployable.
- Background workers are mostly designed as bounded secret-gated jobs, but deployment posture is not consistently versioned in local config.
- Test coverage is uneven; many high-impact functions are covered only indirectly or through docs/smoke evidence.

## 5. Configuration Checklist

| Check | Result | Notes |
| --- | --- | --- |
| 109 local functions inventoried | Pass | `find supabase/functions -mindepth 1 -maxdepth 1 -type d -not -name _shared` count is 109. |
| Every function covered by at least one phase | Pass | No local function was missing from Phase 01-09 docs. |
| UI caller map reconciled | Pass | 90 UI-called, 19 not UI-called. |
| Function-to-function calls reconciled | Pass | Only `validate-execution-pack` and legacy `onboarding` internal calls found. |
| JWT-disabled local config reconciled | Partial | Local `supabase/config.toml` declares only `collect-instagram-insights`; prior docs say `process-asset-generation-jobs` is also JWT-disabled remotely. |
| Background workers have clear owner registry | Partial | Source/docs explain some workers, but no single canonical registry exists. |
| Legacy functions quarantined | Partial | Tests/docs guard several paths, but legacy function folders remain deployable. |
| Test coverage reconciled | Partial | 64 local functions were not found by simple name in local tests. |

## 6. Security / Auth / RLS Notes

Cross-phase security themes:

- P1: Several service-role functions are role-gated but not client-access gated, especially in production/reel/distribution paths. See Phases 05, 06, and 07.
- P1: `validate-execution-pack` performs service-role reads/writes by supplied `client_id` without caller/client access validation. See Phase 09.
- P1: Legacy webhook/messaging/payment/reporting functions are unsafe if reachable and should stay retired. See Phase 08.
- P2: Background workers rely on `CRON_SECRET`; this is acceptable only with documented deployment posture and rotation rules.
- P2: Uploaded asset/input paths should be ownership-validated server-side before provider use.
- P2: Existing approval immutability guards are stronger in some modules than others; Offers, Campaign Intelligence, and content/brief replacement flows need the same standard.

## 7. Secrets / Environment Variables Required

### Secrets Matrix

| Secret/config | Functions observed using it | Notes |
| --- | --- | --- |
| `CRON_SECRET` | `collect-instagram-insights`, `process-asset-generation-jobs`, `process-scheduled-publishing` | Worker protection; deployment posture should be in a registry. |
| `OPENAI_API_KEY` | `check-ai-background-image`, `generate-ai-background-image`, `generate-carousel-slide`, `process-asset-generation-jobs`, `regenerate-asset-frame`, `start-carousel-generation` | Image generation and status checks. Shared helper may also read image model/quality vars. |
| `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_SIZE_DEFAULT`, `OPENAI_IMAGE_QUALITY_DEFAULT` | `generate-ai-background-image` | AI background image configuration. |
| `AA_AI_MODEL` | `generate-phase-1-file` | Context generation model. |
| `AA_PHASE2_AI_MODEL` | `generate-phase-2`, `generate-phase-3`, `generate-production-brief` | Execution/production generation model. |
| `AA_PRODUCTION_BRIEF_AI_MODEL` | `generate-production-brief`, `generate-video-storyboard`, `regenerate-video-shot` | Production brief/storyboard model override. |
| `AA_STORYBOARD_AI_MODEL` | `generate-video-storyboard`, `regenerate-video-shot` | Reel/video storyboard model override. |
| `OPENAI_MARKET_RESEARCH_MODEL` | `run-market-os`, `run-association-os`, `run-avatar-os`, `run-competitor-os` | Intelligence research fallback/shared model. |
| `OPENAI_ASSOCIATION_RESEARCH_MODEL` | `run-association-os` | Association OS model override. |
| `OPENAI_AVATAR_RESEARCH_MODEL` | `run-avatar-os` | Legacy Intelligence Avatar OS model override. |
| `OPENAI_COMPETITOR_RESEARCH_MODEL` | `run-competitor-os` | Competitor OS model override. |
| `OPENAI_BRAND_STRATEGIST_MODEL` | `run-brand-strategist` | Brand Strategist model override. |
| `SUPABASE_ANON_KEY` | `publish-playbook-version` | Used to verify caller JWT before service-role playbook write. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PRODUCTION_REPLY_TO` | `send-production-brief-to-contractor` | Contractor handoff email path. |
| `AA_META_AD_ACCOUNT` | `meta-ad-ops` | Legacy Meta path; should remain retired. |
| `AA_META_VERIFY_TOKEN` | `meta-webhook` | Legacy/public webhook verification only; POST signature verification missing in legacy function. |
| `AA_PAYFAST_SANDBOX`, `AA_PUBLIC_BASE_URL`, `AA_PAYFAST_NOTIFY_URL`, `SUPABASE_URL` | `payfast-create-link`, `payfast-webhook` | Deprecated PayFast/ZAR path. |
| `AA_APIFY_ACTOR` | `apify-scrape` | Legacy scraping path. |
| `AA_CLAUDE_MODEL` | `brief-generator`, `mjr-generate` | Legacy generation paths. |
| `AA_N8N_ONBOARDING_WEBHOOK` | `onboarding` | Legacy onboarding integration. |

This matrix is based on local `Deno.env.get(...)` reads in function source. It does not verify remote secret presence.

## 8. Database Tables / Storage Buckets Touched

The function layer touches most current Cockpit domains:

- Client/context tables: `clients`, `client_inputs`, `client_context_files`, source/provenance tables.
- Intelligence tables: OS runs, releases, steps, findings, evidence, active release pointers.
- Offers and Avatars tables: offer/avatar releases, components, assets, active-release pointers.
- Ideation and supply tables: content sources, opportunities, proposals, content items, content briefs.
- Production tables: execution files, masters, calendar cells, production briefs, production jobs, client assets, asset generation jobs/items.
- Reel Studio tables: video projects, shots, deliverables, composition contracts, shot source assets.
- Distribution/Paid tables: distribution records, publish attempts, metric snapshots, ad opportunities/briefs/campaigns/budget policies.
- Operational tables: activity/audit logs, exception queues, policies.

Storage buckets referenced by audited current flows:

- `client-assets`
- `video-assets`

Legacy functions may reference old tables such as `entities`, `campaigns`, `briefs`, `assets`, `payments`, `deposits`, `conversations`, `messages`, or `leads`; those are not current authority.

## 9. Error Handling / Retry / Idempotency Notes

Strong patterns found:

- Split generation and scoped workers reduce edge timeout exposure.
- Many current functions write draft/needs-review outputs rather than auto-approving.
- Scheduled publishing and asset generation use DB claim/retry patterns.
- Reel Studio retry paths preserve source assets and have explicit state transitions.

Recurring gaps:

- Some authority promotion flows supersede existing approved/active rows before replacement is guaranteed.
- Some multi-step writes need transactional RPCs.
- Some retry cleanup paths ignore delete/update failures before requeueing.
- Some finalizers can leave rows/runs in misleading terminal states.
- Some background/cron functions need explicit method gates.

## 10. CORS / Method / Input Validation Notes

Cross-phase posture:

- Most current functions handle OPTIONS and enforce POST.
- Worker functions are generally secret-gated before service-role DB access.
- Legacy functions are inconsistent and should not be reactivated as-is.
- Phase 09 identified `collect-instagram-insights` and `process-asset-generation-jobs` as needing explicit POST-only gates even though they are cron-secret protected.
- Several current functions rely on database constraints for validation that could be reported earlier and more clearly at the API boundary.

## 11. Frontend Caller Mapping

High-level UI ownership by library:

- `src/lib/api.ts`: context, execution, creation, assets, Reel Studio, publishing, ideation commit/scoring.
- `src/lib/intelligence.ts`: Market OS, Avatar OS, Competitor OS, Association OS, Brand Strategist.
- `src/lib/campaign-intelligence.ts`: Campaign Intelligence.
- `src/lib/offers.ts`: Offers.
- `src/lib/avatar-os.ts`: Avatar Strategy, Appearance, World, Operating Context, Asset Library, Avatar Assets.
- `src/lib/supply.ts`: Content Supply and opportunities.
- `src/lib/calendar-planning.ts`: Calendar proposal lifecycle.
- `src/lib/ad-studio.ts`: Ad Studio.
- `src/lib/reel-production.ts`: Reel production preparation and composition contracts.
- `src/lib/distribution-policy.ts`: Distribution policy and distribution record creation.
- `src/lib/production-studio.ts`: Content brief routing and production review.

Functions with no UI caller should be treated as one of:

- background worker,
- internal function-to-function helper,
- operator/admin helper needing explicit owner documentation,
- retired/legacy function.

## 12. Tests / Existing Coverage

### Test Coverage Matrix

Local test-name scan found 64 functions with no direct function-name mention in `tests`:

`approve-calendar-proposal`, `approve-execution-config`, `check-ai-background-image`, `collect-instagram-insights`, `confirm-shot-source-asset-upload`, `create-ad-campaign`, `create-ad-opportunity`, `create-calendar-proposal`, `create-composition-contract`, `create-content-opportunity`, `create-distribution-record-from-content-item`, `create-shot-source-asset-upload`, `create-video-shot`, `detect-input-conflicts`, `execute-destructive`, `generate-ad-creative-variants`, `generate-ad-static-asset`, `generate-ai-background-image`, `generate-carousel-assets`, `generate-carousel-slide`, `generate-content-brief`, `generate-content-opportunities`, `generate-feed-post-asset`, `generate-phase-3`, `generate-phase-3-slot`, `generate-production-brief`, `generate-story-assets`, `ingest-content-source`, `launch-ad-campaign`, `list-higgsfield-motions`, `manage-ad-brief`, `meta-webhook`, `payfast-create-link`, `payfast-webhook`, `plan-destructive`, `preview-phase-3-scope`, `process-asset-generation-jobs`, `process-source-document`, `publish-instagram-asset`, `publish-playbook-version`, `record-context-file-provenance`, `record-research-run`, `regenerate-asset-frame`, `register-source-document`, `resolve-input-conflict`, `review-content-brief`, `route-content-brief-to-studio`, `score-content-opportunity`, `select-reel-production-strategy`, `send-production-brief-to-contractor`, `set-ad-budget-policy`, `set-client-distribution-policy`, `set-production-brief-mode`, `start-carousel-generation`, `start-phase-3-scope`, `submit-production-review`, `update-ad-campaign-budget`, `update-ad-campaign-status`, `update-calendar-proposal-slot`, `update-composition-contract`, `update-content-opportunity-status`, `update-video-project-status`, `update-video-shot`, `validate-execution-pack`.

Important caveat:

- This is a name-based local scan, not proof that behavior is untested. Some coverage may exist through shared helper tests, UI smoke scripts, docs, or live-testing reports.
- Still, the list is useful as a prioritization signal: high-impact functions in this list should get direct regression tests before risky refactors or remediation.

Existing useful guardrail tests/docs:

- Stage A readiness guards retired API wrappers.
- Phase 1 and citation/quantity tests cover important context/execution invariants.
- Prior stage deployment reports document Reel Studio and production smoke results.
- The audit docs now provide a full static risk baseline.

## 13. Suggested Upgrades

### Recommended Upgrade Backlog

Priority 0 - Control plane before fixes:

1. Create an Edge Function registry that records owner/page, expected caller, public/private posture, JWT posture, cron/webhook secret requirement, deployment status, secrets, and retirement state.
2. Add a static check that every local function appears in the registry and that registry JWT posture matches `supabase/config.toml` where versioned config is expected.

Priority 1 - Active security/correctness fixes:

3. Add caller/client access validation or internal-secret gating to `validate-execution-pack`.
4. Add client-scope validation to role-gated service-role production, Reel Studio, and distribution functions where the audit found global staff-role assumptions.
5. Fix active authority replacement flows so existing approved/active authority is not demoted until replacement insertion/activation succeeds.
6. Add transactional RPCs for `publish-playbook-version`, `process-source-document`, `handoff-video-project`, and other multi-step state transitions called out in Phases 05-09.
7. Re-check current distribution approval policy at scheduled publish time and manual publish time.
8. Fix paid-launch partial-success behavior so a Meta campaign cannot be activated if required child objects fail.

Priority 2 - Worker/deployment hardening:

9. Reconcile `process-asset-generation-jobs` local config versus documented remote `verify_jwt=false` posture.
10. Add explicit POST gates to cron workers that currently accept any non-OPTIONS method with a valid cron secret.
11. Verify remote deployment status for legacy functions, held destructive functions, and background workers in a separate non-read-only remediation/smoke phase.
12. Add run-finalization failure handling to `collect-instagram-insights`.

Priority 3 - Legacy retirement:

13. Move superseded functions out of deployable `supabase/functions`, or hard-disable/tombstone them with explicit non-deployment docs.
14. Extend Stage A readiness guards to include `payfast-create-link` and `payfast-webhook` if they are intended to remain retired.

Priority 4 - Tests and observability:

15. Add regression tests for access denial on supplied `client_id`.
16. Add transactional failure tests for active/supersede flows.
17. Add retry/concurrency tests for scoped Phase 3, source document processing, asset generation jobs, scheduled publishing, and Reel Studio provider state.
18. Add provider failure and stuck-state recovery tests for OpenAI/Higgsfield/Meta/Resend paths.

## 14. Open Questions

- Should `validate-execution-pack` be directly operator-callable, or should it become internal-only behind function-to-function authorization?
- Are `admin`, `account_manager`, and `editor` roles globally scoped across all clients, or should every service-role function also validate client assignment?
- Is `process-asset-generation-jobs` intentionally managed outside local `supabase/config.toml`, or should its JWT-disabled posture be versioned?
- Which functions are deployed remotely today, and are any legacy functions unexpectedly live?
- Should Stage P legacy retirement move the retired functions into an archive outside `supabase/functions`?
- Should destructive functions be visible in the UI while source comments still carry held-deployment language?
- What is the required minimum test bar before applying the P1 remediation backlog?

## 15. Overall Phase Risk Rating

Risk rating: High.

Reasoning:

- Coverage is complete: all 109 local functions have been audited across Phases 01-09.
- The system has strong architectural patterns: review-gated authority, split generation, scoped workers, cron secrets, and shared provider helpers.
- However, the cross-phase risk register includes several active P1 issues: service-role functions without client access gates, non-transactional authority promotion/demotion flows, distribution/paid paths that can drift from policy or provider state, and legacy functions that remain deployable.
- The recommended next move is not broad refactoring. It is a controlled remediation plan that first creates the function registry, then addresses the active P1 fixes with tests.
