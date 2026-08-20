# Cockpit v3 — Business Operating System Transformation Plan

**Status:** Locked reference for Cockpit's ongoing architecture, effective 2026-08-20. **Supersedes `docs/STAGE_2_BUSINESS_OS_BUILD_PLAN.md`**, which is now deprecated — see the notice at the top of that file. This document does not discard that plan's work: Phases 00–11 it shipped (12 new tables, 15 new RPCs, 2 new edge functions, all live-tested against production) are the machinery this plan rearranges. Nothing here re-does that work.
**Owner:** Alex Thomas.
**Full current-state detail:** the Stage 2 status report generated 2026-08-20 (§7 of this document is its condensed successor).

---

## 0. Why this supersedes Stage 2, in one paragraph

Stage 2's plan sequenced *what to build* — Business Selector, Sales, Delivery, Finance, Team, Comms, Opportunity OS — and built it, phase by phase, each live-tested against real production data. What it didn't fully settle was *how the pieces fit together* once built: the working system today is a persistent `businesses` table with a `Business Selector` sitting alongside a much older, larger app that's still organized around `clients.id` and the evolutionary history of how each department got added. This plan is the recomposition step: take the real, working engines Stage 2 built and already-existing marketing/creation machinery, and arrange them into the actual mental model — a persistent Business Object with operating systems attached to it — rather than a collection of pages that happen to sit under a shared selector.

**This is recomposition, not a rewrite.** No phase below proposes re-building Sales, Finance, Marketing, or Intelligence from scratch. Every one of them asks: what exists, where does it need to move, and what's the minimum genuinely-new surface required.

---

## 1. Target architecture

```
                    BUSINESS SELECTOR
                          persistent
                              │
                              ▼
┌─────────────────────────────────────────────────────┐
│                    BUSINESS OS                       │
│                                                       │
│  01  Overview                                        │
│  02  Master AI                                       │
│  03  Intelligence                                     │
│  04  Marketing                                        │
│  05  Sales                                            │
│  06  Conversations                                    │
│  07  Team                                              │
│  08  Finance                                           │
│  09  Automations                                       │
│  10  Knowledge / Documents                              │
│                                                         │
│  ───────────── OPTIONAL MODULES ─────────────────────  │
│                                                         │
│  Delivery / Operations                                  │
│  Customer Service                                       │
│  Product                                                 │
│  Recruitment                                              │
│  Inventory                                                 │
│  etc.                                                        │
│                                                                │
└─────────────────────────────────────────────────────┘
```

**The one structural change from the prior blueprint: Delivery/Operations is no longer part of the universal skeleton.** A plumbing business, a SaaS company, an agency, an e-commerce company, and a property business all share Marketing, Sales, Finance, Team, Conversations, and Knowledge — but their actual delivery mechanics are different enough that forcing one shape onto all of them is exactly the kind of premature generalization this codebase's own discipline (Operating Principle 1, Stage 2) already warns against. Delivery becomes a configurable module attached to a business, the same category as Customer Service, Product, Recruitment, or Inventory — built when a real business needs it, not assumed universal because AA happens to need it.

Opportunity OS and Activity Log are deliberately **not** listed as top-level pages in this target — see §5, Step 2 and §6.

---

## 2. Current → intended bridge

