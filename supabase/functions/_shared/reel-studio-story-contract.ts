// Reel Studio narrative contracts.
//
// The Phase 1-3 shot contract (`reel-studio-contract.ts`) validates that a shot
// is *technically* well-formed. Nothing in it can tell whether the sequence is a
// story. These contracts add the missing layer: a story spine generated before
// any shot exists, a project-level continuity plan every prompt compiles from,
// and per-shot narrative fields that make flow objectively checkable.
//
// Everything here is additive. The existing shot fields keep their exact
// meaning and validation; narrative fields sit alongside them.

import {
  type ContractResult,
  MAX_REEL_STORYBOARD_SHOTS,
  MIN_REEL_STORYBOARD_SHOTS,
  type PendingReelShot,
  validatePendingReelShot,
} from "./reel-studio-contract.ts";

export const STORYBOARD_PROMPT_VERSION = "reel-storyboard@2.0.0";
export const SHOT_REGENERATION_PROMPT_VERSION = "reel-shot-regen@2.0.0";

/**
 * Narrative roles a shot may play. Deliberately broader than a fixed template
 * so the model picks the shape the content actually needs, but closed so the
 * UI can label every shot and the flow rules can reason about ordering.
 */
export const REEL_STORY_ROLES = [
  "hook",
  "problem",
  "escalation",
  "insight",
  "proof",
  "transformation",
  "payoff",
  "cta",
] as const;
export type ReelStoryRole = typeof REEL_STORY_ROLES[number];

const STORY_ROLE_SET = new Set<string>(REEL_STORY_ROLES);

/** Roles that may legitimately close a Reel. */
const CLOSING_ROLES = new Set<string>(["payoff", "cta", "transformation"]);

export interface ReelStoryStrategy {
  core_message: string;
  viewer: string;
  viewer_starting_state: string;
  viewer_ending_state: string;
  objective: string;
  hook_strategy: string;
  central_tension: string;
  proof_or_payoff: string;
  emotional_progression: string[];
  visual_progression: string[];
  recurring_visual_motif: string;
  continuity_rules: string[];
  opening_image_purpose: string;
  ending_image_purpose: string;
  cta_or_final_takeaway: string;
  target_duration_seconds: number;
  planned_shot_count: number;
}

export interface ReelContinuityPlan {
  visual_world: string;
  location_bible: string;
  subject_bible: string;
  palette_bible: string;
  lighting_bible: string;
  lens_bible: string;
  recurring_objects: string[];
  screen_direction: string;
  continuity_constraints: string[];
  global_negative_prompt: string;
}

/** A storyboard shot with its narrative role and continuity anchors. */
export interface NarrativeReelShot extends PendingReelShot {
  story_role: ReelStoryRole;
  narrative_beat: string;
  message_supported: string;
  transition_from_previous: string;
  transition_to_next: string;
  visual_continuity: string[];
  emotional_intent: string;
}

export interface ReelStoryboardCritique {
  hook_is_clear: boolean;
  every_shot_advances: boolean;
  redundant_shots: number[];
  unexplained_visual_changes: number[];
  emotionally_flat: boolean;
  proof_represented: boolean;
  ending_pays_off: boolean;
  aligns_with_brief: boolean;
  aligns_with_positioning: boolean;
  aligns_with_brand: boolean;
  supports_duration: boolean;
  prompts_are_consistent: boolean;
  order_is_load_bearing: boolean;
  material_failures: string[];
  notes: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown, min: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map((v) => text(v)).filter((v) => v.length > 0);
  return items.length >= min ? items : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const items: number[] = [];
  for (const entry of value) {
    if (!Number.isInteger(entry)) return null;
    items.push(Number(entry));
  }
  return items;
}

/** Placeholders that indicate the model left a slot unfilled. */
const PLACEHOLDER_PATTERN = /\{\{|\}\}|\[(?:todo|tbd|insert|placeholder|xxx)\]|\blorem ipsum\b/i;

/**
 * References that only make sense to a reader who saw the previous shot. Each
 * still image is generated independently, so a prompt that says "the same
 * kitchen" carries no information to the image model.
 */
const UNRESOLVED_BACKREFERENCE_PATTERN =
  /\b(?:same as (?:before|above|previous)|as (?:before|above)|previous shot|prior shot|aforementioned|see shot \d)\b/i;

