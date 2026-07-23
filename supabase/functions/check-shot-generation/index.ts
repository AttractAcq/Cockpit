// Reel Studio Phase B: polls Higgsfield for exactly ONE submitted/rendering
// video_shots row. On completion, downloads the clip into our own video-assets
// bucket (Higgsfield retains files a minimum of 7 days only -- never rely on
// their CDN URL long-term) and marks the shot complete.
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

const FUNCTION_NAME = "check-shot-generation";
const BUCKET = "video-assets";
const CLIP_DOWNLOAD_TIMEOUT_MS = 120_000;

async function fetchClipWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIP_DOWNLOAD_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Higgsfield clip download timed out after ${Math.round(CLIP_DOWNLOAD_TIMEOUT_MS / 1000)}s.`);
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
      .select("id, higgsfield_job_id, status, video_project_id, video_projects(client_id)")
      .eq("id", shotId)
      .in("status", ["submitted", "rendering"])
      .maybeSingle();
    if (shot.error || !shot.data) {
      return fail(409, "claim", shot.error?.message ?? "Shot is not awaiting a Higgsfield result, or does not exist.");
    }
    const row = shot.data as {
      id: string;
      higgsfield_job_id: string | null;
      video_project_id: string;
      video_projects: { client_id: string } | { client_id: string }[] | null;
    };
    if (!row.higgsfield_job_id) return fail(409, "claim", "Shot has no Higgsfield job ID; it was never submitted.");

    const result = await checkHiggsfieldGeneration(fetch, credential, row.higgsfield_job_id);
    const checkedAt = new Date().toISOString();

    // An unrecognized status is neither a known-running nor known-terminal
    // state per the documented lifecycle -- do not guess. Leave the row
    // untouched (no status/error mutation) so a stuck/odd response surfaces
    // as a failed call for the operator to investigate rather than silently
    // spinning forever as "rendering".
    if (!isKnownHiggsfieldStatus(result.status)) {
      return fail(502, "provider", `Unrecognized Higgsfield status: ${result.status}`);
    }

    if (!isTerminalHiggsfieldStatus(result.status)) {
      const saved = await sb
        .from("video_shots")
        .update({ status: "rendering", updated_at: checkedAt })
        .eq("id", shotId)
        .in("status", ["submitted", "rendering"])
        .select("*")
        .single();
      if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Could not persist rendering status.");
      return json({ ok: true, shot: saved.data });
    }

    if (result.status !== "completed" || !result.videoUrl) {
      const message = safeHiggsfieldError(result.error ?? `Higgsfield status: ${result.status}`);
      const saved = await sb
        .from("video_shots")
        .update({ status: "failed", error: message, updated_at: checkedAt })
        .eq("id", shotId)
        .in("status", ["submitted", "rendering"])
        .select("*")
        .single();
      if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Could not persist failure status.");
      return fail(502, "provider", message);
    }

    const clientId = Array.isArray(row.video_projects) ? row.video_projects[0]?.client_id : row.video_projects?.client_id;
    if (!clientId) throw new Error("Could not resolve client_id for this shot's project.");

    const storagePath = `${clientId}/${row.video_project_id}/${shotId}.mp4`;
    let uploaded = false;
    try {
      const download = await fetchClipWithTimeout(result.videoUrl);
      if (!download.ok) throw new Error(`Could not download the Higgsfield clip: HTTP ${download.status}`);
      const bytes = new Uint8Array(await download.arrayBuffer());

      // upsert:false -- storagePath is deterministic per shot; a second write
      // to the same path (concurrent poll, stale retry) must fail loudly
      // rather than silently overwrite an already-saved clip.
      const upload = await sb.storage.from(BUCKET).upload(storagePath, bytes, { contentType: "video/mp4", upsert: false });
      if (upload.error) throw upload.error;
      uploaded = true;

      // Credit cost per request is not exposed by the status response (no
      // documented per-request pricing field) -- generation_credits_ledger is
      // intentionally not written here until that gap is resolved.
      const completedAt = new Date().toISOString();
      const saved = await sb
        .from("video_shots")
        .update({
          status: "complete",
          clip_url: storagePath,
          source_url: result.videoUrl,
          error: null,
          updated_at: completedAt,
        })
        .eq("id", shotId)
        .in("status", ["submitted", "rendering"])
        .select("*")
        .single();
      if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Could not persist the completed shot.");
      return json({ ok: true, shot: saved.data });
    } catch (error) {
      if (uploaded) await sb.storage.from(BUCKET).remove([storagePath]).catch(() => {});
      const message = safeHiggsfieldError(error);
      await sb.from("video_shots").update({ status: "failed", error: message, updated_at: new Date().toISOString() })
        .eq("id", shotId).in("status", ["submitted", "rendering"]);
      throw error;
    }
  } catch (error) {
    const message = safeHiggsfieldError(error);
    return fail(500, "check", message);
  }
});
