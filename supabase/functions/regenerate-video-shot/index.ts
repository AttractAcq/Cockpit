// Reel Studio: regenerate one pending shot without breaking the sequence.
//
// Regeneration used to see the brief, the brand block, and a list of one-line
// beat descriptions. That was enough to produce a different-looking shot and
// nothing like enough to keep it in the story: the replacement could invent a
// new visual direction disconnected from every other frame.
//
// It now regenerates *against* the project's persisted story spine and visual
// continuity plan, with the immediate neighbours quoted in full, and the shot's
// narrative role held fixed. Regeneration changes how a beat is expressed; it
// never changes what job the beat does.
//
// Projects storyboarded before the sequence-first generator have no persisted
// spine. Those still regenerate, on the original prompt path, so existing
// storyboards stay fully editable.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import { callAnthropic, DEFAULT_AI_MODEL, hasAnthropicKey, isAiEnabled } from "../_shared/anthropic.ts";
import {
  extractReelJson,
  regeneratedPlanningPatch,
  type ReelRenderTier,
  validateRegeneratedReelShotOutput,
} from "../_shared/reel-studio-contract.ts";
import {
  compiledPromptCarriesGlobalContext,
  compileShotPrompt,
  validateShotDirection,
} from "../_shared/reel-studio-prompt-compiler.ts";
import {
  narrativePlanningPatch,
  type NarrativeReelShot,
  type ReelContinuityPlan,
  REEL_STORY_ROLES,
  type ReelStoryStrategy,
  SHOT_REGENERATION_PROMPT_VERSION,
  validateNarrativeReelShot,
  validateReelContinuityPlan,
  validateReelStoryStrategy,
} from "../_shared/reel-studio-story-contract.ts";
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
      DEFAULT_AI_MODEL,
    maxTokens: 4000,
    timeoutMs,
    rejectTruncation: true,
  });
  if (!result.ok) throw new Error(result.error);
  return result.text;
}

function regenerationStatus(message: string): number {
  return /REEL_(SHOT_STALE|SHOT_NOT_PENDING|PROJECT_NOT_EDITABLE|BRIEF_BINDING_INVALID|BRIEF_NOT_BOUND|SHOT_ROLE_CHANGED)/
      .test(message)
    ? 409
    : /REEL_(PROJECT_NOT_FOUND|SHOT_NOT_FOUND)/.test(message)
    ? 404
    : 500;
}

interface ShotRow {
  id: string;
  shot_number: number;
  beat_description: string;
  compiled_prompt: string;
  shot_class: string;
  human_presence: string;
  render_tier: string;
  status: string;
  updated_at: string;
  story_role: string | null;
  narrative_beat: string | null;
  message_supported: string | null;
  transition_from_previous: string | null;
  transition_to_next: string | null;
  visual_continuity: unknown;
  emotional_intent: string | null;
  still_image_job_id: string | null;
  still_image_url: string | null;
  higgsfield_job_id: string | null;
  clip_url: string | null;
}

/** Neighbour context, quoted in enough detail that the model can avoid repeating it. */
function neighbourBlock(shot: ShotRow | undefined, label: string): string {
  if (!shot) return `${label}: none — this shot is at the edge of the sequence.`;
  return [
    `${label} (shot ${shot.shot_number}, role ${shot.story_role ?? "unlabelled"}):`,
    `  beat: ${compact(shot.narrative_beat ?? shot.beat_description, 300)}`,
    `  message: ${compact(shot.message_supported, 200) || "(not recorded)"}`,
    `  prompt: ${compact(shot.compiled_prompt, 600)}`,
  ].join("\n");
}

