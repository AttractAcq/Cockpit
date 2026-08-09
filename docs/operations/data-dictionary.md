# Data Dictionary

All 132 real tables (+1 view) in the `public` schema of `xivewedajschthjlblfb`, grouped by domain, as of the close of Stage P. One line each — purpose, not full column lists (use `list_tables`/`information_schema.columns` for exact shape). Tables described elsewhere in more depth link to that doc.

## Identity & access

- `users` — staff/system users, `role` enum (`admin`, `account_manager`, `editor`, plus Stage O additions `strategist`/`content_operator`/`media_buyer`/`analyst`/`client_approver`).
- `clients` — the tenant row. `monthly_revenue_estimate`, `onboarded_from_template_id`, `onboarded_at` added Stage O.
- `client_users` — client-portal users, scoped to exactly one client.
- `team_members(user_id, client_id)` — the sole non-admin staff visibility grant; drives `auth_client_ids()`.
- `workspaces` — legacy multi-workspace concept, largely superseded by the client-per-tenant model.

## Canonical domain spine (Stage B+ — see architecture guide §2–3)

- `content_sources`, `manual_ideas`, `proof_items` — intake.
- `content_opportunities`, `content_opportunity_sources`, `content_opportunity_scores` — the canonical Opportunity entity, `origin` enum `manual_idea`/`research`/`campaign_requirement`/`performance`. Zero rows as of Stage P.
- `calendar_slots`, `content_calendar_proposals`, `content_calendar_proposal_slots` — Stage G planning.
- `content_items`, `content_item_sources`, `content_item_proof`, `content_item_assets`, `content_item_legacy_projections` — the canonical Content Item. Zero rows as of Stage P. `content_item_legacy_projections` exists to project legacy master rows into this shape but is not populated (see migration guide).
- `content_briefs`, `production_jobs`, `production_reviews` — canonical brief/production (Stage H/I).
- `content_requirements` — Phase-2-style requirement definitions feeding calendar proposals.
- `content_performance` — declared in the Stage B migration as the canonical performance table; **dead, zero writers anywhere in the codebase** (confirmed this stage). Real performance data lives in `client_metric_snapshots`/`client_business_signal_snapshots` instead.

## Legacy master pipeline (pre-canonical, still the real production path)

- `organic_master`, `ads_master`, `story_master`, `website_master`, `proof_master`, `asset_master`, `lead_magnet_master` — the original per-content-type master tables.
- `calendar_cells`, `weekly_sequence` — legacy code-driven calendar.
- `client_production_briefs`, `client_assets`, `asset_brief_index` — legacy brief/asset pipeline; carries all real production to date.

## Ideation / Research (Stage C-era, separate from the canonical spine's own "Opportunity")

- `client_ideation_cycles`, `client_ideation_technique_runs`, `client_ideation_research_results` — the seven-technique research runs.
- `client_ideation_candidates`, `client_ideation_candidate_scores`, `client_ideation_scoring_runs` — candidate generation and scoring.
- `client_ideation_calendar_proposals`, `client_ideation_calendar_proposal_slots` — ideation's own proposal tables (distinct from `content_calendar_proposals`).
- `client_ideation_commit_runs`, `client_ideation_commit_items` — commit step; writes into `organic_master`/`story_master`/`calendar_cells`, **not** `content_items`.
- `ideation_technique_strategies` — configuration for the seven techniques.

## Client Context OS (Phase 1/2 — pre-Reel-Studio build track, closed per root `CLAUDE.md` §8)

- `client_inputs`, `client_context_files`, `client_context_file_citations`, `client_context_file_playbooks`.
- `client_context_patch_drafts`, `client_context_patch_applications`, `client_context_patch_reviews` — the Gate B-G patch-application subsystem.
- `client_context_update_proposals`, `client_context_update_proposal_items`, `client_context_update_reviews`, `client_input_conflicts`.
- `client_execution_configs`, `client_execution_config_checks`, `client_execution_files` — Stage 2 execution pack.
- `client_source_documents`, `client_document_chunks` — RAG-style source material for context generation.

## Playbooks

- `playbooks`, `playbook_versions`, `playbook_runs` — human-approved AI playbook agents (propose → commit).

## Distribution & publishing

