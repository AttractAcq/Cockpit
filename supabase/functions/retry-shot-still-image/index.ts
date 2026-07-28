// Reel Studio Phase 2, Workstream C: recover a shot whose STILL-IMAGE phase
// failed terminally.
//
// This is provider-job recovery, NOT Phase 1's "Regenerate shot" (which rewrites
// a pending shot's planning definition before any image exists). Nothing about
// the shot's planning text or its latest saved compiled_prompt is touched — the
// failed image job is cleared and the shot returns to `pending` so the existing
// submit-shot-still-image path can start one fresh job.
//
// Deliberately reset-only: it never calls Higgsfield itself. The submit path
// already owns the single atomic pending → still_submitted claim, so routing the
// retry through it is what makes a duplicate provider job impossible. All the
// safety conditions (project editable, failure really belongs to the still phase,
// no stored still, no video job, no clip, matching updated_at) are enforced by
// reset_failed_reel_shot_still() inside one locked transaction.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import { classifyReelShotFailure, reelShotRecoveryPlan } from "../_shared/reel-studio-recovery.ts";

const FUNCTION_NAME = "retry-shot-still-image";

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

function rpcStatus(message: string): number {
  return /REEL_PROJECT_NOT_FOUND|REEL_SHOT_NOT_FOUND/.test(message)
    ? 404
    : /REEL_SHOT_STALE|REEL_SHOT_NOT_FAILED|REEL_FAILURE_PHASE_MISMATCH|REEL_STILL_ALREADY_PRESENT|REEL_VIDEO_STATE_PRESENT|REEL_PROJECT_NOT_EDITABLE/.test(message)
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
      client_id?: string; video_project_id?: string; shot_id?: string; expected_updated_at?: string;
    };
    const clientId = body.client_id?.trim() ?? "";
    const videoProjectId = body.video_project_id?.trim() ?? "";
    const shotId = body.shot_id?.trim() ?? "";
    const expectedUpdatedAt = body.expected_updated_at?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");
    if (!shotId) return fail(400, "request", "shot_id is required.");
    if (!expectedUpdatedAt) return fail(400, "request", "expected_updated_at is required for concurrency safety.");

    // Pre-check with the same shared contract the UI uses, so the operator gets a
    // precise reason instead of a raw RPC exception. The RPC re-checks everything
    // under lock — this is a message-quality step, not the security boundary.
    const shot = await sb.from("video_shots")
      .select("id, status, failure_stage, still_image_url, still_image_job_id, higgsfield_job_id, clip_url, video_project_id, video_projects(client_id, status)")
      .eq("id", shotId).eq("video_project_id", videoProjectId).maybeSingle();
    if (shot.error) return fail(500, "shot", shot.error.message);
    if (!shot.data) return fail(404, "shot", "Shot does not belong to the supplied project.");
    const projectRef = Array.isArray(shot.data.video_projects) ? shot.data.video_projects[0] : shot.data.video_projects;
    if (!projectRef || projectRef.client_id !== clientId) return fail(404, "shot", "Shot does not belong to client_id.");

    const editable = projectRef.status === "storyboarding" || projectRef.status === "generating";
    const plan = reelShotRecoveryPlan(shot.data, editable);
    if (!plan.canRetryStill) {
      return fail(409, "gate", plan.blockedReason ?? "This shot's image phase cannot be retried in its current state.");
    }

    const reset = await sb.rpc("reset_failed_reel_shot_still", {
      p_client_id: clientId,
      p_video_project_id: videoProjectId,
      p_shot_id: shotId,
      p_expected_updated_at: expectedUpdatedAt,
    });
    if (reset.error || !reset.data) {
      const message = reset.error?.message ?? "Could not reset the failed image job.";
      return fail(rpcStatus(message), "reset", message);
    }

    return json({
      ok: true,
      shot: reset.data,
      previous_failure: classifyReelShotFailure(shot.data),
      preserved: plan.retryPreserves,
      next_action: "generate_still",
      message: "The failed image job was cleared. The shot is pending again — run Generate image to submit one fresh job.",
    });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
