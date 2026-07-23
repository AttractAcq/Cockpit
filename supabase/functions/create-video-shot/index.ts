// Reel Studio Phase C: adds one storyboarded shot to a video_projects row.
// Shot content (beat_description/compiled_prompt/shot_class/motion) is
// written by hand by the operator in the Studio UI -- there is no AI
// storyboard-compiler step in this phase.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";

const FUNCTION_NAME = "create-video-shot";
const SHOT_CLASSES = new Set(["metaphor", "atmosphere", "abstract"]);
const HUMAN_PRESENCE = new Set(["none", "hands_only"]);
const RENDER_TIERS = new Set(["draft", "final"]);

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

interface Body {
  video_project_id?: string;
  shot_number?: number;
  beat_description?: string;
  compiled_prompt?: string;
  shot_class?: string;
  human_presence?: string;
  motion_type?: string;
  motion_strength?: number;
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
    const beatDescription = body.beat_description?.trim() ?? "";
    const compiledPrompt = body.compiled_prompt?.trim() ?? "";
    const shotClass = body.shot_class?.trim() ?? "";
    const humanPresence = (body.human_presence?.trim() || "none");
    const renderTier = (body.render_tier?.trim() || "draft");

    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");
    if (typeof body.shot_number !== "number" || body.shot_number <= 0) return fail(400, "request", "shot_number must be a positive integer.");
    if (!beatDescription) return fail(400, "request", "beat_description is required.");
    if (!compiledPrompt) return fail(400, "request", "compiled_prompt is required.");
    if (!SHOT_CLASSES.has(shotClass)) return fail(400, "request", "shot_class must be metaphor, atmosphere, or abstract.");
    if (!HUMAN_PRESENCE.has(humanPresence)) return fail(400, "request", "human_presence must be none or hands_only.");
    if (!RENDER_TIERS.has(renderTier)) return fail(400, "request", "render_tier must be draft or final.");
    if (body.motion_type && (typeof body.motion_strength !== "number" || body.motion_strength < 0 || body.motion_strength > 1)) {
      return fail(400, "request", "motion_strength must be between 0 and 1 when motion_type is set.");
    }

    const project = await sb.from("video_projects").select("id").eq("id", videoProjectId).maybeSingle();
    if (project.error || !project.data) return fail(404, "project", "Video project not found.");

    const insert = await sb.from("video_shots").insert({
      video_project_id: videoProjectId,
      shot_number: body.shot_number,
      beat_description: beatDescription,
      compiled_prompt: compiledPrompt,
      shot_class: shotClass,
      human_presence: humanPresence,
      render_tier: renderTier,
      motion_type: body.motion_type?.trim() || null,
      motion_strength: body.motion_type ? body.motion_strength : null,
    }).select("*").single();
    if (insert.error || !insert.data) return fail(500, "insert", insert.error?.message ?? "Could not create shot.");

    return json({ ok: true, shot: insert.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(500, "create", message);
  }
});
