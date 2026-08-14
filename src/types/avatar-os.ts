import type {
  IntelligenceResearchRun,
  IntelligenceResearchStep,
  IntelligenceReviewDecision,
} from "@/types/intelligence";

export type AvatarReleaseStatus = "draft" | "needs_review" | "approved" | "superseded" | "archived";

export type AvatarComponentType =
  | "avatar_strategy"
  | "appearance"
  | "environment"
  | "voice_personality"
  | "creative_direction"
  | "knowledge_expertise"
  | "content_format"
  | "asset_library";

export type AvatarAssetType =
  | "canonical_image"
  | "pose_reference"
  | "expression_reference"
  | "environment_reference"
  | "character_sheet"
  | "environment_sheet"
  | "prompt_pack"
  | "voice_reference"
  | "production_reference"
  | "other";

export interface AvatarRelease {
  id: string;
  client_id: string;
  version: number;
  status: AvatarReleaseStatus;
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

export interface AvatarComponent {
  id: string;
  client_id: string;
  release_id: string;
  component_type: AvatarComponentType;
  component_key: string;
  title: string;
  summary: string;
  strategic_rationale: string;
  evidence_summary: string;
  structured_payload: Record<string, unknown>;
  upstream_refs: unknown[];
  generation_contract: Record<string, unknown>;
  regenerates_component_id: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface AvatarAsset {
  id: string;
  client_id: string;
  release_id: string;
  component_id: string | null;
  asset_type: AvatarAssetType;
  title: string;
  description: string;
  storage_bucket: string | null;
  storage_path: string | null;
  external_url: string | null;
  prompt_payload: Record<string, unknown>;
  generation_provider: string | null;
  generation_model: string | null;
  status: "draft" | "needs_review" | "approved" | "archived";
  version: number;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvatarApprovalDecision {
  id: string;
  client_id: string;
  release_id: string;
  decision: AvatarReviewDecision;
  previous_status: AvatarReleaseStatus;
  resulting_status: AvatarReleaseStatus;
  note: string | null;
  decided_by: string;
  decided_at: string;
}

export interface AvatarWorkspace {
  latestRelease: AvatarRelease | null;
  activeRelease: AvatarRelease | null;
  latestRun: IntelligenceResearchRun | null;
  steps: IntelligenceResearchStep[];
  components: AvatarComponent[];
  assets: AvatarAsset[];
  approvalDecisions: AvatarApprovalDecision[];
}

export interface PrepareAvatarStrategyResponse {
  ok: boolean;
  mode: "prepared" | "resumed" | "blocked";
  message: string;
  research_run_id?: string;
  release_id?: string;
  steps?: IntelligenceResearchStep[];
  code?: string;
  missing_domains?: string[];
}

export interface RunAvatarStrategyStepResponse {
  ok: boolean;
  terminal: boolean;
  message: string;
  research_run_id: string;
  release_id?: string;
  step?: IntelligenceResearchStep;
  progress: { completed: number; failed: number; total: number };
}

export interface FinalizeAvatarStrategyResponse {
  ok: boolean;
  message: string;
  release: AvatarRelease;
  run: IntelligenceResearchRun;
}

export type PrepareAvatarAppearanceResponse = PrepareAvatarStrategyResponse;
export type RunAvatarAppearanceStepResponse = RunAvatarStrategyStepResponse;
export type FinalizeAvatarAppearanceResponse = FinalizeAvatarStrategyResponse;
export type PrepareAvatarWorldResponse = PrepareAvatarStrategyResponse;
export type RunAvatarWorldStepResponse = RunAvatarStrategyStepResponse;
export type FinalizeAvatarWorldResponse = FinalizeAvatarStrategyResponse;
export type PrepareAvatarOperatingContextResponse = PrepareAvatarStrategyResponse;
export type RunAvatarOperatingContextStepResponse = RunAvatarStrategyStepResponse;
export type FinalizeAvatarOperatingContextResponse = FinalizeAvatarStrategyResponse;
export type PrepareAvatarAssetLibraryResponse = PrepareAvatarStrategyResponse;
export type RunAvatarAssetLibraryStepResponse = RunAvatarStrategyStepResponse;
export type FinalizeAvatarAssetLibraryResponse = FinalizeAvatarStrategyResponse;
export type AvatarReviewDecision = IntelligenceReviewDecision;

export interface GenerateAvatarAssetRequest {
  asset_type: AvatarAssetType;
  title?: string;
  description?: string;
  storage_bucket?: string;
  storage_path?: string;
  external_url?: string;
  generation_provider?: string;
  generation_model?: string;
}

export interface GenerateAvatarAssetResponse {
  ok: boolean;
  message: string;
  asset?: AvatarAsset;
  code?: string;
}