| System | Intended | What exists now (all live, all in production) | What changes |
|---|---|---|---|
| **Business Context** | Select a business once; the entire Cockpit changes context | `businesses` table, Business Selector (`BusinessesPage.tsx`/`BusinessDetailPage.tsx`), AA seeded as business #1, nullable `client_id` FK | Build one persistent `BusinessContext` consumed by every page; bridge legacy `client_id` systems through it cleanly (§3) |
| **Overview** | CEO Command Center: KPIs, Activity, Priorities, Bottlenecks, Opportunities, Approvals | Operational-health tiles + `command_center_notes` (Phase 01) | Promote into the real Overview OS — pull in Sales, Marketing, Finance, Automations, Opportunity findings, approvals |
| **Master AI** | Executive interface over the whole business | `jarvis-turn` / `set-jarvis-settings` edge functions exist; no Executive AI phase built | Make Master AI a first-class top-level page with business-wide tool access |
| **Intelligence** | Market, Avatar, Competitors, Associations, VOC, Business Intelligence | `run-market-os`, `run-avatar-os`, `run-competitor-os`, `run-association-os`, `run-avatar-strategy`, `generate-avatar-asset` all live | Consolidate into one first-class Intelligence parent — reorganization, not a rebuild |
| **Marketing** | Strategy → Offers → Ideation → Creation → Distribution → Campaigns → Iteration → Assets | Offer/Ideation/Creation/Distribution/Iteration visually grouped under a "Marketing" label (Phase 05); `client_marketing_campaigns` shell added | Convert the visual grouping into real second-level navigation with shared Campaign objects |
| **Sales** | CRM + Pipeline + Leads + Conversations + Opportunities + Follow-up + Proposals + Closing + Sales Intelligence | `sales_leads`/`sales_conversations`, 4 RPCs, full pipeline live-tested (Phase 06) | Deepen the thin CRM — contacts/companies, follow-up, deal context, proposals, agent workflows |
| **Conversations** | Unified inbox: Instagram, Facebook, WhatsApp, email, web chat, routed to humans/agents | `comms_identities`/`comms_messages`, `meta-instagram-webhook`, `send-instagram-message` — Instagram only, never yet called against a real conversation (Phase 10) | Build the real Conversations UI on top of the existing identity layer; add channels; route to Sales/Service agents |
| **Team** | Humans + AI agents as one operating team — Slack-like workspace | Read-only directory: real staff + ~90 live agents, 0 new schema (Phase 09) | The biggest UI gap in this plan: channels, threads, mentions, agent invocation, tasks, decisions |
| **Finance** | Revenue, expenses, cash, forecasting, budgets, unit economics | `client_finance_periods`, atomic CSV import, one-time reconciliation snapshot (Phase 08) — hidden inside "Cost & Margin" | Promote to a real Finance OS; add dashboard/cash/revenue views; accounting/bank integration stays deferred |
| **Automations** | Workflows, Agents, Runs, Triggers, Tools, Integrations, Approvals, Logs | Workflows + Triggers surfaced in Operational Control (Phase 03) — also surfaced a real unmerged Facebook branch stack, still unresolved | Promote to a top-level control plane; add Runs/Agents/Tools/Integrations/Approvals |
| **Knowledge** | Documents, Brand, SOPs, Decisions, Learnings, Memory | Pure-function search (`knowledge-search.ts`) over real Context/Execution Files (Phase 04); a real, unexercised provenance/citation layer already exists | Turn into a real document repository/folder system; activate the provenance layer |
| **Opportunity OS** | A specialist detector feeding Executive AI | `opportunity_os_findings`, 2 RPCs, 3 deterministic detection rules, all source-cited (Phase 11) | Stop treating as an isolated destination — feed findings into Overview and Master AI (§5, Step 2) |
| **Delivery/Ops** | Previously assumed universal | `client_projects`/`client_deliverables`/`client_work_items` (Phase 07) | Keep exactly as built — convert to an Optional Module rather than core skeleton |
| **Provisioning** | Idea → connected accounts → instantiated company | `create_business` RPC only | Major future layer — templates, agent provisioning, context setup, workflow/integration wiring, launch. **Not scoped in this plan** — out of scope until Step 6 finds real friction to design against |
| **Business #2** | Same architecture, different data | Not yet executed — scoped (a pilot "build pod retainer" business) and held pending a session with real network access | Becomes the real proof, once the architecture below is actually in place (§5, Step 6) |

---

## 3. The architectural fix: a compatibility layer, not a migration

