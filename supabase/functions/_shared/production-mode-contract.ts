// Reel Studio Phase 2, Workstream A: the authoritative production-mode contract.
//
// `client_production_briefs.production_mode` is a nullable text column whose CHECK
// constraint accepts 'human' | 'ai' | 'hybrid' (the 'hybrid' value is added by the
// Phase 2 migration; the column itself is unchanged). This module is the single
// place that decides what a mode means, which modes a format supports, whether a
// transition is legal, and whether a stored brief is internally contradictory.
//
// Imported by Edge Functions AND by the frontend (same relative-import pattern the
// UI already uses for production-brief-contract.ts) so one decision is rendered in
// both places and the backend stays authoritative.

export const PRODUCTION_MODES = ["human", "ai", "hybrid"] as const;
export type ProductionMode = typeof PRODUCTION_MODES[number];

const PRODUCTION_MODE_SET = new Set<string>(PRODUCTION_MODES);

export function isProductionMode(value: unknown): value is ProductionMode {
  return typeof value === "string" && PRODUCTION_MODE_SET.has(value);
}

export const PRODUCTION_MODE_LABEL: Record<ProductionMode, string> = {
  human: "Human production",
  ai: "AI production",
  hybrid: "Hybrid production (AI visuals, human finishing)",
};

/**
 * Where the AI half of a mode actually executes. `reel_studio` briefs never run
 * through the old synchronous AI-image pipeline (that gate is deliberately
 * untouched); `ai_image_pipeline` briefs never enter Reel Studio.
 */
export type AiProductionPath = "ai_image_pipeline" | "reel_studio";

export interface ProductionModeContract {
  /** Modes an operator may select for this format. */
  supportedModes: readonly ProductionMode[];
  /** Mode written at generation time when the operator does not choose one. */
  defaultMode: ProductionMode | null;
  /** Execution path used by the `ai` half of `ai`/`hybrid`. Null when AI is impossible. */
  aiPath: AiProductionPath | null;
}

export interface BriefModeIdentity {
  asset_format: string;
  production_mode: string | null;
  production_status?: string | null;
  status?: string | null;
  content_md?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ProductionModeResolution {
  /** The persisted mode, or null when the brief has never had one assigned. */
  mode: ProductionMode | null;
  /** True when the persisted value is not a recognised mode (legacy/unknown text). */
  unrecognised: boolean;
  /** True when the persisted mode contradicts the brief's own markdown/metadata. */
  contradictory: boolean;
  /** True when the operator must explicitly confirm a mode before AI use. */
  requiresConfirmation: boolean;
  reason: string | null;
}

/** Modes under which Reel Studio is a legitimate production path. */
export const REEL_STUDIO_MODES: readonly ProductionMode[] = ["ai", "hybrid"];

export function allowsReelStudio(mode: ProductionMode | null): boolean {
  return mode !== null && (REEL_STUDIO_MODES as readonly string[]).includes(mode);
}

/**
 * A brief whose markdown still carries the old human-only instruction block, or
 * whose metadata still asserts `human_only: true`, is textually human-only. When
 * that disagrees with an AI/hybrid mode the brief is contradictory and must not be
 * used for AI production until the operator resolves it deliberately.
 */
export function briefTextIsHumanOnly(brief: BriefModeIdentity): boolean {
  const metadata = brief.metadata ?? {};
  if (metadata.human_only === true) return true;
  const markdown = brief.content_md ?? "";
  return /^#{1,4}\s+human production only\s*$/im.test(markdown);
}

export function resolveBriefProductionMode(brief: BriefModeIdentity): ProductionModeResolution {
  const raw = brief.production_mode;
  if (raw === null || raw === undefined || raw === "") {
    return {
      mode: null,
      unrecognised: false,
      contradictory: false,
      requiresConfirmation: true,
      reason: "This brief has no production mode assigned yet. Choose Human, AI, or Hybrid before producing it.",
    };
  }
  if (!isProductionMode(raw)) {
    return {
      mode: null,
      unrecognised: true,
      contradictory: false,
      requiresConfirmation: true,
      reason: `This brief carries an unrecognised production mode ("${raw}"). Re-select a supported mode before producing it.`,
    };
  }
  const humanText = briefTextIsHumanOnly(brief);
  const contradictory = humanText && raw !== "human";
  return {
    mode: raw,
    unrecognised: false,
    contradictory,
    requiresConfirmation: contradictory,
    reason: contradictory
      ? "This brief is marked for AI production but its instructions still say human production only. Regenerate it in the selected mode, or confirm the mode change explicitly."
      : null,
  };
}

export interface ModeTransitionInput {
  brief: BriefModeIdentity;
  targetMode: ProductionMode;
  supportedModes: readonly ProductionMode[];
  /** Operator explicitly acknowledged changing an already-approved brief. */
  acknowledgedApprovedChange?: boolean;
  /** Operator explicitly acknowledged that the brief text still reads human-only. */
  acknowledgedTextConflict?: boolean;
}

export type ModeTransitionResult =
  | { ok: true; unchanged: boolean; textConflict: boolean }
  | { ok: false; code: string; error: string };

/**
 * Server-side validation for a deliberate production-mode change. Approved
 * authority is never silently overwritten: changing the mode of an approved brief
 * requires an explicit acknowledgement, and so does adopting an AI mode while the
 * brief text still reads human-only.
 */
export function validateProductionModeTransition(input: ModeTransitionInput): ModeTransitionResult {
  const { brief, targetMode } = input;
  if (!isProductionMode(targetMode)) {
    return { ok: false, code: "MODE_INVALID", error: "production_mode must be human, ai, or hybrid." };
  }
  if (!input.supportedModes.includes(targetMode)) {
    return {
      ok: false,
      code: "MODE_UNSUPPORTED_FOR_FORMAT",
      error: `${targetMode} production is not supported for ${brief.asset_format} briefs.`,
    };
  }
  const producedStates = new Set(["producing", "produced"]);
  if (producedStates.has(brief.production_status ?? "")) {
    return {
      ok: false,
      code: "MODE_LOCKED_BY_PRODUCTION",
      error: `This brief is already ${brief.production_status}. Its production mode can no longer be changed.`,
    };
  }
  const current = isProductionMode(brief.production_mode) ? brief.production_mode : null;
  if (current === targetMode) return { ok: true, unchanged: true, textConflict: false };

  if (brief.status === "approved" && current !== null && !input.acknowledgedApprovedChange) {
    return {
      ok: false,
      code: "MODE_APPROVED_CHANGE_UNCONFIRMED",
      error: `This approved brief is currently ${current} production. Confirm the change explicitly before switching it to ${targetMode}.`,
    };
  }

  const textConflict = briefTextIsHumanOnly(brief) && targetMode !== "human";
  if (textConflict && !input.acknowledgedTextConflict) {
    return {
      ok: false,
      code: "MODE_TEXT_CONFLICT_UNCONFIRMED",
      error: "This brief's instructions still say human production only. Regenerate it in the new mode, or confirm that you accept the conflicting text.",
    };
  }
  return { ok: true, unchanged: false, textConflict };
}
