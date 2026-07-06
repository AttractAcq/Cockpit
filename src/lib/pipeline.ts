// src/lib/pipeline.ts
// Pure, data-access-free helpers for the operational lifecycle spine (Phase H).
//   master → content_creation → assets → distribution → analytics → analysis
//   → completed → archived
// Data access + effective-stage derivation lives in api.ts (fetchEffectiveStageMap).
import type { PipelineStage } from "@/types/phase";

export const STAGE_ORDER: PipelineStage[] = [
  "master",
  "content_creation",
  "assets",
  "distribution",
  "analytics",
  "analysis",
  "completed",
  "archived",
];

export const STAGE_LABEL: Record<PipelineStage, string> = {
  master: "Master",
  content_creation: "Content Creation",
  assets: "Assets",
  distribution: "Distribution",
  analytics: "Analytics",
  analysis: "Analysis",
  completed: "Completed",
  archived: "Archived",
};

export function stageRank(stage: PipelineStage): number {
  const index = STAGE_ORDER.indexOf(stage);
  return index === -1 ? 0 : index;
}

/** A record is ACTIVE in a tab when its effective stage equals that tab's stage. */
export function isActiveInStage(effective: PipelineStage, tabStage: PipelineStage): boolean {
  return stageRank(effective) === stageRank(tabStage);
}

/** A record has PASSED THROUGH a tab once it has advanced beyond that tab's stage. */
export function isPassedThrough(effective: PipelineStage, tabStage: PipelineStage): boolean {
  return stageRank(effective) > stageRank(tabStage);
}

/** The stage a record moves into when it leaves `stage` (next real stage). */
export function nextStage(stage: PipelineStage): PipelineStage {
  const index = stageRank(stage);
  return STAGE_ORDER[Math.min(index + 1, STAGE_ORDER.length - 1)];
}
