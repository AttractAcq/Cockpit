# Cockpit Architecture Guide

Written at the close of Programme Stage P (End-to-End Hardening and Legacy Retirement), the final stage of the A–P build programme. This is a snapshot of the **real, verified state of the system** as of this stage's live audit — not the intended design. Where intent and reality diverge, both are stated.

## 1. Golden architecture rules (unconditional, see repo `CLAUDE.md`)

- Surfaces are thin: the React app renders data and captures intent. It never calls external APIs (Meta, Higgsfield, Anthropic, OpenAI) directly and never holds secrets.
- Every action that touches the outside world or mutates state goes through an edge function (`supabase.functions.invoke(...)`).
- Reads come from Supabase directly (RLS-scoped); writes and side effects go through edge functions.
- Multi-tenant isolation is enforced by RLS at the database, not in app code. `auth_client_ids()`/`auth_role()` are the two SECURITY DEFINER functions nearly every RLS policy calls.

## 2. The two parallel content pipelines (the central fact to understand)

Stage B introduced a **canonical domain spine** — `content_sources`, `content_opportunities`, `content_opportunity_sources`, `content_opportunity_scores`, `calendar_slots`, `content_calendar_proposals`/`_slots`, `content_items`, `content_briefs`, `production_jobs`, `content_item_assets`, `client_distribution_records` (the bridge table, pre-existing from Stage K, since given `content_item_id`/`content_brief_id` columns as the forward link) — intended as the single supported model going forward.

A pre-existing **legacy master pipeline** continued operating throughout the whole programme: `organic_master`, `ads_master`, `story_master`, `calendar_cells`, `client_production_briefs`, `client_assets`. This is the pipeline that has produced **100% of real production to date** for the one real client (Attract Acquisition itself): 22 `organic_master` rows, 2 `ads_master` rows, 26 `client_production_briefs` (all `approved`), 75 `client_assets`, 25 `client_distribution_records` (19 `published`).

As of this stage's audit, the canonical spine's core tables (`content_opportunities`, `content_opportunity_sources`, `content_opportunity_scores`, `content_items`, `ad_opportunities`) are **all at zero rows**. The canonical spine is real, wired code — not vaporware — but it has never carried a single real unit of production. See §4 for why the two pipelines have not yet converged, and `docs/operations/migration-guide.md` for the backfill decision.

## 3. Golden paths — verified state (Stage P audit)

Traced against real migrations/edge functions/UI, not assumed from names. `REAL` = fully wired end-to-end; `PARTIAL` = real but with a gap; `MISSING` = no functional implementation.

### Manual Idea path
`Manual Idea → Opportunity → Slot → Content Item → Brief → Production → Approval → Publication → Analytics → Iteration`

All REAL except **Approval**, which is **PARTIAL**: `content_items.status` is inserted as `'planned'` by `commit_calendar_proposal` and never advanced by any real code path afterward — no function transitions it through `brief_pending → … → approved`. The CHECK constraint (`content_items_approval_check`) already requires `approved_by`/`approved_at` once status reaches `approved`/`scheduled`/`published`/`analysed`/`iterated`, but nothing sets those columns. This is dead code, not a stub — the comment describing the intended transition exists in the Stage B migration, the implementation does not.

Everything else in this path is real and wired: `ingest-content-source` → `create-content-opportunity` → `create-calendar-proposal`/`update-calendar-proposal-slot` → `approve-calendar-proposal` (RPC `commit_calendar_proposal`) → `generate-content-brief`/`review-content-brief` → `route-content-brief-to-studio`/`submit-production-review` → `create-distribution-record-from-content-item` → `process-scheduled-publishing` → `client_metric_snapshots`/`client_business_signal_snapshots` → `promote_iteration_candidate_to_opportunity`.

### Proof path
`Proof Upload → Proof Item → Opportunity → Content Item → Reel and Carousel → Publication → Performance → Reuse`

- **Proof Upload: PARTIAL** — `proof_items` captures claims as text via `ingest-content-source`; there is no file-upload UI or dedicated storage bucket for proof media.
- **Proof Item → Opportunity, Opportunity → Content Item: REAL.**
- **Content Item → Reel and Carousel: PARTIAL** — `route-content-brief-to-studio` only creates a `production_jobs` row; it does not trigger generation. Real Reel/Carousel generation runs on the legacy `client_production_briefs`/Reel Studio (`video_projects`) schema, which the Stage B migration explicitly keeps separate from the canonical spine.
- **Publication, Performance: REAL** — both key off `distribution_record_id`, so any content that does reach a `client_distribution_records` row is published and measured through the same real pipeline regardless of origin.
- **Reuse: MISSING** — `proof_items.usage_state` is set to `'unused'` at creation and never updated anywhere in the codebase. Schema-only.

### Research path
`Seven-Technique Research → Candidate → Score → Opportunity → Proposed Calendar → Commitment → Production → Distribution`

- **Research, Candidate, Score: REAL** — the seven techniques (Persona, Review-Mined Pain Language, Competitor Objections, End-Customer Complaints, Live Objection Log, Trigger Event, Format Swipe) are real modules under `supabase/functions/_shared/ideation/techniques/`, orchestrated by `run-ideation`, scored by `score-ideation-candidates` into `client_ideation_candidate_scores`.
- **Opportunity: PARTIAL** — scored candidates do **not** create a `content_opportunities` row. They feed directly into `client_ideation_calendar_proposals`, skipping the generic Opportunity entity the other four paths converge on.
- **Proposed Calendar, Commitment: REAL** — `create-ideation-calendar-proposal` → `commit-ideation-content`.
- **Production/Distribution: this is the important finding** — `commit-ideation-content` writes directly into `organic_master`/`story_master`/`calendar_cells` (the **legacy** pipeline), not into `content_items`/`calendar_slots` (the canonical spine). The Research path therefore does not converge with the Manual Idea path at all — it is a fully separate, parallel pipeline that happens to produce real content through the legacy studios.

