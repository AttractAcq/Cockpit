// Reel Studio Phase 3: mint a one-time signed upload URL for the FINAL edited
// Reel MP4 produced by an external editor.
//
// The browser never chooses the bucket or the path. This function validates the
// operator, the project/client relationship, the bound production brief and the
// declared file, then reserves the next version number and its server-built path
// inside one locked transaction (reserve_final_reel_upload) before handing back a
// signed upload URL scoped to exactly that path.
//
// The reserved row is not current and not reviewable until
// complete-final-reel-upload confirms the object actually landed, so an abandoned
// upload never disturbs the existing current version.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import {
  FINAL_REEL_BUCKET,
  finalReelStoragePath,
  validateFinalReelUpload,
} from "../_shared/final-reel-contract.ts";

const FUNCTION_NAME = "create-final-reel-upload";

const fail = (status: number, stage: string, message: string, code?: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message, code }, status);

function rpcStatus(message: string): number {
  if (/REEL_PROJECT_NOT_FOUND/.test(message)) return 404;
  if (/REEL_PROJECT_NOT_HANDED_OFF|REEL_BRIEF_NOT_BOUND|REEL_BRIEF_BINDING_INVALID|REEL_CURRENT_VERSION_PUBLISHING|REEL_REPLACE_APPROVED_UNCONFIRMED/.test(message)) return 409;
  return 500;
}

function rpcCode(message: string): string | undefined {
  return message.match(/^(REEL_[A-Z_]+):/)?.[1];
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
      client_id?: string; video_project_id?: string;
      filename?: string; mime_type?: string; file_size_bytes?: number;
      acknowledge_replace_approved?: boolean;
    };
    const clientId = body.client_id?.trim() ?? "";
    const videoProjectId = body.video_project_id?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");

    const validated = validateFinalReelUpload({
      filename: body.filename ?? "",
      mimeType: body.mime_type ?? "",
      fileSizeBytes: Number(body.file_size_bytes),
    });
    if (!validated.ok) return fail(422, "validation", validated.error, validated.code);

    // Relationship is proved from the database, never from the request body.
    const project = await sb.from("video_projects")
      .select("id, client_id, status, client_production_brief_id, title")
      .eq("id", videoProjectId).eq("client_id", clientId).maybeSingle();
    if (project.error) return fail(500, "project", project.error.message);
    if (!project.data) return fail(404, "project", "Video project not found for this client.");

    // Reserve the version + path atomically. Every eligibility rule
    // (handed_off milestone, bound brief, replacement guards) lives in the RPC.
    const reserved = await sb.rpc("reserve_final_reel_upload", {
      p_client_id: clientId,
      p_video_project_id: videoProjectId,
      p_storage_path_prefix: `${clientId}/${videoProjectId}/final/`,
      p_safe_filename: validated.value.safeFilename,
      p_mime_type: validated.value.mimeType,
      p_file_size_bytes: validated.value.fileSizeBytes,
      p_original_filename: (body.filename ?? "").slice(0, 200),
      p_uploaded_by: user.id,
      p_acknowledge_replace_approved: body.acknowledge_replace_approved === true,
    });
    if (reserved.error || !reserved.data) {
      const message = reserved.error?.message ?? "Could not reserve a final Reel upload slot.";
      return fail(rpcStatus(message), "reserve", message, rpcCode(message));
    }
    const deliverable = reserved.data as { id: string; version: number; storage_path: string };

    // Defensive: the path must be the one we built, not anything else.
    const expectedPath = finalReelStoragePath({
      clientId, videoProjectId, version: deliverable.version, safeFilename: validated.value.safeFilename,
    });
    if (deliverable.storage_path !== expectedPath) {
      return fail(500, "reserve", "The reserved storage path did not match the server-built path.");
    }

    // A signed upload URL is single-use and bound to this exact path. It does not
    // permit overwriting an existing object, so a version's media can never be
    // silently replaced.
    const signed = await sb.storage.from(FINAL_REEL_BUCKET).createSignedUploadUrl(deliverable.storage_path);
    if (signed.error || !signed.data) {
      return fail(500, "sign", `Could not create the upload URL: ${signed.error?.message ?? "no url returned"}`);
    }

    return json({
      ok: true,
      deliverable: reserved.data,
      upload: {
        bucket: FINAL_REEL_BUCKET,
        path: signed.data.path ?? deliverable.storage_path,
        token: signed.data.token,
        signed_url: signed.data.signedUrl,
      },
      version: deliverable.version,
    });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
