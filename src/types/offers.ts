import type {
  IntelligenceResearchRun,
  IntelligenceResearchStep,
  IntelligenceReviewDecision,
} from "@/types/intelligence";

export type OfferReleaseStatus = "draft" | "needs_review" | "approved" | "superseded" | "archived";
export type OfferType = "main" | "seasonal";

export interface MainOfferRelease {
  id: string;
  client_id: string;
  version: number;
  status: OfferReleaseStatus;
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

export interface MainOffer {
  id: string;
  client_id: string;
  release_id: string;
  offer_key: string;
  offer_name: string;
  offer_role: "core_front_end" | "upsell" | "downsell" | "continuity" | "recurring" | "cross_sell" | "other";
  offer_stage: "foundational" | "ascension" | "retention" | "reactivation" | "other";
  customer_segment: string;
  problem_addressed: string;
  promised_outcome: string;
  mechanism: string;
  dream_outcome: string;
  perceived_likelihood: string;
  time_delay: string;
  effort_sacrifice: string;
  price_risk_friction: string;
  value_stack: string[];
  bonus_stack: string[];
  risk_reversal: string;
  guarantee: string;
  pricing_model: string;
  delivery_model: string;
  eligibility: string;
  proof_requirements: string;
  offer_sequence_note: string;
  money_model_notes: string;
  constraints: string;
  payload: Record<string, unknown>;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface MoneyModelComponent {
  id: string;
  client_id: string;
  release_id: string;
  component_key: string;
  component_type: "front_end" | "upsell" | "downsell" | "continuity" | "recurring_revenue" | "offer_sequence" | "monetization_mechanic" | "other";
  title: string;
  description: string;
  trigger_condition: string;
  commercial_role: string;
  dependency_note: string;
  payload: Record<string, unknown>;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface SeasonalOfferRelease {
  id: string;
  client_id: string;
  version: number;
  status: OfferReleaseStatus;
  research_run_id: string | null;
  campaign_intelligence_release_id: string | null;
  main_offer_release_id: string | null;
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

export interface SeasonalOffer {
  id: string;
  client_id: string;
  release_id: string;
  campaign_period_id: string;
  main_offer_id: string | null;
  seasonal_offer_key: string;
  title: string;
  campaign_period_title: string;
  offer_angle: string;
  packaging_direction: string;
  urgency_driver: string;
  bonus_direction: string;
  positioning_direction: string;
  mechanism_direction: string;
  reason_to_act_now: string;
  cta_direction: string;
  offer_risk: string;
  constraints: string;
  payload: Record<string, unknown>;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface OfferApprovalDecision {
  id: string;
  client_id: string;
  release_kind: "main_offers" | "seasonal_offers";
  release_id: string;
  decision: OffersReviewDecision;
  previous_status: OfferReleaseStatus;
  resulting_status: OfferReleaseStatus;
  note: string | null;
  decided_by: string;
  decided_at: string;
}

export interface SeasonalOfferCampaignPeriodOption {
  id: string;
  title: string;
  strategic_theme: string;
  timing_label: string;
  pain_point_salience: string[];
  desired_outcome: string;
  positioning_direction: string;
  campaign_objective: string;
  display_order: number;
}

export interface SeasonalOfferMainOfferOption {
  id: string;
  offer_name: string;
  offer_role: MainOffer["offer_role"];
  offer_stage: MainOffer["offer_stage"];
  promised_outcome: string;
  mechanism: string;
  display_order: number;
}

export interface OffersBuildSelection {
  campaign_period_id?: string;
  main_offer_id?: string;
}

export interface MainOffersWorkspace {
  offerType: "main";
  latestRelease: MainOfferRelease | null;
  activeRelease: MainOfferRelease | null;
  latestRun: IntelligenceResearchRun | null;
  steps: IntelligenceResearchStep[];
  offers: MainOffer[];
  moneyModelComponents: MoneyModelComponent[];
  approvalDecisions: OfferApprovalDecision[];
}

export interface SeasonalOffersWorkspace {
  offerType: "seasonal";
  latestRelease: SeasonalOfferRelease | null;
  activeRelease: SeasonalOfferRelease | null;
  latestRun: IntelligenceResearchRun | null;
  steps: IntelligenceResearchStep[];
  offers: SeasonalOffer[];
  campaignPeriodOptions: SeasonalOfferCampaignPeriodOption[];
  mainOfferOptions: SeasonalOfferMainOfferOption[];
  approvalDecisions: OfferApprovalDecision[];
}

export type OffersWorkspace = MainOffersWorkspace | SeasonalOffersWorkspace;

export interface PrepareOffersResponse {
  ok: boolean;
  mode: "prepared" | "resumed" | "blocked";
  message: string;
  research_run_id?: string;
  release_id?: string;
  steps?: IntelligenceResearchStep[];
  code?: string;
}

export interface RunOffersStepResponse {
  ok: boolean;
  terminal: boolean;
  message: string;
  research_run_id: string;
  release_id: string;
  step?: IntelligenceResearchStep;
  progress: { completed: number; failed: number; total: number };
}

export interface FinalizeOffersResponse {
  ok: boolean;
  message: string;
  release: MainOfferRelease | SeasonalOfferRelease;
  run: IntelligenceResearchRun;
}

export type OffersReviewDecision = IntelligenceReviewDecision;
