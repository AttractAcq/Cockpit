// Programme Stage F — shared, pure/testable logic for Content Opportunity
// generation, eligibility filtering, deduplication and scoring.
//
// Kept separate from the Edge Function entrypoints (generate-content-opportunities,
// score-content-opportunity, update-content-opportunity-status) so the decision
// logic can be unit-tested without a live database or network call, matching
// this repo's convention of thin production adapters over a testable core.
//
// The scoring rubric and status-transition table below are intentionally
// duplicated from src/types/content-opportunity-scoring.ts and
// src/types/content-spine.ts rather than cross-imported: the Supabase MCP
// deploy tool flattens bundle paths (documented in the Stage C/D/E outstanding
// work ledger for the same reason on the Ideation scoring rubric), so a
// "../../../src/types/..." import that resolves correctly for local
// typecheck/build does not survive that deploy path. Keep both copies in sync
// by hand until deploys go through `supabase functions deploy` from the repo,
// which does not flatten paths and would make the cross-import safe again.

export const OPPORTUNITY_SCORE_DIMENSIONS = [
  { key: "strategic_fit", label: "Strategic fit", weight: 20 },
  { key: "audience_relevance", label: "Audience relevance", weight: 15 },
  { key: "proof_strength", label: "Proof strength", weight: 15 },
  { key: "commercial_relevance", label: "Commercial relevance", weight: 15 },
  { key: "novelty", label: "Novelty", weight: 10 },
  { key: "timeliness", label: "Timeliness", weight: 10 },
  { key: "visual_potential", label: "Visual potential", weight: 10 },
  { key: "production_readiness", label: "Production readiness", weight: 5 },
] as const;

export type OpportunityScoreDimensionKey = typeof OPPORTUNITY_SCORE_DIMENSIONS[number]["key"];
export type OpportunityDimensionScores = Record<OpportunityScoreDimensionKey, number>;

export const OPPORTUNITY_SCORE_METHOD = "stage_f_rubric_v1";

/** The single place overall_score is computed — see content-opportunity-scoring.ts for the frontend twin. */
export function computeOverallScore(dimensions: OpportunityDimensionScores): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const dim of OPPORTUNITY_SCORE_DIMENSIONS) {
    const value = dimensions[dim.key];
    if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 100) {
      throw new Error(`Invalid ${dim.key} score: ${String(value)} (must be 0-100).`);
    }
    weightedSum += value * dim.weight;
    totalWeight += dim.weight;
  }
  return Math.round((weightedSum / totalWeight) * 1000) / 1000;
}

export type ContentOpportunityStatus =
  | "draft"
  | "needs_review"
  | "shortlisted"
  | "selected"
  | "scheduled"
  | "produced"
  | "rejected"
  | "expired";

/** Mirrors content-spine.ts CONTENT_OPPORTUNITY_TRANSITIONS exactly. */
export const CONTENT_OPPORTUNITY_TRANSITIONS: Readonly<
  Record<ContentOpportunityStatus, readonly ContentOpportunityStatus[]>
> = {
  draft: ["needs_review", "rejected", "expired"],
  needs_review: ["shortlisted", "rejected", "expired"],
  shortlisted: ["selected", "rejected", "expired"],
  selected: ["scheduled"],
  scheduled: ["produced"],
  produced: [],
  rejected: [],
  expired: [],
} as const;

export interface GeneratedOpportunityCandidate {
  title: string;
  angle: string | null;
  rationale: string | null;
  core_claim: string | null;
  hook_direction: string | null;
  audience: string | null;
  pain_or_objection: string | null;
  belief_before: string | null;
  belief_after: string | null;
  objective: string | null;
  offer_relationship: string | null;
  funnel_stage: string | null;
  candidate_formats: string[];
  candidate_channels: string[];
  cta_direction: string | null;
  visual_potential: number | null;
  production_requirements: string | null;
  /** True only if the model itself flagged this claim as unsupported by the source. */
  claim_unsupported: boolean;
}

/**
 * Extracts a JSON value from a model response: raw JSON first, then a
 * ```json fenced block, then the outermost [ ... ] slice. Returns null
 * rather than throwing so the caller can fail closed with a clear error.
 */
export function extractJsonArray(text: string): unknown[] | null {
  const tryParse = (candidate: string): unknown[] | null => {
    try {
      const value = JSON.parse(candidate);
      return Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  };
  const raw = tryParse(text.trim());
  if (raw) return raw;
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) {
    const parsed = tryParse(fenced[1]);
    if (parsed) return parsed;
  }
  const s = text.indexOf("[");
  const e = text.lastIndexOf("]");
  if (s >= 0 && e > s) {
    const parsed = tryParse(text.slice(s, e + 1));
    if (parsed) return parsed;
  }
  return null;
}

const REQUIRED_STRING_FIELDS = ["title"] as const;
const OPTIONAL_STRING_FIELDS = [
  "angle", "rationale", "core_claim", "hook_direction", "audience",
  "pain_or_objection", "belief_before", "belief_after", "objective",
  "offer_relationship", "funnel_stage", "cta_direction", "production_requirements",
] as const;

