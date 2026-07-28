// Ideation Stage 2 — scoring output validation.
//
// The model returns ten integer dimension scores plus bounded prose per
// candidate. Everything authoritative — overall score, priority band, rank — is
// calculated server-side, so any of those keys arriving from the model is
// treated as a contract violation rather than being silently ignored.

import { IDEATION_SCORING_TEXT_LIMITS } from "./config.ts";
import {
  calculateIdeationOverallScore,
  ideationPriorityBand,
  IDEATION_SCORE_DIMENSION_KEYS,
  isValidDimensionScore,
  type IdeationPriorityBand,
  type IdeationScoreDimensions,
} from "./rubric.ts";

export interface ValidatedCandidateScore {
  candidate_id: string;
  dimensions: IdeationScoreDimensions;
  overall_score: number;
  priority_band: IdeationPriorityBand;
  rationale: string;
  strengths: string[];
  risks: string[];
  authority_references: string[];
  evidence_references: string[];
}

export type ScoringOutputValidation =
  | { ok: true; scores: ValidatedCandidateScore[] }
  | { ok: false; error: string };

const ALLOWED_SCORE_KEYS = new Set<string>([
  "candidate_id",
  "dimensions",
  "rationale",
  "strengths",
  "risks",
  "authority_references",
  "evidence_references",
]);

// Keys the server owns. Their presence means the model tried to decide
// something it must not decide.
const SERVER_OWNED_KEYS = new Set<string>([
  "overall_score",
  "overall",
  "score",
  "priority_band",
  "band",
  "rank",
  "ranking",
  "position",
  "calendar_date",
  "approved",
  "status",
  "asset_type",
  "working_title",
  "hook",
  "core_message",
  "cta",
]);

export function extractScoringJson(text: string): Record<string, unknown> | null {
  const attempt = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(text.trim());
  if (direct) return direct;
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenced) {
    const parsed = attempt(fenced[1]);
    if (parsed) return parsed;
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return attempt(text.slice(start, end + 1));
  return null;
}

function boundedString(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxChars) return null;
  return trimmed;
}

function boundedStringArray(
  value: unknown,
  minimum: number,
  maximum: number,
  maxChars: number,
): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length < minimum || value.length > maximum) return null;
  const entries: string[] = [];
  for (const item of value) {
    const entry = boundedString(item, maxChars);
    if (!entry) return null;
    entries.push(entry);
  }
  return entries;
}

function referenceArray(
  value: unknown,
  allowed: Set<string>,
  maximum: number,
): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, ids: [] };
  if (!Array.isArray(value)) return { ok: false, error: "Reference list must be an array." };
  if (value.length > maximum) return { ok: false, error: "Reference list exceeds its bound." };
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return { ok: false, error: "Reference list contains a non-string entry." };
    }
    const id = item.trim();
    if (!allowed.has(id)) {
      return { ok: false, error: "Reference list contains an unregistered identifier." };
    }
    if (ids.includes(id)) {
      return { ok: false, error: "Reference list contains a duplicate identifier." };
    }
    ids.push(id);
  }
  return { ok: true, ids };
}

/**
 * Validates one scoring batch against its exact expected candidate set.
 *
 * The returned set must match `expected` exactly — no missing entry, no extra
 * entry, no duplicate. A batch that scores only some of its candidates is a
 * failure, never a partial success.
 */
