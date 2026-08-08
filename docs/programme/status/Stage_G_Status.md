# Programme Stage G — Calendar Planning and Operational Commitment

**Status: backbone implemented and deployed, live-verified via disposable fixtures against the real database. Scope deliberately reduced from the full stage prompt — see "Deferred" below.**
Date: 2026-08-08 · Project `xivewedajschthjlblfb`

## What this stage builds on

Stage B already owned `content_requirements` / `calendar_slots` / `content_items` as an unused skeleton (0 rows, no callers anywhere in `src/`), and a rich, apparently Stage-G-anticipating set of per-slot targeting fields (`objective`, `funnel_stage`, `audience_stage`, `preferred_source_type`, `required_proof_strength`). Stage F supplied the scored, eligible Opportunity pool to match against. Stage G's job was the actual matching/proposal/commitment layer connecting the two — generalising the pattern already proven by the Ideation-specific `client_ideation_calendar_proposals` system (move/swap/remove/restore, edit-revision optimistic concurrency, conflict tracking) rather than duplicating it.

## Scope actually implemented (the "backbone")

Same agreement as Stage F: real, working core; deferrals logged with precise reasons rather than chasing the full exhaustive verification matrix in one pass.

### Schema — migration `20260808013816_stage_g_calendar_planning.sql` (applied live, written defensively)
- `content_calendar_proposals` (header: period, status, mode, `edit_revision`) and `content_calendar_proposal_slots` (per-slot assignment, `original_content_opportunity_id` for restore, match score/rationale, conflict tracking).
- `content_items` extended with `source_proposal_slot_id`; three unique indexes (`calendar_slot_id`, `content_opportunity_id`, `source_proposal_slot_id`, each partial on not-null) make "one Slot cannot be filled twice" and "prevent duplicate commitment" **hard DB constraints**, not just application checks.
- `content_item_legacy_projections` — the compatibility-record table for the "Legacy compatibility" requirement (see Deferred: only the mapping table exists, the organic_master projection writer itself was not built this pass).
- **`commit_calendar_proposal`** — an atomic Postgres RPC (`security definer`), not client-orchestrated multi-step writes. Validates every assigned slot in the proposal before writing anything; a single bad slot raises an exception and Postgres rolls back the entire call. This is the only way to actually guarantee "failed commitment leaves no partial operational state" from an Edge Function caller, and the stage's own required-outputs list explicitly names "Operational commitment RPCs."
- **Note on how this migration was applied**: the first `apply_migration` call failed with "relation already exists" on an index that had no corresponding tables — a partial, unexplained side effect (most likely related to the concurrently-running second session on this same project, though not confirmed). Rewrote the whole migration defensively (`IF NOT EXISTS` / `DROP...IF EXISTS` then `CREATE`) and reapplied cleanly. Documented here rather than silently worked around.

### The commit RPC — live-verified with disposable fixtures, not just unit tests
A hand-written multi-step PL/pgSQL function deserved more than trust-by-inspection. Created a disposable `content_requirement` → `calendar_slot` → `content_opportunity` (status `shortlisted`) → `content_calendar_proposal` → `content_calendar_proposal_slot` chain against the real `xivewedajschthjlblfb` project and confirmed, in order:
1. **Happy path**: `content_items` row created with correct bindings (including real `context_version`/`execution_version` pulled from live approved authority), `calendar_slots.status → filled`, `content_opportunities.status` correctly chained `shortlisted → selected → scheduled`, proposal `→ approved`.
2. **Double-commit rejected**: re-calling with the now-stale `edit_revision` correctly raised `PROPOSAL_NOT_DRAFT`.
3. **Slot collision rejected**: a second proposal targeting the same (now-filled) slot correctly raised `SLOT_ALREADY_FILLED`.
4. **No partial state on failure**: confirmed the rejected second proposal stayed `draft`, its Opportunity stayed `shortlisted` (not silently advanced), and zero orphaned `content_items` existed.

All fixtures deleted afterward; verified the real client's tables are back to their pre-test state (0 rows across every new table).

### Edge Functions (all three deployed, `verify_jwt: true`)
- **`create-calendar-proposal`** — for every open, operational Slot in a period, runs the matching engine against eligible/scored, not-yet-claimed Opportunities and proposes the best match above a floor score; `manual` mode creates an empty shell for hand-assignment instead.
- **`update-calendar-proposal-slot`** — move / swap / remove / restore, enforcing edit-revision optimistic concurrency and re-validating cross-client ownership + not-already-committed on every edit.
- **`approve-calendar-proposal`** — thin wrapper calling `commit_calendar_proposal`.