- `client_distribution_records` — the real bridge table; every real publish, legacy or canonical-origin, passes through here. `content_item_id`/`content_brief_id` are the (currently unpopulated) forward links into the canonical spine.
- `client_distribution_accounts`, `client_distribution_policies` — per-client platform account + policy config.
- `client_publish_attempts` — attempt-level log feeding `computePublishSuccessRate`.

## Analytics & performance

- `client_metric_snapshots`, `client_business_signal_snapshots` — organic performance data, keyed on `distribution_record_id`; the real performance path (not `content_performance`).
- `client_performance_scores`, `client_performance_insights`, `client_performance_analysis_runs` — Gate D scoring/insight generation, extended Stage M for paid (`ad_campaign_id` nullable column).
- `client_analytics_records`, `client_insights_collection_runs`, `client_insights_collection_attempts` — raw analytics ingestion.
- `pipeline_metrics_daily` — rollup table for operator dashboards.

## Iteration / learning loop

- `client_iteration_candidates` — Gate E, extended Stage M for ads (`created_content_opportunity_id`/`created_ad_opportunity_id`).
- `client_iteration_reviews` — human review of candidates before promotion.
- `learning_proposals` — broader system-learning proposals, separate from per-content iteration.

## Ads / paid distribution (Stage L)

- `ad_opportunities`, `ad_briefs`, `ad_creative`, `ad_creative_variants`.
- `ad_budget_policies`, `ad_campaigns`, `ad_sets`, `ads`, `ad_launch_attempts`.
- `ad_campaign_metric_snapshots`, `ad_campaign_business_signal_snapshots` — Stage M paid analytics, manual-entry only (see provider runbook).

## Reel Studio (AI video)

- `video_projects`, `video_shots`, `video_project_deliverables`, `video_composition_contracts`.
- `brand_prompt_blocks` — grade/lens/mood/negative prompt DNA; currently one row, hardcoded South African content (flagged, not fixed — conflicts with current EUR/Europe commercial authority).
- `generation_credits_ledger` — real table, never written (Higgsfield exposes no per-request cost field).
- `client_reel_styles`, `client_ai_background_image_generations`, `client_ai_background_image_reviews` — older synchronous AI-image pipeline, still gated `humanOnly` for `reel_video` format (see architecture guide §3, "The `reel_video`/`humanOnly` gate").

## Automation & fulfilment control (Stage N)

- `client_automation_policies` — 14 named areas, `manual`/`assisted`/`automatic`.
- `client_capacity_policies` — budgets, `max_simultaneous_jobs`, `retry_cap`.
- `client_exception_queue` — 9 named types, deduped on open items.
- `automations`, `automation_runs` — older/generic automation-definition tables, largely superseded by the Stage N policy model for the publishing worker specifically.

## Multi-client operational control (Stage O)

- `client_work_items` — generic work-allocation overlay across all pipelines.
- `client_cost_ledger` — 7 named cost categories.
- `client_margin_summary` — **view**, not a table; `security_invoker = true` as of Stage P (see architecture guide §7).
- `client_onboarding_templates` — default automation/capacity policy bundles applied by `onboard_client`.

## Asset generation pipeline (older AI-image generation, pre-Reel-Studio)

- `client_asset_generation_jobs`, `client_asset_generation_items`, `client_asset_pipeline_state`.
- `client_asset_archive_snapshots` — versioning on re-generation.
- `client_asset_group_completeness_overrides`, `client_asset_group_warning_acknowledgements` — human overrides of automated completeness checks.
- `client_destructive_operations` — audit trail for any operation that deletes/replaces existing client assets.

## Client-level research (distinct from Ideation)

- `client_research_runs`, `client_research_sources` — a separate, simpler research mechanism from the seven-technique Ideation system; check which one a given feature actually calls before assuming.

## Contractors

- `contractors`, `contractor_assignments` — human production capacity, used by the `humanOnly` production paths.

## Config, audit, and misc

- `qualification_configs`, `ref_counters`, `secret_references`, `sops_laws`, `integrations`.
- `activity_log` — the real, live plain-English operator feed (`OperationsPage.tsx`).
- `audit_log` — lower-level structured audit trail, distinct from `activity_log`.
- `client_phase3_scope_items`, `client_phase3_scoped_runs` — legacy Phase 3 direct-generation scoping, still live (not yet stopped — see migration guide).
