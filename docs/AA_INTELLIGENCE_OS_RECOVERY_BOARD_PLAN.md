# AA Intelligence OS Recovery Controls Board Plan

Status: Stage 5 Brand Strategist backend retry implemented
Date: 2026-08-13

This document captures the next Intelligence-page iteration: standardize module-level retry and full-run recovery controls across the Intelligence OS surfaces.

## Purpose

The Intelligence page contains multiple authority-producing OS surfaces. When one or two modules fail inside a larger run, the operator should be able to retry only those failed modules instead of rerunning the whole OS and trying to get every module correct in a single pass.

The target recovery model is:

```text
Failed module -> Retry module -> Preserve successful modules -> Resume/finalize OS
```

Full-page refresh, resume, rebuild, and retry controls should remain available, but they should not be the only recovery path.

## Scope

This iteration covers the Intelligence-page OS surfaces:

- Market OS
- Avatar OS on the Intelligence page
- Competitor OS
- Association OS
- Brand Strategist

Note: this is separate from the Stage 5 `Avatars` module/page. The Stage 5 Avatar OS is the newer owned communication identity system between Offers and Ideation. This document covers the older Intelligence-page `AvatarOSPanel.tsx` recovery parity.

## Stage 1 Baseline

Current implementation review found that module-level retry already exists, but only for two Intelligence OS surfaces.

| OS surface | Frontend panel | Edge function | Full build/resume/rebuild/refresh | Retry one failed module | Retry all failed modules | Backend `retry_step` support | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Market OS | `src/components/client/MarketOSPanel.tsx` | `supabase/functions/run-market-os` | Yes | Backend only | Backend only | Yes | UI gap |
| Avatar OS | `src/components/client/AvatarOSPanel.tsx` | `supabase/functions/run-avatar-os` | Yes | Backend only | Backend only | Yes | UI gap |
| Competitor OS | `src/components/client/CompetitorOSPanel.tsx` | `supabase/functions/run-competitor-os` | Yes | Yes | Yes | Yes | Implemented |
| Association OS | `src/components/client/AssociationOSPanel.tsx` | `supabase/functions/run-association-os` | Yes | Yes | Yes | Yes | Implemented |
| Brand Strategist | `src/components/client/BrandStrategistPanel.tsx` | `supabase/functions/run-brand-strategist` | Yes | Backend only | Backend only | Yes | UI gap |

## Current Reusable Pattern

The working pattern exists in Competitor OS and Association OS.

Frontend:

- `retryIntelligenceResearchStep(...)` is imported from `src/lib/intelligence.ts`.
- Failed workflow steps expose a `Retry module` button.
- The panel exposes `Retry all failed (...)` when failed steps exist.
- Retry actions call the relevant edge function with `action: "retry_step"`.

Backend:

- `run-competitor-os` supports `prepare`, `step`, `finalize`, and `retry_step`.
- `run-association-os` supports `prepare`, `step`, `finalize`, and `retry_step`.
- Each `retry_step` path validates the requested failed step, requeues it, and emits an audit event.

Current limitation:

- `retryIntelligenceResearchStep(...)` now supports all five Intelligence OS domains.
- Market OS now has backend `retry_step` support, but does not expose retry controls in the UI yet.
- Avatar OS now has backend `retry_step` support, but does not expose retry controls in the UI yet.
- Brand Strategist now has backend `retry_step` support, but does not expose retry controls in the UI yet.

## Target Capability

Every Intelligence OS surface should support:

- Build first run.
- Resume a prepared or partially completed run.
- Rebuild a failed or stale draft run.
- Refresh an approved active authority into a new draft.
- Retry one failed module.
- Retry all failed modules.
- Preserve successful completed modules during module retry.
- Prevent mutation of approved authority.

## Board

### Card 1 - Baseline Current Recovery Behaviour

Status: Done

Scope:

- Inspect all five Intelligence OS panels.
- Inspect matching edge function action contracts.
- Document current support and gaps.

Acceptance:

- A matrix exists for each OS surface.
- The known working pattern is identified.
- The missing surfaces are named.
- The distinction between Intelligence Avatar OS and Stage 5 Avatars is explicit.

### Card 2 - Standardize Retry Contract

Status: Done

Scope:

- Generalize `retryIntelligenceResearchStep(...)` to support:
  - `market_os`
  - `avatar_os`
  - `competitor_os`
  - `association_os`
  - `brand_strategist`
- Map each domain to its existing edge function slug.
- Keep the request contract consistent:

```json
{
  "action": "retry_step",
  "client_id": "uuid",
  "research_run_id": "uuid",
  "step_id": "string"
}
```

Acceptance:

- One frontend helper can retry a step for any Intelligence OS surface.
- Existing Competitor OS and Association OS retry flows still work.

Implementation:

- `src/lib/intelligence.ts` now maps all five `IntelligenceDomain` values to their existing edge function slug through `INTELLIGENCE_RETRY_FUNCTIONS`.
- Backend `retry_step` support is now implemented for all five Intelligence OS domains.
- Market OS backend support is implemented in Card 3.

### Card 3 - Add Backend Retry To Market OS

Status: Done

Scope:

- Add `retry_step` action support to `supabase/functions/run-market-os`.
- Requeue only the selected failed Market OS module.
- Preserve completed module outputs.
- Emit a Market OS retry audit event.

Acceptance:

- A failed Market OS step can be retried without rerunning successful steps.
- Approved Market OS releases cannot be mutated.

