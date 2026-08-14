# Edge Function Audit - Phase 09: Background, Internal, Orphan, and Legacy Functions

Date: 2026-08-13
Mode: Read-only audit

## 1. Phase Scope

This phase audited background workers, internally-invoked helpers, functions with unclear UI page ownership, and local superseded-era functions that should not be treated as current product surfaces.

Scoped functions:

- `publish-playbook-version`
- `collect-instagram-insights`
- `process-scheduled-publishing`
- `process-asset-generation-jobs`
- `generate-feed-post-asset`
- `generate-carousel-assets`
- `generate-story-assets`
- `generate-ad-static-asset`
- `process-source-document`
- `register-source-document`
- `record-context-file-provenance`
- `record-research-run`
- `validate-execution-pack`
- `apify-scrape`
- `brief-generator`
- `dialog360-send`
- `meta-ad-ops`
- `meta-webhook`
- `mjr-generate`
- `mrr-calc`
- `onboarding`
- `payfast-create-link`
- `payfast-webhook`

Primary UI/system areas:

- Background operations
- Scheduled publishing and scheduled metric collection
- Asset-generation background recovery
- Internal source/provenance helpers
- Legacy local-only functions
- Function ownership and deployability hygiene

Audit emphasis:

- Confirm whether each candidate is still active.
- Identify orphaned functions.
- Identify functions that should be deployed only as internal/background jobs.
- Identify functions that need explicit documentation before further use.

This audit did not invoke live functions and did not make source, schema, configuration, deployment, database, or storage changes. The only output is this saved audit document.

## 2. Functions Audited

| Function | Role | Current posture |
| --- | --- | --- |
| `publish-playbook-version` | Freezes mutable playbook content into immutable `playbook_versions` authority. | Active Stage C helper; role-gated, but activation should be transactional. |
| `collect-instagram-insights` | Cron-style worker that collects due Instagram insight snapshots. | Active background worker; secret-gated before service role. |
| `process-scheduled-publishing` | Cron-style worker that publishes due distribution records. | Active background worker; secret-gated before service role and uses DB claim/recovery RPCs. |
| `process-asset-generation-jobs` | Cron-style safety-net worker for queued multi-image asset jobs. | Active background worker; secret-gated before service role, but local config does not declare its JWT-disabled deployment posture. |
| `generate-feed-post-asset` | Direct single-image AI asset wrapper for approved feed-post briefs. | Active/compatible wrapper around shared helper; role-gated but client-scope policy should be confirmed. |
| `generate-ad-static-asset` | Direct single-image AI asset wrapper for approved static-ad briefs. | Active/compatible wrapper around shared helper; same scope caveat as feed post. |
| `generate-carousel-assets` | Old synchronous carousel wrapper. | Retired by code path; returns 410 and points to persisted job model. |
| `generate-story-assets` | Old synchronous story-sequence wrapper. | Retired by code path; returns 410 and points to persisted job model. |
| `register-source-document` | Registers source-document metadata/text for later extraction. | Internal/page-adjacent helper; access-gated and deduped. |
| `process-source-document` | Extracts/chunks registered source text into document chunks. | Internal/page-adjacent helper; access-gated after document lookup, but has concurrency/transaction gaps. |
| `record-context-file-provenance` | Rebuilds derived context-file citations and playbook links. | Internal provenance helper; access-gated and preserves human-approved inferences. |
| `record-research-run` | Records operator-supplied research sources with provenance. | Internal/page-adjacent helper; access-gated, but has stale domain/idempotency edges. |
| `validate-execution-pack` | Deterministically validates Phase 2 execution files and Phase 3 master/calendar packs. | Internally invoked by `generate-phase-2`, but direct endpoint lacks caller/client access validation. |
| Legacy local functions | `apify-scrape`, `brief-generator`, `dialog360-send`, `meta-ad-ops`, `meta-webhook`, `mjr-generate`, `mrr-calc`, `onboarding`, `payfast-create-link`, `payfast-webhook`. | Superseded-era/local-only or legacy paths already identified by Stage A/Audit 08; do not reactivate without a deliberate legacy-retirement decision. |

