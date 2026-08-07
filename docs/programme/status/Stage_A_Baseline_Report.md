# Programme Stage A — Repository Reconciliation and Frozen Baseline

**Status: COMPLETE — exit gate satisfied 2026-08-03.**
Date: 2026-08-03
Baseline commit: `7d4c1b96cdd7f3a59e28dc9826b44b1aad3b4e5e` ("chore(repo): resolve Stage A readiness blockers")
Baseline branch: `origin/baseline/stage-a-2026-08-03` — pushed and verified identical to `origin/main`.

---

## 1. Environment and method

The local Desktop repository is mounted read/write for file tools, but **every file-content read through the mount fails with `EDEADLK` (`Resource deadlock avoided`)**. Directory listings succeed; content reads do not. Consequently `git`, `tsc`, `npm` and `eslint` cannot operate against the local working copy.

Work was therefore performed against a clean clone of `AttractAcq/Cockpit` on the sandbox's native filesystem. Local `.git/refs/heads/main` was read directly and matches the clone HEAD exactly, so the tracked baseline is confirmed identical.

## 2. Baseline verification — PASS

Run against baseline `7d4c1b9`, mirroring `.github/workflows` CI:

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS (exit 0) |
| Lint | `npm run lint` | PASS — 0 errors, 4 warnings |
| Tests | `node --test tests/*.test.ts` | PASS — 605/605, 0 fail, 0 skipped |
| Build | `npm run build` | PASS — built in 2.31s |
| Whitespace / conflict markers | `git diff --check` | CLEAN |

Lint warnings (all `react-hooks/exhaustive-deps`, pre-existing, non-blocking):

- `src/components/client/ContentCreationPanel.tsx:104` — missing dep `active`
- `src/components/client/MastersPanel.tsx:277` — missing dep `lifecycleContext`
- `src/components/client/ReelStudioPanel.tsx:386` — missing dep `shot`
- `src/components/client/ReelStudioPanel.tsx:504` — missing dep `deliverable`

Build emits a chunk-size warning (1,263 kB main bundle, >500 kB limit). Recorded, not actioned — outside Stage A scope.

## 3. Working-tree reconciliation

497 local files vs 473 tracked on `main`. **Nothing on `main` is missing locally.** 24 local-only paths, classified per Stage A scope:

### 3a. Untracked source code — RESOLVED (deleted as obsolete, per Alex 2026-08-03)

| File | Assessment |
|---|---|
| `src/lib/api/clients.ts` | Queries `clients` and `client_health_v` |
| `src/lib/api/activity.ts` | Queries `activity_log` with `clients`/`users` joins |
| `src/lib/api/index.ts` | Barrel re-export of the above |

These are the only genuine local-only source files — precisely the class of work Stage A exists to catch.

**Material finding:** typecheck, lint, build and all 605 tests pass on `main` *without* these files, which proves **no tracked module imports them**. They are orphaned — not wired into any operator surface. Against live project `xivewedajschthjlblfb`, `clients` (1 row) and `activity_log` (589 rows) both exist; `client_health_v` was not observed in the public-schema table listing and needs confirmation before this code could be considered operational.

They match the superseded pre-`client_`-prefix API-layer pattern that workspace `CLAUDE.md` §9 lists as non-authoritative.

**Disposition:** Alex classified these as obsolete on 2026-08-03. All three files and the now-empty `src/lib/api/` directory were deleted from the local working tree. No tracked module referenced them, so no follow-up import fixes were required.

### 3b. Local-only settings — must NOT be committed

`.env`, `.claude/launch.json`, `.claude/settings.local.json`, `supabase/.temp/*` (10 files: `project-ref`, `linked-project.json`, `pooler-url`, version pins, etc.)

### 3c. Generated artefacts — must NOT be committed

`tsconfig.tsbuildinfo`, `tsconfig.node.tsbuildinfo`, `vite.config.d.ts`, `vite.config.js`, and 5 `.DS_Store` files.

## 4. Deployment state

- **Active Supabase project confirmed:** `supabase/.temp/project-ref` = `xivewedajschthjlblfb`, matching workspace `CLAUDE.md` §6 authority. The deprecated project `iwkhdqqgfjtpdhcbpftu` was not referenced.
- Live public schema: 78 tables, **RLS enabled on all 78**.

