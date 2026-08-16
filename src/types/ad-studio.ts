// Programme Stage L — Ad Studio and Paid Distribution, frontend types.

export type AdOpportunityOrigin =
  | "manual_idea" | "proof" | "research" | "campaign_requirement"
  | "organic_winner" | "performance_insight" | "offer_launch" | "seasonal_trigger"
  | "calendar_planned";

export const AD_OPPORTUNITY_ORIGIN_LABEL: Record<AdOpportunityOrigin, string> = {
  manual_idea: "Manual Idea",
  proof: "Proof",
  research: "Research",
  campaign_requirement: "Campaign requirement",
  organic_winner: "Organic winner",
  performance_insight: "Performance Insight",
  offer_launch: "Offer launch",
  seasonal_trigger: "Seasonal trigger",
  calendar_planned: "Calendar-planned",
};

export type AdOpportunityStatus = "identified" | "shortlisted" | "selected" | "rejected" | "expired";

export interface AdOpportunityRow {
  id: string;
  client_id: string;
  title: string;
  origin: AdOpportunityOrigin;
  promoted_from_content_opportunity_id: string | null;
  ads_master_id: string | null;
  status: AdOpportunityStatus;
  core_claim: string | null;
  offer_ref: string | null;
  notes: string | null;
  generated_by: "manual" | "ai";
  rejected_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type AdBriefStatus = "draft" | "in_review" | "approved" | "superseded";

export interface AdBriefBody {
  campaign_objective: string;
  awareness_stage: string;
  audience: string;
  offer: string;
  landing_page: string;
  primary_claim: string;
  proof_required: boolean;
  hook_variants: string[];
  visual_variants: string[];
  copy_variants: string[];
  cta_variants: string[];
  placement: string[];
  testing_role: string;
  attribution_requirements: { pixel_id: string | null; conversion_event: string | null };
}

export interface AdBriefRow {
  id: string;
  client_id: string;
  ad_opportunity_id: string;
  brief_version: number;
  status: AdBriefStatus;
  body: AdBriefBody;
  rendered_markdown: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdCreativeVariantRow {
  id: string;
  client_id: string;
  ad_brief_id: string;
  hook_index: number;
  visual_index: number;
  copy_index: number;
  cta_index: number;
  format: string;
  hook_text: string;
  visual_ref: string;
  copy_text: string;
  cta_text: string;
  status: "draft" | "approved" | "rejected";
  client_asset_id: string | null;
  created_at: string;
}

export interface AdBudgetPolicyRow {
  id: string;
  client_id: string;
  ad_account_id: string | null;
  ad_account_owner_verified: boolean;
  payment_method_verified: boolean;
  spend_limit_daily: number | null;
  spend_limit_total: number | null;
  requires_client_approval: boolean;
  allowed_geographies: string[];
  restricted_audience_flags: string[];
  regulated_categories: string[];
}

export type AdCampaignStatus = "draft" | "pending_approval" | "approved" | "launching" | "active" | "paused" | "completed" | "archived" | "failed";

export const AD_CAMPAIGN_STATUS_LABEL: Record<AdCampaignStatus, string> = {
  draft: "Draft", pending_approval: "Pending approval", approved: "Approved",
  launching: "Launching", active: "Active", paused: "Paused",
  completed: "Completed", archived: "Archived", failed: "Failed",
};

export interface AdCampaignRow {
  id: string;
  client_id: string;
  ad_brief_id: string;
  idempotency_key: string;
  name: string;
  objective: string;
  status: AdCampaignStatus;
  budget_daily: number | null;
  budget_total: number | null;
  attribution: Record<string, unknown>;
  client_approved_by: string | null;
  client_approved_at: string | null;
  external_campaign_id: string | null;
  external_status: string | null;
  spend_to_date: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdSetRow {
  id: string;
  client_id: string;
  ad_campaign_id: string;
  name: string;
  audience: Record<string, unknown>;
  placement: string[];
  budget_daily: number | null;
  status: string;
  external_ad_set_id: string | null;
}

export interface AdRow {
  id: string;
  client_id: string;
  ad_set_id: string;
  ad_creative_variant_id: string;
  name: string;
  status: string;
  external_ad_id: string | null;
}

export interface AdLaunchAttemptRow {
  id: string;
  ad_campaign_id: string;
  attempt_number: number;
  action: string;
  result: "success" | "blocked" | "failed";
  category: string | null;
  message: string | null;
  created_at: string;
}