/** Strict validation — a malformed candidate is dropped, never coerced or guessed. */
export function validateGeneratedCandidate(raw: unknown): GeneratedOpportunityCandidate | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;

  for (const field of REQUIRED_STRING_FIELDS) {
    const v = row[field];
    if (typeof v !== "string" || v.trim().length === 0 || v.trim().length > 400) return null;
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    const v = row[field];
    if (v !== null && v !== undefined && typeof v !== "string") return null;
  }

  const formats = row.candidate_formats;
  const channels = row.candidate_channels;
  if (formats !== undefined && (!Array.isArray(formats) || !formats.every((f) => typeof f === "string"))) return null;
  if (channels !== undefined && (!Array.isArray(channels) || !channels.every((c) => typeof c === "string"))) return null;

  const visual = row.visual_potential;
  if (visual !== null && visual !== undefined) {
    if (typeof visual !== "number" || !Number.isInteger(visual) || visual < 1 || visual > 5) return null;
  }

  const unsupported = row.claim_unsupported;
  if (unsupported !== undefined && typeof unsupported !== "boolean") return null;

  const str = (key: (typeof OPTIONAL_STRING_FIELDS)[number]): string | null => {
    const v = row[key];
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  };

  return {
    title: (row.title as string).trim(),
    angle: str("angle"),
    rationale: str("rationale"),
    core_claim: str("core_claim"),
    hook_direction: str("hook_direction"),
    audience: str("audience"),
    pain_or_objection: str("pain_or_objection"),
    belief_before: str("belief_before"),
    belief_after: str("belief_after"),
    objective: str("objective"),
    offer_relationship: str("offer_relationship"),
    funnel_stage: str("funnel_stage"),
    candidate_formats: Array.isArray(formats) ? (formats as string[]) : [],
    candidate_channels: Array.isArray(channels) ? (channels as string[]) : [],
    cta_direction: str("cta_direction"),
    visual_potential: typeof visual === "number" ? visual : null,
    production_requirements: str("production_requirements"),
    claim_unsupported: unsupported === true,
  };
}

export interface EligibilityContext {
  /** Client status enum: prospect | active | paused | churned. */
  clientStatus: string;
  /** True if the primary source is a proof_item requiring verified proof. */
  requiresVerifiedProof: boolean;
  proofVerificationStatus: "unverified" | "verified" | "rejected" | null;
  /** True if the primary source is a proof_item requiring consent. */
  requiresConsent: boolean;
  consentStatus: string | null;
  hasUnresolvedBlockingConflict: boolean;
}

export interface EligibilityResult {
  status: "eligible" | "ineligible";
  reason: string | null;
}

/**
 * Deterministic, server-side eligibility filters. Only checks backed by a
 * real signal in the current data model are implemented — see the Stage F
 * implementation report for the filter types deliberately left unwired
 * (no underlying data yet: region, format availability, prohibited-claim
 * list, source expiry). Everything here fails closed: an ineligible
 * Opportunity must never reach scoring or selection.
 */
export function checkEligibility(
  candidate: GeneratedOpportunityCandidate,
  ctx: EligibilityContext,
): EligibilityResult {
  if (candidate.claim_unsupported) {
    return { status: "ineligible", reason: "unsupported_claim" };
  }
  if (ctx.requiresConsent && ctx.consentStatus !== "granted" && ctx.consentStatus !== "not_required") {
    return { status: "ineligible", reason: "missing_consent" };
  }
  if (ctx.requiresVerifiedProof && ctx.proofVerificationStatus !== "verified") {
    return { status: "ineligible", reason: "missing_mandatory_proof" };
  }
  if (ctx.hasUnresolvedBlockingConflict) {
    return { status: "ineligible", reason: "conflicting_authority" };
  }
  // "Inactive offer" has no dedicated offers table in the current schema;
  // client engagement status (paused/churned) is the closest real proxy.
  if (ctx.clientStatus === "paused" || ctx.clientStatus === "churned") {
    return { status: "ineligible", reason: "inactive_offer" };
  }
  return { status: "eligible", reason: null };
}

/**
 * Breadth-first search over a status transition table for the shortest valid
 * path from `from` to `to`, inclusive of `from`. Returns null if no path
 * exists (e.g. the target is unreachable, or `from` is already terminal).
 * Used so a single human action (e.g. "shortlist") can walk multiple valid
 * hops of the canonical state machine (draft -> needs_review -> shortlisted)
 * without ever taking an edge the table does not define.
 */
export function findTransitionPath<S extends string>(
  transitions: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): S[] | null {
  if (from === to) return [from];
  const queue: S[][] = [[from]];
  const visited = new Set<S>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1];
    for (const next of transitions[last] ?? []) {
      if (visited.has(next)) continue;
      const nextPath = [...path, next];
      if (next === to) return nextPath;
      visited.add(next);
      queue.push(nextPath);
    }
  }
  return null;
}

export interface ExistingOpportunityForDedup {
  id: string;
  title: string;
  core_claim: string | null;
}

export interface DedupResult {
  duplicateOfId: string | null;
  reason: string | null;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Deterministic near-duplicate detection: normalised exact match on title,
 * or normalised exact match on core_claim when both are present. Not a
 * semantic/embedding comparison — cheap, explainable, and conservative
 * (only flags what it can justify in the UI), matching the "Explainable
 * score UI" requirement's spirit for dedup as well as scoring.
 */
export function checkDuplicate(
  candidate: GeneratedOpportunityCandidate,
  existing: readonly ExistingOpportunityForDedup[],
): DedupResult {
  const candidateTitle = normalise(candidate.title);
  const candidateClaim = candidate.core_claim ? normalise(candidate.core_claim) : null;

  for (const other of existing) {
    if (normalise(other.title) === candidateTitle) {
      return { duplicateOfId: other.id, reason: "same_title" };
    }
    if (candidateClaim && other.core_claim && normalise(other.core_claim) === candidateClaim) {
      return { duplicateOfId: other.id, reason: "same_core_claim" };
    }
  }
  return { duplicateOfId: null, reason: null };
}
