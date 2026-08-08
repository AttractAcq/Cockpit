// Programme Stage G — shared, pure/testable logic for slot-specific
// Opportunity-to-Slot matching and proposal-edit validation.
//
// Kept separate from the Edge Function entrypoints so the matching engine
// and edit-action validators can be unit-tested without a live database.

export interface MatchableOpportunity {
  id: string;
  origin: "manual" | "proof" | "research" | "performance";
  audience: string | null;
  funnel_stage: string | null;
  candidate_formats: string[];
  candidate_channels: string[];
  visual_potential: number | null;
  production_requirements: string | null;
  expires_at: string | null;
  duplicate_of_opportunity_id: string | null;
  /** Latest proof_strength dimension from content_opportunity_scores, if scored. */
  proof_strength: number | null;
}

export interface MatchableSlot {
  platform: string | null;
  objective: string | null;
  funnel_stage: string | null;
  audience_stage: string | null;
  preferred_source_type: "manual" | "proof" | "research" | "performance" | null;
  required_proof_strength: "none" | "soft" | "verified" | null;
  scheduled_for: string;
}

export interface MatchableRequirement {
  asset_format: string;
  channel: string;
}

export interface MatchDimensionScores {
  format_suitability: number;
  origin_preference: number;
  funnel_stage_match: number;
  audience_match: number;
  proof_requirement: number;
  timeliness: number;
  production_readiness: number;
}

export const MATCH_DIMENSION_WEIGHTS: Record<keyof MatchDimensionScores, number> = {
  format_suitability: 25,
  origin_preference: 15,
  funnel_stage_match: 15,
  audience_match: 15,
  proof_requirement: 15,
  timeliness: 10,
  production_readiness: 5,
};

function normalise(text: string): string {
  return text.toLowerCase().trim();
}

function scoreFormatSuitability(opp: MatchableOpportunity, req: MatchableRequirement): number {
  const formats = opp.candidate_formats.map(normalise);
  const channels = opp.candidate_channels.map(normalise);
  const formatHit = formats.length === 0 || formats.includes(normalise(req.asset_format));
  const channelHit = channels.length === 0 || channels.includes(normalise(req.channel));
  if (formatHit && channelHit) return 100;
  if (formatHit || channelHit) return 50;
  return 0;
}

function scoreOriginPreference(opp: MatchableOpportunity, slot: MatchableSlot): number {
  if (!slot.preferred_source_type) return 60; // no preference declared — neutral, not a penalty
  return opp.origin === slot.preferred_source_type ? 100 : 30;
}

function scoreFunnelStageMatch(opp: MatchableOpportunity, slot: MatchableSlot): number {
  if (!slot.funnel_stage) return 60;
  if (!opp.funnel_stage) return 40;
  return normalise(opp.funnel_stage) === normalise(slot.funnel_stage) ? 100 : 20;
}

function scoreAudienceMatch(opp: MatchableOpportunity, slot: MatchableSlot): number {
  if (!slot.audience_stage) return 60;
  if (!opp.audience) return 40;
  const a = normalise(opp.audience);
  const b = normalise(slot.audience_stage);
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 70;
  return 30;
}

function scoreProofRequirement(opp: MatchableOpportunity, slot: MatchableSlot): number {
  const required = slot.required_proof_strength ?? "none";
  if (required === "none") return 100;
  const strength = opp.proof_strength ?? 0;
  if (required === "soft") return strength >= 40 ? 100 : strength >= 20 ? 60 : 20;
  // "verified"
  return strength >= 70 ? 100 : strength >= 50 ? 50 : 0;
}

function scoreTimeliness(opp: MatchableOpportunity, slot: MatchableSlot): number {
  if (!opp.expires_at) return 70;
  const expiresAt = Date.parse(opp.expires_at);
  const slotDate = Date.parse(slot.scheduled_for);
  if (Number.isNaN(expiresAt) || Number.isNaN(slotDate)) return 70;
  if (expiresAt < slotDate) return 0; // would already be expired by the slot's date
  const daysOfSlack = (expiresAt - slotDate) / (1000 * 60 * 60 * 24);
  if (daysOfSlack <= 3) return 60; // cutting it close, still usable
  return 100;
}

