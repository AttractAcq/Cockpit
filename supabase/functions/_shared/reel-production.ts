// Programme Stage J — Reel Studio Completion: production-strategy selection,
// the render-mode capability registry, and the composition-contract
// (timeline/voice/audio/captions/CTA) domain contract.
//
// Deliberately does not touch or duplicate the existing, live Phase 3
// final-Reel system (_shared/final-reel-contract.ts, video_project_deliverables,
// resolveReelPublicationEligibility) — that remains the sole authority for
// "what is the publishable final Reel." This module only decides HOW a
// project is produced and assembles the contract an external editor (or,
// eventually, an automated renderer) consumes.
//
// All pure/testable — no database or network dependency.

// ---------------------------------------------------------------------------
// Production strategy selection
// ---------------------------------------------------------------------------

export type ProductionStrategy =
  | "proof_editorial" | "motion_explainer" | "cinematic_ai" | "footage" | "hybrid";

export type AutomationPolicy = "ai_first" | "human_first" | "hybrid_allowed";
export type QualityRequirement = "draft" | "standard" | "premium";

export interface StrategySelectionInput {
  proofAvailable: boolean;
  realFootageAvailable: boolean;
  automationPolicy: AutomationPolicy;
  qualityRequirement: QualityRequirement;
}

export interface StrategySelectionResult {
  strategy: ProductionStrategy;
  reason: string;
}

/**
 * Deterministic strategy selection from the Brief's own self-declared
 * signals (proof available, real footage available), the client's
 * automation policy, and the required quality bar. Never a model call —
 * this is a decision table, so the same inputs always produce the same
 * strategy and an auditable reason.
 *
 * Precedence, in order:
 *  1. A client that prefers human-first production, with real footage on
 *     hand, gets the Founder/Client Footage strategy — authentic footage is
 *     used whenever policy prefers it and it exists.
 *  2. Both real evidence AND real footage available -> Hybrid (real
 *     evidence + footage, selective AI inserts only where needed).
 *  3. Proof available but no footage -> Proof Editorial (screenshots,
 *     reviews, documents, project footage, animated evidence).
 *  4. No proof, no footage, but a premium quality bar -> Motion Explainer
 *     (diagrams/kinetic typography carry the message credibly without proof).
 *  5. Otherwise -> Cinematic AI, the fallback when nothing real is on hand.
 */
export function selectReelProductionStrategy(input: StrategySelectionInput): StrategySelectionResult {
  const { proofAvailable, realFootageAvailable, automationPolicy, qualityRequirement } = input;

  if (automationPolicy === "human_first" && realFootageAvailable) {
    return { strategy: "footage", reason: "Client automation policy prefers human-first production and real footage is available." };
  }
  if (proofAvailable && realFootageAvailable) {
    return { strategy: "hybrid", reason: "Both verified proof and real footage are available; combine real evidence and footage with selective AI inserts." };
  }
  if (proofAvailable) {
    return { strategy: "proof_editorial", reason: "Verified proof is available with no real footage; build the Reel from evidence artifacts." };
  }
  if (qualityRequirement === "premium") {
    return { strategy: "motion_explainer", reason: "No proof or footage is available, but the quality bar is premium; explain the message with diagrams and kinetic typography rather than fabricate evidence." };
  }
  return { strategy: "cinematic_ai", reason: "No proof or footage is available; fall back to AI-generated stills and image-to-video." };
}

// ---------------------------------------------------------------------------
// Render-mode capability registry
// ---------------------------------------------------------------------------

export type RenderMode = "automated_template" | "provider_render" | "human_editor_handoff" | "manual_upload";

export interface RenderCapabilityResult {
  supported: boolean;
  reason: string | null;
}

/**
 * Fails cleanly, never throws, for a render mode with no engine behind it
 * yet. `human_editor_handoff` and `manual_upload` route onto the existing,
 * live Phase 3 final-Reel upload/review system — see
 * _shared/final-reel-contract.ts. `automated_template` and `provider_render`
 * are declared as part of the contract (Stage J requires a render adapter
 * that names all four modes) but have no implementation: there is no
 * template-compositing engine or video-compositing provider integrated in
 * this codebase, and Higgsfield produces individual shot clips, not a
 * composited final Reel.
 */
export function checkRenderCapability(mode: RenderMode): RenderCapabilityResult {
  if (mode === "human_editor_handoff" || mode === "manual_upload") {
    return { supported: true, reason: null };
  }
  if (mode === "automated_template") {
    return { supported: false, reason: "No automated template-rendering engine is integrated yet." };
  }
  return { supported: false, reason: "No video-compositing render provider is integrated yet; Higgsfield produces individual shot clips only." };
}

