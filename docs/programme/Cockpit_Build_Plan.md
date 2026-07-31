# Cockpit Build Plan

**Repository:** `AttractAcq/Cockpit`  
**Plan status:** Canonical implementation roadmap  
**Plan date:** 30 July 2026  
**Companion document:** `High_level_Cockpit_Audit_30_01_2026.md`  
**Purpose:** Move Cockpit from its current combination of Phase 1, Phase 2, legacy Phase 3, Ideation, production, distribution and analytics systems into one complete, scalable and increasingly automated client-fulfilment platform.

---

# 1. How This Plan Must Be Used

This document is the build authority for the next major stage of Cockpit development.

It exists to prevent the application from being extended through disconnected features, duplicate workflows or incompatible data models.

Every future implementation increment should:

1. Name the Programme Stage in this document that it advances.
2. Identify the acceptance criteria it satisfies.
3. Preserve the architecture boundaries defined here.
4. Avoid creating a new parallel source of truth.
5. Include migrations, backend functions, UI, tests and documentation where required.
6. Pass the exit gate for the current Programme Stage before later dependent stages are treated as complete.

This document uses **Programme Stages A–P** for the implementation roadmap.

These must not be confused with the application’s operating phases:

- **Application Phase 1:** Client Intelligence
- **Application Phase 2:** Execution Intelligence
- **Application Phase 3:** Continuous Content Operations

The internal Ideation workflow should use names such as:

- Ideation Generation
- Ideation Scoring
- Calendar Proposal
- Operational Commitment
- Verification

It should not use “Phase 1”, “Phase 2” or “Phase 3” as general architecture labels.

---

# 2. Final System Definition

Cockpit is intended to become the operating system through which Attract Acquisition can understand, market and continuously improve almost any viable service business.

The complete system must execute the following commercial chain:

```text
Understand the business
→ establish the correct market, customer, offer and positioning
→ identify what is worth communicating
→ substantiate it with proof
→ convert it into persuasive content and advertising
→ distribute it
→ capture performance and business outcomes
→ learn what works
→ improve the next cycle
```

The complete product architecture is:

```text
PHASE 1 — CLIENT INTELLIGENCE

Client facts and files
+ AA research
+ versioned AA playbooks
          ↓
Approved Business Context
+ approved Client Strategic Systems


PHASE 2 — EXECUTION INTELLIGENCE

Approved Phase 1 authority
+ current objectives
+ current campaigns
+ content capacity
+ channel requirements
          ↓
Approved monthly Execution Files
+ normalised machine-executable requirements


PHASE 3 — CONTINUOUS CONTENT OPERATIONS

Manual Ideas ────────────┐
Proof Vault ─────────────┤
Research Ideation ───────┼→ Content Opportunity Pool
Performance Insights ────┘
                                  ↓
                      Required Calendar Slots
                                  ↓
                 Eligibility, scoring and matching
                                  ↓
           Manual / Assisted / Automatic selection
                                  ↓
                          Content Items
                                  ↓
                         Content Briefs
                                  ↓
       Reel / Carousel / Story / Feed / Ad production
                                  ↓
                     Review and approval
                                  ↓
               Organic and paid distribution
                                  ↓
                 Analytics and attribution
                                  ↓
        New Opportunities and controlled updates
```

---

# 3. Non-Negotiable Architecture Rules

## 3.1 One canonical operating spine

All content must ultimately pass through:

```text
Source
→ Content Opportunity
→ Content Requirement or Calendar Slot
→ Content Item
→ Content Brief
→ Production
→ Asset
→ Distribution
→ Performance
→ Learning
```

No studio, generator, automation or planning feature may create a separate incompatible lifecycle.

## 3.2 Phase 1 and Phase 2 remain authority layers

Phase 1 and Phase 2 are not content-generation tabs.

They establish the approved authority that Phase 3 must consume.

Phase 3 may propose controlled updates to that authority, but it may not silently rewrite it.

## 3.3 Proof and Ideas are sources, not final content jobs

A raw Idea or Proof Item must not immediately become an asset without first becoming a client-specific Content Opportunity.

## 3.4 Research Ideation is one source stream

