// Ideation Stage 2 — immutable, code-owned scoring rubric.
//
// The model supplies ONLY the ten integer dimension scores. The overall score,
// the priority band, and the rank are calculated server-side from those
// dimensions. A model-supplied overall score, band, or rank is never persisted
// and never overrides the calculation in this module.

import { IDEATION_TECHNIQUE_SLUGS } from "../config.ts";

export const IDEATION_SCORING_RUBRIC_SLUG = "aa.ideation.scoring";
export const IDEATION_SCORING_RUBRIC_VERSION = "aa.ideation.scoring.v1";
export const IDEATION_SCORING_OUTPUT_SCHEMA_VERSION = "aa.ideation.scoring-output.v1";

export const IDEATION_SCORE_DIMENSION_KEYS = [
  "execution_plan_alignment",
  "business_and_positioning_alignment",
  "audience_and_pain_relevance",
  "proof_and_evidence_strength",
  "hook_and_attention_strength",
  "commercial_potential",
  "specificity_and_clarity",
  "originality_and_distinctiveness",
  "platform_and_format_fit",
  "production_feasibility",
] as const;

export type IdeationScoreDimensionKey = typeof IDEATION_SCORE_DIMENSION_KEYS[number];

export interface IdeationRubricDimension {
  readonly key: IdeationScoreDimensionKey;
  readonly label: string;
  readonly weight: number;
  readonly guidance: string;
}

export const IDEATION_SCORING_RUBRIC: readonly IdeationRubricDimension[] = Object.freeze([
  {
    key: "execution_plan_alignment",
    label: "Execution-plan alignment",
    weight: 20,
    guidance:
      "Does the candidate directly satisfy the approved Execution plan, quantity intent, campaign priorities, content pillars, and period requirements?",
  },
  {
    key: "business_and_positioning_alignment",
    label: "Business and positioning alignment",
    weight: 15,
    guidance:
      "Does the candidate accurately express the business, offer, positioning, differentiation, and strategic authority?",
  },
  {
    key: "audience_and_pain_relevance",
    label: "Audience and pain relevance",
    weight: 15,
    guidance:
      "Does it address a meaningful audience problem, desire, objection, trigger, or buying context?",
  },
  {
    key: "proof_and_evidence_strength",
    label: "Proof and evidence strength",
    weight: 15,
    guidance: "Is the idea supported by credible, specific, usable evidence and provenance?",
  },
  {
    key: "hook_and_attention_strength",
    label: "Hook and attention strength",
    weight: 10,
    guidance: "Is the opening angle clear, compelling, specific, and likely to earn attention?",
  },
  {
    key: "commercial_potential",
    label: "Commercial potential",
    weight: 10,
    guidance:
      "Is the content likely to support qualified demand, trust, conversation, or buying intent without relying on unsupported claims?",
  },
  {
    key: "specificity_and_clarity",
    label: "Specificity and clarity",
    weight: 5,
    guidance: "Is the idea concrete, understandable, and sufficiently developed?",
  },
  {
    key: "originality_and_distinctiveness",
    label: "Originality and distinctiveness",
    weight: 5,
    guidance: "Does it avoid generic marketing language and express a distinctive angle?",
  },
  {
    key: "platform_and_format_fit",
    label: "Platform and format fit",
    weight: 3,
    guidance: "Is the idea suitable for its allocated asset type and intended content format?",
  },
  {
    key: "production_feasibility",
    label: "Production feasibility",
    weight: 2,
    guidance:
      "Can the idea realistically be produced using available proof, brand assets, people, footage, and delivery constraints?",
  },
]);

export const IDEATION_SCORING_TOTAL_WEIGHT = IDEATION_SCORING_RUBRIC
  .reduce((total, dimension) => total + dimension.weight, 0);

if (IDEATION_SCORING_TOTAL_WEIGHT !== 100) {
  throw new Error(`Ideation rubric weights must total 100; found ${IDEATION_SCORING_TOTAL_WEIGHT}.`);
}

export const IDEATION_SCORE_DIMENSION_MINIMUM = 0;
export const IDEATION_SCORE_DIMENSION_MAXIMUM = 10;

export type IdeationScoreDimensions = Record<IdeationScoreDimensionKey, number>;

export type IdeationPriorityBand = "top" | "high" | "medium" | "low";

export const IDEATION_PRIORITY_BANDS = Object.freeze([
  { band: "top" as const, minimum: 90, maximum: 100 },
  { band: "high" as const, minimum: 75, maximum: 89 },
  { band: "medium" as const, minimum: 60, maximum: 74 },
  { band: "low" as const, minimum: 0, maximum: 59 },
]);

/** True only for an integer inside the inclusive 0..10 dimension range. */
export function isValidDimensionScore(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= IDEATION_SCORE_DIMENSION_MINIMUM
    && value <= IDEATION_SCORE_DIMENSION_MAXIMUM;
}

