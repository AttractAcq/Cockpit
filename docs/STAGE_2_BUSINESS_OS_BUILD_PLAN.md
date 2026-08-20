# Stage 2 Build Plan — Attract Acquisition Business OS

A dependency-gated route from Cockpit as it exists today to a generalized, multi-business operating architecture — sequenced so nothing generalizes before it's proven once, concretely, on Attract Acquisition itself.

13 phases. Gated, not scheduled. Read alongside the Business OS Blueprint.

**Status:** Phase 00 complete (2026-08-20). Phase 01 shipped and live-tested (2026-08-20); its exit gate is a genuine two-week real-usage wait, earliest completion 2026-09-03 — see Phase 01's own card below. Phase 02 complete (2026-08-20), started and finished ahead of Phase 01's exit gate on Alex's explicit instruction — safe to do because Phase 02 is genuinely additive and provably isolated (zero inbound foreign keys into `businesses` from anywhere else in the schema), so it carries no risk to Phase 01's still-running usage-gate clock. Phase 03 complete (2026-08-20) — surfaced a real, unreviewed live subsystem (see Phase 03's own card: the unmerged Facebook branch stack, deployed to production, invisible until now). Phase 04 (Knowledge, thin) is next.

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
| Marketing → Offers | Offer page — Main Offers, Seasonal Offers | exists | Already a distinct top-level page. |
| Marketing → Ideation | Ideation page — Content Supply, Ideation, Content Items, Calendar | exists | Consolidated from three overlapping pipelines into one (see the Ideation/Creation nav restructure work). |
| Marketing → Creation | Creation page — Content Briefs, Reel Studio, Assets | exists | Same consolidation. Production Studio retired as dead weight. |
| Marketing → Distribution | Distribution page — Organic, Paid | exists | — |
| Marketing → Campaigns | none | net-new | The one substantive new object inside Marketing. Empty shell until Finance and Distribution have real linkage to populate it. |
| Marketing → Iteration | Iteration page — Analytics, Performance & Iteration | exists | — |
| Sales | none | net-new | Greenfield, but not schema-greenfield: Phase 06 reuses Stage O's `client_work_items` polymorphic work-allocation pattern rather than inventing a bespoke pipeline (Decision 2). |
| Delivery / Operations | App-level Operations page — Activity Log **plus** a real "Operational Control" tab (Metrics, Intelligence, Team & Roles, Work Items, Cost & Margin, Onboarding), backed by Programme Stage O | partial | Audited in full in Phase 00 — see `STAGE_2_PHASE_00_GROUND_TRUTH.md` §1. Work Items, Metrics, and Onboarding are real and live; a full Clients→Onboarding→Projects→Tasks→Deliverables→SOPs→Quality→Reporting pipeline is not. |
| Finance | `client_cost_ledger` + `client_margin_summary` view + `clients.monthly_revenue_estimate`, manual-entry only (Stage O) | partial | Not greenfield. Phase 08 extends this real backbone (CSV import, then integrations) rather than building cost/margin tables from scratch. |
| Team | `team_members` assignment (all 9 Stage O roles, real client-scoped read visibility) + `users` role vocabulary | partial, materially further along | Stage O's real fix: `auth_client_ids()` now correctly routes every staff role through `team_members`, not just admin/account_manager. Fine-grained per-role *write* permissions and agent-capacity modeling are still not built. |
| Automations | Edge-function registry + per-client Automations subtab + Operational Control's Metrics/Work Items/**Workflows/Triggers** sub-tabs (Phase 03, complete) | exists | Workflows renders the real registry; Triggers reads `cron.job` live. Surfaced a real gap: 21 functions deployed but unregistered, 10 of them from an unmerged Facebook branch stack — see Phase 03's card. |
| Knowledge | Context Files / Execution Files / Context Inputs, per client | partial | Real substrate, no cross-referencing layer, and AA itself isn't yet a knowledge instance. |
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

### Phase 04 — Knowledge (thin)

**Goal:** give the existing context-file substrate a cross-referencing layer, and extend the pattern to AA itself.

- **Builds on:** Context Files, Execution Files, Context Inputs — already real, already per-client.
- **Deferred:** automated Business Memory / Learning OS capture. That needs real agent-run history to learn from — Phase 11+ territory.
- **Deliverables:** a search and cross-reference layer over existing knowledge tables; AA's own knowledge base, as business #1.

**Steps:**
1. Inventory existing Context Files / Execution Files / Context Inputs schemas per client.
2. Build a cross-reference/search layer over them (no new capture mechanism yet).
3. Instantiate AA's own knowledge base as business #1's content.
4. Pick one real AA-specific question and test whether the layer answers it correctly.

**Exit gate:** a real AA-specific question gets answered by querying this layer instead of asking a person.

### Phase 05 — Marketing IA consolidation

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

**Exit gate:** a complete, documented dependency trace exists before any table is touched — no exceptions, regardless of how cosmetic the change looks.

### Phase 06 — Sales

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

**Exit gate:** AA's own real sales pipeline runs through it for one complete cycle, lead to close.

### Phase 07 — Delivery / Operations

**Goal:** actual client-delivery operations — distinct from Automations' agent-ops, and from whatever the existing app-level Operations page turns out to be.

- **Builds on:** Sales (06), eventually, for the won-client handoff.
- **Deferred:** "Sales → Client Won → Delivery instantiated automatically." Built only after the manual version is proven on one real engagement.
- **Deliverables:** Clients → Onboarding → Projects → Tasks → Deliverables → SOPs → Quality → Reporting, operated by hand first.

**Steps:**
1. Reconcile with Phase 00's Operations-page audit — build only what's genuinely missing.
2. Schema/UI for Clients → Onboarding → Projects → Tasks → Deliverables → SOPs → Quality → Reporting.
3. Operate it by hand for one real AA client engagement (no automation yet).
4. Only after that engagement completes, evaluate adding the Sales → Won → Delivery auto-instantiation.

**Exit gate:** one real AA client engagement run fully through it by hand, before any handoff automation is added.

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
2. **Sales: build a thin CRM, or integrate an existing one and layer agents on top?** **Answered: build thin**, reusing Stage O's `client_work_items` polymorphic work-allocation pattern (real, live, already the exact right shape) rather than inventing a bespoke pipeline schema.
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
