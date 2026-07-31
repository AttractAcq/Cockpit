# High-Level Cockpit Audit

**Repository:** `AttractAcq/Cockpit`  
**Audit date:** 30 July 2026  
**Scope:** High-level current-state versus target-state architecture audit  
**Repository basis:** Pushed GitHub state visible on `main`; excludes uncommitted local Desktop changes

---

## 1. Executive Assessment

Cockpit is more advanced than a basic content application. It already contains several substantial systems:

- Controlled Phase 1 and Phase 2 generation
- Approval-controlled Context and Execution files
- Organic, Story and Ads master records
- Calendar records and scoped generation
- Production-brief generation
- Static and multi-image asset workflows
- A relatively advanced Reel Studio
- Organic Instagram distribution
- Platform analytics and business-signal capture
- Performance scoring, iteration candidates and controlled context updates

The principal problem is no longer the absence of functionality.

The problem is that Cockpit currently contains **two competing operating models**.

### Existing legacy operating model

```text
Context Inputs
→ Phase 1 Context Files
→ Phase 2 Execution Files
→ Generate Phase 3 master rows and Calendar
→ Generate Production Brief
→ Produce Asset
→ Distribute
→ Analyse
```

### New operating model being constructed

```text
Approved Context and Execution authority
→ Seven-technique Ideation
→ Candidates
→ Scores
→ Proposed Calendar
→ Currently stops before operational commit
```

### Target operating model

```text
Manual Ideas ────────────┐
Proof Uploads ───────────┼→ Content Opportunities
Research Ideation ───────┤
Performance Learnings ───┘
                              ↓
                    Match against required slots
                              ↓
                     Operational Content Items
                              ↓
                         Production Briefs
                              ↓
                   Format-specific production
                              ↓
              Distribution → Analytics → Iteration
```

The repository has most of the downstream execution machinery. What it lacks is the **canonical convergence layer** connecting all sources of content to that machinery.

That is the central gap.

---

# 2. Current Architecture

## Phase 1: Client Intelligence

The official repository baseline defines Phase 1 as the source of approved business Context Files and client-specific strategic systems.

It treats Phase 1 and Phase 2 as upstream authority systems for every operational function, including:

- Ideation
- Content creation
- Ads
- Distribution
- Performance intelligence

The implementation generates 21 Context files sequentially.

These cover:

- Business context
- Buyer psychology
- Offers and sales
- Proof Bank
- Proof Gap Report
- Positioning
- Brand
- Content system
- Story system
- Ad system
- Distribution
- Automation
- Performance
- Iteration
- Approval context
- Sales enablement
- Retention and expansion

### What currently works

- Generation is split safely around Edge Function time limits.
- Files are never automatically approved.
- Missing information is intended to be exposed rather than fabricated.
- Every file has a review and approval boundary.
- Phase 2 is blocked until the complete Context set is approved.
- The 21-file structure covers the main strategic domains needed downstream.

### Material gap: Phase 1 does not currently work exactly as intended

The intended model is:

```text
Business information
+ uploaded material
+ research
+ AA playbooks
→ client-specific Context and Strategic Systems
```

The current implementation is closer to:

```text
Form fields in client_inputs
+ hardcoded file instructions
→ 21 AI-generated Markdown files
```

The generation function reads values in `client_inputs`, including:

- Business description
- Offer
- Target customer
- Proof notes
- Competitors
- Brand voice

Uploaded files are represented as references that should be reviewed elsewhere. Their contents are not fully ingested into the generation call.

The repository also does not currently show Phase 1 or Phase 2 using the `playbooks` or `playbook_runs` tables as live, versioned methodology authority.

The AA methodology is currently embedded through:

- Hardcoded prompt instructions
- The 21-file manifest
- Existing approved files
- The Phase 2 execution manifest

It is **not yet implemented as a separately versioned and selected Playbook Library**.

### Phase 1 target

Phase 1 should eventually combine three distinct inputs:

```text
Client-submitted facts and files
+
AA research on the business, market and customer
+
Versioned AA strategic playbooks
```

It should also preserve a clearer distinction between:

1. **Business Context** — what is factually true.
2. **Client Strategic Systems** — how AA applies its methodology to that business.

These are already logically distinct, but they are physically generated and stored together.

---

# 3. Phase 2: Execution Intelligence

Phase 2 is one of the stronger parts of the current architecture.

It generates 11 canonical monthly files:

1. `01_Client_Strategy_Master.md`
2. `02_Organic_Master_Plan.md`
3. `03_Ads_Master_Plan.md`
4. `04_Story_Master_Plan.md`
5. `05_Content_Calendar.md`
6. `06_Asset_Brief_Index.md`
7. `07_Distribution_Schedule.md`
8. `08_Approval_Tracker.md`
9. `09_Performance_Tracking_Plan.md`
10. `10_Proof_Master_Plan.md`
11. `11_Stage_2_SOP_and_Laws.md`

The manifest defines:

- Which Context files each Execution file consumes
- Which downstream systems are expected to use it
- The purpose and execution scope of each file

The runtime enforces:

- All 21 Context files must be approved
- Generation is monthly
- Files are generated sequentially
- Files begin in review
- All 11 must be present and approved before downstream generation
- Proof and prohibited-claim checks run against generated documents

## What works

Phase 2 correctly represents a monthly operating layer between perpetual client context and actual fulfilment.

The correct conceptual distinction is:

```text
Phase 1 = what is true and how the client should be marketed
Phase 2 = what must be executed during this period
Phase 3 = actual ongoing execution
```

## Material gap: Execution Files are still primarily documents

The files contain:

- Quantities
- Cadence
- Channel plans
- Proof rules
- Campaigns
- Approval logic
- Distribution instructions
- Performance requirements

But most of this exists as Markdown that downstream functions must independently parse, truncate or reinterpret.

Phase 2 needs to produce both:

### Human-readable authority

The existing 11 Markdown files.

### Machine-executable authority

Structured records such as:

```yaml
content_requirements:
  reels_per_week: 4
  carousels_per_week: 2
  feed_posts_per_week: 2

story_requirements:
  sequences_per_week: 7

current_campaign:
  objective:
  offer:
  audience:
  start_date:
  end_date:
  required_proof_types:

automation_policy:
  calendar_planning: assisted
  production_approval: manual
  distribution_after_approval: automatic
```

The current Ideation system already extracts one narrow quantity contract from the Execution files.

Cockpit needs a broader **normalised execution contract**.

Without that, each downstream function will continue reading and interpreting Markdown independently.

## Recommended Phase 2 output

```text
Approved Execution Markdown
+
Approved Execution Configuration JSON
+
Version and provenance snapshot
```

The structured configuration should be generated from and validated against the Markdown, then reviewed alongside it.

---

# 4. Phase 3 Currently Means Two Different Things

This is the most urgent architectural naming problem.

## Legacy Phase 3

The existing `generate-phase-3` function generates:

- 32 Organic master records
- 28 Story records
- 4 Ads records
- Calendar cells

It creates these directly from Context and Execution files.

The interface identifies this as:

> Phase 3 · Full-month master & calendar (legacy)

There is also a scoped version that creates:

- One item
- A date-range batch
- Master rows
- Calendar cells

It does not create finished briefs or assets.

## Ideation Stage 3

The newer Ideation build also calls its proposed-calendar stage “Stage 3.”

It:

- Uses scored candidates
- Creates a deterministic slot manifest
- Assigns candidates to slots
- Supports move, swap, remove and restore
- Detects conflicts against the operational Calendar
- Allows proposal approval

However, approval remains advisory.

It deliberately creates no:

- Operational Calendar rows
- Master rows
- Production briefs
- Assets
- Distribution records

## Required naming resolution

Reserve these names:

### Phase 1 — Client Intelligence

Context and client-specific strategy.

### Phase 2 — Execution Intelligence

Monthly operating requirements.

### Phase 3 — Continuous Content Operations

Sources, opportunities, planning, production, distribution and learning.

The five steps inside the Ideation feature should be named:

1. Ideation Generation
2. Ideation Scoring
3. Calendar Proposal
4. Operational Commitment
5. Verification

