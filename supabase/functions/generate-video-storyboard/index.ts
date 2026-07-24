// Reel Studio: AI storyboard compiler. Analyzes the reel_video production
// brief tied to a video_projects row's source content and asks Claude to
// generate a full, sequenced shot list in one call, replacing the manual
// "Add shot, one at a time" flow (create-video-shot) with a bulk starting
// point the operator can still edit/delete per-shot afterward (shots are
// inserted with status 'pending', same as manually-added shots).
//
// Deliberately does NOT require the linked brief to be 'approved' -- the
// Content Briefs -> Reel Studio redirect reaches this exact state with a
// brief that is only 'needs_review', and storyboard generation is a planning
// step, not a publish step. Deliberately non-destructive: refuses to run if
// the project already has any shots, or has no linked source content at all
// (a standalone project has no brief to analyze).
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";
import { callAnthropic, hasAnthropicKey, isAiEnabled } from "../_shared/anthropic.ts";

const FUNCTION_NAME = "generate-video-storyboard";
const SHOT_CLASSES = new Set(["metaphor", "atmosphere", "abstract"]);
const HUMAN_PRESENCE = new Set(["none", "hands_only"]);
const MIN_SHOTS = 4;
const MAX_SHOTS = 12;

// Total wall-clock budget for ALL model calls in one request -- the edge
// platform hard-kills a worker at ~150s (HTTP 546, WORKER_RESOURCE_LIMIT).
// Mirrors generate-production-brief's budget guard: never issue a retry we
// cannot afford, return a clean 502 instead.
const MODEL_BUDGET_MS = 135_000;
const FIRST_CALL_TIMEOUT_MS = 115_000;
const MIN_RETRY_BUDGET_MS = 45_000;

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

interface RawShot {
  beat_description?: unknown;
  compiled_prompt?: unknown;
  shot_class?: unknown;
  human_presence?: unknown;
}

interface ValidatedShot {
  beat_description: string;
  compiled_prompt: string;
  shot_class: string;
  human_presence: string;
}

function compact(value: string | null | undefined, chars: number): string {
  return (value ?? "[EMPTY]").trim().slice(0, chars);
}

// Mirrors _shared/phase3-scope.ts's private extractJson, adapted for the
// {"shots": [...]} shape this function expects instead of a bare object.
function extractShotsJson(text: string): unknown {
  try { return JSON.parse(text.trim()); } catch { /* fall through */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* fall through */ } }
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s >= 0 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch { /* fall through */ } }
  return null;
}

function validateShots(parsed: unknown): { ok: true; shots: ValidatedShot[] } | { ok: false; error: string } {
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { shots?: unknown }).shots)) {
    return { ok: false, error: "Response was not valid JSON of the form {\"shots\": [...]}." };
  }
  const raw = (parsed as { shots: RawShot[] }).shots;
  if (raw.length < MIN_SHOTS || raw.length > MAX_SHOTS) {
    return { ok: false, error: `Expected between ${MIN_SHOTS} and ${MAX_SHOTS} shots, got ${raw.length}.` };
  }
  const shots: ValidatedShot[] = [];
  for (const [index, item] of raw.entries()) {
    const beatDescription = typeof item.beat_description === "string" ? item.beat_description.trim() : "";
    const compiledPrompt = typeof item.compiled_prompt === "string" ? item.compiled_prompt.trim() : "";
    const shotClass = typeof item.shot_class === "string" ? item.shot_class.trim() : "";
    if (!beatDescription || !compiledPrompt) return { ok: false, error: `Shot ${index + 1} is missing beat_description or compiled_prompt.` };
    if (!SHOT_CLASSES.has(shotClass)) return { ok: false, error: `Shot ${index + 1} has an invalid shot_class: "${shotClass}".` };
    const humanPresenceRaw = typeof item.human_presence === "string" ? item.human_presence.trim() : "";
    const humanPresence = HUMAN_PRESENCE.has(humanPresenceRaw) ? humanPresenceRaw : "none";
    shots.push({ beat_description: beatDescription, compiled_prompt: compiledPrompt, shot_class: shotClass, human_presence: humanPresence });
  }
  return { ok: true, shots };
}

