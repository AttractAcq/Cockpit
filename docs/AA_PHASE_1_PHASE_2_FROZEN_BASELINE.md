# AA Phase 1 and Phase 2 Frozen System Baseline

Status: binding architecture baseline

This document freezes the upstream authority architecture used by every
operational system in Cockpit. It supersedes conflicting Ideation assumptions.

## System flow

```text
Raw Client Inputs
    ↓
Phase 1
    ↓
Approved Context Files
    +
Approved Client-Specific Strategic Systems
    ↓
Phase 2
    ↓
Approved Execution Files
    ↓
Operational Systems
```

Operational systems include Ideation, Calendar planning, content creation,
stories, ads, sales enablement, distribution, reporting, performance
intelligence, iteration, and future execution systems.

Phase 1 and Phase 2 are upstream authority systems. Ideation is a read-only
authority consumer and may write only pre-commit Ideation records.

## Repository-backed storage model

The current repository persists all 21 Phase 1 documents in
`client_context_files`. Within that physical table there are two distinct
logical authority classes:

1. approved business Context Files;
2. approved client-specific strategic systems.

The strategic systems currently established by the Phase 1 manifest are:

- `06_Positioning_And_Angle_Map.md`
- `08_Profile_Funnel_Context.md`
- `09_Content_System.md`
- `10_Story_System.md`
- `11_Ad_System.md`
- `12_Website_And_Landing_Page_Context.md`
- `13_Distribution_System.md`
- `14_Automation_And_AI_Instructions.md`
- `19_Sales_Enablement_Assets.md`
- `20_Retention_Upsell_And_Expansion_Context.md`

This is a logical authority distinction over the existing physical storage. It
does not rename, move, regenerate, or modify Phase 1 records.

Phase 2 persists the 11 canonical, month-specific operating documents in
`client_execution_files`.

The repository does not show Phase 1 or Phase 2 reading from or writing to
`playbooks` or `playbook_runs`. Their broader intended domain is insufficiently
documented to prove safe generic reuse. They are therefore outside Ideation.

## Phase 1 — frozen

Phase 1 consumes raw `client_inputs`, validates the required business,
offer/service, and target-customer inputs, and creates the 21-file Client
Context OS through:

- `supabase/functions/generate-phase-1/index.ts`
- `supabase/functions/generate-phase-1-file/index.ts`
- `supabase/functions/finalize-phase-1/index.ts`

`generate-phase-1-file` writes draft/needs-review records to
`client_context_files`; it never approves them. `finalize-phase-1` verifies the
canonical set and updates Phase 1 completion state. Approval remains a separate,
human-controlled boundary.

Phase 1 owns the perpetual contextual and strategic foundation. Ideation must
not change Phase 1 code, client stage state, Context records, strategic-system
records, approval state, versions, or provenance.

## Context File responsibility

Context Files answer:

> What is true about this client and its business?

They contain approved facts, claims, proof, objections, customer language,
offers, positioning context, delivery model, founder identity, sales process,
assets, constraints, brand context, and competitive context.

They are versioned, attributable, approval-controlled business authority. They
are not techniques, prompts, candidates, disposable inputs, or run records.

## Client-specific strategic-system responsibility

The strategic systems answer:

> How should Attract Acquisition apply its methodology to this client?

They govern positioning, content, stories, ads, website conversion,
distribution, automation, sales enablement, and expansion logic. Although the
current implementation stores them among `client_context_files`, loaders and
snapshots must classify them separately as
`approved_strategic_playbook` authority.

They are not the seven Ideation techniques and cannot be seeded, overwritten,
renamed, or inferred from Ideation output.

## Phase 2 — frozen

Phase 2 consumes approved Phase 1 authority and produces the monthly operating
documents defined by:

- `supabase/functions/generate-phase-2/index.ts`
- `supabase/functions/_shared/execution-manifest.ts`
- `supabase/functions/validate-execution-pack/index.ts`

Each `EXECUTION_FILE_MANIFEST` definition declares the exact Phase 1
`contextFileNumbers` it consumes. Those selections include the client-specific
strategic systems where relevant.

Phase 2 writes only `client_execution_files` and its existing client/activity
state. Ideation must not change Phase 2 code, behavior, stage state, Execution
Files, approval state, versions, or provenance.

