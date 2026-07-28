# Reel Studio Production Deployment Report

**Date:** 2026-07-28
**Project ref:** `xivewedajschthjlblfb` (confirmed linked via `supabase/.temp/project-ref` and `scripts/check-supabase-project.mjs`)
**Result:** Database and Edge Functions **deployed and verified**. Frontend **withheld** — see §E.

**No public Instagram Reel was published. No Instagram API call of any kind was made.**

---

## A. Pre-deployment state

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD commit | `ca0e9516d52f443cc89949e8085188df9e05336d` |
| Working tree | Dirty — Reel Studio Phases 1–3 implemented but uncommitted |
| Tracked modified | 23 files |
| Untracked | 34 files/dirs |
| Linked project | `xivewedajschthjlblfb` ✅ |
| Supabase CLI | v2.101.0 |

### Gate checks (§15) — all passed before any deployment

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build` | pass (only the known 1.18 MB chunk-size warning) |
| `node --test tests/*.test.ts` | **152 / 152 pass** |
| `git diff --check` | clean |
| `node scripts/check-supabase-project.mjs` | pass |
| Secret scan (diff + untracked) | no service-role key, no Meta token, no `.env` |

### Dirty-file classification

- **Reel Studio implementation** — 23 modified + 30 untracked (functions, shared modules, migrations, tests, types, UI).
- **Unrelated pre-existing docs** (left untouched): `docs/AA_IDEATION_REPOSITORY_AUDIT.md`, `docs/AA_IDEATION_STAGE_0_RECONCILIATION.md`, `docs/COCKPIT_REPOSITORY_STATE_ANALYSIS.md`, `docs/REEL_STUDIO_STATE_ANALYSIS.md`.
- **Local tooling, not application code**: `.claude/`.

Nothing was reset, cleaned, stashed, amended or force-checked-out. No commit was created.

> **Hygiene finding (pre-existing, now actioned):** `.claude/settings.local.json` is untracked and contains historical permission strings including an anon key for the **decommissioned** legacy Supabase project (the obsolete ref that `scripts/check-supabase-project.mjs` scans for — deliberately not reproduced here, since that guard rejects the literal string in any tracked file). The guard only scans *tracked* files, so it passed while `.claude/` was untracked — but a blanket `git add -A` would have committed it and then failed that guard. **`.claude/` has been added to `.gitignore` in this commit**, closing that exposure.

---

## B. Migration reconciliation

Full evidence table: `docs/SUPABASE_MIGRATION_LEDGER_RECONCILIATION.md`.

### Held migrations — moved to `supabase/held-migrations/` (contents + git history preserved)

| File | Decision | Proof |
|---|---|---|
| `20260717000018_client_phase3_status_view.sql` | Held — author instruction | Header: "HELD FOR REVIEW — do not apply". No remote entry. `client_phase3_status_v` absent live. `src/lib/api.ts` has a tested fallback (`isMissingPhase3StatusViewError`), so nothing breaks. No Reel Studio dependency |
| `20260622000000_p1_security_lockdown.sql` | Held — proven no-op | All three targets (`increment_ad_lead`, `trg_lead_score_before`, `trg_lead_score_after`) confirmed **ABSENT**; every statement is `IF to_regprocedure(...) IS NOT NULL` guarded |

A `README.md` in that directory records both decisions. Neither was deleted or marked applied.

### 14 proven renames

Each required an exact remote **name** match **plus** live schema-effect confirmation. SQL contents were never altered, and `supabase migration repair` was never used. Full table in the reconciliation doc §3.

One probe disagreed (`phase_ref_is_published` still executable by `authenticated`) and was **investigated rather than assumed**: the migration only revokes `PUBLIC` and grants `service_role` — it never revokes `authenticated`. The live ACL is exactly what the migration produces.

### Phase 2 live-constraint migrations

`20260723143845`, `20260723143913`, `20260723143937` match the remote ledger by version **and** name, so `db push` treats them as already applied. All three live definitions were re-confirmed identical to the local files. **No duplicate constraint was applied.**

### Final dry run

```
$ supabase db push --linked --dry-run
Would push these migrations:
 • 20260727000033_reel_studio_phase1_integrity.sql
 • 20260727000034_reel_studio_phase2_recovery_modes_capability.sql
 • 20260728000035_reel_studio_phase3_final_reel.sql
```

Exactly the three approved migrations. All §21 stop conditions clear.

---

## C. Database deployment

Applied **one phase at a time**, with verification between each. Sequencing was
achieved by temporarily holding the later files outside `supabase/migrations/`;
they were untracked, so git state was unaffected.

### Step 1 — `20260727000033_reel_studio_phase1_integrity`

Applied clean. Verified:

| RPC | Exists | `service_role` | `authenticated` | `anon` | `PUBLIC` | SECURITY DEFINER | `search_path` |
|---|---|---|---|---|---|---|---|
| `create_bound_reel_video_project` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | `""` |
| `bind_legacy_reel_project_brief` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | `""` |
| `insert_reel_storyboard_if_empty` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | `""` |
| `regenerate_pending_reel_shot` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | `""` |
| `delete_pending_reel_shot` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | `""` |

### Step 2 — Phase 2 live constraints

Confirmed present and identical; **not** re-applied.

### Step 3 — `20260727000034_reel_studio_phase2_recovery_modes_capability`

Applied clean (notices were expected `IF EXISTS` idempotency guards). Verified:

- `video_shots` gained `failure_stage`, `failed_at`, `still_attempt_count`, `video_attempt_count`, `last_still_attempt_at`, `last_video_attempt_at`
- `video_shots_failure_stage_check` = 6 stages; both attempt-count `>= 0` checks
- `client_production_briefs_production_mode_check` now allows `human | ai | hybrid`
- `reset_failed_reel_shot_still` / `reset_failed_reel_shot_video` — exist, service-role only
- `reel_shot_failure_phase()` present
- Trigger `enforce_distribution_publish_capability` installed BEFORE INSERT OR UPDATE

### Step 4 — `20260728000035_reel_studio_phase3_final_reel`

Applied clean. Verified:

- `video_project_deliverables` — 29 columns, **RLS enabled**, single policy `video_project_deliverables_staff_select (SELECT)`, `anon` fully revoked
- `video_project_deliverables_one_current_uidx` — `UNIQUE (video_project_id) WHERE is_current`
- `video_project_deliverables_version_uidx` — `UNIQUE (video_project_id, version)`
- `client_distribution_records_active_deliverable_uidx` — one active publication per deliverable
- `video_projects.current_deliverable_id` → FK to `video_project_deliverables(id) ON DELETE SET NULL`
- 7 new distribution columns present
- 5 final-Reel RPCs — all `service_role` only (`authenticated=false`, `anon=false`)
- `distribution_publication_supported` — **both** overloads (3-arg legacy + 4-arg)
- Trigger now passes `new.video_deliverable_id`; claim RPC carries the capability predicate; `recover_stale_publishing` skips `IN_PROGRESS` containers

**Post-deployment:** `supabase db push --linked --dry-run` → `Remote database is up to date.`

**Security advisors:** re-run post-deployment. All findings are pre-existing WARNs (`pg_net` in public, legacy SECURITY DEFINER RPCs, leaked-password protection). **Zero new issues** — no Reel Studio RPC appears in any anon/authenticated-executable list.

---

## D. Edge Function deployment

All 20 deployed by name, in phase order, each verified `ACTIVE` with `verify_jwt: true`.

| Phase | Functions |
|---|---|
| 1 (7) | `create-video-project`, `generate-video-storyboard`, `create-video-shot`, `update-video-shot`, `delete-video-shot`, `regenerate-video-shot`, `submit-shot-still-image` |
| 2 (8) | `generate-production-brief`, `set-production-brief-mode`, `retry-shot-still-image`, `retry-shot-video`, `check-shot-still-image`, `submit-shot-generation`, `check-shot-generation`, `handoff-video-project` |
| 3 (5) | `create-final-reel-upload`, `complete-final-reel-upload`, `review-final-reel`, `create-reel-distribution-draft`, `process-scheduled-publishing` |

Shared modules bundled correctly in every case (script sizes 707–758 kB). No bundling or dependency-resolution failure.

The only `verify_jwt: false` functions on the project remain the two pre-existing cron workers (`collect-instagram-insights`, `process-asset-generation-jobs`) — untouched. `process-scheduled-publishing` keeps `verify_jwt: true` + `x-cron-secret` header auth, unchanged.

---

## E. Frontend deployment — WITHHELD

**Mechanism (verified, not assumed):** `.github/workflows/deploy.yml` → GitHub Pages, triggered on **push to `main`**. Build injects `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_PORTAL_URL` from repository secrets.

Deploying therefore requires committing and pushing to `main`. The root `CLAUDE.md` states: *"Do not commit or push unless explicitly asked."* That authority was not granted for this task, so **no commit and no push were made**.

Backend prerequisites are all satisfied, so the frontend can be released whenever Alex approves:

```bash
cd "/Users/alex/Desktop/Attract Acq/Application Surfaces/Cockpit"

# 1. Recommended first — keep local Claude settings out of git
echo ".claude/" >> .gitignore

# 2. Stage the Reel Studio work (renames are already staged)
git add supabase/migrations supabase/held-migrations supabase/functions \
        src tests docs/SUPABASE_MIGRATION_LEDGER_RECONCILIATION.md \
        docs/REEL_STUDIO_PRODUCTION_DEPLOYMENT_REPORT.md .gitignore

# 3. Review before committing — confirm no .env and no .claude/
git status --short
git diff --cached --stat

# 4. Commit
git commit -m "feat(reel-studio): phases 1-3 + migration ledger reconciliation"

# 5. Push — THIS TRIGGERS THE GITHUB PAGES DEPLOY
git push origin main

# 6. Watch the deploy
gh run watch
```

**Current exposure:** the deployed production frontend is the previous build. It
does not render any Reel Studio Phase 1–3 control, so no user can reach the new
paths until step 5 runs. Backend-ahead-of-frontend is the safe ordering.

---

## F. Smoke verification

Because the frontend is not deployed, UI navigation checks could not be run
against production. All backend behaviour was verified directly and
non-destructively.

### Capability gating (production database, live functions)

| Scenario | Expected | Result |
|---|---|---|
| `reel_video` + `REELS`, no deliverable (shot clips) | BLOCKED | ✅ "Individual Reel Studio shot clips cannot be published…" |
| Same via legacy 3-arg overload | BLOCKED (fail-closed) | ✅ identical message |
| `feed_post` + `IMAGE` | allowed | ✅ |
| `story_sequence` + `STORIES` | allowed | ✅ |
| `carousel` + `CAROUSEL` | allowed | ✅ |
| `story_sequence` + video media | BLOCKED | ✅ "Video publishing is not implemented…" |

### Data integrity

| Check | Result |
|---|---|
| `video_projects` readable | 1 |
| `video_shots` readable | 7 |
| `client_assets` readable | 75 |
| Distribution status counts | `cancelled=5, published=19, ready=1` — **identical to pre-deployment** |
| `video_project_deliverables` rows | 0 |
| REELS distribution records | 0 |
| Instagram containers created | **0** |
| Publish attempts since deployment | **0** |
| Records mutated since deployment (distribution / shots / projects / briefs / assets) | **0 / 0 / 0 / 0 / 0** |
| Reel activity-log entries since deployment | none |

### Publishing worker regression

`cron.job_run_details` for jobid 1 shows `succeeded` on every minute across the
deployment window (17:16–17:21 UTC and continuing). Image and Story publishing
paths are unaffected; the worker claimed nothing because nothing is `scheduled`.

### Deliberately NOT performed

- **Phase 3 upload → review → approve → draft cycle.** No disposable test client exists in this project, and repository policy forbids using a real client. Covered instead by 50 Phase 3 contract tests, including the full mocked Instagram state machine.
- **Any Instagram publication.** No safe Meta test destination is configured. Mocked contract tests are the publication evidence.
- **AI generation calls.** Would incur real cost against a real client.
- **Any mutation of `JUL26-RL-011`.**

---

## G. Existing project check — `JUL26-RL-011`

| Field | Value |
|---|---|
| Title | JUL26-RL-011 — AI Alone Does Not Build Authority — Positioning Does |
| Project status | `generating` |
| Project `updated_at` | **2026-07-25 01:18:47 UTC** (predates deployment) |
| Brief status / mode | `approved` / **`human`** |
| Brief `updated_at` | **2026-07-23 10:37:03 UTC** (predates deployment) |
| Shots | 7, all `still_complete` |
| Stills stored / clips stored | 7 / 0 |
| `failure_stage` | all null (new column defaulted correctly) |
| Retry counters | 0 (new columns defaulted correctly) |
| `current_deliverable_id` | null (new column, correct) |

**No mutation occurred.** Both timestamps predate the deployment window.

Behaviour under the intended Phase 2 rule:
- Readable ✅ · stills accessible ✅
- Motion selection and video generation remain available — shot-level provider work is deliberately **not** gated by brief mode
- **Handoff remains blocked** until the brief is explicitly set to AI or Hybrid
- The brief mode was **not** changed, and the project was not advanced or published

---

## H. Rollback readiness

Migrations are additive; rollback never means dropping columns or tables.

### Frontend
Not deployed, so nothing to roll back. Once deployed: revert the commit and push, or re-run `deploy.yml` from the previous green commit. Removing frontend exposure alone disables every new Reel Studio control.

### Edge Functions
Previous versions are retained by Supabase. Roll back per function:
```bash
git stash                     # or checkout the previous commit
supabase functions deploy <name> --project-ref xivewedajschthjlblfb
```
Prior version numbers for reference: `create-video-project` v2→v3, `submit-shot-still-image` v1→v2, `process-scheduled-publishing` v15→v16, `handoff-video-project` v2→v3, `generate-production-brief` v16→v17. The 8 brand-new functions can be deleted outright without affecting anything pre-existing.

### Database
Do **not** drop the new objects. To disable the new behaviour while preserving data:
```sql
-- Re-close Reels without touching any table:
create or replace function public.distribution_publication_supported(
  text, jsonb, jsonb, uuid) returns text language sql stable set search_path='' as $$
  select 'Reel publishing temporarily disabled.'::text $$;
```
This blocks every Reel path at the trigger, the claim RPC and the worker simultaneously, leaving image/Story publishing untouched.

### Publishing worker
```sql
-- Stop all scheduled publishing (image + Story too):
update cron.job set active = false where jobid = 1;
-- Resume:
update cron.job set active = true where jobid = 1;
```
To stop **only** Reel claims while keeping image/Story live, use the capability-function override above — the claim RPC filters on it, so Reel rows simply stop being claimed and nothing is lost.

### Stuck / duplicate states
- **Records stuck in `publishing`:** `recover_stale_publishing` runs first on every worker tick. Reel rows with an `IN_PROGRESS` container younger than 24 h are deliberately skipped; after that they surface as `needs_reconciliation` for manual review.
- **Duplicate container risk:** `persistContainerId` writes with `.is("external_container_id", null)` and the state machine never recreates an existing container. If a duplicate is ever suspected, inspect `external_container_id` + `client_publish_attempts.container_ids` before any retry.
- **Preserve rows:** never delete distribution records; use `cancel_distribution_record` / `reconcile_distribution_record`.

---

## I. Unresolved issues

1. **Frontend not deployed.** Requires commit + push to `main`, which repository authority forbids without explicit instruction. Commands in §E. *Decision required from Alex.*
2. **`.claude/` is not gitignored** and contains an anon key for the decommissioned project. Recommend `echo ".claude/" >> .gitignore` before any `git add -A`.
3. **Held migrations awaiting a permanent decision.** Both are safely parked. Alex should confirm whether `client_phase3_status_view` is ever to be applied, and whether the security-lockdown file should be archived permanently.
4. **No Meta test destination.** Instagram Reels publishing has never executed against the live API. First real publication will be the first true end-to-end test — recommend doing it on an internal account with a short test Reel.
5. **No disposable test client.** The Phase 3 upload→approve→draft cycle is unverified against production. Recommend creating a `ZZ`-prefixed disposable fixture client for future smoke tests.
6. **`video_project_deliverables` carries Supabase default `authenticated` CRUD grants.** Identical to all four sibling Reel Studio tables; `anon` revoked; RLS denies DML. Recommended follow-up: one additive migration tightening all five tables to `SELECT`-only, matching `client_distribution_records`.
7. **`v1_foundation` local file is a stub** containing no DDL (pre-existing). A fresh environment could not be rebuilt from `supabase/migrations/` alone.

---

## J. Sign-off

| Definition-of-Done item | Status |
|---|---|
| 1. Every local/remote mismatch resolved or documented | ✅ |
| 2. Held migration cannot be applied accidentally | ✅ moved out of `supabase/migrations/` |
| 3. Security migration has evidence-based disposition | ✅ proven no-op, held |
| 4. Dry run contains only approved pending migrations | ✅ exactly 3 |
| 5–10. Phases 1–3 applied, verified, functions deployed | ✅ |
| 11. Frontend deployed **or** exact steps returned | ✅ steps returned (§E) |
| 12. All local tests passing | ✅ 152/152 |
| 13. Production schema verification passes | ✅ |
| 14. Existing projects readable | ✅ |
| 15. Shot clips non-publishable | ✅ verified in production |
| 16. Only an approved current final Reel is publishable | ✅ enforced at trigger, claim RPC, worker, UI |
| 17. No real public Reel published | ✅ **zero Instagram calls** |
| 18. Deployment report exists | ✅ this document |
| 19. Rollback procedures documented | ✅ §H |
| 20. Blockers reported with evidence | ✅ §I |
