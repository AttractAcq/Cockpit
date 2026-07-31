# Archive manifest

Every archived item, the evidence that it is unused, and how to restore it.

Archived during the **pre-Stage-A repository readiness audit** on **2026-07-31**.
Full context: [`docs/PRE_STAGE_A_REPOSITORY_READINESS_REPORT.md`](../docs/PRE_STAGE_A_REPOSITORY_READINESS_REPORT.md).

---

## Edge Functions — retired entities/campaigns/MRR-era architecture

All seven belong to the architecture that root `CLAUDE.md` §9 lists under
"Do Not Use As Authority" (*the old entities/campaigns/MRR/ZAR-era Cockpit
architecture*). All were last modified **2026-06-21**, before the Client
Context OS rebuild.

### Shared evidence

| Check | Result |
|---|---|
| Deployed to `xivewedajschthjlblfb`? | **No** — absent from `supabase functions list` |
| `functions.invoke(...)` from `src/`? | **None** — verified by extracting every invoked name in `src/` and intersecting |
| Read by any script, test or workflow? | **None** — `git grep -l "functions/<name>" -- scripts tests .github supabase/functions/_shared` returned nothing |
| Backing database tables | **Dropped** — `entities`, `campaigns`, `conversations`, `messages`, `briefs`, `assets`, `deposits`, `payments`, `leads` do not exist in `public` (live introspection) |
| Cron / `pg_cron` jobs | None reference them |
| Required by migration chain? | No. The one SQL mention (`lead-score` in the **held** `20260622000000_p1_security_lockdown.sql`) names a database grant, not a file path, and that migration is deliberately unapplied |

Remaining references are **documentation only** (`README.md`,
`docs/EDGE_FUNCTIONS_REFERENCE.md`, `docs/GATE_VALIDATION_REPORT.md`,
`docs/reconciliation-report.md` — itself already marked deprecated,
`docs/PHASE_3_COCKPIT_WIRING_PLAN.md`, `docs/PREFLIGHT_READINESS.md`,
`docs/VAULT_SECRET_RECONCILIATION.md`, `docs/LEAD_SCORE_FIX_REPORT.md`). Those
are historical records and remain accurate about the past; they are intentionally
left in place for traceability rather than rewritten.

### Items

| Original path | Archive path | Last commit | Classification | Reason | Replacement |
|---|---|---|---|---|---|
| `supabase/functions/aicos-act` | `archive/edge-functions/aicos-act` | `a20d6e1` (2026-06-21) | Superseded application code | Agent-action dispatcher for the retired agent/entity model | No direct replacement; agent behaviour now lives in the Client Context OS phase functions |
| `supabase/functions/audit-log` | `archive/edge-functions/audit-log` | `a20d6e1` (2026-06-21) | Superseded application code | Wrote to the retired audit model | `public.activity_log`, written directly by current RPCs |
| `supabase/functions/campaign-flag` | `archive/edge-functions/campaign-flag` | `a20d6e1` (2026-06-21) | Superseded application code | Flagged rows in the dropped `campaigns` table | None — paid campaigns are out of scope until the Ads/Paid programme stage |
| `supabase/functions/client-portal-sync` | `archive/edge-functions/client-portal-sync` | `a20d6e1` (2026-06-21) | Superseded application code | Synced the retired portal entity model | None currently |
| `supabase/functions/dialog360-webhook` | `archive/edge-functions/dialog360-webhook` | `a20d6e1` (2026-06-21) | Superseded application code | 360dialog inbound webhook writing to dropped `conversations`/`messages`; also called the archived `aicos-act` | None — WhatsApp is not part of the current distribution surface |
| `supabase/functions/lead-score` | `archive/edge-functions/lead-score` | `891e2ea` (2026-06-21) | Superseded application code | Scored rows in the dropped `leads` table | None — scoring now applies to content performance, not leads |
| `supabase/functions/proof-capture` | `archive/edge-functions/proof-capture` | `a20d6e1` (2026-06-21) | Superseded application code | Captured proof into the retired entity model | `client_context_files` file 04 (Proof Bank), authored through Phase 1 |

**Migration / deployment implications:** none. None were deployed, so no
production endpoint disappears. `archive/` is outside `supabase/functions/`, so
`supabase functions deploy` cannot reach them.

**Restoration:** `git mv archive/edge-functions/<name> supabase/functions/<name>`,
then deploy explicitly if ever required.

---

---

## Application code — retired Money page

Archived **2026-07-31** during Stage A readiness blocker remediation.

| Original path | Archive path | Last commit | Classification |
|---|---|---|---|
| `src/pages/MoneyPage.tsx` | `archive/application-code/MoneyPage.tsx` | see `git log --follow` | Superseded application code |

**Evidence of non-use:**

