# Supabase Migration Ledger Reconciliation

**Project ref:** `xivewedajschthjlblfb`
**Compiled:** 2026-07-27 · **Executed and closed:** 2026-07-28
**Status: RECONCILED.** `supabase migration list --linked` shows every historical
migration paired Local↔Remote, and `supabase db push --linked --dry-run` now
lists only deliberately-approved pending work.

---

## 1. Outcome

| Item | Before | After |
|---|---|---|
| Local migration files in `supabase/migrations/` | 43 | 41 |
| Local versions matching a remote ledger entry | 24 | **38 (all)** |
| Local versions with no remote entry | 5 | **3** (the Reel Studio migrations, then applied) |
| Remote entries with no local file | 0 | 0 |
| Files that `db push` would have applied unintentionally | 2 | **0** |

All three Reel Studio migrations were subsequently applied. The ledger now
contains 41 entries and the pending set is empty.

---

## 2. Held migrations — moved out of the active directory

Both were moved to `supabase/held-migrations/` (contents preserved, git history
preserved via `git mv`). See that directory's `README.md` for the full evidence.

| File | Disposition | Evidence |
|---|---|---|
| `20260717000018_client_phase3_status_view.sql` | **HELD** — author instruction | Header says "HELD FOR REVIEW — do not apply in this increment". No remote entry. `client_phase3_status_v` confirmed absent live. `src/lib/api.ts` → `fetchPhase3StatusMap()` already has a tested fallback (`isMissingPhase3StatusViewError`), so holding it breaks nothing. No Reel Studio dependency. |
| `20260622000000_p1_security_lockdown.sql` | **HELD** — proven no-op | All three targets confirmed **ABSENT** live: `increment_ad_lead(uuid,date)`, `trg_lead_score_before()`, `trg_lead_score_after()`. Every statement is guarded by `IF to_regprocedure(...) IS NOT NULL`, so it would change nothing. No remote entry. Not marked applied — that would assert a false history. |

Neither was deleted, renamed to a newer version, or repaired.

---

## 3. Proven renames (14)

Every rename required **two** independent proofs: an exact remote ledger name
match, **and** live schema effects confirmed by catalogue introspection. No SQL
contents were altered.

| Local version (old) | → Remote version (new) | Name | Schema-effect evidence (live) | Risk |
|---|---|---|---|---|
| 20260702000001 | 20260702074337 | `v1_foundation` | `clients`, `users`, `client_inputs` present. (Local file is a documented stub — the SQL was applied via MCP on 2026-07-02; it contains no DDL, so it is inert either way.) | Low |
| 20260702000002 | 20260702142435 | `batch_b_additions` | `client_inputs.sales_process` + `story_master.story_type` present | Low |
| 20260706000006 | 20260706194643 | `phase_h1_pipeline_state` | `client_asset_pipeline_state` + `client_asset_archive_snapshots` present | Low |
| 20260706000007 | 20260706200927 | `phase_h3_distribution` | `client_distribution_records` + `client_analytics_records` present | Low |
| 20260707000008 | 20260707102733 | `phase_h4_analytics_status` | `client_analytics_records.analytics_status` present | Low |
| 20260709000009 | 20260709133914 | `phase_h5_asset_generation_jobs` | `client_asset_generation_jobs` + `_items` present | Low |
| 20260710000010 | 20260710120737 | `phase_h6_story_publishing` | index `client_distribution_records_group_seq_idx` present | Low |
| 20260711000011 | 20260710125508 | `phase_h7_frame_versioning` | index `client_assets_one_current_per_frame` + `activate_asset_version()` present | Low |
| 20260712000012 | 20260710175902 | `phase_h8_scoped_phase3` | `client_phase3_scoped_runs` + `client_phase3_scope_items` present | Low |
| 20260713000013 | 20260710191515 | `phase_h9_destructive_ops` | `client_destructive_operations` + `phase_ref_is_published()` present | Low |
| 20260713000014 | 20260710191713 | `phase_h9_tighten_grants` | All four `apply_*` functions confirmed **not** executable by `authenticated`; `phase_ref_is_published` not executable by PUBLIC/anon, granted to `service_role` | Low |
| 20260714000015 | 20260712195816 | `pre_pages_hardening` → **`phase_pre_pages_hardening`** | `client_health_v` confirmed `security_invoker=true`. **Name also changed.** The local file's "HELD" header is stale — it was approved and applied on 2026-07-12 (corroborated by the `pre-pages-hardening` memory note) | Low–Medium |
| 20260715000016 | 20260714104409 | `phase_p1_scheduled_publishing` | `claim_due_distribution_records()` + `client_publish_attempts` present | Low |
| 20260716000017 | 20260714174020 | `phase_p1b_publishing_rpc_hardening` | `schedule_distribution_record()`, `upsert_distribution_draft()`, `_log_distribution_transition()` present | Low |

