// Reel Studio Phase C: deletes a storyboarded shot. Only allowed while still
// 'pending' -- once generation has started there is a Higgsfield job and/or
// downloaded assets associated with it, so deletion here is deliberately
// restricted to the pre-generation storyboarding stage.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";

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

    const body = (await req.json()) as {
      client_id?: string;
      video_project_id?: string;
      shot_id?: string;
    };
    const clientId = body.client_id?.trim() ?? "";
    const videoProjectId = body.video_project_id?.trim() ?? "";
    const shotId = body.shot_id?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");
    if (!shotId) return fail(400, "request", "shot_id is required.");

    const deleted = await sb.rpc("delete_pending_reel_shot", {
      p_client_id: clientId,
      p_video_project_id: videoProjectId,
      p_shot_id: shotId,
    });
    if (deleted.error || !deleted.data) {
      const message = deleted.error?.message ?? "Could not delete the pending shot.";
      const status = /REEL_(PROJECT_NOT_FOUND|SHOT_NOT_FOUND)/.test(message) ? 404 : 409;
      return fail(status, "claim", message);
    }

    return json({ ok: true, id: deleted.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(500, "delete", message);
  }
});
