// Reel Studio Phase 3: confirm a reserved final-Reel upload actually landed and
// promote it to the project's current version.
//
// Ownership of the uploaded object is confirmed against storage BEFORE the
// authoritative row is made current — a reserved row whose object never arrived
// can never become the final Reel. The current-version swap runs inside one
// locked transaction (complete_final_reel_upload) so two concurrent uploads can
// never both become current, and a version that is publishing or published is
// never superseded.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import {
  FINAL_REEL_BUCKET,
  FINAL_REEL_MAX_BYTES,
  finalReelPathBelongsToProject,
  reelSpecWarnings,
  resolveReportedMediaMetadata,
  type FinalReelDeliverable,
} from "../_shared/final-reel-contract.ts";

const FUNCTION_NAME = "complete-final-reel-upload";

const fail = (status: number, stage: string, message: string, code?: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message, code }, status);

function rpcStatus(message: string): number {
  if (/REEL_PROJECT_NOT_FOUND|REEL_DELIVERABLE_NOT_FOUND/.test(message)) return 404;
  if (/REEL_CURRENT_VERSION_PUBLISHING/.test(message)) return 409;
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
      reported_width?: unknown; reported_height?: unknown; reported_duration_sec?: unknown;
    };
    const clientId = body.client_id?.trim() ?? "";
    const videoProjectId = body.video_project_id?.trim() ?? "";
    const deliverableId = body.deliverable_id?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");
    if (!deliverableId) return fail(400, "request", "deliverable_id is required.");

    const existing = await sb.from("video_project_deliverables").select("*")
      .eq("id", deliverableId).eq("video_project_id", videoProjectId).eq("client_id", clientId).maybeSingle();
    if (existing.error) return fail(500, "deliverable", existing.error.message);
    if (!existing.data) return fail(404, "deliverable", "Final Reel upload slot not found for this project and client.");
    const deliverable = existing.data as FinalReelDeliverable & { upload_state: string };

    // The stored path must be inside this client's + project's own namespace.
    if (
      deliverable.storage_bucket !== FINAL_REEL_BUCKET ||
      !finalReelPathBelongsToProject(deliverable.storage_path, clientId, videoProjectId)
    ) {
      return fail(409, "path", "The reserved storage path is not scoped to this client and project.");
    }

    // Confirm the object really exists and read its true size from storage —
    // the browser's declared size is never trusted as the persisted value.
    const lastSlash = deliverable.storage_path.lastIndexOf("/");
    const directory = deliverable.storage_path.slice(0, lastSlash);
    const filename = deliverable.storage_path.slice(lastSlash + 1);
    const listed = await sb.storage.from(FINAL_REEL_BUCKET).list(directory, { search: filename, limit: 100 });
    if (listed.error) return fail(500, "storage", `Could not verify the uploaded file: ${listed.error.message}`);
    const object = (listed.data ?? []).find((entry) => entry.name === filename);
    if (!object) {
      return fail(409, "storage", "The uploaded file was not found in storage. Re-run the upload before completing it.");
    }
    const verifiedSize = typeof object.metadata?.size === "number" ? object.metadata.size : null;
    if (verifiedSize !== null) {
      if (verifiedSize <= 0) return fail(422, "storage", "The uploaded file is empty.");
      if (verifiedSize > FINAL_REEL_MAX_BYTES) {
        return fail(422, "storage", `The uploaded file is ${(verifiedSize / 1024 / 1024).toFixed(1)} MB; the maximum is ${FINAL_REEL_MAX_BYTES / 1024 / 1024} MB.`);
      }
    }
    const verifiedMime = typeof object.metadata?.mimetype === "string" ? object.metadata.mimetype.toLowerCase() : null;
    if (verifiedMime && verifiedMime.split(";")[0] !== "video/mp4") {
      return fail(422, "storage", `The uploaded file is ${verifiedMime}, not video/mp4.`);
    }

    // Browser-probed dimensions/duration are advisory. Anything unavailable stays
    // null and is reported as unknown — never fabricated.
    const media = resolveReportedMediaMetadata({
      width: body.reported_width, height: body.reported_height, durationSec: body.reported_duration_sec,
    });

    const completed = await sb.rpc("complete_final_reel_upload", {
      p_client_id: clientId,
      p_video_project_id: videoProjectId,
      p_deliverable_id: deliverableId,
      p_verified_size_bytes: verifiedSize,
      p_width: media.width,
      p_height: media.height,
      p_duration_sec: media.duration_sec,
      p_metadata_source: media.media_metadata_source,
    });
    if (completed.error || !completed.data) {
      const message = completed.error?.message ?? "Could not finalise the final Reel upload.";
      return fail(rpcStatus(message), "complete", message, message.match(/^(REEL_[A-Z_]+):/)?.[1]);
    }

    const row = completed.data as FinalReelDeliverable;
    return json({
      ok: true,
      deliverable: row,
      // Advisory only — these never block upload or approval.
      spec_warnings: reelSpecWarnings(row),
      media_metadata_source: row.media_metadata_source,
    });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
