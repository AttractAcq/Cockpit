# Cockpit Programme Documents

The canonical planning authority for the Cockpit Stage A–P build programme.

These four documents were authored outside the repository and copied here
verbatim on **2026-07-31** during Stage A readiness remediation. The repository
copies are byte-identical to their sources (SHA-256 verified — hashes recorded
in `docs/PRE_STAGE_A_REPOSITORY_READINESS_REPORT.md` § "Stage A Readiness
Blocker Remediation"). They must not be reformatted, re-spelled or
"tidied" — any change is a deliberate revision of programme authority, not
maintenance.

---

## Authority

> Repository code and deployed infrastructure are the authority for the current
> implementation state. The programme documents are the authority for the
> intended future state and the sequence in which that future state will be
> implemented.

Where a programme document describes something that does not yet exist, the
repository is right about *what is* and the document is right about *what is
next*. Neither overrides the other; they answer different questions.

For current-state operating rules — positioning, offers, commercial authority,
architecture constraints and safety rules — the root `CLAUDE.md` and the Cockpit
`CLAUDE.md` remain authoritative.

---

## The documents

### `High_level_Cockpit_Audit_30_01_2026.md` — architecture audit

The verified high-level current state: existing Cockpit capabilities,
architectural conflicts, missing systems, the target architecture, and
recommended implementation priorities.

Covers the executive assessment; Phase 1, 2 and 3 assessments; the conflict
between legacy Phase 3 and the newer Ideation flow; manual idea entry;
proof-led entry; seven-technique research-led Ideation; Content Opportunity
convergence; Calendar and Content Item architecture; Content Briefs and
production; Reel Studio; carousels, stories and feed posts; ads; organic
distribution; analytics and iteration; automation; maturity assessment; target
architecture; and the recommended implementation sequence.

### `Cockpit_Build_Plan.md` — canonical build plan

**The authoritative Stage A–P implementation sequence.** All sixteen stages are
present exactly once:

| Stage | Name |
|---|---|
| A | Repository Reconciliation and Frozen Baseline |
| B | Canonical Architecture and Data Spine |
| C | Phase 1 Intelligence Hardening |
| D | Phase 2 Executable Contract |
| E | Unified Content Source Layer |
| F | Content Opportunity Intelligence |
| G | Calendar Planning and Operational Commitment |
| H | Content Item and Brief Migration |
| I | Shared Production Studio Framework |
| J | Reel Studio Completion |
| K | Organic Distribution Consolidation |
| L | Ad Studio and Paid Distribution |
| M | Analytics and Closed-Loop Iteration |
| N | Automation and Fulfilment Orchestration |
| O | Multi-Client Scale and Operational Control |
| P | End-to-End Hardening and Legacy Retirement |

Each stage carries an objective, scope, required outputs, acceptance criteria
and an exit gate, plus migration and compatibility expectations.

### `Cockpit_Build_Plan_Prompts_Rendered.md` — stage execution prompts

One complete implementation prompt per stage — **16 prompts**, each delimited by
an outer four-backtick fence so that three-backtick code examples inside a
prompt do not terminate it.

These prompts **operationalise** the build plan; they do not replace it. Where a
prompt and the build plan disagree, the build plan governs.

**Run them sequentially. A stage must satisfy its exit gate before the next
stage begins.**

### `phase_2_ai_build_plan.md` — AI and automation layer

The later AI and automation layer, layered on top of the Stage A–P programme:
global Cockpit admin AI console and multi-client administration; the
client-specific Automation tab; client AI chat; the Client Knowledge Fabric;
RAG and hybrid retrieval with authority ranking; the Client Agent runtime; the
canonical command registry; durable workflow orchestration; cron, recurring and
condition-based automation; progressive autonomy policies; the Portfolio
Operations Dashboard; global file and proof intake; multi-client isolation; cost
and capacity controls; security and governance; AI implementation stages;
end-to-end golden paths; and production rollout.

---

## Programme execution status

Pre-Stage-A readiness is confirmed in
[`../PRE_STAGE_A_REPOSITORY_READINESS_REPORT.md`](../PRE_STAGE_A_REPOSITORY_READINESS_REPORT.md).
Stage A implementation evidence is recorded in
[`../STAGE_A_IMPLEMENTATION_REPORT.md`](../STAGE_A_IMPLEMENTATION_REPORT.md),
with the current machine-readable inventory in
[`../stage-a-current-state-inventory.json`](../stage-a-current-state-inventory.json).

The Programme Stage A repository implementation and evidence gates are complete
and awaiting the Programme Orchestrator's independent verification, owned
snapshot commit, and integration. The live Supabase ledger, dry run, database
lint, Edge Function list, production schema snapshot, and GitHub Pages state are
captured in the sanitized evidence summary; version-controlled, hashed local
transcripts show the production build and the Route B baseline rebuilt and
verified in a disposable local Supabase stack. The database transcript is also
bound to the exact versioned runner, SQL, configuration, manifest, and applicable
migration bytes that produced it. **Programme Stage B must
not begin until Programme Stage A has passed independent verification,
received human approval, and its approved snapshot has been integrated by the
Programme Orchestrator.**

Once those Stage A exit-gate actions are recorded, the next programme action is
**Programme Stage B — Canonical Architecture and Data Spine**.