## 3. UI Page / System Role

Current ownership buckets:

- Background workers: `collect-instagram-insights`, `process-scheduled-publishing`, `process-asset-generation-jobs`.
- Internal authority/provenance helpers: `publish-playbook-version`, `register-source-document`, `process-source-document`, `record-context-file-provenance`, `record-research-run`, `validate-execution-pack`.
- Direct/compatibility production wrappers: `generate-feed-post-asset`, `generate-ad-static-asset`, `generate-carousel-assets`, `generate-story-assets`.
- Superseded legacy/local-only functions: `apify-scrape`, `brief-generator`, `dialog360-send`, `meta-ad-ops`, `meta-webhook`, `mjr-generate`, `mrr-calc`, `onboarding`, `payfast-create-link`, `payfast-webhook`.

Caller mapping found in this audit:

- `generate-phase-2` invokes `validate-execution-pack` after generating Phase 2 outputs: `supabase/functions/generate-phase-2/index.ts:273`.
- `process-scheduled-publishing` is documented as the canonical scheduled publishing worker in `docs/operations/provider-runbook.md` and `docs/operations/architecture-guide.md`.
- `collect-instagram-insights` is documented as a live/deployed insights worker in `docs/programme/status/Stage_M_Status.md`.
- `process-asset-generation-jobs` is documented as a cron safety net in source comments and Phase 05 audit docs.
- `tests/stage-a-readiness.test.ts:18` through `tests/stage-a-readiness.test.ts:27` list several retired functions, and `tests/stage-a-readiness.test.ts:51` through `tests/stage-a-readiness.test.ts:65` guard against reintroducing them into `src/lib/api.ts`.

## 4. Function-by-Function Findings

### P1: `validate-execution-pack` performs service-role client reads without validating caller/client access

Affected function:

- `validate-execution-pack`

Positive findings:

- The function is deterministic and does not call AI or external providers.
- It performs valuable structural checks for execution files, master rows, calendar cells, content honesty, and approval/live-status consistency.
- It is used internally by `generate-phase-2`.

Issue:

- The endpoint accepts `client_id` and `execution_month`, then creates a service-role client and queries client execution/master tables without validating the caller's user, role, or client access.
- It also writes validation activity rows through `writeActivity`.
- If directly reachable by any valid JWT under default `verify_jwt = true`, a caller could validate or inspect counts/errors for a client they do not own or operate.

Evidence:

- Request body accepts `client_id` and `execution_month`: `supabase/functions/validate-execution-pack/index.ts:75`.
- Service-role client is created before any caller/client access check: `supabase/functions/validate-execution-pack/index.ts:90`.
- Client-scoped tables are queried by supplied `client_id`: `supabase/functions/validate-execution-pack/index.ts:95` through `supabase/functions/validate-execution-pack/index.ts:102`.
- Activity writes are performed for the supplied client: `supabase/functions/validate-execution-pack/index.ts:54` through `supabase/functions/validate-execution-pack/index.ts:68`.

Suggested upgrade:

- Add the same client/operator access validation used by current authority functions, or make this endpoint internal-only with an explicit function secret when invoked by another Edge Function.
- Preserve the validation contract exactly; this is an access-control fix, not a change to what the function validates.

### P1: `publish-playbook-version` can temporarily remove active playbook authority if activation fails after superseding the current version

Affected function:

- `publish-playbook-version`

Positive findings:

- Playbooks are correctly treated as AA methodology rather than client data, so access is role-gated instead of client-scoped.
- The function refuses empty playbooks and dedupes unchanged content by `content_hash`.
- Service-role writes happen only after authentication and staff-role validation.

Issue:

- Activation supersedes the current active version first, then activates the newly inserted draft.
- If activation of the new version fails after the supersede update succeeds, the function deletes the new version but does not restore the previously active version.
- That can leave a playbook with no active authority version, even though the function returns an activation failure.

Evidence:

- Existing active versions are set to `superseded`: `supabase/functions/publish-playbook-version/index.ts:94` through `supabase/functions/publish-playbook-version/index.ts:101`.
- On activation failure, only the newly created version is deleted: `supabase/functions/publish-playbook-version/index.ts:106` through `supabase/functions/publish-playbook-version/index.ts:112`.

Suggested upgrade:

- Move the publish/supersede/activate sequence into a transactional RPC that either fully promotes the new active version or leaves the previous active version untouched.
- Keep the same public contract and same role gate.

### P2: `process-source-document` is access-gated, but lookup/concurrency/transaction boundaries are weak

Affected function:

- `process-source-document`

Positive findings:

- It is narrow and deterministic.
- It validates method and body shape.
- It records extraction failures and avoids leaving rows stuck in `extracting`.
- It validates caller access before extraction/chunk writes.

Issues:

- It loads `client_source_documents` with the service-role client before validating caller access, then uses the loaded `client_id` for authorization. That can reveal whether a guessed document id exists.
- Its `processing_status = "extracting"` update is not checked for errors and does not include a claim precondition.
- Re-extraction deletes existing chunks and reinserts replacement chunks through multiple non-transactional calls.
- Concurrent calls can both process the same document and interleave delete/insert/update operations.

Evidence:

- Service-role document lookup precedes access validation: `supabase/functions/process-source-document/index.ts:59` through `supabase/functions/process-source-document/index.ts:69`.
- The `extracting` update has no error handling or conditional claim filter beyond `id`: `supabase/functions/process-source-document/index.ts:78` through `supabase/functions/process-source-document/index.ts:81`.
- Chunk replacement uses separate delete, insert, and status-update operations: `supabase/functions/process-source-document/index.ts:96` through `supabase/functions/process-source-document/index.ts:123`.

Suggested upgrade:

- Resolve accessible document ownership without leaking existence, or return a generic not-found/unauthorized response for inaccessible ids.
- Add an atomic claim precondition or RPC for extraction.
- Move delete/insert/status update into a single DB transaction/RPC.

### P2: Cron/background deployment posture is not fully captured in local config

Affected functions:

- `process-asset-generation-jobs`
- `collect-instagram-insights`
- `process-scheduled-publishing`

Positive findings:

- `collect-instagram-insights` checks `CRON_SECRET` before service-role creation or DB access.
- `process-scheduled-publishing` checks `CRON_SECRET` before service-role DB access and uses claim/recovery RPCs.
- `process-asset-generation-jobs` checks `CRON_SECRET` and `OPENAI_API_KEY` before service-role work and bounds each run by job count, item count, and wall-clock budget.

Issues:

- Local `supabase/config.toml` declares `collect-instagram-insights` as `verify_jwt = false`, but does not declare `process-asset-generation-jobs`, even though Stage A documentation says both deployed cron workers run with `verify_jwt: false`.
- `process-asset-generation-jobs` and `collect-instagram-insights` accept any non-OPTIONS method if the cron secret is correct. That is usually harmless, but a cron-only worker should be method-explicit.
- Documentation says `process-scheduled-publishing` keeps `verify_jwt: true` plus `x-cron-secret`. That is defensible, but it should be captured in a canonical worker registry so future operators do not normalize all cron workers to one JWT posture accidentally.

Evidence:

- Local config only declares `collect-instagram-insights`: `supabase/config.toml:3` through `supabase/config.toml:4`.
- Stage A says `process-asset-generation-jobs` and `collect-instagram-insights` run with `verify_jwt: false`: `docs/programme/status/Stage_A_Baseline_Report.md:86`.
- `process-asset-generation-jobs` source comment documents `verify_jwt=false + CRON_SECRET`: `supabase/functions/process-asset-generation-jobs/index.ts:7`.
- `collect-instagram-insights` source comment documents JWT-disabled deployment and cron protection: `supabase/functions/collect-instagram-insights/index.ts:1` through `supabase/functions/collect-instagram-insights/index.ts:3`.
- `process-scheduled-publishing` source comment documents cron worker reliability and secret-first behavior: `supabase/functions/process-scheduled-publishing/index.ts:1` through `supabase/functions/process-scheduled-publishing/index.ts:19`.

