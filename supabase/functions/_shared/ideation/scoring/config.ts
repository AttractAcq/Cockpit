// Ideation Stage 2 — frozen scoring module configuration.
//
// Stage 2 deliberately reuses the Stage 1 provider time-budget machinery in
// ../provider-runtime.ts rather than introducing a second provider
// infrastructure. Only the batch and retry policy is Stage 2 specific.

export const IDEATION_SCORING_MODULE_VERSION = "ideation-scoring.v1";
export const IDEATION_SCORING_PROMPT_VERSION = "ideation-scoring-prompt.v1";
export const IDEATION_SCORING_MAX_ATTEMPTS = 3;

/**
 * Candidates are scored in deterministic bounded batches so a one-month
 * candidate set never depends on a single oversized response. Batches are cut
 * from the canonical candidate order (technique order, then candidate index,
 * then candidate id), so the same cycle always yields the same batches.
 */
export const IDEATION_SCORING_BATCH_POLICY = Object.freeze({
  strategy: "canonical_order_fixed_size",
  batch_size: 5,
  minimum_batch_size: 1,
});

export const IDEATION_SCORING_MODEL_CONFIGURATION = Object.freeze({
  provider: "anthropic",
  primary_model_env: "AA_IDEATION_SCORING_AI_MODEL",
  secondary_model_env: "AA_IDEATION_AI_MODEL",
  fallback_model_env: "AA_PHASE2_AI_MODEL",
  fallback_model: "claude-sonnet-4-6",
  temperature: null,
  correction_attempts: 1,
  reject_max_token_truncation: true,
});

/**
 * Output budget for one scoring batch. Unlike Stage 1 generation, the response
 * is a fixed-shape evaluation per candidate, so a per-candidate increment plus
 * a small envelope is sufficient and fully deterministic.
 */
export const IDEATION_SCORING_OUTPUT_TOKEN_POLICY = Object.freeze({
  base_tokens: 1_200,
  per_candidate_tokens: 900,
  minimum_tokens: 2_500,
  maximum_tokens: 16_000,
  truncation_correction_multiplier: 1.5,
});

export const IDEATION_SCORING_TEXT_LIMITS = Object.freeze({
  rationale_max_chars: 1_200,
  strength_max_chars: 300,
  risk_max_chars: 300,
  strengths_minimum: 1,
  strengths_maximum: 3,
  risks_minimum: 0,
  risks_maximum: 3,
  authority_references_maximum: 12,
  evidence_references_maximum: 12,
});

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.round(value), minimum), maximum);
}

/** Deterministic output budget for one scoring batch. */
export function ideationScoringOutputTokenBudget(candidateCount: number): number {
  const count = Number.isSafeInteger(candidateCount) && candidateCount > 0 ? candidateCount : 0;
  return clampInteger(
    IDEATION_SCORING_OUTPUT_TOKEN_POLICY.base_tokens
      + (count * IDEATION_SCORING_OUTPUT_TOKEN_POLICY.per_candidate_tokens),
    IDEATION_SCORING_OUTPUT_TOKEN_POLICY.minimum_tokens,
    IDEATION_SCORING_OUTPUT_TOKEN_POLICY.maximum_tokens,
  );
}

/** Capped allowance for the single bounded correction after a truncated batch. */
export function ideationScoringCorrectionTokenBudget(baseTokens: number): number {
  return clampInteger(
    baseTokens * IDEATION_SCORING_OUTPUT_TOKEN_POLICY.truncation_correction_multiplier,
    IDEATION_SCORING_OUTPUT_TOKEN_POLICY.minimum_tokens,
    IDEATION_SCORING_OUTPUT_TOKEN_POLICY.maximum_tokens,
  );
}

/** Deterministic batching over an already canonically ordered candidate list. */
export function ideationScoringBatches<T>(items: T[]): T[][] {
  const size = Math.max(
    IDEATION_SCORING_BATCH_POLICY.minimum_batch_size,
    IDEATION_SCORING_BATCH_POLICY.batch_size,
  );
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export const IDEATION_SCORING_RETRY_POLICY = Object.freeze({
  max_attempts: IDEATION_SCORING_MAX_ATTEMPTS,
  retry_only_missing_candidates: true,
  preserve_successful_scores: true,
  non_retryable_failure_is_terminal: true,
});
