// Reel Studio Phase 2, Workstream C: recover a shot whose VIDEO phase failed
// terminally, WITHOUT regenerating its still image.
//
// The stored still, the planning fields and the selected motion all survive. Only
// the failed video job is cleared, returning the shot to `still_complete` so the
// existing submit-shot-generation path can start one fresh DoP job. The operator
// may deliberately change the motion as part of the retry (motion_type /
// motion_strength in the body); omitting them preserves the current selection.
//
// Reset-only for the same reason as retry-shot-still-image: the submit path owns
// the single atomic still_complete → submitted claim, so no duplicate provider job
// can be created. reset_failed_reel_shot_video() enforces every safety condition
// (project editable, failure really belongs to the video phase, still present, no
// clip, motion selected, matching updated_at) inside one locked transaction.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import { classifyReelShotFailure, reelShotRecoveryPlan } from "../_shared/reel-studio-recovery.ts";

const FUNCTION_NAME = "retry-shot-video";

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

function rpcStatus(message: string): number {
  return /REEL_PROJECT_NOT_FOUND|REEL_SHOT_NOT_FOUND/.test(message)
    ? 404
    : /REEL_SHOT_STALE|REEL_SHOT_NOT_FAILED|REEL_FAILURE_PHASE_MISMATCH|REEL_CLIP_ALREADY_PRESENT|REEL_STILL_MISSING|REEL_MOTION_MISSING|REEL_MOTION_INVALID|REEL_PROJECT_NOT_EDITABLE/.test(message)
      ? 409
      : 500;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "request", "POST only");

  const sb = svc();

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !user) return fail(401, "authorization", "Not authenticated.");

    const { data: operator } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (!operator || !STAFF_ROLES.has(operator.role)) return fail(403, "authorization", "Staff role required.");

    const body = (await req.json()) as {
      client_id?: string; video_project_id?: string; shot_id?: string;
      expected_updated_at?: string; motion_type?: string | null; motion_strength?: number | null;
    };
    const clientId = body.client_id?.trim() ?? "";
    const videoProjectId = body.video_project_id?.trim() ?? "";
    const shotId = body.shot_id?.trim() ?? "";
    const expectedUpdatedAt = body.expected_updated_at?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");
    if (!shotId) return fail(400, "request", "shot_id is required.");
    if (!expectedUpdatedAt) return fail(400, "request", "expected_updated_at is required for concurrency safety.");

    const motionType = typeof body.motion_type === "string" && body.motion_type.trim() ? body.motion_type.trim() : null;
    const motionStrength = typeof body.motion_strength === "number" ? body.motion_strength : null;
    if (motionStrength !== null && (!Number.isFinite(motionStrength) || motionStrength < 0 || motionStrength > 1)) {
      return fail(400, "request", "motion_strength must be between 0 and 1.");
    }
    if (motionStrength !== null && motionType === null) {
      return fail(400, "request", "motion_strength can only be changed together with motion_type.");
    }

    const shot = await sb.from("video_shots")
      .select("id, status, failure_stage, still_image_url, still_image_job_id, higgsfield_job_id, clip_url, motion_type, motion_strength, video_project_id, video_projects(client_id, status)")
      .eq("id", shotId).eq("video_project_id", videoProjectId).maybeSingle();
    if (shot.error) return fail(500, "shot", shot.error.message);
    if (!shot.data) return fail(404, "shot", "Shot does not belong to the supplied project.");
    const projectRef = Array.isArray(shot.data.video_projects) ? shot.data.video_projects[0] : shot.data.video_projects;
    if (!projectRef || projectRef.client_id !== clientId) return fail(404, "shot", "Shot does not belong to client_id.");

    const editable = projectRef.status === "storyboarding" || projectRef.status === "generating";
    const plan = reelShotRecoveryPlan(shot.data, editable);
    if (!plan.canRetryVideo) {
      return fail(409, "gate", plan.blockedReason ?? "This shot's video phase cannot be retried in its current state.");
    }

    const reset = await sb.rpc("reset_failed_reel_shot_video", {
      p_client_id: clientId,
      p_video_project_id: videoProjectId,
      p_shot_id: shotId,
      p_expected_updated_at: expectedUpdatedAt,
      p_motion_type: motionType,
      p_motion_strength: motionStrength,
    });
    if (reset.error || !reset.data) {
      const message = reset.error?.message ?? "Could not reset the failed video job.";
      return fail(rpcStatus(message), "reset", message);
    }

    return json({
      ok: true,
      shot: reset.data,
      previous_failure: classifyReelShotFailure(shot.data),
      preserved: plan.retryPreserves,
      motion_changed: motionType !== null,
      next_action: "generate_video",
      message: "The failed video job was cleared and the existing still image was kept. Run Generate video to submit one fresh job.",
    });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
