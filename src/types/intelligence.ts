export type IntelligenceDomain =
  | "market_os"
  | "avatar_os"
  | "competitor_os"
  | "association_os"
  | "brand_strategist";

export type IntelligenceExecutionStatus =
  | "queued"
  | "running"
  | "waiting_provider"
  | "completed"
  | "completed_partial"
  | "failed"
  | "cancelled";

export type IntelligenceReleaseStatus =
  | "draft"
  | "needs_review"
  | "approved"
  | "superseded"
  | "archived";

export type FindingDisposition = "asserted" | "unknown" | "not_relevant";
export type FindingConfidence = "verified" | "strongly_inferred" | "weakly_inferred" | "modelled";
export type FindingContradictionStatus = "none" | "unresolved" | "resolved";
export type IntelligenceReviewDecision = "approved" | "changes_requested" | "rejected";
export type IntelligenceFreshness = "not_available" | "fresh" | "due" | "stale";

export interface IntelligenceResearchRun {
  id: string;
  client_id: string;
  research_domain: string;
  intelligence_domain: IntelligenceDomain | null;
  status: IntelligenceExecutionStatus;
  idempotency_key: string;
  provider: string | null;
  model: string | null;
  configuration_snapshot: Record<string, unknown>;
  source_count: number;
  attempt_count: number;
  maximum_attempts: number;
  retryable: boolean;
  failure_code: string | null;
  failure_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntelligenceResearchStep {
  id: string;
  client_id: string;
  research_run_id: string;
  step_key: string;
  step_order: number;
  title: string;
  status: "queued" | "running" | "waiting_provider" | "completed" | "failed" | "cancelled";
  attempt_count: number;
  maximum_attempts: number;
  failure_code: string | null;
  failure_message: string | null;
  output_summary: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntelligenceRelease {
  id: string;
  client_id: string;
  intelligence_domain: IntelligenceDomain;
  version: number;
  status: IntelligenceReleaseStatus;
  research_run_id: string | null;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  authority_snapshot: Record<string, unknown>;
  generated_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  superseded_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntelligenceRecord {
  id: string;
  client_id: string;
  release_id: string;
  record_type: string;
  record_key: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  display_order: number;
  created_at: string;
}

export interface IntelligenceFinding {
  id: string;
  client_id: string;
  intelligence_domain: IntelligenceDomain;
  subject_key: string | null;
  claim: string;
  disposition: FindingDisposition;
  confidence_level: FindingConfidence | null;
  rationale: string | null;
  contradiction_status: FindingContradictionStatus;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface IntelligenceEvidence {
  id: string;
  client_id: string;
  research_run_id: string | null;
  source_type: "research_source" | "context_file" | "client_input" | "structured_observation";
  research_source_id: string | null;
  context_file_id: string | null;
  client_input_field: string | null;
  evidence_kind: "excerpt" | "paraphrase" | "structured_observation" | "calculation";
  evidence_text: string;
  locator: Record<string, unknown>;
  observed_at: string;
  source_quality: "authoritative" | "primary" | "secondary" | "unrated";
  inspectable: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface IntelligenceSource {
  id: string;
  client_id: string;
  research_run_id: string;
  url: string;
  canonical_url: string | null;
  title: string;
  publisher: string | null;
  retrieved_at: string;
  source_type: string;
  source_quality: "authoritative" | "primary" | "secondary" | "unrated";
  inspectable: boolean;
  use_restriction: string;
}

export interface IntelligenceRefreshPolicy {
  id: string;
  client_id: string;
  intelligence_domain: IntelligenceDomain;
  refresh_interval_days: number;
  due_warning_days: number;
  scheduled_refresh_enabled: boolean;
  policy_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntelligenceWorkspace {
  domain: IntelligenceDomain;
  latestRelease: IntelligenceRelease | null;
  activeRelease: IntelligenceRelease | null;
  latestRun: IntelligenceResearchRun | null;
  steps: IntelligenceResearchStep[];
  records: IntelligenceRecord[];
  findings: IntelligenceFinding[];
  evidence: IntelligenceEvidence[];
  sources: IntelligenceSource[];
  policy: IntelligenceRefreshPolicy | null;
  usage: {
    inputUnits: number;
    outputUnits: number;
    toolCalls: number;
    amountMicrounits: number | null;
    currency: string | null;
  };
  freshness: IntelligenceFreshness;
  nextRefreshAt: string | null;
}

export interface PrepareMarketOSResponse {
  ok: boolean;
  mode: "prepared" | "resumed" | "blocked";
  message: string;
  research_run_id?: string;
  release_id?: string;
  steps?: IntelligenceResearchStep[];
  missing_context_files?: number;
}

export interface RunMarketOSStepResponse {
  ok: boolean;
  terminal: boolean;
  message: string;
  research_run_id: string;
  release_id: string;
  step?: IntelligenceResearchStep;
  progress: { completed: number; failed: number; total: number };
}

export interface FinalizeMarketOSResponse {
  ok: boolean;
  message: string;
  release: IntelligenceRelease;
  run: IntelligenceResearchRun;
}