Suggested upgrade:

- Add a canonical worker/deployment registry in docs or config that states which functions are cron-only, which require JWT, which disable JWT, and which require `x-cron-secret`.
- Add explicit POST-only method gates to cron workers where missing.
- Do not change worker roles or scheduling behavior as part of this hardening.

### P2: Direct AI asset wrappers are safe-gated, but page ownership and client-scope policy should be made explicit

Affected functions:

- `generate-feed-post-asset`
- `generate-ad-static-asset`
- `generate-carousel-assets`
- `generate-story-assets`

Positive findings:

- The wrapper functions are intentionally thin and share one implementation.
- The shared helper authenticates the user and requires `admin`, `account_manager`, or `editor`.
- It requires an approved production brief and rejects `reel_video`.
- Synchronous multi-image generation is retired at runtime with HTTP 410, directing callers to the persisted job model.
- Failed direct generation attempts clean up uploaded storage paths and generated asset rows for the attempted group.

Issues:

- The shared helper checks staff role, but does not validate that the operator has access to the specific brief's client. This may be intentional for an internal operator system, but it should be explicit.
- The current architecture appears to prefer the persisted job model for multi-image generation. The direct wrapper functions should be documented as either active single-image entry points or compatibility wrappers.

Evidence:

- Thin wrappers: `supabase/functions/generate-feed-post-asset/index.ts:1` through `supabase/functions/generate-feed-post-asset/index.ts:3`, `supabase/functions/generate-ad-static-asset/index.ts:1` through `supabase/functions/generate-ad-static-asset/index.ts:3`.
- Staff-role gate: `supabase/functions/_shared/ai-asset-generation.ts:256` through `supabase/functions/_shared/ai-asset-generation.ts:262`.
- Approved-brief and format gates: `supabase/functions/_shared/ai-asset-generation.ts:278` through `supabase/functions/_shared/ai-asset-generation.ts:286`.
- Multi-image synchronous path returns 410: `supabase/functions/_shared/ai-asset-generation.ts:287` through `supabase/functions/_shared/ai-asset-generation.ts:293`.
- Cleanup on failure: `supabase/functions/_shared/ai-asset-generation.ts:382` through `supabase/functions/_shared/ai-asset-generation.ts:388`.

Suggested upgrade:

- Confirm and document whether staff roles are global across all clients. If not, add client-scope validation after loading the production brief and before marking it `producing`.
- Document `generate-feed-post-asset` and `generate-ad-static-asset` as current direct single-image functions, and `generate-carousel-assets` / `generate-story-assets` as compatibility wrappers that intentionally return 410.

### P2: Superseded-era local functions remain deployable from `supabase/functions`

Affected functions:

- `apify-scrape`
- `brief-generator`
- `dialog360-send`
- `meta-ad-ops`
- `meta-webhook`
- `mjr-generate`
- `mrr-calc`
- `onboarding`
- `payfast-create-link`
- `payfast-webhook`

Positive findings:

- Current active app code does not appear to invoke these functions.
- Stage A documentation identifies these as never-deployed superseded-era functions.
- Audit 08 already inspected the public/webhook/payment/reporting subset in detail.
- Readiness tests guard several retired functions from being wired back into `src/lib/api.ts`.

Issue:

- The function directories still live in the deployable `supabase/functions` tree.
- Their names can still be selected by an operator or script during deployment.
- Several encode old tables, old ZAR/PayFast/commercial assumptions, or old entities/campaigns/MRR-era workflows that are explicitly not current authority.

Evidence:

- Stage A classifies these ten functions as never-deployed superseded-era functions and recommends Stage P retirement: `docs/programme/status/Stage_A_Baseline_Report.md:84`.
- Stage A readiness tests list retired functions: `tests/stage-a-readiness.test.ts:18` through `tests/stage-a-readiness.test.ts:27`.
- Stage A readiness tests prevent active API wrapper reintroduction: `tests/stage-a-readiness.test.ts:51` through `tests/stage-a-readiness.test.ts:73`.
- Audit 08 documents public/webhook/payment/reporting risks for the legacy subset in `docs/edge-function-audits/phase-08-public-webhooks-payments-reporting.md`.

