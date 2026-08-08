# Programme Stage J — Reel Studio Completion

**Status: backbone implemented and deployed, live-verified against real database constraints with disposable fixtures. Scope deliberately reduced from the full stage prompt — see "Deferred" below, which includes two of Stage J's own named acceptance criteria that this pass could not honestly satisfy.**
Date: 2026-08-08 · Project `xivewedajschthjlblfb`

## What this stage builds on

Reel Studio's Phases A–D (schema, two-step Higgsfield generation loop, orchestration/UI, handoff+telemetry) were already complete, plus a substantial, previously-undocumented **"Phase 3" final-Reel system** discovered during the context scan for this stage: `video_project_deliverables`, `create-final-reel-upload`/`complete-final-reel-upload`/`review-final-reel`/`create-reel-distribution-draft`, and the authoritative `_shared/final-reel-contract.ts` (`resolveReelPublicationEligibility`, `summariseShotPackage`, upload/review/replacement contracts). This already implements real chunks of what Stage J's prompt asks for: the **human-editor handoff package** (`summariseShotPackage`), the **final deliverable review** lifecycle, and the **distribution draft** path — all explicitly named in Stage J's own "Preserve" list. This stage does not touch or duplicate any of it; it builds the missing pieces alongside it.

## Scope actually implemented (the "backbone")

### Schema — migration `20260808180000_stage_j_reel_studio_completion.sql` (applied live)
- `video_projects.production_strategy` — which of the 5 Stage J strategies (`proof_editorial`, `motion_explainer`, `cinematic_ai`, `footage`, `hybrid`) a project follows.
- `client_reel_styles` — the per-client Reel style system (motion presets, typography, evidence treatment, caption system, intro/outro, sound system), with at most one default per client (partial unique index). **Seeded one "AA Reel Style" default row for the real Attract Acquisition client** — confirmed present after migration.
- `video_projects.reel_style_id` — links a project to its style.
- `video_shots` gains a source-asset path: `shot_source_kind` (`ai_generated`/`source_asset`, default `ai_generated`), `source_storage_bucket`/`source_storage_path`/`source_mime_type`/`source_original_filename`/`source_description`. A CHECK constraint enforces that a `source_asset` shot always carries a real storage reference — live-verified to reject a source_asset shot with no bucket/path.
- `video_composition_contracts` — the structured timeline/voice/audio/captions/CTA/render-mode contract, one per project (unique constraint), `rendered_deliverable_id` linking to the existing `video_project_deliverables` once uploaded and approved through the existing Phase 3 system.
- All additive; no existing column, constraint, or RLS policy touched. `ADD CONSTRAINT` calls wrapped in the now-standard `DO $$ ... IF NOT EXISTS (SELECT ... pg_constraint) ...` defensive pattern.

### Strategy selection (`_shared/reel-production.ts`)
`selectReelProductionStrategy` — a deterministic decision table (never a model call) over proof-available / real-footage-available / client automation policy / quality requirement, with a documented, auditable precedence order and an explicit reason string. Deployed as `select-reel-production-strategy`, idempotent (replays the existing decision unless `confirm_override: true`), and attaches the client's default Reel style to the project on first selection.

### Render adapter (`checkRenderCapability`)
Names all four modes Stage J requires (`automated_template`, `provider_render`, `human_editor_handoff`, `manual_upload`). `human_editor_handoff` and `manual_upload` route onto the existing, live Phase 3 system — real, working paths. `automated_template` and `provider_render` are declared but **fail closed with an honest reason**, never silently accepted: there is no template-compositing engine or video-compositing provider integrated anywhere in this codebase, and Higgsfield produces individual shot clips, not a composited final Reel.

