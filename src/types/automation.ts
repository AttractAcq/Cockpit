// Programme Stage N — Automation and Fulfilment Orchestration, frontend types.

export type AutomationArea =
  | "source_processing" | "opportunity_generation" | "scoring" | "weekly_planning" | "proposal_approval"
  | "brief_generation" | "production_start" | "human_review" | "client_review" | "scheduling" | "publishing"
  | "analytics_collection" | "iteration_generation" | "paid_campaign_actions";

export const AUTOMATION_AREAS: AutomationArea[] = [
  "source_processing", "opportunity_generation", "scoring", "weekly_planning", "proposal_approval",
  "brief_generation", "production_start", "human_review", "client_review", "scheduling", "publishing",
  "analytics_collection", "iteration_generation", "paid_campaign_actions",
];

export const AUTOMATION_AREA_LABEL: Record<AutomationArea, string> = {
  source_processing: "Source processing", opportunity_generation: "Opportunity generation", scoring: "Scoring",
  weekly_planning: "Weekly planning", proposal_approval: "Proposal approval", brief_generation: "Brief generation",
  production_start: "Production start", human_review: "Human review", client_review: "Client review",
  scheduling: "Scheduling", publishing: "Publishing", analytics_collection: "Analytics collection",
  iteration_generation: "Iteration generation", paid_campaign_actions: "Paid campaign actions",
};

export type AutomationLevel = "manual" | "assisted" | "automatic";

export interface ClientAutomationPolicyRow {
  id: string;
  client_id: string;
  area: AutomationArea;
  automation_level: AutomationLevel;
  thresholds: Record<string, unknown>;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ClientPriority = "low" | "normal" | "high";

export interface ClientCapacityPolicyRow {
  id: string;
  client_id: string;
  monthly_generation_budget_units: number | null;
  per_asset_budget_units: number | null;
  provider_credit_budget_units: number | null;
  max_simultaneous_jobs: number | null;
  human_review_capacity_per_day: number | null;
  client_priority: ClientPriority;
  due_date_priority_enabled: boolean;
  retry_cap: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ExceptionType =
  | "failed_job" | "missing_approval" | "missing_proof" | "provider_error" | "budget_exceeded"
  | "invalid_claim" | "distribution_failure" | "attribution_gap" | "stale_workflow";

export const EXCEPTION_TYPE_LABEL: Record<ExceptionType, string> = {
  failed_job: "Failed job", missing_approval: "Missing approval", missing_proof: "Missing Proof",
  provider_error: "Provider error", budget_exceeded: "Budget exceeded", invalid_claim: "Invalid claim",
  distribution_failure: "Distribution failure", attribution_gap: "Attribution gap", stale_workflow: "Stale workflow",
};

export type ExceptionStatus = "open" | "acknowledged" | "resolved";
export type ExceptionSeverity = "low" | "medium" | "high";

export interface ClientExceptionQueueRow {
  id: string;
  client_id: string;
  exception_type: ExceptionType;
  source_system: string;
  source_table: string | null;
  source_id: string | null;
  title: string;
  summary: string;
  severity: ExceptionSeverity;
  status: ExceptionStatus;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