function scoreProductionReadiness(opp: MatchableOpportunity): number {
  let score = 50;
  if (opp.visual_potential !== null) score += opp.visual_potential * 10; // 1-5 -> +10..+50
  if (opp.production_requirements) score -= 10; // known extra requirements to plan around
  return Math.max(0, Math.min(100, score));
}

export interface MatchResult {
  eligible: boolean;
  ineligibleReason: string | null;
  overallScore: number;
  dimensions: MatchDimensionScores;
}

/**
 * Computes an Opportunity-to-Slot match score. A duplicate Opportunity
 * (already flagged by Stage F's dedup check) is never matchable — this is
 * the "recent-content saturation" dimension the stage prompt lists, applied
 * as a hard exclusion rather than a soft penalty, since a flagged duplicate
 * has no legitimate independent placement.
 */
export function computeMatch(
  opportunity: MatchableOpportunity,
  slot: MatchableSlot,
  requirement: MatchableRequirement,
): MatchResult {
  if (opportunity.duplicate_of_opportunity_id) {
    return {
      eligible: false,
      ineligibleReason: "duplicate_recent_content",
      overallScore: 0,
      dimensions: {
        format_suitability: 0, origin_preference: 0, funnel_stage_match: 0,
        audience_match: 0, proof_requirement: 0, timeliness: 0, production_readiness: 0,
      },
    };
  }

  const dimensions: MatchDimensionScores = {
    format_suitability: scoreFormatSuitability(opportunity, requirement),
    origin_preference: scoreOriginPreference(opportunity, slot),
    funnel_stage_match: scoreFunnelStageMatch(opportunity, slot),
    audience_match: scoreAudienceMatch(opportunity, slot),
    proof_requirement: scoreProofRequirement(opportunity, slot),
    timeliness: scoreTimeliness(opportunity, slot),
    production_readiness: scoreProductionReadiness(opportunity),
  };

  let weightedSum = 0;
  let totalWeight = 0;
  for (const key of Object.keys(dimensions) as (keyof MatchDimensionScores)[]) {
    weightedSum += dimensions[key] * MATCH_DIMENSION_WEIGHTS[key];
    totalWeight += MATCH_DIMENSION_WEIGHTS[key];
  }
  const overallScore = Math.round((weightedSum / totalWeight) * 1000) / 1000;

  return { eligible: true, ineligibleReason: null, overallScore, dimensions };
}

/** Builds a short, human-readable rationale from the dimension breakdown. */
export function buildMatchRationale(result: MatchResult): string {
  if (!result.eligible) return `Excluded: ${result.ineligibleReason}`;
  const sorted = (Object.entries(result.dimensions) as [keyof MatchDimensionScores, number][])
    .sort((a, b) => b[1] - a[1]);
  const [topKey, topVal] = sorted[0];
  const [bottomKey, bottomVal] = sorted[sorted.length - 1];
  return `Score ${result.overallScore.toFixed(1)}/100. Strongest: ${topKey} (${topVal}). Weakest: ${bottomKey} (${bottomVal}).`;
}

/**
 * Picks the best-matching, not-yet-claimed Opportunity for a Slot from a
 * candidate pool. Returns null if nothing clears MIN_MATCH_SCORE — an
 * unmatched Slot is left unassigned rather than forced.
 */
export const MIN_MATCH_SCORE = 40;