Suggested upgrade:

- In the planned legacy-retirement phase, move these out of the deploy path or hard-disable them with explicit tombstone documentation.
- Until then, maintain a do-not-deploy registry and keep the readiness tests.
- Do not modernize these functions into current workflows unless a separate build explicitly redefines their original objective.

### P3: `record-research-run` still has stale allowlist and idempotency edges from Audit 02

Affected function:

- `record-research-run`

Positive findings:

- It records supplied evidence rather than generating research sources.
- It rejects empty research runs.
- It validates source URL/title/evidence/confidence/retrieved timestamp before writing.
- It validates client access before service-role writes.

Issues:

- The hard-coded domain allowlist reflects older research domains and may not align with newer Intelligence OS domains.
- Duplicate idempotency is checked before insert, but concurrent requests can still race between lookup and insert.
- If sources insert successfully but final run completion fails, the run can remain `running`.

Evidence:

- Domain allowlist: `supabase/functions/record-research-run/index.ts:15` through `supabase/functions/record-research-run/index.ts:21`.
- Duplicate lookup before insert: `supabase/functions/record-research-run/index.ts:68` through `supabase/functions/record-research-run/index.ts:77`.
- Completion update after source insert: `supabase/functions/record-research-run/index.ts:112` through `supabase/functions/record-research-run/index.ts:115`.
- Audit 02 already recorded this as a P2/P3 edge in `docs/edge-function-audits/phase-02-intelligence-os.md`.

Suggested upgrade:

- Align the allowlist to the current research taxonomy.
- Add duplicate-key recovery around the run insert.
- On completion failure, move the run to a retryable failed state or complete it through a transactional RPC.

### Positive: `record-context-file-provenance` preserves human-approved inferences

Affected function:

- `record-context-file-provenance`

Positive findings:

- The function validates client access before writing derived provenance.
- It records only derived source provenance from client inputs, extracted documents, research sources, and active playbook versions.
- It explicitly preserves `approved_inference` rows when rebuilding derived citations.
- It writes playbook authority links with active playbook version ids and hashes.

Evidence:

- Access validation: `supabase/functions/record-context-file-provenance/index.ts:36` through `supabase/functions/record-context-file-provenance/index.ts:39`.
- Derived citation rebuild preserves approved inferences: `supabase/functions/record-context-file-provenance/index.ts:102` through `supabase/functions/record-context-file-provenance/index.ts:109`.
- Playbook link upsert: `supabase/functions/record-context-file-provenance/index.ts:117` through `supabase/functions/record-context-file-provenance/index.ts:133`.

Suggested upgrade:

- Add this function to a documented internal-helper registry, including which page or generation path is allowed to invoke it.

### Positive: `register-source-document` is narrow, access-gated, and deduped

Affected function:

- `register-source-document`

Positive findings:

- The function validates method, JSON, source kind, locator presence, and client access.
- It hashes the most specific available content/locator for per-client dedupe.
- Inline text is stored as pending, not falsely marked extracted.
- It handles duplicate insert races by re-querying the existing document.

Evidence:

- Source kind and locator validation: `supabase/functions/register-source-document/index.ts:34` through `supabase/functions/register-source-document/index.ts:49`.
- Access validation: `supabase/functions/register-source-document/index.ts:51` through `supabase/functions/register-source-document/index.ts:52`.
- Hash/dedupe flow: `supabase/functions/register-source-document/index.ts:56` through `supabase/functions/register-source-document/index.ts:74`.
- Inline text remains pending for separate extraction: `supabase/functions/register-source-document/index.ts:88` through `supabase/functions/register-source-document/index.ts:91`.

Suggested upgrade:

- Document its UI/page owner and expected next call to `process-source-document`.

