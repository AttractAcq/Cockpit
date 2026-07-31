# Cockpit Build Plan Prompts

**Repository:** `AttractAcq/Cockpit`  
**Companion authority:** `Cockpit_Build_Plan.md`  
**Prompt sequence:** Programme Stages A–P  
**Purpose:** One standalone, full-circle implementation prompt per Programme Stage.

> **Rendering note:** Each complete prompt is enclosed in a four-backtick fence. This allows ordinary three-backtick code examples to appear inside the prompt without breaking the Markdown document.

---

## How to use these prompts

Run the prompts in sequence from **Stage A** through **Stage P**. Each prompt is self-contained and instructs the operator to understand the repository, implement the assigned stage, integrate it with prior work, and verify the complete result.

---

# Programme Stage A Prompt — Repository Reconciliation and Frozen Baseline

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage A — Repository Reconciliation and Frozen Baseline** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

There is no earlier Programme Stage. Establish the verified baseline required for all later work.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage A requirements

## Objective

Create one verified starting state that includes all current local Ideation and Reel Studio work before architecture migration begins.

## Why this stage is first

The GitHub audit is based on pushed `main`, while current Ideation work may exist only in the local Desktop repository.

No reliable build plan can be executed against an uncertain baseline.

## Scope

### Repository state

- Inspect the local working tree.
- Identify all tracked modifications and untracked files.
- Separate:
  - Ideation work
  - Reel Studio work
  - Documentation
  - Migrations
  - Unrelated experiments
  - Local-only settings
- Confirm the active Supabase project.
- Confirm deployed versus local Edge Functions.
- Confirm frontend deployment commit.
- Create a named audit snapshot branch or commit.
- Push the snapshot to GitHub.

### Baseline verification

Run:

- Typecheck
- Build
- Lint
- Full deterministic tests
- Migration dry run
- Supabase project guard
- Secret scan
- Git diff check

### Current-state inventory

Produce a machine-readable inventory of:

- Frontend routes and client tabs
- Database tables and views
- RPCs
- Edge Functions
- Cron jobs
- External-provider calls
- Production states
- Placeholder tabs
- Deprecated paths

## Required outputs

- One pushed baseline branch or commit
- Updated repository-state document
- Updated migration ledger
- Current test count and pass/fail record
- Current deployed-function list
- Current database-entity inventory
- Current local-only changes reconciled

## Acceptance criteria

- The working tree is clean after the baseline snapshot.
- GitHub contains the exact code state being planned against.
- No secrets or local settings are committed.
- Every migration is classified as:
  - applied
  - pending
  - held
  - obsolete
- Every Edge Function is classified as:
  - deployed and used
  - deployed but disconnected
  - local only
  - deprecated
- The build and deterministic test suite pass.
- The baseline commit SHA is recorded in this document or a linked implementation log.

## Exit gate

No Stage B schema or architecture change starts until the repository and deployment baseline are reproducible.

---

## Full-circle implementation instruction

Complete every part of Programme Stage A required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage A target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage A requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage A implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage A acceptance criterion
- Confirmation that the Stage A exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage B Prompt — Canonical Architecture and Data Spine

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage B — Canonical Architecture and Data Spine** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage B requirements

## Objective

Define and implement the shared domain model that every later feature must use.

## Scope

### Terminology

Lock the following vocabulary:

- Content Source
- Manual Idea
- Proof Item
- Research Candidate
- Performance Insight
- Content Opportunity
- Content Requirement
- Calendar Slot
- Content Item
- Content Brief
- Production Job
- Asset
- Distribution Record
- Performance Record
- Learning Proposal

### Canonical entities

Create additive schema for:

- `content_sources`
- `manual_ideas`
- `proof_items`
- `content_opportunities`
- `content_opportunity_sources`
- `content_requirements`
- `calendar_slots`
- `content_items`
- `content_item_sources`
- `content_item_proof`
- `content_briefs`
- `production_jobs`
- `content_performance`
- `learning_proposals`

Exact table names may change, but entity ownership may not.

### Ownership boundaries

Define:

- Which entity owns the scheduled date
- Which entity owns the format
- Which entity owns the source relationship
- Which entity owns production status
- Which entity owns approval
- Which entity owns distribution
- Which entity owns analytics
- Which entity owns authority provenance

### Status machines

Define allowed transitions for:

#### Content Opportunity

```text
draft
→ needs_review
→ shortlisted
→ selected
→ scheduled
→ produced

draft / needs_review / shortlisted
→ rejected

draft / needs_review / shortlisted
→ expired
```

#### Content Item

```text
planned
→ brief_pending
→ brief_review
→ production_ready
→ in_production
→ asset_review
→ approved
→ scheduled
→ published
→ analysed
→ iterated
```

Include:

- cancelled
- blocked
- failed
- archived

with explicit transition rules.

### Authority snapshot contract

Every Opportunity and Content Item must be able to reference:

- Context file IDs and versions
- Execution file IDs and versions
- Playbook versions
- Brand authority
- Offer authority
- Generation date
- Configuration hash

### Compatibility strategy

Define how the new entities initially project into:

- `organic_master`
- `story_master`
- `ads_master`
- Existing Calendar tables
- Existing Production Brief tables

No destructive migration occurs in this stage.

## Required outputs

- Architecture decision record
- Entity relationship diagram
- State-machine specification
- Additive database migrations
- Shared TypeScript types
- Read APIs
- Staff-only write RPCs
- Provenance contract
- Compatibility-adapter specification

## Tests

- Cross-client ownership isolation
- Invalid state transitions
- Duplicate source links
- Duplicate Calendar allocations
- Authority snapshot immutability
- RLS and role access
- Idempotent creation
- Compatibility projection integrity

## Acceptance criteria

- All new entities exist with RLS.
- Service-role-only writes are enforced where required.
- Existing production behaviour is unchanged.
- One test Content Source can be linked to one test Opportunity and one test Content Item.
- The new entities can coexist with legacy master records.
- The ownership of every important field is unambiguous.

## Exit gate

No new Manual Idea, Proof or Research commitment workflow may bypass the canonical entities.

---

## Full-circle implementation instruction

Complete every part of Programme Stage B required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage B target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage B requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage B implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage B acceptance criterion
- Confirmation that the Stage B exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage C Prompt — Phase 1 Intelligence Hardening

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage C — Phase 1 Intelligence Hardening** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage C requirements