export function pickBestMatch(
  slot: MatchableSlot,
  requirement: MatchableRequirement,
  candidates: readonly MatchableOpportunity[],
  alreadyClaimed: ReadonlySet<string>,
): { opportunity: MatchableOpportunity; result: MatchResult } | null {
  let best: { opportunity: MatchableOpportunity; result: MatchResult } | null = null;
  for (const candidate of candidates) {
    if (alreadyClaimed.has(candidate.id)) continue;
    const result = computeMatch(candidate, slot, requirement);
    if (!result.eligible) continue;
    if (result.overallScore < MIN_MATCH_SCORE) continue;
    if (!best || result.overallScore > best.result.overallScore) {
      best = { opportunity: candidate, result };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Proposal-edit actions: move / swap / remove / restore.
// ---------------------------------------------------------------------------

export type ProposalEditAction = "move" | "swap" | "remove" | "restore";

export interface ProposalSlotState {
  id: string;
  calendar_slot_id: string;
  content_opportunity_id: string | null;
  original_content_opportunity_id: string | null;
}

export interface ProposalEditResult {
  ok: boolean;
  code?: string;
  updates: Array<{ slotId: string; content_opportunity_id: string | null; placement_source: "manual" | "restored" | null; manually_edited: boolean }>;
}

/**
 * Pure validation + resulting-state computation for a proposal edit. The
 * caller (Edge Function) is responsible for persisting `updates` and
 * enforcing cross-client / not-already-committed checks against live data —
 * this function only knows about the in-proposal slot state it's given.
 */
export function applyProposalEdit(
  action: ProposalEditAction,
  slots: readonly ProposalSlotState[],
  args: { fromSlotId?: string; toSlotId?: string; slotId?: string },
): ProposalEditResult {
  const byId = new Map(slots.map((s) => [s.id, s]));

  if (action === "move") {
    const from = args.fromSlotId ? byId.get(args.fromSlotId) : undefined;
    const to = args.toSlotId ? byId.get(args.toSlotId) : undefined;
    if (!from || !to) return { ok: false, code: "SLOT_NOT_IN_PROPOSAL", updates: [] };
    if (to.content_opportunity_id) return { ok: false, code: "TARGET_SLOT_OCCUPIED", updates: [] };
    if (!from.content_opportunity_id) return { ok: false, code: "SOURCE_SLOT_EMPTY", updates: [] };
    return {
      ok: true,
      updates: [
        { slotId: from.id, content_opportunity_id: null, placement_source: null, manually_edited: true },
        { slotId: to.id, content_opportunity_id: from.content_opportunity_id, placement_source: "manual", manually_edited: true },
      ],
    };
  }

  if (action === "swap") {
    const a = args.fromSlotId ? byId.get(args.fromSlotId) : undefined;
    const b = args.toSlotId ? byId.get(args.toSlotId) : undefined;
    if (!a || !b) return { ok: false, code: "SLOT_NOT_IN_PROPOSAL", updates: [] };
    if (!a.content_opportunity_id && !b.content_opportunity_id) {
      return { ok: false, code: "BOTH_SLOTS_EMPTY", updates: [] };
    }
    return {
      ok: true,
      updates: [
        { slotId: a.id, content_opportunity_id: b.content_opportunity_id, placement_source: b.content_opportunity_id ? "manual" : null, manually_edited: true },
        { slotId: b.id, content_opportunity_id: a.content_opportunity_id, placement_source: a.content_opportunity_id ? "manual" : null, manually_edited: true },
      ],
    };
  }

  if (action === "remove") {
    const target = args.slotId ? byId.get(args.slotId) : undefined;
    if (!target) return { ok: false, code: "SLOT_NOT_IN_PROPOSAL", updates: [] };
    if (!target.content_opportunity_id) return { ok: false, code: "SLOT_ALREADY_EMPTY", updates: [] };
    return {
      ok: true,
      updates: [{ slotId: target.id, content_opportunity_id: null, placement_source: null, manually_edited: true }],
    };
  }

  // action === "restore"
  const target = args.slotId ? byId.get(args.slotId) : undefined;
  if (!target) return { ok: false, code: "SLOT_NOT_IN_PROPOSAL", updates: [] };
  if (!target.original_content_opportunity_id) return { ok: false, code: "NO_ORIGINAL_ASSIGNMENT", updates: [] };
  if (target.content_opportunity_id === target.original_content_opportunity_id) {
    return { ok: false, code: "ALREADY_AT_ORIGINAL", updates: [] };
  }
  return {
    ok: true,
    updates: [{ slotId: target.id, content_opportunity_id: target.original_content_opportunity_id, placement_source: "restored", manually_edited: false }],
  };
}
