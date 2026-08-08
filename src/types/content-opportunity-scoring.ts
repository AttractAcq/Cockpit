// Programme Stage F — Content Opportunity scoring.
//
// Slot-independent rubric: these scores describe how strong the Opportunity
// is on its own merits, not how well it fits a particular Calendar Slot or
// format (Stage G owns slot-specific matching). Mirrors the shape of
// ideation-scoring.ts deliberately — same "server computes the overall score,
// a model-supplied one is rejected" contract — per Stage F's acceptance
// criterion that existing Ideation scoring can be mapped into this system.

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

export const OPPORTUNITY_SCORE_METHOD = "stage_f_rubric_v1";

export interface ContentOpportunityScore {
  id: string;
  client_id: string;
  content_opportunity_id: string;
  strategic_fit: number;
  audience_relevance: number;
  proof_strength: number;
  commercial_relevance: number;
  novelty: number;
  timeliness: number;
  visual_potential: number;
  production_readiness: number;
  overall_score: number;
  score_method: string;
  rationale: string | null;
  strengths: string[];
  risks: string[];
  provider: string | null;
  model: string | null;
  created_by: string | null;
  created_at: string;
}

export type OpportunityDimensionScores = Record<OpportunityScoreDimensionKey, number>;

/**
 * The single place `overall_score` is computed. A caller must never trust a
 * model-supplied overall score or rank — this is the only authoritative path.
 * Throws if any dimension is outside 0-100, so a bad upstream value fails the
 * request instead of silently producing a wrong score.
 */
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

/** Eligibility hard-filter reason codes, applied before any scoring happens. */
export const OPPORTUNITY_ELIGIBILITY_FILTERS = [
  { code: "unsupported_claim", label: "Unsupported claim" },
  { code: "missing_consent", label: "Missing consent" },
  { code: "conflicting_authority", label: "Conflicting authority" },
  { code: "inactive_offer", label: "Inactive offer" },
  { code: "duplicate_recent_content", label: "Duplicate recent content" },
  { code: "unavailable_required_media", label: "Unavailable required media" },
  { code: "prohibited_claim", label: "Prohibited claim" },
  { code: "wrong_region", label: "Wrong region" },
  { code: "expired_source", label: "Expired source" },
  { code: "incompatible_format", label: "Incompatible format" },
  { code: "missing_mandatory_proof", label: "Missing mandatory proof" },
] as const;

export type OpportunityEligibilityFilterCode = typeof OPPORTUNITY_ELIGIBILITY_FILTERS[number]["code"];

export interface GenerateContentOpportunitiesInput {
  client_id: string;
  content_source_id: string;
}

export interface GeneratedOpportunitySummary {
  content_opportunity_id: string;
  title: string;
  eligibility_status: "eligible" | "ineligible";
  eligibility_reason: string | null;
  duplicate_of_opportunity_id: string | null;
}

export interface GenerateContentOpportunitiesResponse {
  ok: true;
  content_source_id: string;
  generated: GeneratedOpportunitySummary[];
}

export interface ScoreContentOpportunityInput {
  client_id: string;
  content_opportunity_id: string;
}

export interface ScoreContentOpportunityResponse {
  ok: true;
  content_opportunity_id: string;
  score: ContentOpportunityScore;
}

export type OpportunityStatusAction =
  | "shortlist"
  | "reject"
  | "save_for_later"
  | "select_for_planning"
  | "merge";

export interface UpdateContentOpportunityStatusInput {
  client_id: string;
  content_opportunity_id: string;
  action: OpportunityStatusAction;
  /** Required for "reject". */
  reason?: string;
  /** Required for "merge" — the opportunity this one is a duplicate of. */
  merge_into_opportunity_id?: string;
  /** Required for "save_for_later" — new expiry, must be in the future. */
  new_expires_at?: string;
}

export interface UpdateContentOpportunityStatusResponse {
  ok: true;
  content_opportunity_id: string;
  status: string;
}
