# Stage 2 Build Plan — Attract Acquisition Business OS

A dependency-gated route from Cockpit as it exists today to a generalized, multi-business operating architecture — sequenced so nothing generalizes before it's proven once, concretely, on Attract Acquisition itself.

13 phases. Gated, not scheduled. Read alongside the Business OS Blueprint.

**Status:** Phase 00 complete (2026-08-20). Phase 01 shipped and live-tested (2026-08-20); its exit gate is a genuine two-week real-usage wait, earliest completion 2026-09-03 — see Phase 01's own card below. Phase 02 complete (2026-08-20), started and finished ahead of Phase 01's exit gate on Alex's explicit instruction — safe to do because Phase 02 is genuinely additive and provably isolated (zero inbound foreign keys into `businesses` from anywhere else in the schema), so it carries no risk to Phase 01's still-running usage-gate clock. Phase 03 complete (2026-08-20) — surfaced a real, unreviewed live subsystem (see Phase 03's own card: the unmerged Facebook branch stack, deployed to production, invisible until now). Phase 04 complete (2026-08-20) — the thinnest phase yet, zero new schema. Phase 05 complete (2026-08-20) — full dependency trace found no landmines (nothing was dropped), a real naming collision caught before it happened, and a real UI-ordering regression caught by the test suite and fixed before merge. Phase 06 shipped and live-tested (2026-08-20) — Decision 2's literal text ("reuse `client_work_items`") turned out to be infeasible once checked against the real constraint (`client_work_items.client_id` is `not null`, but a lead is by definition pre-client); built bespoke, cross-business `sales_leads`/`sales_conversations` tables instead, preserving Decision 2's actual intent (thin CRM, not an integrated tool) — see Phase 06's own card. Its exit gate is a genuine real-usage wait, same class as Phase 01's. Phase 07 shipped and live-tested (2026-08-20) — reconciled against Phase 00's own Operations-page audit before writing anything: Clients, Onboarding, and Tasks (`client_work_items`) were all already real, so the only genuine gap was Projects (the grouping missing above individual work items) and Deliverables (a client-facing output with its own review/approval state); built exactly those two tables, plus an additive `project_id` column reusing `client_work_items` for Tasks unchanged, within Decision 4's ≤3-table budget. SOPs/Quality/Reporting from the phase card's longer wishlist are deliberately deferred — see Phase 07's own card. Its exit gate is also a genuine real-usage wait, same class as Phase 01's and Phase 06's.

---

## Operating principles

Five constraints this plan will not trade away, each earned from a specific failure mode already visible in this codebase or in the planning conversation that produced this document.

1. **Concrete before generic.** Every new department gets Attract Acquisition's own specific schema first. Generalized "universal primitives" get designed against Business Instance #2's real friction, not guessed at in advance.
2. **Instance #2 is the forcing function.** Nothing gets abstracted until a second real business needs it to be. Onboarding Business #2 is Phase 12, not a footnote — it's the actual test.
3. **Revenue never waits on architecture.** AA keeps selling done-for-you outcomes throughout. No platform phase is allowed to become a precondition for commercial delivery.
4. **Executive intelligence goes last.** Opportunity OS and the Executive AI are consumers of Finance, Sales and Marketing data. They ship only once that data has real, reconciled cycles behind it.
5. **Every phase is gated, not scheduled.** A phase ends when its exit check passes on real usage — the same discipline that made the Ideation/Creation consolidation trustworthy — not when a calendar says so.

## Where this actually stands today

The Blueprint's target taxonomy reads as a from-scratch build. Most of Marketing already exists as live, working pages — the gap is narrower, and in different places, than it looks from the outside.

| Target department | Current equivalent | Status | Note |
|---|---|---|---|
| Overview | Per-client Overview tab (Overview/Pipeline/Client Settings/Automations/Activity Log) **plus** `CockpitPage.tsx`'s existing cross-client tile band + activity feed | partial, materially further along | `CockpitPage.tsx` is already a real cross-client command center (client counts, stage-not-run counts, recent activity). Phase 01 builds on it, not from scratch. |
| Intelligence | Intelligence page — Market OS, Avatar OS, Competitor OS, Association OS, Brand Strategist, Campaign Intelligence | exists | Already a top-level page, already separate from Marketing. The Blueprint's "pull it out of Marketing" premise is largely already true. |
| Marketing → Strategy | Brand Strategist / Campaign Intelligence, currently under Intelligence | partial | The agents exist; a dedicated Strategy surface (positioning, channel plan) doesn't yet. |
| Marketing → Offers | Offer page — Main Offers, Seasonal Offers, **visually grouped under "Marketing" (Phase 05)** | exists | Already a distinct top-level page. |
| Marketing → Ideation | Ideation page — Content Supply, Ideation, Content Items, Calendar, **visually grouped under "Marketing" (Phase 05)** | exists | Consolidated from three overlapping pipelines into one (see the Ideation/Creation nav restructure work). |
| Marketing → Creation | Creation page — Content Briefs, Reel Studio, Assets, **visually grouped under "Marketing" (Phase 05)** | exists | Same consolidation. Production Studio retired as dead weight. |
| Marketing → Distribution | Distribution page — Organic, Paid, **visually grouped under "Marketing" (Phase 05)** | exists | — |
| Marketing → Campaigns | `client_marketing_campaigns` (Phase 05, complete) — name, channel, offer, avatar, status | exists | Budget/results are real columns, structurally unreachable by any RPC until Finance and Distribution have real linkage. Asset linkage deferred entirely. |
| Marketing → Iteration | Iteration page — Analytics, Performance & Iteration, **visually grouped under "Marketing" (Phase 05)** | exists | — |
| Sales | `sales_leads`, `sales_conversations` (Phase 06, shipped, exit gate pending) — cross-business, keyed off `businesses(id)` | exists | Greenfield, and genuinely schema-greenfield after all: Decision 2's literal text (reuse `client_work_items`) didn't survive contact with `client_work_items.client_id`'s `not null` constraint — a lead has no `clients` row yet. Built thin and bespoke instead, preserving Decision 2's actual intent. |
| Delivery / Operations | App-level Operations page — Activity Log **plus** a real "Operational Control" tab (Metrics, Intelligence, Team & Roles, Work Items, **Projects (Phase 07, shipped, exit gate pending)**, Cost & Margin, Onboarding), backed by Programme Stage O | exists (to Deliverables), rest deferred | `client_projects`/`client_deliverables` close the one genuine gap (grouping above individual `client_work_items` rows) — Tasks reuse Work Items unchanged, Onboarding and Metrics were already real. Clients→Onboarding→Projects→Tasks→Deliverables now all exist; SOPs/Quality/Reporting stay deliberately deferred (no existing usage pattern to design against; Reporting is a computed rollup, not new schema — see Phase 07's card). |
| Finance | `client_cost_ledger` + `client_margin_summary` view + `clients.monthly_revenue_estimate`, manual-entry only (Stage O) | partial | Not greenfield. Phase 08 extends this real backbone (CSV import, then integrations) rather than building cost/margin tables from scratch. |
| Team | `team_members` assignment (all 9 Stage O roles, real client-scoped read visibility) + `users` role vocabulary | partial, materially further along | Stage O's real fix: `auth_client_ids()` now correctly routes every staff role through `team_members`, not just admin/account_manager. Fine-grained per-role *write* permissions and agent-capacity modeling are still not built. |
| Automations | Edge-function registry + per-client Automations subtab + Operational Control's Metrics/Work Items/**Workflows/Triggers** sub-tabs (Phase 03, complete) | exists | Workflows renders the real registry; Triggers reads `cron.job` live. Surfaced a real gap: 21 functions deployed but unregistered, 10 of them from an unmerged Facebook branch stack — see Phase 03's card. |
| Knowledge | Context Files / Execution Files / Context Inputs, per client, **plus a Search tab (Phase 04, complete)** | exists | AA already had 21 approved Context Files + 22 Execution Files — already a full knowledge instance, nothing to instantiate. Search is a pure client-side function over already-fetched content; 0 new schema. |
| Business Selector | `businesses` table + `/businesses` list/detail pages + nav item (Phase 02, complete) | exists | AA is business row #1, linked to its existing internal `clients` row. Thin by design — no Sales/Finance/Team ownership yet; those attach in later phases. |

## Why this order

Four judgments determine the sequence below, ahead of any individual phase.

- **Cheapest and most-existing goes first.** Overview, the Business Selector, and Automations-as-a-UI all sit on data that already exists. They're low-risk, immediately useful, and they establish the "business object" and observability patterns that every later phase reuses.
- **Marketing's IA cleanup is deliberately mid-table, not first.** It looks cosmetic and isn't — it carries the same class of risk the Ideation/Creation consolidation surfaced (foreign keys into Ad Studio and Analytics nobody expected). It gets the full dependency-trace discipline, on its own timeline, not rushed because it looks easy.
- **Sales and Delivery are the real test of "thin."** They're the first two departments with no existing surface to lean on. How they're scoped sets the pattern — and the acceptance bar — for Finance and Team behind them.
- **Everything that reasons across departments ships last.** Opportunity OS and Executive AI are readers, not sources. They wait for Finance, Sales and Marketing to have real, reconciled history to read.

---

## The phased plan

Each phase below has: what it builds on, what it deliberately defers, its deliverables, its concrete ordered execution steps, and its exit gate. **Nothing here is a calendar date** — convert to real timing only once real engineering capacity is known (see Open Decisions). Several phases end in a genuine *wait* (real usage, a real sales/accounting cycle) rather than a build task — don't grind past that step early.

### Phase 00 — Ground Truth & Decisions — **complete (2026-08-20)**

**Goal:** establish the factual and decision baseline every later phase depends on. No schema, no UI — this phase produces documents and answers, not code.

**Result:** all deliverables below produced; full detail in `docs/STAGE_2_PHASE_00_GROUND_TRUTH.md`. Headline findings: the app-level Operations page and `CockpitPage.tsx` are materially more built than assumed (Programme Stage O already shipped a real Team/Work-Items/Cost-Margin/Onboarding backbone); `clients.is_internal_client` already exists and AA is already seeded as a `clients` row, which resolved Decision 1 concretely rather than abstractly. All 5 Open Decisions answered and owned (Alex Thomas). See the updated audit table above and Open Decisions section below.

- **Builds on:** nothing. First phase.
- **Deliverables:** fresh page-by-page audit of the current IA against the target taxonomy (including the app-level Operations page); written summary of the retired 7-workspace/`entities`/`campaigns` architecture and why it was abandoned; Business Object schema decision, recorded; a one-page "thin" spec per new department with an explicit numeric acceptance bar; the human-approval gate list, concrete, with an enforcement layer named per gate.

**Steps:**
1. Open and read the app-level Operations page end-to-end; document what it actually contains against the Delivery/Ops target.
2. Locate and read the retired 7-workspace/`entities`/`campaigns` architecture references CLAUDE.md points at (check git history for the deleted docs it names: `docs/attract-acquisition-backend.md`, `-frontend_1.md`, `-system-map_1.md`) — write one paragraph on why it was retired.
3. Answer and record all 5 Open Decisions below (Business Object relation to `clients`, Sales build-vs-integrate, Comms Hub channel + verification owner, "thin enough" numeric bar per department, real engineering capacity).
4. Write one acceptance-bar line per new department (Sales, Delivery, Finance, Team, Comms Hub, Opportunity OS).
5. Write the human-approval gate list: which actions in every later phase require sign-off, and who signs.

**Exit gate:** every item in Open Decisions has a recorded answer, owned by a named person.

### Phase 01 — Overview / Command Center — **shipped 2026-08-20, exit gate pending**

**Goal:** the cheapest, highest-leverage phase — CEO-layer visibility built entirely on data that already exists.

- **Builds on:** `activity_log`, existing pipeline-state tables, the current per-client Overview tab, and — per Phase 00's finding — `CockpitPage.tsx`'s existing cross-client tile band and Operational Control's Metrics sub-tab.
- **Deferred:** Bottlenecks and Priorities as an AI inference. Ship as a manually-authored note first — "demand isn't the constraint, conversion is" has to be earned by a human before it's trusted from a model.
- **Deliverables:** Command Center and Activity views that aggregate existing tables. No new domain schema required.

**Steps:**
1. Inventory existing tables this can read from — no new schema.
2. Build the Command Center view as a read-only aggregation layer.
3. Add manually-authored Bottlenecks/Priorities notes.
4. Live-test against real AA data.
5. Ship to actual daily use.

**Result:** `CockpitPage.tsx` (the existing landing page) now surfaces an "Operational Health" tile row — publish success rate, open exceptions, oldest exception age, overdue work items — reusing `src/lib/observability.ts`'s existing pure aggregation functions verbatim (the exact ones Operations > Operational Control > Metrics already uses), reading the same three real tables. No new schema for this part, matching the plan's own deliverable. The one genuinely new piece is a "Bottlenecks & Priorities" panel backed by an additive `command_center_notes` table (the first cross-business, non-client-scoped table in this schema) and two admin-only RPCs (`add_command_center_note`, `resolve_command_center_note`) — following the direct-RPC convention Phase 00's Decision 4 calls for, not an edge function. Live-tested against `xivewedajschthjlblfb` inside a rolled-back transaction: happy path (add → verify → resolve → verify), double-resolve correctly rejected closed, unknown-role and unauthenticated inserts both correctly rejected, table confirmed empty afterward. `get_advisors` showed two new findings, both the same already-accepted "SECURITY DEFINER callable by authenticated" class every other Stage O admin RPC (`create_work_item`, `record_cost_entry`) already carries — no new class of issue. Full local suite verified: typecheck, lint (0 errors), `check:edge-functions` (unchanged, 0 new functions), full test suite, build, `git diff --check` all clean.

**Exit gate — not yet met, by design:** "AA leadership actually uses it for real decisions for two consecutive weeks before it's called done." The build is real and shipped; the phase itself cannot be marked complete until that usage period has actually elapsed. Earliest possible completion date: 2026-09-03.

**Exit gate:** AA leadership actually uses it for real decisions for two consecutive weeks before it's called done.

### Phase 02 — Business Selector — **complete (2026-08-20)**

**Goal:** make "business" a persistent, addressable concept — without touching anything already live.

- **Builds on:** the existing `clients` table and the `client_id`-threading pattern already proven throughout the app.
- **Deferred:** any generalized primitive. This phase is purely additive — it introduces a new table, it doesn't touch an old one.
- **Deliverables:** an additive `businesses` table; AA becomes row #1; business context threaded through routes exactly the way `client_id` already is, not reinvented.

**Steps:**
1. Design the additive `businesses` table (don't touch `clients`).
2. Migrate; insert AA as row #1.
3. Thread business context through routes the same way `client_id` already is.
4. Add a dummy test business fixture.
5. Verify switching between AA and the dummy breaks nothing already live (full regression pass: typecheck/lint/build/registry check/test suite).
6. Delete the dummy fixture.

**Result:** new `businesses` table (migration `20260820150000_stage2_phase02_businesses.sql`) — name, slug, a nullable `client_id` FK, nothing else; no column added to `clients`, no existing RLS policy touched. AA seeded as business row #1, linked to its existing internal `clients` row. One admin-only RPC (`create_business`), following the same direct-RPC convention as Phase 01. Routes mirror the `client`/`clients` pattern exactly: `ROUTES.businesses` (`/businesses`) and `ROUTES.business(id)` (`/businesses/:id`), wired the same way in `App.tsx`; a new "Businesses" nav item sits between Delivery and Operations. `BusinessesPage.tsx` (list + admin-only create form) and `BusinessDetailPage.tsx` (name/slug/linked-client + a "switch business" selector — the exit gate's actual interaction) are both new, deliberately thin — no department content, since none exists yet.

**Verification:** live-tested against `xivewedajschthjlblfb` inside rolled-back transactions before any frontend code was written (happy path standalone + linked, duplicate-slug rejection, unknown-client rejection, invalid-slug-format rejection, unauthorized-caller rejection). The dummy-fixture step (4–6) was run for real (committed, not rolled back): created `ZZ-TEST Dummy Business`, confirmed zero inbound foreign keys reference `businesses` from anywhere else in the schema (so nothing else *could* break by construction), confirmed `clients`/`activity_log` row counts unaffected, confirmed both businesses list correctly in creation order, then deleted the dummy — table back to exactly 1 row. `get_advisors`: one new finding, the same already-accepted "SECURITY DEFINER callable by authenticated" class every other admin RPC in this codebase carries. Full suite: typecheck, lint (0 errors), `check:edge-functions` (unchanged — 0 new functions), 922/922 tests (11 new), build, `git diff --check` all clean.

**One honest gap:** a real browser click-through of the new pages was not completed. Creating a disposable test login was blocked by the session's own permission classifier as a sensitive action; flagged to Alex, who chose to accept SQL- and code-level verification as sufficient rather than authorize one. Worth a real click-through next time someone is in the app.

**Exit gate:** met — switching between AA and one dummy test business broke nothing already live, verified directly against the real database and schema, not assumed.

**Exit gate:** switching between AA and one dummy test business breaks nothing that was already live.

### Phase 03 — Automations, surfaced — **complete (2026-08-20)**

**Goal:** an observability layer over the agent and edge-function runtime that already exists — not new execution infrastructure.

- **Builds on:** the existing edge-function registry pattern, extended repo-wide rather than invented fresh.
- **Deferred:** any new execution engine. This is a read-mostly UI over what's already running.
- **Deliverables:** Workflows / Agents / Runs / Triggers / Approvals / Logs views.

**Steps:**
1. Audit every currently-running scheduled/triggered process across the repo (edge functions, cron, workers) — build the full inventory first.
2. Extend the existing registry pattern to cover the attribution/categorization the UI needs (don't invent new execution infra).
3. Build Workflows / Agents / Runs / Triggers / Approvals / Logs views as read-mostly UI.
4. Cross-check the UI's inventory against the audit from step 1.

**Result — a major finding, not just a registry cleanup:** Step 1's audit (real `cron.job` rows + diffing all 115 functions actually deployed on `xivewedajschthjlblfb` against this repo's 103-function registry) surfaced a live, unreviewed production subsystem: a full "Programme Stage 1B: Facebook Distribution" build (10 edge functions, one — `collect-facebook-insights` — cron-triggered hourly against real Meta accounts) exists only on 5 remote branches (`stage-1b-a` through `-e`, pushed 2026-08-09/10) that were **deployed directly to Supabase but never merged**. `main` has since moved 43 commits past that stack's base. Alex's explicit call: document this gap in Phase 03 rather than absorb reconciling a stale, unrelated feature stack into this phase — flagged as a standalone, high-priority item for him to schedule separately (see "Open items" below), not resolved here.

Scoped the build to two new sub-tabs inside the already-real Operational Control surface (extending it, not building a parallel system), matching Decision 4's thin bar (0 new tables — one view-returning RPC; 2 new UI sections):
- **Workflows** — renders the governed registry itself (`registry.json`, statically imported, the exact source `npm run check:edge-functions` already enforces in CI — zero duplicated data), filterable by profile. Below it, a prominent "Deployed but not in this registry" panel listing all 21 functions found deployed-but-unregistered: the 10 unmerged Facebook functions, plus 11 already-known retired-Pipeline-B functions that were deleted from the repo but never actually undeployed (a previously-documented gap, now finally visible in-product instead of only in a session transcript).
- **Triggers** — a new staff-only RPC (`list_scheduled_triggers`) reads `cron.job` live and returns jobname/schedule/active/target-function, deliberately never the raw command text (which embeds a vault secret reference). The UI cross-references each trigger's target against the undocumented-deployment list and flags it directly (`⚠ target not in main`) when it resolves to one — `facebook-insights-worker` shows this warning live.

**Verification:** live-tested `list_scheduled_triggers()` against `xivewedajschthjlblfb` (correctly returns all 3 real jobs with parsed target functions and no leaked secret reference; correctly rejected for an anon/unauthenticated caller). `get_advisors`: one new finding, the same already-accepted class every other admin RPC here carries. Full suite: typecheck, lint (0 errors), `check:edge-functions` (unchanged — 0 new functions), 928/928 tests (6 new, including a cross-check that every function named in the UI's undocumented-deployment list is genuinely absent from the local registry — Phase 03's own step 4, enforced in CI rather than a one-time claim), build, `git diff --check` all clean.

**Exit gate:** met for what's addressable from this repo — every real scheduled/triggered process (all 3 `cron.job` rows, all 103 registered functions, and all 21 deployed-but-unregistered functions found in the audit) is now visible and correctly attributed, including the ones nobody had surfaced before. What remains genuinely open is not a Phase 03 gap: whether/how to reconcile the Facebook branch stack is Alex's call, tracked below, not blocking this phase or Phase 04.

**Open item, not part of Phase 03's own scope:** decide the fate of `stage-1b-a` through `stage-1b-e` (merge after a real review, or explicitly retire/undeploy) — flagged, not resolved.

### Phase 04 — Knowledge (thin) — **complete (2026-08-20)**

**Goal:** give the existing context-file substrate a cross-referencing layer, and extend the pattern to AA itself.

- **Builds on:** Context Files, Execution Files, Context Inputs — already real, already per-client.
- **Deferred:** automated Business Memory / Learning OS capture. That needs real agent-run history to learn from — Phase 11+ territory.
- **Deliverables:** a search and cross-reference layer over existing knowledge tables; AA's own knowledge base, as business #1.

**Steps:**
1. Inventory existing Context Files / Execution Files / Context Inputs schemas per client.
2. Build a cross-reference/search layer over them (no new capture mechanism yet).
3. Instantiate AA's own knowledge base as business #1's content.
4. Pick one real AA-specific question and test whether the layer answers it correctly.

**Result — step 3 was already done, and step 1's inventory found more than expected.** AA already has 21 approved Context Files and 22 Execution Files with real, substantial content (business context, avatar/buyer psychology, offer architecture, proof bank, positioning, brand voice, content system, and more) — "AA's own knowledge base, as business #1" already existed; nothing needed to be instantiated. The inventory also surfaced real, already-wired-but-unpopulated provenance infrastructure — `client_context_file_citations`, `client_source_documents`, `client_document_chunks`, live edge functions (`process-source-document`, `record-context-file-provenance`) — a genuine citation/provenance layer that's simply never been exercised for AA's own content. Left untouched: activating it is a real, separate piece of work, not what this phase's "no new capture mechanism yet" deferral asked for.

The actual gap was retrieval, not storage: no way to search across files, only view them one at a time. Built the thinnest possible version — `src/lib/knowledge-search.ts`, a **pure function**, zero new schema, zero new RPC, zero new edge function: it splits each already-fetched file's `content_md` into its markdown sections and ranks them by term-occurrence count against a query. `KnowledgeSearchPanel.tsx` calls the exact same `fetchClientContextFiles`/`fetchClientExecutionFiles` every other Context tab already uses — no new backend surface at all, the thinnest phase in this plan so far. New "Search" tab added to the existing Context nav group, right where Context Files/Execution Files already live. Also linked Phase 02's Business Selector into it: a linked client's `BusinessDetailPage` now has a direct "Search its knowledge base" link.

**Verification — the exit gate itself:** pulled AA's real, approved `07_Brand_Voice_And_Style_Guide.md` content live from `xivewedajschthjlblfb`, ran the actual `knowledge-search.ts` source against it (not a simulation) with the real question *"what words should we never use in our marketing?"* — correctly ranked the "Words & Phrases to NEVER Use" section first, with a snippet containing the real banned-term table. Reproduced as an embedded fixture in the test suite so it's enforced in CI without a live DB dependency going forward. Full local suite: typecheck, lint (0 errors), `check:edge-functions` (unchanged — 0 new functions, 0 new migrations), 936/936 tests (8 new), build, `git diff --check` all clean.

**Exit gate:** met — a real AA-specific question was answered by querying this layer, verified against real content, not assumed.

### Phase 05 — Marketing IA consolidation — **complete (2026-08-20)**

**Goal:** decide, and only then execute, nesting Offer / Ideation / Creation / Distribution / Iteration under a Marketing parent — plus the one genuinely new object, Campaigns.

- **Builds on:** the exact phased discipline already proven on the Ideation/Creation consolidation: full dependency trace, hide before delete, drop only after real usage.
- **Deferred:** Campaign "budget" and "results" fields stay empty shells until Finance (08) and Distribution have real linkage to populate them meaningfully.
- **Deliverables:** nav regrouping, if the trace shows it's safe; a real `campaigns` object linking offer, avatar, assets, channel, budget and results.

**Steps:**
1. Grep every foreign key and RPC referencing Offer/Ideation/Creation/Distribution/Iteration tables across `src/`, `supabase/functions/`, and every migration — not just panel-level files.
2. Read (not just grep-match) every file that surfaces, exactly like the Ideation/Creation consolidation did — confirm real vs. false-positive references.
3. Design the `campaigns` object (offer, avatar, assets, channel, budget, results as empty shells pending Finance/Distribution).
4. Draft the nav-nesting change; ship as hidden-but-routable first, not deleted.
5. Live-test each affected flow against real client data with disposable fixtures.
6. Only after real usage on the new nesting, retire old routes/tables following the hide-then-drop discipline.

**Result — the trace found no landmines, a real naming collision, and a real UX question.** Full dependency trace (`docs/STAGE_2_PHASE_05_DEPENDENCY_TRACE.md`) found every inbound FK into the Offer/Distribution/Iteration/Avatar table clusters resolves inside Marketing's own natural boundary — a genuinely different result from the Ideation/Creation trace, because Phase 05 drops nothing (steps 4–6's hide-then-drop discipline only applies once real usage exists; nothing was hidden or dropped this pass). The trace also caught a real naming collision before it happened: "Campaigns" is already used for two other, different concepts (`ad_campaigns`, `client_campaign_periods`/Campaign Intelligence) — the new object is named `client_marketing_campaigns`.

Two real judgment calls, both confirmed with Alex before building: **nav nesting is visual grouping only, not a new 3-level nav** (this app has never had page → sub-page → tab; a literal reading would add a click to Ideation/Creation, its most-used areas, for an organizational win) — Offer/Campaigns/Ideation/Creation/Distribution/Iteration get a shared "Marketing" label in the existing pill row, same routes, same one-click reach. **Campaign asset-linkage is deferred alongside budget/results** — no workflow anywhere tags an asset to a campaign yet, so a join table now would guess at a shape (Principle 01).

`client_marketing_campaigns` v1: name, channel, an approved offer, an approved avatar — all real FKs, validated server-side to belong to the same client — plus status (planning → active → completed → archived) and dates. `budget_cents`/`results` are real columns but structurally unreachable: neither RPC accepts them as input, enforced by a CI test reading the actual function bodies, not just documented as a convention. New `MarketingCampaignsPanel.tsx` states the deferral honestly in the UI rather than silently omitting the fields.

**A real regression, caught and fixed before merge, not after:** the first implementation pass reordered the nav array to make the Marketing cluster fully contiguous, which moved Avatars out from between Offer and Ideation — breaking a real, pre-existing, deliberate test (`tests/avatar-os-stage5.test.ts`) asserting that exact ordering. Caught by running the full test suite, not by the dependency trace itself (a trace covers database FKs; it doesn't cover UI ordering assertions). Fixed by leaving Avatars in its original position and accepting two separate "Marketing"-labeled segments in the pill row, rather than editing a pre-existing test to fit new code.

**Verification:** live-tested `create_marketing_campaign`/`update_marketing_campaign_status` against `xivewedajschthjlblfb` inside rolled-back transactions (happy path, status transition, invalid-status rejection, unknown-offer rejection, unauthorized-caller rejection); table confirmed at 0 rows afterward. `get_advisors`: two new findings, the same already-accepted class every other admin RPC here carries. Full suite: typecheck, lint (0 errors), `check:edge-functions` (unchanged — 0 new edge functions), 947/947 tests (11 new), build, `git diff --check` all clean.

**Exit gate met**, and then some: the dependency trace document exists (the literal exit gate), and the additive build it authorized (Campaigns object, visual nav grouping) is live and verified, with zero tables dropped and zero existing routes changed.

### Phase 06 — Sales — **shipped and live-tested (2026-08-20), exit gate pending**

**Goal:** the first genuinely new department, and the first real net-new schema in this plan.

- **Builds on:** nothing existing — greenfield.
- **Deferred:** full Communications Hub integration (10). v1 logs conversations manually.
- **Deliverables:** a thin pipeline — Leads → Conversations → Opportunities → Follow-Up → Closing — built to whichever build-vs-integrate decision Phase 00 recorded.

**Steps:**
1. Apply Phase 00's build-vs-integrate decision (thin CRM vs. integrate + agent layer).
2. Schema/integration for Leads → Conversations → Opportunities → Follow-Up → Closing.
3. Build minimal UI for each stage.
4. Wire manual conversation logging (Comms Hub integration deferred).
5. Run AA's own real pipeline through it, lead to close.

**Exit gate:** AA's own real sales pipeline runs through it for one complete cycle, lead to close. **Genuinely not shortcuttable by disposable test fixtures**, same class of gate as Phase 01's — this phase can be shipped, live-tested, and merged, but is not "complete" until Alex actually runs a real prospect through it end to end.

**Result — Decision 2's literal text didn't survive contact with the real schema.** `client_work_items.client_id` is `not null`; a sales lead has no `clients` row until Sales' own job (converting it) is done. Reusing the table literally meant either seeding a fake `clients` row per lead — corrupting the one table every other department already trusts as "real client" — or loosening a live Stage O constraint for one department's convenience. Neither is thin, and neither was actually inspected before Decision 2 was recorded in Phase 00 (that decision praised the pattern's shape without checking the one column that mattered). Built bespoke instead: `sales_leads`/`sales_conversations`, cross-business, keyed off `businesses(id)` with no `client_id` column at all — the same shape `businesses`/`command_center_notes` already established for pre-client, cross-business content in Phases 01–02. Decision 2's actual intent — thin CRM, not an integrated tool plus an agent layer — is fully preserved; only its implementation detail changed, and only after checking, not guessing.

Schema: `sales_leads` (name, contact email/phone, source, estimated value, a flat 6-value `stage` check — lead/conversation/opportunity/follow_up/closed_won/closed_lost — assignee, lost_reason, closed_at) and `sales_conversations` (a manual per-lead touchpoint log: channel, summary, occurred_at). Four staff-gated RPCs: `create_sales_lead` (self-assigns the creator), `update_sales_lead_stage` (requires `lost_reason` to close as lost, clears it and `closed_at` on reopen — both enforced by table CHECK constraints, not just application code), `assign_sales_lead`, `log_sales_conversation` (the pipeline's one earned auto-transition: a lead's *first* logged conversation advances it out of the bare `lead` stage automatically; every later transition stays a deliberate, explicit staff action). Frontend: a new top-level `Sales` nav item (mirroring `Businesses`), `SalesPage.tsx` (pipeline list, filterable by business/stage) and `SalesLeadDetailPage.tsx` (stage advancement, assignment, conversation log) — 2 new UI sections, 2 new tables, 0 new edge functions, all within Decision 4's thin bar.

**Verification:** live-tested all four RPCs against `xivewedajschthjlblfb` inside a rolled-back transaction — happy path (create → auto-advance on first conversation → manual advance through opportunity/follow_up → close-lost fail-closed without a reason → close-lost with a reason → reopen clears `lost_reason`/`closed_at`), plus not-found/negative-value/nonexistent-assignee rejection and a separate unauthenticated/nonexistent-user auth-rejection pass — all fixtures rolled back, 0 rows left behind. `get_advisors`: the same already-accepted "authenticated can call this SECURITY DEFINER RPC" class every other staff-gated RPC in this schema carries, nothing new. Full suite: typecheck, lint (0 errors, same 6 pre-existing warnings), `check:edge-functions` (unchanged — 0 new edge functions), 962/962 tests (15 new), build, `git diff --check` all clean.

### Phase 07 — Delivery / Operations — **shipped and live-tested (2026-08-20), exit gate pending**

**Goal:** actual client-delivery operations — distinct from Automations' agent-ops, and from whatever the existing app-level Operations page turns out to be.

- **Builds on:** Sales (06), eventually, for the won-client handoff.
- **Deferred:** "Sales → Client Won → Delivery instantiated automatically." Built only after the manual version is proven on one real engagement. Also deferred: SOPs, Quality, and Reporting as new schema (see Result below).
- **Deliverables:** Clients → Onboarding → Projects → Tasks → Deliverables → SOPs → Quality → Reporting, operated by hand first.

**Steps:**
1. Reconcile with Phase 00's Operations-page audit — build only what's genuinely missing.
2. Schema/UI for Clients → Onboarding → Projects → Tasks → Deliverables → SOPs → Quality → Reporting.
3. Operate it by hand for one real AA client engagement (no automation yet).
4. Only after that engagement completes, evaluate adding the Sales → Won → Delivery auto-instantiation.

**Exit gate:** one real AA client engagement run fully through it by hand, before any handoff automation is added. **Genuinely not shortcuttable by disposable test fixtures**, same class of gate as Phase 01's and Phase 06's — this phase can be shipped, live-tested, and merged, but is not "complete" until Alex actually runs a real engagement through it.

**Result — reconciling against Phase 00's own audit found the real gap was narrower than the phase card's full wishlist.** Clients, Onboarding (`client_onboarding_templates` + `onboard_client`), and Tasks (`client_work_items`, Stage O's generic polymorphic work-allocation table) were all already real and live — confirmed against `STAGE_2_PHASE_00_GROUND_TRUTH.md` §1 before writing anything, not re-derived from scratch. The one genuine structural gap was **Projects**: there was no grouping above an individual `client_work_items` row anywhere in the schema. **Deliverables** — a client-facing output with its own draft→in_review→delivered→approved/rejected review state — is a second, genuinely distinct concept from an internal task, so it earned its own table rather than being folded into Work Items.

Built exactly two new tables (`client_projects`, `client_deliverables`) plus one additive `project_id` column on the existing `client_work_items` table — Tasks reuse Stage O's real Work Items table unchanged, exactly as Phase 00's own audit anticipated ("This is the direct, reusable pattern for Phase 06 (Sales) and Phase 07 (Delivery) rather than bespoke new schemas"). Within Decision 4's ≤3-table budget. `create_work_item`'s signature gained a trailing `p_project_id` parameter — since a new parameter changes a Postgres function's signature, the migration explicitly `drop function`s the old 12-arg version first rather than leaving two overloads callable side by side (a mistake that would have surfaced as an ambiguous-RPC error the first time the frontend called it, not caught by `create or replace` alone).

**SOPs, Quality, and Reporting are deliberately deferred, and the phase card's own text and Phase 00's negotiated acceptance bar disagree about this — worth naming plainly rather than picking silently.** The phase card's "Deliverables" bullet lists the full eight-stage pipeline through Reporting; Phase 00's own acceptance bar for this department explicitly narrows to "Clients→Onboarding→Projects→Tasks→Deliverables by hand," stopping short of SOPs/Quality/Reporting. Built to the narrower, negotiated bar: SOPs would be a reusable checklist/template system with no existing usage pattern anywhere in this codebase to design against yet (Principle 01 — the same reasoning Phase 05 used to defer Campaign asset-linkage); Quality has no established QA-review workflow to reuse either; Reporting is satisfied by a computed rollup already visible in the Projects tab (tasks-done / deliverables-approved counts, no new schema) rather than a dedicated reporting surface.

**Verification:** live-tested all five RPCs (`create_project`, `update_project_status`, `create_deliverable`, `update_deliverable_status`, the updated `create_work_item`) against `xivewedajschthjlblfb` inside a rolled-back transaction — full happy path (project created → active → a task created and scoped to it, moved to done → a deliverable created and walked draft→in_review→delivered→approved, confirming `delivered_at` is set once and preserved through the approve step, `link` persists without being re-supplied, and `approved_at` is set only on approval → project marked completed with `completed_at` set), plus project/client-mismatch rejection on `create_work_item`, nonexistent-project rejection on `create_deliverable`, invalid-status rejection, and a confirmed-working backward-compatible `create_work_item` call with no `project_id` at all. Separate unauthenticated/nonexistent-user auth-rejection pass, both correctly rejected. `get_advisors`: zero new table-level findings; the four new RPCs carry only the same already-accepted "authenticated can call this SECURITY DEFINER RPC" class every other staff-gated RPC in this schema carries. Full suite: typecheck, lint (0 errors, same 6 pre-existing warnings), `check:edge-functions` (unchanged — 0 new edge functions), 974/974 tests (12 new), build, `git diff --check` all clean.

Frontend: a new "Projects" sub-tab in `OperationsControlPanel.tsx` (9th sub-tab, matching the existing 8's own convention exactly) — create a project, advance its status, and select it to see its own tasks and deliverables (not every work item for the client) with inline add/advance actions for both, plus the tasks-done/deliverables-approved rollup. 1 new UI section, within Decision 4's ≤2-tab budget.

### Phase 08 — Finance

**Goal:** built to the Blueprint's own phased sequencing almost exactly — it's the best-sequenced section of that document.

- **Builds on:** nothing existing — greenfield; the sequencing itself is the discipline.
- **Deferred:** feeding Finance data to any agent decision, until numbers are reconciled and trusted for at least one full period.
- **Deliverables:** CSV import → accounting-platform integration → payment processors → direct bank feeds → increasingly autonomous reconciliation, in that order, each step gated on the last.

**Steps:**
1. Stand up CSV import first; validate against real AA transactions.
2. Add accounting-platform integration once CSV import is trusted.
3. Add payment-processor integration.
4. Add direct bank feeds.
5. Add increasingly autonomous reconciliation, each step gated on the previous one being trusted.
6. Run one full accounting period through the pipeline end-to-end.

**Exit gate:** real AA numbers, reconciled, for one full accounting period, before Finance data touches any agent.

### Phase 09 — Team

**Goal:** an organizational model spanning humans and agents — not a headcount list.

- **Builds on:** Automations (03) for agent-run attribution data.
- **Deferred:** capacity-based auto-allocation of work. That's Executive AI territory (12).
- **Deliverables:** Roles / Agents / Responsibilities / Capacity, with a directory view covering both humans and agent roles.

**Steps:**
1. Pull agent-run attribution data from Phase 03's Automations layer.
2. Build Roles / Agents / Responsibilities / Capacity schema.
3. Populate the directory with every current human and agent role at AA.
4. Cross-check against actual current staffing/agent inventory for fictional entries.

**Exit gate:** every current human and agent role at AA is accurately represented — no fictional org chart entries.

### Phase 10 — Communications Hub

**Goal:** channel-agnostic identity and conversation timeline — scoped as its own workstream, not a horizontal-layer afterthought.

- **Builds on:** Sales (06) and Delivery (07) as its first consumers.
- **Deferred:** full channel breadth. Start with one or two channels, not the whole list.
- **Deliverables:** identity resolution, a conversation timeline, routing into Sales/Delivery agents. Platform verification (Meta/WhatsApp business review) should start in Phase 00, in parallel — that clock runs outside engineering's control.

**Steps:**
1. Kick off external platform verification (Meta/WhatsApp Business review) — this should already be running since Phase 00; check status.
2. Pick the one channel decided in Phase 00.
3. Build identity resolution + conversation timeline for that channel.
4. Wire routing into Sales (06) and Delivery (07) records.
5. Run real conversations through it.

**Exit gate:** one channel's real conversations flow through it and attribute correctly to the right Sales or Delivery record.

### Phase 11 — Opportunity OS

**Goal:** a specialist "what opportunities exist" layer — a reader of Finance, Sales and Marketing data, not a source of truth.

- **Builds on:** Finance (08), Sales (06) and Marketing performance data, each with multiple real reconciled cycles behind them.
- **Deferred:** any automatic triggering of downstream action from an Opportunity OS output.
- **Deliverables:** Detect → Score → Explain, shipped first as a human-reviewed report. No auto-action in v1.

**Steps:**
1. Confirm Finance (08) and Sales (06) each have multiple real reconciled cycles behind them — don't start early.
2. Build Detect → Score → Explain as a human-reviewed report only (no auto-action).
3. Run it against real AA data for a full quarter minimum.
4. Collect human review feedback on scoring/explanation accuracy each cycle.

**Exit gate:** a defined review period — a full quarter, minimum — confirms the scoring and explanations are actually trustworthy before any approval-gated automation reads from it.

### Phase 12 — Executive AI + Instance #2

**Goal:** the actual Stage 2 milestone — onboard a second real business on the same architecture, and generalize only in response to what genuinely doesn't fit.

- **Builds on:** everything above, each already proven on AA.
- **Deferred:** nothing. This is the last phase — there's nowhere left to defer to.
- **Deliverables:** a real or pilot Business #2, onboarded. Whatever fails to generalize cleanly becomes the concrete spec for Universal Primitives, written in response to real friction. Executive AI ships last, every recommendation gated by Phase 00's human-approval list from day one.

**Steps:**
1. Confirm every prior phase's exit gate actually passed (not just shipped) — this is the hard prerequisite.
2. Source and onboard a real (or credible pilot) Business #2.
3. Run Business #2's core loop (intelligence → strategy → offer → marketing → sales → delivery → finance) on the existing tables/pages/agents, unmodified.
4. Catalog everything that fails to generalize cleanly — this becomes the spec for Universal Primitives, written from real friction, not guessed.
5. Build Executive AI last, with every recommendation gated by Phase 00's human-approval list from day one.

**Exit gate:** Business #2's core loop — intelligence → strategy → offer → marketing → sales → delivery → finance — runs on the same tables, pages and agents as AA's, with zero business-specific code forks. Only configuration and content differ.

---

## Cross-cutting discipline

Not phase-specific — every phase above is held to all seven, without exception. These are lessons this exact codebase has already taught, not hypotheticals.

1. **Full dependency trace before touching an existing table.** Grep every foreign key and RPC across the whole codebase and every migration that mentions it — not just the files that look related. Two real, unrelated systems (Ad Studio, an Analytics automation) turned up this way during the Ideation/Creation consolidation, both invisible from the panel level.
2. **Every new edge function gets its registry entry in the same commit.** Not retrofitted after a CI failure catches it.
3. **Run the full verification suite, not the convenient three.** Typecheck and lint and build passing is not the same as done — the registry check and the full test suite catch a different class of break.
4. **Every irreversible action gets a human sign-off first.** Schema drops, deploys, merges — named explicitly per phase in Phase 00's approval-gate list, not assumed.
5. **Every new destructive capability gets a live-fixture test against real data before it's trusted.** Disposable, prefixed fixtures against the real database, cleaned up after — not a mocked approximation.
6. **Hide before you delete.** A nav change or a deprecated table goes hidden-but-routable first, and stays that way until the replacement has real usage behind it.
7. **Read the file before you delete it.** "Nothing else references this" from a grep is a hypothesis, not a fact, until the actual content of every match has been read.

## Open decisions — answered in Phase 00

All five answered and owned (Alex Thomas, 2026-08-20). Full reasoning for each in `docs/STAGE_2_PHASE_00_GROUND_TRUTH.md` §3 — summarized here so this document stays self-contained.

1. **How does the Business Object relate to the existing `clients` table?** **Answered: additive `businesses` table, optionally linked to `clients`.** Concrete finding that resolved this: `clients.is_internal_client` already exists, and the first schema migration already seeded Attract Acquisition itself as a `clients` row (`is_internal_client = true`) — AA is not becoming row #1 of a new table in Phase 02, it already is a `clients` row today. The new `businesses` table links to it via a nullable FK rather than repurposing `clients`' agency-service-delivery columns (`package_tier`, `account_manager_id`).
2. **Sales: build a thin CRM, or integrate an existing one and layer agents on top?** **Answered: build thin**, reusing Stage O's `client_work_items` polymorphic work-allocation pattern (real, live, already the exact right shape) rather than inventing a bespoke pipeline schema. **Corrected during Phase 06 implementation:** `client_work_items.client_id` is `not null` — the table assumes work against an already-onboarded client, but a sales lead is by definition pre-client (that's the department's whole job: converting a prospect into a `clients` row). Reusing it literally would have meant either a fake placeholder `clients` row per lead (polluting the one table every other department trusts as "real clients") or loosening a live, load-bearing Stage O constraint for one department's convenience. Neither is thin. Built bespoke `sales_leads`/`sales_conversations` instead, cross-business (keyed off `businesses(id)`, no `client_id`) — same discipline `businesses`/`command_center_notes` already established for pre-client, cross-business content. Decision 2's actual intent (thin CRM, not an integrated tool plus agent layer) is preserved; its literal implementation detail wasn't load-bearing and didn't survive checking the real schema.
3. **Which channel does Communications Hub v1 actually cover, and who owns the external platform verification process?** **Answered: Instagram/Meta DMs**, owner Alex Thomas. Meta Business verification should start now (Phase 00), not when Phase 10 engineering begins — that clock is external and slow.
4. **What does "thin enough" mean, per department, in numbers?** **Answered, adopted as the default bar**: ≤ 3 new tables, ≤ 2 new UI tabs/sections, 0 new edge functions where a direct RPC suffices — per department, per v1. Grounded in Stage O's own real precedent (its entire backbone shipped inside exactly this bar). Alex may override per-department before that phase starts.
5. **What engineering and AI-assisted-dev capacity actually exists?** **Answered: near-full-time build track** — Alex + Claude Code sessions, at a cadence similar to the sessions that produced the Ideation/Creation nav consolidation, Reel Studio Phases A–D, and Stage O. The ~5–6 month engineering-effort estimate below is the operative one; the calendar-time gates (real usage/sales/accounting periods, external verification) still apply regardless of capacity.

## What "Stage 2" actually means

**The test:** can Attract Acquisition eventually operate Attract Acquisition through Attract Acquisition — and then do the same for a second, real business?

- Business #2's core loop runs on the same tables, pages and agents as AA's own — configuration and content differ, code does not.
- No table was added specifically for Business #2 that Phase 12 didn't already generalize in response to real friction.
- No page or component forked per-business to make it work.
- Every phase above passed its own exit gate on real usage — not on a demo, and not on a calendar date.

## Timing estimate (informational, not a schedule)

- **Engineering effort, continuous focused build:** roughly 5-6 months across all 13 phases, assuming AI-agent-assisted pace comparable to the Ideation/Creation nav consolidation, one decisive owner, no stalls.
- **Realistic calendar time:** 12-18 months. The gap is the exit gates themselves — two weeks of real usage (01), a full sales cycle (06), a full client engagement (07), a full reconciled accounting period (08), external platform verification (10), a full quarter of review (11), and a real Business #2 onboarding (12) are calendar time, not engineering time, and several are serially dependent (Opportunity OS needs *multiple* reconciled Finance/Sales cycles before its own quarter-long review can even start).
- The single biggest lever on this range is Open Decision 5 (real engineering/AI-assisted-dev capacity) — currently unanswered.

---

*This document is the locked reference for Stage 2 execution. Work starts at Phase 00 — its exit gate (every Open Decision recorded, with a named owner) is the actual precondition for Phase 01, not this document's existence.*