The single most important finding behind this plan: a direct query against every foreign key in the live schema shows **exactly one table — `sales_leads` — is genuinely cross-business** (keyed to `businesses(id)`). The other 151 department tables (Marketing, Finance, Delivery, Team, even Comms' `matched_client_id`) are still hard-keyed to `clients.id`. Conceptually the system was designed as:

```
Business
   │
   ├── Intelligence
   ├── Marketing
   ├── Sales
   ├── Finance
   ├── Team
   ├── Knowledge
   └── etc.
```

What actually exists is:

```
Business
   │
   └── linked Client
          │
          ├── Marketing
          ├── Offers
          ├── Finance
          ├── Delivery
          ├── Team
          └── etc.
```

**Decision: do not migrate 151 tables now.** Instead, make the gap an explicit, named compatibility architecture:

```
                SELECTED BUSINESS
                  business_id
                      │
                      ▼
              Business Context
                      │
         ┌────────────┴────────────┐
         │                         │
         ▼                         ▼
  business-native             legacy systems
     systems                        │
   (business_id)                    ▼
                            linked client_id
```

The frontend never asks *"am I operating on a client or a business?"* — it asks `currentBusiness`, and `BusinessContext` resolves `{ business_id, client_id, name, brand, permissions, integrations, configuration }` once, centrally. New universal infrastructure (Overview aggregation, Conversations, Team workspace) reads `business_id` directly. Existing marketing/finance/delivery infrastructure keeps reading through the linked `client_id` exactly as it does today — unchanged, unmigrated. Old tables generalize to `business_id` only where a real Business #2 run proves the linkage is actually load-bearing, not in advance of that proof. This is the same "generalize on friction, not in anticipation" discipline Stage 2's Operating Principle 1 already used successfully seven times (Sales' `sales_leads` design, Delivery's Projects/Deliverables split, Finance's period concept, and others) — applied here to itself, at the context-layer.

---

## 4. Decisions this plan is making now (owned, recorded — same discipline as Stage 2 Phase 00)

1. **Rehoming a page (moving its route/nav position, wrapping it under a new parent) does not, by itself, reset that page's real-usage exit-gate clock.** Command Center (Phase 01), Sales (06), Finance (08), and Comms (10) are each mid-wait on real-usage gates opened by Stage 2. A pure IA move — new parent nav, same underlying data/RPCs/behavior — doesn't restart the clock. A move that changes what the page actually reads or how staff interact with it (e.g., Sales gaining proposals/contacts, Finance gaining a dashboard) is a genuine behavior change and **does** restart that specific gate, scoped to the new capability only — the original thin-kernel behavior's clock isn't punished for the deepening work around it. Owner: Alex Thomas.
2. **`docs/STAGE_2_BUSINESS_OS_BUILD_PLAN.md` is retired**, not deleted — deprecation notice added at its top (matching the existing precedent for `docs/reconciliation-report.md`), full phase-by-phase detail (00–11) kept intact as the historical record this plan's §2 condenses.
3. **Opportunity OS and Activity Log stop being top-level nav destinations** once Step 2 (§5) lands — they become feeds into Overview and Master AI. Their underlying tables/RPCs are untouched; only their surface changes.
4. **Optional Modules are genuinely optional per business**, not a euphemism for "AA-only." A business row with no linked module simply doesn't render that nav section — enforced at the `BusinessContext` layer, not per-page.

---

## 5. The six-step sequence

Each step below follows Stage 2's own phase-card discipline: goal, what it builds on, what it deliberately defers, deliverables, ordered steps, and an exit gate that's actually checkable — not a calendar date.

### Step 1 — Cockpit Shell + Business Context

**Goal:** establish the final sidebar and a single, persistent `BusinessContext` abstraction. No department rewrites yet.

- **Builds on:** the real `businesses` table and `/businesses` routes (Phase 02).
- **Deferred:** every department-level change in Steps 2–5. This step touches shell/context/nav only.
- **Deliverables:** the target sidebar (§1) rendered, wired to real routes (existing pages keep their current routes underneath — this step is nav/shell, not a route migration); a `BusinessContext` React context/hook resolving `{ business_id, client_id, name, brand, permissions, integrations, configuration }` for the selected business; every existing page that currently reads `client_id` directly continues to work unmodified by reading it through the new context instead of its own local resolution.

**Steps:**
1. Design `BusinessContext`'s shape and resolution logic (§3) — read `businesses` row, resolve linked `client_id` if present, expose both.
2. Wire it at the app root, above the router.
3. Migrate each existing page's local `client_id` resolution to read from `BusinessContext` instead, one page at a time, verifying no behavior change per page (existing tests must still pass unmodified where they assert `client_id`-scoped behavior).
4. Build the new sidebar shell with the target nav groups, initially just linking to existing routes under their current names — no page contents change yet.
5. Full regression pass (typecheck/lint/build/registry check/full test suite) after every page's context migration, not just at the end.

**Exit gate:** every existing page reads its business/client context through `BusinessContext`, zero regressions in the full test suite, and the target sidebar renders and navigates correctly for both AA (linked-client business) and a business with no linked client.

**Result — started 2026-08-20, exit gate not yet met.** Built the core of steps 1–2: `src/lib/business-context.tsx` (`BusinessProvider`/`useBusinessContext`), wired at the app root above `AppShell` — the first genuinely shared, persistent selection state this app has had (confirmed via research: previously every page resolved `clientId`/`businessId` independently through route params with zero shared state, no context, no store). Persists the selection to `localStorage`, self-heals a stale/dangling stored id once real data loads. The compatibility bridge from §3 is real: `selectedClientId` resolves from the selected business's linked `client_id`, pure logic split into `src/lib/business-context-resolve.ts` (`resolveSelectedClientId`, `isStaleSelection`) specifically so it's unit-testable without React component-test infrastructure, which this repo has none of — 8 new tests, matching the `knowledge-search.ts`/`finance-csv.ts` precedent of pure logic in `.ts`, thin wiring in `.tsx`.

A persistent Business Selector now lives in `TopBar.tsx` — visible on every page, not just `/businesses/*`. `BusinessDetailPage` syncs the shared selection when a business is opened directly by URL. Two pages actually migrated to prove the pattern both ways: `SalesPage` (business-native — its own local `businessFilter` state deleted, reads `selectedBusinessId` directly) and `OpportunitiesPage` (legacy client-scoped — its filter/detect-target default from `selectedClientId`, still manually overridable). Full verification: typecheck, lint (0 errors, same 6 pre-existing warnings), build, `check:edge-functions` (unaffected — 0 new edge functions), full suite 1034/1034 (8 new), `git diff --check` clean.

**Finished 2026-08-20 — the remaining piece, and a correction to how it was framed.** The honest gap above described the ~20+ `ClientDetailPage` panels reading `clientId` via prop-drilling from `useParams` as unmigrated tech debt. On closer look, that prop-drilling is the *correct* design, not a gap: `ClientDetailPage` is reached by navigating directly to a specific client (`/clients/:id/...`), so the URL has to stay authoritative for which client's detail is showing — routing those ~20 panels through the shared `selectedBusinessId`/`selectedClientId` instead would have been the actual bug (two browser tabs on two different clients would incorrectly converge on whichever business happened to be globally selected). The real, narrower gap was one-directional: opening a client or a sales lead directly by URL never told the shared `BusinessContext` about it, unlike `BusinessDetailPage`, which already did. Closed both: `ClientDetailPage` now resolves any business linked to the opened client (`findBusinessForClient`, a new pure function in `business-context-resolve.ts`, mirroring `resolveSelectedClientId`/`isStaleSelection`'s existing pattern) and carries it into the shared selection when one exists — a no-op for the common case of a client with no linked business yet. `SalesLeadDetailPage` does the same directly from the lead's own `business_id`. 4 new tests (2 pure-function, 2 source-text wiring checks matching the file's existing style) — full suite 1038/1038, typecheck/lint/build/registry check all clean.

