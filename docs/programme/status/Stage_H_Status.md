# Programme Stage H — Content Item and Brief Migration

**Status: backbone implemented and deployed, live-verified against real database constraints with disposable fixtures. Scope deliberately reduced from the full stage prompt — see "Deferred" below.**
Date: 2026-08-08 · Project `xivewedajschthjlblfb`

## What this stage builds on

Stage B already owned `content_briefs` (client/content_item/version/status/body jsonb) and `content_item_proof` as unused skeletons — zero rows, zero callers anywhere in `src/`. The live, heavily-used production-brief system today is `client_production_briefs`, tied to legacy master rows (`source_table`/`source_row_id`), not to Content Items at all — it's referenced across `MastersPanel`, `ReelStudioPanel`, `ContentCreationPanel`, `AssetsPanel`. Stage H's job was building the new canonical path (structured Brief → Content Item) without touching that live system, per its own "current master refs may remain" compatibility clause.

## A real ownership-vocabulary conflict, resolved by preserving the earlier stage

Stage H's own prompt describes a 5-state Brief lifecycle (`pending → generated → review → approved → superseded`). Stage B already shipped a 4-state one (`draft, in_review, approved, superseded`) with a **live CHECK constraint** (`content_briefs_status_check`) already enforcing it. Per rule 2 ("do not redesign a completed earlier stage"), this implementation keeps Stage B's 4 states. "Pending" and "generated" both collapse into `draft`; whether a draft was AI-generated or hand-authored is distinguished by `provider`/`model` being set, not a separate status. Documented here rather than silently picked.

## Scope actually implemented (the "backbone")

### Schema — migration `20260808020601_stage_h_content_item_brief_migration.sql` (applied live)
- `content_briefs.rendered_markdown` — the human-reviewable Markdown rendered from the structured `body`.
- `content_items.current_content_brief_id` — denormalised pointer to the latest Brief version, the same pattern Stage F used for `content_opportunities.score`.
- Both additive; no existing column, constraint, or RLS policy touched.

### The structured Content Brief contract (`_shared/content-brief.ts`)
All 20 fields the stage lists (objective, audience, platform, format, organic-or-paid, core idea, core claim, hook, belief before/after, proof, narrative structure, copy/script requirements, visual direction, asset inputs, brand constraints, CTA, approval rules, production mode, required outputs, quality checklist), plus one field the stage doesn't name but its own approval requirement implies: `proof_required` (boolean) — the model self-flags whether this Brief's claims actually need Proof to be credible, mirroring Stage F's `claim_unsupported` self-flagging pattern. `renderBriefMarkdown` turns the structured contract into the human-reviewable Markdown the stage explicitly requires.

### Edge Functions (both deployed, `verify_jwt: true`)
- **`generate-content-brief`** — pulls the Content Item's linked Opportunity, Calendar Slot, verified Proof, and approved context; generates the structured Brief; re-generation supersedes any prior *approved* version rather than leaving two "current" briefs; links provenance into `content_item_proof` for whichever verified Proof actually backs the item.
- **`review-content-brief`** — submit for review / approve / request changes, enforcing Stage B's transition table. Approval is gated: `checkProofGate` blocks approval when the Brief self-flagged `proof_required: true` and no verified Proof is linked to the Content Item — the stage's explicit "Brief cannot be approved when mandatory Proof is missing" test requirement.

### Frontend
- `content-brief.ts` types (with a parity-tested frontend validator, same duplication pattern as Stage F/G — see below) and `content-items.ts` API layer.
- New `ContentItemsPanel.tsx`, wired into `ClientDetailPage.tsx` as "Content Items": list + detail, current Brief's full rendered Markdown, generate/submit/approve/request-changes actions.