## Objective

Make Phase 1 a complete, traceable client-intelligence system built from real client material, research and versioned AA methodology.

## Preserve

- 21-file structure
- Sequential generation
- Review and approval
- Phase 2 gating
- Missing-information disclosure
- Context versioning

## Scope

### Input ingestion

Build structured ingestion for:

- Client forms
- Uploaded documents
- Website pages
- Service pages
- Reviews
- Existing marketing
- Sales documents
- Offer documents
- Brand documents
- Competitor references
- Project and proof files

### Document processing

Create:

- File records
- Extracted text
- Structured metadata
- Chunking
- Source citations
- Content hashes
- Processing status
- Failed-file recovery

### Research layer

Add controlled research runs for:

- Business
- Market
- Competitors
- Customer language
- Category regulations where relevant
- Current market conditions where required

Research must retain:

- URL
- title
- publisher
- retrieval date
- quoted or paraphrased evidence
- confidence
- use restrictions

### Playbook authority

Implement versioned AA playbooks as active generation authority.

At minimum:

- Organic Playbook
- Ads Playbook
- Story Playbook
- Proof Playbook
- Offer Playbook
- CLOSER Website Playbook
- Lead Magnet Playbook
- Automation playbooks
- Content laws and prohibited-claim rules

Each Phase 1 generation must record:

- Playbook ID
- Playbook version
- Content hash
- Applied sections

### Context versus strategy separation

Preserve the existing 21-file output if operationally useful, but classify each file as:

- Business Context
- Client Strategic System
- Hybrid

Do not allow strategic conclusions to be presented as raw business facts.

### Conflict handling

Detect and surface:

- Contradictory uploaded documents
- Old versus current offers
- Deprecated pricing
- Conflicting positioning
- Unsupported results
- Missing evidence
- Region or currency conflicts

## Required outputs

- Ingestion pipeline
- Research run entities
- Playbook versioning
- Source citation model
- Updated Phase 1 generation functions
- Context-file provenance UI
- Conflict review UI
- Approval remains file-specific

## Tests

- Uploaded-file content reaches generation
- Unsupported claims fail or require review
- Changed playbook version changes the generation identity
- Stale playbook cannot silently replace locked authority
- Source citations remain traceable
- Conflicting inputs are surfaced
- Missing required information is not invented

## Acceptance criteria

- Phase 1 can generate from more than form fields.
- Every material Context claim is traceable to:
  - client input
  - uploaded source
  - research source
  - approved inference
- Playbook authority is versioned and recorded.
- Phase 2 still cannot run before all required Phase 1 files are approved.
- Existing approved client files are not silently invalidated.

## Exit gate

Phase 1 is complete when it reliably produces an approved and traceable client authority package suitable for repeated downstream execution.

---

## Full-circle implementation instruction

Complete every part of Programme Stage C required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage C target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage C requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage C implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage C acceptance criterion
- Confirmation that the Stage C exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage D Prompt — Phase 2 Executable Contract

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage D — Phase 2 Executable Contract** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage D requirements

## Objective

Convert Phase 2 from a document-only execution layer into both human-readable authority and machine-executable operating requirements.

## Preserve

- 11 Execution files
- Monthly generation
- Approval boundaries
- Proof and claim checks
- Existing dependencies on Phase 1

## Scope

### Structured execution configuration

Create a versioned configuration object containing:

- Content quantities
- Weekly and monthly cadence
- Required formats
- Organic versus paid mix
- Content pillars
- Required proof mix
- Funnel-stage mix
- Audience-stage mix
- Campaign objectives
- Offers
- Story cadence
- Approval rules
- Distribution rules
- Analytics requirements
- Automation policies
- Production capacity
- Client-specific restrictions

### Content requirements

Create `content_requirements` from approved Phase 2 authority.

Example:

```yaml
period: 2026-08
platform: instagram
format: reel
quantity: 12
cadence: weekly
objective_mix:
  authority: 4
  objection_handling: 3
  proof: 3
  offer: 2
preferred_origins:
  research: 4
  proof: 4
  manual: 2
  performance: 2
```

### Slot generation

Convert requirements into deterministic `calendar_slots`.

Each slot should define:

- Period
- Date or date range
- Platform
- Format
- Objective
- Content pillar
- Funnel stage
- Offer relationship
- Preferred source type
- Required proof strength
- Production constraints
- Approval policy

### Markdown and configuration reconciliation

The system must verify that the structured configuration does not contradict the approved Execution files.

## Required outputs

- Execution configuration schema
- Extraction or generation function
- Validation function
- Review UI showing Markdown and structured values
- Approval linkage
- Deterministic requirement and slot generation
- Version and content hash

## Tests

- Quantities reconcile to slot counts
- Required formats reconcile to Execution files
- No duplicate slot identity
- Changed Execution version creates a new requirement set
- Old requirements remain historically readable
- Approval is required before slots become operational
- Invalid or contradictory configuration fails closed

## Acceptance criteria

- Phase 2 produces both Markdown and structured authority.
- Cockpit can answer exactly what must be produced for a client and period without reparsing Markdown at every step.
- Open Calendar slots are generated deterministically.
- The current Ideation quantity contract is replaced or adapted to use this canonical structure.
- Existing legacy Phase 3 generation remains available only as a compatibility path.

## Exit gate

The system has a reliable demand-side representation for content planning.

---

## Full-circle implementation instruction

Complete every part of Programme Stage D required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage D target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage D requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage D implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage D acceptance criterion
- Confirmation that the Stage D exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage E Prompt — Unified Content Source Layer

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage E — Unified Content Source Layer** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C, D are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage E requirements

## Objective

Implement all four source streams through one source contract.

The primary streams are:

1. Manual Ideas
2. Proof Vault
3. Seven-Technique Research Ideation
4. Performance Insights

## E1. Manual Idea Entry

### UI

Create an Idea surface supporting:

- Raw Idea
- Notes
- Source URL or attachment
- Suggested client
- Optional format
- Optional campaign
- Optional date
- Optional Proof linkage

### Behaviour

- Save the raw Idea unchanged.
- Create a canonical Content Source.
- Generate possible client-specific Opportunities.
- Allow direct “Create content from this.”
- Allow save without generation.

## E2. Proof Vault

### Proof ingestion

Support:

- Review
- Testimonial
- Project
- Before-and-after
- Result
- Screenshot
- Customer message
- Certification
- Process evidence
- Founder experience
- Video
- Audio
- Document

### Proof extraction

Extract:

- What happened
- Who it happened for
- What changed
- Claims supported
- Specificity
- Date
- Service
- Objections answered
- Audience relevance
- Available media
- Consent
- Anonymisation
- Verification state

### Usage management

Track:

- Unused
- Used
- Repurposed
- Overused
- High-performing
- Restricted
- Expired
- Needs stronger evidence

## E3. Research Ideation Adapter

Preserve the existing seven-technique system.

Map:

```text
Ideation Candidate
→ canonical Content Source
→ Content Opportunity
```

Resolve the live grounding compatibility problem between Markdown authority and evidence spans.

Each of the seven techniques must have an explicit source strategy:

1. Persona
2. Review-Mined Pain Language
3. Competitor Objections
4. End-Customer Complaints
5. Live Objection Log
6. Trigger Event
7. Format Swipe

For each technique define:

- Required inputs
- External research method
- Evidence contract
- Freshness requirement
- Candidate contract
- Failure behaviour
- Cost limit

## E4. Performance Insight Adapter

Allow approved Performance Insights to create new sources such as:

- Re-edit
- Alternate hook
- Carousel conversion
- Story sequence
- Paid promotion
- Follow-up topic
- Proof reuse
- Offer variation

## Required outputs

- Shared source schema
- Source-type adapters
- Manual Idea UI
- Proof Vault UI
- Proof processing jobs
- Ideation candidate adapter
- Performance insight adapter
- Source search and filtering
- Source provenance view

## Tests

- Each source type creates the same canonical source identity.
- Sources cannot cross clients.
- Proof consent and restrictions are enforced.
- Research evidence remains attached.
- Duplicate source detection works.
- Failed processing can be retried.
- Raw source content remains immutable.

## Acceptance criteria

- Manual Ideas can enter Cockpit.
- Proof can be uploaded and structured.
- Research candidates create canonical sources.
- Performance Insights create canonical sources.
- Every source can be converted into one or more Content Opportunities.
- No source stream writes directly to the Calendar or production system.

## Exit gate

The supply side of content planning is complete.

---

## Full-circle implementation instruction

Complete every part of Programme Stage E required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage E target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage E requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage E implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage E acceptance criterion
- Confirmation that the Stage E exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage F Prompt — Content Opportunity Intelligence

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage F — Content Opportunity Intelligence** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C, D, E are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage F requirements

## Objective

Create one universal opportunity-generation, scoring and selection layer.

## Scope

### Opportunity generation

From every source, generate one or more possible Opportunities containing:

- Core Idea
- Core claim
- Hook direction
- Audience
- Pain or objection
- Belief before
- Belief after
- Objective
- Offer relationship
- Funnel stage
- Proof references
- Candidate formats
- Candidate channels
- CTA direction
- Visual potential
- Production requirements

### Hybrid Opportunities

Allow several sources to support one Opportunity.

Example:

```text
Manual Idea
+ real client review
+ market statistic
→ hybrid Content Opportunity
```

### Eligibility filters

Apply hard filters before scoring:

- Unsupported claim
- Missing consent
- Conflicting authority
- Inactive offer
- Duplicate recent content
- Unavailable required media
- Prohibited claim
- Wrong region
- Expired source
- Incompatible format
- Missing mandatory proof

### Scoring

Retain the strong deterministic patterns from Ideation scoring.

Use slot-independent scores such as:

- Strategic fit
- Audience relevance
- Proof strength
- Commercial relevance
- Novelty
- Timeliness
- Visual potential
- Production readiness

Do not treat one score as universally valid for every format or slot.

### Deduplication and clustering

Detect:

- Same Idea with different wording
- Same Proof used repeatedly
- Topic saturation
- Opportunity overlap
- Existing published equivalents

### Human control

Support:

- Shortlist
- Reject
- Save for later
- Merge
- Add Proof
- Request another angle
- Promote for Ads
- Select for planning

## Required outputs

- Opportunity generation contracts
- Universal scoring rubric
- Opportunity history
- Source-to-opportunity links
- Explainable score UI
- Deduplication
- Opportunity search
- Opportunity status workflow

## Tests

- Every score is server-calculated.
- Model-supplied overall score or rank is rejected.
- Authority drift fails closed.
- Hybrid source relationships remain valid.
- Duplicate Opportunities are detected.
- Re-scoring creates history rather than overwriting.
- Rejected Opportunities do not become Content Items.
- Unsupported claims are blocked.

## Acceptance criteria

- All source types appear in one Opportunity Pool.
- Scores are explainable.
- Opportunities can be manually selected.
- Opportunities remain advisory until selected.
- Existing Ideation scoring can be represented in or mapped into the universal scoring system.
- Opportunity history and provenance are immutable.

## Exit gate

Cockpit has one canonical supply pool from which Calendar planning can operate.

---

## Full-circle implementation instruction

Complete every part of Programme Stage F required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage F target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage F requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage F implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage F acceptance criterion
- Confirmation that the Stage F exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage G Prompt — Calendar Planning and Operational Commitment

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage G — Calendar Planning and Operational Commitment** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C, D, E, F are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage G requirements

## Objective

Match the best eligible Opportunities to Phase 2 Calendar Slots and commit selected work into operational Content Items.

## Scope

### Slot-specific matching

Calculate an Opportunity-to-Slot match score.

Dimensions may include:

- Objective match
- Format suitability
- Audience match
- Funnel-stage match
- Proof requirement
- Origin preference
- Campaign relevance
- Timeliness
- Production readiness
- Recent-content saturation
- Performance similarity

### Planning modes

#### Manual

The operator assigns an Opportunity to a Slot.

#### Assisted

Cockpit proposes a complete Calendar with rationale. The operator approves or edits it.

#### Automatic

Cockpit commits only where client policy permits and all thresholds pass.

Assisted mode is the default.

### Proposed Calendar

Preserve current Ideation proposal capabilities:

- Move
- Swap
- Remove
- Restore
- Conflict detection
- Rank visibility
- Score provenance
- Approval

Generalise the proposal so it can contain Opportunities from all source types.

### Operational Commitment

On approval:

