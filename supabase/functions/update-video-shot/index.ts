// Reel Studio Phase C: edits a shot's storyboard fields. Structural fields
// (beat_description/compiled_prompt/shot_class/human_presence/render_tier/
// shot_number) are only editable while the shot is still 'pending' -- once
// generation has started (Phase B's submit-shot-still-image claims it), those
// fields are immutable here (fails closed with 409) so a concurrent edit can
// never race a Higgsfield submission. motion_type/motion_strength are the one
// exception: they're also editable while 'still_complete', since motion is a
// manual step performed after the still exists (matching the still-complete
// UI gate that requires a motion before "Generate video" appears) -- a
// motion-only patch never races a submission because a still_complete shot
// hasn't been claimed by submit-shot-generation yet.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import { validatePendingReelShot } from "../_shared/reel-studio-contract.ts";

const FUNCTION_NAME = "update-video-shot";

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

    const current = await sb.from("video_shots").select("*").eq("id", shotId).maybeSingle();
    if (current.error) return fail(500, "shot", current.error.message);
    if (!current.data) return fail(404, "shot", "Shot not found.");

    const suppliedFields = [
      body.shot_number !== undefined,
      body.beat_description !== undefined,
      body.compiled_prompt !== undefined,
      body.shot_class !== undefined,
      body.human_presence !== undefined,
      body.motion_type !== undefined,
      body.motion_strength !== undefined,
      body.render_tier !== undefined,
    ];
    if (!suppliedFields.some(Boolean)) return fail(400, "request", "No editable fields provided.");

    const merged = validatePendingReelShot({
      shot_number: body.shot_number ?? current.data.shot_number,
      beat_description: body.beat_description ?? current.data.beat_description,
      compiled_prompt: body.compiled_prompt ?? current.data.compiled_prompt,
      shot_class: body.shot_class ?? current.data.shot_class,
      human_presence: body.human_presence ?? current.data.human_presence,
      render_tier: body.render_tier ?? current.data.render_tier,
      motion_type: body.motion_type !== undefined ? body.motion_type : current.data.motion_type,
      motion_strength: body.motion_strength !== undefined ? body.motion_strength : current.data.motion_strength,
    }, { requireExplicitFields: true });
    if (!merged.ok) return fail(400, "request", merged.error);

    const patch: Record<string, unknown> = {};
    if (body.shot_number !== undefined) patch.shot_number = merged.value.shot_number;
    if (body.beat_description !== undefined) patch.beat_description = merged.value.beat_description;
    if (body.compiled_prompt !== undefined) patch.compiled_prompt = merged.value.compiled_prompt;
    if (body.shot_class !== undefined) patch.shot_class = merged.value.shot_class;
    if (body.human_presence !== undefined) patch.human_presence = merged.value.human_presence;
    if (body.render_tier !== undefined) patch.render_tier = merged.value.render_tier;
    if (body.motion_type !== undefined) patch.motion_type = merged.value.motion_type;
    if (body.motion_strength !== undefined) patch.motion_strength = merged.value.motion_strength;
    patch.updated_at = new Date().toISOString();

    const STRUCTURAL_FIELDS = ["shot_number", "beat_description", "compiled_prompt", "shot_class", "human_presence", "render_tier"];
    const isStructuralEdit = STRUCTURAL_FIELDS.some((field) => field in patch);
    const allowedStatuses = isStructuralEdit ? ["pending"] : ["pending", "still_complete"];

    const updated = await sb.from("video_shots").update(patch)
      .eq("id", shotId)
      .eq("updated_at", current.data.updated_at)
      .in("status", allowedStatuses)
      .select("*")
      .single();
    if (updated.error || !updated.data) {
      return fail(409, "claim", updated.error?.message ?? "Shot changed or is no longer in an editable status.");
    }

    return json({ ok: true, shot: updated.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(500, "update", message);
  }
});
