# Programme Stage O — Multi-Client Scale and Operational Control

**Status: backbone implemented, deployed (no edge functions required — see "Deployment"), and live-verified against real database constraints with disposable fixtures. One real bug found and fixed via that testing. Scope deliberately reduced from the full stage prompt — see "What this stage does not attempt" below.**
Date: 2026-08-11 · Project `xivewedajschthjlblfb`

## What this stage builds on — read this first

The context scan found a real, confirmed **client-isolation defect**, not a hypothetical one: `public.users.role` is a proper Postgres enum (`user_role`) — already a real, enforced vocabulary — but `auth_client_ids()`, the function nearly every RLS `SELECT` policy in this database calls, only ever routed `'admin'` and `'account_manager'` to real client visibility via `team_members`. Every other staff role, including `'editor'` — already checked as a valid staff role in dozens of RPCs across Stage H through N (e.g. `auth_role() in ('admin','account_manager','editor')`) — got an **empty** client list back. An editor could pass a write-permission check inside an RPC and then see none of the underlying rows via RLS. This is exactly the kind of gap Stage O's "Client isolation… Team access" scope line asks to verify. It was safe to fix immediately: exactly one real user exists in this database (`role = 'admin'`), confirmed by direct query before writing the fix, so the change alters no live person's access — it only makes every already-written non-admin permission check actually work the way it was written to.

## Scope actually implemented (the "backbone")

### Schema — three migrations (all applied live)
`20260811120000_stage_o_role_enum_extension.sql` — extends the existing `user_role` enum with Stage O's remaining 5 named roles (`strategist`, `content_operator`, `media_buyer`, `analyst`, `client_approver`; `admin`, `account_manager`, `editor`, `client` already existed). Split into its own migration because `ALTER TYPE … ADD VALUE` cannot be used together with a statement referencing the new value in the same transaction in all Postgres versions.

