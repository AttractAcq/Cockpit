# Held migrations

Migrations in this directory are **deliberately not applied** to the production
Supabase project (`xivewedajschthjlblfb`) and are **excluded from
`supabase db push`** by living outside `supabase/migrations/`.

They are kept — never deleted — so their intent and SQL remain auditable. Nothing
here may be moved back into `supabase/migrations/` without an explicit decision
recorded in `docs/SUPABASE_MIGRATION_LEDGER_RECONCILIATION.md`.

Moved here on 2026-07-28 during the Reel Studio production deployment, because
leaving them in the active directory meant `supabase db push` would have applied
them unintentionally.

---

## `20260717000018_client_phase3_status_view.sql` — HELD BY AUTHOR INSTRUCTION

The file's own header states:

> HELD FOR REVIEW — do not apply in this increment.

**Evidence it is correctly unapplied:**

- The remote migration ledger has **no** entry for this migration.
- Live introspection confirms `public.client_phase3_status_v` **does not exist**.

**Evidence that holding it is safe for the application:**

`src/lib/api.ts` → `fetchPhase3StatusMap()` queries `client_phase3_status_v` and,
when the view is missing, falls back to deriving Phase 3 status from
`organic_master` / `story_master` / `ads_master` / `calendar_cells` /
`client_phase3_scoped_runs`. The missing-view case is detected by
`src/lib/phase3-status-view.ts` → `isMissingPhase3StatusViewError()` (Postgres
`42P01`, PostgREST `PGRST205`) and is covered by
`scripts/test-phase3-status-view.mjs`. The fallback is the behaviour running in
production today.

**Reel Studio dependency:** none. No Reel Studio migration, Edge Function or UI
path references this view.

**To apply it later (deliberate action only):** move the file back into
`supabase/migrations/`, re-run `supabase db push --linked --dry-run`, confirm it
is the only unexpected addition, and record the decision in the reconciliation
document. Do **not** renumber it to a newer version.

---

## `20260622000000_p1_security_lockdown.sql` — PROVEN NO-OP FOR THIS PROJECT

Hardening for three legacy functions from the retired entities/campaigns-era
architecture: `increment_ad_lead(uuid, date)`, `trg_lead_score_before()` and
`trg_lead_score_after()`.

**Evidence it is a no-op here (live introspection, 2026-07-28):**

| Target | `to_regprocedure(...)` |
|---|---|
| `public.increment_ad_lead(uuid,date)` | **ABSENT** |
| `public.trg_lead_score_before()` | **ABSENT** |
| `public.trg_lead_score_after()` | **ABSENT** |

Every statement in the migration is wrapped in
`DO $$ BEGIN IF pg_catalog.to_regprocedure(...) IS NOT NULL THEN ... END IF; END $$;`,
so with all three targets absent it performs **no** action. The file's own header
already records that "the production object was absent by July 2026".

It has **no** remote ledger entry, and the objects it hardens belong to the
architecture that the root `CLAUDE.md` marks as fully superseded — they will not
reappear in this project.

**Why held rather than applied:** applying it would add a ledger entry for a
migration that provably changes nothing, and would keep an unapproved migration in
the `db push` set. Holding it keeps the pending set to exactly the three Reel
Studio migrations.

**Why held rather than repaired:** it was never applied, so marking it applied via
`supabase migration repair` would assert a false history. Nothing was repaired.

**If it must ever run** (e.g. against an older environment that still has those
functions), move it back into `supabase/migrations/` for that environment only.
