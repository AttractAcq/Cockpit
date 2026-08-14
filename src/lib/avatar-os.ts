import { invokeFn, supabase } from "@/lib/supabase";
import type {
  AvatarApprovalDecision,
  AvatarAsset,
  AvatarComponent,
  AvatarRelease,
  AvatarReviewDecision,
  AvatarWorkspace,
  FinalizeAvatarAppearanceResponse,
  FinalizeAvatarAssetLibraryResponse,
  FinalizeAvatarOperatingContextResponse,
  FinalizeAvatarStrategyResponse,
  FinalizeAvatarWorldResponse,
  GenerateAvatarAssetRequest,
  GenerateAvatarAssetResponse,
  PrepareAvatarAppearanceResponse,
  PrepareAvatarAssetLibraryResponse,
  PrepareAvatarOperatingContextResponse,
  PrepareAvatarStrategyResponse,
  PrepareAvatarWorldResponse,
  RunAvatarAppearanceStepResponse,
  RunAvatarAssetLibraryStepResponse,
  RunAvatarOperatingContextStepResponse,
  RunAvatarStrategyStepResponse,
  RunAvatarWorldStepResponse,
} from "@/types/avatar-os";
import type { IntelligenceResearchRun, IntelligenceResearchStep } from "@/types/intelligence";

async function maybeSingle<T>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw error;
  return (data as T | null) ?? null;
}

async function rows<T>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw error;
  return (data as T[] | null) ?? [];
}

export async function fetchAvatarWorkspace(clientId: string): Promise<AvatarWorkspace> {
  const [latestRelease, activePointer, latestRun] = await Promise.all([
    maybeSingle<AvatarRelease>(supabase.from("client_avatar_releases")
      .select("*").eq("client_id", clientId).order("version", { ascending: false }).limit(1).maybeSingle()),
    maybeSingle<{ release_id: string }>(supabase.from("client_avatar_active_releases")
      .select("release_id").eq("client_id", clientId).maybeSingle()),
    maybeSingle<IntelligenceResearchRun>(supabase.from("client_research_runs")
      .select("*").eq("client_id", clientId).eq("research_domain", "avatar_system")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()),
  ]);

  const activeRelease = activePointer?.release_id === latestRelease?.id
    ? latestRelease
    : activePointer
      ? await maybeSingle<AvatarRelease>(supabase.from("client_avatar_releases")
        .select("*").eq("id", activePointer.release_id).eq("client_id", clientId).maybeSingle())
      : null;

  const releaseForWorkspace = latestRelease ?? activeRelease;
  const [steps, components, assets, approvalDecisions] = await Promise.all([
    latestRun
      ? rows<IntelligenceResearchStep>(supabase.from("client_research_steps")
        .select("*").eq("client_id", clientId).eq("research_run_id", latestRun.id).order("step_order"))
      : Promise.resolve([]),
    releaseForWorkspace
      ? rows<AvatarComponent>(supabase.from("client_avatar_components")
        .select("*").eq("client_id", clientId).eq("release_id", releaseForWorkspace.id).order("display_order"))
      : Promise.resolve([]),
    releaseForWorkspace
      ? rows<AvatarAsset>(supabase.from("client_avatar_assets")
        .select("*").eq("client_id", clientId).eq("release_id", releaseForWorkspace.id).order("created_at", { ascending: false }))
      : Promise.resolve([]),
    releaseForWorkspace
      ? rows<AvatarApprovalDecision>(supabase.from("client_avatar_approval_decisions")
        .select("*").eq("client_id", clientId).eq("release_id", releaseForWorkspace.id).order("decided_at", { ascending: false }))
      : Promise.resolve([]),
  ]);

  return { latestRelease, activeRelease, latestRun, steps, components, assets, approvalDecisions };
}

export async function prepareAvatarStrategy(clientId: string): Promise<PrepareAvatarStrategyResponse> {
  return invokeFn<PrepareAvatarStrategyResponse>("run-avatar-strategy", { action: "prepare", client_id: clientId });
}

