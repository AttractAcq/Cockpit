# Supabase Migration Ledger Reconciliation

**Project ref:** `xivewedajschthjlblfb`
**Compiled:** 2026-07-27 · **Executed and closed:** 2026-07-28 · **Stage A provenance refresh:** 2026-08-02
**Status: RECONCILED AT THE 2026-08-02T15:11:27.763Z READ-ONLY CAPTURE.** The
provenance-bound capture verified actual linked project
`xivewedajschthjlblfb`, showed all **47 active migrations paired**, and recorded
`supabase db push --linked --dry-run` reporting `Remote database is up to
date.` Exact command, target, CLI version, UTC bounds, exit status, stdout, and
stderr are in `docs/evidence/stage-a-live-provenance-manifest.json`:
`migration-list.txt` SHA-256
`6aaab205d7b900f7483e3a5dfcd9ca07b2f284858606decf596219bc56d189d5`
and `db-push-dry-run.txt` SHA-256
`1b20ae82a9a4465f73d54c46884a074e1d34884be339675279196562e1f1dbdd`.
Two additional files are deliberately held outside the active directory.

The complete machine-readable classification is
[`stage-a-current-state-inventory.json`](stage-a-current-state-inventory.json):

| Classification | Count | Current meaning |
|---|---:|---|
| Applied | 47 | Active files in `supabase/migrations/`; paired Local↔Remote at the timestamped 2026-08-02 capture |
| Pending | 0 | None at that linked dry run |
| Held | 2 | Outside the active directory; governed by `supabase/held-migrations/README.md` |
| Obsolete | 0 | No migration has been deleted or falsely relabelled obsolete |

Stage A Route B adds no active migration and therefore creates no production
pending entry. The production ledger remains the historical authority; the
separate `supabase/baseline/` cutover is only for fresh environments.

---

## 1. Historical 2026-07-28 reconciliation outcome

| Item | Before | After |
|---|---|---|
| Local migration files in `supabase/migrations/` | 43 | 41 |
| Local versions matching a remote ledger entry | 24 | **38 (all)** |
| Local versions with no remote entry | 5 | **3** (the Reel Studio migrations, then applied) |
| Remote entries with no local file | 0 | 0 |
| Files that `db push` would have applied unintentionally | 2 | **0** |

All three Reel Studio migrations were subsequently applied. The ledger contained
41 entries at this historical checkpoint; six later Ideation/Reel Studio
migrations brought the active applied set to the current 47 recorded above.

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

## 7. Stage A foundation remediation (Route B)

The original foundation migration remains byte-for-byte historical evidence. It
cannot reconstruct an empty database because its DDL was never committed. No
branch, tag, stash, or historical commit contains the missing SQL, and the
current schema cannot be substituted safely: 49 of its 80 tables were introduced
by later migrations.

The formal current-state baseline at cutover `20260801000000` resolves fresh
reconstruction without changing this ledger:

- `supabase/baseline/current-schema.sql` is byte-identical to the
  provenance-bound captured production schema-only authority (SHA-256
  `09a2aaf0d8b65e3954b2e6704f59f99025e05a029905d697614641c575577f5a`).
- `supabase/baseline/application-schema.sql` is the canonical executable
  application reconstruction, deterministically projected from that authority
  by the three explicit platform-owned exclusion rules recorded in the
  manifest. The guarded local bootstrap executes this file, not
  `current-schema.sql`.
- `supabase/baseline/manifest.json` pins all 47 active migration hashes and the
  two held hashes.
- `scripts/bootstrap-disposable-supabase.sh` applies the executable projection
  and bootstrap data only to the fixed, confirmed local disposable stack, then
  applies migrations newer than the cutover.
- Existing production continues to receive only reviewed, post-cutover active
  migrations through its unchanged ledger.

The guarded rebuild was run from a newly started disposable local stack with
automatic local migration replay disabled by the Route B configuration. It
proved an empty `public` schema, applied the baseline,
found zero currently applicable post-cutover migrations, matched the documented
2,912-entry identifier multiset, and passed RLS flags/policy count,
representative six-RPC grant checks, storage, seed, and transactional symmetric
two-client-isolation assertions. It also executed
representative `NOT NULL`/`CHECK`/state, FK action, global/client-scoped
uniqueness, and `begin_ideation_run` idempotency behavior. Those selected cases
verify required invariants without claiming exhaustive behavioral integration.
The identifier comparison does not compare function bodies, policy
expressions, constraint/index definitions, or ACLs. The exact captured
authority hash also matched the provenance-bound production schema evidence.
The sanitized execution transcript, component statuses, and cleanup result are
authoritatively referenced from
`docs/evidence/stage-a-local-verification/verification-manifest.json`; its hash
is not duplicated here.

That manifest also records
`aa.cockpit.stage-a-database-source-binding.v1`, computed before disposable
startup. The binding covers the exact runner, configuration, executable and
captured schemas, bootstrap data, baseline manifest, verification SQL, baseline
derivation/comparison scripts, and deterministically enumerated post-cutover
migrations. Each database component is mapped to exact bound input hashes. The
checker recomputes the path set, every file/migration hash, and the aggregate
from current bytes; transcript timestamps record execution time only and do not
participate in freshness.

Do not put the baseline in `supabase/migrations/`, mark it applied remotely, or
run `migration repair`. Before any future production push, compare the linked
dry run against only the expected post-cutover migration set.

---

## 8. Residual risks

| Risk | Status | Note |
|---|---|---|
| Held status-view migration | **Resolved** | Physically outside `supabase/migrations/`; cannot be pushed. Awaiting Alex's decision on whether to ever apply it |
| Security-lockdown migration | **Resolved** | Held, with live proof it is a no-op. Awaiting Alex's confirmation to keep it held permanently |
| Renamed files sort earlier than before | **Accepted** | The remote ordering is the one that actually ran; `migration list` confirms correct pairing and ordering |
| `v1_foundation` local file is a stub | **Resolved for fresh environments by Route B** | Historical file remains intact; guarded fresh builds use the separate current-state baseline and post-cutover migrations |
| `video_project_deliverables` carries Supabase default `authenticated` CRUD grants | **Accepted, matches convention** | Identical to `video_projects`, `video_shots`, `brand_prompt_blocks`, `generation_credits_ledger`. `anon` is fully revoked; RLS is enabled with a staff-SELECT-only policy, so DML is denied. Recommended follow-up: one additive hardening migration tightening all five Reel Studio tables to `SELECT`-only for `authenticated`, matching `client_distribution_records` |