- Create canonical Content Items.
- Bind exact Opportunity and Source IDs.
- Bind exact Phase 1 and Phase 2 authority.
- Bind the Calendar Slot.
- Generate compatibility records for current master and Calendar tables.
- Record idempotent commitment identity.
- Prevent duplicate commitment.

### Legacy compatibility

The current Organic, Story and Ads masters should remain downstream-compatible projections until Stage P.

## Required outputs

- Slot matching engine
- Assisted planning UI
- Manual assignment UI
- Generalised proposed Calendar
- Operational commitment RPCs
- Content Item creation
- Compatibility projections
- Conflict handling
- Commitment history

## Tests

- One Slot cannot be filled twice.
- One proposal cannot be committed twice.
- Manual assignment overrides recommendation without destroying provenance.
- Cross-client Opportunities cannot be assigned.
- Proposal edits remain deterministic and auditable.
- Slot quantities match Phase 2 requirements.
- Compatibility master rows reconcile exactly with Content Items.
- Failed commitment leaves no partial operational state.

## Acceptance criteria

- Manual Idea, Proof, Research and Performance Opportunities can all fill Slots.
- The operator can create content directly from a selected source.
- The operator can approve an automatically proposed week or month.
- Approved plans create canonical Content Items.
- Existing downstream production continues to work through compatibility records.
- Legacy full-month generation is no longer the primary planning path.

## Exit gate

Cockpit has one operational commitment path from Opportunity to Content Item.

---

## Full-circle implementation instruction

Complete every part of Programme Stage G required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage G target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage G requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage G implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage G acceptance criterion
- Confirmation that the Stage G exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage H Prompt — Content Item and Brief Migration

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage H — Content Item and Brief Migration** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C, D, E, F, G are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage H requirements

## Objective

Make the Content Item the canonical parent of all production, distribution and performance activity.

## Scope

### Content Item ownership

Move canonical ownership of:

- Date
- Platform
- Format
- Objective
- Status
- Opportunity
- Proof
- Campaign
- Offer
- Brief
- Production
- Approval
- Distribution
- Performance

to the Content Item.

### Structured Content Brief

Create a structured brief with:

- Objective
- Audience
- Platform
- Format
- Organic or paid
- Core Idea
- Core claim
- Hook
- Belief before
- Belief after
- Proof
- Narrative structure
- Copy or script requirements
- Visual direction
- Asset inputs
- Brand constraints
- CTA
- Approval rules
- Production mode
- Required outputs
- Quality checklist

Render the existing human-readable Markdown from this structured contract.

### Brief lifecycle

```text
pending
→ generated
→ review
→ approved
→ superseded
```

### Compatibility

Current master refs may remain, but every new brief must reference a Content Item.

Backfill historical records where practical.

## Required outputs

- Structured Content Brief schema
- Brief generation function
- Brief review UI
- Content Item detail UI
- Master-record compatibility adapter
- Historical backfill
- Updated downstream APIs

## Tests

- Brief authority snapshot is exact.
- Brief cannot reference the wrong client.
- Brief cannot be approved when mandatory Proof is missing.
- Re-generation creates a version.
- Master and Content Item references reconcile.
- Historical assets remain reachable.

## Acceptance criteria

- Every new production job starts from an approved Content Item Brief.
- One Content Item can create several format-specific derivative items only through explicit repurposing.
- Existing production workflows still function.
- The Brief is both machine-readable and human-reviewable.

## Exit gate

The canonical downstream content job is established.

---

## Full-circle implementation instruction

Complete every part of Programme Stage H required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage H target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage H requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage H implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage H acceptance criterion
- Confirmation that the Stage H exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage I Prompt — Shared Production Studio Framework

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage I — Shared Production Studio Framework** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C, D, E, F, G, H are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage I requirements

## Objective

Standardise all production formats around one shared production contract while preserving format-specific logic.

## Scope

### Format router

Route approved Briefs to:

- Reel Studio
- Carousel Studio
- Story Studio
- Feed Post Studio
- Ad Studio

### Shared production entities

Create or normalise:

- Production Project
- Production Job
- Scene, Slide or Frame
- Asset Requirement
- Generated Asset
- Source Asset
- Revision
- Review
- Deliverable

### Production modes

Support:

- Human
- AI
- Hybrid

### Asset plan

Every studio must classify required media:

- Existing client asset
- Proof asset
- Screenshot
- Document
- Stock
- Generated image
- Generated video
- Motion graphic
- Diagram
- Typography
- Voice-over
- Music
- Sound effect

### Provider abstraction

Implement provider adapters and capability registry.

### Quality control

Shared checks:

- Claim accuracy
- Proof accuracy
- Brand alignment
- Spelling
- Aspect ratio
- Platform safe area
- CTA
- Asset ownership
- Consent
- Generated-media disclosure where required

## Required outputs

- Shared production interfaces
- Common status model
- Provider adapter layer
- Asset-plan contract
- Studio router
- Shared review components
- Cost and usage records

## Tests

- Correct studio routing
- Unsupported provider capability fails cleanly
- Provider retries are idempotent
- Production costs are recorded
- Proof assets are not replaced by fabricated equivalents
- Cross-client asset isolation
- Revision history remains intact

## Acceptance criteria

- Carousel, Story and Feed production use the canonical Content Item and Brief.
- Existing asset generation remains functional.
- Format-specific studios share common production and review patterns.
- Providers can be changed without changing the Content Opportunity model.

## Exit gate

All non-Reel organic formats operate through the canonical production spine.

---

## Full-circle implementation instruction

Complete every part of Programme Stage I required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage I target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage I requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage I implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage I acceptance criterion
- Confirmation that the Stage I exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage J Prompt — Reel Studio Completion

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage J — Reel Studio Completion** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C, D, E, F, G, H, I are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage J requirements

## Objective

Turn Reel Studio into a complete, multi-path Reel production system that can create finished, publishable assets efficiently.

## Preserve

- Brief binding
- Story strategy
- Story spine
- Continuity plan
- Narrative roles
- Critique and repair
- Prompt compiler
- Still and clip generation
- Retry and recovery
- Final deliverable review
- Distribution draft

## Scope

### Reel production strategies

Support several strategies:

1. **Proof Editorial**
   - Screenshots
   - Reviews
   - Documents
   - Project footage
   - Animated evidence

2. **Motion Explainer**
   - Diagrams
   - Kinetic typography
   - Comparisons
   - Infographics