## 5. Configuration Checklist

| Item | Status | Notes |
| --- | --- | --- |
| JWT-disabled functions declared locally | Partial | `collect-instagram-insights` is declared in `supabase/config.toml`; `process-asset-generation-jobs` is not, despite Stage A documentation saying it is JWT-disabled remotely. |
| Cron secret first | Mostly pass | `collect-instagram-insights`, `process-scheduled-publishing`, and `process-asset-generation-jobs` check `CRON_SECRET` before service-role work. |
| Explicit HTTP methods | Partial | Most helpers are POST-only; `collect-instagram-insights` and `process-asset-generation-jobs` should add explicit POST gates. |
| Legacy deployability | Partial | Retired functions are guarded in tests/docs but still exist under `supabase/functions`. |
| Internal helper ownership | Partial | Several helpers are well-authored but lack a single canonical owner/allowed-caller registry. |

## 6. Security / Auth / RLS Notes

- `validate-execution-pack` is the highest security concern in this phase because it performs service-role reads/writes for supplied `client_id` without caller/client access validation.
- `publish-playbook-version` is role-gated correctly for non-client methodology authority.
- `process-source-document`, `register-source-document`, `record-context-file-provenance`, and `record-research-run` validate client access before writes.
- `process-source-document` still performs a service-role document lookup before access validation, creating a small existence-leak risk.
- Background workers rely on `CRON_SECRET`; this is acceptable only if deployment posture and secret rotation are documented and verified.
- Legacy functions should be treated as not-current and not deployed.

## 7. Secrets / Environment Variables Required

| Function(s) | Required secrets/config |
| --- | --- |
| `collect-instagram-insights` | `CRON_SECRET`; Meta config/token resolution through shared Instagram config. |
| `process-scheduled-publishing` | `CRON_SECRET`; Meta/Instagram publishing config through shared helpers. |
| `process-asset-generation-jobs` | `CRON_SECRET`, `OPENAI_API_KEY`, optional `OPENAI_IMAGE_MODEL`, optional `OPENAI_IMAGE_QUALITY`. |
| Direct asset wrappers | `OPENAI_API_KEY`, optional `OPENAI_IMAGE_MODEL`, optional `OPENAI_IMAGE_QUALITY`. |
| `publish-playbook-version` | `SUPABASE_ANON_KEY` for user auth check plus service-role environment from shared helper. |
| Source/provenance helpers | Standard Supabase service-role environment from shared helper. |
| Legacy PayFast/Meta/Dialog/Apify functions | Legacy secrets if ever deployed, but current posture should be do-not-deploy. |

## 8. Database Tables / Storage Buckets Touched

Primary tables touched by active/background/internal functions:

- `playbooks`
- `playbook_versions`
- `client_distribution_records`
- `client_publish_attempts`
- `client_metric_snapshots`
- `client_insights_collection_runs`
- `client_insights_collection_attempts`
- `client_asset_generation_jobs`
- `client_asset_generation_items`
- `client_assets`
- `client_production_briefs`
- `client_source_documents`
- `client_document_chunks`
- `client_context_files`
- `client_context_file_citations`
- `client_context_file_playbooks`
- `client_research_runs`
- `client_research_sources`
- `activity_log`

Storage buckets:

- `client-assets`

Legacy functions may reference older absent/superseded tables such as `entities`, `campaigns`, `briefs`, `assets`, `deposits`, `payments`, `leads`, `conversations`, or `messages`; those are not current authority.

## 9. Error Handling / Retry / Idempotency Notes

- `process-scheduled-publishing` has strong recovery semantics: stale recovery, atomic claims, retry caps, automation holds, exception filing, and no blind republish after evidence exists.
- `process-asset-generation-jobs` uses bounded processing and shared item-level claim/persistence logic.
- `collect-instagram-insights` records per-attempt failures and completes runs with error counts.
- `publish-playbook-version` needs transactional activation to avoid losing active authority on partial failure.
- `process-source-document` needs atomic claim and transactional chunk replacement.
- `record-research-run` needs duplicate-key race recovery and final-status failure handling.
- Direct asset wrappers perform cleanup on failed generation attempts.