export function validateReelStoryStrategy(parsed: unknown): ContractResult<ReelStoryStrategy> {
  const input = record(parsed);
  if (!input) return { ok: false, error: "Story strategy must be a JSON object." };

  const singles: Array<keyof ReelStoryStrategy> = [
    "core_message",
    "viewer",
    "viewer_starting_state",
    "viewer_ending_state",
    "objective",
    "hook_strategy",
    "central_tension",
    "proof_or_payoff",
    "recurring_visual_motif",
    "opening_image_purpose",
    "ending_image_purpose",
    "cta_or_final_takeaway",
  ];
  const values: Record<string, unknown> = {};
  for (const field of singles) {
    const value = text(input[field]);
    if (!value) return { ok: false, error: `${field} must be a non-empty string.` };
    values[field] = value;
  }

  const emotional = stringList(input.emotional_progression, 2);
  if (!emotional) {
    return { ok: false, error: "emotional_progression must list at least 2 states." };
  }
  const visual = stringList(input.visual_progression, 2);
  if (!visual) {
    return { ok: false, error: "visual_progression must list at least 2 stages." };
  }
  const continuity = stringList(input.continuity_rules, 1);
  if (!continuity) {
    return { ok: false, error: "continuity_rules must list at least 1 rule." };
  }

  const duration = input.target_duration_seconds;
  if (!Number.isFinite(duration) || Number(duration) <= 0) {
    return { ok: false, error: "target_duration_seconds must be a positive number." };
  }
  const plannedCount = input.planned_shot_count;
  if (
    !Number.isInteger(plannedCount) ||
    Number(plannedCount) < MIN_REEL_STORYBOARD_SHOTS ||
    Number(plannedCount) > MAX_REEL_STORYBOARD_SHOTS
  ) {
    return {
      ok: false,
      error:
        `planned_shot_count must be an integer between ${MIN_REEL_STORYBOARD_SHOTS} and ${MAX_REEL_STORYBOARD_SHOTS}.`,
    };
  }

  // A plan that cannot be shot in the available time is not a valid plan.
  const perShot = Number(duration) / Number(plannedCount);
  if (perShot < 1.5 || perShot > 8) {
    return {
      ok: false,
      error:
        `planned_shot_count ${plannedCount} over ${duration}s implies ${perShot.toFixed(1)}s per shot; must be between 1.5s and 8s.`,
    };
  }

  return {
    ok: true,
    value: {
      ...(values as unknown as ReelStoryStrategy),
      emotional_progression: emotional,
      visual_progression: visual,
      continuity_rules: continuity,
      target_duration_seconds: Number(duration),
      planned_shot_count: Number(plannedCount),
    },
  };
}

export function validateReelContinuityPlan(parsed: unknown): ContractResult<ReelContinuityPlan> {
  const input = record(parsed);
  if (!input) return { ok: false, error: "Continuity plan must be a JSON object." };

  const singles: Array<keyof ReelContinuityPlan> = [
    "visual_world",
    "location_bible",
    "subject_bible",
    "palette_bible",
    "lighting_bible",
    "lens_bible",
    "screen_direction",
    "global_negative_prompt",
  ];
  const values: Record<string, unknown> = {};
  for (const field of singles) {
    const value = text(input[field]);
    if (!value) return { ok: false, error: `${field} must be a non-empty string.` };
    values[field] = value;
  }

  const objects = stringList(input.recurring_objects, 1);
  if (!objects) return { ok: false, error: "recurring_objects must list at least 1 object." };
  const constraints = stringList(input.continuity_constraints, 1);
  if (!constraints) {
    return { ok: false, error: "continuity_constraints must list at least 1 constraint." };
  }

  return {
    ok: true,
    value: {
      ...(values as unknown as ReelContinuityPlan),
      recurring_objects: objects,
      continuity_constraints: constraints,
    },
  };
}

interface NarrativeShotOptions {
  expectedShotNumber?: number;
  expectedRenderTier?: "draft" | "final";
  isFirst: boolean;
  isLast: boolean;
}