3. **Cinematic AI**
   - Generated stills
   - Image-to-video
   - Text-to-video inserts

4. **Founder or Client Footage**
   - Talking head
   - Interviews
   - Site footage
   - Screen recordings

5. **Hybrid**
   - Real evidence
   - Motion graphics
   - Selective AI-generated inserts

### Strategy selection

The Brief should determine the appropriate production strategy based on:

- Objective
- Proof available
- Real footage available
- Brand
- Cost
- Timeline
- Quality requirement
- Client automation policy

### Audio

Implement:

- Voice source
- Real voice
- Consent-based voice clone
- AI narrator
- Music
- Sound effects
- Loudness standard
- Caption timing

### Final assembly

Create a composition contract containing:

- Timeline
- Shot or scene order
- Duration
- Voice track
- Visual layers
- Captions
- Motion instructions
- Transitions
- Audio
- CTA frame

Support:

- External human-editor handoff
- Automated template rendering
- Provider-based rendering
- Final manual upload

### Storyboard quality gate

Preserve and enforce:

- No category below minimum
- Coherence
- Dependency
- Brand alignment
- Proof integrity
- Ending payoff
- Production feasibility

### Style systems

Create:

- AA Reel style
- Per-client Reel style configuration
- Motion presets
- Typography
- Evidence treatment
- Caption system
- Intro and outro
- Sound system

## Required outputs

- Reel strategy selector
- Extended structured storyboard
- Audio workflow
- Composition contract
- Render adapter
- Human-editor handoff package
- Final Reel deliverable
- Per-client style configuration
- Cost and generation controls

## Tests

- Every strategy can produce a complete test deliverable.
- Proof Editorial does not fabricate proof.
- Motion Explainer preserves exact statistics and text.
- Cinematic AI retains continuity.
- Human-footage path preserves source rights.
- Final duration and captions align.
- Failed render can be recovered.
- Final deliverable is the only Reel asset eligible for publishing.

## Acceptance criteria

- A Content Item can move from approved Brief to finished Reel.
- At least one AA Reel is produced by each required strategy.
- At least one external-client-style Reel is produced using real Proof.
- The final output can be reviewed, approved and distributed without a disconnected manual data process.
- Source project or render specification is retained.

## Exit gate

Reel production is complete enough to support repeatable AA marketing and initial client fulfilment.

---

## Full-circle implementation instruction

Complete every part of Programme Stage J required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage J target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage J requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage J implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage J acceptance criterion
- Confirmation that the Stage J exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage K Prompt — Organic Distribution Consolidation

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage K — Organic Distribution Consolidation** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C, D, E, F, G, H, I, J are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage K requirements

## Objective

Connect all organic publishing to canonical Content Items and complete Instagram-oriented distribution.

## Preserve

- Destination accounts
- Scheduling
- Immediate publishing
- Retry
- Reconciliation
- Publish attempts
- Async Reel containers
- Published evidence

## Scope

### Canonical linkage

Every Distribution Record must reference:

- Content Item
- Approved deliverable
- Client
- Platform
- Destination
- Caption version
- Scheduled time

### Format coverage

Complete:

- Feed image
- Carousel
- Story image
- Story video
- Reel

### Approval policy

Support per-client policies:

- Internal approval only
- Client approval required
- Auto-schedule after approval
- Manual publish
- Restricted dates
- Blackout periods

### Distribution metadata

Store:

- Caption
- Hashtags
- Thumbnail
- CTA
- Tracking URL
- Campaign reference
- Platform media ID
- Published URL
- Publish evidence

## Required outputs

- Updated Distribution schema
- Content Item linkage
- Video Story publishing
- Approval policy
- Distribution Calendar status
- Reconciliation tools
- Failure recovery

## Tests

- Unsupported media fails before provider call.
- Duplicate publication is blocked.
- Scheduled publication is idempotent.
- Reel shot clips cannot be published as final Reels.
- Wrong-client assets cannot publish.
- Reconciliation restores correct state.
- Platform IDs and URLs are captured.

## Acceptance criteria

- Every approved organic format can be scheduled and published.
- Calendar status reflects real distribution state.
- Published assets retain exact Content Item and source provenance.
- Distribution failures are visible and recoverable.

## Exit gate

The organic production loop is complete from source to publication.

---

## Full-circle implementation instruction

Complete every part of Programme Stage K required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage K target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage K requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage K implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage K acceptance criterion
- Confirmation that the Stage K exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage L Prompt — Ad Studio and Paid Distribution

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage L — Ad Studio and Paid Distribution** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C, D, E, F, G, H, I, J, K are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage L requirements

## Objective

Create a complete paid-advertising workflow using the same content spine as organic content.

## Scope

### Ad Opportunities

Allow Ad Opportunities to originate from:

- Manual Idea
- Proof
- Research
- Campaign requirement
- Organic winner
- Performance Insight
- Offer launch
- Seasonal trigger

### Ad Brief

Add:

- Campaign objective
- Awareness stage
- Audience
- Offer
- Landing page
- Primary claim
- Proof
- Hook variants
- Visual variants
- CTA variants
- Placement
- Testing role
- Budget policy
- Attribution requirements

### Creative matrix

Support:

```text
Hooks × Visuals × Copy × CTA × Format
```

with controlled variant counts and cost limits.

### Paid entities

Create or normalise:

- Campaign
- Ad Set
- Ad Creative
- Ad
- Audience
- Budget
- Placement
- Tracking
- Launch status

### Meta integration

Support:

- Draft creation
- Creative upload
- Campaign creation
- Ad-set creation
- Ad creation
- Launch
- Pause
- Resume
- Budget update
- Status reconciliation

### Safety and approval

Require explicit policy for:

- Spend limits
- Account ownership
- Payment method
- Geography
- Audience restrictions
- Client approval
- Claims
- Regulated categories

## Required outputs

- Ad Studio UI
- Ad Brief contract
- Variant generation
- Meta Marketing API integration
- Paid Distribution tab
- Campaign state machine
- Spend controls
- Conversion tracking linkage

## Tests

- No live spend without explicit approved policy.
- Duplicate campaign creation is blocked.
- Creative variants retain source provenance.
- Account ownership is validated.
- Unsupported claims fail.
- Budget cannot exceed configured limit.
- Pause and resume reconcile.
- Attribution identifiers persist.

## Acceptance criteria

