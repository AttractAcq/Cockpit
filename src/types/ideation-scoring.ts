export type IdeationPriorityBand = "top" | "high" | "medium" | "low";
export type IdeationScoringRunStatus = "running" | "retryable" | "completed" | "failed";

export const IDEATION_SCORE_DIMENSIONS = [
  { key: "execution_plan_alignment", label: "Execution-plan alignment", weight: 20 },
  { key: "business_and_positioning_alignment", label: "Business and positioning alignment", weight: 15 },
  { key: "audience_and_pain_relevance", label: "Audience and pain relevance", weight: 15 },
  { key: "proof_and_evidence_strength", label: "Proof and evidence strength", weight: 15 },
  { key: "hook_and_attention_strength", label: "Hook and attention strength", weight: 10 },
  { key: "commercial_potential", label: "Commercial potential", weight: 10 },
  { key: "specificity_and_clarity", label: "Specificity and clarity", weight: 5 },
  { key: "originality_and_distinctiveness", label: "Originality and distinctiveness", weight: 5 },
  { key: "platform_and_format_fit", label: "Platform and format fit", weight: 3 },
  { key: "production_feasibility", label: "Production feasibility", weight: 2 },
] as const;

export type IdeationScoreDimensionKey = typeof IDEATION_SCORE_DIMENSIONS[number]["key"];

export interface IdeationScoringRun {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  status: IdeationScoringRunStatus;
  configuration_hash: string;
  rubric_slug: string;
  rubric_version: string;
  prompt_digest: string;
  provider: string;
  model: string;
  output_schema_version: string;
  module_version: string;
  expected_candidate_count: number;
  scored_candidate_count: number;
  failed_candidate_count: number;
  attempt_count: number;
  maximum_attempts: number;
  retryable: boolean;
  warnings: Array<{
    batch_index?: number;
    candidate_ids?: string[];
    code?: string;
    message?: string;
    retryable?: boolean;
  }>;
  error_code: string | null;
  error_message: string | null;
  supersedes_scoring_run_id: string | null;
  started_at: string;
  completed_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdeationCandidateScore {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  scoring_run_id: string;
  candidate_id: string;
  candidate_content_hash: string;
  candidate_evidence_hash: string;
  execution_plan_alignment: number;
  business_and_positioning_alignment: number;
  audience_and_pain_relevance: number;
  proof_and_evidence_strength: number;
  hook_and_attention_strength: number;
  commercial_potential: number;
  specificity_and_clarity: number;
  originality_and_distinctiveness: number;
  platform_and_format_fit: number;
  production_feasibility: number;
  overall_score: number;
  priority_band: IdeationPriorityBand;
  rank: number | null;
  rationale: string;
  strengths: string[];
  risks: string[];
  authority_references: string[];
  evidence_references: string[];
  provider: string;
  model: string;
  rubric_slug: string;
  rubric_version: string;
  prompt_version: string;
  output_schema_version: string;
  created_at: string;
}

export interface IdeationScoringOverview {
  scoring_runs: IdeationScoringRun[];
  scores: IdeationCandidateScore[];
}

export interface ScoreIdeationCandidatesInput {
  client_id: string;
  ideation_cycle_id: string;
  /** Present only for an explicit, confirmed re-score of a completed run. */
  rescore_of_scoring_run_id?: string;
}

export interface ScoreIdeationCandidatesResponse {
  ok: true;
  created: boolean;
  idempotent_replay: boolean;
  reclaimed?: boolean;
  scoring_run: IdeationScoringRun;
  scores: IdeationCandidateScore[];
}

export interface IdeationScoringInvocationFailure {
  code: string;
  message: string;
  retryable: boolean;
  scoring_run_id: string | null;
  ideation_cycle_id: string | null;
  scoring_run: IdeationScoringRun | null;
  scoring_run_status: IdeationScoringRunStatus | null;
  scores: IdeationCandidateScore[];
  warnings: IdeationScoringRun["warnings"];
  expected_candidate_count: number | null;
  scored_candidate_count: number | null;
  failed_candidate_count: number | null;
  shortfall: number | null;
  attempt_count: number | null;
  maximum_attempts: number | null;
  terminal_reason: string | null;
  retry_allowed: boolean;
}

/** Server-owned band thresholds, mirrored for display only. */
export function priorityBandLabel(band: IdeationPriorityBand): string {
  return { top: "Top", high: "High", medium: "Medium", low: "Low" }[band];
}
