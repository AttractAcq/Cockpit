// Reel Studio Phase C: edits a shot's storyboard fields. Only allowed while
// the shot is still 'pending' -- once generation has started (Phase B's
// submit-shot-still-image claims it), the shot is immutable here (fails
// closed with 409) so a concurrent edit can never race a Higgsfield submission.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";

const FUNCTION_NAME = "update-video-shot";
const SHOT_CLASSES = new Set(["metaphor", "atmosphere", "abstract"]);
const HUMAN_PRESENCE = new Set(["none", "hands_only"]);
const RENDER_TIERS = new Set(["draft", "final"]);

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

interface Body {
  shot_id?: string;
  shot_number?: number;
  beat_description?: string;
  compiled_prompt?: string;
  shot_class?: string;
  human_presence?: string;
  motion_type?: string | null;
  motion_strength?: number | null;
  render_tier?: string;
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

    const body = (await req.json()) as Body;
    const shotId = body.shot_id?.trim() ?? "";
    if (!shotId) return fail(400, "request", "shot_id is required.");

    const patch: Record<string, unknown> = {};
    if (body.shot_number !== undefined) {
      if (typeof body.shot_number !== "number" || body.shot_number <= 0) return fail(400, "request", "shot_number must be a positive integer.");
      patch.shot_number = body.shot_number;
    }
    if (body.beat_description !== undefined) {
      const value = body.beat_description.trim();
      if (!value) return fail(400, "request", "beat_description cannot be empty.");
      patch.beat_description = value;
    }
    if (body.compiled_prompt !== undefined) {
      const value = body.compiled_prompt.trim();
      if (!value) return fail(400, "request", "compiled_prompt cannot be empty.");
      patch.compiled_prompt = value;
    }
    if (body.shot_class !== undefined) {
      if (!SHOT_CLASSES.has(body.shot_class)) return fail(400, "request", "shot_class must be metaphor, atmosphere, or abstract.");
      patch.shot_class = body.shot_class;
    }
    if (body.human_presence !== undefined) {
      if (!HUMAN_PRESENCE.has(body.human_presence)) return fail(400, "request", "human_presence must be none or hands_only.");
      patch.human_presence = body.human_presence;
    }
    if (body.render_tier !== undefined) {
      if (!RENDER_TIERS.has(body.render_tier)) return fail(400, "request", "render_tier must be draft or final.");
      patch.render_tier = body.render_tier;
    }
    if (body.motion_type !== undefined) patch.motion_type = body.motion_type?.trim() || null;
    if (body.motion_strength !== undefined) {
      if (body.motion_strength !== null && (typeof body.motion_strength !== "number" || body.motion_strength < 0 || body.motion_strength > 1)) {
        return fail(400, "request", "motion_strength must be between 0 and 1.");
      }
      patch.motion_strength = body.motion_strength;
    }
    if (Object.keys(patch).length === 0) return fail(400, "request", "No editable fields provided.");
    patch.updated_at = new Date().toISOString();

    const updated = await sb.from("video_shots").update(patch).eq("id", shotId).eq("status", "pending").select("*").single();
    if (updated.error || !updated.data) return fail(409, "claim", updated.error?.message ?? "Shot is not pending, or does not exist.");

    return json({ ok: true, shot: updated.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(500, "update", message);
  }
});
