# Pre-Stage-A Repository Readiness Report

**Date:** 2026-07-31
**Scope:** Repository reconciliation, deployment verification and controlled cleanup before Programme Stage A. No Stage A work was started.

---

## A. Executive result

```
NOT READY FOR STAGE A
```

The *repository, deployment and database* are in excellent shape: `main` is
authoritative, the live frontend is byte-identical to what `main` builds, the
migration ledger reports **"Remote database is up to date"**, and 594/594 tests
pass. Three material blockers remain, listed in § K.

The most significant is not a code defect: **the four programme documents that
define Stage A do not exist in this repository or anywhere in the workspace.**
Stage A entry conditions cannot be confirmed against a plan that cannot be read.

---

## B. Repository baseline

| | |
|---|---|
| Path | `/Users/alex/Desktop/Attract Acq/Application Surfaces/Cockpit` |
| Remote | `https://github.com/AttractAcq/Cockpit.git` (default branch `main`) |
| Branch | `main` |
| Starting HEAD | `a8181d3` |
| `origin/main` at start | `75e367f` (6 ahead of local, 0 behind) |
| Action | Fast-forward only — no merge commit, no rebase, no force |
| HEAD after fast-forward | `75e367f` |
| Final HEAD | see § I |
| Working tree at start | Clean except 4 untracked analysis docs |

**Other state recorded before any change:** 1 stash (`On feat/scheduled-publishing: local correct Cockpit Supabase link metadata`) — left untouched. **9 git worktrees** (Ideation Stage 1–5, workflow-UI, plus this one). No submodules.

**All 9 worktree branches are fully merged into `main` (0 commits ahead each).** The worktrees are stale scaffolding, not carriers of unmerged work — nothing was at risk, and none were removed.

---

## C. Local versus main reconciliation

Local was strictly **behind**, never diverged. `git merge-base --is-ancestor a8181d3 origin/main` confirmed all prior Reel Studio work is contained in `origin/main`, so a fast-forward was non-destructive.

| Item | Classification | Disposition |
|---|---|---|
| 6 commits on `origin/main` (Ideation Stage 3–5) | Intended completed work by another author | Fast-forwarded in |
| `docs/AA_IDEATION_REPOSITORY_AUDIT.md` | Untracked analysis doc | Left untracked (pre-existing) |
| `docs/AA_IDEATION_STAGE_0_RECONCILIATION.md` | Untracked analysis doc | Left untracked (pre-existing) |
| `docs/COCKPIT_REPOSITORY_STATE_ANALYSIS.md` | Untracked analysis doc | Left untracked (pre-existing) |
| `docs/REEL_STUDIO_STATE_ANALYSIS.md` | Untracked analysis doc | Left untracked (pre-existing) |
| `supabase/functions/node_modules/` (8.2 MB) | Generated — Deno artifact from container static checks | **Deleted** (gitignored, regenerable) |
| Stash `stash@{0}` | Unknown-intent local metadata | **Preserved untouched** |

The four untracked docs are deliberately left alone: they are prior analyses, they are not referenced by any build, and adopting or deleting them is an authoring decision, not a readiness one.

---

## D. GitHub and frontend deployment

| | |
|---|---|
| Workflows | `.github/workflows/deploy.yml` (push to `main` → Pages), `ci.yml` (PR → typecheck + build + `git diff --check`) |
| Node | 20, `npm ci`, cache `npm` |
| Env injection | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PORTAL_URL` |
| Repo secrets | All three present |
| Deployed commit | `75e367f` — identical to `origin/main` HEAD |
| Recent runs | 4 most recent all **success**; no failed or cancelled runs to explain |
| Live check | `https://attractacq.github.io/Cockpit/` → HTTP 200 |

**Strongest single piece of evidence:** the live bundle is `assets/index-cIPcRkIy.js`, and a local `npm run build` of the same commit produces **`index-cIPcRkIy.js`** — a byte-identical hash. The live frontend is provably the build of `main`, not a stale or unknown deployment.

The live bundle references **only** `xivewedajschthjlblfb.supabase.co`; zero occurrences of the decommissioned project.

**Note on `ci.yml`:** it does **not** run `npm run lint`. The broken lint script (§ G) has therefore never blocked CI, which is why it went unnoticed.

---

## E. Supabase reconciliation

| | |
|---|---|
| Linked project | `xivewedajschthjlblfb` (guard passed) |
| Migration files | 47 |
| Ledger rows | 47 |
| Unreconciled | **None** — zero local-only, zero remote-only |
| Dry run | **`Remote database is up to date.`** |
| Held migrations | 2, correctly outside `supabase/migrations/`, governed by their own README — **not** moved to `archive/` |
| Edge Functions | 60 local (after archive), 52 deployed |
| Deployed-but-missing-locally | **None** |
| Cron jobs | 2, both active, both targeting the correct project |

