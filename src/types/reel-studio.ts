// Reel Studio (Phase A schema + Phase B generation loop + Phase C orchestration/UI)
// types, mapped 1:1 to the live public.video_projects / video_shots /
// brand_prompt_blocks columns. Not related to the legacy studio/AssetGrid
// (asset_brief_index-era) components.

export type VideoArchetype = "A1" | "A2" | "A3" | "A4" | "A5";
export type AwarenessStage = "unaware" | "problem_aware" | "solution_aware" | "product_aware" | "most_aware";
export type VideoProjectStatus = "storyboarding" | "generating" | "review" | "approved" | "handed_off";
export type ShotClass = "metaphor" | "atmosphere" | "abstract";
export type HumanPresence = "none" | "hands_only";
export type RenderTier = "draft" | "final";
export type ShotStatus =
  | "pending"
  | "still_submitted"
  | "still_rendering"
  | "still_complete"
  | "submitted"
  | "rendering"
  | "complete"
  | "failed";

export interface VideoProjectRow {
  id: string;
  client_id: string;
  organic_master_id: string | null;
  ads_master_id: string | null;
  client_production_brief_id: string | null;
  archetype: VideoArchetype;
  awareness_stage: AwarenessStage;
  target_duration_sec: number;
  brand_prompt_block_id: string;
  brand_prompt_block_version: number;
  status: VideoProjectStatus;
  title: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  /**
   * Phase 3: the project's CURRENT final Reel. This is the only authoritative
   * answer to "what is the final Reel?" — never infer it from timestamps,
   * filenames, asset groups or storage listings. Optional so reads keep working
   * before the Phase 3 migration is applied.
   */
  current_deliverable_id?: string | null;
}

// ── Phase 3: the final edited Reel produced by an external editor ───────────
// One row per uploaded MP4 version in public.video_project_deliverables.
// Exactly one row per project has is_current = true.

export type DeliverableReviewStatus = "needs_review" | "approved" | "rejected" | "archived";
export type DeliverableUploadState = "reserved" | "uploaded";
/** Null width/height/duration mean UNKNOWN — they are never fabricated. */
export type MediaMetadataSource = "unknown" | "client_reported" | "server_probed";

export interface VideoProjectDeliverableRow {
  id: string;
  client_id: string;
  video_project_id: string;
  client_production_brief_id: string | null;
  source_table: string | null;
  source_row_id: string | null;

  storage_bucket: string;
  storage_path: string;
  original_filename: string | null;
  mime_type: string;
  file_format: string;
  file_size_bytes: number;

  width: number | null;
  height: number | null;
  duration_sec: number | null;
  media_metadata_source: MediaMetadataSource;

  version: number;
  is_current: boolean;
  upload_state: DeliverableUploadState;

  status: DeliverableReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_feedback: string | null;

  uploaded_by: string | null;
  upload_completed_at: string | null;
  superseded_at: string | null;
  superseded_by_deliverable_id: string | null;

  created_at: string;
  updated_at: string;
}

/** Which provider phase produced a shot's `failed` status (Phase 2). */
export type ShotFailureStage =
  | "still_submit"
  | "still_render"
  | "still_download"
  | "video_submit"
  | "video_render"
  | "video_download";

export interface VideoShotRow {
  // Required pre-image planning fields. Manual creation, editing, full
  // storyboard generation, and individual regeneration share this contract.
  id: string;
  video_project_id: string;
  shot_number: number;
  beat_description: string;
  compiled_prompt: string;
  shot_class: ShotClass;
  human_presence: HumanPresence;
  render_tier: RenderTier;
  motion_type: string | null;
  motion_strength: number | null;

  // Provider-populated generation and media fields.
  model: string | null;
  higgsfield_job_id: string | null;
  status: ShotStatus;
  clip_url: string | null;
  source_url: string | null;
  duration_sec: number | null;
  credits_spent: number;
  approved_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  still_image_url: string | null;
  still_image_job_id: string | null;
  still_image_model: string | null;

  // Phase 2 provider-recovery fields. `failure_stage` is null on shots that
  // failed before Phase 2 — classifyReelShotFailure() derives the phase instead.
  failure_stage: ShotFailureStage | null;
  failed_at: string | null;
  still_attempt_count: number;
  video_attempt_count: number;
  last_still_attempt_at: string | null;
  last_video_attempt_at: string | null;
}

export interface PendingVideoShotInput {
  shotNumber: number;
  beatDescription: string;
  compiledPrompt: string;
  shotClass: ShotClass;
  humanPresence: HumanPresence;
  renderTier: RenderTier;
  /** Opaque provider catalogue ID; null until the operator selects motion. */
  motionType: string | null;
  /** Required only when motionType is selected. */
  motionStrength: number | null;
}

export type BrandPromptBlockType = "brand_dna" | "brand_sting";

export interface BrandPromptBlockRow {
  id: string;
  block_type: BrandPromptBlockType;
  version: number;
  name: string;
  grade_block: string | null;
  lens_block: string | null;
  mood_block: string | null;
  motion_block: string | null;
  negative_block: string | null;
  prompt_block: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HiggsfieldMotion {
  id: string;
  name: string;
  description: string;
  previewUrl: string | null;
  startEndFrame: boolean;
}
