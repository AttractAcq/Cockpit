// Reel Studio: adds one manually planned pending shot using the same
// authoritative contract as full-storyboard and single-shot AI generation.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import { validatePendingReelShot } from "../_shared/reel-studio-contract.ts";

const FUNCTION_NAME = "create-video-shot";

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

interface Body {
  video_project_id?: string;
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
    const videoProjectId = body.video_project_id?.trim() ?? "";
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");
    const validated = validatePendingReelShot({
      shot_number: body.shot_number,
      beat_description: body.beat_description,
      compiled_prompt: body.compiled_prompt,
      shot_class: body.shot_class,
      human_presence: body.human_presence?.trim() || "none",
      render_tier: body.render_tier?.trim() || "draft",
      motion_type: body.motion_type?.trim() || null,
      motion_strength: body.motion_type ? body.motion_strength : null,
    }, { requireExplicitFields: true });
    if (!validated.ok) return fail(400, "request", validated.error);

    const project = await sb.from("video_projects").select("id").eq("id", videoProjectId).maybeSingle();
    if (project.error || !project.data) return fail(404, "project", "Video project not found.");

    const insert = await sb.from("video_shots").insert({
      video_project_id: videoProjectId,
      ...validated.value,
      status: "pending",
    }).select("*").single();
    if (insert.error || !insert.data) {
      return fail(insert.error?.code === "23505" ? 409 : 500, "insert", insert.error?.message ?? "Could not create shot.");
    }

    return json({ ok: true, shot: insert.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(500, "create", message);
  }
});
