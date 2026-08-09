# Stage P Status — End-to-End Hardening and Legacy Retirement

Final stage of the A–P build programme. This report is written to the same evidentiary standard as every prior stage's status report: every claim is grounded in a live query, a real code citation, or an explicitly-run tool (the Supabase security advisor), never assumed from a table or function name.

## 1. What this stage's character is, and why the approach differs from A–O

Stages A–O each built a real backbone of new schema/backend/frontend. Stage P's own scope (audit, harden, document, and evaluate a legacy cutover) is fundamentally different — most of the value here is in verifying and honestly reporting the *true* state of the system built across the whole programme, not in writing new feature code. One real code fix was made (§2); one real, evidence-based architectural finding was surfaced that changes how the rest of this report should be read (§4).

## 2. Security fix: `client_margin_summary` implicit SECURITY DEFINER view

Found via `get_advisors(type="security")`, ERROR level. `client_margin_summary` (created Stage O) was defined without `security_invoker`, meaning it evaluated RLS on `client_cost_ledger`/`clients` as the view *owner*, not the querying user — a real, latent cross-client cost/revenue/margin data leak. Fixed via migration `20260812120000_stage_p_fix_margin_summary_security_definer_view.sql` (`ALTER VIEW ... SET (security_invoker = true)`). Verified: `pg_class.reloptions` now shows `security_invoker=true`; the view still returns correct data (1 row, matching the one real client); `get_advisors` re-run confirms the ERROR is gone, 47 WARN-level findings remain, all pre-existing/routine (§6). Zero real live impact — the only real user today is `admin`, which legitimately sees every client regardless of this bug — but fixed immediately per the standing "fix real bugs the moment they're found" discipline.

## 3. Security/RLS/secret hardening review

- **RLS coverage**: all 133 public-schema tables have `rls_enabled = true` with ≥1 policy. Zero gaps.
- **`SECURITY DEFINER` function `search_path`**: every such function already has `search_path` explicitly configured. Zero gaps.
- **Secret review**: grepped `src/` and `supabase/functions/` for hardcoded API-key/private-key patterns — zero hits. `.env`/`.env.local`/`.env.*.local` are gitignored; `.env` exists locally but is untracked. Clean.
- **Audit log completeness**: `audit_log` (via the shared `audit()` helper in `_shared/aa.ts`) is called from ~45 real edge functions across the canonical spine, ads, calendar planning, context management, and several legacy functions — genuinely comprehensive, not dead code. `activity_log` (the separate, plain-English operator feed) is likewise real and live. Both are documented in the incident runbook and data dictionary.

## 4. Golden-path audit — the central finding of this stage

All five golden paths named in the build plan were traced against real migrations/edge functions/frontend (not status docs, which can go stale) via five parallel research passes. Full detail in `docs/operations/architecture-guide.md` §3. Summary:

| Path | Verdict |
|---|---|
| Manual Idea | REAL end-to-end except Approval (`content_items.status` never advances past `'planned'` — dead code, not a stub) |
| Proof | PARTIAL — no proof-media upload UI; Reel/Carousel production runs on the disconnected legacy schema; Reuse is schema-only |
| Research | REAL for Research→Candidate→Score→Calendar→Commitment, but Commitment writes into the **legacy** `organic_master`/`story_master`/`calendar_cells`, not the canonical spine — this path does not converge with Manual Idea at all |
| Performance | REAL and fully wired, including the one genuine closed loop in the system (promote a winning insight back into a fresh Opportunity) |
| Ad | REAL for Opportunity→Brief→Variants→Campaign; Spend/Lead/Cash-collected-attribution are manual-entry only, no live integration (deliberate, per Stage L) |

The load-bearing finding: **the canonical domain spine (`content_opportunities`, `content_items`, and friends, built across Stages B/E/F/G/H/I/K) is real, correctly-built, RLS-clean code that has never carried a single real row.** Live query confirms `content_opportunities`, `content_opportunity_sources`, `content_opportunity_scores`, `content_items`, and `ad_opportunities` are all at zero rows, while the legacy master pipeline carries all real activity for the one real client: 22 `organic_master`, 2 `ads_master`, 26 `client_production_briefs` (all `approved`), 75 `client_assets`, 25 `client_distribution_records` (19 `published`).

This is not a regression or a bug introduced this stage — it's the honest cumulative result of a programme that correctly prioritized never disrupting the one real client's live production while building the new architecture alongside it. It does mean the migration/cutover checklist below could not be responsibly executed this stage.

