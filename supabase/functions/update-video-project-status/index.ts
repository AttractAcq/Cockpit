// Reel Studio Phase C: moves a video_projects row through its status
// lifecycle (storyboarding -> generating -> review -> approved -> handed_off).
// Transitions are an explicit whitelist -- never a free-form status write --
// so a project can't be pushed into an invalid or out-of-order state.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";

const FUNCTION_NAME = "update-video-project-status";

// Phase D: 'handed_off' is no longer reachable through this generic
// whitelist -- it is only ever set by handoff-video-project, which requires
// every shot to be a rendered clip and a real approved production brief to
// exist before it will hand a project off.
const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  storyboarding: new Set(["generating"]),
  generating: new Set(["review"]),
  review: new Set(["approved", "generating"]),
  approved: new Set(),
  handed_off: new Set(),
};

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

    const body = (await req.json()) as { video_project_id?: string; new_status?: string };
    const videoProjectId = body.video_project_id?.trim() ?? "";
    const newStatus = body.new_status?.trim() ?? "";
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");
    if (!newStatus) return fail(400, "request", "new_status is required.");

    const project = await sb.from("video_projects").select("id, status").eq("id", videoProjectId).maybeSingle();
    if (project.error || !project.data) return fail(404, "project", "Video project not found.");

    const allowed = ALLOWED_TRANSITIONS[project.data.status] ?? new Set();
    if (!allowed.has(newStatus)) {
      return fail(409, "transition", `Cannot move a project from '${project.data.status}' to '${newStatus}'.`);
    }

    const updated = await sb.from("video_projects")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", videoProjectId).eq("status", project.data.status)
      .select("*").single();
    if (updated.error || !updated.data) return fail(409, "transition", updated.error?.message ?? "Status transition failed.");

    return json({ ok: true, project: updated.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(500, "update", message);
  }
});