/**
 * Canonical server-side overall score.
 *
 * overall = round( sum( (dimension_score / 10) * dimension_weight ) )
 *
 * Evaluated as round(sum(score * weight) / 10) so the intermediate sum stays an
 * exact integer and the result cannot drift with floating-point accumulation.
 * Always an integer in 0..100.
 */
export function calculateIdeationOverallScore(dimensions: IdeationScoreDimensions): number {
  let weighted = 0;
  for (const dimension of IDEATION_SCORING_RUBRIC) {
    const score = dimensions[dimension.key];
    if (!isValidDimensionScore(score)) {
      throw new Error(`Dimension ${dimension.key} must be an integer between 0 and 10.`);
    }
    weighted += score * dimension.weight;
  }
  const overall = Math.round(weighted / 10);
  if (!Number.isInteger(overall) || overall < 0 || overall > 100) {
    throw new Error(`Calculated overall score ${overall} is outside 0..100.`);
  }
  return overall;
}

/** Server-derived priority band. The model never selects the persisted band. */
export function ideationPriorityBand(overallScore: number): IdeationPriorityBand {
  if (!Number.isInteger(overallScore) || overallScore < 0 || overallScore > 100) {
    throw new Error(`Overall score ${overallScore} is outside 0..100.`);
  }
  const match = IDEATION_PRIORITY_BANDS.find((entry) =>
    overallScore >= entry.minimum && overallScore <= entry.maximum
  );
  if (!match) throw new Error(`No priority band covers overall score ${overallScore}.`);
  return match.band;
}

export interface IdeationRankableScore {
  candidate_id: string;
  technique_slug: string;
  candidate_index: number;
  overall_score: number;
  dimensions: IdeationScoreDimensions;
}

function canonicalTechniqueOrder(slug: string): number {
  const index = (IDEATION_TECHNIQUE_SLUGS as readonly string[]).indexOf(slug);
  // An unknown slug sorts after every canonical technique rather than throwing,
  // so ranking stays total. Eligibility rejects unknown slugs before this point.
  return index >= 0 ? index : IDEATION_TECHNIQUE_SLUGS.length;
}

/**
 * Total, deterministic ordering. Every comparison falls through to the candidate
 * UUID, so the same complete score set always produces the same ranking.
 */
export function compareIdeationScoresForRank(
  left: IdeationRankableScore,
  right: IdeationRankableScore,
): number {
  if (left.overall_score !== right.overall_score) return right.overall_score - left.overall_score;
  for (const key of [
    "execution_plan_alignment",
    "proof_and_evidence_strength",
    "audience_and_pain_relevance",
  ] as const) {
    if (left.dimensions[key] !== right.dimensions[key]) {
      return right.dimensions[key] - left.dimensions[key];
    }
  }
  const leftTechnique = canonicalTechniqueOrder(left.technique_slug);
  const rightTechnique = canonicalTechniqueOrder(right.technique_slug);
  if (leftTechnique !== rightTechnique) return leftTechnique - rightTechnique;
  if (left.candidate_index !== right.candidate_index) return left.candidate_index - right.candidate_index;
  return left.candidate_id.localeCompare(right.candidate_id);
}

/** Assigns gap-free ranks starting at 1 over a complete score set. */
export function assignIdeationRanks<T extends IdeationRankableScore>(
  scores: T[],
): Array<T & { rank: number }> {
  return [...scores]
    .sort(compareIdeationScoresForRank)
    .map((score, index) => ({ ...score, rank: index + 1 }));
}

/** Frozen rubric manifest as hashed into the scoring configuration snapshot. */
export const IDEATION_SCORING_RUBRIC_MANIFEST = Object.freeze({
  slug: IDEATION_SCORING_RUBRIC_SLUG,
  version: IDEATION_SCORING_RUBRIC_VERSION,
  total_weight: IDEATION_SCORING_TOTAL_WEIGHT,
  dimension_minimum: IDEATION_SCORE_DIMENSION_MINIMUM,
  dimension_maximum: IDEATION_SCORE_DIMENSION_MAXIMUM,
  dimensions: IDEATION_SCORING_RUBRIC.map((dimension) => ({ ...dimension })),
  priority_bands: IDEATION_PRIORITY_BANDS.map((band) => ({ ...band })),
  overall_score_formula: "round(sum((dimension_score / 10) * dimension_weight))",
  rank_tie_breaks: [
    "overall_score desc",
    "execution_plan_alignment desc",
    "proof_and_evidence_strength desc",
    "audience_and_pain_relevance desc",
    "canonical_technique_order asc",
    "candidate_index asc",
    "candidate_id asc",
  ],
  server_calculates_overall_score: true,
  server_calculates_priority_band: true,
  server_calculates_rank: true,
});
