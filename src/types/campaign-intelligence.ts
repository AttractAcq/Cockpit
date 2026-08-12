import type {
  IntelligenceExecutionStatus,
  IntelligenceResearchRun,
  IntelligenceResearchStep,
  IntelligenceReviewDecision,
} from "@/types/intelligence";

export type CampaignIntelligenceReleaseStatus =
  | "draft"
  | "needs_review"
  | "approved"
  | "superseded"
  | "archived";

export type CampaignSourceDomain =
  | "market_os"
  | "avatar_os"
  | "competitor_os"
  | "association_os"
  | "brand_strategist"
  | "context";

export interface CampaignIntelligenceRelease {
  id: string;
  client_id: string;
  version: number;
  status: CampaignIntelligenceReleaseStatus;
  research_run_id: string | null;
  title: string;
  summary: string;
  authority_snapshot: Record<string, unknown>;
  generated_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  superseded_at: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignPeriod {
  id: string;
  client_id: string;
  release_id: string;
  period_key: string;
  title: string;
  strategic_theme: string;
  timing_label: string;
  timing_start: string | null;
  timing_end: string | null;
  icp_context: string;
  emotional_states: string[];
  pain_point_salience: string[];
  desired_outcome: string;
  awareness_shift: string;
  strategic_messaging_direction: string;
  positioning_direction: string;
  campaign_objective: string;
  customer_journey_stage: string;
  previous_period_relationship: string | null;
  evidence_summary: string;
  payload: Record<string, unknown>;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignPeriodSourceLink {
  id: string;
  client_id: string;
  campaign_period_id: string;
  source_domain: CampaignSourceDomain;
  source_release_id: string | null;
  source_record_id: string | null;
  source_finding_id: string | null;
  relationship: "informs" | "supports" | "constrains" | "contradicts";
  note: string | null;
  created_at: string;
}

export interface CampaignIntelligenceApprovalDecision {
  id: string;
  client_id: string;
  release_id: string;
  decision: "approved" | "changes_requested" | "rejected";
  previous_status: CampaignIntelligenceReleaseStatus;
  resulting_status: CampaignIntelligenceReleaseStatus;
  note: string | null;
  decided_by: string;
  decided_at: string;
}

export interface CampaignIntelligenceWorkspace {
  latestRelease: CampaignIntelligenceRelease | null;
  activeRelease: CampaignIntelligenceRelease | null;
  latestRun: IntelligenceResearchRun | null;
  steps: IntelligenceResearchStep[];
  periods: CampaignPeriod[];
  sourceLinks: CampaignPeriodSourceLink[];
  approvalDecisions: CampaignIntelligenceApprovalDecision[];
  usage: {
    inputUnits: number;
    outputUnits: number;
    toolCalls: number;
    amountMicrounits: number | null;
    currency: string | null;
  };
}

export interface PrepareCampaignIntelligenceResponse {
  ok: boolean;
  mode: "prepared" | "resumed" | "blocked";
  message: string;
  research_run_id?: string;
  release_id?: string;
  steps?: IntelligenceResearchStep[];
  missing_domains?: string[];
}

export interface RunCampaignIntelligenceStepResponse {
  ok: boolean;
  terminal: boolean;
  message: string;
  research_run_id: string;
  release_id: string;
  step?: IntelligenceResearchStep;
  progress: { completed: number; failed: number; total: number };
}

export interface FinalizeCampaignIntelligenceResponse {
  ok: boolean;
  message: string;
  release: CampaignIntelligenceRelease;
  run: IntelligenceResearchRun & { status: IntelligenceExecutionStatus };
}

export type CampaignIntelligenceReviewDecision = IntelligenceReviewDecision;