### Performance path
`Published winner → Performance Insight → New Opportunity → Paid promotion or derivative content`

All REAL and well-wired. "Winner" is a computed classification (`overall_score >= same-format baseline + 15`), not a manual flag. `promote_iteration_candidate_to_opportunity` correctly inserts into `content_opportunities` (`origin='performance'`) or `ad_opportunities` (`origin='performance_insight'`) — confirming `content_opportunities.origin`'s enum already anticipates `manual_idea`/`research`/`campaign_requirement`/`performance` as convergent sources, even though the Research path's real code does not currently use it (see above).

One real, currently-dormant bug found during this audit: `AdStudioPanel.tsx`'s ad-opportunity creation form exposes an `organic_winner` origin option that will fail server-side, because the UI never passes `promoted_from_content_opportunity_id`, which `ad_opportunities_organic_winner_check` and `create-ad-opportunity` both require. Zero live impact today (`content_opportunities` has zero rows, so no real winner exists to select), but will surface the moment the canonical spine carries real data. Left unfixed and disclosed here rather than patched blind, since fixing it well requires deciding what UI affordance should let an operator pick a real content opportunity to promote — a real design decision, not a one-line fix.

### Ad path
`Ad Opportunity → Ad Brief → Variants → Campaign → Spend → Lead → Cash-collected attribution`

`Ad Opportunity → Ad Brief → Variants → Campaign` is REAL end-to-end (Stage L), including a real Meta Graph API call path in `launch-ad-campaign` that fails closed on missing credentials (deliberately never configured — see the reel/ad safety note in `docs/operations/provider-runbook.md`).

`Spend`, `Lead`, and `Cash-collected attribution` are all **PARTIAL**: the columns exist (`ad_campaigns.spend_to_date`, `ad_campaign_business_signal_snapshots.leads`/`cash_collected`/`cac`/`roas`), but every one of them is populated by manual operator entry through `AdCampaignPerformanceSection` in `AdStudioPanel.tsx` — there is no live Meta insights reconciliation job, no lead-capture webhook or CRM integration, and no automated attribution engine. This is the same "never call the live Meta Marketing API" safety decision made in Stage L, now confirmed still true at the end of the programme.

## 4. Why the two pipelines never converged

No stage in the A–P programme performed a live cutover of the legacy master pipeline to the canonical spine. Each stage that touched the canonical spine (B, E, F, G, H, I, K) built it correctly and left the legacy pipeline untouched and fully operational, because the legacy pipeline was carrying the one real client's real, live production work throughout the entire programme — cutting it over blind, mid-programme, was never worth the risk for a system with a single real tenant. Stage P's own migration/cutover checklist (backfill, dual-write parity, cut reads, stop legacy generation, archive compatibility functions, remove deprecated UI) was evaluated and **deliberately deferred as a separate follow-on migration project** — see `docs/operations/migration-guide.md` for the full reasoning and the specific blocking finding (the dead approval-status code in `content_items`, §3 above).

## 5. Multi-client scale and operational control (Stage O)

- `team_members(user_id, client_id)` is the sole mechanism granting non-admin staff client-scoped visibility. `auth_client_ids()` resolves visible clients by role: `admin` sees all, `client` sees its own via `client_users`, every other authenticated role sees whatever `team_members` grants.
- `client_work_items`, `client_cost_ledger` + `client_margin_summary` (view, `security_invoker=true` as of this stage — see §6), `client_onboarding_templates` + `onboard_client` RPC are the operational-control layer, surfaced in `OperationsControlPanel.tsx`.

## 6. Automation and fulfilment control (Stage N)

`client_automation_policies` (14 named areas, `manual`/`assisted`/`automatic`), `client_capacity_policies` (per-client retry caps, budgets, simultaneous-job limits), `client_exception_queue` (9 named exception types, deduped on open items). `process-scheduled-publishing` gates every claimed record through `checkAutomationGate` before attempting a publish, and every permanent failure files an exception. See `docs/operations/automation-policy-guide.md`.

## 7. Security posture (Stage P hardening)

- All 133 public-schema tables have RLS enabled with at least one policy (verified this stage).
- Every `SECURITY DEFINER` function has `search_path` explicitly configured (verified this stage).
- One real ERROR-level finding from the Supabase security advisor was found and fixed this stage: `client_margin_summary` (created Stage O) was an implicit `SECURITY DEFINER` view, meaning it evaluated RLS as the view owner rather than the querying user — a real, latent cross-client data-isolation defect (zero live impact, since the only real user today is `admin`). Fixed via `ALTER VIEW ... SET (security_invoker = true)`.
- Remaining WARN-level findings (47, all reviewed) are routine `SECURITY DEFINER` function-executable notices (expected — these are the intentional RLS-bypass functions the whole isolation model depends on, e.g. `auth_client_ids()` itself), `extension_in_public` for `pg_net` (underlies the pg_cron/pg_net publishing worker infrastructure — relocating it is a real, separate, higher-risk migration, not a Stage P fix), and `auth_leaked_password_protection` (a Supabase Auth dashboard project-level toggle, not a schema-fixable code issue).
