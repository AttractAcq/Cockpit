export const REEL_SOURCE_TABLES = ["organic_master", "ads_master"] as const;
export type ReelSourceTable = typeof REEL_SOURCE_TABLES[number];

export const REEL_SHOT_CLASSES = ["metaphor", "atmosphere", "abstract"] as const;
export type ReelShotClass = typeof REEL_SHOT_CLASSES[number];

export const REEL_HUMAN_PRESENCE = ["none", "hands_only"] as const;
export type ReelHumanPresence = typeof REEL_HUMAN_PRESENCE[number];

export const REEL_RENDER_TIERS = ["draft", "final"] as const;
export type ReelRenderTier = typeof REEL_RENDER_TIERS[number];

export const MIN_REEL_STORYBOARD_SHOTS = 4;
export const MAX_REEL_STORYBOARD_SHOTS = 12;

const SOURCE_TABLE_SET = new Set<string>(REEL_SOURCE_TABLES);
const SHOT_CLASS_SET = new Set<string>(REEL_SHOT_CLASSES);
const HUMAN_PRESENCE_SET = new Set<string>(REEL_HUMAN_PRESENCE);
const RENDER_TIER_SET = new Set<string>(REEL_RENDER_TIERS);

export type ContractResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface ReelProjectSourceIdentity {
  clientId: string;
  sourceTable: string;
  sourceRowId: string;
}

export interface ReelProductionBriefIdentity {
  id: string;
  client_id: string;
  source_table: string;
  source_row_id: string;
  asset_format: string;
  status: string;
}

export function validateBoundReelBrief(
  source: ReelProjectSourceIdentity,
  brief: ReelProductionBriefIdentity,
): ContractResult<ReelProductionBriefIdentity> {
  if (!SOURCE_TABLE_SET.has(source.sourceTable)) {
    return { ok: false, error: "source_table must be organic_master or ads_master." };
  }
  if (brief.client_id !== source.clientId) {
    return { ok: false, error: "Production brief does not belong to client_id." };
  }
  if (brief.status !== "approved") {
    return { ok: false, error: "Production brief must be approved before creating or generating a Reel Studio project." };
  }
  if (brief.asset_format !== "reel_video") {
    return { ok: false, error: "Production brief must have asset_format reel_video." };
  }
  if (brief.source_table !== source.sourceTable) {
    return { ok: false, error: "Production brief source_table does not match the Reel Studio source." };
  }
  if (brief.source_row_id !== source.sourceRowId) {
    return { ok: false, error: "Production brief source_row_id does not match the Reel Studio source." };
  }
  return { ok: true, value: brief };
}

export function selectUnambiguousLegacyReelBrief(
  source: ReelProjectSourceIdentity,
  candidates: ReelProductionBriefIdentity[],
): ContractResult<ReelProductionBriefIdentity> {
  const valid = candidates.filter((candidate) => validateBoundReelBrief(source, candidate).ok);
  if (valid.length === 0) {
    return { ok: false, error: "No approved reel_video production brief exists for this project's exact source." };
  }
  if (valid.length > 1) {
    return { ok: false, error: "Multiple approved reel_video production briefs match this project; bind one explicitly before generating." };
  }
  return { ok: true, value: valid[0] };
}

export interface PendingReelShot {
  shot_number: number;
  beat_description: string;
  compiled_prompt: string;
  shot_class: ReelShotClass;
  human_presence: ReelHumanPresence;
  render_tier: ReelRenderTier;
  motion_type: string | null;
  motion_strength: number | null;
}

interface ShotValidationOptions {
  requireExplicitFields?: boolean;
  expectedShotNumber?: number;
  expectedRenderTier?: ReelRenderTier;
  requireMotionUnselected?: boolean;
}

