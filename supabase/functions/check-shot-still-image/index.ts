// Reel Studio Phase B, stage 1 of 2: polls Higgsfield for exactly ONE
// still_submitted/still_rendering video_shots row. On completion, downloads
// the still frame into our own video-assets bucket (same retention reasoning
// as check-shot-generation -- never rely on Higgsfield's CDN URL long-term)
// and marks the shot still_complete, ready for the DoP image-to-video step
// (submit-shot-generation).
//
// No webhook signature verification is documented by Higgsfield, so this
// function is the only trust boundary: it re-fetches status directly from
// Higgsfield using our own API key rather than trusting any inbound payload.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";
import {
  checkHiggsfieldGeneration,
  isKnownHiggsfieldStatus,
  isTerminalHiggsfieldStatus,
  readHiggsfieldCredential,
  safeHiggsfieldError,
} from "../_shared/higgsfield.ts";

const FUNCTION_NAME = "check-shot-still-image";
const BUCKET = "video-assets";
const IMAGE_DOWNLOAD_TIMEOUT_MS = 60_000;
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function fetchImageWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Higgsfield still-image download timed out after ${Math.round(IMAGE_DOWNLOAD_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "request", "POST only");

  const sb = svc();
  let shotId = "";

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !user) return fail(401, "authorization", "Not authenticated.");

    const { data: operator } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (!operator || !STAFF_ROLES.has(operator.role)) return fail(403, "authorization", "Staff role required.");

    shotId = ((await req.json()) as { shot_id?: string }).shot_id?.trim() ?? "";
    if (!shotId) return fail(400, "request", "shot_id is required.");

    const credential = readHiggsfieldCredential();
    if (!credential) return fail(503, "configuration", "HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET are not configured.");

    const shot = await sb
      .from("video_shots")
      .select("id, still_image_job_id, status, video_project_id, video_projects(client_id)")
      .eq("id", shotId)
      .in("status", ["still_submitted", "still_rendering"])
      .maybeSingle();
    if (shot.error || !shot.data) {
      return fail(409, "claim", shot.error?.message ?? "Shot is not awaiting a Higgsfield still-image result, or does not exist.");
    }
    const row = shot.data as {
      id: string;
      still_image_job_id: string | null;
      video_project_id: string;
      video_projects: { client_id: string } | { client_id: string }[] | null;
    };
    if (!row.still_image_job_id) return fail(409, "claim", "Shot has no still-image job ID; it was never submitted.");

    const result = await checkHiggsfieldGeneration(fetch, credential, row.still_image_job_id);
    const checkedAt = new Date().toISOString();

    if (!isKnownHiggsfieldStatus(result.status)) {
      return fail(502, "provider", `Unrecognized Higgsfield status: ${result.status}`);
    }

    if (!isTerminalHiggsfieldStatus(result.status)) {
      const saved = await sb
        .from("video_shots")
        .update({ status: "still_rendering", updated_at: checkedAt })
        .eq("id", shotId)
        .in("status", ["still_submitted", "still_rendering"])
        .select("*")
        .single();
      if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Could not persist rendering status.");
      return json({ ok: true, shot: saved.data });
    }

    const imageUrl = result.imageUrls[0] ?? null;
    if (result.status !== "completed" || !imageUrl) {
      const message = safeHiggsfieldError(result.error ?? `Higgsfield status: ${result.status}`);
      const saved = await sb
        .from("video_shots")
        .update({ status: "failed", error: message, updated_at: checkedAt })
        .eq("id", shotId)
        .in("status", ["still_submitted", "still_rendering"])
        .select("*")
        .single();
      if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Could not persist failure status.");
      return fail(502, "provider", message);
    }

    const clientId = Array.isArray(row.video_projects) ? row.video_projects[0]?.client_id : row.video_projects?.client_id;
    if (!clientId) throw new Error("Could not resolve client_id for this shot's project.");

    let uploaded = false;
    let storagePath = "";
    try {
      const download = await fetchImageWithTimeout(imageUrl);
      if (!download.ok) throw new Error(`Could not download the Higgsfield still image: HTTP ${download.status}`);
      const contentType = (download.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
      const extension = CONTENT_TYPE_EXTENSIONS[contentType] ?? "jpg";
      storagePath = `${clientId}/${row.video_project_id}/${shotId}-still.${extension}`;
      const bytes = new Uint8Array(await download.arrayBuffer());

      // upsert:false -- storagePath is deterministic per shot; a second write
      // to the same path (concurrent poll, stale retry) must fail loudly
      // rather than silently overwrite an already-saved still.
      const upload = await sb.storage.from(BUCKET).upload(storagePath, bytes, {
        contentType: CONTENT_TYPE_EXTENSIONS[contentType] ? contentType : "image/jpeg",
        upsert: false,
      });
      if (upload.error) throw upload.error;
      uploaded = true;

      const completedAt = new Date().toISOString();
      const saved = await sb
        .from("video_shots")
        .update({
          status: "still_complete",
          still_image_url: storagePath,
          error: null,
          updated_at: completedAt,
        })
        .eq("id", shotId)
        .in("status", ["still_submitted", "still_rendering"])
        .select("*")
        .single();
      if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Could not persist the completed still image.");
      return json({ ok: true, shot: saved.data });
    } catch (error) {
      if (uploaded && storagePath) await sb.storage.from(BUCKET).remove([storagePath]).catch(() => {});
      const message = safeHiggsfieldError(error);
      await sb.from("video_shots").update({ status: "failed", error: message, updated_at: new Date().toISOString() })
        .eq("id", shotId).in("status", ["still_submitted", "still_rendering"]);
      throw error;
    }
  } catch (error) {
    const message = safeHiggsfieldError(error);
    return fail(500, "check", message);
  }
});
