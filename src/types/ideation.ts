export type IdeationPeriodType = "one_day" | "one_week" | "date_range" | "one_month";
export type IdeationAssetType = "reel" | "carousel" | "static" | "story";
export type IdeationCandidateStatus = "draft" | "needs_review";
export type IdeationEvidenceType = "exact_quote" | "paraphrase" | "derived_claim";

export interface IdeationTechnique {
  slug: string;
  name: string;
  version: number;
  order: number;
}

export interface IdeationRun {
  id: string;
  client_id: string;
  period_type: IdeationPeriodType;
  period_start: string;
  period_end: string;
  execution_months: string[];
  status: "running" | "retryable" | "completed" | "failed";
  idempotency_key: string;
  quantity_plan: {
    total?: number;
    by_asset_type?: Partial<Record<IdeationAssetType, number>>;
    monthly_plans?: Array<{
      month: string;
      weekly_quotas: Record<IdeationAssetType, number>;
      by_asset_type: Record<IdeationAssetType, number>;
      total: number;
      source_file_name: string;
      source_section: string;
      authority_mode?: "machine_contract" | "legacy_rule_2";
    }>;
  };
  configuration_snapshot: Record<string, unknown>;
  slot_allocation: Record<string, IdeationAssetType[]>;
  technique_summary: unknown[];
  expected_candidate_count: number;
  candidate_count: number;
  shortfall_count: number;
  retryable: boolean;
  attempt_count: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_heartbeat_at: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdeationTechniqueRun {
  id: string;
  client_id: string;
  technique_slug: string;
  technique_version: number;
  technique_order: number;
  technique_snapshot: {
    name?: string;
    [key: string]: unknown;
  };
  ideation_cycle_id: string;
  status: string;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  error_code: string | null;
  error_message: string | null;
  requested_slots: IdeationAssetType[];
  generated_slots: number;
  failed_slots: number;
  retryable: boolean;
  attempt_count: number;
  started_at: string;
  finished_at: string | null;
}

export interface IdeationResearchResult {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  technique_run_id: string;
  research_key: string;
  source_identifier: string;
  source_type:
    | "approved_context"
    | "approved_strategic_playbook"
    | "approved_execution"
    | "approved_intelligence"
    | "approved_authority_bundle"
    | "external_research";
  source_url: string;
  source_title: string;
  source_excerpt: string;
  source_provider: string;
  retrieved_at: string;
  content_hash: string;
  status: string;
  source_findings: Record<string, unknown>;
  analysis_provider: string | null;
  analysis_model: string | null;
  analysis_prompt_version: string | null;
  analysis_output_schema_version: string | null;
  analyzed_at: string | null;
  analysis_findings: Record<string, unknown>;
  analysis_source_references: unknown[];
  created_at: string;
}

export interface IdeationCandidate {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  technique_run_id: string;
  research_result_id: string;
  candidate_index: number;
  asset_type: IdeationAssetType;
  status: IdeationCandidateStatus;
  working_title: string;
  hook: string;
  core_message: string;
  psychological_angle: string | null;
  cta: string;
  evidence_references: Array<{
    evidence_type: IdeationEvidenceType;
    source_ids: string[];
    source_ref: string;
    source_url: string;
    claim: string;
    quoted_text?: string;
    support_span?: string;
    support_note?: string;
    reasoning_note?: string;
  }>;
  draft_payload: Record<string, unknown>;
  model_provider: string;
  model_name: string;
  prompt_version: string;
  output_schema_version: string;
  input_hash: string;
  created_at: string;
  technique: IdeationTechnique | null;
  technique_run: IdeationTechniqueRun | null;
  research_result: IdeationResearchResult | null;
}

export interface IdeationOverview {
  runs: IdeationRun[];
  technique_runs: IdeationTechniqueRun[];
  research_results: IdeationResearchResult[];
  candidates: IdeationCandidate[];
}

export interface RunIdeationInput {
  client_id: string;
  period_type: IdeationPeriodType;
  start_date?: string;
  end_date?: string;
  month?: string;
  idempotency_key: string;
}

export interface RunIdeationResponse {
  ok: true;
  created: boolean;
  idempotent_replay: boolean;
  reclaimed?: boolean;
  run: IdeationRun;
  technique_runs: IdeationTechniqueRun[];
  research_results: IdeationResearchResult[];
  candidates: IdeationCandidate[];
  warnings: Array<{
    technique: string;
    code: string;
    message: string;
    retryable: boolean;
    requested_slots: number;
    generated_slots: number;
  }>;
}

export interface IdeationInvocationFailure {
  code: string;
  message: string;
  retryable: boolean;
  cycle_id: string | null;
  run: IdeationRun | null;
  technique_runs: IdeationTechniqueRun[];
  research_results: IdeationResearchResult[];
  candidates: IdeationCandidate[];
  warnings: RunIdeationResponse["warnings"];
  failed_techniques: string[];
  failed_technique_details: RunIdeationResponse["warnings"];
  expected_total: number | null;
  generated_total: number | null;
  shortfall: number | null;
  cycle_status: IdeationRun["status"] | null;
  attempt_count: number | null;
  maximum_attempts: number | null;
  terminal_reason: string | null;
  retry_allowed: boolean;
}
