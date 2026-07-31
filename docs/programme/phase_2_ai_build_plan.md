# Phase 2 AI Build Plan

**Product:** Attract Acquisition Cockpit  
**Programme:** Phase 2 — AI Control Plane, Client Agents and Fulfilment Automation  
**Primary surfaces:** Global Cockpit Admin Control Plane and Client Automation Tab  
**Purpose:** Add a safe, scalable AI operating layer over the canonical Cockpit workflows once the core Phase 1, Phase 2 and Phase 3 execution systems are operational.

---

# 1. Purpose

This programme adds the second layer of AI and automation to Cockpit.

The first layer is the underlying application and workflow infrastructure:

```text
Client Intelligence
→ Execution Intelligence
→ Content Sources
→ Content Opportunities
→ Calendar and Content Items
→ Production Briefs
→ Asset Production
→ Distribution
→ Analytics
→ Iteration
```

The second layer allows Attract Acquisition to control that infrastructure conversationally and automate repeatable fulfilment work across multiple clients.

The target experience is:

```text
Operator instruction
→ AI understands the requested client and task
→ AI retrieves the correct client authority and operational state
→ AI creates a safe execution plan
→ Cockpit validates permissions, policies and prerequisites
→ Canonical Cockpit commands execute
→ Workflow progress is visible
→ Exceptions are routed for human input
→ Results and evidence return to the operator
```

Examples:

- “Run Phase 1 for Client 004.”
- “Upload this photograph as proof for Client 011 and create proof-led content opportunities.”
- “Create a Reel from this customer review for Client 002.”
- “Fill next week’s empty Reel slots for Client 006.”
- “Create a proof post and schedule it for Friday.”
- “Generate Phase 2 for every client whose Context Files are fully approved.”
- “Show me every client blocked from production.”
- “Find the strongest unused proof against the price objection for Client 009.”
- “Turn the best-performing organic post into three paid-ad variants.”
- “Do more of what is working for Client 003.”

This AI layer must operate through Cockpit’s approved APIs and state transitions. It must not directly manipulate arbitrary tables, bypass approvals or create a parallel content lifecycle.

---

# 2. Core Product Principle

The AI is a **control surface over Cockpit**, not a replacement for Cockpit.

The canonical architecture remains:

```text
Approved Authority
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
```

The AI may:

- Retrieve information
- Interpret an operator instruction
- Propose an execution plan
- Call approved domain commands
- Monitor workflow progress
- Request approval
- Retry eligible failures
- Explain blockers
- Surface recommendations

The AI may not:

- Invent client facts or proof
- Override approved Context or Execution authority
- Publish or spend money outside policy
- Cross client boundaries
- Apply strategic changes without approval
- Write directly to operational tables outside canonical domain commands
- Hide failures or claim completion without evidence

---

# 3. Two AI Control Surfaces

The Phase 2 AI build has two distinct interfaces.

## 3.1 Global Cockpit Admin Control Plane

This is the multi-client operating interface for the Attract Acquisition administrator.

It belongs on the main Cockpit application surface, above the individual Client pages.

Its purpose is to let the administrator:

- Control any authorised client
- Run cross-client workflows
- View portfolio-wide status
- Manage automation policies
- Resolve exceptions
- Monitor queues, costs and capacity
- Issue natural-language commands
- Upload files and assign them to a client
- Inspect the plan before execution
- Approve or reject high-impact actions

Example commands:

```text
Run Phase 1 for Client 007.

Generate Phase 2 for all clients that are eligible.

Upload this photograph to Client 003’s Proof Vault, classify it and create content opportunities.

Show every client with unfilled Reel slots next week.

Create weekly Calendar proposals for all active Proof Brand clients.

Show failed workflows from the last 24 hours and group them by failure reason.

Pause automatic publishing for Client 010.

Create an organic proof post for Client 004 and schedule it for Friday at 10:00.

Promote the three strongest organic assets this month into paid-ad opportunities.

Show me every action that currently requires my approval.
```

The global AI must always identify:

- Which client or clients are affected
- Which command will run
- Which prerequisites are satisfied
- Which actions require approval
- Which policies govern execution
- What the estimated operational impact is
- What files, proof or Context will be used

## 3.2 Client Automation Tab

This is the client-scoped AI and automation interface inside each Client page.

It has access only to the selected client.

Its purpose is to:

- Execute client-specific workflows
- Display the client’s AI knowledge state
- Configure client automation policies
- Manage the client’s recurring workflows
- View active, completed and failed automation runs
- Interact conversationally with the client’s data
- Upload Ideas, Proof and files
- Trigger content production
- Inspect approvals, blockers and recommendations