They should not be called Phase 1, Phase 2 or Phase 3 outside the Ideation feature because those names already refer to the larger Cockpit architecture.

---

# 5. The Three Primary Content-Source Streams

The target system has three main content-source paths.

## Stream A: Manual Idea

Examples:

- An observation
- A founder thought
- A customer question
- An objection
- A hook
- A content concept
- A manually entered news item

### Current state

Not built.

The current Ideation UI asks the operator to choose a generation period. Techniques are then selected internally.

There is no direct “enter an idea” workflow.

### Required functionality

The manual Idea input should support:

```yaml
raw_idea:
optional_note_or_source:
preferred_format:
optional_intended_date:
optional_campaign_or_offer:
optional_proof_attachment:
```

The system should then create several client-specific **Content Opportunities** from the Idea.

It should not immediately create a Reel or another finished asset.

---

## Stream B: Proof-Led Content

Examples:

- Review
- Testimonial
- Client message
- Completed project
- Before-and-after
- Case study
- Result
- Certification
- Process evidence
- Inspection footage
- Delivery documentation

### Current state

Conceptually present, operationally absent.

The system already has:

- Phase 1 Proof Bank
- Phase 1 Proof Gap Report
- Phase 2 Proof Master Plan
- Proof-aware generation constraints
- Proof fields in master records
- Proof fields in production briefs

However, the operational **Proof Upload** interface remains a placeholder.

This means Cockpit currently has a strategy for proof, but not a proper operational Proof Vault.

### Required functionality

Proof Upload should do more than store a file.

It should extract a structured Proof Item:

```yaml
source:
proof_type:
business_service_or_project:
date:
customer:
claim_supported:
outcome:
specificity:
consent:
anonymisation_requirement:
services_supported:
objections_answered:
available_media:
verification_state:
usage_history:
```

The system should then generate multiple Content Opportunities from each Proof Item.

---

## Stream C: Seven-Technique Research Ideation

The seven techniques are currently:

1. Persona
2. Review-Mined Pain Language
3. Competitor Objections
4. End-Customer Complaints
5. Live Objection Log
6. Trigger Event
7. Format Swipe

### Current state

This is the most developed of the three source streams.

It currently includes:

- Period-based generation
- Seven persisted technique runs
- Evidence and provenance
- Candidate generation
- Deterministic scoring
- Ranking
- Proposed Calendar generation
- Manual proposal editing
- Proposal approval

### Important operational limitation

The seven-technique system is not yet equivalent to seven fully operational internet-research methods.

The current implementation identifies only three active sourcing techniques:

- Review-Mined Pain Language
- Competitor Objections
- End-Customer Complaints

The earlier implementation also treated:

- Live Objection Log as having no live source
- Trigger Event as inactive

The first live tests encountered a grounding mismatch because approved Context files contain bullet- and table-heavy Markdown, while the evidence validator expects a verbatim prose support span.

The architecture is sophisticated, but the complete live production path is not yet fully proven.

---

# 6. Where the Content Streams Should Meet

The correct convergence point is not the current Ideation Candidate table.

It should be a general **Content Opportunity**.

## Why the current Ideation Candidate should not be universal

Current Ideation candidates are tightly bound to:

- An Ideation cycle
- A technique run
- A research result
- A deterministic technique slot
- A specific scoring run

That is suitable for research ideation, but it does not naturally represent:

- A manually submitted Idea
- A Proof Vault item
- A performance insight
- A direct operator request
- A content opportunity created outside an Ideation cycle

## Canonical model

```text
Manual Idea ────────────→
Proof Item ─────────────→
Research Candidate ─────→ CONTENT OPPORTUNITY
Performance Insight ────→
```

The existing Ideation Candidate should become one possible source of a Content Opportunity.

## Recommended Content Opportunity fields

```yaml
client_id:

origin_type:
source_ids:
authority_snapshot:

core_idea:
core_claim:
hook_direction:

audience:
pain_or_objection:
belief_before:
belief_after:

content_objective:
offer_relationship:
funnel_stage:

proof_references:

candidate_formats:
candidate_channels:

commercial_relevance:
timeliness:
production_feasibility:

score_breakdown:
status:
```

