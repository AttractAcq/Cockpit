// Programme Stage I — Shared Production Studio Framework, frontend types.

export type StudioCapability =
  | "reel_studio" | "carousel_studio" | "story_studio"
  | "feed_post_studio" | "ad_studio";

export const STUDIO_LABEL: Record<StudioCapability, string> = {
  reel_studio: "Reel Studio",
  carousel_studio: "Carousel Studio",
  story_studio: "Story Studio",
  feed_post_studio: "Feed Post Studio",
  ad_studio: "Ad Studio",
};

export type ProductionJobStatus = "pending" | "running" | "retryable" | "failed" | "completed" | "cancelled";
export type ProductionMode = "human" | "ai" | "hybrid";

export const ASSET_PLAN_CATEGORIES = [
  "existing_client_asset", "proof_asset", "screenshot", "document", "stock",
  "generated_image", "generated_video", "motion_graphic", "diagram",
  "typography", "voice_over", "music", "sound_effect",
] as const;
export type AssetPlanCategory = typeof ASSET_PLAN_CATEGORIES[number];

export interface AssetPlanItem {
  category: AssetPlanCategory;
  description: string;
  required: boolean;
}

export interface ProductionJob {
  id: string;
  client_id: string;
  content_item_id: string;
  content_brief_id: string | null;
  capability: StudioCapability;
  status: ProductionJobStatus;
  idempotency_key: string;
  attempt_count: number;
  maximum_attempts: number;
  retryable: boolean;
  production_mode: ProductionMode | null;
  asset_plan: AssetPlanItem[];
  failure_code: string | null;
  failure_message: string | null;
  provider: string | null;
  model: string | null;
  cost_metadata: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AssetKind = "generated" | "source" | "deliverable";

export interface ContentItemAsset {
  id: string;
  client_id: string;
  production_job_id: string;
  content_item_id: string;
  kind: AssetKind;
  asset_category: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  provider: string | null;
  model: string | null;
  version: number;
  is_current: boolean;
  revision_of: string | null;
  generated_media_disclosed: boolean;
  created_at: string;
  updated_at: string;
}

export const QUALITY_CHECK_TYPES = [
  "claim_accuracy", "proof_accuracy", "brand_alignment", "spelling",
  "aspect_ratio", "platform_safe_area", "cta", "asset_ownership",
  "consent", "generated_media_disclosure",
] as const;
export type QualityCheckType = typeof QUALITY_CHECK_TYPES[number];

export interface QualityCheckResult {
  check: QualityCheckType;
  passed: boolean;
  detail: string;
}

export type ReviewDecision = "approved" | "changes_requested" | "rejected";

export interface ProductionReview {
  id: string;
  client_id: string;
  production_job_id: string;
  content_item_asset_id: string | null;
  reviewer_id: string | null;
  decision: ReviewDecision;
  notes: string | null;
  quality_checks: QualityCheckResult[];
  created_at: string;
}

export interface RouteContentBriefResponse {
  ok: true;
  idempotent_replay: boolean;
  studio: StudioCapability;
  job: ProductionJob;
}

export interface SubmitProductionReviewResponse {
  ok: true;
  review: ProductionReview;
}
