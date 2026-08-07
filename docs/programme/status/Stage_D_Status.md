# Programme Stage D — Phase 2 Executable Contract

**Status: schema, migration files, contract, generators and tests COMPLETE. Extraction function and review UI OUTSTANDING.**
Date: 2026-08-03 · Project `xivewedajschthjlblfb`

## Verification

| Gate | Result |
|---|---|
| Typecheck | PASS |
| Lint | PASS — 0 errors, 4 pre-existing warnings |
| Tests | PASS — **662/662** (605 baseline + 12 B + 18 C + 27 D) |
| Build | PASS |
| `git diff --check` | CLEAN |
| Migration parity | **57 repo files = 57 database migrations** |

## Applied to production

| Version | Name |
|---|---|
| 20260803020738 | stage_d1_execution_configs |
| 20260803020749 | stage_d2_content_requirements_execution_link |
| 20260803020800 | stage_d3_calendar_slot_execution_attributes |

Two new tables (`client_execution_configs`, `client_execution_config_checks`), both with RLS and a client-scoped policy. Six additive columns on `content_requirements`, eleven on `calendar_slots`. **The 11 Execution files, monthly generation and all approval boundaries are untouched.**

## What is preserved

The Markdown remains human-readable authority. Stage D adds a structured twin plus the reconciliation proving the two agree — it does not replace the documents, and every Stage B column is unchanged, so requirements created before Stage D remain valid and readable.

## Fail-closed guarantees

- **Approval is impossible without passed reconciliation.** `client_execution_configs_approval_check` enforces at database level that `status = 'approved'` requires `reconciliation_status = 'passed'` *and* a human approver *and* a timestamp. Contradictory configuration cannot be approved even by a direct SQL write.
- **One approved config per client per month**, via partial unique index.
- **Slots are not operational until approval.** `calendar_slots.is_operational` defaults false; generation only sets it true when the owning config is approved. Until then a slot is planning scaffolding.
- **`approval_policy` never bypasses content approval.** Even `auto_on_policy` leaves approval owned by `content_items.status` (Stage B).
- **Slot identity** stays enforced by the existing `calendar_slots_unique (content_requirement_id, scheduled_for, slot_index)`; Stage D did not weaken it.

## Contract and generators

`src/types/execution-config.ts` holds the versioned config schema (all 17 declared areas), plus:

- `validateExecutionConfig` — internal consistency; objective mixes and preferred origins must sum to quantity, pillars and offers must be declared, capacity must not be exceeded, requirement identity must be unique.
- `reconcileWithExecutionFiles` — structured values against what the Markdown declares.
- `deriveContentRequirements` / `generateCalendarSlots` — deterministic, order-stable derivation. Same config in, byte-identical slots out.

## Tests — all seven Stage D requirements

| Requirement | Covered by |
|---|---|
| Quantities reconcile to slot counts | `quantitiesReconcileToSlots`, incl. shortfall detection |
| Required formats reconcile to Execution files | missing *and* unexpected formats both fail |
| No duplicate slot identity | incl. a 60-slot month proving index disambiguation on collision |
| Changed Execution version creates a new requirement set | v1 vs v2 differ and carry distinct `requirement_set_version` |
| Old requirements remain historically readable | prior set is not mutated when a new one is derived |
| Approval required before slots operational | unapproved config yields every slot `is_operational: false` |
| Invalid or contradictory config fails closed | 8 separate contradiction cases |

Leap-year period arithmetic is covered (Feb 2026 = 28 days, Feb 2028 = 29).

## Outstanding for the Stage D exit gate

1. Extraction/generation Edge Function that produces a config from approved Execution files and persists checks.
2. Review UI showing Markdown and structured values side by side, with approval linkage.
3. Adapting the current Ideation quantity contract to consume `content_requirements` (acceptance criterion 4) — legacy Phase 3 generation stays available as a compatibility path only.

**Exit gate: NOT yet satisfied.** The contract, guarantees and determinism are proven in tests, but no runtime writes to `client_execution_configs` yet, so Cockpit cannot *actually* answer "what must be produced for this client and period" against live data. Structurally complete, not operationally complete — same position as Stage C.