Implementation:

- `supabase/functions/run-market-os` now supports `action: "retry_step"`.
- The retry path only accepts failed Market OS steps from draft or needs-review releases.
- Step-scoped findings, evidence, and records are cleared before the failed module is requeued.
- Completed modules remain untouched.
- The retry path emits `market_os.failed_module_requeued`.

### Card 4 - Add Backend Retry To Avatar OS

Status: Done

Scope:

- Add `retry_step` action support to `supabase/functions/run-avatar-os`.
- Requeue only the selected failed Avatar OS module.
- Preserve completed module outputs.
- Emit an Avatar OS retry audit event.

Acceptance:

- A failed Intelligence Avatar OS step can be retried independently.
- Approved Avatar OS releases cannot be mutated.

Implementation:

- `supabase/functions/run-avatar-os` now supports `action: "retry_step"`.
- The retry path only accepts failed Avatar OS steps from draft or needs-review releases.
- Step-scoped findings, evidence, and records are cleared before the failed module is requeued.
- Completed modules remain untouched.
- The retry path emits `avatar_os.failed_module_requeued`.

### Card 5 - Add Backend Retry To Brand Strategist

Status: Done

Scope:

- Add `retry_step` action support to `supabase/functions/run-brand-strategist`.
- Requeue only the selected failed synthesis/recommendation module.
- Preserve completed module outputs.
- Emit a Brand Strategist retry audit event.

Acceptance:

- A failed Brand Strategist step can be retried independently.
- Approved Brand Strategist releases cannot be mutated.

Implementation:

- `supabase/functions/run-brand-strategist` now supports `action: "retry_step"`.
- The retry path only accepts failed Brand Strategist steps from draft or needs-review releases.
- Step-scoped findings, evidence, and records are cleared before the failed module is requeued.
- Completed modules remain untouched.
- The retry path emits `brand_strategist.failed_module_requeued`.

### Card 6 - Verify Existing Competitor And Association Retry

Status: Ready

Scope:

- Compare existing retry logic against the shared contract.
- Refactor only if needed for parity.

Acceptance:

- Competitor OS and Association OS retain current behaviour.
- Their retry semantics match the new shared contract.

### Card 7 - Shared Workflow Retry UI

Status: Ready

Scope:

- Extract the repeated workflow display/retry pattern into a shared component or helper.
- Support:
  - step status display
  - step failure message
  - retry one failed module
  - retry all failed modules
  - disabled states while working

Acceptance:

- All Intelligence OS panels can use the same workflow recovery UI.
- Labels can remain OS-specific.

### Card 8 - Apply Retry UI To Market OS

Status: Ready

Scope:

- Wire Market OS failed steps to the shared retry UI.
- Add `Retry module` and `Retry all failed` actions.

Acceptance:

- Market OS has UI parity with Competitor OS and Association OS.

### Card 9 - Apply Retry UI To Avatar OS

Status: Ready

Scope:

- Wire Intelligence Avatar OS failed steps to the shared retry UI.
- Add `Retry module` and `Retry all failed` actions.

Acceptance:

- Avatar OS has UI parity with Competitor OS and Association OS.

### Card 10 - Apply Retry UI To Brand Strategist

Status: Ready

Scope:

- Wire Brand Strategist failed steps to the shared retry UI.
- Add `Retry module` and `Retry all failed` actions.

Acceptance:

- Brand Strategist has UI parity with Competitor OS and Association OS.

### Card 11 - Normalize Full Page Recovery Semantics

Status: Ready

Scope:

- Align full-run labels and behaviour across all five panels:
  - Build
  - Resume
  - Rebuild draft
  - Refresh approved authority

Acceptance:

- Operators can understand the difference between retrying a module and rebuilding a full OS.
- Refreshing approved authority creates or continues a draft; it does not mutate approved releases.

### Card 12 - Tests And Release Verification

Status: Ready

Scope:

- Add targeted tests for:
  - generic retry helper domain mapping
  - backend `retry_step` action support
  - failed-step UI controls
  - approved-release immutability guards
- Run:

```bash
npm run typecheck
npm run build
```

Acceptance:

- Typecheck passes.
- Build passes.
- Existing retry flows do not regress.

### Card 13 - Deploy Changed Functions

Status: Ready

Scope:

- Deploy changed existing function slugs only.
- No new function slugs should be added for this iteration.

Likely deploy list:

- `run-market-os`
- `run-avatar-os`
- `run-brand-strategist`
- `run-competitor-os`, only if refactored
- `run-association-os`, only if refactored

Acceptance:

- Live project has retry parity across all five Intelligence OS surfaces.
- Supabase function count is not increased.

### Card 14 - Human Smoke Test

Status: Ready

Scope:

- For each OS surface, verify:
  - retry one failed module
  - retry all failed modules
  - resume after retry
  - finalize after successful retry
  - full rebuild/refresh path

Acceptance:

- One or two failed modules can be repaired without rerunning the whole OS.
- Completed modules remain intact.
- Approved authority remains immutable.

## Definition Of Done

This iteration is done when:

- All five Intelligence OS surfaces have module-level retry parity.
- All five preserve successful modules during retry.
- Full-page rebuild/refresh remains available.
- Approved releases are immutable.
- Drafts remain review-gated.
- No new Supabase function slugs are created.
- Typecheck and build pass.
- A human smoke test confirms retry behaviour in the live Cockpit.
