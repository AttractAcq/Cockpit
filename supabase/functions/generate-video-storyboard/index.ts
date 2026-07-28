// Reel Studio Phase 1: generates one complete, validated pending storyboard
// from the exact approved reel_video production brief bound to a project.
// The database RPC locks the project and inserts the entire set atomically only
// while it is still empty; image generation remains a separate user action.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import { callAnthropic, hasAnthropicKey, isAiEnabled } from "../_shared/anthropic.ts";
import {
  extractReelJson,
  MAX_REEL_STORYBOARD_SHOTS,
  MIN_REEL_STORYBOARD_SHOTS,
  validateReelStoryboardOutput,
} from "../_shared/reel-studio-contract.ts";
import {
  ReelStudioGateError,
  resolveApprovedReelBrief,
  type ReelProjectRecord,
} from "../_shared/reel-studio-project.ts";

const FUNCTION_NAME = "generate-video-storyboard";
const MODEL_BUDGET_MS = 135_000;
const FIRST_CALL_TIMEOUT_MS = 115_000;
const MIN_RETRY_BUDGET_MS = 45_000;

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

function compact(value: string | null | undefined, chars: number): string {
  return (value ?? "[EMPTY]").trim().slice(0, chars);
}

async function generateShots(system: string, user: string, timeoutMs: number): Promise<string> {
  const result = await callAnthropic({
    system,
    user,
    model: Deno.env.get("AA_STORYBOARD_AI_MODEL") ??
      Deno.env.get("AA_PRODUCTION_BRIEF_AI_MODEL") ??
      "claude-sonnet-4-6",
    maxTokens: 8000,
    timeoutMs,
    rejectTruncation: true,
  });
  if (!result.ok) throw new Error(result.error);
  return result.text;
}

