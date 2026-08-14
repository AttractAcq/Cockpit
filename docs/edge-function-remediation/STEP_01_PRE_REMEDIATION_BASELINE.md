# Edge Function Remediation Pre-Remediation Baseline

Status: captured
Captured: 2026-08-13
Programme: `docs/EDGE_FUNCTION_REMEDIATION_10_STEP_BUILD_PLAN.md`

## 1. Repository Baseline

| Field | Value |
| --- | --- |
| Repository root | `/Users/alex/Desktop/Attract Acq/Application Surfaces/Cockpit` |
| Active branch | `main` |
| HEAD commit | `0f3da2ac7df3ccf581e20eb6adc12c77384c1d32` |
| HEAD date | `2026-08-13T09:05:37+02:00` |
| HEAD subject | `Add Intelligence OS retry recovery parity` |
| Supabase project authority | `xivewedajschthjlblfb` |
| Local Edge Function folders | 109, excluding `_shared` |
| Local SQL migrations | 87 |
| Top-level TypeScript test files | 57 |
| Top-level shell test files | 10 |
| All top-level files under `tests/` | 88 |

## 2. Worktree Baseline

The worktree was already dirty before Step 1 documentation was created.

Pre-existing status count at capture:

- 30 modified tracked files.
- 25 untracked path entries reported by `git status --porcelain`.
- 55 total status entries.

The existing changes include Stage 4/5 frontend, Avatar OS, Ideation, Production/Reel integration, migrations, tests, the ten audit documents, and the remediation plan. Step 1 did not alter, revert, stage, commit, or reinterpret those files.

This creates a release-control requirement: the existing work must be intentionally checkpointed or isolated before Step 2 runtime/configuration implementation begins. See decision `EF-D-013`.

## 3. Edge Function Baseline

- 109 local function directories exist under `supabase/functions`, excluding `_shared`.
- Audit Phase 10 reports complete audit coverage: 109 of 109.
- Audit Phase 10 reports 90 functions called by the UI and 19 non-UI/internal/background/legacy functions.
- Function-to-function calls found by the audit:
  - `generate-phase-2 -> validate-execution-pack`;
  - `generate-phase-3 -> validate-execution-pack`;
  - retired `payfast-webhook -> onboarding`.
- Local remote-deployment parity has not been verified in Step 1.

## 4. Versioned Supabase Configuration Baseline

`supabase/config.toml` currently contains:

```toml
project_id = "cockpit"

[functions.collect-instagram-insights]
verify_jwt = false
```

Known audit discrepancy:

- Existing programme documentation says `process-asset-generation-jobs` is also deployed with `verify_jwt = false` and protected by `CRON_SECRET`.
- That posture is not currently declared in local `supabase/config.toml`.
- Step 1 does not decide remote fact from documentation alone and makes no configuration change.

## 5. Verification Baseline

Commands started from the Cockpit directory:

| Command | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Incomplete | `tsc --noEmit` emitted no diagnostic but did not terminate during two bounded observations and was interrupted. A concurrent workspace-wide snapshot process was consuming the repository filesystem. This is not recorded as a pass or failure. |
| `npm run build` | Incomplete | Vite emitted its start banner but did not terminate during the bounded observation and the orphaned parent process was stopped. This is not recorded as a pass or failure. |
| `node --test tests/*.test.ts` | Pass observed | The deterministic top-level TypeScript suite ran to completion with no failing test reported. Output was very large and included the existing Stage 4/5 tests. |
| `git diff --check` | Pass | No whitespace errors. |

The verification commands ran against the entire existing dirty worktree, not only Step 1 documentation. The incomplete typecheck/build commands must be rerun to a terminal exit before Step 1 is closed. A concurrent workspace snapshot process was traversing the much larger parent workspace, including `Archive/`, during both attempts; Step 1 did not start, modify, or terminate that snapshot process.

No live Edge Function was invoked. No migration was applied. No database or storage record was changed. No provider was called. No secret was read or printed.

## 6. Known Test-Coverage Baseline

Audit Phase 10's function-name scan found 64 local functions without a direct name mention in top-level local tests. That scan is a prioritization signal, not proof of zero behavioral coverage: some functions are covered through shared-helper tests, migration assertions, UI tests, prior smoke reports, or transitive behavior tests.

Step 1 decision `EF-D-006` sets a stronger focused test requirement for each P1 remediation.

## 7. Known Remote-State Questions

The following remain unknown because Step 1 did not query or mutate remote state:

- Exact remote deployment list and function versions.
- Whether any retired function is currently deployed.
- Whether held destructive functions are deployed.
- Whether `process-asset-generation-jobs` is currently JWT-disabled remotely.
- Remote secret presence or rotation state.
- Remote cron/schedule bindings.
- Remote webhook/provider endpoint bindings for retired functions.
- Whether all local migrations are applied remotely.

These questions route to Step 9 read-only deployment reconciliation and Step 10 controlled release, both requiring explicit authorization under the plan.

## 8. Baseline Risk

Overall risk remains `High`, matching Audit Phase 10.

Reasons:

- Active P1 service-role/client-access gaps.
- Non-atomic authority replacement and handoff paths.
- Incorrect state transitions and selected-record logic.
- Provider and distribution policy drift risks.
- Inconsistent worker configuration evidence.
- Retired functions remain in the local deployable function surface.

## 9. Step 1 Mutation Statement

Step 1 is documentation and planning only. It creates files under `docs/edge-function-remediation/` and updates no runtime code, schema, Supabase configuration, deployment, database, storage, provider, secret, or approved authority.