**Exit gate — the `BusinessContext` piece is now met.** Every existing page that resolves business/client context does so either directly through `BusinessContext` (business-native pages, e.g. `SalesPage`) or through `selectedClientId`'s compatibility bridge (legacy client-scoped pages, e.g. `OpportunitiesPage`), and every page reached by a direct URL now correctly carries its own selection into the shared state on open (`BusinessDetailPage`, `ClientDetailPage`, `SalesLeadDetailPage`). **Not yet done, honestly, and explicitly Step 2's job, not re-scoped into this one:** the sidebar still shows the current 7-item nav, not the target 10-group Business OS shape; Finance, Delivery, Team, Comms, Knowledge pages haven't moved yet.

### Step 2 — Rehome what already exists

**Goal:** move existing, working pages into the target IA. Pure recomposition — no new schema, no new RPCs, no behavior changes.

- **Builds on:** Step 1's shell and context.
- **Deferred:** any new capability. If a page needs more than a new parent/route, that work belongs in Step 3 or 4.
- **Deliverables:** Marketing pages (Offer/Ideation/Creation/Distribution/Iteration/Campaigns) as children of one Marketing OS; Finance promoted out of "Cost & Margin" into its own top-level Finance page (same RPCs, same tables, new home); Projects/Deliverables/Work Items reclassified as the Delivery/Operations Optional Module; Workflows/Triggers promoted out of Operational Control into a top-level Automations page; Knowledge Search becomes the Knowledge page; Opportunity OS findings surface inside Overview and Master AI instead of their own top-level page (their RPCs/table are unchanged — only where the UI renders them moves); Activity Log's business-relevant content moves into Overview, engineering-detail content stays in Automations → Runs/Logs.

