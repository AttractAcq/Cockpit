# Stage 2, Phase 00 — Ground Truth & Decisions

Companion to `docs/STAGE_2_BUSINESS_OS_BUILD_PLAN.md`. This document is Phase 00's actual deliverable: the audit, the retirement history, all 5 Open Decisions answered and owned, the per-department acceptance bars, and the human-approval gate list. Per the build plan's own exit gate, **Phase 01 does not start until every decision below has a recorded answer with a named owner** — that is now true as of this document.

**Owner of record for every decision in this document: Alex Thomas.** Confirmed 2026-08-20.

---

## 1. App-level Operations page — full audit

The build plan's original audit rated Delivery/Operations "unaudited" and assumed the app-level Operations page was close to greenfield. It is not. `src/pages/OperationsPage.tsx` is a real, routed, top-level page (`ROUTES.operations`) with two tabs:

**Activity Log** — the pre-existing, unchanged cross-client activity feed (filterable by event type and client), reading `activity_log` directly. Real, live, already in production use.

**Operational Control** (`OperationsControlPanel.tsx`) — six sub-tabs, all backed by a real schema shipped in Programme Stage O (`docs/programme/status/Stage_O_Status.md`, 2026-08-11, "backbone implemented, deployed, live-verified"):

| Sub-tab | Backing | Real status |
|---|---|---|
| Metrics | `client_publish_attempts`, `client_exception_queue`, `client_work_items`, computed live via `src/lib/observability.ts` | Real — publish success rate, open exceptions, exception age, overdue work items, work items completed, client count. No fabricated placeholder numbers; two of nine originally-named dashboard metrics (provider health, analytics freshness) are honestly absent since no data source exists yet. |
| Intelligence | `client_intelligence_*` operationalization tables (2A-F), `IntelligenceOperationsPanel.tsx` | Real — portfolio readiness, refresh requests, change-proposal review, consumption audit. Distinct from each client's own per-client Intelligence page. |
| Team & Roles | `team_members` (Stage O's real fix: `auth_client_ids()` now correctly routes every staff role through `team_members`, not just admin/account_manager) | Real, working staff-to-client assignment UI. Fine-grained per-role *write* permissions are explicitly **not** built — every non-admin staff role gets identical read visibility today. |
| Work Items | `client_work_items` — a generic, polymorphic work-allocation table (assignee, due date, priority, SLA, blocker, status) | Real, working create/assign/status-transition UI. This is the direct, reusable pattern for Phase 06 (Sales) and Phase 07 (Delivery) rather than bespoke new schemas. |
| Cost & Margin | `client_cost_ledger` (7 named cost categories) + `client_margin_summary` view + `clients.monthly_revenue_estimate` | Real, working manual cost-entry and revenue-estimate UI. Margin is only ever shown when a revenue figure is actually on file — never fabricated. No automatic cost population from generation activity yet (e.g. Reel Studio's `generation_credits_ledger` still has no per-request credit-cost field). |
| Onboarding | `client_onboarding_templates` + `onboard_client` RPC | Real, working repeatable client-onboarding workflow — creates a client, assigns an account manager, and applies a template's automation + capacity policy in one call. Industry starter packs / proof schemas / brand-config templates are named in the schema (`default_content_requirements`) but nothing populates or consumes that column yet. |

Two components (`AgentControlPanel.tsx`, `AutomationList.tsx`) are exported from `src/components/operations/index.ts` but rendered nowhere — confirmed orphaned, zero-import legacy code, not wired into either tab.

**Separately, and not previously audited:** `src/pages/CockpitPage.tsx` (the app's actual landing page) is already a real cross-client command center — a system-readiness tile band (total/active clients, Stage 1/2/3-not-run counts), a recent cross-client activity feed, and a per-client stage-status table. This substantially pre-satisfies Phase 01's "Command Center" deliverable; Phase 01 is now a *build on top of* CockpitPage.tsx and the Metrics sub-tab above, not a from-scratch build.

**Net correction to the build plan's audit table:** Delivery/Operations moves from "unaudited" to **partial** (Work Items + Metrics + Onboarding are real; Clients→Onboarding→Projects→Tasks→Deliverables→SOPs→Quality→Reporting as a full pipeline is not). Team moves from "partial (users table only)" to **partial, materially further along** (`team_members` assignment + role vocabulary + Stage O's isolation fix are real; capacity/performance data and fine-grained write permissions are not). Finance moves from **net-new to partial** (`client_cost_ledger`/`client_margin_summary` are real, manual-entry only). Overview moves from "partial" to **partial, materially further along** (CockpitPage.tsx's tile band + activity feed are real cross-client visibility, not just per-client). Automations stays **partial** but the "cross-business observability UI" gap the plan named is now half-closed by the Metrics/Work Items tabs, just not framed as an agent/workflow registry view yet.

---

## 2. Why the 7-workspace / `entities` / `campaigns` / MRR architecture was retired

Traced via git history rather than assumed. This repo's first substantive commit (`fd488e0`, 2026-06-03, "live-wire cockpit to Supabase — all 7 workspaces, auth, realtime") wired the frontend to a schema built around an `entities` table (not `clients`) — 19 tables total, including `campaigns`, `contracts`/`mrr_snapshots`/`payments` (MRR and finance tracking baked in from day one), `triage_items`, `conversations`/`messages`, `proof_uploads`, `pulse_metrics`, `automations`, `assets`, `briefs`, `team_members`, `agent_events`, and an undocumented `credential_registry`. A 2026-06-21 reconciliation pass (`docs/reconciliation-report.md`, now marked deprecated at its own top) audited this live schema against three spec documents — `attract-acquisition-backend.md`, `-frontend_1.md`, `-system-map_1.md` — and found real, substantial drift between the specs and the live database on nearly every table (renamed columns, removed fields, an undocumented table). None of those three spec docs ever appear as deleted files in *this* repo's own git history; they were workspace-level reference documents that lived outside the Cockpit repo, not files removed from here — CLAUDE.md's phrasing ("no longer exist in this repo") is accurate on that specific point.

That `entities`-based architecture was then superseded — first by the **Client Context OS** schema (rebuilt around `clients`, the table this entire codebase now runs on), and Client Context OS's own Phase 1/2 and Batch A–D1 build tracks were themselves later closed in favor of the current live architecture (Intelligence agents, Ideation, Creation, Reel Studio). In short: this codebase has already been through one full generational rewrite of its core data model once before, driven by exactly the kind of drift-between-plan-and-reality this Phase 00 audit exists to catch early. **Lesson for Stage 2, stated once and treated as load-bearing for the rest of this plan:** build the next generation additively on `clients`/`businesses`, verify against live state before writing any new spec doc, and never let a spec document's assumptions outlive the schema without being re-reconciled — this is precisely how the last architecture went stale.

---

## 3. Open Decisions — answered

All five, confirmed with Alex Thomas as owner, 2026-08-20.

### Decision 1 — Business Object vs. `clients`

**Answer: additive `businesses` table, optionally linked to `clients`.**

Concrete finding that made this decision easy to reason about correctly: `clients.is_internal_client` already exists, and the very first schema migration (`20260702074337_v1_foundation.sql`) already seeded **Attract Acquisition itself as a `clients` row** (`name: 'Attract Acquisition'`, `is_internal_client: TRUE`) — used for real dogfooding (Reel Studio's own live Phase B/C/D tests ran against this exact row). AA is not *becoming* row #1 of a new table in Phase 02; it already is a `clients` row today.

`clients`' existing columns (`package_tier`, `account_manager_id`, `health_score`, `stage1_status`/`stage2_status`) are all agency-service-delivery concepts — "who does AA deliver marketing/content services to." Sales/Finance/Team/Executive-AI ownership is a different axis that doesn't belong on those columns, and a future Business #2 that is not an AA agency client at all (a separate venture) shouldn't be forced through `package_tier`/`account_manager_id` to exist. The new `businesses` table (Phase 02) will therefore be genuinely additive — AA's business row links 1:1 to its existing internal `clients` row via a nullable FK; a business with no agency-service relationship simply has that FK null.

### Decision 2 — Sales: thin CRM vs. integrate

**Answer: build thin, reusing Stage O's `client_work_items` polymorphic-overlay pattern.**

Phase 06 should not invent a new bespoke schema for Leads/Conversations/Opportunities/Follow-Up/Closing. Stage O already ships exactly the right building block — a generic, polymorphic work-allocation table (assignee, due date, priority, SLA, blocker, status) — and the Sales pipeline's stages are a natural fit for the same convention (a domain-specific status enum plus the same assign/transition RPC shape `assign_work_item`/`update_work_item_status` already establish). This also means Phase 06 has a real, tested precedent to build from rather than a truly greenfield design.

### Decision 3 — Communications Hub v1 channel + verification owner

**Answer: Instagram/Meta DMs.** Requires Meta Business platform verification — per the build plan's own recommendation, that verification process should be kicked off now (Phase 00), not deferred to when Phase 10 engineering actually starts, since it is an external, slow-moving clock outside engineering's control. **Verification owner: Alex Thomas**, unless delegated later.

### Decision 4 — "Thin enough," per department, in numbers

**Answer, proposed and adopted as the default bar** (Alex may override any individual department's bar in chat before that phase starts; this is a starting discipline, not a hard ceiling): grounded directly in Stage O's own real precedent rather than an arbitrary number —

- **≤ 3 new tables** per department for its v1 (Stage O's Work Items + Cost/Margin + Onboarding together used exactly 3: `client_work_items`, `client_cost_ledger`, `client_onboarding_templates`).
- **≤ 2 new UI tabs/sections** per department for its v1 (matches Operations Control's own per-sub-tab scope).
- **0 new edge functions where a direct `supabase.rpc(...)` call suffices** — Stage O shipped its entire backbone with zero new edge functions, following the established direct-RPC convention for administrative/policy operations (Gate B–G, Stage M, Stage N).
- Any department needing more than this bar to reach a working v1 must say so explicitly in its own phase kickoff, with the reason — matching this document's own discipline of stating scope reductions prominently rather than burying them (see Stage O's own "What this stage does not attempt" section as the house style to follow).

### Decision 5 — Real engineering / AI-assisted-dev capacity

**Answer: near-full-time build track** — Alex + Claude Code sessions, at a cadence similar to the Ideation/Creation nav consolidation and Reel Studio Phases A–D (i.e., the sessions that produced this plan and the Stage O backbone). This resolves the build plan's own stated uncertainty: the ~5–6 month continuous-engineering-effort estimate is the operative one, not the 12–18 month calendar-time estimate's slower bound — though the calendar-time gates themselves (real usage periods, a real sales cycle, a real accounting period, external platform verification) remain genuine waits regardless of engineering capacity, and are not compressed by this answer.

---

## 4. Acceptance bar per new department

One line each, per the build plan's own requirement, revised to account for what Section 1 found already exists.

- **Sales:** a lead can be captured, logged through at least one real conversation, marked an opportunity, and closed — end to end, for one real AA sales cycle — using the `client_work_items` convention rather than a new bespoke pipeline schema.
- **Delivery/Operations:** one real AA client engagement runs fully through Clients→Onboarding→Projects→Tasks→Deliverables by hand, building only what Section 1 confirmed is genuinely missing (the Onboarding step itself is already real via `onboard_client`).
- **Finance:** CSV import plus one full accounting period reconciled against the *already-real* `client_cost_ledger`/`client_margin_summary` — this is an extension of existing schema, not a new one, so its v1 bar is import automation and a real revenue-side reconciliation, not new cost/margin tables.
- **Team:** every current human and agent role accurately represented in a directory view that extends `team_members` (already real) with agent-run attribution from Automations — not a new roles table from scratch.
- **Communications Hub:** one real Instagram/Meta DM conversation flows through identity resolution and attributes correctly to the right Sales or Delivery record, with Meta Business verification already granted by the time engineering starts (kicked off in Phase 00, per Decision 3).
- **Opportunity OS:** Detect→Score→Explain ships as a human-reviewed report only, reads from Finance/Sales data with multiple real reconciled cycles already behind it, and earns a full quarter of human review before anything downstream is allowed to act on its output.

## 5. Human-approval gate list

Concrete, per the plan's cross-cutting discipline item 4 ("every irreversible action gets a human sign-off first"). Enforcement layer noted per gate — most already exist as real mechanisms in this codebase; Stage 2 work should use them, not invent parallel ones.

| Action | Sign-off required | Enforcement layer |
|---|---|---|
| Any schema migration that drops a table, column, or function | Alex, before `apply_migration` is called | Manual — no automated block exists; this document is the standing instruction |
| Any edge function deploy to the production Supabase project | Alex, before `deploy_edge_function` is called | Manual |
| Any merge to `main` | Alex, via PR review/merge (or explicit "merge it" instruction to a Claude Code session) | GitHub PR flow, already in use throughout this session |
| Any change to `auth_client_ids()` or other RLS-governing functions | Alex — this is the exact class of change Stage O's own real client-isolation bug came from | Manual; `get_advisors` run post-change as a secondary check, already established practice |
| Any change to the `reel_video`/`humanOnly` gate, or any other CLAUDE.md-documented "intentionally in place" product rule | Alex, explicit — CLAUDE.md already states this rule for Reel Studio and it is treated as load-bearing for Stage 2 too | CLAUDE.md itself is the enforcement layer; a session reading it first is the control |
| Wiring Finance data into any agent's decision-making | Alex — per this plan's Principle 04, Executive intelligence goes last, and per Decision 4 for Finance, this cannot happen before one full reconciled period exists | Manual; no automation should reach for `client_cost_ledger`/`client_margin_summary` in a prompt or tool call until this sign-off is given |
| Any auto-action triggered from Opportunity OS output (Phase 11) | Alex, explicit, and not before the full-quarter human-review period in Section 4's acceptance bar has actually elapsed | Manual, checked against real `client_research_runs`-style dated records the same way Intelligence OS releases already are |
| Onboarding a real (non-pilot) Business #2 (Phase 12) | Alex — this is a real commercial/operational decision, not an engineering one | Manual |
| Approving any AI-generated content, plan, or intelligence release for real use | Alex or a named delegate — this already exists as a hard rule for Intelligence OS releases ("no auto-approve generated content, human review required") and extends unchanged to Stage 2 | Existing per-domain review workflow (e.g. `client_intelligence_releases` review gate) |

---

## Exit check

Every item in Section 3 has a recorded answer with a named owner (Alex Thomas, 2026-08-20). **Phase 00 is complete. Phase 01 (Overview / Command Center) may begin, building on the real `CockpitPage.tsx` and Operational-Control Metrics tab identified in Section 1 rather than from scratch.**