Example commands:

```text
Run Phase 1.

What information is still missing before Phase 1 can run?

Create a proof-led Reel from this review.

Upload this project photograph as proof.

Create three Content Opportunities from this customer message.

Plan next week’s Instagram content.

Generate briefs for every approved Content Item.

Start production for all approved carousels.

Schedule all approved content.

What content is working best for this client?

Create more content using the strongest-performing proof category.

Why is this client’s publishing workflow blocked?
```

The Client Automation tab should make the client context implicit. The operator should not need to repeat the client name in every instruction.

---

# 4. Target Architecture

```text
GLOBAL ADMIN CONTROL PLANE
        │
        ├── Select one or more clients
        ├── Natural-language instruction
        ├── File and image upload
        ├── Portfolio status and exception management
        └── Global automation policies
                    │
                    ▼
CLIENT-SCOPED AGENT SESSION
                    │
                    ├── Client identity and permissions
                    ├── Approved authority retrieval
                    ├── Operational-state retrieval
                    ├── Intent interpretation
                    ├── Plan construction
                    ├── Policy evaluation
                    └── Approval requirements
                    │
                    ▼
CANONICAL COMMAND REGISTRY
                    │
                    ├── Phase 1 commands
                    ├── Phase 2 commands
                    ├── Source and Proof commands
                    ├── Opportunity commands
                    ├── Calendar commands
                    ├── Brief and production commands
                    ├── Distribution commands
                    ├── Analytics commands
                    └── Iteration commands
                    │
                    ▼
WORKFLOW ORCHESTRATOR
                    │
                    ├── Persistent workflow runs
                    ├── Steps and dependencies
                    ├── Leases and ownership
                    ├── Retries and recovery
                    ├── Approval waits
                    ├── Provider waits
                    ├── Cost and capacity checks
                    └── Audit logging
                    │
                    ▼
EXISTING COCKPIT DOMAIN SYSTEMS
```

---

# 5. Major System Components

## 5.1 Client Knowledge Fabric

The Client Knowledge Fabric gives the AI reliable access to the correct client-specific information.

It combines:

- Structured database retrieval
- Approved Context Files
- Approved Execution Files
- Verified Proof Items
- Content Opportunities
- Content Items
- Production Briefs
- Published Assets
- Performance Insights
- Iteration history
- Full-text search
- Vector retrieval
- Metadata and authority filtering

The RAG layer is not the source of truth. It is a retrieval interface over canonical records.

### Required retrieval classes

1. Approved Business Context
2. Approved Client Strategic Systems
3. Approved Execution Intelligence
4. Verified Proof
5. Operational content and production data
6. Distribution state
7. Performance and commercial intelligence
8. Historical and superseded records
9. Draft and unapproved material

### Authority hierarchy

```text
Approved current Context authority
    outranks
Approved current Execution authority
    outranks
Verified current Proof
    outranks
Approved operational records
    outrank
Draft records
    outrank
Historical or superseded records
```

Retrieval must not allow a semantically similar draft or outdated document to override approved current authority.

### Recommended retrieval record

```yaml
id:
client_id:
document_type:
source_table:
source_record_id:
source_version:
approval_status:
authority_level:
content:
metadata:
content_hash:
embedding:
created_at:
superseded_at:
indexed_at:
```

### Retrieval requirements

- Client-scoped filtering before semantic ranking
- Approval and authority filtering
- Current-version preference
- Source citations
- Content-hash verification
- Re-indexing after approved updates
- Supersession and deletion handling
- Structured filters for proof permission and publication eligibility
- No cross-client vector leakage

---

## 5.2 Client Agent

Each client should have a logically isolated AI agent configuration.

The agent is not a separately trained foundation model. It is a client-scoped operating context that combines:

- The current client
- Client permissions
- Approved authority
- Retrieval tools
- Cockpit commands
- Automation policies
- Current workflow state
- Conversation history
- Model and cost configuration

### Agent configuration

```yaml
client_id:
agent_status:
default_model:
fallback_model:
system_prompt_version:
retrieval_policy_version:
command_policy_version:
automation_policy_id:
monthly_token_budget:
monthly_generation_budget:
allowed_commands:
approval_thresholds:
publishing_permissions:
paid_spend_permissions:
data_retention_policy:
```

### Agent responsibilities

- Interpret the operator’s request
- Resolve the target client
- Retrieve the minimum necessary context
- Identify missing information
- Build a structured execution plan
- Select approved commands
- Ask for approval where required
- Execute through the orchestrator
- Monitor the workflow
- Return evidence and links
- Explain failures and blockers

