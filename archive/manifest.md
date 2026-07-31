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