// ---------------------------------------------------------------------------
// Composition contract
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  order: number;
  source: "shot" | "intro" | "outro";
  shot_id: string | null;
  duration_sec: number;
  transition: string | null;
}

/** Strict validation, same "reject the whole thing on any malformed entry" pattern as Stage I's asset plan. */
export function validateTimeline(raw: unknown): TimelineEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: TimelineEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.order !== "number" || row.order <= 0) return null;
    if (row.source !== "shot" && row.source !== "intro" && row.source !== "outro") return null;
    if (row.source === "shot" && typeof row.shot_id !== "string") return null;
    if (row.source !== "shot" && row.shot_id !== null && row.shot_id !== undefined) return null;
    if (typeof row.duration_sec !== "number" || row.duration_sec <= 0) return null;
    if (row.transition !== null && row.transition !== undefined && typeof row.transition !== "string") return null;
    entries.push({
      order: row.order,
      source: row.source,
      shot_id: row.source === "shot" ? (row.shot_id as string) : null,
      duration_sec: row.duration_sec,
      transition: (row.transition as string | null) ?? null,
    });
  }
  return entries;
}

export function computeTimelineDurationSec(timeline: TimelineEntry[]): number {
  return timeline.reduce((sum, entry) => sum + entry.duration_sec, 0);
}

/** Loose tolerance: shot durations from Higgsfield generation are approximate, not frame-exact. */
export function checkDurationAlignment(timeline: TimelineEntry[], targetDurationSec: number, toleranceSec = 4): { aligned: boolean; actualSec: number; detail: string } {
  const actual = computeTimelineDurationSec(timeline);
  const aligned = Math.abs(actual - targetDurationSec) <= toleranceSec;
  return {
    aligned,
    actualSec: actual,
    detail: aligned
      ? `Timeline duration ${actual}s is within ${toleranceSec}s of the target ${targetDurationSec}s.`
      : `Timeline duration ${actual}s differs from the target ${targetDurationSec}s by more than ${toleranceSec}s.`,
  };
}

export type VoiceSource = "real_voice" | "consent_voice_clone" | "ai_narrator";

export interface VoiceTrack {
  source: VoiceSource;
  consent_confirmed: boolean;
  script: string | null;
}

/** A consent-based voice clone must have explicit, recorded consent — never assumed. */
export function validateVoiceTrack(raw: unknown): VoiceTrack | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (row.source !== "real_voice" && row.source !== "consent_voice_clone" && row.source !== "ai_narrator") return null;
  if (row.source === "consent_voice_clone" && row.consent_confirmed !== true) return null;
  if (row.script !== null && row.script !== undefined && typeof row.script !== "string") return null;
  return {
    source: row.source,
    consent_confirmed: row.consent_confirmed === true,
    script: (row.script as string | null) ?? null,
  };
}

export type LoudnessStandard = "EBU_R128" | "ATSC_A85";

export interface AudioSpec {
  music_ref: string | null;
  sfx_refs: string[];
  loudness_standard: LoudnessStandard;
}

export function validateAudioSpec(raw: unknown): AudioSpec | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (row.loudness_standard !== "EBU_R128" && row.loudness_standard !== "ATSC_A85") return null;
  if (row.music_ref !== null && row.music_ref !== undefined && typeof row.music_ref !== "string") return null;
  const sfxRaw = row.sfx_refs;
  if (sfxRaw !== undefined && (!Array.isArray(sfxRaw) || sfxRaw.some((r) => typeof r !== "string"))) return null;
  return {
    music_ref: (row.music_ref as string | null) ?? null,
    sfx_refs: Array.isArray(sfxRaw) ? (sfxRaw as string[]) : [],
    loudness_standard: row.loudness_standard,
  };
}

export type CaptionTimingSource = "manual" | "auto_generated" | "none";

export interface CaptionSpec {
  enabled: boolean;
  timing_source: CaptionTimingSource;
}

export function validateCaptionSpec(raw: unknown): CaptionSpec | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.enabled !== "boolean") return null;
  if (row.timing_source !== "manual" && row.timing_source !== "auto_generated" && row.timing_source !== "none") return null;
  if (row.enabled && row.timing_source === "none") return null;
  return { enabled: row.enabled, timing_source: row.timing_source };
}

// ---------------------------------------------------------------------------
// Strategy integrity checks — the Stage J test list, made concrete and
// checkable against the real schema rather than left as prose.
// ---------------------------------------------------------------------------

export interface StrategyIntegrityResult {
  ok: boolean;
  detail: string;
  offendingShotNumbers: number[];
}

/**
 * "Proof Editorial does not fabricate proof": every shot in a Proof
 * Editorial project must be a real source asset, never an AI-generated
 * still standing in for evidence.
 */