The seven-technique Ideation system must be preserved, but it becomes one producer of Content Opportunities rather than the sole planning system.

## 3.5 Calendar demand and content supply remain separate

Phase 2 determines what must be produced.

Ideas, Proof, Research and Performance produce possible things to create.

The planning system matches supply to demand.

## 3.6 Human approval boundaries remain explicit

Automation may:

- Generate
- Score
- Recommend
- Route
- Schedule
- Retry
- Collect analytics

Automation must not silently:

- Approve foundational Context
- Fabricate proof
- Publish unsupported claims
- Apply strategic Context updates
- Spend paid-media budget outside configured policy
- Publish client content without the applicable approval policy

## 3.7 Provider-neutral production architecture

Cockpit should request capabilities rather than depend conceptually on one provider.

Examples:

```text
generate_image()
generate_video()
animate_image()
create_motion_graphic()
generate_voice()
transcribe_audio()
remove_background()
upscale_media()
render_composition()
publish_media()
collect_insights()
```

Higgsfield, OpenArt, Meta, Supabase or another provider may fulfil a capability, but the Cockpit domain model must remain provider-neutral.

## 3.8 Expand, migrate, then contract

Existing operational tables and functions should not be removed before the replacement path is proven.

Use:

1. Additive schema
2. Compatibility adapters
3. Dual-read or dual-write verification where necessary
4. Backfill
5. Cutover
6. Removal of deprecated paths

## 3.9 Every automated operation must be recoverable

Every long-running or external operation requires:

- Persistent status
- Idempotency
- Lease or ownership protection where relevant
- Retry limits
- Failure stage
- Last error
- Provenance
- Cost record where applicable
- Operator recovery action

## 3.10 Every output must retain provenance

Cockpit must be able to answer:

- Which client authority produced this?
- Which Context and Execution versions were used?
- Which source Ideas or Proof Items were used?
- Which model, prompt and provider produced it?
- Who modified or approved it?
- Where was it distributed?
- What result did it produce?

---

# 4. Current Baseline to Preserve

The build plan starts from the following existing strengths:

- Phase 1 sequential Context-file generation and approval
- Phase 2 sequential Execution-file generation and approval
- Context and Execution versioning
- Authority snapshots
- Legacy Organic, Story and Ads master records
- Existing Calendar records and scoped generation
- Production Brief lifecycle
- Content Creation asset-generation jobs
- Reel Studio storyboard, continuity and shot-generation workflow
- Asset review and grouping
- Organic Instagram publishing state machine
- Analytics snapshots
- Performance analysis and iteration candidates
- Controlled Context update proposals and patches
- Seven-technique Ideation generation
- Ideation scoring and deterministic ranking
- Proposed Calendar creation and editing
- Existing idempotency, leases, retries and service-role-only RPC patterns

These systems should be connected and adapted before they are replaced.

---

# 5. Programme Overview

| Stage | Name | Primary result |
|---|---|---|
| A | Repository Reconciliation and Frozen Baseline | One verified starting state |
| B | Canonical Architecture and Data Spine | Shared terminology, entities and ownership |
| C | Phase 1 Intelligence Hardening | Better inputs, research and playbook authority |
| D | Phase 2 Executable Contract | Machine-readable demand and execution requirements |
| E | Unified Content Source Layer | Manual, Proof, Research and Performance sources |
| F | Content Opportunity Intelligence | One opportunity model and scoring system |
| G | Calendar Planning and Operational Commitment | Matching, selection and canonical planning |
| H | Content Item and Brief Migration | One downstream content job and brief contract |
| I | Shared Production Studio Framework | Common format routing and production state |
| J | Reel Studio Completion | Multiple Reel production paths and final assembly |
| K | Organic Distribution Consolidation | All organic publishing tied to Content Items |
| L | Ad Studio and Paid Distribution | End-to-end paid campaign operation |
| M | Analytics and Closed-Loop Iteration | Results feed planning and controlled authority updates |
| N | Automation and Fulfilment Orchestration | Policy-driven scalable execution |
| O | Multi-Client Scale and Operational Control | Capacity, cost, roles and observability |
| P | End-to-End Hardening and Legacy Retirement | Complete production system and controlled cutover |

---