export function validateScoringBatchOutput(
  value: Record<string, unknown>,
  expected: Array<{ candidate_id: string; evidence_source_ids: string[] }>,
  allowedAuthorityIds: string[],
): ScoringOutputValidation {
  const rows = value.scores;
  if (!Array.isArray(rows)) {
    return { ok: false, error: "Scoring output must contain a scores array." };
  }
  if (rows.length !== expected.length) {
    return {
      ok: false,
      error: `Scoring batch returned ${rows.length} scores for ${expected.length} candidates.`,
    };
  }
  const expectedById = new Map(expected.map((entry) => [entry.candidate_id, entry]));
  const authorityIds = new Set(allowedAuthorityIds);
  const seen = new Set<string>();
  const scores: ValidatedCandidateScore[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, error: "Scoring output contains a malformed score entry." };
    }
    const entry = row as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (SERVER_OWNED_KEYS.has(key)) {
        return { ok: false, error: `Scoring output must not supply the server-owned field ${key}.` };
      }
      if (!ALLOWED_SCORE_KEYS.has(key)) {
        return { ok: false, error: `Scoring output contains the unexpected field ${key}.` };
      }
    }

    const candidateId = typeof entry.candidate_id === "string" ? entry.candidate_id.trim() : "";
    if (!candidateId) return { ok: false, error: "Scoring output is missing a candidate_id." };
    const target = expectedById.get(candidateId);
    if (!target) {
      return { ok: false, error: "Scoring output contains an unexpected candidate_id." };
    }
    if (seen.has(candidateId)) {
      return { ok: false, error: "Scoring output contains a duplicate candidate_id." };
    }
    seen.add(candidateId);

    const rawDimensions = entry.dimensions;
    if (!rawDimensions || typeof rawDimensions !== "object" || Array.isArray(rawDimensions)) {
      return { ok: false, error: "Scoring output is missing a dimensions object." };
    }
    const dimensionRow = rawDimensions as Record<string, unknown>;
    const dimensionKeys = Object.keys(dimensionRow);
    if (dimensionKeys.length !== IDEATION_SCORE_DIMENSION_KEYS.length) {
      return { ok: false, error: "Scoring output must supply exactly the ten rubric dimensions." };
    }
    const dimensions = {} as IdeationScoreDimensions;
    for (const key of IDEATION_SCORE_DIMENSION_KEYS) {
      const score = dimensionRow[key];
      if (!isValidDimensionScore(score)) {
        return { ok: false, error: `Dimension ${key} must be an integer between 0 and 10.` };
      }
      dimensions[key] = score;
    }

    const rationale = boundedString(entry.rationale, IDEATION_SCORING_TEXT_LIMITS.rationale_max_chars);
    if (!rationale) {
      return { ok: false, error: "Scoring rationale is missing or exceeds its bound." };
    }
    const strengths = boundedStringArray(
      entry.strengths,
      IDEATION_SCORING_TEXT_LIMITS.strengths_minimum,
      IDEATION_SCORING_TEXT_LIMITS.strengths_maximum,
      IDEATION_SCORING_TEXT_LIMITS.strength_max_chars,
    );
    if (!strengths) return { ok: false, error: "Scoring strengths are missing or out of bounds." };
    const risks = boundedStringArray(
      entry.risks ?? [],
      IDEATION_SCORING_TEXT_LIMITS.risks_minimum,
      IDEATION_SCORING_TEXT_LIMITS.risks_maximum,
      IDEATION_SCORING_TEXT_LIMITS.risk_max_chars,
    );
    if (!risks) return { ok: false, error: "Scoring risks are out of bounds." };

    const authorityRefs = referenceArray(
      entry.authority_references,
      authorityIds,
      IDEATION_SCORING_TEXT_LIMITS.authority_references_maximum,
    );
    if (!authorityRefs.ok) return { ok: false, error: `Authority references: ${authorityRefs.error}` };
    const evidenceRefs = referenceArray(
      entry.evidence_references,
      new Set(target.evidence_source_ids),
      IDEATION_SCORING_TEXT_LIMITS.evidence_references_maximum,
    );
    if (!evidenceRefs.ok) return { ok: false, error: `Evidence references: ${evidenceRefs.error}` };

    const overall = calculateIdeationOverallScore(dimensions);
    scores.push({
      candidate_id: candidateId,
      dimensions,
      overall_score: overall,
      priority_band: ideationPriorityBand(overall),
      rationale,
      strengths,
      risks,
      authority_references: authorityRefs.ids,
      evidence_references: evidenceRefs.ids,
    });
  }

  if (seen.size !== expected.length) {
    return { ok: false, error: "Scoring batch did not cover every expected candidate exactly once." };
  }
  return { ok: true, scores };
}