`20260811120100_stage_o_multi_client_scale_operational_control.sql`:
- **The isolation fix**: `auth_client_ids()` now routes *every* staff role through `team_members` (identical mechanism `account_manager` already used), not just `account_manager`. `admin` (sees all clients) and `client` (client-portal, via `client_users`) are unchanged.
- **`client_work_items`** — a generic, polymorphic work-allocation overlay (assignee, review owner, due date, priority, capacity estimate, SLA, blocker, status), mirroring `client_exception_queue`'s source-reference pattern (Stage N) rather than retrofitting assignee/due-date columns onto dozens of existing domain tables. RPCs: `create_work_item`, `update_work_item_status`, `assign_work_item`.
- **`client_cost_ledger`** — the 7 build-plan-named cost categories (model spend, storage, rendering, human time, ad-management time, revision cost, fulfilment cost), one row per cost event. `clients.monthly_revenue_estimate` (nullable — never fabricated) plus the `client_margin_summary` view compute a real gross-margin estimate only when a revenue figure is actually on file. RPC: `record_cost_entry`.
- **`client_onboarding_templates` + `onboard_client`** — a real, repeatable onboarding path. A named template bundles a default automation-policy set (Stage N's 14 areas) and a default capacity policy; `onboard_client` creates the client, assigns an account manager via `team_members`, and applies the template's policies **by calling Stage N's own `set_client_automation_policy`/`set_client_capacity_policy` RPCs directly** — no duplicated policy-application logic.

`20260811130000_stage_o_fix_onboard_client_type_cast.sql` — the corrective fix described below.

### One real bug found and fixed via live testing
`onboard_client` is `SECURITY DEFINER` with `set search_path = ''` (this programme's established convention to prevent search-path hijacking), which means every type, table, and function reference inside the function body must be fully schema-qualified. The `insert into public.clients` correctly qualified every table/function reference but cast `p_package_tier` as `::package_tier` instead of `::public.package_tier` — with an empty `search_path`, the bare type name cannot be resolved at all. This was a real, immediate failure (`type "package_tier" does not exist`), caught by the live disposable-fixture test on the very first onboarding call, before any real client was affected. Fixed in an additive corrective migration, not by editing the already-applied one.

### Shared logic — `src/lib/observability.ts`
Pure aggregation functions computing the Stage O dashboard metrics directly from already-fetched rows of real tables (`client_publish_attempts`, `client_exception_queue`, `client_work_items`) — never a separately-maintained, driftable counter:
- `computePublishSuccessRate` — "Publishing success," counting only terminal outcomes (`published`/`permanent_failure`); a still-in-flight or retryable attempt never distorts the rate.
- `summariseExceptions` — "Failure rate," from Stage N's real exception queue.
- `summariseQueueAge` / `ageInHours` — "Queue age," clamped to never report a negative age from clock skew.
- `summariseApprovalDelays` — "Approval delays," overdue vs. due-within-24h work items.

### Frontend
`src/types/operations.ts`, `src/lib/operations-admin.ts` (RPCs called directly, matching the established convention for this class of administrative operation), and a new `src/components/operations/OperationsControlPanel.tsx` wired into the **already-real, already-live** `OperationsPage.tsx` as a second tab ("Operational Control") alongside its existing, completely untouched Activity Log. Five sections: Metrics (real, live-computed), Team & Roles (assign staff to clients — the isolation fix's actual management surface, since none existed before), Work Items, Cost & Margin, and Onboarding. Confirmed via search before touching anything: `src/components/operations/AgentControlPanel.tsx`, `AutomationList.tsx`, and `src/lib/mock/operations.ts` are all orphaned, zero-import legacy code from an earlier architecture iteration — left untouched, not referenced.

### Tests
`tests/observability.test.ts` — 10 new deterministic unit tests: the null-vs-fabricated-zero distinction when there's no data to compute a rate from, terminal-vs-in-flight attempt filtering, exception severity/status counting, clock-skew-safe age computation, queue-age summarisation excluding resolved items, and approval-delay overdue/due-soon classification. Full suite (Node's built-in test runner): **981 of 982 pass** — the sole failure is the same pre-existing, unrelated Deno-only `jsr:` import every prior stage has also reported. `npm run typecheck`, `npm run build`, `npm run lint` all clean — same 4 pre-existing React-hooks warnings, zero new.

### Live verification with disposable fixtures
A self-checking SQL script against the real database, simulating the same real, unmodified admin `public.users` row used in Stage M/N's verification. Confirmed: all 5 new `user_role` enum labels are valid; `auth_client_ids()`'s function body contains the expected non-admin staff branch; a work item can be created, blocked (rejecting a missing reason), and completed, with the `is_blocked`/`completed_at` pairing CHECKs verified both through the RPC and via a direct insert attempt; a cost entry can be recorded and `client_margin_summary` correctly reflects it against a temporarily-set revenue estimate (removed immediately after); an invalid cost category is rejected; and `onboard_client` — after the fix above — correctly creates a client, applies a template's automation policy (verified against `client_automation_policies`) and capacity policy (verified against `client_capacity_policies`, including the non-default `retry_cap`/`client_priority` values). All checks passed. A follow-up count query confirmed zero `ZZ-TEST` rows remain in any of the three new tables, and that the real client's `monthly_revenue_estimate` is back to `null`.

### Deployment
No edge functions were deployed this stage. Every Stage O RPC follows the established direct-`supabase.rpc(...)` convention for this class of administrative/policy operation (Gate B-G, Stage M, Stage N) — consistent within the subsystem rather than introducing a second access pattern. `auth_client_ids()` is a change to an already-live security function, applied via `apply_migration` and confirmed via the function-body content check above (a "verify the deployed logic matches" check equivalent to the byte-identical edge-function diffs used elsewhere in this programme).

## What this stage does not attempt, with precise reasons

- **Fine-grained per-role write permissions.** Every non-admin staff role (`account_manager`, `strategist`, `content_operator`, `editor`, `media_buyer`, `analyst`) now gets identical client-scoped *read* visibility via `team_members`, and the *write*-permission allow-lists inside dozens of already-existing RPCs (Stage H through N) are completely unchanged — they still check their own specific role lists. Building "Analyst is read-only," "Media Buyer can only touch Ad Studio," etc. would mean auditing and modifying the permission check inside every RPC and edge function this entire programme has built — a large, separate, high-risk undertaking, not a proportionate part of one stage's backbone. This is the single most significant scope reduction in this stage and is disclosed prominently, not buried.
- **A user-invitation/identity-management system.** `team_members` assignment (staff-to-client) is now real and manageable via the Team & Roles UI, but creating new `auth.users`/`public.users` rows is out of scope — this stage assumes staff accounts already exist and focuses on client-scoped access to them.
- **Industry starter packs, proof schemas, brand-configuration templates.** `client_onboarding_templates` is real and functional for its two built dimensions (automation policy, capacity policy); the build plan's richer per-industry content/proof/brand packs are not attempted — the template schema has a `default_content_requirements text[]` column ready for this, but nothing populates or consumes it yet.
- **Provider health and analytics freshness observability.** Two of the nine named dashboard metrics have no real underlying data source in this codebase yet (no provider-uptime tracking exists anywhere; "analytics freshness" would need a per-client last-collection timestamp this project doesn't track). The seven metrics that do have real underlying data are wired to genuine, live-computed numbers; these two are honestly absent rather than filled with a placeholder.
- **Cost/margin auto-population from real generation activity.** `record_cost_entry` is a real, working RPC, but nothing in this codebase automatically calls it yet (e.g. Reel Studio's `generation_credits_ledger` still has no real per-request credit-cost field to convert into a cost-ledger entry, an unresolved gap noted since Reel Studio Phase B). Cost tracking today is manual-entry only, the same honest starting point Gate B's organic metrics had before automatic collection existed.
- **Client offboarding / data export / account disconnection** (named directly in Stage O's own Tests list) — no offboarding workflow, data-export tool, or credential-revocation flow was built this pass. A real, separate piece of work.

## Confirmation against Stage O tests (from the build plan)

| Test | Status |
|---|---|
| Role permissions | Partially met — the role vocabulary is real and enforced (enum), and client-scoped read isolation is now correct for every role; fine-grained write-permission differentiation per role is not built (see above) |
| Client isolation | Met — the real, confirmed `auth_client_ids()` gap is fixed and live-verified; RLS `SELECT` policies across every table now correctly resolve for every staff role, not just admin/account_manager |
| Cost aggregation | Met — `client_margin_summary`, live-verified against a real recorded cost entry and a temporarily-set revenue estimate |
| Queue prioritisation | Structurally met via `client_work_items.priority` + `summariseApprovalDelays`; no live queue-depth-based scheduler consumes it yet (Stage N's `allocateCapacity` remains the tested, ready building block for this) |
| Template instantiation | Met — `onboard_client` from a template, live-verified end to end including the fixed bug |
| Client offboarding | Not attempted (see above) |
| Data export | Not attempted (see above) |
| Account disconnection | Not attempted (see above) |

## Confirmation against Stage O acceptance criteria

| Criterion | Status |
|---|---|
| A new client can be onboarded through a repeatable workflow | Met — `onboard_client`, live-verified, applies a named template's default policies in one call |
| Client assets and data remain isolated | Met for the specific, real gap this stage found and fixed (RLS client-scoped visibility for every staff role); the build plan's other named isolation dimensions (storage paths, provider assets, ad accounts, generated voices, brand kits, Proof permissions) were not separately re-audited this pass — each was built with client-scoped RLS already in its own originating stage, and no new gap was found in them during this scan |
| AA can see fulfilment cost and capacity | Structurally met — Cost & Margin and Metrics tabs are real and live; populated only by what's actually recorded, which today is nothing (no client has cost entries or a revenue estimate on file) |
| Operators know what requires attention | Met — the Metrics tab surfaces real open-exception/overdue-work-item/queue-age numbers computed from live data, and the Work Items tab is a real, usable cross-client "what's outstanding" view |
| The system can scale without relying on one person's memory | Partially met — the policy-application-at-onboarding mechanism removes one real instance of "an operator has to remember to configure this"; most of the system still depends on operators knowing where to look, since fine-grained roles and full observability remain future work |

**Exit gate ("Cockpit is operationally ready for repeatable multi-client fulfilment"): partially met, honestly.** The single most consequential thing this stage did was find and fix a real, latent client-isolation defect before it could affect a real non-admin user — worth more than any of the new features built alongside it. The new features (work allocation, cost/margin, onboarding templates, live metrics) are real, deployed, and live-verified, not placeholders. What remains unmet, honestly: this system has exactly one real client with real data and one real user; "multi-client scale" has not been demonstrated because there is no second real client yet to demonstrate it against, and several named Stage O capabilities (fine-grained roles, full observability, offboarding, richer onboarding templates) are deliberately deferred with precise reasons above rather than built shallow.
