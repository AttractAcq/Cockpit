// Ideation Stage 3 — frozen proposal module configuration.
//
// Stage 3 reuses the Stage 1 provider time budgets and the Stage 2 batching and
// lease conventions. Only what is genuinely Stage 3 specific lives here.

export const IDEATION_PROPOSAL_MODULE_VERSION = "ideation-proposal.v1";
export const IDEATION_PROPOSAL_PROMPT_VERSION = "ideation-proposal-prompt.v1";
export const IDEATION_PROPOSAL_OUTPUT_SCHEMA_VERSION = "aa.ideation.proposal-output.v1";
export const IDEATION_PROPOSAL_MAX_ATTEMPTS = 3;

/** Finite proposal state model. */
export const IDEATION_PROPOSAL_STATUSES = [
  "running",
  "retryable",
  "failed",
  "draft",
  "approved",
  "superseded",
] as const;
export type IdeationProposalStatus = typeof IDEATION_PROPOSAL_STATUSES[number];

/** Where a slot assignment came from. */
export const IDEATION_PLACEMENT_SOURCES = ["model", "manual", "restored"] as const;
export type IdeationPlacementSource = typeof IDEATION_PLACEMENT_SOURCES[number];

/**
 * Assignments are proposed in deterministic bounded batches cut from the
 * canonical slot order, so a full-month manifest never depends on one oversized
 * response. The strategy participates in the configuration hash.
 */
export const IDEATION_PROPOSAL_BATCH_POLICY = Object.freeze({
  strategy: "canonical_slot_order_fixed_size",
  batch_size: 8,
  minimum_batch_size: 1,
});

export const IDEATION_PROPOSAL_MODEL_CONFIGURATION = Object.freeze({
  provider: "anthropic",
  primary_model_env: "AA_IDEATION_PROPOSAL_AI_MODEL",
  secondary_model_env: "AA_IDEATION_AI_MODEL",
  fallback_model_env: "AA_PHASE2_AI_MODEL",
  fallback_model: "claude-sonnet-4-6",
  temperature: null,
  correction_attempts: 1,
  reject_max_token_truncation: true,
});

export const IDEATION_PROPOSAL_OUTPUT_TOKEN_POLICY = Object.freeze({
  base_tokens: 1_000,
  per_slot_tokens: 420,
  minimum_tokens: 2_200,
  maximum_tokens: 16_000,
  truncation_correction_multiplier: 1.5,
});

export const IDEATION_PROPOSAL_TEXT_LIMITS = Object.freeze({
  rationale_max_chars: 600,
  authority_references_maximum: 8,
  evidence_references_maximum: 8,
  warnings_maximum: 3,
});

/** Warning codes the model may return. Anything else is rejected. */
export const IDEATION_PROPOSAL_WARNING_CODES = [
  "adjacent_topic_similarity",
  "cadence_deviation",
  "thin_evidence",
  "high_risk_claim",
  "calendar_pressure",
] as const;

export const IDEATION_PROPOSAL_RETRY_POLICY = Object.freeze({
  max_attempts: IDEATION_PROPOSAL_MAX_ATTEMPTS,
  retry_only_missing_assignments: true,
  preserve_successful_assignments: true,
  non_retryable_failure_is_terminal: true,
});

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.round(value), minimum), maximum);
}

export function ideationProposalOutputTokenBudget(slotCount: number): number {
  const count = Number.isSafeInteger(slotCount) && slotCount > 0 ? slotCount : 0;
  return clampInteger(
    IDEATION_PROPOSAL_OUTPUT_TOKEN_POLICY.base_tokens
      + (count * IDEATION_PROPOSAL_OUTPUT_TOKEN_POLICY.per_slot_tokens),
    IDEATION_PROPOSAL_OUTPUT_TOKEN_POLICY.minimum_tokens,
    IDEATION_PROPOSAL_OUTPUT_TOKEN_POLICY.maximum_tokens,
  );
}

export function ideationProposalCorrectionTokenBudget(baseTokens: number): number {
  return clampInteger(
    baseTokens * IDEATION_PROPOSAL_OUTPUT_TOKEN_POLICY.truncation_correction_multiplier,
    IDEATION_PROPOSAL_OUTPUT_TOKEN_POLICY.minimum_tokens,
    IDEATION_PROPOSAL_OUTPUT_TOKEN_POLICY.maximum_tokens,
  );
}

export function ideationProposalBatches<T>(items: T[]): T[][] {
  const size = Math.max(
    IDEATION_PROPOSAL_BATCH_POLICY.minimum_batch_size,
    IDEATION_PROPOSAL_BATCH_POLICY.batch_size,
  );
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