---

## 5.3 Command Registry

The AI must execute only through a versioned registry of approved Cockpit commands.

### Phase 1 commands

```text
check_phase_1_readiness
run_phase_1
generate_phase_1_file
regenerate_phase_1_file
submit_phase_1_file_for_review
approve_phase_1_file
finalise_phase_1
```

### Phase 2 commands

```text
check_phase_2_readiness
run_phase_2
generate_execution_file
regenerate_execution_file
submit_execution_file_for_review
approve_execution_file
finalise_phase_2
normalise_execution_requirements
```

### Source commands

```text
create_manual_idea
upload_proof_asset
extract_proof_item
verify_proof_item
create_source_from_customer_message
create_source_from_document
create_source_from_performance_insight
```

### Opportunity commands

```text
generate_opportunities_from_source
score_content_opportunities
shortlist_content_opportunity
reject_content_opportunity
find_supporting_proof
find_unused_proof
```

### Planning commands

```text
create_calendar_slots
match_opportunities_to_slots
generate_calendar_proposal
approve_calendar_proposal
commit_calendar_proposal
create_content_item
move_content_item
cancel_content_item
```

### Production commands

```text
generate_content_brief
approve_content_brief
set_production_mode
start_feed_post_production
start_carousel_production
start_story_production
start_reel_production
start_ad_production
retry_production_job
submit_external_asset
review_asset
approve_asset
```

### Distribution commands

```text
create_distribution_draft
schedule_distribution
publish_now
pause_scheduled_distribution
retry_distribution
reconcile_distribution
```

### Analytics and iteration commands

```text
collect_content_analytics
record_commercial_signal
analyse_performance
create_iteration_opportunities
promote_organic_asset_to_ad_opportunity
propose_execution_update
propose_context_update
```

### Administrative commands

```text
pause_client_automations
resume_client_automations
set_client_automation_policy
show_client_blockers
show_portfolio_blockers
show_pending_approvals
show_failed_workflows
retry_failed_workflow
cancel_workflow
```

Each command requires:

- Versioned input schema
- Versioned output schema
- Permission policy
- Approval policy
- Idempotency strategy
- Failure codes
- Audit event
- Client ownership validation
- Dry-run support where practical

---

## 5.4 Workflow Orchestrator

The orchestrator turns commands into durable multi-step workflows.

### Required workflow capabilities

- Persistent workflow runs
- Persistent workflow steps
- Dependency graph
- Waiting states
- Human approval waits
- Provider completion waits
- Cron resumption
- Lease ownership
- Retry limits
- Backoff
- Cancellation
- Compensation or rollback where practical
- Cost recording
- Capacity checks
- Timeout recovery
- Full audit history

### Recommended workflow statuses

```text
draft
planned
awaiting_approval
queued
running
waiting_external
waiting_human
partially_complete
completed
failed_retryable
failed_terminal
cancelled
```

### Recommended workflow tables

```text
ai_agent_sessions
ai_agent_messages
ai_agent_plans
ai_agent_plan_steps
cockpit_commands
workflow_runs
workflow_steps
workflow_events
workflow_approvals
workflow_failures
workflow_costs
workflow_schedules
client_automation_policies
client_automation_exceptions
```

### Workflow example: run Phase 1

```text
Check client inputs
→ Identify missing required fields
→ Confirm current Phase 1 status
→ Create Phase 1 generation run
→ Generate each required Context File
→ Validate output contracts
→ Persist files in review
→ Report completion and review requirements
```

### Workflow example: upload proof and create content

```text
Receive uploaded image
→ Assign to selected client
→ Store original asset
→ Extract metadata
→ Generate proof candidate
→ Ask for missing consent or context
→ Verify Proof Item
→ Index Proof Item
→ Generate Content Opportunities
→ Score Opportunities
→ Return recommendations
```

### Workflow example: create and schedule a proof Reel

```text
Select Proof Item
→ Retrieve client authority
→ Generate and score Reel Opportunities
→ Select or confirm one Opportunity
→ Create Content Item
→ Generate Content Brief
→ Approve under policy or request approval
→ Start Reel Studio
→ Produce or collect final Reel
→ Review final asset
→ Create distribution draft
→ Schedule publication
→ Return scheduled status and evidence
```

---

## 5.5 Automation Scheduler

The scheduler handles recurring and condition-based work.

### Recurring workflows