function sequenceMap(shots: ShotRow[], currentNumber: number): string {
  return shots
    .map((row) =>
      `${row.shot_number === currentNumber ? "> " : "  "}Shot ${row.shot_number} [${
        row.story_role ?? "unlabelled"
      }]: ${compact(row.narrative_beat ?? row.beat_description, 180)}`
    )
    .join("\n");
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

    const resolved = await resolveApprovedReelBrief(sb, projectResult.data as ReelProjectRecord);
    const project = resolved.project as ReelProjectRecord & {
      story_strategy: unknown;
      continuity_plan: unknown;
    };
    const brief = resolved.brief;

    const shotsResult = await sb.from("video_shots").select("*")
      .eq("video_project_id", videoProjectId)
      .order("shot_number", { ascending: true });
    if (shotsResult.error) return fail(500, "shots", shotsResult.error.message);
    const shots = (shotsResult.data ?? []) as ShotRow[];
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

    const index = shots.findIndex((row) => row.id === shotId);
    const previous = shots[index - 1];
    const next = shots[index + 1];
    const isFirst = index === 0;
    const isLast = index === shots.length - 1;

    const strategy = validateReelStoryStrategy(project.story_strategy);
    const continuity = validateReelContinuityPlan(project.continuity_plan);
    const sequenceAware = strategy.ok && continuity.ok;

    const renderTier = shot.render_tier as ReelRenderTier;
    const modelStart = Date.now();
    const remaining = () => MODEL_BUDGET_MS - (Date.now() - modelStart);

    // -----------------------------------------------------------------------
    // Sequence-aware path: the project has a persisted spine.
    // -----------------------------------------------------------------------
    if (sequenceAware) {
      const lockedRole = shot.story_role;
      const system =
        `You regenerate exactly one shot inside an existing, approved Reel storyboard. The story spine, the visual continuity plan and the surrounding shots are fixed. You are replacing how this beat is expressed, not what job it does.

Return JSON only, no markdown or commentary, matching exactly:
{"shot":{"story_role":"${lockedRole ?? REEL_STORY_ROLES[0]}","narrative_beat":"string","beat_description":"string","message_supported":"string","transition_from_previous":"string","transition_to_next":"string","visual_continuity":["string"],"emotional_intent":"string","shot_class":"metaphor|atmosphere|abstract","human_presence":"none|hands_only","shot_direction":{"subject":"string","action":"string","composition":"string","camera_angle":"string","depth_and_focus":"string","lighting":"string","visual_metaphor":"string"}}}

Hard constraints:
- story_role must remain exactly "${lockedRole ?? "(unchanged)"}". This shot's job in the sequence is fixed.
- This is shot ${shot.shot_number} of ${shots.length}. Its position does not change.
${
          isFirst
            ? "- This is the opening shot: it must still establish the central idea, and transition_from_previous may be empty."
            : "- transition_from_previous must state what changes from the preceding shot quoted below."
        }
${
          isLast
            ? "- This is the closing shot: it must still resolve, invert or complete the opening, and transition_to_next may be empty."
            : "- transition_to_next must still hand off into the following shot quoted below."
        }
- Do not duplicate the visual idea, subject or metaphor of either neighbour.
- Stay inside the approved continuity plan and the recurring motif; do not invent a new visual world.
- shot_direction describes only this frame. Never write "same as before" — the image is generated independently with no memory of other shots.
- Do not restate palette, lens bible, world, negatives or aspect ratio: those are appended to every prompt automatically.
- human_presence is "none" unless only hands are essential; never a face or full person.`;

      const userPrompt = `### STORY STRATEGY
${JSON.stringify(strategy.value, null, 2)}

### VISUAL CONTINUITY PLAN
${JSON.stringify(continuity.value, null, 2)}

### FULL SEQUENCE
${sequenceMap(shots, shot.shot_number)}

### IMMEDIATE NEIGHBOURS
${neighbourBlock(previous, "Previous shot")}

${neighbourBlock(next, "Next shot")}

### SHOT BEING REPLACED (shot ${shot.shot_number})
beat: ${compact(shot.narrative_beat ?? shot.beat_description, 600)}
message: ${compact(shot.message_supported, 300) || "(not recorded)"}
current prompt: ${compact(shot.compiled_prompt, 1200)}

### TASK
Return one replacement for shot ${shot.shot_number} that keeps its role and its place, and reads as a stronger expression of the same beat.`;

      const buildFromResponse = (text: string) => {
        const parsed = extractReelJson(text) as Record<string, unknown> | null;
        const raw = parsed?.shot;
        const input = raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? raw as Record<string, unknown>
          : null;
        if (!input) return { ok: false as const, error: 'Response must be JSON of the form {"shot": {...}}.' };

        if (lockedRole && typeof input.story_role === "string" && input.story_role.trim() !== lockedRole) {
          return { ok: false as const, error: `story_role must remain "${lockedRole}".` };
        }

        const direction = validateShotDirection(input.shot_direction);
        if (!direction.ok) return { ok: false as const, error: direction.error };

        const humanPresence = input.human_presence === "hands_only" ? "hands_only" : "none";
        const shotContinuity = Array.isArray(input.visual_continuity)
          ? input.visual_continuity.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          : [];

        const compiled = compileShotPrompt({
          direction: direction.value,
          continuity: continuity.value,
          shotContinuity,
          humanPresence,
          brandNegative: (brandResult.data.negative_block as string | null) ?? null,
        });
        if (!compiledPromptCarriesGlobalContext(compiled, continuity.value)) {
          return { ok: false as const, error: "Compiled prompt lost its global visual context." };
        }

        const beatDescription = typeof input.beat_description === "string" && input.beat_description.trim()
          ? input.beat_description.trim()
          : typeof input.narrative_beat === "string"
          ? input.narrative_beat.trim()
          : "";

        return validateNarrativeReelShot({
          ...input,
          story_role: lockedRole ?? input.story_role,
          shot_number: shot.shot_number,
          beat_description: beatDescription,
          compiled_prompt: compiled,
          human_presence: humanPresence,
          render_tier: renderTier,
          motion_type: null,
          motion_strength: null,
          visual_continuity: shotContinuity,
        }, {
          expectedShotNumber: shot.shot_number,
          expectedRenderTier: renderTier,
          isFirst,
          isLast,
        });
      };

      let text = await generateShot(system, userPrompt, FIRST_CALL_TIMEOUT_MS);
      let built = buildFromResponse(text);
      if (!built.ok && remaining() >= MIN_RETRY_BUDGET_MS) {
        text = await generateShot(
          `${system}\nREPAIR REQUIRED: the previous response was invalid (${built.error}). Return one complete corrected replacement.`,
          userPrompt,
          Math.min(remaining() - 10_000, 110_000),
        );
        built = buildFromResponse(text);
      }
      if (!built.ok) return fail(502, "validate", `AI shot remained invalid after repair: ${built.error}`);

      const updated = await sb.rpc("regenerate_pending_reel_shot", {
        p_client_id: clientId,
        p_video_project_id: videoProjectId,
        p_shot_id: shotId,
        p_expected_updated_at: expectedUpdatedAt,
        p_planning: narrativePlanningPatch(built.value as NarrativeReelShot),
      });
      if (updated.error || !updated.data) {
        const message = updated.error?.message ?? "Could not atomically replace the pending shot.";
        return fail(regenerationStatus(message), "update", message);
      }
      return json({
        ok: true,
        shot: updated.data,
        sequence_aware: true,
        prompt_version: SHOT_REGENERATION_PROMPT_VERSION,
      });
    }

    // -----------------------------------------------------------------------
    // Legacy path: storyboard predates the persisted spine. Unchanged behaviour
    // so older projects stay editable rather than becoming read-only.
    // -----------------------------------------------------------------------
    const sequence = shots.map((row) =>
      `${row.shot_number === shot.shot_number ? "CURRENT " : ""}Shot ${row.shot_number}: ${
        compact(row.beat_description, 220)
      }`
    ).join("\n");

    const system =
      `You regenerate exactly one visual shot in an existing faceless-format Instagram Reel storyboard. Replace that shot's planning definition without changing its shot number or render tier. Make it distinct from neighbouring shots while preserving the overall narrative. The compiled_prompt goes directly to a text-to-image model and must be complete, visual, self-contained, and include the supplied brand grade, lens, mood, and negative requirements. Motion guidance may inform composition, but never invent a Higgsfield motion ID.

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

    let text = await generateShot(system, userPrompt, FIRST_CALL_TIMEOUT_MS);
    let validated = validateRegeneratedReelShotOutput(extractReelJson(text), shot.shot_number, renderTier);
    if (!validated.ok) {
      if (remaining() < MIN_RETRY_BUDGET_MS) {
        return fail(502, "validate", `AI shot was invalid and there was not enough time to repair it: ${validated.error}`);
      }
      text = await generateShot(
        `${system}\nREPAIR REQUIRED: The previous response was invalid (${validated.error}). Return one complete corrected replacement.`,
        userPrompt,
        Math.min(remaining() - 10_000, 110_000),
      );
      validated = validateRegeneratedReelShotOutput(extractReelJson(text), shot.shot_number, renderTier);
    }
    if (!validated.ok) return fail(502, "validate", `AI shot remained invalid after repair: ${validated.error}`);

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

    return json({ ok: true, shot: updated.data, sequence_aware: false });
  } catch (error) {
    if (error instanceof ReelStudioGateError) return fail(error.status, error.stage, error.message);
    const message = error instanceof Error ? error.message : String(error);
    return fail(error instanceof Error && error.message.includes("timed out") ? 504 : 500, "unexpected", message);
  }
});
