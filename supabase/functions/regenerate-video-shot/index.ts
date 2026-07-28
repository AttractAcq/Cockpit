// Reel Studio Phase 1: replaces only the AI-planning fields of one pending
// shot. The row ID, project, shot number, selected provider motion, and all
// media/job fields are preserved. The database RPC uses optimistic concurrency
// and rechecks eligibility after the model call before applying the replacement.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import { callAnthropic, hasAnthropicKey, isAiEnabled } from "../_shared/anthropic.ts";
import {
  extractReelJson,
  regeneratedPlanningPatch,
  type ReelRenderTier,
  validateRegeneratedReelShotOutput,
} from "../_shared/reel-studio-contract.ts";
import {
  ReelStudioGateError,
  resolveApprovedReelBrief,
  type ReelProjectRecord,
} from "../_shared/reel-studio-project.ts";

const FUNCTION_NAME = "regenerate-video-shot";
const MODEL_BUDGET_MS = 135_000;
const FIRST_CALL_TIMEOUT_MS = 115_000;
const MIN_RETRY_BUDGET_MS = 45_000;

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

function compact(value: unknown, chars: number): string {
  return (typeof value === "string" ? value : "").trim().slice(0, chars);
}

async function generateShot(system: string, user: string, timeoutMs: number): Promise<string> {
  const result = await callAnthropic({
    system,
    user,
    model: Deno.env.get("AA_STORYBOARD_AI_MODEL") ??
      Deno.env.get("AA_PRODUCTION_BRIEF_AI_MODEL") ??
      "claude-sonnet-4-6",
    maxTokens: 4000,
    timeoutMs,
    rejectTruncation: true,
  });
  if (!result.ok) throw new Error(result.error);
  return result.text;
}

