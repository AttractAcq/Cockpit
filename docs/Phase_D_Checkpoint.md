# Phase D Checkpoint

Checkpoint date: 2026-07-05

## Current architecture

Context Inputs → Phase 1 Context Files → Phase 2 Execution Files → Phase 3 Masters + Calendar.

The stages remain deliberately separate:

- Phase 1 converts saved client inputs into 21 reviewable Context Files.
- Phase 2 converts approved Context Files into 11 canonical Execution Files.
- Phase 3 uses approved Context Files and all 11 approved Execution Files to generate Organic, Story and Ads master rows plus deterministic Calendar Cells.

## Completed stages

- Context Inputs editor, persistence, local input-patch workflow and placeholder safety.
- Phase 1 split-file generation and Context File review/edit/approval.
- Phase 2 split-file generation for the 11 canonical Execution Files and their review workflow.
- Phase 3 bounded generation for row-level masters and deterministic calendar linking.
- Client UI separation between Execution Files, Masters and Calendar.

## Current generated counts

Client 001, execution month `2026-07`:

- `client_context_files`: 21 approved files.
- `client_execution_files`: 11 approved files.
- `organic_master`: 32 rows (`needs_review`).
- `story_master`: 28 rows (`needs_review`).
- `ads_master`: 4 rows (`needs_review`).
- `calendar_cells`: 115 rows (`needs_review`).

The July calendar count is deterministic: 32 organic dates + 28 story dates + 55 inclusive ad-range dates. Other months derive their calendar count from their month length and canonical ad ranges.

## Deployment checkpoint

- `generate-phase-2`: version 17.
- `generate-phase-3`: version 6.
- `validate-execution-pack`: version 9.

No schema migration is part of this checkpoint.

## Known caveats

- ESLint is declared by the package script but is not currently installed, so lint cannot run until the tooling dependency is restored.
- Phase 3 generation is bounded and retryable, but model format or proof-integrity failures can require retrying an individual section.
- Phase 3 completion is derived from master/calendar counts and review states because there is no `stage3_status` database column.
- Calendar storage supports date, slot/type, reference and review state. Dedicated distribution-time and destination columns are not currently present.
- Proof validation is client-specific and should not globally block legitimate, verified proof for future clients. Future proof policy must distinguish verified client evidence from invented claims.
- The complete Phase 3 run was verified through the authenticated function contract after the local Cockpit auth session expired. The local Cockpit UI Phase 3 run flow should be verified after the auth session is restored.

## Next recommended phase

Phase F: Stage 3 review workflow. Focus on reviewing, editing and approving Organic, Story and Ads master rows and validating the linked Calendar before any downstream production or publishing work.