async function generateShots(system: string, user: string, timeoutMs: number) {
  const result = await callAnthropic({
    system,
    user,
    model: Deno.env.get("AA_STORYBOARD_AI_MODEL") ?? Deno.env.get("AA_PRODUCTION_BRIEF_AI_MODEL") ?? "claude-sonnet-4-6",
    maxTokens: 8000,
    timeoutMs,
  });
  if (!result.ok) throw new Error(result.error);
  return result.text;
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

    if (!isAiEnabled() || !hasAnthropicKey()) return fail(500, "configuration", "Server-side AI generation is not configured.");

    const videoProjectId = ((await req.json()) as { video_project_id?: string }).video_project_id?.trim() ?? "";
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");

    const project = await sb.from("video_projects").select("*").eq("id", videoProjectId).maybeSingle();
    if (project.error || !project.data) return fail(404, "project", "Video project not found.");
    if (!project.data.organic_master_id && !project.data.ads_master_id) {
      return fail(409, "gate", "This project has no linked source content. Generate full storyboard requires a content brief -- add shots manually instead.");
    }

    const existingShots = await sb.from("video_shots").select("id").eq("video_project_id", videoProjectId);
    if (existingShots.error) return fail(500, "shots", existingShots.error.message);
    if (existingShots.data && existingShots.data.length > 0) {
      return fail(409, "gate", "Project already has shots -- delete them first to generate a fresh AI storyboard.");
    }

    // Resolve the linked production brief exactly like handoff-video-project.
    // Never auto-create one; unlike handoff, does NOT require it to be approved.
    let briefId = project.data.client_production_brief_id as string | null;
    if (!briefId) {
      const sourceTable = project.data.organic_master_id ? "organic_master" : "ads_master";
      const sourceRowId = project.data.organic_master_id ?? project.data.ads_master_id;
      const matches = await sb.from("client_production_briefs").select("id")
        .eq("client_id", project.data.client_id).eq("source_table", sourceTable).eq("source_row_id", sourceRowId).eq("asset_format", "reel_video");
      if (matches.error) return fail(500, "resolve_brief", matches.error.message);
      if (!matches.data || matches.data.length === 0) return fail(409, "gate", "No reel_video production brief exists for this project's source row. Create one first.");
      if (matches.data.length > 1) return fail(409, "gate", "Multiple reel_video production briefs exist for this source row -- link video_projects.client_production_brief_id explicitly first.");
      briefId = matches.data[0].id;
    }

    const brief = await sb.from("client_production_briefs").select("*").eq("id", briefId).maybeSingle();
    if (brief.error || !brief.data) return fail(404, "brief", "Linked production brief not found.");
    if (brief.data.asset_format !== "reel_video") return fail(409, "gate", "Linked production brief is not a reel_video brief.");

    if (!project.data.client_production_brief_id) {
      await sb.from("video_projects").update({ client_production_brief_id: briefId }).eq("id", videoProjectId);
    }

    const brandBlock = await sb.from("brand_prompt_blocks").select("*").eq("id", project.data.brand_prompt_block_id).maybeSingle();
    if (brandBlock.error) return fail(500, "brand_block", brandBlock.error.message);
    const brandDnaText = brandBlock.data
      ? [
        brandBlock.data.grade_block && `Grade: ${brandBlock.data.grade_block}`,
        brandBlock.data.lens_block && `Lens: ${brandBlock.data.lens_block}`,
        brandBlock.data.mood_block && `Mood: ${brandBlock.data.mood_block}`,
        brandBlock.data.negative_block && `Negative (avoid): ${brandBlock.data.negative_block}`,
      ].filter(Boolean).join("\n")
      : "[No brand DNA block configured]";

    const targetDurationSec = project.data.target_duration_sec as number;
    const suggestedShotCount = Math.max(MIN_SHOTS, Math.min(MAX_SHOTS, Math.round(targetDurationSec / 4)));

    const system = `You are a cinematic storyboard compiler for a faceless-format Instagram Reel (B-roll only, no on-camera human faces). You break a production brief into a sequenced list of individual video shots. Each shot's "compiled_prompt" must be a complete, self-contained, ready-to-use text-to-image prompt -- it is sent directly to an image generation model with no further editing, so it must weave in the supplied brand DNA (grade/lens/mood, and respect the negative/avoid list) itself, not just describe the scene generically. Return JSON only, no markdown fences, no commentary, matching exactly: {"shots": [{"beat_description": string, "compiled_prompt": string, "shot_class": "metaphor" | "atmosphere" | "abstract", "human_presence": "none" | "hands_only"}]}. "human_presence" must be "none" unless the shot specifically shows only hands (never a face or full person) -- this is a hard faceless-format constraint, not a stylistic choice.`;

    const userPrompt = `PRODUCTION BRIEF:
${compact(brief.data.content_md, 6000)}

PROJECT METADATA:
Archetype: ${project.data.archetype}
Awareness stage: ${String(project.data.awareness_stage).replaceAll("_", " ")}
Target duration: ${targetDurationSec}s

BRAND DNA (weave into every compiled_prompt):
${brandDnaText}

Generate approximately ${suggestedShotCount} shots (never fewer than ${MIN_SHOTS}, never more than ${MAX_SHOTS}) that together tell this asset's story in sequence, each averaging roughly 3-5 seconds of screen time. Order them exactly as they should appear in the final video.`;

    const modelStart = Date.now();
    let text = await generateShots(system, userPrompt, FIRST_CALL_TIMEOUT_MS);
    let validated = validateShots(extractShotsJson(text));
    if (!validated.ok) {
      const remaining = MODEL_BUDGET_MS - (Date.now() - modelStart);
      if (remaining < MIN_RETRY_BUDGET_MS) {
        return fail(502, "validate", `AI output was invalid and there was not enough time budget to retry safely: ${validated.error}`);
      }
      text = await generateShots(`${system}\nRETRY: The previous response was invalid (${validated.error}). Return a complete, corrected replacement.`, userPrompt, Math.min(remaining - 10_000, 110_000));
      validated = validateShots(extractShotsJson(text));
    }
    if (!validated.ok) return fail(502, "validate", `AI output was invalid after retry: ${validated.error}`);

    const rows = validated.shots.map((shot, index) => ({
      video_project_id: videoProjectId,
      shot_number: index + 1,
      beat_description: shot.beat_description,
      compiled_prompt: shot.compiled_prompt,
      shot_class: shot.shot_class,
      human_presence: shot.human_presence,
      render_tier: "draft",
      motion_type: null,
      motion_strength: null,
    }));

    const insert = await sb.from("video_shots").insert(rows).select("*").order("shot_number", { ascending: true });
    if (insert.error || !insert.data) return fail(500, "insert", insert.error?.message ?? "Could not create shots.");

    await sb.from("activity_log").insert({
      client_id: project.data.client_id,
      event_type: "reel_studio_storyboard_generated",
      plain_english_message: `AI generated a ${insert.data.length}-shot storyboard for "${project.data.title}".`,
      object_type: "video_project",
      object_id: videoProjectId,
      metadata: { shot_count: insert.data.length, production_brief_id: briefId },
    });

    return json({ ok: true, shots: insert.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(error instanceof Error && error.message.includes("timed out") ? 504 : 500, "unexpected", message);
  }
});