**Cron:** `publish-worker` (`* * * * *` → `process-scheduled-publishing`), `insights-worker` (`0 * * * *` → `collect-instagram-insights`). Both targets are deployed. The only `verify_jwt: false` functions remain the two documented cron workers plus `process-asset-generation-jobs`, matching `CLAUDE.md`.

**Grants:** all 21 Ideation RPCs added by Stage 3–5 are **service-role-only** (zero `anon`, zero `authenticated`). No grant regression was introduced by work landed while this audit's baseline was being established. `create_iteration_candidate` / `update_iteration_candidate_status` are `authenticated`-executable, but both pre-date this work and are already-known advisor warnings.

**No Supabase change was made during this task.** No migration applied, no function deployed, no secret altered.

---

## F. Archive actions

Created `archive/` with `README.md` and `manifest.md`. Seven Edge Functions moved with `git mv` (history preserved).

| Original | New | Reason | Replacement |
|---|---|---|---|
| `supabase/functions/aicos-act` | `archive/edge-functions/aicos-act` | Agent dispatcher for retired entity model | Client Context OS phase functions |
| `supabase/functions/audit-log` | `archive/edge-functions/audit-log` | Wrote retired audit model | `public.activity_log` |
| `supabase/functions/campaign-flag` | `archive/edge-functions/campaign-flag` | Flagged dropped `campaigns` table | None until Ads/Paid stage |
| `supabase/functions/client-portal-sync` | `archive/edge-functions/client-portal-sync` | Synced retired portal model | None |
| `supabase/functions/dialog360-webhook` | `archive/edge-functions/dialog360-webhook` | WhatsApp inbound → dropped `conversations`/`messages` | None |
| `supabase/functions/lead-score` | `archive/edge-functions/lead-score` | Scored dropped `leads` table | Content performance scoring |
| `supabase/functions/proof-capture` | `archive/edge-functions/proof-capture` | Proof into retired entity model | `client_context_files` file 04 |

**Evidence of non-use (all seven):** not deployed; zero `functions.invoke` from `src/` (verified by extracting every invoked name and intersecting, not by name matching); zero reads from `scripts`/`tests`/`.github`/`_shared`; backing tables `entities`, `campaigns`, `conversations`, `messages`, `briefs`, `assets`, `deposits`, `payments`, `leads` all **confirmed absent** from the live database; no cron reference. Last modified 2026-06-21 — the era `CLAUDE.md` §9 lists as non-authoritative.

Two residual textual hits were investigated and are **comments only**, not dependencies: `payfast-webhook/index.ts:116` mentions `audit-log` in prose, and the held migration line 30 mentions `lead-score` in a SQL comment.

**Deliberately held back** (full reasoning in `archive/manifest.md`): `meta-webhook` (a live script, `scripts/test-meta-webhook-deprecation.mjs`, reads its source — archiving would break it); PayFast (`payfast-create-link`, `payfast-webhook`, `_shared/payfast.ts` — in-flight work, not dead); the seven functions with live call sites (§ K); `MoneyPage.tsx` and legacy components (code surgery, not a file move); held migrations; historical docs.

---

## G. Repository hygiene

| Check | Result |
|---|---|
| Secrets in tracked files | **None.** Two `eyJ…` hits are synthetic fixtures in redaction tests (`commit-ideation-content-handler.test.ts`, `run-ideation-handler.test.ts`) that assert secrets *get* redacted |
| `.env` tracked | No — only `.env.example` |
| `.claude/` | Ignored (`.gitignore:25`), zero tracked files |
| Decommissioned project ref | **Zero** in tracked files and zero in the live bundle |
| Generated output | `dist/`, `node_modules/` ignored; stray `supabase/functions/node_modules/` removed |
| Lockfiles | Single `package-lock.json`; npm only. The two other "lock" matches are migrations named `*lockdown*` |
| Duplicate/conflicting package managers | None |
| **`npm run lint`** | **BROKEN** — script declared, `eslint` absent from `devDependencies` (`@types/node, @types/react, @types/react-dom, @vitejs/plugin-react, autoprefixer, postcss, tailwindcss, typescript, vite`) |

Dependencies were **not** added or upgraded. Installing ESLint across 462 files would introduce unreviewed churn and is not a readiness action.

---

## H. Verification

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass** |
| `npm run lint` | **FAIL — cannot execute** (`sh: eslint: command not found`) |
| `npm run build` | **Pass** (only the known >500 kB chunk warning) |
| `node --test tests/*.test.ts` | **594 / 594 pass**, 0 fail |
| `supabase db push --linked --dry-run` | **`Remote database is up to date.`** |
| `supabase migration list --linked` | 47 local = 47 remote, none unreconciled |
| `node scripts/check-supabase-project.mjs` | **Pass** |
| `git diff --check` | **Pass** |
| Archive-reference check | **Pass** — no active code reference to any archived path |
| Live frontend | **Pass** — bundle hash identical to local build of `main` |

`tests/` also holds 20 `.sql` and 10 `.sh` schema-validation scripts requiring a live database; these are not part of the deterministic Node suite and were not executed.

