import type { ReviewState } from "./client";
import type { ExecutionFileCode } from "../../supabase/functions/_shared/execution-manifest";

export type ContextFileStatus =
  | "not_started"
  | "generating"
  | "generated"
  | "needs_review"
  | "approved"
  | "needs_client_input";

export interface ClientInputs {
  id: string;
  client_id: string;
  business_description: string | null;
  website_url: string | null;
  social_links: Record<string, string>;
  offer_details: string | null;
  target_customer: string | null;
  geography: string | null;
  proof_notes: string | null;
  testimonials_notes: string | null;
  reviews_notes: string | null;
  case_studies_notes: string | null;
  before_after_notes: string | null;
  founder_team_notes: string | null;
  current_problems: string | null;
  uploaded_file_refs: string[];
  sales_process: string | null;
  current_marketing: string | null;
  brand_voice: string | null;
  competitors: string | null;
  constraints_approval_rules: string | null;
  raw_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientContextFile {
  id: string;
  client_id: string;
  file_number: number;
  file_name: string;
  content_md: string | null;
  storage_path: string | null;
  status: ContextFileStatus;
  confidence_level: string | null;
  generated_by_function: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ClientExecutionFile {
  id: string;
  client_id: string;
  month: string;
  file_name: string;
  file_number: number | null;
  file_type: string | null;
  content_md: string | null;
  status: string | null;
  review_state: ReviewState;
  version: number;
  generated_by_agent: string | null;
  generated_by_function: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganicMasterRow {
  id: string;
  client_id: string;
  month: string;
  ref: string;
  review_state: ReviewState;
  status: string;
  content_type: string;
  archetype: string | null;
  pillar: string | null;
  working_title: string | null;
  the_one_person: string | null;
  one_belief_to_change: string | null;
  hook: string | null;
  core_message: string | null;
  cta: string | null;
  storyboard_outline: string | null;
  caption_script: string | null;
  source_origin: string | null;
  distribution_date: string | null;
  distribution_channel: string | null;
  production_date: string | null;
  edit_date: string | null;
  production_brief: string | null;
  psychological_angle: string | null;
  repurposed_from_to: string | null;
  format_proven: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoryMasterRow {
  id: string;
  client_id: string;
  month: string;
  ref: string;
  review_state: ReviewState;
  status: string;
  story_type: string | null;
  story_theme: string | null;
  pillar: string | null;
  frame_1: string | null;
  frame_2: string | null;
  frame_3: string | null;
  frame_4_optional: string | null;
  cta_engagement_prompt: string | null;
  proof_used: string | null;
  source_origin: string | null;
  distribution_date: string | null;
  repurposed_from_to: string | null;
  what_not_to_claim: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdsMasterRow {
  id: string;
  client_id: string;
  month: string;
  ref: string;
  review_state: ReviewState;
  status: string;
  lane: string;
  stint_name: string | null;
  objective: string | null;
  funnel_stage: string | null;
  start_date: string | null;
  end_date: string | null;
  days: number | null;
  budget_split: string | null;
  primary_goal: string | null;
  conversion_action: string | null;
  meta_objective: string | null;
  audience: string | null;
  creative_source: string | null;
  hook_angle: string | null;
  kpi_watch: string | null;
  feeds_into: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProofMasterRow {
  id: string;
  client_id: string;
  month: string | null;
  ref: string;
  review_state: ReviewState;
  status: string;
  proof_type: string | null;
  proof_asset_name: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetBriefRow {
  id: string;
  client_id: string;
  execution_month: string;
  brief_id: string;
  source_ref: string;
  source_ref_type: string;
  asset_type: string | null;
  production_status: string;
  status: ReviewState;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarCellRow {
  id: string;
  client_id: string;
  month: string;
  date: string;
  row_type: string;
  ref: string;
  review_state: ReviewState;
  created_at: string;
  updated_at: string;
}

export type PhaseMode =
  | "stub"
  | "contract_ready"
  | "blocked"
  | "generated"
  | "started"
  | "generation_started"
  | "section_generated"
  | "file_generated"
  | "error";

export type Phase2Section = ExecutionFileCode;

export type Phase3Section =
  | "organic_reels_1"
  | "organic_reels_2"
  | "organic_reels_3"
  | "organic_reels_4"
  | "organic_carousels_1"
  | "organic_carousels_2"
  | "organic_feed_posts_1"
  | "organic_feed_posts_2"
  | "stories_education_1"
  | "stories_education_2"
  | "stories_conversion_1"
  | "stories_conversion_2"
  | "ads"
  | "calendar";

export type MasterTable = "organic_master" | "story_master" | "ads_master";
export type MasterRow = OrganicMasterRow | StoryMasterRow | AdsMasterRow;

export type AssetFormat = "ad_static" | "reel_video" | "story_sequence" | "carousel" | "feed_post";
export type ProductionMode = "human" | "ai";
export type ProductionStatus = "brief" | "assigned_human" | "ai_ready" | "producing" | "produced" | "failed";

// ── AI visual direction (Produce with AI) ────────────────────────────────────
export type AiVisualMode = "text_only" | "uploaded_background" | "uploaded_insert" | "generated_background";
export type BackgroundStrength = "subtle" | "moderate" | "strong";

/** A visual input image uploaded to private storage before generation. */
export interface VisualInputUpload {
  path: string;
  filename: string;
  mime_type: string;
  size: number;
}

export type AiBackgroundPromptStatus = "draft" | "needs_review" | "approved" | "rejected" | "generating" | "generated" | "failed";
export interface AiBackgroundGenerationRow {
  id: string; client_id: string; production_brief_id: string | null; source_ref: string;
  format: "feed_post" | "carousel" | "story_sequence"; frame_index: number | null;
  prompt_text: string; prompt_status: AiBackgroundPromptStatus; prompt_created_by: string;
  prompt_approved_by: string | null; prompt_approved_at: string | null; image_model: string | null;
  brief_fingerprint_at_prompt: string; brief_fingerprint_at_approval: string | null;
  image_size: string | null; image_quality: string | null; storage_bucket: string | null;
  storage_path: string | null; public_url: string | null; provider_response: Record<string, unknown>;
  error_message: string | null; generated_at: string | null; created_at: string; updated_at: string;
}

/** Visual direction sent to the AI generator alongside a production brief. */
export interface AiVisualDirection {
  visual_mode: AiVisualMode;
  uploaded_image_path?: string | null;
  uploaded_image_mime_type?: string | null;
  uploaded_image_filename?: string | null;
  uploaded_image_size?: number | null;
  visual_instructions?: string | null;
  background_strength?: BackgroundStrength;
  preserve_text_readability?: boolean;
}

export interface ProductionBriefRow {
  id: string;
  client_id: string;
  execution_month: string;
  source_table: MasterTable;
  source_row_id: string;
  source_ref: string;
  asset_format: AssetFormat;
  title: string;
  content_md: string;
  status: ReviewState;
  production_mode: ProductionMode | null;
  production_status: ProductionStatus;
  version: number;
  generated_by_function: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ── Persisted asset-generation job model (multi-image carousel/story) ─────────
export type AssetGenerationJobStatus = "queued" | "processing" | "partial" | "complete" | "failed" | "cancelled";
export type AssetGenerationItemStatus = "queued" | "processing" | "complete" | "failed" | "cancelled";

export interface AssetGenerationJobRow {
  id: string;
  client_id: string;
  production_brief_id: string;
  source_ref: string;
  asset_group_ref: string;
  asset_format: AssetFormat;
  expected_output_count: number;
  completed_output_count: number;
  status: AssetGenerationJobStatus;
  visual_mode: AiVisualMode | null;
  generation_config: Record<string, unknown>;
  last_error: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
  closure_reason?: string | null;
  closure_type?: "completed" | "cancelled" | "partial_accepted" | null;
  accepted_partial?: boolean;
  accepted_output_count?: number | null;
  accepted_sequence_indexes?: number[] | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetGenerationItemRow {
  id: string;
  generation_job_id: string;
  sequence_index: number;
  status: AssetGenerationItemStatus;
  storage_path: string | null;
  client_asset_id: string | null;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** One slide-worker response — the unit the UI driver reads to show progress. */
export interface AssetJobProgress {
  job: AssetGenerationJobRow;
  status: AssetGenerationJobStatus;
  completed_output_count: number;
  expected_output_count: number;
  item_processed: boolean;
  sequence_processed: number | null;
  terminal: boolean;
  in_progress: boolean;
  last_error: string | null;
  asset_group_ref: string;
}

export interface ClientAssetRow {
  id: string;
  client_id: string;
  production_brief_id: string;
  source_ref: string;
  asset_format: AssetFormat;
  asset_group_ref: string;
  sequence_index: number;
  title: string | null;
  storage_bucket: "client-assets";
  storage_path: string;
  mime_type: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  status: ReviewState;
  generation_provider: string;
  generation_model: string;
  prompt_md: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Per-frame versioning (H7). Optional so reads work before/after the migration;
  // treat a missing is_current as the current version.
  version?: number;
  is_current?: boolean;
  regen_started_at?: string | null;
  signed_url?: string | null;
  production_brief?: Pick<ProductionBriefRow, "production_mode" | "source_table" | "source_row_id"> | null;
}

/**
 * The operational lifecycle a piece of content moves through after Phase 3.
 * `master → content_creation → assets → distribution → analytics → analysis`
 * with `completed`/`archived` as terminal pipeline-state values. Snapshots are
 * only taken for the six real stages (not `completed`/`archived`).
 */
export type PipelineStage =
  | "master"
  | "content_creation"
  | "assets"
  | "distribution"
  | "analytics"
  | "analysis"
  | "completed"
  | "archived";

export type ArchiveStage = Exclude<PipelineStage, "completed" | "archived">;

export const PIPELINE_STAGES: PipelineStage[] = [
  "master",
  "content_creation",
  "assets",
  "distribution",
  "analytics",
  "analysis",
  "completed",
  "archived",
];

export interface PipelineStateRow {
  id: string;
  client_id: string;
  execution_month: string;
  source_ref: string;
  asset_group_ref: string | null;
  production_brief_id: string | null;
  current_stage: PipelineStage;
  previous_stage: PipelineStage | null;
  title: string | null;
  asset_format: string | null;
  active: boolean;
  stage_entered_at: string;
  last_transition_at: string;
  transition_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ArchiveSnapshotRow {
  id: string;
  client_id: string;
  execution_month: string;
  source_ref: string;
  asset_group_ref: string | null;
  stage: ArchiveStage;
  title: string | null;
  asset_format: string | null;
  source_table: string;
  source_row_id: string | null;
  snapshot_data: Record<string, unknown>;
  snapshot_md: string | null;
  snapshot_reason: string | null;
  created_at: string;
  created_by: string | null;
  metadata: Record<string, unknown>;
}

// ── Scoped Phase 3 (H8) ──────────────────────────────────────────────────────
export type ScopedPhase3Format = "feed_post" | "carousel" | "reel_video" | "story_sequence" | "ad_static";
export type Phase3DuplicatePolicy = "skip_existing" | "fill_missing" | "replace_unapproved";
export type Phase3SlotAction = "create" | "skip" | "conflict" | "replace";

export interface Phase3ScopePreviewSlot {
  slot_key: string;
  planned_date: string;
  end_date: string | null;
  execution_month: string;
  asset_format: ScopedPhase3Format;
  action: Phase3SlotAction;
  existing_ref: string | null;
  conflict_reason: string | null;
}
export interface Phase3ScopePreview {
  generation_mode: "range" | "single_item";
  start_date: string;
  end_date: string;
  days: number;
  duplicate_policy: Phase3DuplicatePolicy;
  total_slots: number;
  summary: { create: number; skip: number; replace: number; conflict: number };
  slots: Phase3ScopePreviewSlot[];
  protected_conflicts: Array<{ planned_date: string; asset_format: ScopedPhase3Format; existing_ref: string | null; reason: string | null }>;
}
export interface Phase3ScopedRunRow {
  id: string;
  client_id: string;
  generation_mode: "range" | "single_item";
  start_date: string;
  end_date: string;
  duplicate_policy: Phase3DuplicatePolicy;
  status: "planned" | "generating" | "partial" | "complete" | "failed" | "cancelled";
  total_slots: number;
  created_count: number;
  skipped_count: number;
  conflicted_count: number;
  created_refs: string[];
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
export interface Phase3SlotProgress {
  terminal: boolean;
  item_processed: boolean;
  ref?: string;
  skipped?: boolean;
  conflict?: boolean;
  progress: { queued: number; complete: number; failed: number; total: number };
  run?: Phase3ScopedRunRow;
}

// ── Destructive lifecycle operations (H9) ────────────────────────────────────
export type DestructiveOperationType = "delete_asset" | "delete_phase3_content" | "reject_asset" | "reject_content_brief";
export interface DestructiveTargetInput {
  operation_type: DestructiveOperationType;
  asset_id?: string;
  master_table?: "organic_master" | "story_master" | "ads_master";
  ref?: string;
  asset_group_ref?: string;
  brief_id?: string;
  reason?: string;
}
export interface DestructivePlan {
  operation_type: DestructiveOperationType;
  client_id: string | null;
  target_ref: string | null;
  allowed: boolean;
  blockers: string[];
  published_findings: string[];
  storage_objects: string[];
  rows_to_delete: Record<string, number>;
  rows_to_update: Record<string, number>;
  retain: string[];
  supersede: Record<string, number>;
  version_consequences: string[];
  downstream_consequences: string[];
  summary: string;
}
export interface DestructiveExecuteResult {
  status?: string;
  result?: Record<string, unknown>;
  blockers?: string[];
  published_findings?: string[];
  recovery_required?: boolean;
  error?: string;
  ok?: boolean;
}

export type PublishStatus = "ready" | "scheduled" | "publishing" | "published" | "failed" | "cancelled" | "needs_reconciliation";
export type PublishMode = "publish_now" | "scheduled";

export type PublishAttemptResult = "started" | "published" | "retryable_failure" | "permanent_failure" | "ambiguous" | "skipped";

/** One row per scheduled-publish attempt — the operator's diagnosis trail. */
export interface PublishAttemptRow {
  id: string;
  distribution_record_id: string;
  client_id: string;
  source_ref: string;
  asset_format: string | null;
  attempt_number: number;
  worker_invocation_id: string | null;
  claimed_by: string | null;
  started_at: string;
  completed_at: string | null;
  result: PublishAttemptResult;
  category: string | null;
  retryable: boolean | null;
  meta_error_code: number | null;
  meta_error_subcode: number | null;
  external_post_id: string | null;
  /** Forward-compatible: shown when a provider records a permalink per attempt. */
  published_url?: string | null;
  /** Forward-compatible; current rows derive permanence from result when absent. */
  permanent_failure?: boolean;
  container_ids: unknown[];
  message: string | null;
  created_at: string;
}

export interface DistributionRecordRow {
  id: string;
  client_id: string;
  execution_month: string;
  source_ref: string;
  asset_group_ref: string;
  production_brief_id: string | null;
  asset_format: string;
  title: string | null;
  /** 1 for single-record formats; per-frame index for Story sequences. */
  sequence_index: number;
  /** Total frames in the Story sequence (null for non-sequence records). */
  sequence_count: number | null;
  publish_status: PublishStatus;
  publish_mode: PublishMode | null;
  planned_publish_date: string | null;
  scheduled_publish_at: string | null;
  published_at: string | null;
  published_url: string | null;
  external_post_id: string | null;
  platform: string | null;
  destination: string | null;
  publish_payload: Record<string, unknown>;
  publish_settings: Record<string, unknown>;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Scheduled-publishing reliability fields (P1). Optional so reads work before
  // the migration is applied.
  claimed_at?: string | null;
  claimed_by?: string | null;
  attempt_count?: number;
  next_attempt_at?: string | null;
  permanent_failure?: boolean;
}

export type AnalyticsStatus = "awaiting_metrics" | "metrics_partial" | "complete" | "failed";

export interface AnalyticsRecordRow {
  id: string;
  client_id: string;
  execution_month: string;
  source_ref: string;
  asset_group_ref: string;
  distribution_record_id: string | null;
  production_brief_id: string | null;
  asset_format: string | null;
  title: string | null;
  platform: string | null;
  published_at: string;
  published_url: string | null;
  external_post_id: string | null;
  collection_status: "active" | "paused" | "closed";
  analytics_status: AnalyticsStatus;
  metrics: Record<string, unknown>;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type MetricSnapshotLabel = "manual" | "t_plus_1h" | "t_plus_6h" | "t_plus_24h" | "t_plus_48h" | "t_plus_7d" | "story_t_plus_1h" | "story_t_plus_6h" | "story_t_plus_23h";
export type MetricCollectionMethod = "manual" | "api_later" | "api";
export type SupportedMetricKey = "impressions" | "reach" | "likes" | "comments" | "shares" | "saves" | "profile_visits" | "follows" | "website_clicks" | "replies" | "taps_forward" | "taps_back" | "exits" | "completion_rate" | "views" | "navigation" | "total_interactions";
export type ManualAnalyticsStatus = "no_metrics" | "partial_metrics" | "metrics_entered" | "business_signals_entered";
export type AutomaticInsightsStatus = "no_automatic_metrics" | "automatic_metrics_pending" | "automatic_metrics_collected" | "collection_failed" | "story_metrics_expired";

export interface ClientMetricSnapshot {
  id: string; client_id: string; distribution_record_id: string; source_ref: string;
  platform: string; content_format: string; snapshot_at: string; snapshot_label: MetricSnapshotLabel;
  collection_method: MetricCollectionMethod; metrics: Partial<Record<SupportedMetricKey, number>>;
  notes: string | null; evidence_url: string | null; created_by: string | null; created_at: string; updated_at: string;
}

export interface ClientBusinessSignalSnapshot {
  id: string; client_id: string; distribution_record_id: string; source_ref: string; signal_at: string;
  profile_visits: number | null; follows: number | null; inbound_dms: number | null; qualified_dms: number | null;
  conversations: number | null; qualified_conversations: number | null; appointments: number | null;
  qualified_appointments: number | null; show_ups: number | null; cash_collected: number | null;
  operator_notes: string | null; created_by: string | null; created_at: string; updated_at: string;
}

export interface InsightsCollectionAttempt {
  id: string; run_id: string; distribution_record_id: string; client_id: string; source_ref: string;
  external_post_id: string; snapshot_label: MetricSnapshotLabel; status: "collected" | "skipped" | "failed";
  reason: string | null; metrics_requested: string[]; metrics_collected: Record<string, number>;
  unsupported_metrics: string[]; error_category: string | null; error_message: string | null; created_at: string;
}

export interface InsightsCollectionRun {
  id: string; worker_id: string; started_at: string; finished_at: string | null;
  status: "running" | "completed" | "completed_with_errors" | "failed"; mode: "dry_run" | "live";
  due_count: number; collected_count: number; skipped_count: number; failed_count: number;
  error_message: string | null; created_at: string;
}

export interface AnalyticsSummary {
  record: AnalyticsRecordRow;
  metric_snapshots: ClientMetricSnapshot[];
  business_signals: ClientBusinessSignalSnapshot[];
  manual_status: ManualAnalyticsStatus;
  latest_snapshot_at: string | null;
  insights_attempts: InsightsCollectionAttempt[];
  automatic_status: AutomaticInsightsStatus;
  latest_automatic_snapshot_at: string | null;
  performance_score?: ClientPerformanceScore | null;
  performance_insights?: ClientPerformanceInsight[];
  iteration_candidates?: ClientIterationCandidate[];
}

export interface ClientPerformanceScore {
  id: string; client_id: string; distribution_record_id: string; source_ref: string; content_format: string; platform: string;
  latest_metric_snapshot_id: string | null; latest_business_signal_snapshot_id: string | null; score_version: string;
  attention_score: number; engagement_score: number; trust_score: number; conversion_signal_score: number; overall_score: number;
  sample_quality: "insufficient" | "early" | "usable" | "mature";
  score_status: "pending_metrics" | "scored" | "insufficient_data" | "stale";
  score_reasons: string[]; computed_at: string; created_at: string; updated_at: string;
}

export interface ClientPerformanceInsight {
  id: string; client_id: string; distribution_record_id: string | null; source_ref: string | null;
  insight_type: "winner" | "underperformer" | "format_signal" | "hook_signal" | "proof_signal" | "cta_signal" | "audience_signal" | "conversion_signal" | "risk" | "recommendation";
  severity: "low" | "medium" | "high"; confidence: "low" | "medium" | "high";
  title: string; summary: string; evidence: Record<string, unknown>; recommended_action: string | null;
  status: "open" | "accepted" | "dismissed" | "converted_to_iteration"; created_by: string; created_at: string; updated_at: string;
}

export interface ClientPerformanceAnalysisRun {
  id: string; client_id: string; run_mode: "manual" | "scheduled_later"; started_at: string; finished_at: string | null;
  status: "running" | "completed" | "completed_with_errors" | "failed"; records_scored: number; insights_created: number;
  skipped_count: number; error_message: string | null; created_at: string;
}

export type IterationCandidateStatus = "needs_review" | "approved" | "dismissed" | "converted";
export interface ClientIterationCandidate {
  id: string; client_id: string; source_ref: string | null; distribution_record_id: string | null;
  performance_score_id: string | null; performance_insight_id: string | null;
  candidate_type: "hook" | "proof_angle" | "cta" | "format" | "story_sequence" | "content_angle" | "offer" | "audience" | "distribution" | "asset" | "calendar" | "other";
  recommendation: string; rationale: string; evidence: Record<string, unknown>;
  confidence: "low" | "medium" | "high"; priority: "low" | "medium" | "high";
  status: IterationCandidateStatus; created_by: "operator" | "system"; created_from: "performance_score" | "performance_insight" | "manual";
  reviewer_notes: string | null; reviewed_at: string | null; converted_at: string | null; created_at: string; updated_at: string;
}

export interface ClientIterationReview {
  id: string; client_id: string; iteration_candidate_id: string; previous_status: IterationCandidateStatus | null;
  new_status: IterationCandidateStatus; review_note: string | null; reviewed_by: string; created_at: string;
}

export type ContextUpdateProposalStatus = "needs_review" | "approved" | "dismissed" | "converted_to_patch";
export type ContextUpdateProposalType = "context_file_update" | "master_context_update" | "positioning_update" | "offer_update" | "proof_angle_update" | "cta_update" | "distribution_update" | "content_rule_update" | "calendar_rule_update" | "other";
export type ContextUpdateTargetType = "context_file" | "master_context" | "playbook" | "content_rule" | "distribution_rule" | "approval_rule" | "offer" | "positioning" | "other";
export type ContextUpdateChangeIntent = "add" | "revise" | "remove" | "clarify" | "emphasize" | "de_emphasize";

export interface ClientContextUpdateProposal {
  id: string; client_id: string; iteration_candidate_id: string | null; source_ref: string | null; distribution_record_id: string | null;
  proposal_type: ContextUpdateProposalType; title: string; summary: string; rationale: string; evidence: Record<string, unknown>;
  confidence: "low" | "medium" | "high"; priority: "low" | "medium" | "high"; status: ContextUpdateProposalStatus;
  created_from: "iteration_candidate" | "manual"; created_by: "operator" | "system"; reviewer_notes: string | null;
  reviewed_at: string | null; converted_at: string | null; created_at: string; updated_at: string;
  items?: ClientContextUpdateProposalItem[];
}

export interface ClientContextUpdateProposalItem {
  id: string; client_id: string; proposal_id: string; target_type: ContextUpdateTargetType; target_file_id: string | null;
  target_file_name: string | null; target_file_path: string | null; target_section: string | null; current_state_summary: string | null;
  proposed_change_summary: string; change_intent: ContextUpdateChangeIntent; evidence: Record<string, unknown>; created_at: string; updated_at: string;
}

export interface ClientContextUpdateReview {
  id: string; client_id: string; proposal_id: string; previous_status: ContextUpdateProposalStatus | null;
  new_status: ContextUpdateProposalStatus; review_note: string | null; reviewed_by: string; created_at: string;
}

export type ContextPatchType = "add" | "revise" | "remove" | "clarify" | "emphasize" | "de_emphasize" | "replace_section" | "other";
export type ContextPatchStatus = "draft" | "needs_review" | "approved" | "dismissed" | "applied" | "superseded";

export interface ClientContextPatchDraft {
  id: string; client_id: string; context_update_proposal_id: string; proposal_item_id: string | null;
  target_file_id: string; target_file_name: string | null; target_file_path: string | null; target_section: string | null;
  patch_type: ContextPatchType; title: string; summary: string; rationale: string; current_state_summary: string | null;
  proposed_change_summary: string; base_file_version: number; base_content_hash: string;
  proposed_content: string | null; proposed_diff: string | null; evidence: Record<string, unknown>;
  confidence: "low" | "medium" | "high"; priority: "low" | "medium" | "high"; status: ContextPatchStatus;
  created_from: "context_update_proposal" | "manual"; created_by: "operator" | "system"; reviewer_notes: string | null;
  reviewed_at: string | null; applied_at: string | null; superseded_at: string | null; created_at: string; updated_at: string;
  reviews?: ClientContextPatchReview[]; applications?: ClientContextPatchApplication[];
}

export interface ClientContextPatchReview {
  id: string; client_id: string; patch_draft_id: string; previous_status: ContextPatchStatus | null;
  new_status: ContextPatchStatus; review_note: string | null; reviewed_by: string; created_at: string;
}

export interface ClientContextPatchApplication {
  id: string; client_id: string; patch_draft_id: string; target_file_id: string;
  previous_version: number; new_version: number; previous_content_hash: string; new_content_hash: string;
  previous_content_snapshot: string | null; applied_content_snapshot: string; applied_by: string; applied_at: string;
}

export interface ManualMetricFormState {
  snapshot_at: string; snapshot_label: MetricSnapshotLabel; metrics: Partial<Record<SupportedMetricKey, string>>;
  notes: string; evidence_url: string;
}

export interface BusinessSignalFormState {
  signal_at: string; profile_visits: string; follows: string; inbound_dms: string; qualified_dms: string;
  conversations: string; qualified_conversations: string; appointments: string; qualified_appointments: string;
  show_ups: string; cash_collected: string; operator_notes: string;
}

/** Shape the Publish Record modal edits and the publisher validates. */
export interface DistributionPublishPayload {
  caption: string;
  hashtags: string[];
  media: Array<{ storage_bucket: string; storage_path: string; sequence_index: number; mime_type: string; width: number; height: number }>;
  source_ref: string;
  asset_group_ref: string;
  asset_format: string;
}

export interface DistributionPublishSettings {
  platform: string;
  destination: string | null;
  content_type: string;
  aspect_ratio: string;
  proof_restrictions: string | null;
  safety_checklist: string[];
  meta: Record<string, unknown>;
}

export interface AiAssetGenerationResult {
  asset_group_ref: string;
  asset_count: number;
  assets: ClientAssetRow[];
  brief: ProductionBriefRow;
}

export interface ContractorRow {
  id: string;
  name: string;
  email: string;
  role: string | null;
  specialties: string[];
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ContractorAssignmentStatus = "assigned" | "sent" | "failed" | "cancelled";

export interface ContractorAssignmentRow {
  id: string;
  client_id: string;
  production_brief_id: string;
  contractor_id: string;
  status: ContractorAssignmentStatus;
  message: string | null;
  sent_at: string | null;
  resend_message_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  contractors?: Pick<ContractorRow, "id" | "name" | "email" | "role" | "specialties"> | null;
}

export interface Phase1Result {
  ok: boolean;
  mode: PhaseMode;
  client_id?: string;
  message: string;
  warnings: string[];
  missingInputs: string[];
  error?: string;
  data?: Record<string, unknown>;
}

export interface Phase2Result {
  ok: boolean;
  mode: PhaseMode;
  client_id?: string;
  execution_month?: string;
  message: string;
  warnings: string[];
  missingContextFiles: string[];
  error?: string;
  data?: Record<string, unknown>;
}

export type Phase3Result = Phase2Result;

/** @deprecated use Phase1Result */
export type Phase1StubResult = Phase1Result;
/** @deprecated use Phase2Result */
export type Phase2StubResult = Phase2Result;

export const CONTEXT_FILE_DEFS: Array<{ number: number; file_name: string; title: string }> = [
  { number: 0,  file_name: "00_Master_Client_Context.md",                 title: "Master Client Context" },
  { number: 1,  file_name: "01_Business_Context.md",                      title: "Business Context" },
  { number: 2,  file_name: "02_Avatar_And_Buyer_Psychology.md",            title: "Avatar & Buyer Psychology" },
  { number: 3,  file_name: "03_Offer_And_Sales_Context.md",                title: "Offer & Sales Context" },
  { number: 4,  file_name: "04_Proof_Bank.md",                             title: "Proof Bank" },
  { number: 5,  file_name: "05_Proof_Gap_Report.md",                       title: "Proof Gap Report" },
  { number: 6,  file_name: "06_Positioning_And_Angle_Map.md",              title: "Positioning & Angle Map" },
  { number: 7,  file_name: "07_Brand_Voice_And_Style_Guide.md",            title: "Brand Voice & Style Guide" },
  { number: 8,  file_name: "08_Profile_Funnel_Context.md",                 title: "Profile Funnel Context" },
  { number: 9,  file_name: "09_Content_System.md",                         title: "Content System" },
  { number: 10, file_name: "10_Story_System.md",                           title: "Story System" },
  { number: 11, file_name: "11_Ad_System.md",                              title: "Ad System" },
  { number: 12, file_name: "12_Website_And_Landing_Page_Context.md",       title: "Website & Landing Page Context" },
  { number: 13, file_name: "13_Distribution_System.md",                    title: "Distribution System" },
  { number: 14, file_name: "14_Automation_And_AI_Instructions.md",         title: "Automation & AI Instructions" },
  { number: 15, file_name: "15_Content_Calendar.md",                       title: "Content Calendar" },
  { number: 16, file_name: "16_Performance_Report.md",                     title: "Performance Report" },
  { number: 17, file_name: "17_Iteration_Log.md",                          title: "Iteration Log" },
  { number: 18, file_name: "18_Client_Comms_And_Approval_Context.md",      title: "Client Comms & Approval Context" },
  { number: 19, file_name: "19_Sales_Enablement_Assets.md",                title: "Sales Enablement Assets" },
  { number: 20, file_name: "20_Retention_Upsell_And_Expansion_Context.md", title: "Retention, Upsell & Expansion Context" },
];