## 10. CORS / Method / Input Validation Notes

- Most scoped active/internal functions handle OPTIONS and enforce POST.
- `collect-instagram-insights` handles OPTIONS but does not explicitly reject non-POST methods.
- `process-asset-generation-jobs` handles OPTIONS but does not explicitly reject non-POST methods.
- `publish-playbook-version`, `register-source-document`, `process-source-document`, `record-context-file-provenance`, `record-research-run`, and `validate-execution-pack` are POST-only.
- Direct asset wrappers enforce POST through the shared helper.

## 11. Frontend Caller Mapping

Direct frontend/page ownership remains uneven:

- `validate-execution-pack` is invoked by `generate-phase-2`, not directly by a page in the current audit evidence.
- `register-source-document`, `process-source-document`, `record-context-file-provenance`, and `record-research-run` appear internal/page-adjacent and should have allowed callers documented.
- `collect-instagram-insights`, `process-scheduled-publishing`, and `process-asset-generation-jobs` are worker functions and should not have normal user-facing page callers.
- Retired legacy functions are guarded against active API reintroduction by Stage A tests.

## 12. Tests / Existing Coverage

Existing useful coverage/evidence:

- `tests/stage-a-readiness.test.ts` guards several retired functions from active API reintroduction.
- Audit 01 already inspected `validate-execution-pack`, `record-context-file-provenance`, `register-source-document`, and `process-source-document`.
- Audit 02 already inspected `record-research-run`.
- Audit 05 already inspected the direct AI asset wrappers and `process-asset-generation-jobs`.
- Audit 07 already inspected scheduled publishing/paid/distribution paths.
- Audit 08 already inspected legacy public/webhook/payment/reporting functions.

Suggested additional coverage:

- Unit/integration test proving `validate-execution-pack` rejects a caller without access to the supplied `client_id`.
- Test proving `publish-playbook-version` preserves the old active version if activation fails.
- Test proving `process-source-document` rejects or serializes concurrent extraction attempts.
- Static test or script that ensures the worker deployment registry matches `supabase/config.toml`.
- Static test that all local-only legacy functions remain absent from active caller wrappers.

## 13. Suggested Upgrades

1. Add access validation or internal-secret gating to `validate-execution-pack`.
2. Move `publish-playbook-version` activation into one transactional RPC.
3. Add atomic claim/transaction handling to `process-source-document`.
4. Create a canonical worker/internal-helper registry covering JWT posture, cron secret requirement, allowed caller, and UI/system owner.
5. Reconcile `supabase/config.toml` with documented worker deployment posture, especially `process-asset-generation-jobs`.
6. Add explicit POST-only guards to cron workers that currently accept any non-OPTIONS request with a valid cron secret.
7. Document direct asset wrappers as active single-image wrappers and compatibility-retired multi-image wrappers.
8. Keep superseded-era functions on a legacy-retirement path; do not modernize or deploy them as part of this audit.

## 14. Open Questions

- Are `editor` users intended to have global access to every approved production brief, or should direct asset generation validate client scope after loading the brief?
- Should `validate-execution-pack` remain directly invokable by operators, or should it become an internal-only helper invoked only by generation functions?
- Should `process-asset-generation-jobs` be added to local `supabase/config.toml`, or is remote `verify_jwt=false` intentionally managed outside repo config?
- What is the planned Stage P date for moving superseded local-only functions out of the deployable function tree?
- Which page or admin workflow currently owns `register-source-document`, `process-source-document`, `record-context-file-provenance`, and `record-research-run`?

## 15. Overall Phase Risk Rating

Risk rating: Medium.

Reasoning:

- The active background workers are generally well-structured and fail closed behind cron secrets.
- The main correctness/security risks are concentrated in internal/helper functions with missing access checks or non-transactional multi-step writes.
- Legacy functions are not currently wired into the active frontend, but they remain deployable from the local function tree and should stay quarantined until a deliberate retirement pass.
