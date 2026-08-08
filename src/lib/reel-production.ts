// Programme Stage J — Reel Studio Completion data access.

import { supabase, invokeFn } from "./supabase";
import type {
  ClientReelStyleRow,
  VideoCompositionContractRow,
  ProductionStrategy,
  AutomationPolicy,
  QualityRequirement,
  RenderMode,
  CompositionContractStatus,
} from "@/types/reel-production";

export async function fetchClientReelStyles(clientId: string): Promise<ClientReelStyleRow[]> {
  const { data, error } = await supabase.from("client_reel_styles").select("*").eq("client_id", clientId).order("is_default", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClientReelStyleRow[];
}

export async function fetchCompositionContract(videoProjectId: string): Promise<VideoCompositionContractRow | null> {
  const { data, error } = await supabase.from("video_composition_contracts").select("*").eq("video_project_id", videoProjectId).maybeSingle();
  if (error) throw error;
  return (data as VideoCompositionContractRow | null) ?? null;
}

export interface SelectStrategyResult {
  ok: true;
  idempotent_replay: boolean;
  strategy: ProductionStrategy;
  reason: string;
  reel_style_id?: string | null;
}

export async function selectReelProductionStrategy(input: {
  clientId: string; videoProjectId: string;
  proofAvailable: boolean; realFootageAvailable: boolean;
  automationPolicy: AutomationPolicy; qualityRequirement: QualityRequirement;
  confirmOverride?: boolean;
}): Promise<SelectStrategyResult> {
  return await invokeFn<SelectStrategyResult>("select-reel-production-strategy", {
    client_id: input.clientId,
    video_project_id: input.videoProjectId,
    proof_available: input.proofAvailable,
    real_footage_available: input.realFootageAvailable,
    automation_policy: input.automationPolicy,
    quality_requirement: input.qualityRequirement,
    confirm_override: input.confirmOverride ?? false,
  });
}

export interface CreateContractResult {
  ok: true;
  idempotent_replay: boolean;
  contract: VideoCompositionContractRow;
}

export async function createCompositionContract(input: { clientId: string; videoProjectId: string; renderMode?: RenderMode }): Promise<CreateContractResult> {
  return await invokeFn<CreateContractResult>("create-composition-contract", {
    client_id: input.clientId,
    video_project_id: input.videoProjectId,
    render_mode: input.renderMode,
  });
}

export interface UpdateContractResult {
  ok: true;
  contract: VideoCompositionContractRow;
  warnings: string[];
}

export async function updateCompositionContract(input: {
  clientId: string; compositionContractId: string;
  voiceTrack?: unknown; audio?: unknown; captions?: unknown; ctaFrame?: unknown;
  renderMode?: RenderMode; status?: CompositionContractStatus; renderedDeliverableId?: string;
}): Promise<UpdateContractResult> {
  return await invokeFn<UpdateContractResult>("update-composition-contract", {
    client_id: input.clientId,
    composition_contract_id: input.compositionContractId,
    voice_track: input.voiceTrack,
    audio: input.audio,
    captions: input.captions,
    cta_frame: input.ctaFrame,
    render_mode: input.renderMode,
    status: input.status,
    rendered_deliverable_id: input.renderedDeliverableId,
  });
}

export interface CreateShotSourceAssetUploadResult {
  ok: true;
  upload: { bucket: string; path: string; token: string; signed_url: string };
  mime_type: string;
  original_filename: string;
}

export async function createShotSourceAssetUpload(input: {
  clientId: string; videoShotId: string; filename: string; mimeType: string; fileSizeBytes: number;
}): Promise<CreateShotSourceAssetUploadResult> {
  return await invokeFn<CreateShotSourceAssetUploadResult>("create-shot-source-asset-upload", {
    client_id: input.clientId,
    video_shot_id: input.videoShotId,
    filename: input.filename,
    mime_type: input.mimeType,
    file_size_bytes: input.fileSizeBytes,
  });
}

export async function confirmShotSourceAssetUpload(input: {
  clientId: string; videoShotId: string; storagePath: string; mimeType: string; originalFilename: string; description: string;
}): Promise<{ ok: true; shot: unknown }> {
  return await invokeFn("confirm-shot-source-asset-upload", {
    client_id: input.clientId,
    video_shot_id: input.videoShotId,
    storage_path: input.storagePath,
    mime_type: input.mimeType,
    original_filename: input.originalFilename,
    description: input.description,
  });
}
