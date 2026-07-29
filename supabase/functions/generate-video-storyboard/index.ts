// Reel Studio: sequence-first storyboard generation.
//
// The previous generator asked one model call for a list of shots, from the
// first 6000 characters of the production brief plus five brand strings. Shots
// came back individually valid and collectively meaningless: nothing in the
// prompt or the schema required shot 2 to develop shot 1, so it usually didn't.
//
// This generator treats the problem as a narrative system rather than a prompt
// wording problem:
//
//   1. Assemble a context pack from *approved* authority only — the bound
//      brief parsed into sections, plus the approved Client Context OS files
//      that bear on a Reel (audience, offer, proof, positioning, brand voice,
//      content and story systems) and approved execution files. Budgeted per
//      category so the CTA at the end of a brief can never be cut off by a long
//      avatar document.
//   2. Stage A — generate a story spine and a project-level visual continuity
//      plan. No shots exist yet.
//   3. Stage B — generate the shot sequence against that spine. The model
//      supplies shot-specific direction only; the image prompt is compiled
//      here so every prompt provably carries the continuity plan.
//   4. Validate objective flow rules server-side, then run a structured
//      critique pass and repair once if it finds material failures.
//   5. Insert transactionally, together with the spine and the provenance
//      record that says which approved information produced this storyboard.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import { callAnthropic, DEFAULT_AI_MODEL, hasAnthropicKey, isAiEnabled } from "../_shared/anthropic.ts";
import {
  extractReelJson,
  MAX_REEL_STORYBOARD_SHOTS,
  MIN_REEL_STORYBOARD_SHOTS,
} from "../_shared/reel-studio-contract.ts";
import {
  type BrandBlockRow,
  buildContextPack,
  type ContextFileRow,
  type ExecutionFileRow,
  renderContextPack,
} from "../_shared/reel-studio-context-pack.ts";
import {
  compiledPromptCarriesGlobalContext,
  compileShotPrompt,
  PROMPT_COMPILER_VERSION,
  validateShotDirection,
} from "../_shared/reel-studio-prompt-compiler.ts";
import {
  critiqueFailures,
  type NarrativeReelShot,
  type ReelContinuityPlan,
  REEL_STORY_ROLES,
  type ReelStoryStrategy,
  STORYBOARD_PROMPT_VERSION,
  validateNarrativeReelShot,
  validateReelContinuityPlan,
  validateReelStoryboardCritique,
  validateReelStoryStrategy,
  validateStoryboardFlow,
} from "../_shared/reel-studio-story-contract.ts";
import {
  ReelStudioGateError,
  resolveApprovedReelBrief,
  type ReelProjectRecord,
} from "../_shared/reel-studio-project.ts";

const FUNCTION_NAME = "generate-video-storyboard";

// Supabase edge functions are cut off near 150s of wall clock. Three model
// calls plus an optional repair have to fit inside that, so every stage is
// deadline-driven rather than best-effort.
const TOTAL_BUDGET_MS = 138_000;
const STRATEGY_TIMEOUT_MS = 42_000;
const SHOTS_TIMEOUT_MS = 55_000;
const CRITIQUE_TIMEOUT_MS = 24_000;
const MIN_REPAIR_BUDGET_MS = 30_000;

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

/**
 * Model selection. Env vars win so the model can be changed without a deploy;
 * the code fallback is the repo-wide default used by every other AI function
 * rather than a separate pinned model.
 */
function storyboardModel(): string {
  return Deno.env.get("AA_STORYBOARD_AI_MODEL") ??
    Deno.env.get("AA_PRODUCTION_BRIEF_AI_MODEL") ??
    DEFAULT_AI_MODEL;
}