### Composition contract (`create-composition-contract`, `update-composition-contract`)
- Creation builds the timeline directly from the project's current shots (ordered by `shot_number`, using each shot's real duration where set), idempotent per project.
- Editing validates every field against the shared contract (`validateTimeline`, `validateVoiceTrack`, `validateAudioSpec`, `validateCaptionSpec`) before persisting.
- `draft -> ready` requires a non-empty, valid timeline, voice track, audio spec, and captions spec, plus a *supported* render mode (`checkRenderCapability`) — fails closed (409) for `automated_template`/`provider_render`. Duration-vs-target misalignment is surfaced as an advisory warning, not a hard block, matching the existing `reelSpecWarnings` "advisory, never blocks" convention.
- `ready -> rendered` requires linking an existing `video_project_deliverables` row that belongs to the same project and is already `approved` — this function never creates or approves a deliverable itself, it only records which one the contract's timeline produced. Live-verified end to end, including the negative case (a non-approved deliverable is rejected).

### Shot source assets (`create-shot-source-asset-upload`, `confirm-shot-source-asset-upload`)
Mirrors `create-final-reel-upload`/`complete-final-reel-upload`'s server-built-path, confirm-before-trust pattern: a signed upload URL is minted for a deterministic, client/project/shot-scoped path (browser never chooses bucket or path); confirmation verifies the object actually landed in storage before the shot is ever marked `shot_source_kind: 'source_asset'`. This is the mechanism Proof Editorial, Motion Explainer, Footage, and Hybrid strategies use to attach real screenshots, documents, and footage instead of an AI-generated still.