## Opportunity statuses

```text
draft
needs_review
shortlisted
selected
scheduled
rejected
expired
produced
```

## Planning modes

Cockpit should support three planning modes.

### Manual

Open a source and select:

> Create content from this.

### Assisted

Cockpit proposes the best opportunities for the required weekly slots. The operator approves the plan.

### Automatic

Cockpit fills slots automatically when:

- The score exceeds a configured threshold
- Proof requirements are satisfied
- No scheduling conflict exists
- Production capacity exists
- The client’s automation policy permits it

**Assisted planning should remain the default** until the full system is validated across several clients.

---

# 7. The Calendar and Master-Record Problem

Cockpit currently treats:

- `organic_master`
- `story_master`
- `ads_master`

as the operational content records.

The current lifecycle is:

```text
Master Row
→ Production Brief
→ Asset
→ Distribution
→ Analytics
```

This downstream lifecycle is useful.

The Masters interface supports:

- Review
- Editing
- Approval
- Brief generation

However, the master rows also serve as the planning source of truth.

That becomes problematic once Manual Ideas, Proof and Research Opportunities all need to converge.

## Recommended target

Create one canonical `content_items` entity.

```text
Content Opportunity
→ selected for a Calendar slot
→ Content Item
```

The Content Item should own:

- Date
- Format
- Platform
- Objective
- Original opportunity
- Proof references
- Content brief
- Production state
- Approval state
- Distribution record
- Performance record

The current master tables can initially remain as compatibility projections:

```text
content_items
   ├── organic_master projection
   ├── story_master projection
   └── ads_master projection
```

This avoids an immediate destructive rewrite while gradually making `content_items` the source of truth.

---

# 8. Content Briefs and Production

## Current state

The production layer is already substantial.

Production briefs:

- Are tied to approved master rows
- Consume 21 approved Context files
- Consume 11 approved Execution files
- Support human, AI and hybrid production modes
- Create format-specific instructions
- Include proof and claim restrictions
- Route eligible Reels into Reel Studio

Content Creation supports:

- Production modes
- Contractor assignments
- AI background prompts
- Multi-image generation jobs
- Persistent retries and progress
- Asset handoff

## Gap

The Production Brief is primarily a Markdown document.

It should also have a structured contract containing:

```yaml
objective:
script_or_copy:
scenes_slides_or_frames:
proof_dependencies:
asset_inputs:
production_mode:
brand_constraints:
required_outputs:
cta:
review_checklist:
```

The Markdown can remain the human-readable rendering of the structured brief.

## Target format router

```text
Approved Content Item
       ↓
Generate authoritative Content Brief
       ↓
Format router
       ├── Reel Studio
       ├── Carousel Studio
       ├── Story Studio
       ├── Feed Post Studio
       └── Ad Studio
```

The current implementation approximates this through source tables and UI transitions, but the routing is not yet unified.

---

# 9. Reel Studio

Reel Studio is currently the most advanced format-specific production system.

It already includes:

- Approved Production Brief binding
- Story strategy
- Story spine
- Project-level continuity plan
- Shot roles
- Narrative-flow validation
- Critique and bounded repair
- Still-image generation
- Video-shot generation
- Retry and recovery states
- Final Reel upload
- Final Reel review
- Distribution draft creation

The sequence-first implementation uses the exact approved brief plus approved Context and Execution files rather than a short, truncated brief excerpt.

The prompt compiler preserves:

- Palette
- Lighting
- Lens
- Continuity anchors
- Human-presence constraints
- Aspect ratio

during prompt budgeting.

## Remaining Reel Studio gaps

- AI shots are generated, but full sequence assembly remains largely a human or external-editor step.
- There is no integrated provider-neutral video composition engine.
- Reel Studio is not yet reachable directly from Manual Ideas or Proof Items.
- It depends on an operational master row and approved Reel Production Brief.
- Voice generation, music, captions and final automated editing need clearer ownership.
- The final Reel style still needs to be designed for AA and later parameterised per client.
- The current system is oriented towards cinematic AI-generated B-roll.

