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
}

export interface VideoShotRow {
  id: string;
  video_project_id: string;
  shot_number: number;
  beat_description: string;
  compiled_prompt: string;
  shot_class: ShotClass;
  human_presence: HumanPresence;
  model: string | null;
  render_tier: RenderTier;
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
  motion_type: string | null;
  motion_strength: number | null;
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