- Daily analytics collection
- Weekly content planning
- Weekly proof-gap scan
- Monthly Phase 2 preparation
- Daily publishing processing
- Daily failed-workflow review
- Weekly performance analysis
- Monthly client health report
- Periodic re-indexing
- Expired-proof permission checks

### Condition-based workflows

- When all Phase 1 files are approved, propose running Phase 2
- When Phase 2 is finalised, create the period’s Calendar requirements
- When a new Proof Item is verified, create Opportunities
- When a Calendar Item is approved, generate its Brief
- When a Brief is approved, start eligible production
- When an Asset is approved, prepare distribution
- When scheduled time arrives, publish
- When analytics threshold is reached, analyse performance
- When a content asset materially outperforms, create iteration and Ad Opportunities
- When a workflow fails, retry or escalate according to policy

### Scheduler requirements

- Idempotent recurring jobs
- Per-client timezone
- Per-client cadence
- Pause and resume
- Catch-up policy
- Missed-run handling
- Concurrency limits
- Cost limits
- Capacity limits
- Failure escalation
- Global emergency stop
- Client-specific emergency stop

---

# 6. Global Cockpit Admin Control Plane

## 6.1 Global AI Console

Add a main Cockpit AI Console accessible from the primary application navigation.

### Interface elements

- Natural-language input
- Client selector
- Multi-client selector
- File and image uploader
- Command preview
- Dry-run toggle
- Approval requirements
- Estimated affected records
- Estimated provider cost
- Execution button
- Live workflow timeline
- Results and evidence
- Conversation history

### Command interpretation states

```text
Understanding request
Retrieving client context
Checking prerequisites
Building plan
Awaiting confirmation
Executing
Waiting for external work
Waiting for approval
Completed
Blocked
Failed
```

### Mandatory plan preview

Before any write action, show:

- Target client or clients
- Interpreted objective
- Commands to be called
- Records to be created or changed
- Approval boundaries
- Publication or spend implications
- Missing prerequisites
- Estimated cost
- Whether the action can be reversed

Low-risk actions may be configured to skip confirmation. High-risk actions may not.

---

## 6.2 Portfolio Operations Dashboard

The global admin page should include portfolio-wide operational visibility.

### Required panels

- Phase 1 readiness by client
- Phase 2 readiness by client
- Current period planning status
- Unfilled content requirements
- Content in production
- Content awaiting approval
- Scheduled content
- Failed workflows
- Publishing exceptions
- Paid campaign exceptions
- Stale client data
- Proof gaps
- Queue depth
- Provider health
- Cost by client
- Capacity by client
- Pending administrator approvals

### Global actions

- Run eligible Phase 1 jobs
- Run eligible Phase 2 jobs
- Generate weekly proposals
- Retry safe failures
- Pause a provider
- Pause client automations
- Resume client automations
- Reassign work
- Change automation mode
- View client agent conversation
- Open the relevant client record

---

## 6.3 Global File and Proof Intake

The administrator must be able to upload a file once and assign it correctly.

### Intake workflow

```text
Upload file or image
→ Select client
→ Select or infer source type
→ Preview classification
→ Confirm consent and publication status
→ Store original
→ Create source record
→ Index the source
→ Trigger configured follow-up workflow
```

Supported source types:

- Proof photograph
- Customer review
- Customer message
- Testimonial
- Case study
- Project folder
- Business document
- Brand asset
- Market research
- Manual Idea attachment
- Performance export

The system must prevent an uploaded file from being indexed or used under the wrong client.

---

# 7. Client Automation Tab

The existing placeholder Automation tab should become the client’s AI operating centre.

## 7.1 Client AI Chat

The client is already selected, so the agent automatically operates inside that client’s scope.

### Main functions

- Ask questions about the client
- Trigger workflows
- Upload files and proof
- Create Manual Ideas
- Generate Content Opportunities
- Fill Calendar gaps
- Start production
- Schedule content
- Analyse performance
- Explain blockers
- Request or complete approvals

### Response requirements

Every agent response involving data or execution should show:

- Client
- Sources used
- Authority versions
- Commands called or proposed
- Current workflow status
- Records created
- Approval needed
- Next action
- Errors or blockers

---

## 7.2 Client Automation Policies

The tab should expose policy controls by workflow domain.

### Automation modes

```text
manual
assisted
automatic
disabled
```

### Policy groups

#### Phase 1

- Automatically run when required inputs are complete
- Automatically regenerate failed files
- Require approval before finalisation

#### Phase 2

- Automatically run when Phase 1 is finalised
- Generate monthly requirements automatically
- Require approval before Phase 2 finalisation

#### Proof