### Live verification with disposable fixtures (no live HTTP call — see Deferred)
Rather than trust the hand-written approval-gate SQL by inspection, ran the exact query shapes `review-content-brief` uses against real disposable data:
1. Created a `content_item`, confirmed the proof-gate join query (`content_item_proof` ⋈ `proof_items` where `verification_status = 'verified'`) returns 0 with nothing linked.
2. Created a verified `proof_item` + linked it via `content_item_proof` (proving the exact upsert shape `generate-content-brief` uses works against the real `content_item_proof_unique(content_item_id, proof_item_id)` constraint), re-ran the query — count correctly became 1.
3. Inserted a `content_briefs` row with the full real column set (structured `body`, `rendered_markdown`, `provider`/`model`) and walked it through the real lifecycle `draft → in_review → approved`, confirming `content_briefs_approval_check` (approved requires `approved_by` + `approved_at` together) passes with the exact update shape `review-content-brief` performs.
All fixtures deleted afterward; confirmed the client's tables are back to their pre-test state.

### A real deploy-tool bug, caught and fixed before finishing
The first `generate-content-brief` deploy accidentally shipped a **truncated** `_shared/content-brief.ts` (missing `renderBriefMarkdown` and `checkProofGate`, which `index.ts` imports) — a mistake in the deploy payload, not the source file. Caught by re-fetching the deployed function and diffing it against the real local file before considering the stage done, rather than assuming the deploy succeeded because the tool returned `"status":"ACTIVE"`. The corrected redeploy then hit a second, unrelated issue: the deploy tool got stuck reusing a stale, self-referential `import_map_path` from the broken first attempt, failing identically twice with a garbled nested `file://` path. Fixed by explicitly passing `import_map_path: "deno.json"` instead of letting the tool infer it — worked immediately. Re-fetched the function a second time and confirmed the live code now matches the local source exactly.

### Tests
`tests/content-brief.test.ts` — 17 deterministic unit tests: schema validation (acceptance and every rejection path), Markdown rendering (including the two distinct "proof missing" vs "proof not required" renderings), the proof-approval gate's three cases, and 2 parity tests guarding the Deno/frontend validator duplication. Full suite: **804/804 pass**. `npm run typecheck`, `npm run build`, `npm run lint` all clean — same 4 pre-existing warnings, zero new.

## Deferred, with precise reasons

- **Migrating the live `client_production_briefs` consumers** (`MastersPanel`, `ReelStudioPanel`, `ContentCreationPanel`, `AssetsPanel`) to read from `content_briefs`/`content_items` instead — these are real, working, actively-used systems; Stage H's own rule 2 forbids replacing working systems unnecessarily, and its own compatibility clause explicitly permits legacy refs to remain.
- **Historical backfill** — the stage says "where practical." With zero `content_items` existing for the real client (Stage G's commit path has never run against real data, pending Stage D populating `content_requirements`/`calendar_slots`), backfilling `client_production_briefs`' 26 real rows into `content_briefs` would require fabricating retroactive Content Items and Opportunities that never actually went through this pipeline — worse than not backfilling, and a direct violation of rule 10 (never fabricate provenance).
- **Campaign and Offer as first-class Content Item ownership** — no campaign concept exists anywhere in the schema (same gap Stage G already flagged); `calendar_slots.offer_ref` exists but nothing yet surfaces it as Content Item-owned in the UI.
- **Contract/DB/integration/UI test matrix in full, and a live HTTP-invocation smoke test** — same reasons and same environment constraint (no mintable operator JWT) documented in the Stage F and G reports.

## Confirmation against Stage H acceptance criteria

| Criterion | Status |
|---|---|
| Every new production job starts from an approved Content Item Brief | Structurally true — nothing in this stage's new code path creates a production job from anything else. No production-job-creation code was touched (that's Stage I) |
| One Content Item can create several format-specific derivative items only through explicit repurposing | No repurposing mechanism was built or needed this pass — no code path allows implicit derivation |
| Existing production workflows still function | Met — `client_production_briefs` and every consumer of it is completely untouched |
| The Brief is both machine-readable and human-reviewable | Met — structured `body` (machine) + `rendered_markdown` (human), live-verified together |

**Exit gate ("The canonical downstream content job is established"): met for the Brief layer itself** — structured contract, generation, and gated approval are real, deployed, and verified against live constraints. **Bounded by the same unpopulated-Slots gap Stage G already flagged**: there is nothing for this pipeline to operate on for the real client until Stage D populates `content_requirements`/`calendar_slots`.