**One probe initially disagreed and was investigated rather than waved through:**
`phase_ref_is_published` still shows `authenticated=X`. Reading the migration
confirms it only ever revokes `PUBLIC` and grants `service_role` — it never
revokes `authenticated`. The live ACL (`postgres=X, authenticated=X,
service_role=X`) is therefore exactly what the migration produces. The probe was
over-strict; the database is correct.

`supabase migration repair` was **not** used at any point.

---

## 4. Phase 2 live-constraint migrations — already applied, not duplicated

| Version | Name | Live definition confirmed identical |
|---|---|---|
| 20260723143845 | `reel_studio_phase_d_client_assets_reel_video_format` | `CHECK (asset_format = ANY (ARRAY['ad_static','reel_video','story_sequence','carousel','feed_post']))` |
| 20260723143913 | `reel_studio_phase_d_client_assets_video_mime_type` | `CHECK (mime_type = ANY (ARRAY['image/png','image/jpeg','image/webp','video/mp4']))` |
| 20260723143937 | `reel_studio_phase_d_client_assets_video_bucket` | `CHECK (storage_bucket = ANY (ARRAY['client-assets','video-assets']))` |

These were captured locally during Phase 2 from `pg_get_constraintdef` output.
Because their versions and names match the remote ledger exactly, `db push`
correctly treats them as **already applied**. No duplicate constraint was applied.

---

## 5. Final dry run (pre-deployment)

```
$ supabase db push --linked --dry-run
Would push these migrations:
 • 20260727000033_reel_studio_phase1_integrity.sql
 • 20260727000034_reel_studio_phase2_recovery_modes_capability.sql
 • 20260728000035_reel_studio_phase3_final_reel.sql
```

Exactly the three approved Reel Studio migrations, in dependency order. No held
migration, no unknown historical migration, no duplicate constraint, no unrelated
application work. All §21 stop conditions clear.

---

## 6. Application

Applied one phase at a time with schema verification between each (see
`docs/REEL_STUDIO_PRODUCTION_DEPLOYMENT_REPORT.md` §C for full verification
output). Sequencing was achieved by temporarily holding the later two files
outside `supabase/migrations/` — they were untracked at the time, so git state
was unaffected.

| Order | Version | Applied | Verified |
|---|---|---|---|
| 1 | 20260727000033 | ✅ | 5 RPCs, `SECURITY DEFINER`, `search_path=""`, service-role-only |
| 2 | *(constraints)* | already live | 3 definitions confirmed identical, not re-applied |
| 3 | 20260727000034 | ✅ | 6 columns, 3 constraints, `hybrid` mode, 2 reset RPCs, trigger |
| 4 | 20260728000035 | ✅ | Table + RLS + 3 unique indexes, FK, 7 distribution columns, 5 RPCs, 4-arg capability overload |

Post-deployment `db push --dry-run` reports nothing pending.

---

## 7. Residual risks

| Risk | Status | Note |
|---|---|---|
| Held status-view migration | **Resolved** | Physically outside `supabase/migrations/`; cannot be pushed. Awaiting Alex's decision on whether to ever apply it |
| Security-lockdown migration | **Resolved** | Held, with live proof it is a no-op. Awaiting Alex's confirmation to keep it held permanently |
| Renamed files sort earlier than before | **Accepted** | The remote ordering is the one that actually ran; `migration list` confirms correct pairing and ordering |
| `v1_foundation` local file is a stub | **Accepted, pre-existing** | It contains no DDL. The real schema was applied via MCP on 2026-07-02. If a fresh environment is ever built from these files it will not reproduce the schema — this predates the current work and is unrelated to Reel Studio |
| `video_project_deliverables` carries Supabase default `authenticated` CRUD grants | **Accepted, matches convention** | Identical to `video_projects`, `video_shots`, `brand_prompt_blocks`, `generation_credits_ledger`. `anon` is fully revoked; RLS is enabled with a staff-SELECT-only policy, so DML is denied. Recommended follow-up: one additive hardening migration tightening all five Reel Studio tables to `SELECT`-only for `authenticated`, matching `client_distribution_records` |