- Automatically process uploads
- Automatically create Proof Items
- Automatically create Opportunities after verification
- Require consent confirmation before public use

#### Ideation

- Automatically run seven-technique research
- Automatically score candidates
- Automatically create Calendar proposals
- Require approval before operational commitment

#### Planning

- Weekly proposal schedule
- Automatic slot matching
- Minimum Opportunity score
- Maximum topic repetition
- Required proof thresholds
- Capacity constraints

#### Production

- Automatic Brief generation
- Automatic AI production by format
- Human review requirements
- Client review requirements
- Retry limits
- Provider preferences

#### Distribution

- Automatic scheduling
- Automatic organic publishing
- Required final approval
- Blackout periods
- Posting windows
- Emergency pause

#### Ads

- Automatic creative generation
- Campaign draft generation
- Launch approval
- Spend limits
- Budget-change approval
- Pause thresholds

#### Analytics

- Collection cadence
- Commercial-signal reminders
- Performance-analysis thresholds
- Iteration-generation cadence

#### Context and strategy

- Automatically propose updates
- Never apply automatically
- Required administrator review
- Required client approval

---

## 7.3 Client Workflow Centre

Show all workflow runs for the selected client.

### Views

- Active
- Waiting for approval
- Scheduled
- Completed
- Retryable failures
- Terminal failures
- Cancelled

### Workflow detail

- Trigger
- Initiating user or automation
- Agent plan
- Steps
- Current step
- Input sources
- Output records
- Cost
- Duration
- Retries
- Failure reason
- Recovery actions
- Audit events

---

## 7.4 Client Knowledge and RAG Status

The Automation tab should show the health of the client’s AI knowledge.

### Status panels

- Approved Context indexed
- Approved Execution Files indexed
- Proof indexed
- Content history indexed
- Performance history indexed
- Last indexing run
- Failed indexing records
- Superseded records
- Knowledge freshness
- Missing authority
- Retrieval test

### Operator actions

- Re-index current authority
- Re-index Proof
- Remove an invalid index entry
- Inspect source citations
- Test a client query
- View authority hierarchy
- View retrieval configuration

---

# 8. Approval and Risk Model

## 8.1 Low-risk actions

May become automatic:

- Read-only queries
- Indexing approved files
- Extracting Proof candidates
- Generating Content Opportunities
- Scoring Opportunities
- Collecting analytics
- Detecting Calendar gaps
- Preparing briefs
- Creating iteration recommendations
- Retrying a safe idempotent read or generation job

## 8.2 Medium-risk actions

Assisted by default:

- Creating Calendar proposals
- Committing Content Items
- Generating finished content
- Selecting Proof for public use
- Scheduling organic content
- Repurposing successful content
- Changing production mode
- Reassigning production work

## 8.3 High-risk actions

Require explicit policy and approval:

- Publishing public content
- Launching Ads
- Changing paid budgets
- Changing Offers
- Approving Phase 1 or Phase 2 authority
- Applying Context updates
- Applying Execution updates
- Using sensitive Proof
- Deleting records
- Changing client permissions
- Bulk actions across multiple clients

---

# 9. Proprietary Client Intelligence Flywheel

The AI system should improve for each client as proprietary data accumulates.

## 9.1 Business intelligence

- Customer language
- Common objections
- Buying triggers
- Sales patterns
- Service-specific insights
- Regional context
- Operational differentiators

## 9.2 Proof intelligence

- Claims with verified support
- Strongest Proof by objection
- Unused Proof
- Overused Proof
- Proof permission state
- Proof formats that perform best
- Proof associated with commercial results

## 9.3 Content intelligence

- Best hooks
- Best structures
- Best formats
- Best visual treatments
- Best content pillars
- Best cadence
- Best offer relationships
- Best awareness stages

## 9.4 Commercial intelligence

- Content that produces conversations
- Conversations that qualify
- Content that contributes to appointments
- Proof that contributes to sales
- Campaigns associated with cash collected
- Customer-acquisition cost by content family

The resulting loop is:

```text
Client activity
→ New Proof and operational data
→ Better retrieval
→ Better Content Opportunities
→ Better content
→ Better performance data
→ Better client-specific decisions
```

---

# 10. Data Model

## 10.1 Agent and conversation entities

```text
ai_agent_configs
ai_agent_sessions
ai_agent_messages
ai_agent_retrieval_events
ai_agent_plans
ai_agent_plan_steps
ai_agent_command_calls
```

## 10.2 Knowledge entities

```text
client_knowledge_documents
client_knowledge_chunks
client_knowledge_embeddings
client_knowledge_index_runs
client_knowledge_supersessions
```

