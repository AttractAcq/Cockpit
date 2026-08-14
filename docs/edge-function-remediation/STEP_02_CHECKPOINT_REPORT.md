# Edge Function Remediation Step 2 Checkpoint Report

Status: complete
Created: 2026-08-14
Step: Canonical Edge Function Registry and Static Conformance Check

## 1. Outcome

Step 2 adds a build-time registry and conformance gate for the complete local Edge Function inventory. It does not change Edge Function behavior, database schema, deployment state, local JWT configuration, schedules, providers, or secrets.

## 2. Deliverables

- `supabase/functions/registry.json`
- `supabase/functions/registry.schema.json`
- `scripts/check-edge-function-registry.mjs`
- `tests/edge-function-registry.test.ts`
- `docs/edge-function-remediation/EDGE_FUNCTION_REGISTRY_MAINTENANCE.md`
- CI and package-script integration

## 3. Registry Reconciliation

| Contract | Expected |
| --- | ---: |
| Local functions | 109 |
| UI-called functions | 90 |
| Non-UI functions | 19 |
| Retired functions | 10 |
| Retired deployable functions | 0 |

Explicit internal call relationships:

- `generate-phase-2` to `validate-execution-pack`;
- `generate-phase-3` to `validate-execution-pack`;
- retired `payfast-webhook` to retired `onboarding`.

Worker posture:

- `collect-instagram-insights`: cron, `CRON_SECRET`, JWT disabled and locally versioned;
- `process-scheduled-publishing`: cron, `CRON_SECRET`, JWT verified under current local default;
- `process-asset-generation-jobs`: cron, `CRON_SECRET`, intended JWT-disabled posture with a bounded local-config exception assigned to `EF-WORKER-003` for Step 7 reconciliation.

## 4. Controls Added

The static validator fails for:

- missing or stale function entries;
- duplicate entries;
- required registry/profile fields missing;
- retired functions marked deployable or callable;
- deployable functions without OPTIONS posture;
- background/webhook functions without explicit authentication;
- JWT-disabled functions without alternate secret protection;
- unknown remediation IDs or missing test/doc references;
- inventory/UI/non-UI/retired count drift;
- local JWT configuration drift without a current exception;
- expired or incomplete exceptions;
- drift in the three audited function-to-function calls.

## 5. Original-Objective Review

The registry describes existing operational contracts only. It is not imported by runtime code and does not route requests, grant access, deploy functions, generate content, add pages, introduce providers, or alter authority semantics.

Step 2 directly addresses:

- `EF-DESTRUCT-001` through explicit held lifecycle/deployability metadata;
- `EF-WORKER-003` through explicit worker/JWT posture and a bounded reconciliation exception;
- `EF-DOC-001` through page/system ownership for direct asset wrappers;
- `EF-RETIRE-002` through explicit retired webhook/deployment metadata;
- complete registry coverage for all 109 functions.

## 6. Verification

| Check | Result |
| --- | --- |
| Registry validator | Pass: 109 functions, 90 UI, 19 non-UI, 10 retired; one declared warning |
| Registry adversarial tests | Pass: 7/7 |
| Full deterministic tests | Pass: 1,096/1,096 on clean aggregate rerun |
| Typecheck | Pass from disposable non-synced copy |
| Production build | Pass from disposable non-synced copy; existing chunk-size warning only |
| Targeted lint for new validator/test | Pass |
| Scoped whitespace/conflict check | Pass |

The first full-suite run reported one timing-sensitive failure in the existing Ideation provider deadline test. That exact test passed immediately in isolation, and the complete suite then passed on aggregate rerun. No Ideation runtime or test source was changed in Step 2.

Direct typecheck and lint attempts in the Desktop workspace entered the previously observed zero-CPU filesystem/snapshot stall without diagnostics. Typecheck and build were therefore executed against an `rsync` copy under `/private/tmp` with the same source and lockfile. Targeted lint for the new Step 2 files also passed from that copy. This is an environment limitation, not a reported TypeScript, build, or registry defect.

## 7. Residual Risks

- The registry does not prove remote deployment state.
- `process-asset-generation-jobs` remains intentionally visible as a local-config mismatch until Step 7.
- Existing runtime authorization, transactional, retry, provider, and retirement findings remain assigned to later steps.
- Held destructive functions remain a deployment-state question; Step 2 records the conservative intended posture but does not alter runtime or remote state.

## 8. Rollback

Remove the registry/schema/validator/test/maintenance files, remove `check:edge-functions` from `package.json` and CI, and restore the plan checkpoint pointer. No runtime, data, schema, deployment, provider, or secret rollback is required.