## 5. Migration and cutover — investigated live, largely deferred with reasoning

Full detail and recommended sequence in `docs/operations/migration-guide.md`.

- **Backfill Content Items for active legacy master rows: investigated, not performed.** `client_distribution_records` already has the right bridge columns (`content_item_id`, `content_brief_id`) to make this mechanically easy, but doing it honestly is blocked by the same finding in §4: no real code path ever sets `content_items.approved_by`/`approved_at`, and the CHECK constraint requires them before status can reach `approved`/`published`/etc. Backfilling 19 real published records into an honest-but-misleadingly-early status, or fabricating an approval event that never happened, were both rejected. The correct fix order is to implement the real approval-advancement code first — recorded as explicit follow-on work, not done blind this stage.
- **Backfill source/Opportunity links where evidence permits**: no reliable evidence exists linking any legacy record to a specific Opportunity (none of the legacy records were ever created through the Opportunity pipeline) — correctly a no-op, confirmed by live query rather than assumed.
- **Verify dual-write parity**: not applicable — there is no dual-write in place anywhere; the two pipelines are fully independent, not writing the same event twice.
- **Cut reads to canonical entities / stop new legacy Phase 3 direct generation / archive compatibility functions / remove deprecated UI actions**: not performed. All three pipelines (legacy master, Research-to-legacy, canonical spine) remain live. This is a live-product decision affecting the one real client's current work, requiring explicit sign-off per the standing workspace rule (root `CLAUDE.md` §8, §10) — not something to do unilaterally inside an audit stage, and genuinely higher-risk than anything else in this programme given it would cut off the only pipeline that has ever produced real value.
- **Retain historical records**: trivially true — nothing was deleted or archived.

## 6. Remaining advisor findings — disposition

47 WARN-level findings remain after the fix in §2, all reviewed:
- 43 `authenticated_security_definer_function_executable` + 2 `anon_security_definer_function_executable` — routine and expected; these are exactly the RLS-bypass functions (`auth_client_ids()` and friends) the entire multi-tenant isolation model depends on being SECURITY DEFINER and callable.
- 1 `extension_in_public` (`pg_net`) — pre-existing, underlies the pg_cron/pg_net publishing worker infrastructure. Relocating it is a real, separate, higher-risk migration (worker code references it directly) — correctly out of scope for a same-stage fix.
- 1 `auth_leaked_password_protection` — a Supabase Auth dashboard/project-level toggle, not a schema-fixable code issue. Documented, not actioned in code.

## 7. Hardening checklist — evidence-based disposition

- **Security review, RLS review, Secret review**: done, real, clean (§3).
- **Cost-abuse controls**: `client_capacity_policies` (budgets, `max_simultaneous_jobs`, `retry_cap`) is the real mechanism that exists (Stage N) — genuinely limits runaway automated spend per client. No system-wide/global abuse ceiling exists beyond per-client policy; not added this stage — would need a real incident or product decision to size correctly rather than an arbitrary number invented here.
- **Rate limiting**: grepped for rate-limiting code — what exists is provider-side backoff handling (Meta/Instagram 429 handling in `_shared/meta-errors.ts`/`meta-ads.ts`/`instagram-insights.ts`), not Cockpit's own inbound rate limiting on edge functions. Supabase's platform-level rate limits apply by default; no additional application-level limiting exists. Not added this stage — genuinely a new feature, not a hardening fix, and the one real client/user today doesn't create abuse pressure that would justify guessing at limits.
- **Provider failure simulation, Recovery testing**: not performed as a dedicated exercise this stage. The real failure-handling mechanisms that do exist (exception queue, retry caps, fail-closed generation, transactional DDL) were exercised incidentally and for real during Stages M/N/O's live-fixture testing (e.g. the Stage N deploy-payload-truncation mishap was correctly rejected rather than silently deployed) — documented in the incident runbook rather than newly re-tested here.
- **Data export**: no dedicated client-data-export feature exists. Not built this stage — genuinely new scope, not a hardening item, with no current requirement driving it.
- **Audit log completeness**: real and comprehensive (§3).
- **Backup and restoration**: governed by Supabase's own project-level backup policy, not application code — outside this repo's scope to verify or change from here.
- **Accessibility, Mobile operator usability**: not audited this stage. Genuinely deferred — a real accessibility pass needs either an automated tool run against live rendered pages or a manual screen-reader/keyboard-nav pass, neither of which was performed; stating otherwise would be a fabricated claim.
- **Performance**: no dedicated load/perf testing performed. The one real client's data volumes (dozens of rows per table, not thousands) mean this hasn't been a real production concern yet; deferred honestly rather than guessed at.

