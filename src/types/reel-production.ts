// Programme Stage J — Reel Studio Completion, frontend types.

export type ProductionStrategy = "proof_editorial" | "motion_explainer" | "cinematic_ai" | "footage" | "hybrid";

export const PRODUCTION_STRATEGY_LABEL: Record<ProductionStrategy, string> = {
  proof_editorial: "Proof Editorial",
  motion_explainer: "Motion Explainer",
  cinematic_ai: "Cinematic AI",
  footage: "Founder / Client Footage",
  hybrid: "Hybrid",
};

export type AutomationPolicy = "ai_first" | "human_first" | "hybrid_allowed";
export type QualityRequirement = "draft" | "standard" | "premium";

export interface ClientReelStyleRow {
  id: string;
  client_id: string;
  name: string;
  is_default: boolean;
  motion_presets: string[];
  typography: Record<string, unknown>;
  evidence_treatment: Record<string, unknown>;
  caption_system: Record<string, unknown>;
  intro_outro: Record<string, unknown>;
  sound_system: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type RenderMode = "automated_template" | "provider_render" | "human_editor_handoff" | "manual_upload";

export const RENDER_MODE_LABEL: Record<RenderMode, string> = {
  automated_template: "Automated template render",
  provider_render: "Provider-based render",
  human_editor_handoff: "Human editor handoff",
  manual_upload: "Manual upload",
};

export type CompositionContractStatus = "draft" | "ready" | "rendered";

export interface TimelineEntry {
  order: number;
  source: "shot" | "intro" | "outro";
  shot_id: string | null;
  duration_sec: number;
  transition: string | null;
}

export type VoiceSource = "real_voice" | "consent_voice_clone" | "ai_narrator";

export interface VoiceTrack {
  source: VoiceSource;
  consent_confirmed: boolean;
  script: string | null;
}

export type LoudnessStandard = "EBU_R128" | "ATSC_A85";

export interface AudioSpec {
  music_ref: string | null;
  sfx_refs: string[];
  loudness_standard: LoudnessStandard;
}

export type CaptionTimingSource = "manual" | "auto_generated" | "none";

export interface CaptionSpec {
  enabled: boolean;
  timing_source: CaptionTimingSource;
}

export interface VideoCompositionContractRow {
  id: string;
  client_id: string;
  video_project_id: string;
  render_mode: RenderMode;
  status: CompositionContractStatus;
  timeline: TimelineEntry[];
  voice_track: Partial<VoiceTrack>;
  audio: Partial<AudioSpec>;
  captions: Partial<CaptionSpec>;
  cta_frame: Record<string, unknown>;
  rendered_deliverable_id: string | null;
  created_at: string;
  updated_at: string;
}