## Execution File responsibility

Execution Files answer:

> What must the system currently execute, and under what constraints?

They define current quantities, cadence, channel and format rules, campaign
priorities, messaging requirements, offers, timing, approval rules, exclusions,
governance, and period-specific operating requirements.

Approved Execution Files are trusted and binding. Downstream systems may not
bypass, contradict, rewrite, or infer replacements for them.

## Canonical authority hierarchy

All downstream generation follows this order:

1. System safety and application invariants
2. Approved Execution Files
3. Approved client-specific strategic systems
4. Approved business Context Files
5. Ideation technique logic
6. Internal or external research evidence
7. Generated candidate outputs

A technique cannot override strategic authority. Strategic authority cannot
invent facts absent from approved Context. Research cannot override approved
authority. Candidates are working output and have no governing authority.

## Ideation input contract

```text
Approved Context Files
    +
Approved Client-Specific Strategic Systems
    +
Approved Execution Files
    +
One Code-Owned Ideation Technique
    +
Technique-Specific Bounded Evidence
    ↓
Pre-Commit Candidate Ideas
```

The Ideation authority loader returns separate typed collections for Context,
strategic systems, and Execution. Configuration snapshots retain IDs, versions,
content hashes, authority classes, storage provenance, execution months,
technique-manifest version, and research references.

The seven Ideation techniques are research/discovery methods. Their immutable
manifest lives in code. Technique execution is persisted only in
`client_ideation_technique_runs`.

`playbooks` and `playbook_runs` are not used by Ideation.

## Data classifications

### A. Approved business authority

- approved business Context Files
- approved client-specific strategic systems
- approved Execution Files

### B. Research and evidence

- bounded internal evidence
- bounded external excerpts
- review, competitor, and market evidence
- retrieval and content-hash provenance

### C. Generated working output

- Ideation candidates and warnings
- future scores and proposed calendars
- draft briefs and assets

### D. Committed operational output

- `organic_master`
- Calendar records
- approved production briefs
- committed Story, Ads, and Distribution records

These classes must not be collapsed into one generic authority abstraction.

## Perpetual controlled-update lifecycle

```text
New Business Inputs or Evidence
    ↓
Proposed Context Update
    ↓
Review and Approval
    ↓
Strategic-System Review or Update
    ↓
Review and Approval
    ↓
Execution File Review or Update
    ↓
Operational Execution
    ↓
Performance and Market Signals
    ↓
Proposed Iteration
    ↓
Review and Approval
    ↓
Updated Authority
```

Every authority update is explicit, source-backed, versioned, attributable,
auditable, and approval-controlled. Operational output may propose a change but
may never silently make one.

## Prohibited architectural shortcuts

Do not:

- replace or bypass Phase 1 or Phase 2;
- represent techniques as strategic playbooks;
- seed techniques into `playbooks`;
- persist technique runs in `playbook_runs`;
- concatenate authority classes without provenance;
- treat approved Execution as untrusted text;
- make approved Context or strategic authority optional;
- let Ideation mutate approved authority or client phase state;
- let research or candidates become authority automatically;
- let Ideation-specific grants or RLS affect another playbook domain;
- write uncommitted candidates to downstream master or Calendar tables.

## Implementation guardrails

- `ApprovedClientAuthority` exposes `contextFiles`, `strategicPlaybooks`, and
  `executionFilesByMonth` separately.
- The configuration hash includes each authority class independently.
- The model prompt labels every authority class and enforces the canonical
  hierarchy.
- `IDEATION_TECHNIQUE_MANIFEST` is the single execution definition for the
  seven techniques.
- `client_ideation_technique_runs` is service-write-only and client-scoped for
  authenticated reads.
- Ideation RPCs validate exactly seven ordered technique snapshots.
- Research stores only bounded excerpts and attributed analysis.
- Candidates remain `draft` or `needs_review` and have no master reference,
  date, score, rank, approval, production, or render semantics.
- Architecture and integration tests verify that original playbook tables,
  Phase 1/2 state, approved authority, and downstream tables remain untouched.

## Future downstream systems

Calendar, creation, stories, ads, distribution, reporting, and iteration must
consume approved authority through the same hierarchy. Performance signals may
create proposed authority updates, but only the controlled review/approval
workflow may change perpetual business authority.