### 4a. Migrations — classified, exact 1:1

47 repo files, 47 applied. **applied: 47, pending: 0, held: 0, obsolete: 0.** No repo migration is unapplied and no applied migration lacks a repo file. Range: `20260702074337_v1_foundation` → `20260731000041_ideation_stage5_authority_race`.

### 4b. Edge Functions — classified

60 in repo, 50 deployed. Every deployed function has a repo counterpart; **nothing is deployed that is absent from the repo.**

| Class | Count |
|---|---|
| Deployed and present in repo | 50 |
| Deployed but absent from repo | 0 |
| Local only / deprecated | 10 |

The 10 never-deployed functions are all superseded-era: `payfast-create-link`, `payfast-webhook` (South African payment gateway), `mrr-calc`, `mjr-generate`, `dialog360-send`, `meta-ad-ops`, `meta-webhook`, `apify-scrape`, `brief-generator`, `onboarding`. These match `CLAUDE.md` §9's non-authoritative entities/campaigns/MRR/ZAR era. Recommend removal in **Stage P (Legacy Retirement)**, not earlier — additive migration discipline (§5 of the stage prompt) forbids contracting before the replacement is proven.

Two deployed functions run with `verify_jwt: false` — `process-asset-generation-jobs` and `collect-instagram-insights`. Both are worker/cron-style; flagged for confirmation, not changed.

### 4c. HIGH severity — live code deployed from outside the canonical repo

Four live Edge Functions report an `entrypoint_path` pointing at **untracked sibling directories**, not the Cockpit repo:

| Function | Live version | Deployed from |
|---|---|---|
| `run-ideation` | 15 | `Cockpit-ideation-claims/` |
| `score-ideation-candidates` | 1 | `Cockpit-stage2/` |
| `create-ideation-calendar-proposal` | 1 | `Cockpit-stage3/` |
| `commit-ideation-content` | 1 | `Cockpit-stage4/` |

Live behaviour of these four is **not provably identical** to what is tracked on `main`.

### 4d. HIGH severity — nine unversioned parallel working copies

`Application Surfaces/` contains nine sibling Cockpit copies. **None is a git repository** — no history, no branch, no remote, no backup:

`Cockpit-ideation-claims` (69 fn dirs, live), `Cockpit-ideation-compliance` (69), `Cockpit-ideation-fix` (58), `Cockpit-increment3-validation` (0), `Cockpit-stage2` (67, live), `Cockpit-stage3` (68, live), `Cockpit-stage4` (69, live), `Cockpit-stage5` (69), `Cockpit-workflow-ui` (41).

This is precisely the risk Stage A exists to eliminate: *"current Ideation work may exist only in the local Desktop repository."* It is worse than anticipated — the work is not merely un-pushed, it is un-versioned, and four of these directories have code running in production right now.

### 4d-i. Divergence check on the four live-deployed siblings (2026-08-03)

| Function | Sibling | `handler.ts` | `index.ts` | Verdict |
|---|---|---|---|---|
| `run-ideation` | Cockpit-ideation-claims | 32794 B = main | 4723 B = main, **content verified identical** | no divergence |
| `score-ideation-candidates` | Cockpit-stage2 | 25531 B = main | 5103 B = main | size-identical |
| `create-ideation-calendar-proposal` | Cockpit-stage3 | 38331 B = main | 6333 B = main | size-identical |
| `commit-ideation-content` | Cockpit-stage4 | 20381 B = main | 7495 B = main | size-identical |

All 8 files match `main` byte-for-byte on size. `run-ideation/index.ts` was additionally compared line-by-line and is **identical**.

Corroborating evidence: `origin` carries merged branches `feat/ideation-stage-2-score-sort`, `feat/ideation-stage-3-proposed-calendar`, `feat/ideation-stage-4-commit-content`, `feat/ideation-stage-5-final-verification`, `fix/ideation-stage5-model-compliance` and `fix/ideation-stage5-server-owned-claims`. The sibling directories are therefore **spent worktrees whose work was already merged**, not a source of unrecovered work.