It will need additional production paths for:

- Motion-design explainers
- Proof-led screenshot and document Reels
- Talking-head footage
- Real client footage
- AI-native branded formats

The current Reel Studio should be preserved.

It should become one production route within a broader Reel production strategy, not the only route.

---

# 10. Carousels, Stories and Feed Posts

These formats are closer to usable because their production objects are simpler.

The generic production system supports:

- Feed-post images
- Carousel image sets
- Story frames
- Background generation
- Asset groups
- Review and approval
- Organic publication

The key work is not rebuilding these production systems.

It is connecting them to the same:

- Content Opportunity
- Content Item
- Content Brief

structure that will feed Reel Studio.

---

# 11. Ads

Ads currently exist at several layers:

- Phase 1 Ad System
- Phase 2 Ads Master Plan
- Legacy Phase 3 `ads_master`
- Ads in the Masters interface
- Static-ad Production Brief instructions
- Ad-related Calendar lanes

## What currently exists

- Ad strategy context
- Planned ad lanes
- Ad master records
- Static-ad briefs
- Potential asset generation

## What does not yet exist

The Paid Distribution tab remains a placeholder.

The repository does not yet expose a complete operational system for:

- Meta campaign creation
- Ad-set creation
- Audience configuration
- Budget allocation
- Creative attachment
- Campaign launch
- Pause and restart
- Paid delivery metrics
- Conversion attribution
- Creative testing
- Winning-creative iteration

## Recommended Ad architecture

Ads should use the same opportunity layer.

```text
Proof / Idea / Organic Winner / Campaign Need
                    ↓
              Ad Opportunity
                    ↓
                Ad Brief
                    ↓
        Hooks × Visuals × CTA variants
                    ↓
              Ad Creative Assets
                    ↓
       Campaign / Ad Set / Ad deployment
                    ↓
          Paid analytics and attribution
```

Organic content that performs well should be promotable into an Ad Opportunity without copying the underlying data manually.

---

# 12. Organic Distribution

Organic distribution is relatively mature.

The current system includes:

- Client distribution accounts
- Destination selection
- Captions and hashtags
- Safety checklists
- Scheduling
- Immediate publication
- Retry
- Reconciliation
- Publish attempts
- Asynchronous Reel-container processing
- Published evidence
- Story-specific restrictions

The current format limitation is that video Story publishing is not yet supported.

This distribution system should be retained and connected to the canonical Content Item.

---

# 13. Analytics and Iteration

The analytics system already tracks platform and commercial metrics.

Examples include:

- Reach
- Views
- Saves
- Shares
- Profile visits
- Follows
- DMs
- Qualified conversations
- Appointments
- Show-ups
- Cash collected

Performance and Iteration includes:

- Deterministic performance analysis
- Attention scoring
- Engagement scoring
- Trust scoring
- Conversion scoring
- Performance insights
- Iteration candidates
- Review statuses
- Context-update proposals
- Context patch drafts
- Explicit human-controlled application

The context-update chain is appropriately conservative.

An approved recommendation does not silently modify Context authority, and an applied patch requires an explicit operator action.

## Gap

Performance intelligence does not yet feed directly into:

- The Content Opportunity Pool
- Phase 2 execution updates
- Future slot priorities
- Automatic repurposing
- Ad promotion recommendations

A Performance Insight should become a fourth Content Opportunity source:

```text
High-performing published asset
→ Performance insight
→ New opportunity:
   - alternate hook
   - shortened edit
   - carousel adaptation
   - paid promotion
   - follow-up topic
```

---

# 14. Automations

The Automations client tab is currently a placeholder.

The Operations page is primarily an activity log.

It can display automation events, but it is not a fulfilment orchestrator.

## What Automations should become

Do not build Automations merely as a list of on/off switches.

It should control policies across the entire fulfilment chain.