export async function runAvatarStrategyStep(
  clientId: string,
  researchRunId: string,
): Promise<RunAvatarStrategyStepResponse> {
  return invokeFn<RunAvatarStrategyStepResponse>("run-avatar-strategy", {
    action: "step",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function finalizeAvatarStrategy(
  clientId: string,
  researchRunId: string,
): Promise<FinalizeAvatarStrategyResponse> {
  return invokeFn<FinalizeAvatarStrategyResponse>("run-avatar-strategy", {
    action: "finalize",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function driveAvatarStrategyBuild(
  clientId: string,
  onProgress?: (progress: RunAvatarStrategyStepResponse["progress"]) => void,
): Promise<FinalizeAvatarStrategyResponse> {
  const prepared = await prepareAvatarStrategy(clientId);
  if (!prepared.ok || !prepared.research_run_id) throw new Error(prepared.message);
  for (let guard = 0; guard < 10; guard += 1) {
    const result = await runAvatarStrategyStep(clientId, prepared.research_run_id);
    onProgress?.(result.progress);
    if (!result.ok && result.terminal) throw new Error(result.message);
    if (result.terminal) return finalizeAvatarStrategy(clientId, prepared.research_run_id);
  }
  throw new Error("Avatar Strategy workflow exceeded its step guard.");
}

export async function prepareAvatarAppearance(clientId: string): Promise<PrepareAvatarAppearanceResponse> {
  return invokeFn<PrepareAvatarAppearanceResponse>("run-avatar-appearance", { action: "prepare", client_id: clientId });
}

export async function runAvatarAppearanceStep(
  clientId: string,
  researchRunId: string,
): Promise<RunAvatarAppearanceStepResponse> {
  return invokeFn<RunAvatarAppearanceStepResponse>("run-avatar-appearance", {
    action: "step",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function finalizeAvatarAppearance(
  clientId: string,
  researchRunId: string,
): Promise<FinalizeAvatarAppearanceResponse> {
  return invokeFn<FinalizeAvatarAppearanceResponse>("run-avatar-appearance", {
    action: "finalize",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function driveAvatarAppearanceBuild(
  clientId: string,
  onProgress?: (progress: RunAvatarAppearanceStepResponse["progress"]) => void,
): Promise<FinalizeAvatarAppearanceResponse> {
  const prepared = await prepareAvatarAppearance(clientId);
  if (!prepared.ok || !prepared.research_run_id) throw new Error(prepared.message);
  for (let guard = 0; guard < 10; guard += 1) {
    const result = await runAvatarAppearanceStep(clientId, prepared.research_run_id);
    onProgress?.(result.progress);
    if (!result.ok && result.terminal) throw new Error(result.message);
    if (result.terminal) return finalizeAvatarAppearance(clientId, prepared.research_run_id);
  }
  throw new Error("Avatar Appearance workflow exceeded its step guard.");
}

export async function prepareAvatarWorld(clientId: string): Promise<PrepareAvatarWorldResponse> {
  return invokeFn<PrepareAvatarWorldResponse>("run-avatar-world", { action: "prepare", client_id: clientId });
}

export async function runAvatarWorldStep(
  clientId: string,
  researchRunId: string,
): Promise<RunAvatarWorldStepResponse> {
  return invokeFn<RunAvatarWorldStepResponse>("run-avatar-world", {
    action: "step",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function finalizeAvatarWorld(
  clientId: string,
  researchRunId: string,
): Promise<FinalizeAvatarWorldResponse> {
  return invokeFn<FinalizeAvatarWorldResponse>("run-avatar-world", {
    action: "finalize",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function driveAvatarWorldBuild(
  clientId: string,
  onProgress?: (progress: RunAvatarWorldStepResponse["progress"]) => void,
): Promise<FinalizeAvatarWorldResponse> {
  const prepared = await prepareAvatarWorld(clientId);
  if (!prepared.ok || !prepared.research_run_id) throw new Error(prepared.message);
  for (let guard = 0; guard < 10; guard += 1) {
    const result = await runAvatarWorldStep(clientId, prepared.research_run_id);
    onProgress?.(result.progress);
    if (!result.ok && result.terminal) throw new Error(result.message);
    if (result.terminal) return finalizeAvatarWorld(clientId, prepared.research_run_id);
  }
  throw new Error("Avatar World workflow exceeded its step guard.");
}

export async function prepareAvatarOperatingContext(clientId: string): Promise<PrepareAvatarOperatingContextResponse> {
  return invokeFn<PrepareAvatarOperatingContextResponse>("run-avatar-operating-context", { action: "prepare", client_id: clientId });
}

export async function runAvatarOperatingContextStep(
  clientId: string,
  researchRunId: string,
): Promise<RunAvatarOperatingContextStepResponse> {
  return invokeFn<RunAvatarOperatingContextStepResponse>("run-avatar-operating-context", {
    action: "step",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function finalizeAvatarOperatingContext(
  clientId: string,
  researchRunId: string,
): Promise<FinalizeAvatarOperatingContextResponse> {
  return invokeFn<FinalizeAvatarOperatingContextResponse>("run-avatar-operating-context", {
    action: "finalize",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function driveAvatarOperatingContextBuild(
  clientId: string,
  onProgress?: (progress: RunAvatarOperatingContextStepResponse["progress"]) => void,
): Promise<FinalizeAvatarOperatingContextResponse> {
  const prepared = await prepareAvatarOperatingContext(clientId);
  if (!prepared.ok || !prepared.research_run_id) throw new Error(prepared.message);
  for (let guard = 0; guard < 10; guard += 1) {
    const result = await runAvatarOperatingContextStep(clientId, prepared.research_run_id);
    onProgress?.(result.progress);
    if (!result.ok && result.terminal) throw new Error(result.message);
    if (result.terminal) return finalizeAvatarOperatingContext(clientId, prepared.research_run_id);
  }
  throw new Error("Avatar Operating Context workflow exceeded its step guard.");
}

export async function prepareAvatarAssetLibrary(clientId: string): Promise<PrepareAvatarAssetLibraryResponse> {
  return invokeFn<PrepareAvatarAssetLibraryResponse>("run-avatar-asset-library", { action: "prepare", client_id: clientId });
}

export async function runAvatarAssetLibraryStep(
  clientId: string,
  researchRunId: string,
): Promise<RunAvatarAssetLibraryStepResponse> {
  return invokeFn<RunAvatarAssetLibraryStepResponse>("run-avatar-asset-library", {
    action: "step",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function finalizeAvatarAssetLibrary(
  clientId: string,
  researchRunId: string,
): Promise<FinalizeAvatarAssetLibraryResponse> {
  return invokeFn<FinalizeAvatarAssetLibraryResponse>("run-avatar-asset-library", {
    action: "finalize",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function driveAvatarAssetLibraryBuild(
  clientId: string,
  onProgress?: (progress: RunAvatarAssetLibraryStepResponse["progress"]) => void,
): Promise<FinalizeAvatarAssetLibraryResponse> {
  const prepared = await prepareAvatarAssetLibrary(clientId);
  if (!prepared.ok || !prepared.research_run_id) throw new Error(prepared.message);
  for (let guard = 0; guard < 10; guard += 1) {
    const result = await runAvatarAssetLibraryStep(clientId, prepared.research_run_id);
    onProgress?.(result.progress);
    if (!result.ok && result.terminal) throw new Error(result.message);
    if (result.terminal) return finalizeAvatarAssetLibrary(clientId, prepared.research_run_id);
  }
  throw new Error("Avatar Asset Library workflow exceeded its step guard.");
}

export async function generateAvatarAsset(
  clientId: string,
  request: GenerateAvatarAssetRequest,
): Promise<GenerateAvatarAssetResponse> {
  return invokeFn<GenerateAvatarAssetResponse>("generate-avatar-asset", {
    client_id: clientId,
    ...request,
  });
}

export async function reviewAvatarRelease(
  releaseId: string,
  decision: AvatarReviewDecision,
  note?: string,
): Promise<AvatarRelease> {
  const { data, error } = await supabase.rpc("review_avatar_release", {
    p_release_id: releaseId,
    p_decision: decision,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as AvatarRelease;
}