**Steps:**
1. For each system in the bridge table (§2), confirm its full dependency trace (every FK, every RPC caller, every route) before moving anything — same discipline as Stage 2 Phase 05's Marketing trace.
2. Move routes/nav, hidden-but-routable first (old routes keep working) — same "hide before delete" discipline as every prior phase.
3. Live-test each moved flow against real data to confirm zero behavior change.
4. Only after real usage on the new locations, retire the old routes.

**Exit gate:** every system in the bridge table renders under its target parent, every existing RPC/table/test is unchanged and passing, and old routes have been retired following the hide-then-drop discipline (not left as permanent dead weight).

### Step 3 — Build the missing collaboration surfaces

**Goal:** the three genuinely new UI surfaces this plan requires — Conversations, Team-as-workspace, and Documents.

- **Builds on:** `comms_identities`/`comms_messages` (Phase 10), the Team Directory's real staff+agent data (Phase 09), and the Knowledge Search/provenance layer (Phase 04).
- **Deferred:** additional Conversations channels beyond Instagram (Facebook/WhatsApp/email) until the Instagram surface has real usage; agent-mention execution in Team (posting `@SalesAgent` and having it actually act) until Master AI (Step 5) exists to receive that invocation.
- **Deliverables:** a real Conversations inbox (all/Instagram/Facebook/WhatsApp/email/web filters; a conversation view showing person/company/CRM link/source campaign/sales stage/history/assignment); a Team workspace (channels, threads, mentions of humans and the real ~90 agents, tasks, decisions, attachments) replacing the read-only directory; a Documents repository organized by folder (Company/Market/Customers/Competitors/Brand/Proof/Offers/Campaigns/Creative/Website/Internal) built on top of the existing Context/Execution File tables and the already-real-but-unexercised provenance/citation layer.

