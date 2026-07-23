// Reel Studio Phase B, stage 1 of 2: submits exactly ONE pending video_shots
// row to Higgsfield's text-to-image model (Soul Standard / Popcorn Auto) to
// produce the still frame that the DoP image-to-video step (stage 2,
// submit-shot-generation) requires. DoP is image-to-video, not
// text-to-video -- see _shared/higgsfield.ts for the full correction notes.
//
// Requires HIGGSFIELD_API_KEY, HIGGSFIELD_API_SECRET, and
// HIGGSFIELD_MODEL_STILL to be configured as Supabase secrets. Fails closed
// with a clear "configuration" error until they are set.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";
import {
  readHiggsfieldCredential,
  readHiggsfieldStillModelId,
  safeHiggsfieldError,
  submitHiggsfieldTextToImage,
} from "../_shared/higgsfield.ts";

const FUNCTION_NAME = "submit-shot-still-image";

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

    const modelId = readHiggsfieldStillModelId();
    if (!modelId) return fail(503, "configuration", "HIGGSFIELD_MODEL_STILL is not configured.");

    // Atomically claim: only a 'pending' shot can start the still-image stage, and only once.
    const claimedAt = new Date().toISOString();
    const claimed = await sb
      .from("video_shots")
      .update({ status: "still_submitted", error: null, updated_at: claimedAt })
      .eq("id", shotId)
      .eq("status", "pending")
      .select("*")
      .single();
    if (claimed.error || !claimed.data) {
      return fail(409, "claim", claimed.error?.message ?? "Shot is not pending, or does not exist.");
    }
    const shot = claimed.data as { id: string; compiled_prompt: string };

    try {
      const submitted = await submitHiggsfieldTextToImage({
        fetchImpl: fetch,
        credential,
        modelId,
        prompt: shot.compiled_prompt,
      });
      const submittedAt = new Date().toISOString();
      const saved = await sb
        .from("video_shots")
        .update({
          still_image_job_id: submitted.requestId,
          still_image_model: modelId,
          status: submitted.status === "queued" || submitted.status === "in_progress" ? "still_submitted" : "still_rendering",
          updated_at: submittedAt,
        })
        .eq("id", shotId)
        .eq("status", "still_submitted")
        .select("*")
        .single();
      if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Could not persist the Higgsfield still-image submission.");
      return json({ ok: true, shot: saved.data });
    } catch (error) {
      const message = safeHiggsfieldError(error);
      await sb.from("video_shots").update({ status: "failed", error: message, updated_at: new Date().toISOString() })
        .eq("id", shotId).eq("status", "still_submitted");
      throw error;
    }
  } catch (error) {
    const message = safeHiggsfieldError(error);
    return fail(500, "submit", message);
  }
});