function rpcStatus(message: string): number {
  return /REEL_STORYBOARD_NOT_EMPTY|REEL_PROJECT_NOT_EDITABLE|REEL_BRIEF_BINDING_INVALID/.test(message)
    ? 409
    : 500;
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
    if (!isAiEnabled() || !hasAnthropicKey()) {
      return fail(500, "configuration", "Server-side AI generation is not configured.");
    }

    const body = (await req.json()) as { client_id?: string; video_project_id?: string };
    const clientId = body.client_id?.trim() ?? "";
    const videoProjectId = body.video_project_id?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");

    const projectResult = await sb.from("video_projects").select("*").eq("id", videoProjectId).maybeSingle();
    if (projectResult.error) return fail(500, "project", projectResult.error.message);
    if (!projectResult.data || projectResult.data.client_id !== clientId) {
      return fail(404, "project", "Video project not found for client_id.");
    }
    if (!["storyboarding", "generating"].includes(projectResult.data.status)) {
      return fail(409, "gate", "Storyboard can only be generated before the project enters review.");
    }

    const existingShots = await sb.from("video_shots").select("id").eq("video_project_id", videoProjectId).limit(1);
    if (existingShots.error) return fail(500, "shots", existingShots.error.message);
    if (existingShots.data?.length) return fail(409, "gate", "Project already has shots.");

    const resolved = await resolveApprovedReelBrief(
      sb,
      projectResult.data as ReelProjectRecord,
    );
    const project = resolved.project;
    const brief = resolved.brief;

    const brandResult = await sb.from("brand_prompt_blocks").select("*")
      .eq("id", project.brand_prompt_block_id)
      .maybeSingle();
    if (brandResult.error) return fail(500, "brand_block", brandResult.error.message);
    if (!brandResult.data) return fail(409, "brand_block", "Project brand prompt block no longer exists.");

    const brandDnaText = [
      brandResult.data.grade_block && `Grade: ${brandResult.data.grade_block}`,
      brandResult.data.lens_block && `Lens: ${brandResult.data.lens_block}`,
      brandResult.data.mood_block && `Mood: ${brandResult.data.mood_block}`,
      brandResult.data.motion_block && `Motion guidance: ${brandResult.data.motion_block}`,
      brandResult.data.negative_block && `Negative requirements: ${brandResult.data.negative_block}`,
    ].filter(Boolean).join("\n");

    const targetDurationSec = project.target_duration_sec;
    const suggestedShotCount = Math.max(
      MIN_REEL_STORYBOARD_SHOTS,
      Math.min(MAX_REEL_STORYBOARD_SHOTS, Math.round(targetDurationSec / 4)),
    );
    const system = `You are the Reel Studio storyboard compiler for a faceless-format Instagram Reel. Produce a coherent ordered B-roll storyboard. Every compiled_prompt is sent directly to a text-to-image model, so it must be complete, visual, self-contained, and include the supplied grade, lens, mood, and negative requirements. Motion guidance should inform composition and implied camera movement, but you must never invent or output a Higgsfield motion ID; provider motion is selected later by the user.

Return JSON only, with no markdown or commentary, matching exactly:
{"shots":[{"shot_number":1,"beat_description":"string","compiled_prompt":"string","shot_class":"metaphor|atmosphere|abstract","human_presence":"none|hands_only","render_tier":"draft","motion_type":null,"motion_strength":null}]}

Rules:
- Return ${MIN_REEL_STORYBOARD_SHOTS}-${MAX_REEL_STORYBOARD_SHOTS} shots.
- shot_number values must be unique, ordered, and contiguous from 1 through N.
- Every string field must be non-empty.
- human_presence is none unless only hands are essential; never show a face or full person.
- render_tier is always draft.
- motion_type and motion_strength are always null for later provider-backed selection.`;

    const userPrompt = `BOUND APPROVED PRODUCTION BRIEF:
${compact(brief.content_md, 6000)}

PROJECT CONSTRAINTS:
Project title: ${project.title}
Archetype: ${project.archetype}
Audience awareness: ${project.awareness_stage.replaceAll("_", " ")}
Target duration: ${targetDurationSec}s
Suggested shot count: approximately ${suggestedShotCount}
Source: ${brief.source_table}/${brief.source_ref}

BRAND PROMPT BLOCK:
${brandDnaText}

Generate a production-ready sequence in final viewing order. Each beat should advance the Reel rather than duplicate another shot, and each shot should average roughly 3-5 seconds.`;

    const modelStart = Date.now();
    let text = await generateShots(system, userPrompt, FIRST_CALL_TIMEOUT_MS);
    let validated = validateReelStoryboardOutput(extractReelJson(text));
    if (!validated.ok) {
      const remaining = MODEL_BUDGET_MS - (Date.now() - modelStart);
      if (remaining < MIN_RETRY_BUDGET_MS) {
        return fail(
          502,
          "validate",
          `AI storyboard was invalid and there was not enough time to repair it: ${validated.error}`,
        );
      }
      text = await generateShots(
        `${system}\nREPAIR REQUIRED: The previous response was invalid (${validated.error}). Return one complete corrected replacement.`,
        userPrompt,
        Math.min(remaining - 10_000, 110_000),
      );
      validated = validateReelStoryboardOutput(extractReelJson(text));
    }
    if (!validated.ok) {
      return fail(502, "validate", `AI storyboard remained invalid after repair: ${validated.error}`);
    }

    const inserted = await sb.rpc("insert_reel_storyboard_if_empty", {
      p_video_project_id: videoProjectId,
      p_client_id: clientId,
      p_client_production_brief_id: brief.id,
      p_shots: validated.value,
    });
    if (inserted.error || !inserted.data) {
      const message = inserted.error?.message ?? "Could not atomically insert the storyboard.";
      return fail(rpcStatus(message), "insert", message);
    }

    return json({ ok: true, shots: inserted.data });
  } catch (error) {
    if (error instanceof ReelStudioGateError) return fail(error.status, error.stage, error.message);
    const message = error instanceof Error ? error.message : String(error);
    return fail(error instanceof Error && error.message.includes("timed out") ? 504 : 500, "unexpected", message);
  }
});