### Matching engine (`_shared/calendar-planning.ts`, unit-tested)
7 of the stage's 11 listed dimensions implemented on real signals: format suitability, origin preference (`content_opportunities.origin` vs `calendar_slots.preferred_source_type`), funnel-stage match, audience match, proof requirement (vs Stage F's `proof_strength` score), timeliness (`expires_at` vs slot date), production readiness (`visual_potential`). Recent-content saturation is a **hard exclusion** (a Stage-F-flagged duplicate is never matchable), not a soft penalty. `computeOverallScore`-equivalent weighting, never model-decided.

### Frontend
- `calendar-planning.ts` types + API layer.
- New `CalendarPlanningPanel.tsx`, wired into `ClientDetailPage.tsx` as "Calendar Planning": generate a proposal, review per-slot match scores/rationale, move/swap/remove/restore, approve & commit.

### Tests
`tests/calendar-planning.test.ts` — 20 deterministic unit tests covering the matching engine's 7 dimensions (including the hard-exclusion-on-duplicate case and the "empty candidate_formats doesn't penalise" edge case) and all 4 proposal-edit actions including their rejection paths. Full suite: **787 tests, 787 pass** (0 failures — the flaky real-time deadline test from the Stage F run passed cleanly this time). `npm run typecheck`, `npm run build`, `npm run lint` all clean — same 4 pre-existing warnings, zero new.

## Deferred, with precise reasons

- **Story/Ads master legacy projection** — `content_item_legacy_projections` supports it (the `legacy_table` check constraint already allows `story_master`/`ads_master`), but only the `organic_master` write path exists. `story_master` and `ads_master` have materially different schemas from `organic_master` (confirmed by direct introspection) and each needs its own field-mapping logic; out of scope for this pass.
- **The organic_master projection writer itself** — not built this pass either. `commit_calendar_proposal` creates the canonical `content_items` row; nothing yet also writes a mirroring `organic_master` + `calendar_cells` row. This is the actual "Legacy compatibility" gap: existing production/distribution surfaces that read `organic_master` will not yet see Stage-G-committed content. Flagged as the highest-priority follow-up before Stage G can be considered fully exit-gated.
- **Automatic planning mode** — `create-calendar-proposal` explicitly 501s on `mode: "automatic"` rather than guessing a policy. The stage prompt itself gates this on "client policy permits," and no such policy configuration exists anywhere in the schema yet.
- **Campaign relevance / performance similarity match dimensions** — no campaign concept and no per-Opportunity performance linkage exist in the current data model; not fabricated.
- **`content_requirements`/`calendar_slots` population** — genuinely Stage D's unfinished responsibility (`generate-execution-config` → derived requirements), not Stage G's. Both tables are still empty in production; Stage G's matching/commit engine is proven correct against disposable fixtures but has nothing to operate on yet in the real client until Stage D's derivation exists.
- **Contract/DB/integration/UI test matrix** in full, and a live HTTP-invocation smoke test through a real operator JWT — same reasons and same environment constraint as documented in the Stage F report.

## Confirmation against Stage G acceptance criteria

| Criterion | Status |
|---|---|
| Manual Idea, Proof, Research and Performance Opportunities can all fill Slots | Met — matching engine is origin-agnostic |
| The operator can create content directly from a selected source | Partial — via Stage F's `create-content-opportunity` + manual proposal assignment; no one-click "skip straight to Content Item" shortcut was built (would bypass the Slot/proposal model this stage exists to establish) |
| The operator can approve an automatically proposed week or month | Met for **assisted** mode; automatic mode explicitly deferred (see above) |
| Approved plans create canonical Content Items | Met — live-verified |
| Existing downstream production continues to work through compatibility records | **Not met** — projection table exists, writer does not (see Deferred) |
| Legacy full-month generation is no longer the primary planning path | Not assessed — no existing "legacy full-month generation" path was located to compare against during this pass |

**Exit gate ("Cockpit has one operational commitment path from Opportunity to Content Item"): met for the commitment path itself** — `commit_calendar_proposal` is live-verified as the sole, atomic, idempotent path. **Not fully met end-to-end** because the legacy-compatibility writer is missing and `content_requirements`/`calendar_slots` have no real data yet pending Stage D.