| Automation | Example policy |
|---|---|
| Proof processing | Automatically extract structured proof after upload |
| Opportunity generation | Generate opportunities from new sources |
| Weekly planning | Propose a Calendar automatically |
| Brief generation | Generate after Content Item approval |
| Asset production | Start automatically where production mode allows |
| Review routing | Assign to the configured operator or client |
| Distribution | Schedule approved assets automatically |
| Analytics | Collect at defined intervals |
| Iteration | Generate recommendations after thresholds are met |
| Context updates | Propose only; never apply automatically |

Every automated job requires:

- Persistent status
- Idempotency
- Retry limits
- Cost controls
- Capacity controls
- Human approval boundaries
- Client-specific policy
- Failure recovery
- Activity logging

Cockpit already uses many of these patterns in:

- Ideation
- Reel Studio
- Distribution

The automation layer should orchestrate those existing systems rather than recreate them.

---

# 15. Current Maturity Assessment

These are architectural estimates, not test-coverage scores.

| Area | Current maturity | Assessment |
|---|---:|---|
| Phase 1 generation and approval | 6/10 | Operational foundation; weak file ingestion, research and playbook separation |
| Phase 2 execution generation | 7/10 | Strong document architecture; needs normalised executable contracts |
| Research-led ideation | 6/10 | Sophisticated design; live grounding issue remains |
| Manual Idea entry | 0/10 | Not built |
| Proof-led entry | 1/10 | Planning exists; operational Proof Vault absent |
| Universal Opportunity Pool | 2/10 | Ideation candidates are a partial precursor |
| Calendar planning | 6/10 | Several capable systems, but overlapping sources of truth |
| Content-brief lifecycle | 7/10 | Good downstream workflow; needs a structured canonical brief |
| Reel Studio | 7/10 | Advanced storyboard and shot system; final automated assembly remains incomplete |
| Carousel, Story and feed production | 6/10 | Useful generation paths already exist |
| Organic distribution | 8/10 | Mature Instagram-oriented state machine |
| Paid distribution | 1/10 | Strategy and records exist; operational deployment absent |
| Analytics | 7/10 | Good organic and manual commercial-signal coverage |
| Performance feedback loop | 5/10 | Safe reviewed chain; not yet feeding planning automatically |
| Fulfilment automation | 2/10 | Strong component-level patterns, no unified orchestrator |

---

# 16. Target Architecture

```text
PHASE 1 — CLIENT INTELLIGENCE
Client inputs
+ uploaded documents
+ business and market research
+ versioned AA playbooks
          ↓
Approved Business Context
+ approved Client Strategic Systems

PHASE 2 — EXECUTION INTELLIGENCE
Approved Phase 1 authority
+ current objectives, capacity and campaigns
          ↓
Approved monthly Execution Files
+ normalised machine-executable requirements

PHASE 3 — CONTINUOUS CONTENT OPERATIONS

Manual Ideas ────────────┐
Proof Vault ─────────────┤
Seven-Technique Research ├──→ Content Opportunity Pool
Performance Insights ────┘
                                  ↓
                      Required Calendar Slots
                                  ↓
                       Eligibility + matching
                                  ↓
                Manual / Assisted / Automatic selection
                                  ↓
                          Content Items
                                  ↓
                         Content Briefs
                                  ↓
          Reel / Carousel / Story / Feed / Ad Studios
                                  ↓
                  Review → Assets → Distribution
                                  ↓
                        Analytics → Learning
                                  ↓
          New Opportunities / Execution Update Proposals
```

---

# 17. What Should Be Preserved

Do not rebuild these areas:

- Phase 1 and Phase 2 approval boundaries
- Context and Execution versioning
- The authority hierarchy
- Ideation provenance and deterministic scoring
- Proposed-Calendar conflict handling
- Master-to-brief-to-asset lifecycle logic
- Reel Studio’s story and continuity system
- Distribution state machine
- Analytics snapshots
- Controlled iteration and Context-patch workflow
- Activity and provenance records

---

# 18. What Should Be Changed

- Introduce a universal Content Opportunity.
- Add Manual Idea and Proof Vault sources.
- Convert Research Candidates into Content Opportunities.
- Convert Performance Insights into Content Opportunities.
- Create normalised slot requirements from Phase 2.
- Make the Calendar consume canonical Content Items rather than independently generated rows.
- Make Production Briefs structured as well as Markdown.
- Route every format through one content-production contract.
- Add operational Ads and Paid Distribution.
- Build Automations as a policy-driven orchestrator.