## 10.3 Command entities

```text
cockpit_command_definitions
cockpit_command_versions
cockpit_command_permissions
cockpit_command_executions
```

## 10.4 Workflow entities

```text
workflow_definitions
workflow_definition_versions
workflow_runs
workflow_steps
workflow_events
workflow_approvals
workflow_failures
workflow_costs
workflow_schedules
workflow_leases
```

## 10.5 Policy entities

```text
client_automation_policies
client_automation_policy_versions
client_automation_exceptions
global_automation_policies
automation_emergency_stops
```

## 10.6 Required ownership rules

Every client-scoped record must contain `client_id`.

Every child record must enforce composite ownership against its parent where practical.

No agent session, retrieval event, workflow or command execution may reference records belonging to another client.

---

# 11. Security and Governance

## 11.1 Client isolation

- Filter by `client_id` before retrieval
- Enforce RLS on client-scoped records
- Validate ownership in service-role functions
- Reject cross-client source references
- Do not rely only on model instructions for isolation
- Do not allow global chat history to leak client information

## 11.2 Tool permissions

Tool access must be determined by:

- User role
- Client access
- Command type
- Client automation policy
- Risk level
- Current approval state

## 11.3 Auditability

Every AI action must record:

- User
- Agent
- Client
- Conversation
- Interpreted intent
- Retrieved sources
- Plan
- Command calls
- Inputs
- Outputs
- Approval
- Cost
- Result
- Failure
- Timestamps

## 11.4 Prompt and model governance

Record:

- System prompt version
- Retrieval-policy version
- Command-policy version
- Model
- Provider
- Temperature and relevant settings
- Token usage
- Cost
- Structured-output schema version

## 11.5 Data controls

- Configurable retention
- Redaction
- Sensitive-proof restrictions
- Deletion propagation
- Re-indexing after deletion
- No training on client data unless explicitly authorised
- Clear distinction between AA data and client data

---

# 12. Implementation Programme

## Stage AI-A — Architecture and Command Boundary

### Objective

Lock the Phase 2 AI architecture before implementation.

### Work

- Define global and client AI surfaces
- Define Client Agent responsibilities
- Define command registry
- Define risk levels
- Define approval policies
- Define workflow boundaries
- Define retrieval authority hierarchy
- Define data ownership
- Define failure taxonomy
- Define cost and capacity policy

### Deliverables

- AI architecture specification
- Command catalogue
- Policy matrix
- Threat model
- Data dictionary
- State-machine diagrams

### Exit gate

No unresolved ambiguity remains about whether the AI, command layer or orchestrator owns a state transition.

---

## Stage AI-B — Client Knowledge Fabric

### Objective

Create client-scoped, version-aware retrieval over approved Cockpit data.

### Work

- Add knowledge-document and chunk tables
- Add embeddings
- Add indexing jobs
- Index approved Context Files
- Index approved Execution Files
- Index verified Proof
- Index content and performance data
- Implement authority ranking
- Implement source citations
- Implement supersession and deletion
- Implement hybrid retrieval
- Add retrieval tests

### Exit gate

A client-scoped query returns only authorised, current, correctly ranked sources with citations.

---

## Stage AI-C — Canonical Command Registry

### Objective

Expose Cockpit workflows as safe, versioned domain commands.

### Work

- Implement command definitions
- Implement typed schemas
- Wrap existing Phase 1 functions
- Wrap existing Phase 2 functions
- Wrap Source, Opportunity and planning functions
- Wrap production functions
- Wrap distribution functions
- Wrap analytics functions
- Add dry-run support
- Add permission checks
- Add idempotency
- Add audit logs

### Exit gate

Every supported AI action uses a command. No AI path writes directly to arbitrary operational tables.

---

## Stage AI-D — Durable Workflow Orchestrator

### Objective

Create persistent, recoverable multi-step workflow execution.

### Work

- Add workflow definitions and versions
- Add workflow runs and steps
- Add leases
- Add retries and backoff
- Add approval waits
- Add provider waits
- Add cancellation
- Add cost recording
- Add capacity checks
- Add cron resumption
- Add failure recovery
- Add workflow timeline API

### Exit gate

A multi-step workflow can survive interruption, resume safely and never duplicate completed work.

---

## Stage AI-E — Client Agent Runtime

### Objective

Create the client-scoped reasoning and planning runtime.

### Work

- Add agent configuration
- Add sessions and messages
- Add intent classification
- Add client retrieval
- Add plan generation
- Add command selection
- Add policy evaluation
- Add confirmation requirements
- Add execution monitoring
- Add result summarisation
- Add source citations
- Add failure explanations

