// Sequence-first storyboard generation: context assembly, story strategy,
// flow rules, prompt compilation, and regeneration.
//
// The fixture is a sanitised synthetic stand-in modelled on the Attract
// Acquisition internal client. No real client content is committed here.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  admitSections,
  buildContextPack,
  CATEGORY_BUDGETS,
  type ContextFileRow,
  type ExecutionFileRow,
  renderContextPack,
  splitMarkdownSections,
  trimAtBoundary,
} from "../supabase/functions/_shared/reel-studio-context-pack.ts";
import {
  compiledPromptCarriesGlobalContext,
  compileShotPrompt,
  MAX_COMPILED_PROMPT_CHARS,
  validateShotDirection,
} from "../supabase/functions/_shared/reel-studio-prompt-compiler.ts";
import {
  critiqueFailures,
  narrativePlanningPatch,
  type NarrativeReelShot,
  type ReelContinuityPlan,
  type ReelStoryStrategy,
  STORYBOARD_PROMPT_VERSION,
  validateNarrativeReelShot,
  validateReelContinuityPlan,
  validateReelStoryboardCritique,
  validateReelStoryStrategy,
  validateStoryboardFlow,
} from "../supabase/functions/_shared/reel-studio-story-contract.ts";

const root = new URL("../", import.meta.url);
async function file(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

// ─────────────────────────────── fixture ──────────────────────────────────

const CLIENT = "client-aa";
const OTHER_CLIENT = "client-other";

const BRIEF = {
  id: "brief-1",
  title: "Proof beats polish",
  source_ref: "JUL26-CR-900",
  source_table: "organic_master",
  content_md: [
    "## Strategy",
    "Speak to owners of proven service businesses who are invisible in their market.",
    "",
    "## Script",
    "Most service businesses are not short of results. They are short of proof anyone can see.",
    "",
    "## Caption direction",
    "Lead with the contradiction. No hashtags in the first line.",
    "",
    "## CTA",
    "Ask them to reply with the word PROOF for the extraction checklist.",
    "",
    "## Production notes",
    "Vertical, faceless, no music bed with lyrics.",
  ].join("\n"),
};

function contextFile(over: Partial<ContextFileRow> = {}): ContextFileRow {
  return {
    id: "ctx-2",
    client_id: CLIENT,
    file_number: 2,
    file_name: "02_Avatar_And_Buyer_Psychology.md",
    content_md: "## Avatar\nOwner-operators of proven service firms.\n\n## Fears\nBeing seen as another commodity supplier.",
    status: "approved",
    version: 1,
    ...over,
  };
}

function executionFile(over: Partial<ExecutionFileRow> = {}): ExecutionFileRow {
  return {
    id: "exec-1",
    client_id: CLIENT,
    file_name: "E05_Story_Angles.md",
    file_type: "story",
    content_md: "## Angle\nProof is a distribution problem, not a delivery problem.",
    review_state: "approved",
    version: 1,
    month: "2026-07",
    ...over,
  };
}

const BRAND = {
  id: "brand-1",
  version: 3,
  grade_block: "Near-black #0A0E0D, desaturated, single teal accent #00E5C3.",
  lens_block: "35mm macro, shallow depth of field.",
  mood_block: "Restrained, precise, engineered.",
  motion_block: "Slow push in.",
  negative_block: "No faces, no fake signage.",
};

const PROJECT = {
  title: "Proof beats polish",
  archetype: "A2",
  awareness_stage: "problem_aware",
  target_duration_sec: 24,
};

function pack(over: {
  contextFiles?: ContextFileRow[];
  executionFiles?: ExecutionFileRow[];
} = {}) {
  return buildContextPack({
    brief: BRIEF,
    sourceRowId: "organic-900",
    project: PROJECT,
    brand: BRAND,
    contextFiles: over.contextFiles ?? [contextFile()],
    executionFiles: over.executionFiles ?? [executionFile()],
    clientId: CLIENT,
  });
}

const CONTINUITY: ReelContinuityPlan = {
  visual_world: "A darkened workshop where evidence is catalogued under a single light.",
  location_bible: "One matte-black bench, concrete floor, no windows.",
  subject_bible: "Physical artefacts of proof: index cards, ledgers, calipers.",
  palette_bible: "Near-black #0A0E0D with one teal #00E5C3 accent and warm paper white.",
  lighting_bible: "Single hard key from upper left, deep falloff, no fill.",
  lens_bible: "35mm macro, shallow depth of field, slight barrel distortion.",
  recurring_objects: ["a stack of index cards", "a brass caliper"],
  screen_direction: "Movement consistently travels left to right.",
  continuity_constraints: ["The bench never changes material", "The teal accent is the only saturated colour"],
  global_negative_prompt: "no daylight, no office interiors, no stock-photo gloss",
};

const STRATEGY: ReelStoryStrategy = {
  core_message: "Proof you cannot see does not persuade anyone.",
  viewer: "Owner of a proven but invisible service business.",
  viewer_starting_state: "Believes good work speaks for itself.",
  viewer_ending_state: "Believes proof must be engineered and shown.",
  objective: "Earn a reply that starts the proof extraction conversation.",
  hook_strategy: "Open on evidence hidden in darkness.",
  central_tension: "The gap between results delivered and results visible.",
  proof_or_payoff: "The catalogue of evidence finally lit and legible.",
  emotional_progression: ["unease", "recognition", "resolve"],
  visual_progression: ["obscured", "partially revealed", "fully lit"],
  recurring_visual_motif: "a stack of index cards",
  continuity_rules: ["The bench and the light source never change"],
  opening_image_purpose: "Show evidence that exists but cannot be seen.",
  ending_image_purpose: "Show the same evidence legible, resolving the opening.",
  cta_or_final_takeaway: "Reply PROOF to start the extraction.",
  target_duration_seconds: 24,
  planned_shot_count: 6,
};

const DIRECTION = {
  subject: "A dense stack of handwritten index cards on a matte-black bench",
  action: "resting just outside the edge of a single hard light",
  composition: "tight vertical framing, cards occupying the lower third",
  camera_angle: "low three-quarter angle, slightly above bench height",
  depth_and_focus: "shallow focus on the top card, background falling to black",
  lighting: "single hard key from upper left, deep unfilled shadow",
  visual_metaphor: "evidence that exists but cannot be read",
};

function compiled(overrides: Partial<typeof DIRECTION> = {}): string {
  return compileShotPrompt({
    direction: { ...DIRECTION, ...overrides },
    continuity: CONTINUITY,
    shotContinuity: ["a stack of index cards"],
    humanPresence: "none",
    brandNegative: BRAND.negative_block,
  });
}

const ROLES = ["hook", "problem", "escalation", "proof", "transformation", "payoff"] as const;

function narrativeShot(index: number, total: number, over: Record<string, unknown> = {}) {
  return {
    shot_number: index + 1,
    beat_description: `Beat ${index + 1}`,
    compiled_prompt: compiled({ subject: `${DIRECTION.subject} variation ${index + 1}` }),
    shot_class: "metaphor",
    human_presence: "none",
    render_tier: "draft",
    motion_type: null,
    motion_strength: null,
    story_role: ROLES[index] ?? "escalation",
    narrative_beat: `Distinct narrative beat number ${index + 1}`,
    message_supported: `Distinct message number ${index + 1}`,
    transition_from_previous: index === 0 ? "" : `Follows on from shot ${index}`,
    transition_to_next: index === total - 1 ? "" : `Sets up shot ${index + 2}`,
    visual_continuity: ["a stack of index cards"],
    emotional_intent: `Emotion ${index + 1}`,
    ...over,
  };
}

function validSequence(total = 6): NarrativeReelShot[] {
  const shots: NarrativeReelShot[] = [];
  for (let i = 0; i < total; i += 1) {
    const result = validateNarrativeReelShot(narrativeShot(i, total), {
      expectedShotNumber: i + 1,
      expectedRenderTier: "draft",
      isFirst: i === 0,
      isLast: i === total - 1,
    });
    assert.equal(result.ok, true, result.ok ? "" : result.error);
    if (result.ok) shots.push(result.value);
  }
  return shots;
}

// ───────────────────────── context assembly ───────────────────────────────

test("the exact bound production brief supplies the script, CTA and production notes", () => {
  const result = pack();
  const script = result.categories.script_and_message.map((s) => s.text).join("\n");
  assert.match(script, /short of proof anyone can see/);
  assert.match(script, /reply with the word PROOF/);
  assert.match(script, /No hashtags in the first line/);
  const production = result.categories.production_constraints.map((s) => s.text).join("\n");
  assert.match(production, /no music bed with lyrics/);
});

test("approved context and execution files are included and categorised", () => {
  const result = pack();
  assert.match(result.categories.audience.map((s) => s.text).join("\n"), /Owner-operators of proven service firms/);
  assert.match(
    result.categories.content_strategy.map((s) => s.text).join("\n"),
    /Proof is a distribution problem/,
  );
  assert.ok(result.provenance.context_file_ids.includes("ctx-2"));
  assert.ok(result.provenance.execution_file_ids.includes("exec-1"));
});

test("unapproved, rejected, archived and superseded authority is excluded", () => {
  for (const status of ["needs_review", "needs_client_input", "generated", "not_started"]) {
    const result = pack({ contextFiles: [contextFile({ status })] });
    assert.equal(result.categories.audience.length, 0, `status ${status} must not be admitted`);
    assert.equal(result.provenance.excluded_unapproved_context_files, 1);
  }
  for (const state of ["rejected", "archived", "needs_review"]) {
    const result = pack({ executionFiles: [executionFile({ review_state: state })] });
    assert.equal(result.provenance.execution_file_ids.length, 0, `review_state ${state} must not be admitted`);
  }
});

test("another client's approved context is excluded", () => {
  const result = pack({
    contextFiles: [contextFile({ id: "ctx-foreign", client_id: OTHER_CLIENT })],
    executionFiles: [executionFile({ id: "exec-foreign", client_id: OTHER_CLIENT })],
  });
  assert.equal(result.provenance.context_file_ids.length, 0);
  assert.equal(result.provenance.execution_file_ids.length, 0);
  assert.equal(result.categories.audience.length, 0);
});

test("context files irrelevant to a Reel are excluded even when approved", () => {
  // 16_Performance_Report and 17_Iteration_Log are approved authority but have
  // no bearing on a Reel's story.
  const result = pack({
    contextFiles: [contextFile({ id: "ctx-16", file_number: 16, file_name: "16_Performance_Report.md" })],
  });
  assert.equal(result.provenance.context_file_ids.length, 0);
});

test("the active brand block is the visual authority and is recorded by version", () => {
  const result = pack();
  const visual = result.categories.visual_brand.map((s) => s.text).join("\n");
  assert.match(visual, /#0A0E0D/);
  assert.match(visual, /No faces, no fake signage/);
  assert.equal(result.provenance.brand_prompt_block_id, "brand-1");
  assert.equal(result.provenance.brand_prompt_block_version, 3);
});

test("mandatory brief sections survive budgeting even beside a huge context file", () => {
  const huge = contextFile({
    content_md: `## Avatar\n${"Filler sentence about the avatar. ".repeat(4000)}`,
  });
  const result = pack({ contextFiles: [huge] });
  const script = result.categories.script_and_message.map((s) => s.text).join("\n");
  assert.match(script, /reply with the word PROOF/, "the CTA must survive a very large avatar document");
  assert.equal(result.missingMandatory.length, 0);
  // The oversized document is bounded rather than allowed to swamp the pack.
  assert.ok(result.provenance.category_chars.audience <= CATEGORY_BUDGETS.audience);
});

test("a mandatory category with no approved authority is reported, not silently skipped", () => {
  const result = buildContextPack({
    brief: { ...BRIEF, content_md: "" },
    sourceRowId: "organic-900",
    project: PROJECT,
    brand: BRAND,
    contextFiles: [],
    executionFiles: [],
    clientId: CLIENT,
  });
  assert.ok(result.missingMandatory.includes("script_and_message"));
});

test("sections are admitted whole or trimmed at a boundary, never head-sliced", () => {
  const sections = splitMarkdownSections(BRIEF.content_md);
  assert.ok(sections.length >= 5);
  assert.ok(sections.some((s) => /CTA/i.test(s.heading)));

  const trimmed = trimAtBoundary("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.", 40);
  assert.equal(trimmed.trimmed, true);
  assert.ok(!trimmed.text.endsWith("Thi"), "must not cut mid-word");

  const result = admitSections(
    [
      { origin: "o", heading: "kept", text: "a".repeat(100) },
      { origin: "o", heading: "dropped", text: "b".repeat(5000) },
    ],
    300,
  );
  assert.equal(result.admitted.length, 1);
  assert.deepEqual(result.dropped, ["o :: dropped"]);
});

test("no blind first-N-character truncation of the brief remains in the generator", async () => {
  const handler = await file("supabase/functions/generate-video-storyboard/index.ts");
  assert.doesNotMatch(handler, /slice\(0,\s*6000\)/);
  assert.doesNotMatch(handler, /function compact\(/);
  assert.match(handler, /buildContextPack/);
});

test("the rendered pack names its gaps rather than inviting invention", () => {
  const result = pack({ contextFiles: [], executionFiles: [] });
  const rendered = renderContextPack(result);
  assert.match(rendered, /CONTEXT GAPS/);
  assert.match(rendered, /Do not invent facts/);
});

// ───────────────────────── story strategy ─────────────────────────────────

test("a complete strategy carries hook, progression and ending", () => {
  const result = validateReelStoryStrategy(STRATEGY);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  if (result.ok) {
    assert.ok(result.value.hook_strategy.length > 0);
    assert.ok(result.value.emotional_progression.length >= 2);
    assert.ok(result.value.ending_image_purpose.length > 0);
  }
});

test("a strategy missing the core message is rejected", () => {
  const result = validateReelStoryStrategy({ ...STRATEGY, core_message: "  " });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /core_message/);
});

test("a strategy missing the ending or the payoff is rejected", () => {
  for (const field of ["ending_image_purpose", "proof_or_payoff", "cta_or_final_takeaway"]) {
    const result = validateReelStoryStrategy({ ...STRATEGY, [field]: "" });
    assert.equal(result.ok, false, `${field} must be required`);
  }
});

test("planned shot count must respect the target duration", () => {
  const tooMany = validateReelStoryStrategy({ ...STRATEGY, planned_shot_count: 12, target_duration_seconds: 10 });
  assert.equal(tooMany.ok, false);
  const tooFew = validateReelStoryStrategy({ ...STRATEGY, planned_shot_count: 4, target_duration_seconds: 90 });
  assert.equal(tooFew.ok, false);
});

test("a flat progression list is rejected", () => {
  const result = validateReelStoryStrategy({ ...STRATEGY, emotional_progression: ["unease"] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /emotional_progression/);
});

test("a continuity plan requires concrete recurring anchors", () => {
  assert.equal(validateReelContinuityPlan(CONTINUITY).ok, true);
  assert.equal(validateReelContinuityPlan({ ...CONTINUITY, recurring_objects: [] }).ok, false);
  assert.equal(validateReelContinuityPlan({ ...CONTINUITY, palette_bible: "" }).ok, false);
});

test("malformed structured output is rejected rather than coerced", () => {
  assert.equal(validateReelStoryStrategy(null).ok, false);
  assert.equal(validateReelStoryStrategy("{}").ok, false);
  assert.equal(validateReelContinuityPlan([]).ok, false);
});

// ───────────────────────── storyboard flow ────────────────────────────────

test("a well-formed sequence passes every flow rule", () => {
  const result = validateStoryboardFlow(validSequence(6), STRATEGY);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("every shot carries a story role and the numbers are ordered and unique", () => {
  const shots = validSequence(6);
  assert.equal(new Set(shots.map((s) => s.shot_number)).size, 6);
  assert.deepEqual(shots.map((s) => s.shot_number), [1, 2, 3, 4, 5, 6]);
  for (const shot of shots) assert.ok(shot.story_role.length > 0);
});

test("shot 1 must be the hook and it must be the only one", () => {
  const shots = validSequence(6);
  const notHook = validateStoryboardFlow(
    [{ ...shots[0], story_role: "problem" }, ...shots.slice(1)],
    STRATEGY,
  );
  assert.equal(notHook.ok, false);
  if (!notHook.ok) assert.match(notHook.error, /hook/);

  const twoHooks = validateStoryboardFlow(
    [shots[0], { ...shots[1], story_role: "hook" }, ...shots.slice(2)],
    STRATEGY,
  );
  assert.equal(twoHooks.ok, false);
});

test("the final shot must resolve the opening", () => {
  const shots = validSequence(6);
  const result = validateStoryboardFlow(
    [...shots.slice(0, 5), { ...shots[5], story_role: "problem" }],
    STRATEGY,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /resolve the opening/);
});

test("every non-first shot states what changed, and every non-final shot sets up the next", () => {
  const missingFrom = validateNarrativeReelShot(
    narrativeShot(1, 6, { transition_from_previous: "" }),
    { expectedShotNumber: 2, expectedRenderTier: "draft", isFirst: false, isLast: false },
  );
  assert.equal(missingFrom.ok, false);
  if (!missingFrom.ok) assert.match(missingFrom.error, /transition_from_previous/);

  const missingTo = validateNarrativeReelShot(
    narrativeShot(1, 6, { transition_to_next: "" }),
    { expectedShotNumber: 2, expectedRenderTier: "draft", isFirst: false, isLast: false },
  );
  assert.equal(missingTo.ok, false);
  if (!missingTo.ok) assert.match(missingTo.error, /transition_to_next/);
});

test("redundant beats and repeated messages are rejected", () => {
  const shots = validSequence(6);
  const duplicateBeat = validateStoryboardFlow(
    [...shots.slice(0, 3), { ...shots[3], narrative_beat: shots[2].narrative_beat }, ...shots.slice(4)],
    STRATEGY,
  );
  assert.equal(duplicateBeat.ok, false);
  if (!duplicateBeat.ok) assert.match(duplicateBeat.error, /repeats an existing narrative beat/);

  const duplicateMessage = validateStoryboardFlow(
    [...shots.slice(0, 3), { ...shots[3], message_supported: shots[2].message_supported }, ...shots.slice(4)],
    STRATEGY,
  );
  assert.equal(duplicateMessage.ok, false);
});

test("three consecutive shots doing the same job is stalling, not building", () => {
  const shots = validSequence(6);
  const stalled = validateStoryboardFlow(
    [
      shots[0],
      { ...shots[1], story_role: "escalation" },
      { ...shots[2], story_role: "escalation" },
      { ...shots[3], story_role: "escalation" },
      shots[4],
      shots[5],
    ],
    STRATEGY,
  );
  assert.equal(stalled.ok, false);
  if (!stalled.ok) assert.match(stalled.error, /must progress/);
});

test("the sequence length must match the approved strategy and the duration", () => {
  const result = validateStoryboardFlow(validSequence(5), STRATEGY);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /planned 6/);
});

test("an invalid flow inserts zero shots because validation precedes the RPC", async () => {
  const handler = await file("supabase/functions/generate-video-storyboard/index.ts");
  const flowAt = handler.indexOf("validateStoryboardFlow");
  const insertAt = handler.indexOf('sb.rpc("insert_reel_storyboard_if_empty"');
  assert.ok(flowAt > 0 && flowAt < insertAt);
  // Every failure path returns before the insert.
  assert.match(handler, /fail\(\s*502,\s*"shots"/);
  assert.match(handler, /fail\(\s*502,\s*"repair"/);
  assert.match(handler, /fail\(\s*502,\s*"strategy"/);
});

test("storyboard insertion remains a single atomic RPC that refuses a non-empty project", async () => {
  const migration = await file("supabase/migrations/20260729000037_reel_studio_storyboard_narrative.sql");
  assert.match(migration, /REEL_STORYBOARD_NOT_EMPTY/);
  assert.match(migration, /for update/);
  assert.match(migration, /'pending'/);
});

// ───────────────────────── critique pass ──────────────────────────────────

test("a clean critique produces no failures and a dirty one produces specific failures", () => {
  const clean = {
    hook_is_clear: true,
    every_shot_advances: true,
    redundant_shots: [],
    unexplained_visual_changes: [],
    emotionally_flat: false,
    proof_represented: true,
    ending_pays_off: true,
    aligns_with_brief: true,
    aligns_with_positioning: true,
    aligns_with_brand: true,
    supports_duration: true,
    prompts_are_consistent: true,
    order_is_load_bearing: true,
    material_failures: [],
    notes: "",
  };
  const parsedClean = validateReelStoryboardCritique(clean);
  assert.equal(parsedClean.ok, true);
  if (parsedClean.ok) assert.deepEqual(critiqueFailures(parsedClean.value), []);

  const dirty = validateReelStoryboardCritique({
    ...clean,
    order_is_load_bearing: false,
    redundant_shots: [3, 4],
    emotionally_flat: true,
  });
  assert.equal(dirty.ok, true);
  if (dirty.ok) {
    const failures = critiqueFailures(dirty.value);
    assert.ok(failures.some((f) => /reordered/.test(f)));
    assert.ok(failures.some((f) => /Redundant shots: 3, 4/.test(f)));
    assert.ok(failures.some((f) => /emotionally flat/.test(f)));
  }
});

test("a malformed critique is rejected rather than read as a pass", () => {
  assert.equal(validateReelStoryboardCritique({ hook_is_clear: "yes" }).ok, false);
  assert.equal(validateReelStoryboardCritique(null).ok, false);
});

// ───────────────────────── image prompts ──────────────────────────────────

test("every compiled prompt carries the global visual bible and the negatives", () => {
  const prompt = compiled();
  assert.ok(compiledPromptCarriesGlobalContext(prompt, CONTINUITY));
  assert.match(prompt, /Palette:/);
  assert.match(prompt, /Lens:/);
  assert.match(prompt, /9:16/);
  assert.match(prompt, /Avoid:/);
  assert.match(prompt, /no readable text/);
  assert.match(prompt, /no daylight/, "the plan's global negative prompt must be present");
  assert.match(prompt, /No faces, no fake signage/, "the brand negative must be present");
});

test("every compiled prompt carries shot-specific subject, action and composition", () => {
  const prompt = compiled();
  assert.match(prompt, /dense stack of handwritten index cards/);
  assert.match(prompt, /resting just outside the edge of a single hard light/);
  assert.match(prompt, /tight vertical framing/);
  assert.match(prompt, /low three-quarter angle/);
});

test("continuity anchors are repeated into the prompt rather than referenced", () => {
  const prompt = compiled();
  assert.match(prompt, /Recurring elements that must stay identical/);
  assert.match(prompt, /a stack of index cards/);
  assert.match(prompt, /brass caliper/);
  assert.match(prompt, /Movement consistently travels left to right/);
});

test("the human-presence rule is stated explicitly in every prompt", () => {
  const none = compileShotPrompt({
    direction: DIRECTION,
    continuity: CONTINUITY,
    shotContinuity: [],
    humanPresence: "none",
    brandNegative: null,
  });
  assert.match(none, /No people, no faces/);
  const hands = compileShotPrompt({
    direction: DIRECTION,
    continuity: CONTINUITY,
    shotContinuity: [],
    humanPresence: "hands_only",
    brandNegative: null,
  });
  assert.match(hands, /Only hands are visible/);
});

test("compiled prompts stay inside the practical prompt budget", () => {
  const prompt = compileShotPrompt({
    direction: DIRECTION,
    continuity: {
      ...CONTINUITY,
      location_bible: "x".repeat(2000),
      subject_bible: "y".repeat(2000),
    },
    shotContinuity: ["a".repeat(500)],
    humanPresence: "none",
    brandNegative: BRAND.negative_block,
  });
  assert.ok(prompt.length <= MAX_COMPILED_PROMPT_CHARS, `prompt was ${prompt.length} chars`);
  assert.match(prompt, /Avoid:/, "the negatives must survive budgeting");
});

test("prompts containing unfilled placeholders are rejected", () => {
  const result = validateNarrativeReelShot(
    narrativeShot(0, 6, { compiled_prompt: `${compiled()} {{subject}}` }),
    { expectedShotNumber: 1, expectedRenderTier: "draft", isFirst: true, isLast: false },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /placeholder/);
});

test("prompts that lean on the previous shot are rejected", () => {
  for (const phrase of ["same as before", "as above", "previous shot"]) {
    const result = validateNarrativeReelShot(
      narrativeShot(1, 6, { compiled_prompt: `${compiled()} Keep the ${phrase}.` }),
      { expectedShotNumber: 2, expectedRenderTier: "draft", isFirst: false, isLast: false },
    );
    assert.equal(result.ok, false, `"${phrase}" must be rejected`);
    if (!result.ok) assert.match(result.error, /refers back to another shot/);
  }
});

test("a thin prompt is not accepted as a self-contained image instruction", () => {
  const result = validateNarrativeReelShot(
    narrativeShot(0, 6, { compiled_prompt: "Index cards on a bench." }),
    { expectedShotNumber: 1, expectedRenderTier: "draft", isFirst: true, isLast: false },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /self-contained/);
});

test("shot direction is required in full and no provider parameters are invented", async () => {
  assert.equal(validateShotDirection({ subject: "a" }).ok, false);
  assert.equal(validateShotDirection(null).ok, false);
  assert.equal(validateShotDirection({ ...DIRECTION }).ok, true);

  const compiler = await file("supabase/functions/_shared/reel-studio-prompt-compiler.ts");
  // Seeds, reference images and weighting are not exposed by the adapter, so
  // the compiler must not pretend they are.
  assert.doesNotMatch(compiler, /\bseed\b|reference_image|image_weight|\(\s*weight\s*:/i);
});

test("the storyboard leaves motion unselected for the separate provider step", () => {
  const shots = validSequence(6);
  for (const shot of shots) {
    assert.equal(shot.motion_type, null);
    assert.equal(shot.motion_strength, null);
    assert.equal(shot.render_tier, "draft");
  }
});

test("an operator's edited prompt is what still generation actually sends", async () => {
  const submit = await file("supabase/functions/submit-shot-still-image/index.ts");
  assert.match(submit, /shot\.compiled_prompt/);
  // Nothing re-derives or re-compiles the prompt at submission time.
  assert.doesNotMatch(submit, /compileShotPrompt|continuity_plan/);
});

// ───────────────────────── regeneration ───────────────────────────────────

test("regeneration is bound to the persisted spine, sequence and neighbours", async () => {
  const handler = await file("supabase/functions/regenerate-video-shot/index.ts");
  assert.match(handler, /validateReelStoryStrategy\(project\.story_strategy\)/);
  assert.match(handler, /validateReelContinuityPlan\(project\.continuity_plan\)/);
  assert.match(handler, /sequenceMap\(shots, shot\.shot_number\)/);
  assert.match(handler, /neighbourBlock\(previous, "Previous shot"\)/);
  assert.match(handler, /neighbourBlock\(next, "Next shot"\)/);
});

test("regeneration preserves the shot's identity, position and narrative role", async () => {
  const handler = await file("supabase/functions/regenerate-video-shot/index.ts");
  const migration = await file("supabase/migrations/20260729000037_reel_studio_storyboard_narrative.sql");
  assert.match(handler, /expected_updated_at/);
  assert.match(handler, /story_role must remain/);
  assert.match(handler, /shot_number: shot\.shot_number/);
  // The database refuses a role change even if the function is bypassed.
  assert.match(migration, /REEL_SHOT_ROLE_CHANGED/);
});

test("regeneration replaces only planning fields and never starts image generation", () => {
  const shots = validSequence(6);
  const patch = narrativePlanningPatch(shots[2]);
  const keys = Object.keys(patch).sort();
  assert.deepEqual(keys, [
    "beat_description",
    "compiled_prompt",
    "emotional_intent",
    "human_presence",
    "message_supported",
    "narrative_beat",
    "render_tier",
    "shot_class",
    "story_role",
    "transition_from_previous",
    "transition_to_next",
    "visual_continuity",
  ]);
  // No media, job, status or identity field can be written by a regeneration.
  for (const forbidden of ["id", "shot_number", "status", "still_image_url", "higgsfield_job_id", "clip_url"]) {
    assert.ok(!(forbidden in patch), `${forbidden} must not be part of the planning patch`);
  }
});

test("regeneration does not trigger any provider job", async () => {
  const handler = await file("supabase/functions/regenerate-video-shot/index.ts");
  assert.doesNotMatch(handler, /submit-shot-still-image|submit-shot-generation|submitHiggsfield/);
});

test("an invalid regeneration returns an error instead of overwriting a valid shot", async () => {
  const handler = await file("supabase/functions/regenerate-video-shot/index.ts");
  const failAt = handler.indexOf('fail(502, "validate"');
  const rpcAt = handler.indexOf('sb.rpc("regenerate_pending_reel_shot"');
  assert.ok(failAt > 0 && failAt < rpcAt, "validation must fail out before the update RPC");
});

test("projects storyboarded before the spine still regenerate on the original path", async () => {
  const handler = await file("supabase/functions/regenerate-video-shot/index.ts");
  assert.match(handler, /sequenceAware/);
  assert.match(handler, /validateRegeneratedReelShotOutput/);
  assert.match(handler, /regeneratedPlanningPatch/);
});

// ───────────────────── provenance and versioning ──────────────────────────

test("provenance answers which approved information produced the storyboard", () => {
  const result = pack();
  const p = result.provenance;
  assert.equal(p.production_brief_id, "brief-1");
  assert.equal(p.source_master_id, "organic-900");
  assert.ok(Array.isArray(p.context_file_ids));
  assert.ok(Array.isArray(p.execution_file_ids));
  assert.equal(p.brand_prompt_block_id, "brand-1");
  assert.equal(p.brand_prompt_block_version, 3);
  assert.ok(p.context_pack_version.length > 0);
});

test("prompt, compiler and context-pack versions are recorded on every storyboard", async () => {
  const handler = await file("supabase/functions/generate-video-storyboard/index.ts");
  assert.match(handler, /storyboard_prompt_version: STORYBOARD_PROMPT_VERSION/);
  assert.match(handler, /prompt_compiler_version: PROMPT_COMPILER_VERSION/);
  assert.match(handler, /p_prompt_version: STORYBOARD_PROMPT_VERSION/);
  assert.ok(STORYBOARD_PROMPT_VERSION.startsWith("reel-storyboard@"));
});

test("provenance never leaks hidden prompt text or provider configuration", async () => {
  const handler = await file("supabase/functions/generate-video-storyboard/index.ts");
  const provenanceBlock = handler.slice(handler.indexOf("const provenance = {"), handler.indexOf("const inserted"));
  assert.doesNotMatch(provenanceBlock, /SYSTEM|shotsUser|strategyUser|contextText|ANTHROPIC/);
});

test("existing storyboards remain readable: every new column is nullable and additive", async () => {
  const migration = await file("supabase/migrations/20260729000037_reel_studio_storyboard_narrative.sql");
  assert.match(migration, /add column if not exists story_strategy jsonb/);
  assert.match(migration, /add column if not exists story_role text/);
  assert.doesNotMatch(migration, /drop column|drop table|delete from|truncate/i);

  // Inspect the ALTER TABLE statements themselves: a NOT NULL on a new column
  // would break every storyboard that predates this migration.
  const alters = migration.match(/alter table[\s\S]*?;/gi) ?? [];
  assert.ok(alters.length >= 2, "expected the project and shot ALTER TABLE statements");
  for (const statement of alters) {
    const added = statement.match(/add column if not exists[^,;]*/gi) ?? [];
    for (const column of added) {
      assert.doesNotMatch(column, /\bnot null\b/i, `new column must be nullable: ${column.trim()}`);
      assert.doesNotMatch(column, /\bdefault\b/i, `new column must not backfill a default: ${column.trim()}`);
    }
  }
  // Legacy rows keep a null role rather than being rejected by the constraint.
  assert.match(migration, /story_role is null/);
});

test("no existing storyboard is regenerated or rewritten by the migration", async () => {
  const migration = await file("supabase/migrations/20260729000037_reel_studio_storyboard_narrative.sql");
  // The only UPDATE statements permitted are inside the RPCs, acting on the one
  // project or shot the caller named — never a table-wide rewrite.
  const updates = migration.match(/update public\.\w+\s+set[\s\S]*?(?=;)/gi) ?? [];
  for (const statement of updates) {
    assert.match(statement, /where\s+id\s*=\s*p_/i, `every update must be scoped by id: ${statement.slice(0, 60)}`);
  }
  assert.doesNotMatch(migration, /update public\.video_shots\s+set\s+compiled_prompt\s*=\s*(?!btrim)/i);
});

test("the storyboard insert RPC is service-role only, not callable by anon or authenticated", async () => {
  // A DROP + CREATE of a SECURITY DEFINER function inherits this project's
  // ALTER DEFAULT PRIVILEGES grants to anon/authenticated, and REVOKE ... FROM
  // PUBLIC does not remove them. 20260729000037 hit exactly that; the lockdown
  // migration is what restores the service-role-only invariant every other Reel
  // write RPC holds.
  const lockdown = await file("supabase/migrations/20260729000038_reel_storyboard_insert_grant_lockdown.sql");
  assert.match(lockdown, /revoke execute on function public\.insert_reel_storyboard_if_empty/i);
  assert.match(lockdown, /from anon, authenticated, public/i);
  assert.match(lockdown, /grant execute[\s\S]*?to service_role/i);
  assert.doesNotMatch(lockdown, /grant execute[\s\S]*?to (anon|authenticated)/i);
});

test("the human quality rubric exists and defines release criteria", async () => {
  const rubric = await file("docs/REEL_STUDIO_STORYBOARD_QUALITY_RUBRIC.md");
  for (const category of [
    "Hook clarity",
    "Narrative coherence",
    "Shot-to-shot dependency",
    "Visual continuity",
    "Emotional progression",
    "Message clarity",
    "Proof integration",
    "Brand alignment",
    "Prompt specificity",
    "Production feasibility",
    "Ending/payoff",
    "Overall impact",
  ]) {
    assert.ok(rubric.includes(category), `rubric must score ${category}`);
  }
  assert.match(rubric, /No category below 3/);
  assert.match(rubric, /Average score at least 4/);
});