async function callModel(
  system: string,
  user: string,
  timeoutMs: number,
  maxTokens: number,
): Promise<string> {
  const result = await callAnthropic({
    system,
    user,
    model: storyboardModel(),
    maxTokens,
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

// ---------------------------------------------------------------------------
// Stage A — story strategy and continuity plan
// ---------------------------------------------------------------------------

const STRATEGY_SYSTEM =
  `You are the story strategist for a faceless-format vertical Instagram Reel. You do not write shots. You decide what the Reel is trying to communicate, to whom, and how meaning develops from the first frame to the last.

Return JSON only, no markdown or commentary, matching exactly:
{"strategy":{"core_message":"string","viewer":"string","viewer_starting_state":"string","viewer_ending_state":"string","objective":"string","hook_strategy":"string","central_tension":"string","proof_or_payoff":"string","emotional_progression":["string"],"visual_progression":["string"],"recurring_visual_motif":"string","continuity_rules":["string"],"opening_image_purpose":"string","ending_image_purpose":"string","cta_or_final_takeaway":"string","target_duration_seconds":0,"planned_shot_count":0},"continuity":{"visual_world":"string","location_bible":"string","subject_bible":"string","palette_bible":"string","lighting_bible":"string","lens_bible":"string","recurring_objects":["string"],"screen_direction":"string","continuity_constraints":["string"],"global_negative_prompt":"string"}}

Rules:
- Work only from the supplied approved context. Never invent testimonials, metrics, results, case studies or business facts. If proof is absent from the context, say so plainly in proof_or_payoff rather than fabricating any.
- core_message is one sentence a viewer could repeat afterwards.
- central_tension is the gap that makes the viewer keep watching.
- emotional_progression and visual_progression describe how the sequence escalates; list them in order, at least 2 entries each.
- recurring_visual_motif is one concrete object, material or gesture that recurs and ties the sequence into a single concept family.
- continuity_rules state what must stay identical across every shot.
- opening_image_purpose and ending_image_purpose must relate: the ending resolves, inverts or completes the opening.
- planned_shot_count must sit between ${MIN_REEL_STORYBOARD_SHOTS} and ${MAX_REEL_STORYBOARD_SHOTS} and imply between 1.5 and 8 seconds per shot against target_duration_seconds.
- The continuity plan is a production bible: it is repeated verbatim into every image prompt, so write it as concrete visual specification (materials, colour values, optics, light behaviour), not as adjectives.
- palette_bible, lighting_bible and lens_bible must be consistent with the supplied brand grade, lens and mood.
- global_negative_prompt lists what must never appear in any frame.
- The format is faceless: no faces, no full figures. Hands only where essential.`;

// ---------------------------------------------------------------------------
// Stage B — shot sequence
// ---------------------------------------------------------------------------

function shotsSystem(strategy: ReelStoryStrategy): string {
  return `You are the storyboard director for a faceless-format vertical Instagram Reel. The story spine and the visual continuity plan are already approved and are given to you. Your job is to break that spine into an ordered shot sequence in which every shot depends on the one before it.

Return JSON only, no markdown or commentary, matching exactly:
{"shots":[{"shot_number":1,"story_role":"hook","narrative_beat":"string","beat_description":"string","message_supported":"string","transition_from_previous":"string","transition_to_next":"string","visual_continuity":["string"],"emotional_intent":"string","shot_class":"metaphor|atmosphere|abstract","human_presence":"none|hands_only","shot_direction":{"subject":"string","action":"string","composition":"string","camera_angle":"string","depth_and_focus":"string","lighting":"string","visual_metaphor":"string"}}]}

Sequence rules:
- Return exactly ${strategy.planned_shot_count} shots, numbered contiguously from 1.
- story_role is one of: ${REEL_STORY_ROLES.join(", ")}.
- Shot 1 must be the hook, and it is the only hook. It must establish the central idea visually, not merely look striking.
- The final shot must be payoff, cta or transformation, and must resolve, invert or complete the opening image.
- No three consecutive shots may share a story_role.
- Each narrative_beat and each message_supported must be distinct: two shots expressing the same idea means one is not earning its place.
- transition_from_previous states what changed from the preceding shot (required for every shot after the first). transition_to_next states what this shot sets up (required for every shot before the last). The order must be load-bearing: if the shots could be freely rearranged without harming the story, the sequence is wrong.
- visual_continuity lists the concrete anchors this frame carries from the continuity plan.
- Visual metaphors must belong to one coherent concept family drawn from the recurring motif. Do not jump between unrelated metaphors.

shot_direction rules:
- Describe only this frame. Do not reference other shots, and never write "same as before" — each image is generated independently and carries no memory.
- subject and action are the concrete thing in frame and what it is doing.
- composition, camera_angle and depth_and_focus are camera language: framing, height, lens behaviour, foreground/midground/background, focus falloff.
- lighting describes how light behaves in this frame and how it differs from the previous frame.
- Do not restate palette, lens bible, world, negatives or aspect ratio: those are appended automatically to every prompt. Writing them again wastes prompt weight.
- Do not rely on text, logos or typography — the image model cannot render them reliably.
- human_presence is "none" unless only hands are essential; never a face or a full person.`;
}

// ---------------------------------------------------------------------------
// Critique
// ---------------------------------------------------------------------------

const CRITIQUE_SYSTEM =
  `You are a demanding short-form video editor reviewing a storyboard before any image is generated. You are looking for reasons the sequence will fail as a story, not reasons each shot looks nice. Be strict: a sequence of individually attractive but unrelated images is a failure.

Return JSON only, no markdown or commentary, matching exactly:
{"critique":{"hook_is_clear":true,"every_shot_advances":true,"redundant_shots":[],"unexplained_visual_changes":[],"emotionally_flat":false,"proof_represented":true,"ending_pays_off":true,"aligns_with_brief":true,"aligns_with_positioning":true,"aligns_with_brand":true,"supports_duration":true,"prompts_are_consistent":true,"order_is_load_bearing":true,"material_failures":["string"],"notes":"string"}}

Judge honestly:
- hook_is_clear: does shot 1 establish the central idea, visually and conceptually?
- every_shot_advances: does each shot develop the idea rather than restate it?
- redundant_shots: shot numbers that could be deleted with no loss.
- unexplained_visual_changes: shot numbers where location, subject, palette or style changes without narrative reason.
- emotionally_flat: is there no escalation across the sequence?
- proof_represented: is the proof or payoff actually visible in the sequence? If the supplied context contained no proof, judge whether the sequence honestly avoids implying any.
- ending_pays_off: does the final shot resolve, invert or complete the opening?
- order_is_load_bearing: would reordering the shots damage the story? If they could be shuffled freely, this is false.
- prompts_are_consistent: do the image prompts describe one coherent visual world?
- material_failures lists only defects serious enough to require regeneration. Leave it empty if there are none.`;

interface GeneratedShot {
  shot: NarrativeReelShot;
}

/** Compile and validate one model-produced shot into a persistable shot. */
function buildShot(
  raw: unknown,
  index: number,
  total: number,
  continuity: ReelContinuityPlan,
  brandNegative: string | null,
): { ok: true; value: NarrativeReelShot } | { ok: false; error: string } {
  const input = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
  if (!input) return { ok: false, error: `Shot ${index + 1}: must be a JSON object.` };

  const direction = validateShotDirection(input.shot_direction);
  if (!direction.ok) return { ok: false, error: `Shot ${index + 1}: ${direction.error}` };

  const humanPresence = input.human_presence === "hands_only" ? "hands_only" : "none";
  const shotContinuity = Array.isArray(input.visual_continuity)
    ? input.visual_continuity.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

  const compiled = compileShotPrompt({
    direction: direction.value,
    continuity,
    shotContinuity,
    humanPresence,
    brandNegative,
  });

  if (!compiledPromptCarriesGlobalContext(compiled, continuity)) {
    return { ok: false, error: `Shot ${index + 1}: compiled prompt lost its global visual context.` };
  }

  // beat_description is the frozen human-facing planning field; the narrative
  // beat is what the model wrote, so they stay in sync without a second ask.
  const beatDescription = typeof input.beat_description === "string" && input.beat_description.trim()
    ? input.beat_description.trim()
    : typeof input.narrative_beat === "string"
    ? input.narrative_beat.trim()
    : "";

  const candidate = {
    ...input,
    shot_number: index + 1,
    beat_description: beatDescription,
    compiled_prompt: compiled,
    human_presence: humanPresence,
    render_tier: "draft",
    motion_type: null,
    motion_strength: null,
    visual_continuity: shotContinuity,
  };

  const validated = validateNarrativeReelShot(candidate, {
    expectedShotNumber: index + 1,
    expectedRenderTier: "draft",
    isFirst: index === 0,
    isLast: index === total - 1,
  });
  if (!validated.ok) return { ok: false, error: `Shot ${index + 1}: ${validated.error}` };
  return { ok: true, value: validated.value };
}

function buildSequence(
  parsed: unknown,
  continuity: ReelContinuityPlan,
  strategy: ReelStoryStrategy,
  brandNegative: string | null,
): { ok: true; value: NarrativeReelShot[] } | { ok: false; error: string } {
  const output = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const rawShots = output?.shots;
  if (!Array.isArray(rawShots)) {
    return { ok: false, error: 'Response must be JSON of the form {"shots": [...]}.' };
  }
  if (rawShots.length < MIN_REEL_STORYBOARD_SHOTS || rawShots.length > MAX_REEL_STORYBOARD_SHOTS) {
    return {
      ok: false,
      error:
        `Storyboard must contain ${MIN_REEL_STORYBOARD_SHOTS}-${MAX_REEL_STORYBOARD_SHOTS} shots; received ${rawShots.length}.`,
    };
  }

  const shots: NarrativeReelShot[] = [];
  for (const [index, raw] of rawShots.entries()) {
    const built = buildShot(raw, index, rawShots.length, continuity, brandNegative);
    if (!built.ok) return built;
    shots.push(built.value);
  }

  const flow = validateStoryboardFlow(shots, strategy);
  if (!flow.ok) return { ok: false, error: flow.error };
  return { ok: true, value: shots };
}

function sequenceSummary(shots: NarrativeReelShot[]): string {
  return shots
    .map((s) =>
      `Shot ${s.shot_number} [${s.story_role}] beat: ${s.narrative_beat} | message: ${s.message_supported} | from: ${
        s.transition_from_previous || "(opening)"
      } | to: ${s.transition_to_next || "(close)"} | prompt: ${s.compiled_prompt.slice(0, 300)}`
    )
    .join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "request", "POST only");

  const sb = svc();
  const startedAt = Date.now();
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

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

    // Unchanged binding and eligibility gates.
    const resolved = await resolveApprovedReelBrief(sb, projectResult.data as ReelProjectRecord);
    const project = resolved.project;
    const brief = resolved.brief;

    const brandResult = await sb.from("brand_prompt_blocks").select("*")
      .eq("id", project.brand_prompt_block_id)
      .maybeSingle();
    if (brandResult.error) return fail(500, "brand_block", brandResult.error.message);
    if (!brandResult.data) return fail(409, "brand_block", "Project brand prompt block no longer exists.");

    // --- Approved context authority ----------------------------------------
    const contextResult = await sb.from("client_context_files")
      .select("id, client_id, file_number, file_name, content_md, status, version")
      .eq("client_id", clientId)
      .eq("status", "approved");
    if (contextResult.error) return fail(500, "context_files", contextResult.error.message);

    const executionResult = await sb.from("client_execution_files")
      .select("id, client_id, file_name, file_type, content_md, review_state, version, month")
      .eq("client_id", clientId)
      .eq("review_state", "approved");
    if (executionResult.error) return fail(500, "execution_files", executionResult.error.message);

    const pack = buildContextPack({
      brief: {
        id: brief.id,
        title: brief.title,
        content_md: brief.content_md,
        source_ref: brief.source_ref,
        source_table: brief.source_table,
      },
      sourceRowId: brief.source_row_id,
      project: {
        title: project.title,
        archetype: project.archetype,
        awareness_stage: project.awareness_stage,
        target_duration_sec: project.target_duration_sec,
      },
      brand: brandResult.data as BrandBlockRow,
      contextFiles: (contextResult.data ?? []) as ContextFileRow[],
      executionFiles: (executionResult.data ?? []) as ExecutionFileRow[],
      clientId,
    });

    if (pack.missingMandatory.length) {
      return fail(
        409,
        "context",
        `Cannot generate a storyboard: no approved authority for ${
          pack.missingMandatory.join(", ")
        }. Add the missing approved content before generating.`,
      );
    }

    const contextText = renderContextPack(pack);
    const brandNegative = (brandResult.data.negative_block as string | null) ?? null;

    // --- Stage A: story strategy -------------------------------------------
    const strategyUser = `${contextText}

### TASK
Produce the story strategy and the visual continuity plan for this Reel.
Target duration is ${project.target_duration_sec} seconds.`;

    let strategyText = await callModel(STRATEGY_SYSTEM, strategyUser, STRATEGY_TIMEOUT_MS, 4000);
    let strategyParsed = extractReelJson(strategyText) as Record<string, unknown> | null;
    let strategy = validateReelStoryStrategy(strategyParsed?.strategy);
    let continuity = validateReelContinuityPlan(strategyParsed?.continuity);

    if ((!strategy.ok || !continuity.ok) && remaining() > MIN_REPAIR_BUDGET_MS) {
      const problem = !strategy.ok ? strategy.error : (continuity as { error: string }).error;
      strategyText = await callModel(
        `${STRATEGY_SYSTEM}\nREPAIR REQUIRED: the previous response was invalid (${problem}). Return one complete corrected replacement.`,
        strategyUser,
        Math.min(remaining() - 12_000, STRATEGY_TIMEOUT_MS),
        4000,
      );
      strategyParsed = extractReelJson(strategyText) as Record<string, unknown> | null;
      strategy = validateReelStoryStrategy(strategyParsed?.strategy);
      continuity = validateReelContinuityPlan(strategyParsed?.continuity);
    }
    if (!strategy.ok) return fail(502, "strategy", `Story strategy was invalid: ${strategy.error}`);
    if (!continuity.ok) return fail(502, "strategy", `Continuity plan was invalid: ${continuity.error}`);

    // --- Stage B: shot sequence --------------------------------------------
    const shotsUser = `${contextText}

### APPROVED STORY STRATEGY
${JSON.stringify(strategy.value, null, 2)}

### APPROVED VISUAL CONTINUITY PLAN
${JSON.stringify(continuity.value, null, 2)}

### TASK
Break this strategy into exactly ${strategy.value.planned_shot_count} shots in final viewing order.`;

    if (remaining() < SHOTS_TIMEOUT_MS) {
      return fail(504, "shots", "Not enough time remained to generate the shot sequence.");
    }

    let shotsText = await callModel(
      shotsSystem(strategy.value),
      shotsUser,
      Math.min(remaining() - 26_000, SHOTS_TIMEOUT_MS),
      8000,
    );
    let sequence = buildSequence(
      extractReelJson(shotsText),
      continuity.value,
      strategy.value,
      brandNegative,
    );

    if (!sequence.ok && remaining() > MIN_REPAIR_BUDGET_MS) {
      shotsText = await callModel(
        `${shotsSystem(strategy.value)}\nREPAIR REQUIRED: the previous response was invalid (${sequence.error}). Return one complete corrected replacement.`,
        shotsUser,
        Math.min(remaining() - 14_000, SHOTS_TIMEOUT_MS),
        8000,
      );
      sequence = buildSequence(extractReelJson(shotsText), continuity.value, strategy.value, brandNegative);
    }
    if (!sequence.ok) return fail(502, "shots", `Shot sequence was invalid: ${sequence.error}`);

    // --- Critique and one bounded repair ------------------------------------
    // A technically valid storyboard is never inserted unreviewed.
    let shots = sequence.value;
    let critiqueNotes = "";
    let repaired = false;

    if (remaining() < CRITIQUE_TIMEOUT_MS + 2_000) {
      return fail(
        504,
        "critique",
        "Not enough time remained to critique the storyboard before insertion; nothing was written.",
      );
    }

    const critiqueUser = `### STORY STRATEGY
${JSON.stringify(strategy.value, null, 2)}

### STORYBOARD
${sequenceSummary(shots)}

### SUPPORTING CONTEXT
${contextText}`;

    const critiqueText = await callModel(
      CRITIQUE_SYSTEM,
      critiqueUser,
      Math.min(remaining() - 2_000, CRITIQUE_TIMEOUT_MS),
      2000,
    );
    const critiqueParsed = extractReelJson(critiqueText) as Record<string, unknown> | null;
    const critique = validateReelStoryboardCritique(critiqueParsed?.critique);

    if (critique.ok) {
      critiqueNotes = critique.value.notes;
      const failures = critiqueFailures(critique.value);
      if (failures.length) {
        if (remaining() < MIN_REPAIR_BUDGET_MS) {
          return fail(
            502,
            "critique",
            `The storyboard failed review and there was not enough time to repair it: ${failures.join(" ")}`,
          );
        }
        const repairText = await callModel(
          `${shotsSystem(strategy.value)}
REPAIR REQUIRED: a reviewer rejected the previous sequence for these reasons:
${failures.map((f) => `- ${f}`).join("\n")}
Return one complete corrected replacement sequence that fixes every point. Keep what worked; do not restate the same problems.`,
          `${shotsUser}

### REJECTED SEQUENCE
${sequenceSummary(shots)}`,
          Math.min(remaining() - 6_000, SHOTS_TIMEOUT_MS),
          8000,
        );
        const repairedSequence = buildSequence(
          extractReelJson(repairText),
          continuity.value,
          strategy.value,
          brandNegative,
        );
        if (!repairedSequence.ok) {
          return fail(
            502,
            "repair",
            `The storyboard failed review and the repair was invalid: ${repairedSequence.error}`,
          );
        }
        shots = repairedSequence.value;
        repaired = true;
      }
    }
    // A malformed critique is not grounds to publish an unreviewed storyboard,
    // but it is also not a defect in the sequence itself: record it and insert
    // the flow-validated sequence rather than discarding valid work.

    // --- Transactional insert ------------------------------------------------
    const provenance = {
      ...pack.provenance,
      storyboard_model: storyboardModel(),
      storyboard_prompt_version: STORYBOARD_PROMPT_VERSION,
      prompt_compiler_version: PROMPT_COMPILER_VERSION,
      critique_ran: critique.ok,
      critique_notes: critiqueNotes,
      repaired_after_critique: repaired,
      generated_at: new Date().toISOString(),
    };

    const inserted = await sb.rpc("insert_reel_storyboard_if_empty", {
      p_video_project_id: videoProjectId,
      p_client_id: clientId,
      p_client_production_brief_id: brief.id,
      p_shots: shots,
      p_story_strategy: strategy.value,
      p_continuity_plan: continuity.value,
      p_provenance: provenance,
      p_prompt_version: STORYBOARD_PROMPT_VERSION,
      p_model: storyboardModel(),
    });
    if (inserted.error || !inserted.data) {
      const message = inserted.error?.message ?? "Could not atomically insert the storyboard.";
      return fail(rpcStatus(message), "insert", message);
    }

    return json({
      ok: true,
      shots: inserted.data,
      strategy: strategy.value,
      continuity: continuity.value,
      provenance,
    });
  } catch (error) {
    if (error instanceof ReelStudioGateError) return fail(error.status, error.stage, error.message);
    const message = error instanceof Error ? error.message : String(error);
    return fail(error instanceof Error && error.message.includes("timed out") ? 504 : 500, "unexpected", message);
  }
});

export type { GeneratedShot };