### Strategy integrity checks — the Stage J test list, made concrete
Rather than leave "Proof Editorial does not fabricate proof" etc. as untestable prose, each became a real, checkable pure function against the actual schema:
- `checkProofEditorialIntegrity` — every shot in a Proof Editorial project must be `shot_source_kind: 'source_asset'`; an AI-generated shot is a fabrication and fails the check by name (offending shot numbers returned).
- `checkMotionExplainerTextPreservation` — every required exact statistic/text must appear verbatim in at least one shot's `beat_description`; a paraphrase fails.
- `checkCinematicAiContinuity` — Cinematic AI and Hybrid projects require a project-level continuity plan (reusing the existing `continuity_plan` field from Reel Studio's earlier sequence-first storyboard work) before generation.
- `checkFootageSourceRightsPreserved` — every source-asset shot in a Footage or Hybrid project must carry a non-empty, operator-recorded rights/provenance note (`source_description`) — never inferred, an empty note is a fail.

### Frontend
- `src/types/reel-production.ts`, `src/lib/reel-production.ts` — full type contract and data-access layer.
- New `ReelProductionPanel.tsx`, rendered inside Reel Studio's existing `ProjectDetail` view: strategy selection form, composition contract creation/editing (render mode, voice source, loudness standard, captions), and the ready/rendered status progression.

### Live verification with disposable fixtures (no live HTTP call — see Deferred)
Built the exact chain the edge functions operate on directly via SQL: a `video_project` with `production_strategy: 'proof_editorial'` and the seeded AA style attached; two shots (one `source_asset` with a real storage reference and rights note, one `ai_generated`); confirmed the `source_asset` CHECK constraint rejects a source-asset shot with no storage reference; inserted a `video_composition_contracts` row using `create-composition-contract`'s exact shape; confirmed the one-contract-per-project unique constraint rejects a duplicate; walked the contract through `draft -> ready` (valid voice/audio/captions) and `ready -> rendered` (linked to a real, disposable, `approved` `video_project_deliverables` row) using `update-composition-contract`'s exact update shapes. All fixtures deleted afterward; a follow-up count query confirmed zero rows remain across `video_projects`, `video_shots`, `video_composition_contracts`, and `video_project_deliverables`.

### Tests
`tests/reel-production.test.ts` — 40 deterministic unit tests: strategy selection (all five precedence branches), render capability (all four modes), timeline validation and duration alignment, voice/audio/caption spec validation (including the consent-required and captions-cannot-be-enabled-with-no-timing rules), all four strategy integrity checks (pass and fail cases), and the shot source-asset filename/path helpers. Full suite: **873/873 pass**. `npm run typecheck`, `npm run build`, `npm run lint` all clean — same 4 pre-existing warnings (in files this stage didn't touch), zero new.

## Deferred, with precise reasons

- **Audio synthesis, voice cloning, AI narration, music selection/mixing** — `VoiceTrack`/`AudioSpec` are a real, validated data contract (including the consent-required gate for cloned voices) but nothing in this codebase calls a TTS, voice-cloning, or audio provider. No such provider is integrated anywhere in the repo today.
- **Automated-template and provider-based rendering** — `checkRenderCapability` names both modes as part of the contract but fails them closed with an honest reason. No video-compositing engine or provider exists in this codebase; building one is a substantial, separate integration this pass did not attempt rather than fake.
- **Caption *timing* generation** (word-level sync) — `CaptionSpec.timing_source` records whether timing is manual or auto-generated, but no auto-generation exists; `auto_generated` is accepted as a caller-declared value only.
- **"At least one AA Reel is produced by each required strategy" and "at least one external-client-style Reel is produced using real Proof" (Stage J's own acceptance criteria)** — **not met this pass.** Producing five real, finished Reels through live Higgsfield generation, plus a genuine external-editor-style Proof Editorial cut, requires real per-request cost and calendar time this environment cannot responsibly spend inside one implementation pass, and (as in every prior stage) this environment has no mintable operator JWT to drive the live HTTP path end to end. The mechanism to produce each strategy is real and live-verified at the data layer (strategy selection, source-asset attachment, composition contract, and the existing Phase 3 upload/review/distribution path all work against real constraints) — but no actual finished Reel exists yet for any strategy. This is a genuine gap against the stage's own acceptance criteria, not a soft one, and is flagged here rather than glossed over.
- **Storyboard quality gate, critique/repair, prompt compiler** — all explicitly in Stage J's "Preserve" list and already fully built in earlier Reel Studio work; untouched by this stage, not re-verified beyond confirming the existing test suite (which covers them extensively) still passes at 873/873.
- **Contract/DB/integration/UI test matrix in full, and a live HTTP-invocation smoke test** — same reasons and same environment constraint (no mintable operator JWT) documented in every prior stage's report.

## Confirmation against Stage J acceptance criteria

| Criterion | Status |
|---|---|
| A Content Item can move from approved Brief to finished Reel | Structurally true for the mechanism (strategy select -> shots -> composition contract -> existing Phase 3 upload/review/distribution), but **no Content Item has actually completed this path this pass** — see Deferred |
| At least one AA Reel is produced by each required strategy | **Not met.** No live generation was run this pass (cost + no mintable JWT) |
| At least one external-client-style Reel is produced using real Proof | **Not met.** Same reason |
| The final output can be reviewed, approved and distributed without a disconnected manual data process | Met — this is exactly what the pre-existing Phase 3 system (`video_project_deliverables`, `review-final-reel`, `create-reel-distribution-draft`) already does, confirmed untouched and still passing its own tests |
| Source project or render specification is retained | Met — the composition contract *is* the render specification, versioned per project, and `rendered_deliverable_id` retains which upload it produced |

**Exit gate ("Reel production is complete enough to support repeatable AA marketing and initial client fulfilment"): NOT fully met.** The routing, contract, and review/distribution mechanism is real, deployed, and live-verified at the data layer — but the exit gate asks for production readiness, and this pass produced the machinery without producing a single real Reel through it. The honest state: an operator can today select a strategy, attach real source assets or rely on the existing AI shot pipeline, build a composition contract, and hand it to the existing, working Phase 3 upload/review/distribution path — but nobody has done that yet for a real piece of content. Closing this gate requires either explicit sign-off to spend real Higgsfield generation cost and calendar time in a follow-up session, or an operator running the new UI against a real client_brief by hand.