## 8. Documentation deliverables — all 8 written

`docs/operations/operator-manual.md`, `client-approval-guide.md`, `architecture-guide.md`, `incident-runbook.md`, `provider-runbook.md`, `migration-guide.md`, `automation-policy-guide.md`, `data-dictionary.md`. All grounded in this stage's live audits and the accumulated real state of the codebase — cross-checked against actual migrations/functions/tables, not written from memory of intent.

## 9. Acceptance criteria — honest assessment

| Criterion | Status |
|---|---|
| All four source streams operate | Manual Idea, Proof, Research all operate for intake; Performance operates as a feedback source. Real, though Research doesn't converge with the others (§4). |
| All selected Opportunities become canonical Content Items | **Not true today** — zero real Opportunities exist, so this is unverified in practice, and the Approval gap (§4) would block it even if one were created. |
| All Instagram formats can be produced and distributed | True via the legacy pipeline (real, live, exercised). Not yet true via the canonical spine (never carried real content). |
| Reels can be completed through required production strategies | True — Reel Studio Phases A–D are complete and live-tested. |
| Ads can be created, launched and measured | Created/launched: real (Meta launch fails closed on missing credentials, deliberately). Measured: manual-entry only, no live integration. |
| Performance creates controlled learning | True — the one genuinely real closed loop in the system (§4, Performance path). |
| Automation can run validated workflows under policy | True — Stage N's gate is real and exercised. |
| Multi-client data is isolated | True, and actively verified/hardened this stage (§2, §3). |
| Costs and failures are visible | Costs: partially (manual entry, no reconciliation job). Failures: yes, real exception queue + audit log. |
| Legacy direct Phase 3 is no longer the primary workflow | **False** — it is still the only workflow that has ever produced real client value. Not changed this stage (§5). |
| No required operational step exists only in undocumented manual knowledge | Addressed this stage via the 8 documentation deliverables (§8), covering everything discovered across all nine investigations in this report. |

## 10. Exit gate

> The new architecture is the sole supported operating model for new work.

**Not yet met**, and this report does not claim otherwise. The canonical architecture is real, RLS-clean, and correctly designed — but it is not yet the operating model for *any* work, new or otherwise, because no real content has ever been created through it and a genuine implementation gap (content_items approval-advancement) would block it from completing an honest end-to-end run today. Declaring the exit gate met would require either fabricating verification that didn't happen or silently accepting a known-broken step — both against this programme's standing rules. The correct, honest state: the programme has built a complete, real backbone (Stages A–O) and, in this final stage, produced a truthful map of exactly what's real, what's partial, and what's missing, plus a concrete, sequenced plan to actually reach the exit gate (`docs/operations/migration-guide.md` §"Recommended follow-on migration sequence"). That plan, not a declared-complete cutover, is this stage's real deliverable.

## 11. Whole-programme (A–P) closing summary

**Genuinely production-ready and live-tested**: Client Context OS (Phase 1/2, closed track), Reel Studio (Phases A–D), the legacy master → brief → asset → distribution → publish pipeline (organic Instagram, real and exercised), Stage N's automation-gate/exception-queue/retry-cap system, Stage O's multi-client team/work-item/cost-ledger/onboarding layer, Stage M's organic+paid performance scoring and iteration-promotion loop, Stage L's Ad Studio schema/UI through Campaign creation (deliberately never live-fired at Meta).

**Real but never yet exercised with real data**: the entire canonical domain spine (Stages B, E, F, G, H, I, K) — correctly built, RLS-clean, zero rows.

**Schema-present, functionally incomplete**: Content Item approval-advancement, proof-media upload, content reuse tracking, ad spend/lead/attribution automation, cost-abuse ceilings beyond per-client policy, data export.

**Explicitly out of scope throughout, by deliberate safety decision, never relaxed**: live Meta Marketing API calls, `reel_video` format through the human-only production gate.

This is an honest closing state, not a declared "done." The system genuinely works for the one real client's actual production today, through the legacy pipeline; the new architecture built alongside it across sixteen stages is real and ready to take over, but has not yet been proven with a single real end-to-end run, and this report says so plainly rather than assuming success from the presence of code.