export function checkProofEditorialIntegrity(
  strategy: ProductionStrategy,
  shots: { shot_number: number; shot_source_kind: "ai_generated" | "source_asset" }[],
): StrategyIntegrityResult {
  if (strategy !== "proof_editorial") return { ok: true, detail: "Not a Proof Editorial project.", offendingShotNumbers: [] };
  const offending = shots.filter((s) => s.shot_source_kind !== "source_asset").map((s) => s.shot_number);
  return {
    ok: offending.length === 0,
    detail: offending.length === 0
      ? "Every shot is a real source asset."
      : `${offending.length} shot(s) are AI-generated, not real evidence, in a Proof Editorial project.`,
    offendingShotNumbers: offending,
  };
}

/**
 * "Motion Explainer preserves exact statistics and text": every required
 * verbatim claim must appear, unmodified, in at least one shot's
 * beat_description. Deliberately exact-match, not fuzzy — a paraphrased
 * statistic is exactly the failure mode this guards against.
 */
export function checkMotionExplainerTextPreservation(
  strategy: ProductionStrategy,
  shots: { shot_number: number; beat_description: string }[],
  requiredExactTexts: string[],
): StrategyIntegrityResult {
  if (strategy !== "motion_explainer") return { ok: true, detail: "Not a Motion Explainer project.", offendingShotNumbers: [] };
  const combined = shots.map((s) => s.beat_description).join("\n");
  const missing = requiredExactTexts.filter((text) => !combined.includes(text));
  return {
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "Every required statistic/text appears verbatim in the storyboard."
      : `${missing.length} required exact text(s) do not appear verbatim in any shot: ${missing.join(" | ")}`,
    offendingShotNumbers: [],
  };
}

/** "Cinematic AI retains continuity": a project-level continuity plan must exist before any shot generates. */
export function checkCinematicAiContinuity(strategy: ProductionStrategy, hasContinuityPlan: boolean): StrategyIntegrityResult {
  if (strategy !== "cinematic_ai" && strategy !== "hybrid") return { ok: true, detail: "Continuity plan not required for this strategy.", offendingShotNumbers: [] };
  return {
    ok: hasContinuityPlan,
    detail: hasContinuityPlan ? "Continuity plan is present." : "No continuity plan exists; AI-generated shots have no shared visual bible.",
    offendingShotNumbers: [],
  };
}

// ---------------------------------------------------------------------------
// Shot source-asset upload path (mirrors final-reel-contract.ts's
// server-built-path pattern: the browser never chooses bucket or path).
// ---------------------------------------------------------------------------

export const SHOT_SOURCE_ASSET_BUCKET = "video-assets";

/** Keeps the real extension (images, PDFs, video), sanitises everything else. */
export function safeShotSourceAssetFilename(filename: string): string {
  const base = (filename ?? "").split(/[\\/]/).pop() ?? "";
  const match = base.match(/^(.*?)\.([a-zA-Z0-9]{1,8})$/);
  const stem = (match ? match[1] : base) || "source";
  const extension = (match ? match[2] : "bin").toLowerCase();
  const cleanedStem = stem
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return `${cleanedStem || "source"}.${extension}`;
}

export function shotSourceAssetStoragePath(input: { clientId: string; videoProjectId: string; shotId: string; safeFilename: string }): string {
  return `${input.clientId}/${input.videoProjectId}/shots/${input.shotId}/${input.safeFilename}`;
}

export function shotSourceAssetPathBelongsToShot(path: string, clientId: string, videoProjectId: string, shotId: string): boolean {
  return path.startsWith(`${clientId}/${videoProjectId}/shots/${shotId}/`);
}

/**
 * "Human-footage path preserves source rights": every real-footage source
 * asset must carry an operator-recorded provenance/rights note. Never
 * inferred — an empty note is a fail, not a pass.
 */
export function checkFootageSourceRightsPreserved(
  strategy: ProductionStrategy,
  shots: { shot_number: number; shot_source_kind: "ai_generated" | "source_asset"; source_description: string | null }[],
): StrategyIntegrityResult {
  if (strategy !== "footage" && strategy !== "hybrid") return { ok: true, detail: "Source-rights note not required for this strategy.", offendingShotNumbers: [] };
  const sourceShots = shots.filter((s) => s.shot_source_kind === "source_asset");
  const offending = sourceShots.filter((s) => !s.source_description || s.source_description.trim().length === 0).map((s) => s.shot_number);
  return {
    ok: offending.length === 0,
    detail: offending.length === 0
      ? "Every source-asset shot carries a rights/provenance note."
      : `${offending.length} source-asset shot(s) have no recorded rights/provenance note.`,
    offendingShotNumbers: offending,
  };
}