### Exit gate

The Client Agent can safely interpret and execute a complete read and write workflow through canonical commands.

---

## Stage AI-F — Client Automation Tab

### Objective

Replace the placeholder Client Automation tab with the complete client AI operating centre.

### Work

- Add Client AI Chat
- Add file and Proof upload
- Add command preview
- Add live workflow progress
- Add approvals
- Add policy controls
- Add workflow history
- Add exception centre
- Add knowledge and RAG status
- Add schedules
- Add pause and emergency stop
- Add usage and cost display

### Exit gate

An operator can manage the client’s AI workflows, policies, knowledge and exceptions entirely from the Client Automation tab.

---

## Stage AI-G — Global Admin AI Console

### Objective

Add one interface for controlling all authorised clients.

### Work

- Add global chat
- Add client and multi-client selection
- Add global file intake
- Add multi-client command planning
- Add bulk eligibility checks
- Add plan previews
- Add portfolio workflow timeline
- Add pending approvals
- Add global pause and resume
- Add command history
- Add cross-client safety checks

### Exit gate

The administrator can issue a command for one or more clients and receive a safe, client-separated execution plan and result.

---

## Stage AI-H — Portfolio Operations Dashboard

### Objective

Give the administrator operational control over fulfilment at scale.

### Work

- Add readiness views
- Add blockers
- Add queue health
- Add provider health
- Add failed workflows
- Add pending approvals
- Add unfilled Calendar requirements
- Add production capacity
- Add cost by client
- Add workflow intervention actions
- Add navigation to client detail

### Exit gate

The administrator can identify and resolve the most important portfolio-wide fulfilment issues from one page.

---

## Stage AI-I — Scheduler and Recurring Automation

### Objective

Add cron, recurring and condition-based workflow execution.

### Work

- Add schedules
- Add timezone support
- Add catch-up policy
- Add missed-run policy
- Add concurrency controls
- Add cost limits
- Add daily analytics
- Add weekly planning
- Add monthly Phase 2 preparation
- Add distribution processing
- Add performance analysis
- Add automatic retry and escalation

### Exit gate

Configured recurring workflows run idempotently and produce visible, recoverable workflow records.

---

## Stage AI-J — Progressive Autonomy Policies

### Objective

Allow each client to move safely from manual to assisted to automatic operation.

### Work

- Add policy modes
- Add risk classification
- Add thresholds
- Add approval rules
- Add publishing rules
- Add paid-spend rules
- Add proof-permission rules
- Add Context-update rules
- Add override history
- Add emergency stops

### Exit gate

Every autonomous action is permitted by an explicit, versioned client or global policy.

---

## Stage AI-K — Proprietary Learning Integration

### Objective

Feed performance and commercial learning back into the client agent.

### Work

- Index performance insights
- Index commercial signals
- Create performance-led Opportunities
- Recommend reuse and repurposing
- Detect winning Proof categories
- Detect content saturation
- Detect underused Proof
- Create Ad promotion recommendations
- Propose Phase 2 updates
- Propose Context updates
- Preserve approval boundaries

### Exit gate

The agent can answer “what is working and what should we do next?” using attributable client-specific evidence.

---

## Stage AI-L — Multi-Client Scale and Cost Control

### Objective

Make the AI layer operationally viable for a solo founder managing many clients.

### Work

- Add client quotas
- Add monthly budgets
- Add provider budgets
- Add queue priorities
- Add concurrency by client
- Add capacity forecasting
- Add margin visibility
- Add model routing
- Add fallback providers
- Add usage alerts
- Add automatic pause thresholds

### Exit gate

No client can exhaust portfolio-wide capacity or spend without visibility and policy enforcement.

---

## Stage AI-M — End-to-End Golden Paths

### Objective

Prove the complete AI and automation layer.

### Required golden paths

#### Run Phase 1

```text
“Run Phase 1 for this client”
→ readiness check
→ missing-input response or execution
→ Context generation
→ validation
→ review status
→ result
```

#### Upload Proof

```text
Upload photograph
→ assign to client
→ classify
→ extract Proof
→ verify
→ index
→ generate Opportunities
→ return recommendations
```

#### Create and schedule content

```text
“Create a proof-led Reel and schedule it”
→ retrieve Proof
→ generate Opportunity
→ create Content Item
→ generate Brief
→ produce Reel
→ review
→ schedule
→ return evidence
```

#### Plan next week

```text
“Plan next week”
→ read Phase 2 requirements
→ create slots
→ retrieve Opportunities
→ score matches
→ generate proposal
→ request approval or commit under policy
```