---

# 19. What Should Eventually Be Retired

- Legacy direct full-month Phase 3 generation as the primary planning system.
- Multiple unrelated meanings of “Phase 3.”
- Master tables as the ultimate source of truth.
- Hardcoded strategic methodology that cannot be versioned independently.
- Separate planning paths that bypass the Opportunity Pool.
- Direct content generation that cannot identify its originating Idea or Proof Item.

---

# 20. Recommended Implementation Sequence

## 1. Lock the canonical Phase 3 model

Define:

- `content_sources`
- `manual_ideas`
- `proof_items`
- `content_opportunities`
- `content_requirements`
- `content_items`
- `content_source_links`

Do this before Ideation Operational Commitment writes directly into the existing tables.

Otherwise, the current Ideation build may reinforce the legacy model that is about to be replaced.

## 2. Adapt Ideation rather than discard it

Preserve:

- Seven techniques
- Candidate provenance
- Scoring
- Ranking
- Proposed Calendar

Change its downstream output:

```text
Ideation Candidate
→ approved or eligible Content Opportunity
→ slot matching
→ Content Item
```

## 3. Build Manual Idea entry

```text
Enter Idea
→ generate possible Content Opportunities
→ select one
→ assign to slot or create Content Item
```

## 4. Build Proof Vault

Prioritise:

- Structured proof ingestion
- Consent
- Supported claims
- Media
- Verification
- Usage history

Then:

```text
Proof Item
→ extract supported claims
→ generate Content Opportunities
→ select formats
```

## 5. Normalise Phase 2 execution requirements

Convert:

- Quantities
- Cadence
- Campaigns
- Content mix
- Automation policies
- Capacity constraints

into structured records.

This creates the demand side of planning.

## 6. Create unified opportunity-to-slot matching

Support:

- Automatic recommendations
- Manual assignment
- Direct “Create content from this”
- Explainable scoring
- Hard eligibility filters

## 7. Commit selected opportunities into canonical Content Items

Use compatibility adapters to continue creating current:

- Organic master records
- Story master records
- Ads master records
- Calendar records

while the downstream system is migrated.

## 8. Connect existing production systems

Retain current:

- Production Brief
- Content Creation
- Reel Studio
- Assets
- Organic Distribution
- Analytics

Change their canonical parent from an isolated master reference to a Content Item.

## 9. Build Ad Studio and Paid Distribution

Build this only after the shared content spine is stable.

## 10. Build automation policies

Automate the validated workflow incrementally:

```text
Source ingestion
→ Opportunity generation
→ Weekly Calendar proposal
→ Brief generation
→ Eligible asset jobs
→ Review routing
→ Scheduling
→ Metric collection
→ Iteration recommendations
```

---

# 21. Immediate Architectural Decision

The most important decision concerns what happens in the current Ideation Operational Commitment stage.

It should **not simply commit scored Ideation Candidates directly into the legacy Calendar and `organic_master` as the final architecture**.

A safer design is:

```text
Approved Ideation Proposal
→ create Content Opportunities
→ select or confirm operational Content Items
→ create compatibility projections into current master and Calendar tables
```

This allows the system to support:

- Research-led content now
- Manual Ideas next
- Proof-led content next
- Performance-led content later

All four then use the same downstream execution system.

---

# 22. Overall Conclusion

Cockpit already has a strong execution backend from master records onwards.

It also has a strong authority layer in Phase 1 and Phase 2.

The missing software product is the middle:

> **A universal content-intelligence and planning layer that turns Ideas, Proof, Research and Performance into selected operational Content Items.**

Once that layer is established, the rest of the repository can be connected rather than rebuilt.

The immediate priority order should be:

```text
Canonical Content Opportunity
→ normalised Phase 2 slot requirements
→ Manual / Proof / Research convergence
→ Content Item commitment
→ existing production pipeline
→ Ads and Paid Distribution
→ policy-driven automation
```