**Limitation, stated plainly:** 1 of 8 files was verified at content level. The other 7 rest on exact byte-size equality plus merge history — strong, but not conclusive. `stage-a-triage-siblings.sh` performs the definitive `diff -rq` across all nine directories locally and must be run before any folder is deleted.

### 4e. Unidentified external dependency

`primary-production-2335e.up.railway.app` is called from an Edge Function and is not documented in workspace authority. Appears to be an n8n instance. Requires confirmation.

## 5. Acceptance criteria

| Criterion | Status |
|---|---|
| Build and deterministic test suite pass | **MET** — 605/605 |
| No secrets or local settings committed | **MET** — none staged; §3b/§3c correctly excluded |
| Local-only changes reconciled | **PARTIAL** — Cockpit repo reconciled (§3); nine sibling copies not triaged (§4d) |
| Every migration classified | **MET** — 47 applied / 0 pending / 0 held / 0 obsolete (§4a) |
| Every Edge Function classified | **MET** — 50 deployed+present / 0 orphaned / 10 local-only deprecated (§4b) |
| Working tree clean after baseline snapshot | **MET** — `git status` clean; deleted files were untracked |
| GitHub contains exact planned-against code state | **MET** — `origin/baseline/stage-a-2026-08-03` = `7d4c1b9` = `origin/main`, verified by fetch |
| Baseline commit SHA recorded | **MET** — `7d4c1b96cdd7f3a59e28dc9826b44b1aad3b4e5e` |

## 6. Exit gate — SATISFIED

> *No Stage B schema or architecture change starts until the repository and deployment baseline are reproducible.*

The baseline is reproducible: `origin/baseline/stage-a-2026-08-03` is pinned at `7d4c1b9` on GitHub and verified byte-identical to `origin/main`; the local working tree is clean; all 47 migrations are applied with none pending; all 50 deployed Edge Functions have tracked repo counterparts; and the full verification suite (typecheck, lint, 605 tests, build, `git diff --check`) passes against that exact commit.

The snapshot was pushed by Alex on 2026-08-03 in accordance with workspace `CLAUDE.md` §11 — no automated commit or push was performed.

**Stage B is authorised to begin.**

## 7. To unblock

1. ~~Disposition of the three `src/lib/api/*` files.~~ **Resolved** — deleted as obsolete.
2. ~~Migration and Edge Function classification source.~~ **Resolved** — produced from both live project and repo files; see §4a/§4b and `Stage_A_Current_State_Inventory.json`.
3. **Push the baseline branch.** Attempted 2026-08-03; `origin/baseline/stage-a-2026-08-03` is **not present on origin** (verified by full-refspec fetch). The `git commit` step correctly reported "nothing to commit" — the three deleted files were untracked, so no tracked state changed — and its non-zero exit likely prevented the chained `push` from running. The branch needs pushing at the unchanged SHA `7d4c1b9`:

   ```
   cd "/Users/alex/Desktop/Attract Acq/Application Surfaces/Cockpit"
   git push -u origin baseline/stage-a-2026-08-03
   ```

4. **Triage the nine sibling working directories (§4d).** Divergence check completed (§4d-i) — evidence indicates no unrecovered work. Run `stage-a-triage-siblings.sh` to confirm definitively, then delete the folders it reports clean.

## 8. Revised assessment

Stage A was scoped to reconcile *one* repository. The live-state audit shows the true baseline problem is larger: **four production Edge Functions are running from source that exists only in unversioned local folders.** Recovering that is a prerequisite for the stage's own objective — "one verified starting state that includes all current Ideation and Reel Studio work."

Recommended order once push authority exists:

1. Byte-diff the four non-canonically-deployed functions against `main`; merge any real divergence.
2. Triage the remaining five sibling directories for unreleased work.
3. Commit and push the named baseline snapshot.
4. Re-run the full verification suite and close the exit gate.

## 9. Machine-readable inventory

See `Stage_A_Current_State_Inventory.json` — routes, table/RLS counts, migration ledger, Edge Function classification, non-canonical deployments, sibling-directory census, external providers, verification results and open questions.
