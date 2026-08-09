# Migration Guide — Legacy Master Pipeline → Canonical Domain Spine

Written at the close of Stage P. Covers the real, current state of the legacy-to-canonical migration and the specific reasoning behind what Stage P did and did not attempt. See `docs/operations/architecture-guide.md` §2–4 for the underlying architectural picture this guide assumes.

## Current state (verified by live query against `xivewedajschthjlblfb`, 2026-08)

| Table | Rows | Notes |
|---|---|---|
| `organic_master` | 22 | all `status = 'idea'` |
| `ads_master` | 2 | |
| `client_production_briefs` | 26 | all `status = 'approved'`; 14 sourced from `organic_master` |
| `client_assets` | 75 | |
| `client_distribution_records` | 25 | 19 `published`, 5 `cancelled`, 1 `ready`; **0** have `content_item_id` set |
| `content_opportunities` | 0 | |
| `content_opportunity_sources` | 0 | |
| `content_opportunity_scores` | 0 | |
| `content_items` | 0 | |
| `ad_opportunities` | 0 | |

The canonical spine has never carried a single real row. All real production for the one real client has flowed through the legacy pipeline (directly) or the Research/Ideation pipeline (which itself writes into the legacy pipeline — see architecture guide §3, Research path).

## Why Stage P did not perform the Content Item backfill

The build plan's migration checklist for this stage calls for backfilling Content Items for active legacy master rows and Opportunity links where evidence permits. This was investigated live, not assumed as a no-op (unlike earlier stages, where "no real content flowing yet" made a backfill genuinely moot — that is no longer true; there is real legacy content to backfill).

`client_distribution_records` already has the exact bridge columns needed (`content_item_id`, `content_brief_id`), so a backfill is schema-shaped and mechanically straightforward: for each of the 20 non-cancelled records, insert a `content_items` row and point `content_item_id` back at it.

It was not done this stage because of one blocking finding made during the golden-path audit (architecture guide §3, Manual Idea path → Approval): **no real code path ever advances `content_items.status` past `'planned'`.** The `content_items_approval_check` CHECK constraint requires `approved_by`/`approved_at` to be set before status can reach `approved`/`scheduled`/`published`/`analysed`/`iterated`. None of the 19 real published `client_distribution_records` rows have a `client_approved_by`/`client_approved_at` value to draw from (that column tracks a different, client-facing approval concept and is unset on all of them too).

Backfilling these rows honestly therefore means one of:

1. Insert them stuck at `'planned'` or another pre-approval status, which actively misrepresents already-published, real content as not-yet-approved in the canonical spine — worse than not backfilling, since a future operator or automation reading `content_items.status` would draw a wrong conclusion.
2. Fabricate an `approved_by` identity and `approved_at` timestamp for an approval event that never concretely happened through this mechanism — against this workspace's standing rule to never fabricate facts about what occurred, even when the underlying content itself was genuinely produced and published.

Neither option was acceptable. The correct fix order is: (a) implement the real `content_items` approval-advancement code path first (a genuine, if small, feature gap — likely a status-sync step added to `submit-production-review` and/or `create-distribution-record-from-content-item`), (b) then backfill the 20 real legacy rows into a `content_items` state that's honestly derived from real events (e.g. `published_at`/`content_item_id` sourced from `client_distribution_records.published_at`, `approved_by` sourced from whichever real user action is deemed the equivalent approval event once that code exists). Doing (b) before (a) exists would just move the same fabrication problem one step earlier.

## What Stage P did instead

- Confirmed and documented the real gap (§ above) rather than papering over it with a partial or dishonest backfill.
- Left the legacy pipeline fully operational and unmodified — it is still the only path producing real client value today, and Stage P's acceptance criteria explicitly do not require migrating existing in-flight content, only that the canonical architecture become "the sole supported operating model for new work" going forward (see the exit-gate discussion in `docs/programme/status/Stage_P_Status.md`).
- Did not stop legacy Phase 3 direct generation, archive compatibility functions, or remove deprecated UI actions. All three legacy pipelines (direct master, Research/Ideation-to-master, and the canonical spine) remain live and reachable. Cutting any of them off is a live-product decision affecting the one real client's current work in progress, not a schema/code change that can be made unilaterally inside an audit stage — it needs explicit sign-off, consistent with the standing rule against cutting over compatibility paths without that sign-off (root `CLAUDE.md` §8, §10).

## Recommended follow-on migration sequence (not started)

1. Implement real `content_items.status` advancement (approval → scheduled → published → analysed → iterated), wired to the same events that already exist (`submit-production-review` approval, `create-distribution-record-from-content-item`, `process-scheduled-publishing` completion, Stage M snapshot ingestion, Stage M iteration promotion).
2. Backfill `content_items` for the 20 non-cancelled `client_distribution_records`, honestly derived from real timestamps/actors now available via step 1's event wiring.
3. Decide whether the Research/Ideation path should be re-pointed at the canonical spine (`content_items`/`calendar_slots`) instead of `organic_master`/`story_master`/`calendar_cells` — this is a real architectural decision (not just a backfill) since `commit-ideation-content` was deliberately built against the legacy tables in its own stage.
4. Only after 1–3 are live and verified: begin retiring legacy-only UI actions and archiving compatibility functions, one at a time, each behind its own verification pass — not as a single bulk cutover.