export function validateNarrativeReelShot(
  value: unknown,
  options: NarrativeShotOptions,
): ContractResult<NarrativeReelShot> {
  // The frozen technical contract still governs the persisted media fields.
  const base = validatePendingReelShot(value, {
    requireExplicitFields: true,
    expectedShotNumber: options.expectedShotNumber,
    expectedRenderTier: options.expectedRenderTier,
    requireMotionUnselected: true,
  });
  if (!base.ok) return base;

  const input = record(value);
  if (!input) return { ok: false, error: "Shot must be a JSON object." };

  const role = text(input.story_role);
  if (!STORY_ROLE_SET.has(role)) {
    return { ok: false, error: `story_role must be one of ${REEL_STORY_ROLES.join(", ")}.` };
  }

  const narrativeBeat = text(input.narrative_beat);
  if (!narrativeBeat) return { ok: false, error: "narrative_beat must be a non-empty string." };

  const messageSupported = text(input.message_supported);
  if (!messageSupported) {
    return { ok: false, error: "message_supported must be a non-empty string." };
  }

  const emotionalIntent = text(input.emotional_intent);
  if (!emotionalIntent) {
    return { ok: false, error: "emotional_intent must be a non-empty string." };
  }

  // The first shot has nothing to transition from; the last has nothing to set
  // up. Every other shot must state both, which is what makes order load-bearing.
  const fromPrevious = text(input.transition_from_previous);
  if (!options.isFirst && !fromPrevious) {
    return { ok: false, error: "transition_from_previous is required for every shot after the first." };
  }
  const toNext = text(input.transition_to_next);
  if (!options.isLast && !toNext) {
    return { ok: false, error: "transition_to_next is required for every shot before the last." };
  }

  const continuity = stringList(input.visual_continuity, options.isFirst ? 1 : 1);
  if (!continuity) {
    return { ok: false, error: "visual_continuity must list at least 1 anchor carried into this frame." };
  }

  const prompt = base.value.compiled_prompt;
  if (PLACEHOLDER_PATTERN.test(prompt)) {
    return { ok: false, error: "compiled_prompt contains an unfilled placeholder." };
  }
  if (UNRESOLVED_BACKREFERENCE_PATTERN.test(prompt)) {
    return {
      ok: false,
      error:
        "compiled_prompt refers back to another shot; each prompt is sent to the image model alone and must restate the details.",
    };
  }
  if (prompt.length < 200) {
    return {
      ok: false,
      error: "compiled_prompt must be a complete, self-contained image instruction (at least 200 characters).",
    };
  }

  return {
    ok: true,
    value: {
      ...base.value,
      story_role: role as ReelStoryRole,
      narrative_beat: narrativeBeat,
      message_supported: messageSupported,
      transition_from_previous: fromPrevious,
      transition_to_next: toNext,
      visual_continuity: continuity,
      emotional_intent: emotionalIntent,
    },
  };
}

/**
 * Objective, server-side flow rules. These are the subset of the story-flow
 * requirements that can be decided without judgement; the qualitative ones go
 * to the critique pass instead.
 */
export function validateStoryboardFlow(
  shots: NarrativeReelShot[],
  strategy: ReelStoryStrategy,
): ContractResult<NarrativeReelShot[]> {
  if (shots.length < MIN_REEL_STORYBOARD_SHOTS || shots.length > MAX_REEL_STORYBOARD_SHOTS) {
    return {
      ok: false,
      error: `Storyboard must contain ${MIN_REEL_STORYBOARD_SHOTS}-${MAX_REEL_STORYBOARD_SHOTS} shots.`,
    };
  }

  for (const [index, shot] of shots.entries()) {
    if (shot.shot_number !== index + 1) {
      return { ok: false, error: `Shot numbers must be contiguous 1..N; position ${index + 1} is ${shot.shot_number}.` };
    }
  }

  if (shots[0].story_role !== "hook") {
    return { ok: false, error: `Shot 1 must carry story_role "hook"; received "${shots[0].story_role}".` };
  }

  const hookCount = shots.filter((s) => s.story_role === "hook").length;
  if (hookCount !== 1) {
    return { ok: false, error: `Exactly one shot may be the hook; received ${hookCount}.` };
  }

  const last = shots[shots.length - 1];
  if (!CLOSING_ROLES.has(last.story_role)) {
    return {
      ok: false,
      error: `The final shot must resolve the opening (payoff, cta, or transformation); received "${last.story_role}".`,
    };
  }

  const ctaCount = shots.filter((s) => s.story_role === "cta").length;
  if (ctaCount > 1) {
    return { ok: false, error: `At most one cta shot is allowed; received ${ctaCount}.` };
  }

  // Three shots in a row doing the same narrative job is stalling, not building.
  for (let i = 2; i < shots.length; i += 1) {
    if (
      shots[i].story_role === shots[i - 1].story_role &&
      shots[i].story_role === shots[i - 2].story_role
    ) {
      return {
        ok: false,
        error: `Shots ${i - 1}-${i + 1} all carry story_role "${shots[i].story_role}"; the sequence must progress.`,
      };
    }
  }

  // Two shots expressing the same idea means one of them is not earning its place.
  const beats = new Set<string>();
  for (const shot of shots) {
    const key = shot.narrative_beat.toLowerCase().replace(/\s+/g, " ").trim();
    if (beats.has(key)) {
      return { ok: false, error: `Shot ${shot.shot_number} repeats an existing narrative beat.` };
    }
    beats.add(key);
  }

  const messages = new Set<string>();
  for (const shot of shots) {
    const key = shot.message_supported.toLowerCase().replace(/\s+/g, " ").trim();
    if (messages.has(key)) {
      return {
        ok: false,
        error: `Shot ${shot.shot_number} supports the same message as an earlier shot; each shot must advance the idea.`,
      };
    }
    messages.add(key);
  }

  if (shots.length !== strategy.planned_shot_count) {
    return {
      ok: false,
      error: `Storyboard has ${shots.length} shots but the approved strategy planned ${strategy.planned_shot_count}.`,
    };
  }

  const perShot = strategy.target_duration_seconds / shots.length;
  if (perShot < 1.5 || perShot > 8) {
    return {
      ok: false,
      error: `${shots.length} shots over ${strategy.target_duration_seconds}s is ${perShot.toFixed(1)}s per shot.`,
    };
  }

  return { ok: true, value: shots };
}

