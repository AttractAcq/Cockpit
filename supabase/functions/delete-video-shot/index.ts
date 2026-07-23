// Reel Studio Phase C: deletes a storyboarded shot. Only allowed while still
// 'pending' -- once generation has started there is a Higgsfield job and/or
// downloaded assets associated with it, so deletion here is deliberately
// restricted to the pre-generation storyboarding stage.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";

const FUNCTION_NAME = "delete-video-shot";

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

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

    const shotId = ((await req.json()) as { shot_id?: string }).shot_id?.trim() ?? "";
    if (!shotId) return fail(400, "request", "shot_id is required.");

    const deleted = await sb.from("video_shots").delete().eq("id", shotId).eq("status", "pending").select("id").single();
    if (deleted.error || !deleted.data) return fail(409, "claim", deleted.error?.message ?? "Shot is not pending, or does not exist.");

    return json({ ok: true, id: deleted.data.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(500, "delete", message);
  }
});
