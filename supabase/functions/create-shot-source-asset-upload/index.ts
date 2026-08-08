// Programme Stage J — mint a one-time signed upload URL for a real,
// non-AI-generated source asset (screenshot, document, footage clip) to
// attach to one shot slot. Mirrors create-final-reel-upload's server-built
// path pattern: the browser never chooses the bucket or path. The shot row
// is not updated until confirm-shot-source-asset-upload verifies the object
// actually landed.

import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import { SHOT_SOURCE_ASSET_BUCKET, safeShotSourceAssetFilename, shotSourceAssetStoragePath } from "../_shared/reel-production.ts";

const FUNCTION_NAME = "create-shot-source-asset-upload";
const fail = (status: number, stage: string, message: string, code?: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message, code }, status);

const MAX_BYTES = 200 * 1024 * 1024;

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
      client_id?: string; video_shot_id?: string;
      filename?: string; mime_type?: string; file_size_bytes?: number;
    };
    const clientId = body.client_id?.trim() ?? "";
    const shotId = body.video_shot_id?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!shotId) return fail(400, "request", "video_shot_id is required.");

    const size = Number(body.file_size_bytes);
    if (!Number.isFinite(size) || size <= 0) return fail(422, "validation", "file_size_bytes must be a positive number.", "EMPTY_FILE");
    if (size > MAX_BYTES) return fail(422, "validation", `File is ${(size / 1024 / 1024).toFixed(1)} MB; the maximum is ${MAX_BYTES / 1024 / 1024} MB.`, "FILE_TOO_LARGE");
    const mimeType = (body.mime_type ?? "").trim().toLowerCase().split(";")[0];
    if (!mimeType) return fail(422, "validation", "mime_type is required.", "MISSING_MIME");

    // Relationship proved from the database, never from the request body.
    const shot = await sb.from("video_shots").select("id, video_project_id").eq("id", shotId).maybeSingle();
    if (shot.error) return fail(500, "shot", shot.error.message);
    if (!shot.data) return fail(404, "shot", "Shot not found.");
    const project = await sb.from("video_projects").select("id, client_id").eq("id", shot.data.video_project_id).eq("client_id", clientId).maybeSingle();
    if (project.error) return fail(500, "project", project.error.message);
    if (!project.data) return fail(404, "project", "This shot does not belong to a project for this client.");

    const safeFilename = safeShotSourceAssetFilename(body.filename ?? "");
    const path = shotSourceAssetStoragePath({ clientId, videoProjectId: shot.data.video_project_id, shotId, safeFilename });

    // Deliberately no upsert: a second write to the same path (re-attaching
    // the same filename) must fail loudly, matching check-shot-generation's
    // "never silently overwrite" convention. Attaching a different file
    // (a new filename) always succeeds.
    const signed = await sb.storage.from(SHOT_SOURCE_ASSET_BUCKET).createSignedUploadUrl(path);
    if (signed.error || !signed.data) return fail(500, "sign", `Could not create the upload URL: ${signed.error?.message ?? "no url returned"}`);

    return json({
      ok: true,
      upload: { bucket: SHOT_SOURCE_ASSET_BUCKET, path: signed.data.path ?? path, token: signed.data.token, signed_url: signed.data.signedUrl },
      mime_type: mimeType,
      original_filename: (body.filename ?? "").slice(0, 200),
    });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