# 6. Dependency Map

```text
A
↓
B
├── C
├── D
└── E
     ↓
     F
     ↓
     G
     ↓
     H
     ↓
     I
     ↓
     J
     ↓
     K
     ↓
     L
     ↓
     M
     ↓
     N
     ↓
     O
     ↓
     P
```

Important dependency notes:

- Stage C and Stage D may run partly in parallel after Stage B.
- Stage E may begin before all Phase 1 hardening is complete, but it must use the canonical authority contract from Stage B.
- Stage F cannot be completed until all source types can create the same opportunity shape.
- Stage G must be designed before the current Ideation Operational Commitment writes directly into legacy tables as a permanent architecture.
- Stage L should not be completed before the canonical Content Item and Performance models exist.
- Stage N must automate only validated workflows.

---

# 7. Programme Stage A — Repository Reconciliation and Frozen Baseline

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

# 8. Programme Stage B — Canonical Architecture and Data Spine

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

# 9. Programme Stage C — Phase 1 Intelligence Hardening

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

# 10. Programme Stage D — Phase 2 Executable Contract

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

# 11. Programme Stage E — Unified Content Source Layer

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

# 12. Programme Stage F — Content Opportunity Intelligence

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

# 13. Programme Stage G — Calendar Planning and Operational Commitment

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

# 14. Programme Stage H — Content Item and Brief Migration

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

# 15. Programme Stage I — Shared Production Studio Framework

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

# 16. Programme Stage J — Reel Studio Completion

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

# 17. Programme Stage K — Organic Distribution Consolidation

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

# 18. Programme Stage L — Ad Studio and Paid Distribution

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

# 19. Programme Stage M — Analytics and Closed-Loop Iteration

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

# 20. Programme Stage N — Automation and Fulfilment Orchestration

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

# 21. Programme Stage O — Multi-Client Scale and Operational Control

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

# 22. Programme Stage P — End-to-End Hardening and Legacy Retirement

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

# 23. Milestones

## Milestone 0 — Verified Baseline

Completed when Stage A passes.

## Milestone 1 — Canonical Content Spine

Completed when Stages B–F pass.

Cockpit can accept every source type and create scored Content Opportunities.

## Milestone 2 — Unified Planning

Completed when Stage G passes.

Cockpit can fill Phase 2 requirements through Manual, Assisted or Automatic planning and create Content Items.

## Milestone 3 — Unified Production

Completed when Stages H–J pass.

Cockpit can create finished content from canonical Briefs, including complete Reels.

## Milestone 4 — Organic and Paid Distribution

Completed when Stages K–L pass.

Cockpit can publish organic assets, operate paid campaigns and retain delivery provenance.

## Milestone 5 — Closed-Loop Fulfilment

Completed when Stages M–N pass.

Performance influences future planning and validated work can run automatically.

## Milestone 6 — Scalable Product

Completed when Stages O–P pass.

Cockpit is hardened for repeatable multi-client fulfilment and legacy paths are retired.

---

# 24. Release Discipline

Each Programme Stage should be delivered through small, independently verifiable increments.

Every increment must include:

1. Database migration where needed
2. Backend or Edge Function change
3. Frontend surface
4. Deterministic tests
5. Integration tests
6. Security and RLS verification
7. Idempotency verification
8. Migration dry run
9. Documentation
10. Deployment report

## Required status labels

Every build item should be classified as:

- Planned
- In progress
- Built locally
- Tested locally
- Backend deployed
- Frontend deployed
- Live verified
- Deferred
- Held
- Deprecated

## Release prohibition

Do not label a Stage complete because:

- A table exists
- A UI is visible
- An Edge Function deployed
- A mocked test passes
- A document says it is complete

A Stage is complete only when its acceptance criteria have been verified through the intended workflow.

---

# 25. Testing Strategy

## Contract tests

Validate:

- Input schema
- Output schema
- Authority snapshot
- State transitions
- Error codes
- Idempotency

## Database tests

Validate:

- Constraints
- Foreign keys
- RLS
- Security-definer privileges
- Duplicate prevention
- Cross-client isolation
- Transactionality

## Provider tests

Use:

- Deterministic mock fixtures
- Recorded non-sensitive responses where allowed
- Disposable live test calls
- Cost caps

## UI tests

Validate:

- Loading
- Empty
- Error
- Retry
- Approval
- Conflict
- Partial completion
- Accessibility
- Mobile constraints where relevant

## End-to-end tests

Maintain one disposable test client with:

- Approved Phase 1
- Approved Phase 2
- Manual Ideas
- Proof
- Research fixtures
- Calendar requirements
- Production assets
- Test distribution destination or mocked publication

No destructive live test should use a real client.

---

# 26. Data Migration Strategy

## Expand

Add canonical entities and links without breaking existing tables.

## Mirror

Create compatibility projections and verify that new and legacy records match.

## Backfill

Create canonical records for active and historically valuable legacy records.

## Cut over

Change UI and APIs to read from canonical entities.

## Freeze legacy writes

Prevent new legacy-only records.

## Contract

Remove deprecated functions, actions and views only after:

- No active caller exists
- Historical reads remain possible
- Migration reports reconcile
- Rollback is documented

---

# 27. Immediate Next Build Decisions

Before continuing the current Ideation Operational Commitment work, resolve the following:

## Decision 1

Ideation approval must create canonical Content Opportunities and Content Items, not permanently define the final architecture through direct legacy `organic_master` and Calendar writes.

## Decision 2

The current proposed Calendar should be generalised so that it can eventually contain:

- Research Opportunities
- Manual Idea Opportunities
- Proof Opportunities
- Performance Opportunities

## Decision 3

Phase 2 quantities should become canonical Content Requirements and Calendar Slots.

## Decision 4

Existing master records should become compatibility projections during migration.

## Decision 5

The Proof Upload placeholder should become a structured Proof Vault, not only a file browser.

## Decision 6

The Manual Idea entry should be implemented as a source workflow, not as a shortcut that bypasses Opportunity generation.

## Decision 7

Reel Studio should support several production strategies rather than forcing every Reel through cinematic AI shot generation.

---

# 28. First Implementation Backlog

The first build sequence after the baseline is reconciled should be:

1. Architecture decision record for canonical entities
2. Additive canonical schema
3. Shared domain types
4. Source and Opportunity APIs
5. Phase 2 structured Execution configuration
6. Deterministic Content Requirements and Slots
7. Ideation Candidate → Opportunity adapter
8. Proposed Calendar generalisation
9. Operational Commitment → Content Item
10. Legacy master and Calendar compatibility projections
11. Manual Idea entry
12. Proof Vault foundation
13. Universal Opportunity Pool UI
14. Content Item detail and status
15. Structured Content Brief
16. Existing studio routing
17. Reel strategy selector and final assembly
18. Paid Distribution foundation
19. Performance → Opportunity adapter
20. Automation policy and orchestrator

---

# 29. Definition of Done for the Complete System

Cockpit is complete for the intended initial product when an operator can:

1. Onboard a service business.
2. Generate and approve Phase 1 client intelligence.
3. Generate and approve Phase 2 execution intelligence.
4. Upload and structure the client’s Proof.
5. Enter Manual Ideas.
6. Run the seven-technique Research system.
7. Receive Performance-derived Ideas.
8. View all resulting Content Opportunities in one pool.
9. Allow the system to propose the required Calendar.
10. Manually override or directly select any source.
11. Commit approved work into canonical Content Items.
12. Generate approved structured Content Briefs.
13. Produce:
    - Reels
    - Carousels
    - Stories
    - Feed posts
    - Ads
14. Review and approve assets.
15. Publish organic content.
16. Launch paid campaigns under policy.
17. Track platform and commercial results.
18. Convert results into new Opportunities and controlled strategy updates.
19. Automate repetitive steps within client-specific rules.
20. Repeat the process across multiple clients with visible cost, capacity and quality control.

---

# 30. Final Build Principle

The system should not be developed as a sequence of unrelated tabs.

It should be developed as one operating chain:

```text
Authority
→ Sources
→ Opportunities
→ Requirements
→ Planning
→ Content Items
→ Briefs
→ Production
→ Distribution
→ Performance
→ Learning
→ Automation
```

Every future feature must either strengthen this chain or be excluded from the core build.