- A Proof or Idea can produce an Ad Opportunity.
- The system can create approved ad variants.
- A campaign can be drafted and launched under policy.
- Spend and delivery metrics return to Cockpit.
- Organic winners can be promoted without recreating the source manually.

## Exit gate

Paid media is operational, controlled and connected to the same content intelligence system.

---

## Full-circle implementation instruction

Complete every part of Programme Stage L required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage L target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage L requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage L implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage L acceptance criterion
- Confirmation that the Stage L exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage M Prompt — Analytics and Closed-Loop Iteration

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage M — Analytics and Closed-Loop Iteration** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C, D, E, F, G, H, I, J, K, L are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage M requirements

## Objective

Connect platform results and commercial outcomes back to the exact Content Items, Opportunities, Proof and execution assumptions that produced them.

## Scope

### Canonical performance model

Track by Content Item:

#### Organic

- Reach
- Views
- Three-second views
- Hook retention
- Average watch time
- Completion
- Saves
- Shares
- Comments
- Profile visits
- Follows
- Conversations
- Qualified conversations

#### Paid

- Spend
- Impressions
- CPM
- Hook rate
- CTR
- CPC
- Landing-page views
- Leads
- Qualified leads
- Appointments
- Show-ups
- Cash collected
- CAC
- ROAS where valid

### Attribution

Link:

```text
Content Item
→ Distribution or Ad
→ Click or conversation
→ Lead
→ Appointment
→ Show-up
→ Cash collected
```

### Learning outputs

Generate:

- Performance Insight
- New Content Opportunity
- Re-edit recommendation
- Paid-promotion recommendation
- Proof priority update
- Slot-priority update
- Phase 2 update proposal
- Phase 1 update proposal

### Controlled authority updates

Maintain:

```text
Observed result
→ Insight
→ Recommendation
→ Proposed patch
→ Human review
→ Applied update
```

Do not allow one high- or low-performing asset to rewrite foundational authority automatically.

### Experimentation

Support:

- Hook comparison
- Format comparison
- Proof-category comparison
- CTA comparison
- Offer comparison
- Audience comparison
- Creative fatigue

## Required outputs

- Canonical performance records
- Attribution links
- Insight generation
- Opportunity adapter
- Execution update proposals
- Context update proposals
- Experiment views
- Performance dashboard

## Tests

- Metrics attach to the correct Content Item.
- Duplicate insight collection is idempotent.
- Missing attribution remains explicitly unknown.
- Paid and organic metrics are not conflated.
- Context updates require review.
- Performance-derived Opportunities preserve the original asset link.

## Acceptance criteria

- Cockpit can identify what worked and why.
- Performance Insights can generate new Opportunities.
- Phase 2 receives controlled proposals for future execution.
- Phase 1 receives controlled proposals only where business understanding has materially changed.
- The next Calendar can use past performance without blindly repeating it.

## Exit gate

The system has a closed learning loop.

---

## Full-circle implementation instruction

Complete every part of Programme Stage M required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage M target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage M requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage M implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage M acceptance criterion
- Confirmation that the Stage M exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage N Prompt — Automation and Fulfilment Orchestration

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage N — Automation and Fulfilment Orchestration** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C, D, E, F, G, H, I, J, K, L, M are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage N requirements

## Objective

Turn the validated system into an efficient, policy-driven fulfilment engine.

## Scope

### Automation policy

Create per-client policies for:

- Source processing
- Opportunity generation
- Scoring
- Weekly planning
- Proposal approval
- Brief generation
- Production start
- Human review
- Client review
- Scheduling
- Publishing
- Analytics collection
- Iteration generation
- Paid campaign actions

### Orchestrator

Build a workflow engine that can:

- Detect eligible next actions
- Claim work
- Execute
- Wait for external completion
- Retry
- Escalate
- Record cost
- Record activity
- Resume after interruption

### Automation levels

#### Manual

The operator starts each stage.

#### Assisted

Cockpit proposes and prepares; the operator approves.

#### Automatic

Cockpit executes within policy and thresholds.

### Capacity and cost controls

Include:

- Monthly generation budget
- Per-asset budget
- Provider credit budget
- Human-review capacity
- Maximum simultaneous jobs
- Client priority
- Due-date priority
- Retry cap

### Exception queue

Provide one place for:

- Failed jobs
- Missing approval
- Missing Proof
- Provider error
- Budget exceeded
- Invalid claim
- Distribution failure
- Attribution gap
- Stale workflow

## Required outputs

- Automation policy schema
- Workflow orchestrator
- Job queue
- Exception queue
- Cost controls
- Capacity scheduler
- Operator dashboard
- Activity records
- Recovery actions

## Tests

- Automatic jobs cannot bypass approval policy.
- Retry caps are enforced.
- Duplicate work is not created.
- Cost limits stop generation.
- Stale leases recover.
- Failed jobs enter the exception queue.
- Manual override remains possible.
- Cross-client capacity allocation is deterministic.

## Acceptance criteria

- A client can run in Manual, Assisted or Automatic mode.
- Repetitive fulfilment steps can execute without operator navigation through every tab.
- Every automated action is traceable and reversible where appropriate.
- Exceptions are visible.
- No automatic strategic update or paid spend occurs outside policy.

## Exit gate

Cockpit operates as a fulfilment system rather than only a collection of tools.

---

## Full-circle implementation instruction

Complete every part of Programme Stage N required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage N target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage N requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage N implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage N acceptance criterion
- Confirmation that the Stage N exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage O Prompt — Multi-Client Scale and Operational Control

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage O — Multi-Client Scale and Operational Control** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C, D, E, F, G, H, I, J, K, L, M, N are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage O requirements

## Objective

Ensure the complete system can operate across increasing client volume without losing quality, security, cost control or accountability.

## Scope

### Client isolation

Verify:

- RLS
- Storage paths
- Provider assets
- Analytics
- Ad accounts
- Team access
- Generated voices
- Brand kits
- Proof permissions

### Roles

Support:

- Admin
- Account Manager
- Strategist
- Content Operator
- Motion Designer or Editor
- Media Buyer
- Analyst
- Client Approver
- Read-only stakeholder

### Work allocation

Add:

- Assignee
- Due date
- Priority
- Capacity
- SLA
- Blocker
- Review owner

### Cost and margin

Track by client:

- Model spend
- Storage
- Rendering
- Human time
- Ad-management time
- Revision cost
- Fulfilment cost
- Gross margin estimate

### Observability

Create dashboards for:

- Workflow volume
- Failure rate
- Provider health
- Queue age
- Approval delays
- Cost
- Content output
- Publishing success
- Analytics freshness

### Templates and onboarding

Create:

- Client onboarding workflow
- Industry starter packs
- Proof schemas
- Brand configuration
- Default automation policies
- Default content requirements
- Default approval policies

## Required outputs

- Expanded role model
- Work allocation
- Capacity dashboard
- Cost dashboard
- Margin dashboard
- Provider monitoring
- Onboarding templates
- Client-level configuration packs

## Tests

- Role permissions
- Client isolation
- Cost aggregation
- Queue prioritisation
- Template instantiation
- Client offboarding
- Data export
- Account disconnection

## Acceptance criteria

- A new client can be onboarded through a repeatable workflow.
- Client assets and data remain isolated.
- AA can see fulfilment cost and capacity.
- Operators know what requires attention.
- The system can scale without relying on one person’s memory.

## Exit gate

Cockpit is operationally ready for repeatable multi-client fulfilment.

---

## Full-circle implementation instruction

Complete every part of Programme Stage O required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage O target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage O requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage O implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage O acceptance criterion
- Confirmation that the Stage O exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---

# Programme Stage P Prompt — End-to-End Hardening and Legacy Retirement

````text
You are operating inside Attract Acquisition’s `AttractAcq/Cockpit` repository and are responsible for implementing **Programme Stage P — End-to-End Hardening and Legacy Retirement** from the canonical Cockpit build programme.

This is an implementation task, not a speculative architecture exercise. First understand the actual repository, current deployed and local state, the Attract Acquisition business model, and how this stage fits into the complete Cockpit operating chain. Then implement the stage fully, integrate it with all preceding stages and existing systems, verify the result, and leave complete documentation and evidence.

## Cockpit architecture governing this work

Attract Acquisition Cockpit is the operating system through which Attract Acquisition understands, markets, distributes and continuously improves service businesses.

The application has three operating phases:

- **Application Phase 1 — Client Intelligence:** client facts and files, AA research and versioned AA playbooks become approved Business Context and approved Client Strategic Systems.
- **Application Phase 2 — Execution Intelligence:** approved Phase 1 authority plus current objectives, campaigns, capacity and channel requirements become approved monthly Execution Files and normalised machine-executable requirements.
- **Application Phase 3 — Continuous Content Operations:** Manual Ideas, Proof Vault items, seven-technique Research Ideation and Performance Insights become Content Opportunities; Opportunities are matched against required Calendar Slots; selected work becomes canonical Content Items and Content Briefs; format-specific studios produce assets; approved assets are distributed; analytics produce controlled learning and future Opportunities.

The canonical operating spine is:

```text
Authority
→ Sources
→ Content Opportunities
→ Content Requirements and Calendar Slots
→ Content Items
→ Content Briefs
→ Production
→ Assets
→ Distribution
→ Performance
→ Learning
→ Automation
```

Preserve the existing strengths of the repository, including Phase 1 and Phase 2 approval boundaries, authority versioning and snapshots, Ideation provenance and deterministic scoring, proposed-Calendar conflict handling, the current Production Brief and asset lifecycle, Reel Studio continuity and shot generation, organic distribution state machines, analytics snapshots, controlled Context updates, and existing idempotency, leases, retries and service-role-only RPC patterns.

Do not create a parallel lifecycle, a second source of truth, or a shortcut that bypasses Content Opportunities, Content Items or approved authority.

## Dependency position

Programme Stages A, B, C, D, E, F, G, H, I, J, K, L, M, N, O are prerequisites. Confirm their canonical outputs and contracts are present and preserve them. Do not redesign or bypass completed earlier stages. Where a prerequisite is genuinely absent, implement only the minimum safe prerequisite required, document the discrepancy and do not falsely mark this stage complete.

## Mandatory operating rules

1. **Begin with a context scan.** Confirm that the working directory is the `AttractAcq/Cockpit` repository. Read the root repository instructions, `Cockpit_Build_Plan.md`, `High_level_Cockpit_Audit_30_01_2026.md`, relevant architecture documents, migrations, shared types, API layer, Edge Functions, tests and UI surfaces related to this stage.
2. **Reconcile the actual repository state before editing.** Inspect the active branch, latest commit, tracked modifications, untracked files and current migration/function state. Preserve legitimate work already present. Never reset, delete, overwrite, clean, amend or force-checkout work merely because it was unexpected.
3. **Trace real callers and state transitions.** Do not assume a file, table, RPC, Edge Function or UI is operational merely because it exists. Identify actual reads, writes, callers, ownership boundaries and deployment dependencies.
4. **Implement the stage, not only analyse it.** Complete the database, backend, shared domain types, API/client layer, frontend, migration/backfill, compatibility adapters, tests and documentation required by the stage.
5. **Use additive migration discipline.** Expand, mirror, backfill, cut over and only then contract. Do not remove legacy paths before the replacement is proven and historical records remain readable.
6. **Preserve authority and provenance.** Every new output must retain the client, source, Context and Execution versions, model/provider/prompt identity where applicable, operator changes, approval state, distribution record and performance lineage.
7. **Preserve client isolation and least privilege.** Enforce ownership foreign keys, RLS, service-role-only mutation functions where appropriate, explicit grants, safe `search_path`, anti-spoofing validation and cross-client rejection.
8. **Make external and long-running work recoverable.** Use persistent statuses, idempotency, ownership or leases where necessary, retry caps, failure stages, last errors, cost metadata, provenance and explicit recovery actions.
9. **Keep production provider-neutral.** Domain contracts should request capabilities rather than encode one vendor as the architecture.
10. **Do not fabricate proof or silently mutate strategy.** Unsupported claims must fail closed. Context or Execution authority updates must remain controlled, versioned and reviewable.
11. **Do not leave partial integration.** A table without callers, an Edge Function without UI, a UI without backend, or a mocked path without an operational transition does not complete the stage.
12. **Avoid unforced errors.** Check naming, status enums, nullable fields, timestamps, indexes, uniqueness, transactions, pagination, concurrency, stale leases, retries, duplicate submissions, empty states, error states, accessibility, responsive behaviour and backwards compatibility.
13. **Do not commit, push, deploy or mutate a real client unless the current task and repository authority explicitly permit it.** Use disposable fixtures and safe test clients for destructive or provider-backed verification.