#### Improve what is working

```text
“Do more of what is working”
→ analyse performance
→ identify validated patterns
→ create new Opportunities
→ propose future Content Items
```

#### Multi-client command

```text
“Generate Phase 2 for all eligible clients”
→ check each client independently
→ create separated plans
→ execute permitted clients
→ report successes and blockers
```

### Exit gate

All golden paths work through real command, workflow, persistence, permission and audit boundaries.

---

## Stage AI-N — Production Rollout

### Objective

Deploy the AI system safely.

### Rollout sequence

1. Internal test clients
2. AA as Client 001
3. Read-only client chat
4. Manual command execution
5. Assisted workflows
6. Automatic low-risk workflows
7. Automatic organic planning
8. Automatic production where reliable
9. Automatic scheduling under policy
10. Carefully controlled paid actions

### Exit gate

The system operates reliably across several clients with measurable reductions in manual fulfilment work.

---

# 13. Testing Requirements

## 13.1 Retrieval tests

- Correct client filtering
- No cross-client results
- Approved authority outranks drafts
- Current version outranks superseded version
- Proof permission filters
- Correct citations
- Deleted data no longer retrieves

## 13.2 Agent tests

- Correct intent
- Correct client
- Ambiguous-client handling
- Read versus write distinction
- Unsupported-command refusal
- Missing-prerequisite handling
- Approval handling
- Correct command plan
- No fabricated completion

## 13.3 Command tests

- Schema validation
- Permission denial
- Idempotent replay
- Cross-client rejection
- Failure codes
- Dry run
- Audit record
- Correct state transitions

## 13.4 Workflow tests

- Retry
- Stale lease
- Provider timeout
- Human approval wait
- Cancellation
- Partial completion
- Resume
- Duplicate trigger
- Cost-limit stop
- Emergency stop

## 13.5 UI tests

- Client AI Chat
- Global AI Console
- File upload
- Plan preview
- Approval
- Workflow timeline
- Failure recovery
- Policy editing
- Knowledge status
- Portfolio dashboard

## 13.6 Security tests

- RLS
- Service-role boundaries
- Client isolation
- Tool permission
- Prompt injection from uploaded documents
- Malicious Proof content
- Unsafe command construction
- Secret leakage
- Cross-client retrieval leakage

---

# 14. Success Metrics

## Efficiency

- Operator minutes per client per week
- Manual actions per published asset
- Percentage of workflows completed automatically
- Percentage completed in assisted mode
- Number of exceptions per client
- Mean time to recover failed workflows

## Quality

- Content approval rate
- Brief regeneration rate
- Production failure rate
- Proof accuracy rate
- Publishing error rate
- Retrieval citation accuracy
- Agent-command accuracy

## Commercial

- Fulfilment cost per client
- AI and provider cost per client
- Gross margin by client
- Content output per operator hour
- Qualified conversations
- Appointments
- Cash collected
- Customer-acquisition cost

## Learning

- Percentage of content linked to verified Proof
- Percentage of Opportunities informed by performance
- Unused strong Proof
- Winning patterns reused
- Client knowledge freshness
- Retrieval coverage

---

# 15. Final Target State

At completion, Cockpit should support both structured UI operation and conversational operation.

## Global administrator experience

The administrator can:

- Ask questions across the client portfolio
- Run Phase 1 or Phase 2 for selected clients
- Upload files and assign them to clients
- Create Proof Items and content
- Plan and start production
- Schedule distribution
- Inspect approvals and failures
- Control automation policies
- Monitor cost and capacity
- Manage exceptions

## Client Automation experience

Inside a client, the operator can:

- Ask the client agent anything grounded in the client’s authority and history
- Run client workflows
- Upload Proof
- Create Ideas
- Generate content
- Plan the Calendar
- Start production
- Schedule approved assets
- Analyse performance
- Configure automation
- Inspect the client’s knowledge and learning state

## Autonomous fulfilment experience

Once configured, Cockpit can:

```text
Ingest client information
→ run Phase 1
→ generate Phase 2
→ process Ideas, Proof and Research
→ create and score Opportunities
→ plan the Calendar
→ generate Briefs
→ start eligible production
→ route approvals
→ schedule and distribute
→ collect analytics
→ create iterations
→ surface only exceptions requiring human judgement
```

The intended result is not a completely unsupervised marketing system.

The intended result is a **highly automated, client-specific operating system in which the founder manages approvals, strategy and exceptions instead of manually moving every piece of work through fulfilment**.
