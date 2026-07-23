// Reel Studio Phase B: submits exactly ONE pending video_shots row to
// Higgsfield and records the returned request_id. Mirrors the claim/submit
// pattern in generate-ai-background-image/index.ts. Polling and download
// happen separately in check-shot-generation (single-item-per-call, same
// resource-safety reasoning as the asset-generation job worker).
//
// Requires HIGGSFIELD_API_KEY, HIGGSFIELD_API_SECRET, and HIGGSFIELD_MODEL_DRAFT /
// HIGGSFIELD_MODEL_FINAL to be configured as Supabase secrets. None exist yet
// as of 2026-07-22 -- this function will fail closed with a clear
// "configuration" error until they are set.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";
import {
  readHiggsfieldCredential,
  readHiggsfieldModelId,
  safeHiggsfieldError,
  submitHiggsfieldGeneration,
} from "../_shared/higgsfield.ts";

const FUNCTION_NAME = "submit-shot-generation";

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

    // Atomically claim: only a 'pending' shot can be submitted, and only once.
    const claimedAt = new Date().toISOString();
    const claimed = await sb
      .from("video_shots")
      .update({ status: "submitted", error: null, updated_at: claimedAt })
      .eq("id", shotId)
      .eq("status", "pending")
      .select("*")
      .single();
    if (claimed.error || !claimed.data) {
      return fail(409, "claim", claimed.error?.message ?? "Shot is not pending, or does not exist.");
    }
    const shot = claimed.data as { id: string; render_tier: "draft" | "final"; compiled_prompt: string };

    const modelId = readHiggsfieldModelId(shot.render_tier);
    if (!modelId) {
      const envKey = shot.render_tier === "draft" ? "HIGGSFIELD_MODEL_DRAFT" : "HIGGSFIELD_MODEL_FINAL";
      const message = `${envKey} is not configured.`;
      await sb.from("video_shots").update({ status: "failed", error: message, updated_at: new Date().toISOString() })
        .eq("id", shotId).eq("status", "submitted");
      return fail(503, "configuration", message);
    }

    try {
      const submitted = await submitHiggsfieldGeneration({
        fetchImpl: fetch,
        credential,
        modelId,
        prompt: shot.compiled_prompt,
      });
      const submittedAt = new Date().toISOString();
      const saved = await sb
        .from("video_shots")
        .update({
          higgsfield_job_id: submitted.requestId,
          model: modelId,
          status: submitted.status === "queued" || submitted.status === "in_progress" ? "submitted" : "rendering",
          updated_at: submittedAt,
        })
        .eq("id", shotId)
        .eq("status", "submitted")
        .select("*")
        .single();
      if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Could not persist the Higgsfield submission.");
      return json({ ok: true, shot: saved.data });
    } catch (error) {
      const message = safeHiggsfieldError(error);
      await sb.from("video_shots").update({ status: "failed", error: message, updated_at: new Date().toISOString() })
        .eq("id", shotId).eq("status", "submitted");
      throw error;
    }
  } catch (error) {
    const message = safeHiggsfieldError(error);
    return fail(500, "submit", message);
  }
});