- **Not routed.** `src/App.tsx` registers eight routes (login, cockpit, clients, client detail, website, website client detail, operations, settings). `MoneyPage` is not among them and the router has no lazy or dynamic registration.
- **Nothing imports it** — reverse-import search across `src/` returned no importer.
- Its only server call was `invokeFn("mrr-calc", {})`; `mrr-calc` is undeployed and the MRR-era tables it depended on no longer exist.
- Its child components (`KPIGrid`, `RevenueChart`, `ClientBreakdown`) are imported **only** by this page and by `src/components/money/index.ts`.

**Replacement:** none inside Cockpit. Financial reporting is out of scope for the current architecture; no active Xero integration or routed financial surface was touched.

**Guard:** `tests/stage-a-readiness.test.ts` asserts that `App.tsx` does not reference `MoneyPage`, that it is absent from `src/pages/`, and that it is present in the archive.

**Restoration:** `git mv archive/application-code/MoneyPage.tsx src/pages/MoneyPage.tsx`, then re-register a route.

---

## Retired Edge Functions — final call sites removed

These seven remain under `supabase/functions/` (they are **not** archived) but are
**undeployed**, and as of **2026-07-31** nothing in active source invokes them.
Their backing tables — `entities`, `campaigns`, `conversations`, `messages`,
`briefs`, `leads` — no longer exist, so the code paths were already failing.

| Function | Former API wrapper (`src/lib/api.ts`) | Former UI caller | Call-site removal |
|---|---|---|---|
| `dialog360-send` | `conversations.send` | `ConversationThread.tsx`, `EntityDetail.tsx` | wrapper deleted; both callers now throw an explicit retirement error |
| `meta-ad-ops` | `campaigns.create`, `campaigns.pause` | *(none — already unreferenced)* | wrappers deleted |
| `brief-generator` | `briefs.generate` | `AssetGrid.tsx` | wrapper deleted; caller throws |
| `mjr-generate` | `mjr.generate` (whole object) | `AssetGrid.tsx` | wrapper deleted; caller throws |
| `apify-scrape` | `operations.runScrape` | `AgentControlPanel.tsx` | wrapper deleted; caller throws |
| `onboarding` | `onboarding.start` (whole section) | `PipelineBoard.tsx` | wrapper deleted; caller throws |
| `mrr-calc` | *(none — called directly)* | `MoneyPage.tsx` | page archived (above) |

**Why the callers throw rather than being deleted:** every one lives in an
unrouted legacy component tree (`conversations/`, `studio/`, `operations/`,
`pipeline/`, `clients/`). Deleting those trees is legacy retirement — Stage P
work — and was explicitly out of scope. An explicit error keeps the code
compiling and honest: the button no longer pretends to do something.

**Guard:** `tests/stage-a-readiness.test.ts` asserts no `invokeFn`/`functions.invoke`
call to any of the seven, and that the `mjr`, `runScrape` and `onboarding`
wrappers are gone.

**Not archived** because they are still under `supabase/functions/`, where a
future decision could deploy or retire them deliberately. Retiring the wider
legacy surface belongs to Programme Stage P — End-to-End Hardening and Legacy
Retirement.

---

## Considered and held back — **not** archived

Recorded so the same investigation is not repeated, and so nothing here is
mistaken for an oversight.

| Item | Why it was NOT archived |
|---|---|
| `supabase/functions/meta-webhook` | **Proven live dependency.** `scripts/test-meta-webhook-deprecation.mjs` reads `supabase/functions/meta-webhook/index.ts` directly; archiving it breaks that script. The function is deliberately *deprecated in place* (its lead counter is disabled), which is a different state from unused. |
| `supabase/functions/payfast-create-link`, `payfast-webhook`, `_shared/payfast.ts` | **In-flight programme work**, not dead code. A PayFast deposit-gate migration is already applied and the remaining work (vault secrets, tiers, UI, retainer) is outstanding. `docs/payfast-itn-spec.md` is the governing spec. Archiving would misrepresent live work as retired. |
| `apify-scrape`, `brief-generator`, `dialog360-send`, `meta-ad-ops`, `mjr-generate`, `mrr-calc`, `onboarding` | **Live call sites exist** in `src/lib/api.ts` (and `src/pages/MoneyPage.tsx` for `mrr-calc`). Removing them requires editing an active 3,500-line file, not a file move. See the readiness report § "Legacy frontend surface" — this is scoped Stage A refactor work, deliberately not started here. |
| `src/pages/MoneyPage.tsx` and the legacy `entities`/`campaigns`/`studio`/`pipeline` components | Same reason: unreferenced by the router, but removal is code surgery with build risk, and belongs to a scoped refactor rather than a readiness pass. |
| `supabase/held-migrations/*` | Deliberately held, already outside the active migration path, and governed by its own README. Held migrations must **never** be moved into `archive/`. |
| `docs/*` historical reports | Still useful for traceability. Archiving documentation to make the repository look smaller is explicitly not an objective. |