export function validateReelStoryboardCritique(
  parsed: unknown,
): ContractResult<ReelStoryboardCritique> {
  const input = record(parsed);
  if (!input) return { ok: false, error: "Critique must be a JSON object." };

  const flags: Array<keyof ReelStoryboardCritique> = [
    "hook_is_clear",
    "every_shot_advances",
    "emotionally_flat",
    "proof_represented",
    "ending_pays_off",
    "aligns_with_brief",
    "aligns_with_positioning",
    "aligns_with_brand",
    "supports_duration",
    "prompts_are_consistent",
    "order_is_load_bearing",
  ];
  const values: Record<string, unknown> = {};
  for (const field of flags) {
    const value = bool(input[field]);
    if (value === null) return { ok: false, error: `${field} must be a boolean.` };
    values[field] = value;
  }

  const redundant = numberList(input.redundant_shots);
  if (!redundant) return { ok: false, error: "redundant_shots must be an array of shot numbers." };
  const unexplained = numberList(input.unexplained_visual_changes);
  if (!unexplained) {
    return { ok: false, error: "unexplained_visual_changes must be an array of shot numbers." };
  }
  const failures = Array.isArray(input.material_failures)
    ? input.material_failures.map((f) => text(f)).filter(Boolean)
    : null;
  if (!failures) return { ok: false, error: "material_failures must be an array of strings." };

  return {
    ok: true,
    value: {
      ...(values as unknown as ReelStoryboardCritique),
      redundant_shots: redundant,
      unexplained_visual_changes: unexplained,
      material_failures: failures,
      notes: text(input.notes),
    },
  };
}

/**
 * The critique's verdict. A storyboard fails when any load-bearing quality is
 * absent — these map 1:1 onto the release criteria in the quality rubric.
 */
export function critiqueFailures(critique: ReelStoryboardCritique): string[] {
  const failures: string[] = [];
  if (!critique.hook_is_clear) failures.push("The opening shot does not establish a clear idea.");
  if (!critique.every_shot_advances) failures.push("At least one shot does not advance the idea.");
  if (critique.redundant_shots.length) {
    failures.push(`Redundant shots: ${critique.redundant_shots.join(", ")}.`);
  }
  if (critique.unexplained_visual_changes.length) {
    failures.push(`Unexplained visual changes at shots: ${critique.unexplained_visual_changes.join(", ")}.`);
  }
  if (critique.emotionally_flat) failures.push("The sequence is emotionally flat.");
  if (!critique.ending_pays_off) failures.push("The ending does not resolve the opening.");
  if (!critique.aligns_with_brief) failures.push("The sequence does not match the production brief.");
  if (!critique.aligns_with_positioning) failures.push("The sequence conflicts with client positioning.");
  if (!critique.aligns_with_brand) failures.push("The sequence conflicts with brand identity.");
  if (!critique.supports_duration) failures.push("The sequence does not fit the target duration.");
  if (!critique.prompts_are_consistent) failures.push("Image prompts are not visually consistent.");
  if (!critique.order_is_load_bearing) failures.push("Shots could be reordered without changing the meaning.");
  failures.push(...critique.material_failures);
  return failures;
}

/** Narrative fields persisted alongside the frozen planning fields. */
export function narrativePlanningPatch(shot: NarrativeReelShot) {
  return {
    beat_description: shot.beat_description,
    compiled_prompt: shot.compiled_prompt,
    shot_class: shot.shot_class,
    human_presence: shot.human_presence,
    render_tier: shot.render_tier,
    story_role: shot.story_role,
    narrative_beat: shot.narrative_beat,
    message_supported: shot.message_supported,
    transition_from_previous: shot.transition_from_previous,
    transition_to_next: shot.transition_to_next,
    visual_continuity: shot.visual_continuity,
    emotional_intent: shot.emotional_intent,
  };
}
