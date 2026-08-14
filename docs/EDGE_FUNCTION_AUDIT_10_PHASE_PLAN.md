# Edge Function Audit — 10 Phase Read-Only Plan

Status: planned
Created: 2026-08-13
Scope: all local Supabase Edge Functions in `supabase/functions`
Function count: 109, excluding `_shared`

## Purpose

Audit every Supabase Edge Function in the Cockpit repo to confirm each function is correctly configured, correctly routed from the UI or background system, and safe to operate.

This is a read-only audit programme. No code, schema, secret, deployment, or configuration changes should be made during any audit phase.

Each phase must produce a standalone analysis document saved in the repo. The phase document should explain the role of each function analysed, configuration findings, risk level, and suggested upgrades.

## Read-Only Rules

During all ten phases:

- Do not edit source files.
- Do not edit migrations.
- Do not edit Supabase config.
- Do not deploy functions.
- Do not apply migrations.
- Do not mutate the database.
- Do not create, update, or delete storage objects.
- Do not rotate, print, or modify secrets.
- Do not invoke functions against live data unless a later human-approved smoke-test phase is explicitly created outside this plan.
- Read local source, tests, docs, migrations, and frontend callers only.

The only write allowed in each phase is the phase analysis document itself.

## Standard Phase Output

Each phase must create one document under:

```text
docs/edge-function-audits/
```

Required sections for every phase document:

1. `Phase Scope`
2. `Functions Audited`
3. `UI Page / System Role`
4. `Function-by-Function Findings`
5. `Configuration Checklist`
6. `Security / Auth / RLS Notes`
7. `Secrets / Environment Variables Required`
8. `Database Tables / Storage Buckets Touched`
9. `Error Handling / Retry / Idempotency Notes`
10. `CORS / Method / Input Validation Notes`
11. `Frontend Caller Mapping`
12. `Tests / Existing Coverage`
13. `Suggested Upgrades`
14. `Open Questions`
15. `Overall Phase Risk Rating`

Use this risk scale:

- `Low`: configuration appears sound; only minor documentation or polish suggested.
- `Medium`: works conceptually but has meaningful hardening, test, or observability gaps.
- `High`: likely misconfigured, risky, unaudited live dependency, unsafe mutation path, or unclear authority boundary.
- `Blocked`: cannot assess from local source alone.

## Configuration Checklist

Every function should be checked for:

- Expected caller: UI page, background worker, webhook, scheduled job, or internal function.
- Public/private posture.
- Auth verification.
- Service-role usage and authorization guards.
- CORS handling.
- Allowed HTTP methods.
- Request body validation.
- Idempotency strategy.
- Retry behaviour.
- Timeout/provider failure handling.
- Error responses and stuck-state recovery.
- Audit logging.
- Secrets and environment variables.
- Database writes.
- Storage writes.
- RLS assumptions.
- Function-to-function calls.
- Tests covering expected behaviour.
- Whether it is currently called from frontend code.
- Whether it appears legacy, background-only, or orphaned.

## Phase 1 — Context, Destructive Planning, Execution Setup

Output document:

```text
docs/edge-function-audits/phase-01-context-execution-setup.md
```

Functions:

- `generate-phase-1`
- `generate-phase-1-file`
- `finalize-phase-1`
- `generate-phase-2`
- `validate-execution-pack`
- `generate-execution-config`
- `approve-execution-config`
- `record-context-file-provenance`
- `register-source-document`
- `process-source-document`
- `plan-destructive`
- `execute-destructive`

Primary UI/system area:

- Context
- Execution Contract
- destructive operation planning
- source-document processing

Audit emphasis:

- Confirm Phase 1 split generation remains safe and resumable.
- Confirm Phase 2 generation/validation does not bypass approval authority.
- Confirm destructive operations are planned, auditable, and explicit.
- Confirm source-document ingestion is not silently mutating approved authority.

## Phase 2 — Intelligence OS

Output document:

```text
docs/edge-function-audits/phase-02-intelligence-os.md
```

Functions:

- `run-market-os`
- `run-avatar-os`
- `run-competitor-os`
- `run-association-os`
- `run-brand-strategist`
- `run-campaign-intelligence`
- `record-research-run`

Primary UI/system area:

- Intelligence page
- Market OS
- Avatar OS
- Competitor OS
- Association OS
- Brand Strategist
- Campaign Intelligence

Audit emphasis:

- Confirm `prepare -> step -> finalize` orchestration is consistent.
- Confirm `retry_step` is correctly configured where expected.
- Confirm approved releases are immutable.
- Confirm draft outputs remain review-gated.
- Confirm upstream authority dependencies are enforced.
- Confirm source/evidence/finding cleanup is step-scoped.