## Authoritative Stage P requirements

## Objective

Verify the complete system in production-like conditions, cut over from compatibility paths and retire obsolete architecture.

## Scope

### End-to-end golden paths

Test:

#### Manual Idea path

```text
Manual Idea
→ Opportunity
→ Slot
→ Content Item
→ Brief
→ Production
→ Approval
→ Publication
→ Analytics
→ Iteration
```

#### Proof path

```text
Proof Upload
→ Proof Item
→ Opportunity
→ Content Item
→ Reel and Carousel
→ Publication
→ Performance
→ Reuse
```

#### Research path

```text
Seven-Technique Research
→ Candidate
→ Score
→ Opportunity
→ Proposed Calendar
→ Commitment
→ Production
→ Distribution
```

#### Performance path

```text
Published winner
→ Performance Insight
→ New Opportunity
→ Paid promotion or derivative content
```

#### Ad path

```text
Ad Opportunity
→ Ad Brief
→ Variants
→ Campaign
→ Spend
→ Lead
→ Cash-collected attribution
```

### Migration

- Backfill Content Items for active legacy master rows.
- Backfill source and Opportunity links where evidence permits.
- Verify dual-write parity.
- Cut reads to canonical entities.
- Stop new legacy Phase 3 direct generation.
- Archive compatibility functions.
- Remove deprecated UI actions.
- Retain historical records.

### Hardening

- Security review
- RLS review
- Secret review
- Cost-abuse controls
- Rate limiting
- Provider failure simulation
- Recovery testing
- Data export
- Audit log completeness
- Backup and restoration
- Accessibility
- Performance
- Mobile operator usability where required

### Documentation

Create:

- Operator manual
- Client approval guide
- Architecture guide
- Incident runbook
- Provider runbook
- Migration guide
- Automation policy guide
- Data dictionary

## Acceptance criteria

The system is complete only when:

- All four source streams operate.
- All selected Opportunities become canonical Content Items.
- All Instagram formats can be produced and distributed.
- Reels can be completed through at least the required production strategies.
- Ads can be created, launched and measured.
- Performance creates controlled learning.
- Automation can run validated workflows under policy.
- Multi-client data is isolated.
- Costs and failures are visible.
- Legacy direct Phase 3 is no longer the primary workflow.
- No required operational step exists only in undocumented manual knowledge.

## Exit gate

The new architecture is the sole supported operating model for new work.

---

## Full-circle implementation instruction

Complete every part of Programme Stage P required to satisfy its objective, scope, required outputs, acceptance criteria and exit gate.

Work through the repository end to end:

1. Map the current implementation relevant to this stage, including UI, shared types, API functions, database tables/views/RPCs, Edge Functions, queues or cron jobs, tests, documentation and deployment state.
2. Identify the exact gap between the current implementation and the Stage P target without replacing working systems unnecessarily.
3. Define or confirm the canonical ownership and state model before writing code.
4. Implement all schema changes through ordered, reversible migrations with correct constraints, indexes, RLS, grants and compatibility behaviour.
5. Implement backend and Edge Function logic with strict validation, client ownership, idempotency, provenance, failure handling and deterministic state transitions.
6. Implement shared TypeScript domain types and API contracts so frontend and backend use the same canonical model.
7. Implement or update every required operator UI, including clear status, source and provenance visibility, approval boundaries, empty/error/retry/conflict states and safe actions.
8. Connect the stage to the canonical Cockpit spine and all completed earlier stages. Do not create an isolated feature or leave adapters incomplete.
9. Preserve historical data and current operations through compatibility adapters, projections, dual writes, backfills or controlled cutovers as required.
10. Remove or disable obsolete behaviour only where the Stage P requirements explicitly permit it and the replacement path is proven.
11. Add comprehensive deterministic, database, integration and UI coverage for successful, invalid, duplicate, stale, cross-client, retry, partial and failure scenarios.
12. Update repository documentation and produce a Stage P implementation report containing changed files, migrations, functions, state transitions, tests, deployment requirements, live-verification evidence and any explicitly deferred item.

Do not stop after producing recommendations. Do not leave TODO placeholders for work that belongs to this stage. Do not weaken validation or security to make tests pass. Do not silently alter the locked architecture.

## Required completion and verification

Before treating this stage as complete:

- Run repository typechecking, build and lint.
- Run the full deterministic test suite, not only new tests.
- Add and run contract tests for every new request, response, status transition and failure code.
- Add and run database tests for constraints, foreign keys, uniqueness, transactions, RLS, grants, cross-client isolation and idempotency.
- Add and run integration tests that exercise the complete stage workflow through real API and persistence boundaries.
- Add UI tests or deterministic assertions for loading, empty, success, conflict, validation, partial, retry, failure, approval and disabled states.
- Verify migration ordering and run a migration dry run against the linked project where available.
- Verify every new or modified Edge Function bundles correctly and uses the intended JWT and secret policy.
- Run secret scans, project-reference guards and `git diff --check`.
- Confirm existing Phase 1, Phase 2, Ideation, production, distribution, analytics and Reel Studio paths have not regressed.
- Inspect the final diff for accidental files, generated artefacts, duplicate schemas, stale names, deprecated references and local-only configuration.
- Update the canonical architecture documentation, data dictionary, migration ledger and a stage implementation report.
- Record what is confirmed from code, live-verified, mocked, intentionally deferred or blocked.
- Do not claim completion merely because code compiles or mocked tests pass. Completion requires every stage acceptance criterion and exit gate to be satisfied.

## Final response required from the operator

At completion, return a structured report containing:

- Stage implemented
- Baseline commit and final working-tree state
- Architecture and data-model decisions
- Migrations added or changed
- Backend, RPC and Edge Function changes
- Frontend and operator-workflow changes
- Compatibility, backfill and cutover behaviour
- Security, RLS and client-isolation verification
- Tests added and complete test results
- Build, lint and typecheck results
- Deployment actions performed or still requiring explicit authority
- Live verification completed
- Deferred or blocked items, with precise reasons
- Confirmation against every Stage P acceptance criterion
- Confirmation that the Stage P exit gate is satisfied

The stage is complete only when the repository implements the intended behaviour as one integrated part of Cockpit and all verification is clean.
````

---