**Live smoke verification was not performed against authenticated production UI.** Read-only checks used instead: live bundle identity, project-ref check, cron state, grant introspection, migration ledger. No real client data was read or mutated; no disposable fixtures were created in this task.

---

## I. Changes made

| File | Change | Why |
|---|---|---|
| *(fast-forward)* | Local `main` `a8181d3` → `75e367f` | Adopt 6 Ideation Stage 3–5 commits already on `origin/main` |
| `supabase/functions/{7 dirs}` → `archive/edge-functions/` | Moved via `git mv` | Provably-dead retired-era functions (§ F) |
| `archive/README.md` | Created | Archive rules and restoration procedure |
| `archive/manifest.md` | Created | Per-item evidence, plus what was held back and why |
| `docs/PRE_STAGE_A_REPOSITORY_READINESS_REPORT.md` | Created | This report |
| `supabase/functions/node_modules/` | Deleted (untracked) | 8.2 MB Deno container artifact |

No application code, migration, workflow, test or configuration file was edited.

---

## J. Deferred items

Deliberately outside this readiness task:

1. **Legacy frontend surface removal** — `src/lib/api.ts` legacy sections and `src/pages/MoneyPage.tsx`. Requires editing an active 3,500-line file; a scoped refactor, not a readiness move.
2. **ESLint adoption** — a dependency and configuration decision.
3. **Documentation rewrite** — historical reports still describe archived functions accurately as past state; left intact for traceability.
4. **Worktree tidy-up** — 8 stale worktrees, all fully merged. Removal is a workspace-hygiene decision.
5. **Test-architecture review** — several suites assert on source strings rather than behaviour. Noted, not rewritten.
6. **Brand DNA geography** — the active `brand_prompt_blocks.mood_block` still carries South African trade context against EUR/Europe authority. Business decision, previously flagged.

---

## K. Stage A entry conditions

| Condition | Status |
|---|---|
| Correct repository confirmed | ✅ |
| Local vs `origin/main` understood and reconciled | ✅ |
| Intended completed work represented | ✅ |
| Working tree clean except documented items | ✅ |
| Baseline commit identified | ✅ `75e367f` + this readiness commit |
| GitHub `main` contains intended state | ✅ |
| Live frontend traceable to intended commit | ✅ identical bundle hash |
| Linked Supabase project correct | ✅ |
| Migration ledger reconciled | ✅ |
| No unexplained pending migration | ✅ |
| Active Edge Functions deployed | ✅ all 52 deployed have local source |
| Cron jobs known | ✅ 2, both correct |
| No secrets tracked | ✅ |
| No old project references | ✅ |
| Superseded files archived safely | ✅ 7, with manifest |
| No active reference to archived paths | ✅ |
| Typecheck / Build / Tests | ✅ / ✅ / ✅ 594-594 |
| Migration dry run clean | ✅ |
| Git diff clean | ✅ |
| **Lint passes** | ❌ **BLOCKER 1** |
| **Programme documents readable** | ❌ **BLOCKER 2** |
| **No live call site to an undeployed function** | ❌ **BLOCKER 3** |

### Blocker 1 — `npm run lint` cannot execute

`package.json` declares `"lint": "eslint . --ext ts,tsx …"` but ESLint is not a dependency. §16 requires lint to pass. CI never invoked it, so this was silent. **Resolution:** either add ESLint + a config and triage the findings, or remove the script and drop the lint requirement. Both are decisions, not fixes.

### Blocker 2 — Stage A programme documents are absent

`High_level_Cockpit_Audit_30_01_2026.md`, `Cockpit_Build_Plan.md`, `Cockpit_Build_Plan_Prompts_Rendered.md` and `phase_2_ai_build_plan.md` were searched for in the repository **and across the workspace** (`find` to depth 4, excluding `node_modules`/`.git`). **None exist.** There is also no `AGENTS.md` (the only match is inside a vendored package).

Stage A entry conditions cannot be confirmed against plans that cannot be read, and I will not infer a build programme from its title. **Resolution:** supply the four documents, or confirm they live outside this machine.

### Blocker 3 — Seven undeployed Edge Functions retain live call sites

`apify-scrape`, `brief-generator`, `dialog360-send`, `meta-ad-ops`, `mjr-generate`, `mrr-calc`, `onboarding` are invoked from `src/lib/api.ts` (and `src/pages/MoneyPage.tsx` for `mrr-calc`) but are **not deployed**. Their surrounding code also queries tables that no longer exist, so these paths already fail at runtime.

Severity is mitigated: `MoneyPage` is not routed (only 8 routes are registered), and the remaining call sites sit in legacy `api` sections whose tables are gone. But a live surface still holds calls to endpoints that do not exist. **Resolution:** the scoped removal in § J item 1.

---

## Restoring anything archived

```bash
git mv archive/edge-functions/<name> supabase/functions/<name>
```

History is preserved; `git log --follow` traverses the move.
