# Archive

Material that is no longer part of the running Cockpit system but is kept for
traceability. Nothing here is deleted, and nothing here is deployed.

**This directory is not part of any build, deploy or migration path.** It is
excluded from `supabase db push` (it is outside `supabase/migrations/`), from
`supabase functions deploy` (it is outside `supabase/functions/`), and from the
Vite build (it is outside `src/`).

## Rules

- Move with `git mv` so history is preserved and `git log --follow` still works.
- Every item must have a row in [`manifest.md`](./manifest.md) recording the
  evidence that it is unused, its replacement, and the searches performed.
- Never archive something merely because its name looks old. Archive only when
  the complete caller graph is proven absent — including `functions.invoke`,
  cron, database triggers, webhooks, GitHub Actions, scripts, tests and docs.
- Never archive a migration that the canonical Supabase migration chain still
  requires. Deliberately unapplied migrations live in
  `supabase/held-migrations/`, **not** here.
- Restoration is always possible: `git mv archive/<path> <original path>`.

## What is deliberately *not* archived

See `manifest.md` § "Considered and held back" for material that looks dead but
has a proven live dependency, or that belongs to later programme stages.
