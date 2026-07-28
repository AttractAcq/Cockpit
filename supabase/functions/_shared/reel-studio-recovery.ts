// Reel Studio Phase 2, Workstream C: provider render-failure classification and
// the recovery actions that are safe for each shot state.
//
// This is deliberately NOT the same concept as Phase 1's "Regenerate shot", which
// rewrites a *pending* shot's planning definition before any image exists. These
// are provider-job recoveries: they never touch planning text, never discard a
// valid still, and never discard a rendered clip.
//
// A single `failed` status cannot tell an operator which half of the two-stage
// Higgsfield pipeline broke, so `video_shots.failure_stage` records it. Rows that
// failed before Phase 2 have a NULL failure_stage; `classifyReelShotFailure`
// derives the phase from the persisted job/media fields instead (the same
// derivation the recovery RPCs perform in SQL).

export const REEL_FAILURE_STAGES = [
  "still_submit",
  "still_render",
  "still_download",
  "video_submit",
  "video_render",
  "video_download",
] as const;
export type ReelFailureStage = typeof REEL_FAILURE_STAGES[number];

const STAGE_SET = new Set<string>(REEL_FAILURE_STAGES);

export function isReelFailureStage(value: unknown): value is ReelFailureStage {
  return typeof value === "string" && STAGE_SET.has(value);
}

export type ReelFailurePhase = "still" | "video";

export const REEL_FAILURE_STAGE_LABEL: Record<ReelFailureStage, string> = {
  still_submit: "Image generation could not be submitted to the provider",
  still_render: "The provider failed while rendering the image",
  still_download: "The rendered image could not be stored",
  video_submit: "Video generation could not be submitted to the provider",
  video_render: "The provider failed while rendering the video",
  video_download: "The rendered video clip could not be stored",
};

export function reelFailurePhase(stage: ReelFailureStage): ReelFailurePhase {
  return stage.startsWith("still_") ? "still" : "video";
}

export interface ReelShotRecoveryState {
  status: string;
  failure_stage?: string | null;
  still_image_url: string | null;
  still_image_job_id: string | null;
  higgsfield_job_id: string | null;
  clip_url: string | null;
}

export interface ReelShotFailureClassification {
  failed: boolean;
  phase: ReelFailurePhase | null;
  stage: ReelFailureStage | null;
  /** True when the phase was inferred from job/media fields, not a stored stage. */
  derived: boolean;
  label: string | null;
}

/**
 * Classify a failed shot. The derivation order mirrors the pipeline: a clip means
 * nothing is left to recover; a video job or a completed still means the video
 * half is the one that broke; otherwise the still half broke.
 */
export function classifyReelShotFailure(shot: ReelShotRecoveryState): ReelShotFailureClassification {
  if (shot.status !== "failed") {
    return { failed: false, phase: null, stage: null, derived: false, label: null };
  }
  if (isReelFailureStage(shot.failure_stage)) {
    return {
      failed: true,
      phase: reelFailurePhase(shot.failure_stage),
      stage: shot.failure_stage,
      derived: false,
      label: REEL_FAILURE_STAGE_LABEL[shot.failure_stage],
    };
  }
  const phase: ReelFailurePhase = shot.higgsfield_job_id || shot.still_image_url ? "video" : "still";
  return {
    failed: true,
    phase,
    stage: null,
    derived: true,
    label: phase === "video"
      ? "Video generation failed (stage recorded before failure tracking existed)"
      : "Image generation failed (stage recorded before failure tracking existed)",
  };
}

export interface ReelShotRecoveryPlan {
  /** Poll the SAME active provider job — never creates a new one. */
  canCheckStill: boolean;
  canCheckVideo: boolean;
  /** Submit a NEW still job after a terminal still failure. */
  canRetryStill: boolean;
  /** Submit a NEW video job after a terminal video failure. */
  canRetryVideo: boolean;
  /** What a permitted retry keeps and what it discards. */
  retryPreserves: string | null;
  blockedReason: string | null;
}

const ACTIVE_STILL = new Set(["still_submitted", "still_rendering"]);
const ACTIVE_VIDEO = new Set(["submitted", "rendering"]);

/**
 * The recovery actions that are safe for one shot. `projectEditable` reflects the
 * project still being in `storyboarding`/`generating` — recovery must not reopen
 * generation for a project already in review/approved/handed off.
 */
export function reelShotRecoveryPlan(shot: ReelShotRecoveryState, projectEditable: boolean): ReelShotRecoveryPlan {
  const base: ReelShotRecoveryPlan = {
    canCheckStill: ACTIVE_STILL.has(shot.status),
    canCheckVideo: ACTIVE_VIDEO.has(shot.status),
    canRetryStill: false,
    canRetryVideo: false,
    retryPreserves: null,
    blockedReason: null,
  };
  if (shot.status !== "failed") return base;

  if (shot.clip_url) {
    return { ...base, blockedReason: "This shot already has a rendered clip; nothing needs to be regenerated." };
  }
  if (!projectEditable) {
    return { ...base, blockedReason: "This project is no longer in a generating state, so provider retries are disabled." };
  }

  const classification = classifyReelShotFailure(shot);
  if (classification.phase === "video") {
    if (!shot.still_image_url) {
      return { ...base, blockedReason: "The video stage failed but no stored still image exists. Retry image generation instead." };
    }
    return {
      ...base,
      canRetryVideo: true,
      retryPreserves: "Keeps the existing still image, the shot's planning text, and the selected motion. Only the failed video job is cleared.",
    };
  }
  if (shot.still_image_url) {
    return { ...base, blockedReason: "A still image is already stored for this shot, so the image stage cannot be reset." };
  }
  return {
    ...base,
    canRetryStill: true,
    retryPreserves: "Keeps the shot's planning text and latest saved prompt. Only the failed image job is cleared; no video or clip is affected.",
  };
}
