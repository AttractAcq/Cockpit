// Programme Stage J — confirm a real source asset (screenshot, document,
// footage clip) actually landed in storage, then record it on the shot.
// Mirrors complete-final-reel-upload's confirm-before-trust pattern: the
// object's presence is verified against storage before the shot is ever
// marked shot_source_kind = 'source_asset'.

import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import { SHOT_SOURCE_ASSET_BUCKET, shotSourceAssetPathBelongsToShot } from "../_shared/reel-production.ts";

const FUNCTION_NAME = "confirm-shot-source-asset-upload";
const fail = (status: number, stage: string, message: string, code?: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message, code }, status);

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
      client_id?: string; video_shot_id?: string; storage_path?: string;
      mime_type?: string; original_filename?: string; description?: string;
    };
    const clientId = body.client_id?.trim() ?? "";
    const shotId = body.video_shot_id?.trim() ?? "";
    const storagePath = body.storage_path?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!shotId) return fail(400, "request", "video_shot_id is required.");
    if (!storagePath) return fail(400, "request", "storage_path is required.");

    const shot = await sb.from("video_shots").select("id, video_project_id").eq("id", shotId).maybeSingle();
    if (shot.error) return fail(500, "shot", shot.error.message);
    if (!shot.data) return fail(404, "shot", "Shot not found.");
    const project = await sb.from("video_projects").select("id, client_id").eq("id", shot.data.video_project_id).eq("client_id", clientId).maybeSingle();
    if (project.error) return fail(500, "project", project.error.message);
    if (!project.data) return fail(404, "project", "This shot does not belong to a project for this client.");

    if (!shotSourceAssetPathBelongsToShot(storagePath, clientId, shot.data.video_project_id, shotId)) {
      return fail(409, "path", "The storage path is not scoped to this client, project and shot.");
    }

    const lastSlash = storagePath.lastIndexOf("/");
    const directory = storagePath.slice(0, lastSlash);
    const filename = storagePath.slice(lastSlash + 1);
    const listed = await sb.storage.from(SHOT_SOURCE_ASSET_BUCKET).list(directory, { search: filename, limit: 100 });
    if (listed.error) return fail(500, "storage", `Could not verify the uploaded file: ${listed.error.message}`);
    const object = (listed.data ?? []).find((entry) => entry.name === filename);
    if (!object) return fail(409, "storage", "The uploaded file was not found in storage. Re-run the upload before confirming.");

    const verifiedSize = typeof object.metadata?.size === "number" ? object.metadata.size : null;
    if (verifiedSize !== null && verifiedSize <= 0) return fail(422, "storage", "The uploaded file is empty.");
    const verifiedMime = typeof object.metadata?.mimetype === "string" ? object.metadata.mimetype.split(";")[0] : (body.mime_type ?? "").split(";")[0];

    const updated = await sb.from("video_shots")
      .update({
        shot_source_kind: "source_asset",
        source_storage_bucket: SHOT_SOURCE_ASSET_BUCKET,
        source_storage_path: storagePath,
        source_mime_type: verifiedMime || null,
        source_original_filename: (body.original_filename ?? "").slice(0, 200) || null,
        source_description: (body.description ?? "").trim().slice(0, 2000) || null,
        status: "complete",
        updated_at: new Date().toISOString(),
      })
      .eq("id", shotId)
      .select("*")
      .single();
    if (updated.error) return fail(500, "update", updated.error.message);

    return json({ ok: true, shot: updated.data });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
