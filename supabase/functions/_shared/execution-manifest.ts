export type ExecutionGroup =
  | "Strategy and Proof"
  | "Channel Masters"
  | "Calendar and Workflow"
  | "Measurement"
  | "Governance";

export interface ExecutionFileDefinition {
  fileNumber: number;
  code: `E${string}`;
  fileName: string;
  title: string;
  group: ExecutionGroup;
  phase: "Stage 2" | "Governance";
  statusBaseline: string;
  confidence: "high";
  canonical: true;
  description: string;
  note?: string;
  directInputs: string[];
  directOutputs: string[];
  contextFileNumbers: number[];
  instruction: string;
}

export const EXECUTION_FILE_MANIFEST = [
  {
    fileNumber: 1, code: "E01", fileName: "01_Client_Strategy_Master.md", title: "Client Strategy Master", group: "Strategy and Proof", phase: "Stage 2", statusBaseline: "planned", confidence: "high", canonical: true,
    description: "Monthly objective, constraint, beliefs, proof priorities, offer, channels and risks.",
    directInputs: ["A04 — Master Strategy Agent", "E11 — 11_Stage_2_SOP_and_Laws.md"],
    directOutputs: ["A05 — Organic Master Agent", "A06 — Ads Master Agent", "A07 — Story Master Agent", "A08 — Content Calendar Agent", "E10 — 10_Proof_Master_Plan.md", "E09 — 09_Performance_Tracking_Plan.md", "O03 — Positioning & Messaging System", "O04 — Premium Content Production & Management"],
    contextFileNumbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 16],
    instruction: "Define the monthly strategic operating brief: objective, binding constraints, audience beliefs, offer routing, proof priorities, channel roles, risks, dependencies, decisions and unresolved verification items.",
  },
  {
    fileNumber: 2, code: "E02", fileName: "02_Organic_Master_Plan.md", title: "Organic Master Plan", group: "Channel Masters", phase: "Stage 2", statusBaseline: "planned", confidence: "high", canonical: true,
    description: "Row-level organic asset database with immutable refs and production fields.",
    directInputs: ["A05 — Organic Master Agent", "E11 — 11_Stage_2_SOP_and_Laws.md"],
    directOutputs: ["A08 — Content Calendar Agent", "A09 — Asset Brief Agent", "E09 — 09_Performance_Tracking_Plan.md", "A10 — Editor Brief Agent", "A11 — Designer Brief Agent", "A12 — Caption Agent", "A13 — Script Agent", "A14 — Carousel Copy Agent", "A17 — AI Asset Generation Agent", "O04 — Premium Content Production & Management", "O10 — Organic Distribution System"],
    contextFileNumbers: [0, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15],
    instruction: "Define the organic master schema and operating plan, including immutable reference rules, pillars, formats, production fields, proof constraints, CTA rules and Phase 3 row requirements. Do not create the final content rows.",
  },
  {
    fileNumber: 3, code: "E03", fileName: "03_Ads_Master_Plan.md", title: "Ads Master Plan", group: "Channel Masters", phase: "Stage 2", statusBaseline: "deferred", confidence: "high", canonical: true,
    description: "Campaign-stint database with up to three concurrent lanes.",
    directInputs: ["A06 — Ads Master Agent", "E11 — 11_Stage_2_SOP_and_Laws.md"],
    directOutputs: ["A08 — Content Calendar Agent", "A09 — Asset Brief Agent", "E09 — 09_Performance_Tracking_Plan.md", "A16 — Ad Creative Brief Agent", "A17 — AI Asset Generation Agent", "O09 — Paid Distribution & Retargeting System"],
    contextFileNumbers: [0, 2, 3, 4, 5, 6, 7, 11, 13, 14, 16],
    instruction: "Define the ads master schema and activation plan for up to three lanes, including objectives, audience direction, offer routing, proof constraints, dependencies and Phase 3 row requirements. Preserve deferred states; do not invent performance data.",
  },
  {
    fileNumber: 4, code: "E04", fileName: "04_Story_Master_Plan.md", title: "Story Master Plan", group: "Channel Masters", phase: "Stage 2", statusBaseline: "confirmed", confidence: "high", canonical: true,
    description: "Separate story database with sequences, frames, proof, dates and claim restrictions.", note: "Final decision: separate from Organic Master.",
    directInputs: ["A07 — Story Master Agent", "E11 — 11_Stage_2_SOP_and_Laws.md"],
    directOutputs: ["A08 — Content Calendar Agent", "A09 — Asset Brief Agent", "E09 — 09_Performance_Tracking_Plan.md", "A15 — Story Frame Agent", "A17 — AI Asset Generation Agent", "O05 — Story & Daily Trust System"],
    contextFileNumbers: [0, 2, 4, 5, 7, 10, 13, 14, 15],
    instruction: "Define the separate Story Master schema and operating plan: sequences, frame logic, proof fields, dates, engagement prompts, claim restrictions and Phase 3 row requirements. Do not create final story rows.",
  },
  {
    fileNumber: 5, code: "E05", fileName: "05_Content_Calendar.md", title: "Content Calendar", group: "Calendar and Workflow", phase: "Stage 2", statusBaseline: "planned", confidence: "high", canonical: true,
    description: "Dated monthly execution calendar with code-only cells.",
    directInputs: ["P13 — Content Calendar Playbook", "A08 — Content Calendar Agent", "E11 — 11_Stage_2_SOP_and_Laws.md"],
    directOutputs: ["A09 — Asset Brief Agent", "A19 — Approval Agent", "A20 — Distribution Agent", "E09 — 09_Performance_Tracking_Plan.md", "A18 — Production Check Agent", "A23 — Reporting Agent", "O04 — Premium Content Production & Management", "O05 — Story & Daily Trust System", "O09 — Paid Distribution & Retargeting System", "O10 — Organic Distribution System"],
    contextFileNumbers: [0, 9, 10, 11, 13, 14, 15, 18],
    instruction: "Define the dated monthly calendar contract, code-only cell rules, required slots, sequencing, consistency checks and Phase 3 calendar schema. Do not create the final dated calendar cells.",
  },
  {
    fileNumber: 6, code: "E06", fileName: "06_Asset_Brief_Index.md", title: "Asset Brief Index", group: "Calendar and Workflow", phase: "Stage 2", statusBaseline: "partial", confidence: "high", canonical: true,
    description: "Database-backed bridge from Stage 2 planning to Stage 3 production.",
    directInputs: ["A09 — Asset Brief Agent", "E11 — 11_Stage_2_SOP_and_Laws.md"],
    directOutputs: ["A10 — Editor Brief Agent", "A11 — Designer Brief Agent", "A12 — Caption Agent", "A13 — Script Agent", "A14 — Carousel Copy Agent", "A15 — Story Frame Agent", "A16 — Ad Creative Brief Agent", "A17 — AI Asset Generation Agent", "A18 — Production Check Agent", "O04 — Premium Content Production & Management", "O05 — Story & Daily Trust System", "O09 — Paid Distribution & Retargeting System", "O10 — Organic Distribution System", "O11 — Sales Enablement Asset System"],
    contextFileNumbers: [0, 4, 5, 7, 9, 10, 11, 14, 15, 18, 19],
    instruction: "Define the Asset Brief Index schema and handoff rules: immutable brief IDs, source refs, owners, asset types, production states, proof dependencies, approvals and downstream production contracts. Do not create production assets.",
  },
  {
    fileNumber: 7, code: "E07", fileName: "07_Distribution_Schedule.md", title: "Distribution Schedule", group: "Calendar and Workflow", phase: "Stage 2", statusBaseline: "missing", confidence: "high", canonical: true,
    description: "Exact platform, date, time, asset, destination, state and published URL plan.",
    directInputs: ["A20 — Distribution Agent", "E11 — 11_Stage_2_SOP_and_Laws.md"],
    directOutputs: ["A20 — Distribution Agent", "O09 — Paid Distribution & Retargeting System", "O10 — Organic Distribution System"],
    contextFileNumbers: [0, 8, 9, 10, 11, 13, 14, 15, 18],
    instruction: "Define the Distribution Schedule schema and workflow for platform, date, time, source ref, destination, publishing state and published URL. Preserve unverified platforms and destinations as unresolved.",
  },
  {
    fileNumber: 8, code: "E08", fileName: "08_Approval_Tracker.md", title: "Approval Tracker", group: "Calendar and Workflow", phase: "Stage 2", statusBaseline: "missing", confidence: "high", canonical: true,
    description: "Review, revision, compliance and final approval tracking.",
    directInputs: ["A19 — Approval Agent", "E11 — 11_Stage_2_SOP_and_Laws.md"],
    directOutputs: ["A20 — Distribution Agent", "O09 — Paid Distribution & Retargeting System", "O10 — Organic Distribution System"],
    contextFileNumbers: [0, 4, 5, 7, 14, 18],
    instruction: "Define the Approval Tracker schema, review sequence, revision history, compliance checks, approver roles, blocking states and final approval rules. Approval must remain human-controlled.",
  },
  {
    fileNumber: 9, code: "E09", fileName: "09_Performance_Tracking_Plan.md", title: "Performance Tracking Plan", group: "Measurement", phase: "Stage 2", statusBaseline: "planned", confidence: "high", canonical: true,
    description: "Defines what the month will measure before publication.",
    directInputs: ["E01 — 01_Client_Strategy_Master.md", "E02 — 02_Organic_Master_Plan.md", "E03 — 03_Ads_Master_Plan.md", "E04 — 04_Story_Master_Plan.md", "E05 — 05_Content_Calendar.md", "C16 — 16_Performance_Report.md", "E11 — 11_Stage_2_SOP_and_Laws.md"],
    directOutputs: ["A23 — Reporting Agent", "O09 — Paid Distribution & Retargeting System", "O12 — Performance Intelligence & Iteration System"],
    contextFileNumbers: [0, 3, 9, 10, 11, 13, 15, 16, 17],
    instruction: "Define the pre-publication measurement contract: objectives, leading and lagging indicators, source refs, collection cadence, baselines, attribution limits, decision thresholds and reporting schema. Do not invent baseline or performance values.",
  },
  {
    fileNumber: 10, code: "E10", fileName: "10_Proof_Master_Plan.md", title: "Proof Master Plan", group: "Strategy and Proof", phase: "Stage 2", statusBaseline: "confirmed", confidence: "high", canonical: true,
    description: "Monthly proof, gap, capture, consent, claim, strength and downstream-ref database.", note: "First-class operational component; formerly described as an extension.",
    directInputs: ["C04 — 04_Proof_Bank.md", "C05 — 05_Proof_Gap_Report.md", "C06 — 06_Positioning_And_Angle_Map.md", "E01 — 01_Client_Strategy_Master.md", "E11 — 11_Stage_2_SOP_and_Laws.md"],
    directOutputs: ["A05 — Organic Master Agent", "A06 — Ads Master Agent", "A07 — Story Master Agent", "A09 — Asset Brief Agent", "A19 — Approval Agent", "A10 — Editor Brief Agent", "A11 — Designer Brief Agent", "A12 — Caption Agent", "A13 — Script Agent", "A14 — Carousel Copy Agent", "A15 — Story Frame Agent", "A16 — Ad Creative Brief Agent", "A17 — AI Asset Generation Agent", "O02 — Proof Extraction System", "O04 — Premium Content Production & Management", "O05 — Story & Daily Trust System", "O09 — Paid Distribution & Retargeting System", "O11 — Sales Enablement Asset System"],
    contextFileNumbers: [0, 3, 4, 5, 6, 7, 14, 18, 19],
    instruction: "Define the first-class Proof Master schema and monthly capture plan: proof refs, gaps, source, consent, claim boundary, strength, verification state and downstream usage. External client proof remains absent unless approved authority explicitly provides it.",
  },
  {
    fileNumber: 11, code: "E11", fileName: "11_Stage_2_SOP_and_Laws.md", title: "Stage 2 SOP and Laws", group: "Governance", phase: "Governance", statusBaseline: "confirmed", confidence: "high", canonical: true,
    description: "Binding governance for refs, statuses, proof, approvals, calendar consistency and handoff.", note: "First-class operational component; formerly described as an extension.",
    directInputs: ["None"],
    directOutputs: ["E01 — 01_Client_Strategy_Master.md", "E02 — 02_Organic_Master_Plan.md", "E03 — 03_Ads_Master_Plan.md", "E04 — 04_Story_Master_Plan.md", "E05 — 05_Content_Calendar.md", "E06 — 06_Asset_Brief_Index.md", "E07 — 07_Distribution_Schedule.md", "E08 — 08_Approval_Tracker.md", "E09 — 09_Performance_Tracking_Plan.md", "E10 — 10_Proof_Master_Plan.md"],
    contextFileNumbers: Array.from({ length: 21 }, (_, number) => number),
    instruction: "Define binding Stage 2 governance: canonical refs, statuses, proof and claim rules, human approvals, revision control, calendar consistency, handoff contracts, validation failures and exception handling.",
  },
] as const satisfies readonly ExecutionFileDefinition[];

export type ExecutionFileCode = typeof EXECUTION_FILE_MANIFEST[number]["code"];
export const EXECUTION_FILE_COUNT = EXECUTION_FILE_MANIFEST.length;
export const EXECUTION_GROUP_ORDER: readonly ExecutionGroup[] = ["Strategy and Proof", "Channel Masters", "Calendar and Workflow", "Measurement", "Governance"];

export function executionDefinitionByCode(code: string) {
  return EXECUTION_FILE_MANIFEST.find((definition) => definition.code === code);
}

export function executionDefinitionByNumber(fileNumber: number) {
  return EXECUTION_FILE_MANIFEST.find((definition) => definition.fileNumber === fileNumber);
}