**Steps:**
1. Conversations: build the inbox UI over the real `comms_identities`/`comms_messages` tables; wire routing into Sales (existing `sales_leads` link) and, once it exists, Delivery.
2. Team: design the channel/thread/mention schema (new tables — this is the one step in this plan that's genuinely greenfield, not recomposition); build @mention parsing for humans (existing `users`) and agents (existing registry).
3. Documents: build the folder taxonomy over existing `client_context_files`/`client_execution_files`, and activate the existing `client_context_file_citations`/`client_source_documents`/`client_document_chunks` provenance layer for the first time.
4. Live-test each against real AA data before merge, per every prior phase's discipline.

**Exit gate:** a real Instagram conversation flows through the new inbox and correctly attributes to a Sales record (this also closes Phase 10's original exit gate); staff use the Team workspace for at least one real cross-functional thread; Documents correctly answers a real AA-specific retrieval question sourced through the provenance layer (extends Phase 04's exit gate methodology).

### Step 4 — Deepen the thin departmental OSs

**Goal:** finish Overview, Sales, and Finance using the kernels already built — not replace them.

- **Builds on:** Phase 01's Command Center kernel, Phase 06's Sales pipeline, Phase 08's Finance accounting kernel.
- **Deferred:** anything not already scoped in the bridge table (§2) for these three systems specifically.
- **Deliverables:** Overview showing Business Health (revenue/pipeline/cash/leads), Priorities, Bottlenecks, Opportunities (fed from Step 2's relocation), Approvals, and Activity in one view; Sales gaining contacts/companies, follow-up, proposals, and deal context around the existing lead/conversation spine; Finance gaining a real dashboard (revenue/cash/forecasting views) over the existing period/reconciliation kernel.

**Steps:**
1. Overview: build the aggregation layer pulling from Sales, Marketing, Finance, Automations, and Opportunity findings — extending Phase 01's existing `src/lib/observability.ts` pattern, not replacing it.
2. Sales: add `sales_contacts`/`sales_companies` (or fold into `sales_leads` if the dependency trace shows that's cleaner — decide via trace, not preference) and a proposals table; wire follow-up reminders.
3. Finance: add read-only dashboard views over `client_finance_periods`/`client_cost_ledger` — no new mutation surface beyond what Phase 08 already shipped.
4. Live-test each new capability against real data; each new capability's exit-gate clock starts fresh per Decision 1 (§4) — the original kernels' gates are unaffected.

**Exit gate:** Overview is the page AA staff actually open every morning (a real usage claim, checked the same way Phase 01's was — not assumed); Sales' new surfaces (contacts, proposals) are used on at least one real lead; Finance's dashboard is checked against one real reconciled period's numbers and confirmed accurate.

### Step 5 — Build Executive Master AI

**Goal:** expose the executive layer as a real, first-class page — not an implicit layer above the system.

- **Builds on:** `jarvis-turn`/`set-jarvis-settings` (existing), and every department built or deepened by Steps 1–4 (Master AI is a consumer, same relationship Opportunity OS has to the data it reads).
- **Deferred:** autonomous execution. Ships read/recommend first — every recommendation gated by the existing human-approval-list discipline (Stage 2 Phase 00's own approval-gate list) from day one, same as Opportunity OS's "no auto-action in v1" precedent.
- **Deliverables:** a Master AI page (business context panel: goals/priorities/active agents/active workflows/opportunities/decisions, alongside a conversational interface) that can answer "what's stopping the company growing?", coordinate a request like "build the next campaign" by invoking the right specialist systems, and surface Opportunity OS findings and Automations state directly rather than requiring a separate page visit.

**Steps:**
1. Define Master AI's tool surface: which existing RPCs/edge functions it's allowed to invoke, and which require human approval before executing (extends Phase 00's approval-gate list with Master-AI-specific entries).
2. Build the business-context panel from already-real data (Overview's aggregation, Team's directory, Opportunity findings).
3. Build the conversational interface on `jarvis-turn`, extended to reason across departments rather than one at a time.
4. Ship read/recommend only; live-test against real questions with real AA data.
5. Only after read/recommend has real usage, evaluate adding gated execution.

**Exit gate:** Master AI correctly answers a real, previously-unscripted AA business question by reading real cross-department state (matching Phase 04's Knowledge exit-gate methodology — a real question, verified against real content, not simulated), and every action it can take beyond reading is on the existing human-approval list.

### Step 6 — Run Business Instance #2

**Goal:** the actual Stage 2/Cockpit v3 milestone — onboard a second real (or credible pilot) business, and generalize only in response to what genuinely doesn't fit.

- **Builds on:** everything above, each proven on AA first.
- **Deferred:** nothing — this is the last step.
- **Deliverables:** a real or pilot Business #2 run through the real intelligence → strategy → offer → marketing → sales → delivery → finance loop on the now-completed architecture; a catalog of whatever fails to generalize cleanly, becoming the concrete spec for the `business_id` migration this plan deliberately deferred in §3 — written from real friction, not guessed.

**Steps:** unchanged from the original Phase 12 card — confirm every prior step's exit gate actually passed; source and onboard Business #2; run its core loop unmodified; catalog what fails to generalize; only then decide what (if anything) in §3's compatibility layer needs to become a real migration.

**Exit gate:** Business #2's core loop runs on the same tables, pages, and agents as AA's — configuration and content differ, code does not.

**Standing principle for this step, unchanged from Stage 2:** do not generalize an abstraction because Business #2 might need it. Generalize when Business #2 actually hits friction. This has held for every phase so far — no page or component has been forked per-business — and this plan does not relax it.

---

## 6. Cross-cutting discipline (carried forward, unchanged)

Every step above is held to the same seven rules Stage 2 already proved out, without exception:

1. Full dependency trace before touching an existing table or moving an existing route.
2. Every new edge function gets its registry entry in the same commit.
3. Run the full verification suite, not the convenient three — registry check and full test suite catch a different class of break than typecheck/lint/build.
4. Every irreversible action gets a human sign-off first.
5. Every new destructive capability gets a live-fixture test against real data before it's trusted.
6. Hide before you delete — a rehomed route stays routable until the new location has real usage behind it.
7. Read the file before you delete it.

---

## 7. Where things actually stand (condensed from the 2026-08-20 status report)

```
FOUNDATION            ██████████  strong
MARKETING ENGINE      ██████████  very strong
BUSINESS SELECTOR     █████████░  built
OVERVIEW              ████░░░░░░  kernel built
INTELLIGENCE          ████████░░  capabilities built / IA missing
SALES                 ████░░░░░░  thin kernel built
CONVERSATIONS         ██░░░░░░░░  Instagram foundation
TEAM                  ██░░░░░░░░  directory only
FINANCE               ████░░░░░░  accounting kernel built
AUTOMATIONS           ██████░░░░  substantial machinery / UI incomplete
KNOWLEDGE             ███░░░░░░░  search foundation
OPPORTUNITY ENGINE    ████░░░░░░  deterministic v1
MASTER AI             ██░░░░░░░░  old mechanics, Executive OS missing
PROVISIONING          █░░░░░░░░░  business creation only
BUSINESS #2           ░░░░░░░░░░  not executed
```

The gap this plan closes is not "we still need to build a Business OS." It's that the engines already exist and are individually sound — arranged today according to the evolutionary history of the Cockpit rather than the actual mental model of the company. Steps 1–2 fix the arrangement. Steps 3–5 fill the three genuinely missing surfaces and put Master AI across the top. Step 6 is the real test of whether any of it generalizes.

## 8. Open items carried forward, unresolved, not blocking any step above

- **Facebook Distribution branch stack** (`stage-1b-a`…`-e`) — deployed to production, unmerged, 43 commits behind `main`. Alex's call: merge after real review, or retire.
- **Reel Studio's `brand_prompt_blocks` row hardcodes South African content**, conflicting with current EUR/Europe positioning — flagged, not fixed.
- **Two orphaned test files** in the `video-assets` storage bucket (delete-protection blocks direct cleanup) — low priority.
- **The `sales_leads`/`business_id` vs. 151-table `client_id` split (§3)** is the concrete generalization question Step 6 exists to answer for real — not resolved by this plan, deliberately.