## Phase 3 — Offers And Avatars

Output document:

```text
docs/edge-function-audits/phase-03-offers-avatars.md
```

Functions:

- `run-offers`
- `run-avatar-strategy`
- `run-avatar-appearance`
- `run-avatar-world`
- `run-avatar-operating-context`
- `run-avatar-asset-library`
- `generate-avatar-asset`

Primary UI/system area:

- Offer page
- Avatars page

Audit emphasis:

- Confirm Main Offers and Seasonal Offers remain separate.
- Confirm Seasonal Offers consume approved Campaign Intelligence and Main Offers only.
- Confirm Avatar OS outputs remain review-gated.
- Confirm asset generation consumes approved Avatar authority only.
- Confirm generated avatar assets are not treated as approved production references without review.

## Phase 4 — Ideation, Content Supply, Opportunity Pool, Calendar Planning

Output document:

```text
docs/edge-function-audits/phase-04-ideation-supply-calendar.md
```

Functions:

- `ingest-content-source`
- `create-content-opportunity`
- `detect-input-conflicts`
- `resolve-input-conflict`
- `generate-content-opportunities`
- `score-content-opportunity`
- `update-content-opportunity-status`
- `run-ideation`
- `score-ideation-candidates`
- `create-ideation-calendar-proposal`
- `create-calendar-proposal`
- `update-calendar-proposal-slot`
- `approve-calendar-proposal`
- `commit-ideation-content`
- `generate-content-brief`
- `review-content-brief`

Primary UI/system area:

- Ideation
- Content Supply
- Opportunity Pool
- Calendar Planning
- Content Items

Audit emphasis:

- Confirm Ideation source inputs are optional and provenance is preserved.
- Confirm approved authority is used, not draft authority.
- Confirm conflict detection is non-destructive until explicitly resolved.
- Confirm proposal approval and commit paths have authority-race protection.
- Confirm content brief generation remains review-gated.

## Phase 5 — Creation, Production Studio, Asset Generation

Output document:

```text
docs/edge-function-audits/phase-05-creation-production-assets.md
```

Functions:

- `generate-phase-3`
- `preview-phase-3-scope`
- `start-phase-3-scope`
- `generate-phase-3-slot`
- `generate-production-brief`
- `set-production-brief-mode`
- `send-production-brief-to-contractor`
- `route-content-brief-to-studio`
- `submit-production-review`
- `generate-ai-background-image`
- `check-ai-background-image`
- `start-carousel-generation`
- `generate-carousel-slide`
- `regenerate-asset-frame`
- `generate-video-storyboard`
- `generate-feed-post-asset`
- `generate-carousel-assets`
- `generate-story-assets`
- `generate-ad-static-asset`
- `process-asset-generation-jobs`

Primary UI/system area:

- Creation
- Content
- Content Briefs
- Production Studio
- Assets

Audit emphasis:

- Confirm content creation does not bypass approved briefs.
- Confirm AI asset generation has provider failure recovery.
- Confirm asset regeneration preserves versioning and provenance.
- Confirm background job processing cannot generate assets without valid source authority.
- Confirm contractor handoff remains blocked for AI-only flows unless explicitly allowed.

## Phase 6 — Reel Studio And Video Production

Output document:

```text
docs/edge-function-audits/phase-06-reel-studio-video.md
```

Functions:

- `select-reel-production-strategy`
- `create-composition-contract`
- `update-composition-contract`
- `create-shot-source-asset-upload`
- `confirm-shot-source-asset-upload`
- `create-video-project`
- `update-video-project-status`
- `create-video-shot`
- `update-video-shot`
- `delete-video-shot`
- `regenerate-video-shot`
- `list-higgsfield-motions`
- `submit-shot-still-image`
- `check-shot-still-image`
- `submit-shot-generation`
- `check-shot-generation`
- `retry-shot-still-image`
- `retry-shot-video`
- `handoff-video-project`
- `create-final-reel-upload`
- `complete-final-reel-upload`
- `review-final-reel`

Primary UI/system area:

- Reel Studio
- video production handoff

Audit emphasis:

- Confirm Reel Studio remains a controlled AI video lane.
- Confirm shot retry paths preserve source assets.
- Confirm Higgsfield provider calls are guarded by state transitions.
- Confirm handoff requires approved/completed project state.
- Confirm final reel review and distribution draft creation are separated.

## Phase 7 — Distribution, Publishing, Paid Distribution

Output document:

```text
docs/edge-function-audits/phase-07-distribution-paid.md
```

Functions:

- `set-client-distribution-policy`
- `create-distribution-record-from-content-item`
- `publish-instagram-asset`
- `create-reel-distribution-draft`
- `process-scheduled-publishing`
- `create-ad-opportunity`
- `manage-ad-brief`
- `generate-ad-creative-variants`
- `set-ad-budget-policy`
- `create-ad-campaign`
- `launch-ad-campaign`
- `update-ad-campaign-status`
- `update-ad-campaign-budget`
- `meta-ad-ops`
- `collect-instagram-insights`

Primary UI/system area:

- Distribution
- Paid Distribution
- Ad Studio

Audit emphasis:

- Confirm publishing is policy-gated.
- Confirm scheduled publishing cannot publish unapproved assets.
- Confirm Meta operations require the correct secrets and account context.
- Confirm ad campaign launch/update paths are auditable and budget-safe.
- Confirm insight collection is read-only unless explicitly designed to persist analytics.

## Phase 8 — Public Intake, Webhooks, Messaging, Payments, Reporting

Output document:

```text
docs/edge-function-audits/phase-08-public-webhooks-payments-reporting.md
```

Functions:

- `meta-webhook`
- `dialog360-send`
- `onboarding`
- `payfast-create-link`
- `payfast-webhook`
- `mrr-calc`
- `apify-scrape`
- `mjr-generate`
- `brief-generator`

Primary UI/system area:

- public intake
- webhooks
- WhatsApp / Meta inbound
- payments
- reporting
- older automation paths

Audit emphasis:

- Confirm webhook verification and idempotency.
- Confirm payment webhook safety and replay resistance.
- Confirm outbound messaging is not accidentally public.
- Confirm older lead/prospect and MJR functions are either valid, deprecated, or orphaned.
- Confirm reporting calculations are scheduled/manual safe.

## Phase 9 — Background, Scheduled, Orphan, Legacy, And Internal-Only Functions

Output document:

```text
docs/edge-function-audits/phase-09-background-orphan-legacy.md
```

Functions:

- `publish-playbook-version`
- any function not called by `src/lib`, `src/components`, or `src/pages`
- any function only invoked internally by another function
- any function whose current UI page ownership is unclear after Phases 1-8

Known candidates from the current local caller inventory:

- `apify-scrape`
- `brief-generator`
- `collect-instagram-insights`
- `dialog360-send`
- `generate-ad-static-asset`
- `generate-carousel-assets`
- `generate-feed-post-asset`
- `generate-story-assets`
- `meta-ad-ops`
- `meta-webhook`
- `mjr-generate`
- `mrr-calc`
- `onboarding`
- `payfast-create-link`
- `payfast-webhook`
- `process-asset-generation-jobs`
- `process-scheduled-publishing`
- `process-source-document`
- `publish-playbook-version`
- `record-context-file-provenance`
- `record-research-run`
- `register-source-document`
- `validate-execution-pack`

Primary UI/system area:

- background operations
- scheduled processing
- internal function-to-function calls
- legacy paths

Audit emphasis:

- Confirm whether each candidate is still active.
- Identify orphaned functions.
- Identify functions that should be deployed only as internal/background jobs.
- Identify functions that need explicit documentation before further use.

## Phase 10 — Cross-Function Configuration Reconciliation

Output document:

```text
docs/edge-function-audits/phase-10-cross-function-reconciliation.md
```

Functions:

- all 109 local Edge Functions

Primary UI/system area:

- whole Cockpit
- whole Supabase function layer

Audit emphasis:

- Create final function inventory.
- Confirm every function was covered in at least one prior phase.
- Compare local function folders against functions called from frontend wrappers.
- Identify functions with no local tests.
- Identify functions that need deployment confirmation.
- Identify functions that need secret configuration confirmation.
- Identify duplicate or overlapping responsibilities.
- Identify functions that should be retired, merged, renamed, documented, or hardened.
- Produce a final priority upgrade backlog.

The Phase 10 document should include:

- `All Functions Coverage Matrix`
- `Functions Called By UI`
- `Functions Not Called By UI`
- `Function-to-Function Calls`
- `Secrets Matrix`
- `Deployment Verification Needed`
- `Test Coverage Matrix`
- `Risk Register`
- `Recommended Upgrade Backlog`

## Suggested Audit Order

Run the phases in order. Earlier phases cover highest-authority generation and approval flows first, then production, distribution, and public/external systems.

Do not begin implementation of suggested upgrades until all ten read-only phase documents are complete and reviewed.