const EXPLICIT_SHOT_FIELDS: Array<keyof PendingReelShot> = [
  "shot_number",
  "beat_description",
  "compiled_prompt",
  "shot_class",
  "human_presence",
  "render_tier",
  "motion_type",
  "motion_strength",
];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validatePendingReelShot(
  value: unknown,
  options: ShotValidationOptions = {},
): ContractResult<PendingReelShot> {
  const input = record(value);
  if (!input) return { ok: false, error: "Shot must be a JSON object." };

  if (options.requireExplicitFields) {
    const missing = EXPLICIT_SHOT_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(input, field));
    if (missing.length) return { ok: false, error: `Shot is missing required field(s): ${missing.join(", ")}.` };
  }

  const shotNumber = input.shot_number;
  if (!Number.isInteger(shotNumber) || Number(shotNumber) <= 0) {
    return { ok: false, error: "shot_number must be a positive integer." };
  }
  if (options.expectedShotNumber !== undefined && shotNumber !== options.expectedShotNumber) {
    return { ok: false, error: `shot_number must remain ${options.expectedShotNumber}.` };
  }

  const beatDescription = nonEmptyString(input.beat_description);
  if (!beatDescription) return { ok: false, error: "beat_description must be a non-empty string." };

  const compiledPrompt = nonEmptyString(input.compiled_prompt);
  if (!compiledPrompt) return { ok: false, error: "compiled_prompt must be a non-empty string." };

  const shotClass = nonEmptyString(input.shot_class);
  if (!SHOT_CLASS_SET.has(shotClass)) {
    return { ok: false, error: "shot_class must be metaphor, atmosphere, or abstract." };
  }

  const humanPresence = nonEmptyString(input.human_presence);
  if (!HUMAN_PRESENCE_SET.has(humanPresence)) {
    return { ok: false, error: "human_presence must be none or hands_only." };
  }

  const renderTier = nonEmptyString(input.render_tier);
  if (!RENDER_TIER_SET.has(renderTier)) {
    return { ok: false, error: "render_tier must be draft or final." };
  }
  if (options.expectedRenderTier !== undefined && renderTier !== options.expectedRenderTier) {
    return { ok: false, error: `render_tier must remain ${options.expectedRenderTier}.` };
  }

  const rawMotionType = input.motion_type;
  const motionType = rawMotionType === null || rawMotionType === undefined
    ? null
    : nonEmptyString(rawMotionType);
  if (rawMotionType !== null && rawMotionType !== undefined && !motionType) {
    return { ok: false, error: "motion_type must be null or a non-empty provider motion identifier." };
  }

  const rawMotionStrength = input.motion_strength;
  const motionStrength = rawMotionStrength === null || rawMotionStrength === undefined
    ? null
    : rawMotionStrength;
  if (motionType === null && motionStrength !== null) {
    return { ok: false, error: "motion_strength must be null until motion_type is selected." };
  }
  if (
    motionType !== null &&
    (typeof motionStrength !== "number" || !Number.isFinite(motionStrength) || motionStrength < 0 || motionStrength > 1)
  ) {
    return { ok: false, error: "motion_strength must be between 0 and 1 when motion_type is selected." };
  }
  if (options.requireMotionUnselected && (motionType !== null || motionStrength !== null)) {
    return { ok: false, error: "AI storyboard output must leave motion_type and motion_strength null for provider-backed selection." };
  }

  return {
    ok: true,
    value: {
      shot_number: Number(shotNumber),
      beat_description: beatDescription,
      compiled_prompt: compiledPrompt,
      shot_class: shotClass as ReelShotClass,
      human_presence: humanPresence as ReelHumanPresence,
      render_tier: renderTier as ReelRenderTier,
      motion_type: motionType,
      motion_strength: motionStrength as number | null,
    },
  };
}

export function extractReelJson(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    // Try the bounded recovery forms below.
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // Try the outer object below.
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Fall through to a null parse result.
    }
  }
  return null;
}

export function validateReelStoryboardOutput(
  parsed: unknown,
): ContractResult<PendingReelShot[]> {
  const output = record(parsed);
  const rawShots = output?.shots;
  if (!Array.isArray(rawShots)) {
    return { ok: false, error: 'Response must be JSON of the form {"shots": [...]}.' };
  }
  if (rawShots.length < MIN_REEL_STORYBOARD_SHOTS || rawShots.length > MAX_REEL_STORYBOARD_SHOTS) {
    return {
      ok: false,
      error: `Storyboard must contain ${MIN_REEL_STORYBOARD_SHOTS}-${MAX_REEL_STORYBOARD_SHOTS} shots; received ${rawShots.length}.`,
    };
  }

  const shots: PendingReelShot[] = [];
  const numbers = new Set<number>();
  for (const [index, rawShot] of rawShots.entries()) {
    const validated = validatePendingReelShot(rawShot, {
      requireExplicitFields: true,
      expectedRenderTier: "draft",
      requireMotionUnselected: true,
    });
    if (!validated.ok) return { ok: false, error: `Shot ${index + 1}: ${validated.error}` };
    if (numbers.has(validated.value.shot_number)) {
      return { ok: false, error: `Duplicate shot_number ${validated.value.shot_number}.` };
    }
    if (validated.value.shot_number !== index + 1) {
      return { ok: false, error: `Storyboard sequence must be contiguous and ordered 1..N; item ${index + 1} uses shot_number ${validated.value.shot_number}.` };
    }
    numbers.add(validated.value.shot_number);
    shots.push(validated.value);
  }
  return { ok: true, value: shots };
}

export function validateRegeneratedReelShotOutput(
  parsed: unknown,
  expectedShotNumber: number,
  expectedRenderTier: ReelRenderTier,
): ContractResult<PendingReelShot> {
  const output = record(parsed);
  if (!output || !Object.prototype.hasOwnProperty.call(output, "shot")) {
    return { ok: false, error: 'Response must be JSON of the form {"shot": {...}}.' };
  }
  const validated = validatePendingReelShot(output.shot, {
    requireExplicitFields: true,
    expectedShotNumber,
    expectedRenderTier,
    requireMotionUnselected: true,
  });
  return validated.ok ? validated : { ok: false, error: `Regenerated shot: ${validated.error}` };
}

export function regeneratedPlanningPatch(shot: PendingReelShot): Pick<
  PendingReelShot,
  "beat_description" | "compiled_prompt" | "shot_class" | "human_presence" | "render_tier"
> {
  return {
    beat_description: shot.beat_description,
    compiled_prompt: shot.compiled_prompt,
    shot_class: shot.shot_class,
    human_presence: shot.human_presence,
    render_tier: shot.render_tier,
  };
}
