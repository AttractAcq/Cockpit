# Automation Policy Guide

Covers `client_automation_policies`, `client_capacity_policies`, and `client_exception_queue` — the Stage N fulfilment-control layer that gates automated work per client.

## Automation levels

Each client has a policy row per named automation area (14 areas), each set to one of:

- **`manual`** — automation is blocked outright for this area on this client; every attempt must be a human-initiated action.
- **`assisted`** — automation can prepare/propose work, but a human must approve before it executes.
- **`automatic`** — automation may run without a human step, subject to the client's capacity policy.

`DEFAULT_AUTOMATION_LEVEL = "automatic"` (`supabase/functions/_shared/automation-policy.ts`). **No policy row for an area means today's default behaviour for that client** — the same "no policy row = default, not restricted" convention used throughout this programme (Stage N capacity policies, Stage O onboarding). Set a policy explicitly if a client needs anything other than automatic.

Set via RPC `set_client_automation_policy(client_id, area, automation_level, thresholds jsonb)`. Managed from `AutomationPanel.tsx` (client detail → Automations tab).

## Capacity policies

Per-client limits in `client_capacity_policies`: `monthly_generation_budget_units`, `per_asset_budget_units`, `provider_credit_budget_units`, `max_simultaneous_jobs`, `human_review_capacity_per_day`, `client_priority`, `due_date_priority_enabled`, `retry_cap` (default 5). Set via `set_client_capacity_policy`. `allocateCapacity()` in `_shared/automation-policy.ts` is the pure allocation function used wherever multiple candidate jobs compete for a client's `max_simultaneous_jobs` slot.

`retry_cap` replaces what used to be a single hardcoded `MAX_ATTEMPTS` constant in `process-scheduled-publishing` — it's now threaded through per-client via `resolveRetryCap(policyRetryCap, fallback)`, so a client that needs a tighter or looser retry budget than the default 5 doesn't require a code change.

## The gate, concretely (`process-scheduled-publishing`)

For every claimed `client_distribution_records` row, before attempting a publish:

1. Resolve the client's automation level for the relevant area via `checkAutomationGate(level, isAutomaticAttempt)`.
2. If blocked, the record is released back to `scheduled` untouched — **no attempt is consumed**, so a client flipped to `manual`/`assisted` mid-queue doesn't burn its retry budget on gate rejections.
3. If allowed, the publish attempt proceeds using the client's `retryCap` (not a global constant) for both `releaseReelForRetry` and `advanceReel`.
4. On any permanent failure, `fileDistributionException()` writes a row to `client_exception_queue` before the record is marked permanently failed — no failure is ever silent.

## Exception queue

`client_exception_queue` — 9 named exception types, deduplicated on open items via a partial unique index (so the same client/type/source can't pile up duplicate open exceptions). Filed via RPC `file_exception`, resolved via `resolve_exception`. Surfaced in `OperationsControlPanel.tsx` (Metrics tab) via `summariseExceptions()` (`src/lib/observability.ts`), which separates `openCount`/`acknowledgedCount`/`resolvedCount` and flags unresolved high-severity items (`highSeverityOpenCount` counts both `open` and `acknowledged` as unresolved — only `resolved` clears it).

## Operator workflow

1. Check `OperationsControlPanel.tsx` → Metrics tab for open exceptions and queue age (`summariseQueueAge`, `summariseApprovalDelays` — both null-safe, never fabricate a rate/age from zero data).
2. For a client generating too many exceptions, tighten their automation level to `assisted`/`manual` for the offending area via `AutomationPanel.tsx`, rather than raising their retry cap — repeated permanent failures are a signal something upstream needs a human, not more attempts.
3. Resolve exceptions via `resolve_exception` once the underlying cause is fixed. Do not resolve without addressing the cause — the dedup index will re-open a fresh exception on the next real failure regardless.
