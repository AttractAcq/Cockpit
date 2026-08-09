# Incident Runbook

What to do when something breaks in production. Written from the real failure-handling mechanisms that exist in the codebase today — not aspirational.

## First stop: the exception queue and Operations Control Panel

Almost every real failure mode in Cockpit is designed to surface in `client_exception_queue`, not to fail silently. Start at `OperationsControlPanel.tsx` → Metrics tab:

- **Open/acknowledged exceptions, especially `highSeverityOpenCount` > 0** (`summariseExceptions`, `src/lib/observability.ts`) — the queue is deduplicated per client/type/source, so a growing count means genuinely distinct, unresolved problems, not noise.
- **Publish success rate** (`computePublishSuccessRate`) — only counts terminal outcomes (`published`/`permanent_failure`); a dropping rate with rising `permanent_failure` count is the earliest real signal of a provider-side or credential problem.
- **Queue age** (`summariseQueueAge`) — old open items that aren't resolving indicate either a stuck automation or a gap nobody's watching.

## Publishing failures (`process-scheduled-publishing`)

1. Check `client_exception_queue` for the relevant `client_distribution_records.id` — `fileDistributionException()` writes one on every permanent-failure path, with the real error attached.
2. Check `get_logs` for the `process-scheduled-publishing` edge function around the failure timestamp.
3. Common real causes seen across the programme: Instagram container never reaching `FINISHED` status (poll timeout), a client's `retry_cap` exhausted (check `client_capacity_policies`), or the client's automation policy blocking the attempt (`checkAutomationGate` — check `client_automation_policies` for the relevant area; a blocked attempt releases the record back to `scheduled` without consuming a retry, so it isn't itself an error, just a stall worth investigating if it persists).
4. **Never leave a record stuck at a permanently-`running`/in-flight status.** Every generation and publish path in this codebase is built to fail closed into a terminal, recoverable state (`failed`, `permanent_failure`, released back to `scheduled`) rather than hang — if you find a record stuck mid-flight with no matching exception and no recent log activity, that's itself the incident: find which function claimed it (`claimed_at`/`claimed_by` on `client_distribution_records`) and check why it never completed its own error path.

## AI generation failures (briefs, storyboards, ad creative variants)

- These use a single-corrective-retry pattern: one retry if the wall-clock budget allows and the first attempt failed validation, otherwise a clean error response. A generation stuck at `running` past its expected wall-clock budget (Supabase free-tier edge functions cap around 150s) means the function itself likely crashed mid-execution without reaching its own catch/cleanup — check `get_logs` for that function around the stuck timestamp, and manually reset the row's status once the cause is understood (do not blind-retry a row that's already stuck; find out why first).

## Security/RLS incidents

- Run `get_advisors(type="security")` after any schema change — this is the first thing to check, not a last resort. It caught a real ERROR-level cross-client data leak this stage (`client_margin_summary`, an implicit `SECURITY DEFINER` view — see architecture guide §7) before it had any live impact.
- If a client reports seeing another client's data: check `team_members` for that user first (the sole non-admin visibility grant), then check whether the surface in question reads through a view — views need `security_invoker=true` explicitly; it is not the default in Postgres.

## Cost/credit incidents

- `generation_credits_ledger` (Reel Studio) and `client_cost_ledger` (Stage O, 7 named categories) are the two places real spend should show up. Neither is fed by any automated reconciliation job today — both are manual-entry or partially-unwired (Higgsfield exposes no per-request credit-cost field). A cost spike will not self-report; it has to be checked deliberately via `client_margin_summary` or the Cost & Margin tab in `OperationsControlPanel.tsx`.

## Rollback discipline

- Every migration in this programme is additive — corrective fixes are always a new migration, never an edit to an already-applied one (see any `*_fix_*` migration for the pattern, e.g. `20260812120000_stage_p_fix_margin_summary_security_definer_view.sql`). If a migration needs to be undone, write the inverse as a new migration; do not hand-edit history.
- Postgres DDL in `apply_migration` is transactional — a failed migration rolls back cleanly with zero partial artifacts (confirmed directly during this programme, Stage O). A failed migration is safe to retry after fixing the SQL; it does not leave the schema in a half-applied state.
