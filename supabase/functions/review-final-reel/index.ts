// Reel Studio Phase 3: approve the current final Reel, or return it for revision.
//
// This is deliberately NOT the Phase 2 shot-clip review. Approving shot clips
// means "these production materials are usable"; approving a final Reel means
// "this finished deliverable may be published". The two are separate decisions on
// separate records and neither implies the other.
//
// Requesting a revision preserves the uploaded version and its media — nothing is
// deleted — and blocks scheduling until a new version is uploaded and approved.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import {
  FINAL_REEL_BUCKET,
  validateFinalReelReview,
  type FinalReelDeliverable,
} from "../_shared/final-reel-contract.ts";

const FUNCTION_NAME = "review-final-reel";

const fail = (status: number, stage: string, message: string, code?: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message, code }, status);

function rpcStatus(message: string): number {
  if (/REEL_DELIVERABLE_NOT_FOUND/.test(message)) return 404;
  if (/REEL_DELIVERABLE_STALE|REEL_DELIVERABLE_NOT_CURRENT|REEL_DELIVERABLE_NOT_UPLOADED|REEL_ALREADY_PUBLISHED|REEL_REVIEW_FEEDBACK_REQUIRED/.test(message)) return 409;
  return 500;
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
      client_id?: string; video_project_id?: string; deliverable_id?: string;
      action?: string; feedback?: string; expected_updated_at?: string;
    };
    const clientId = body.client_id?.trim() ?? "";
    const videoProjectId = body.video_project_id?.trim() ?? "";
    const deliverableId = body.deliverable_id?.trim() ?? "";
    const action = body.action?.trim() ?? "";
    const expectedUpdatedAt = body.expected_updated_at?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");
    if (!deliverableId) return fail(400, "request", "deliverable_id is required.");
    if (action !== "approve" && action !== "request_revision") {
      return fail(400, "request", "action must be approve or request_revision.");
    }
    if (!expectedUpdatedAt) return fail(400, "request", "expected_updated_at is required for concurrency safety.");

    const loaded = await sb.from("video_project_deliverables").select("*")
      .eq("id", deliverableId).eq("video_project_id", videoProjectId).eq("client_id", clientId).maybeSingle();
    if (loaded.error) return fail(500, "deliverable", loaded.error.message);
    if (!loaded.data) return fail(404, "deliverable", "Final Reel not found for this project and client.");
    const deliverable = loaded.data as FinalReelDeliverable;

    // A shot clip lives in client_assets and can never reach this function, but
    // the project relationship is still proved explicitly.
    const project = await sb.from("video_projects")
      .select("id, client_id, current_deliverable_id, client_production_brief_id")
      .eq("id", videoProjectId).eq("client_id", clientId).maybeSingle();
    if (project.error) return fail(500, "project", project.error.message);
    if (!project.data) return fail(404, "project", "Video project not found for this client.");
    if (project.data.current_deliverable_id !== deliverableId) {
      return fail(409, "gate", "Only the project's current final Reel can be reviewed.");
    }

    // Approval requires the file to actually still exist in the private bucket.
    let storageObjectPresent = true;
    if (action === "approve") {
      const lastSlash = deliverable.storage_path.lastIndexOf("/");
      const listed = await sb.storage.from(FINAL_REEL_BUCKET)
        .list(deliverable.storage_path.slice(0, lastSlash), { search: deliverable.storage_path.slice(lastSlash + 1), limit: 100 });
      if (listed.error) return fail(500, "storage", `Could not verify the stored file: ${listed.error.message}`);
      storageObjectPresent = (listed.data ?? []).some((entry) => entry.name === deliverable.storage_path.slice(lastSlash + 1));
    }

    const validated = validateFinalReelReview({
      deliverable, action: action as "approve" | "request_revision",
      feedback: body.feedback ?? null, storageObjectPresent,
    });
    if (!validated.ok) return fail(409, "gate", validated.error, validated.code);

    const reviewed = await sb.rpc("review_final_reel_deliverable", {
      p_client_id: clientId,
      p_video_project_id: videoProjectId,
      p_deliverable_id: deliverableId,
      p_expected_updated_at: expectedUpdatedAt,
      p_next_status: validated.value.nextStatus,
      p_feedback: body.feedback ?? null,
      p_reviewed_by: user.id,
    });
    if (reviewed.error || !reviewed.data) {
      const message = reviewed.error?.message ?? "Could not record the final Reel review.";
      return fail(rpcStatus(message), "review", message, message.match(/^(REEL_[A-Z_]+):/)?.[1]);
    }

    return json({
      ok: true,
      deliverable: reviewed.data,
      // Approval means "publishable", never "published".
      message: validated.value.nextStatus === "approved"
        ? "Final Reel approved. It can now be used to create a distribution draft — nothing has been published."
        : "Revision requested. The uploaded version is preserved for history and cannot be scheduled.",
    });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