function regenerationStatus(message: string): number {
  return /REEL_(SHOT_STALE|SHOT_NOT_PENDING|PROJECT_NOT_EDITABLE|BRIEF_BINDING_INVALID|BRIEF_NOT_BOUND)/.test(message)
    ? 409
    : /REEL_(PROJECT_NOT_FOUND|SHOT_NOT_FOUND)/.test(message)
    ? 404
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

    const body = (await req.json()) as {
      client_id?: string;
      video_project_id?: string;
      shot_id?: string;
      expected_updated_at?: string;
    };
    const clientId = body.client_id?.trim() ?? "";
    const videoProjectId = body.video_project_id?.trim() ?? "";
    const shotId = body.shot_id?.trim() ?? "";
    const expectedUpdatedAt = body.expected_updated_at?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");
    if (!shotId) return fail(400, "request", "shot_id is required.");
    if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
      return fail(400, "request", "expected_updated_at must be the shot's valid updated_at timestamp.");
    }

    const projectResult = await sb.from("video_projects").select("*").eq("id", videoProjectId).maybeSingle();
    if (projectResult.error) return fail(500, "project", projectResult.error.message);
    if (!projectResult.data || projectResult.data.client_id !== clientId) {
      return fail(404, "project", "Video project not found for client_id.");
    }
    if (!["storyboarding", "generating"].includes(projectResult.data.status)) {
      return fail(409, "gate", "Shot regeneration is unavailable after the project enters review.");
    }

    const resolved = await resolveApprovedReelBrief(
      sb,
      projectResult.data as ReelProjectRecord,
    );
    const project = resolved.project;
    const brief = resolved.brief;

    const shotsResult = await sb.from("video_shots").select("*")
      .eq("video_project_id", videoProjectId)
      .order("shot_number", { ascending: true });
    if (shotsResult.error) return fail(500, "shots", shotsResult.error.message);
    const shots = shotsResult.data ?? [];
    const shot = shots.find((row) => row.id === shotId);
    if (!shot) return fail(404, "shot", "Shot does not belong to the supplied project.");
    if (shot.updated_at !== expectedUpdatedAt) {
      return fail(409, "stale", "Shot changed after this page loaded; reload before regenerating.");
    }
    if (
      shot.status !== "pending" ||
      shot.still_image_job_id ||
      shot.still_image_url ||
      shot.higgsfield_job_id ||
      shot.clip_url
    ) {
      return fail(409, "gate", "Only a pending shot with no image or video job can be regenerated.");
    }

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
    const sequence = shots.map((row) =>
      `${row.shot_number === shot.shot_number ? "CURRENT " : ""}Shot ${row.shot_number}: ${compact(row.beat_description, 220)}`
    ).join("\n");

    const system = `You regenerate exactly one visual shot in an existing faceless-format Instagram Reel storyboard. Replace that shot's planning definition without changing its shot number or render tier. Make it distinct from neighbouring shots while preserving the overall narrative. The compiled_prompt goes directly to a text-to-image model and must be complete, visual, self-contained, and include the supplied brand grade, lens, mood, and negative requirements. Motion guidance may inform composition, but never invent a Higgsfield motion ID.

Return JSON only, with no markdown or commentary, matching exactly:
{"shot":{"shot_number":${shot.shot_number},"beat_description":"string","compiled_prompt":"string","shot_class":"metaphor|atmosphere|abstract","human_presence":"none|hands_only","render_tier":"${shot.render_tier}","motion_type":null,"motion_strength":null}}

Every string must be non-empty. human_presence is none unless the frame contains only hands. motion_type and motion_strength must remain null because provider motion selection is a separate user step.`;

    const userPrompt = `BOUND APPROVED PRODUCTION BRIEF:
${compact(brief.content_md, 6000)}

PROJECT:
Title: ${project.title}
Archetype: ${project.archetype}
Audience awareness: ${project.awareness_stage.replaceAll("_", " ")}
Target duration: ${project.target_duration_sec}s

BRAND PROMPT BLOCK:
${brandDnaText}

CURRENT SHOT ${shot.shot_number}:
Beat: ${compact(shot.beat_description, 1000)}
Compiled prompt: ${compact(shot.compiled_prompt, 2500)}
Class: ${shot.shot_class}
Human presence: ${shot.human_presence}
Render tier: ${shot.render_tier}

FULL STORYBOARD SUMMARY:
${sequence}

Return one replacement for shot ${shot.shot_number}. Do not repeat the visual purpose of surrounding shots and do not modify any other shot.`;

    const renderTier = shot.render_tier as ReelRenderTier;
    const modelStart = Date.now();
    let text = await generateShot(system, userPrompt, FIRST_CALL_TIMEOUT_MS);
    let validated = validateRegeneratedReelShotOutput(
      extractReelJson(text),
      shot.shot_number,
      renderTier,
    );
    if (!validated.ok) {
      const remaining = MODEL_BUDGET_MS - (Date.now() - modelStart);
      if (remaining < MIN_RETRY_BUDGET_MS) {
        return fail(
          502,
          "validate",
          `AI shot was invalid and there was not enough time to repair it: ${validated.error}`,
        );
      }
      text = await generateShot(
        `${system}\nREPAIR REQUIRED: The previous response was invalid (${validated.error}). Return one complete corrected replacement.`,
        userPrompt,
        Math.min(remaining - 10_000, 110_000),
      );
      validated = validateRegeneratedReelShotOutput(
        extractReelJson(text),
        shot.shot_number,
        renderTier,
      );
    }
    if (!validated.ok) {
      return fail(502, "validate", `AI shot remained invalid after repair: ${validated.error}`);
    }

    const updated = await sb.rpc("regenerate_pending_reel_shot", {
      p_client_id: clientId,
      p_video_project_id: videoProjectId,
      p_shot_id: shotId,
      p_expected_updated_at: expectedUpdatedAt,
      p_planning: regeneratedPlanningPatch(validated.value),
    });
    if (updated.error || !updated.data) {
      const message = updated.error?.message ?? "Could not atomically replace the pending shot.";
      return fail(regenerationStatus(message), "update", message);
    }

    return json({ ok: true, shot: updated.data });
  } catch (error) {
    if (error instanceof ReelStudioGateError) return fail(error.status, error.stage, error.message);
    const message = error instanceof Error ? error.message : String(error);
    return fail(error instanceof Error && error.message.includes("timed out") ? 504 : 500, "unexpected", message);
  }
});
