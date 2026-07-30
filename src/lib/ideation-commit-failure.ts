import type { IdeationCommitFailure } from "../types/ideation-commit";

/**
 * Decodes the Stage 4 structured failure envelope. Like the Stage 1–3 decoders,
 * it reads only the documented error shape: no internal infrastructure field is
 * assumed to be present, and nothing is invented when one is missing.
 */
export function decodeIdeationCommitFailureBody(
  responseBody: unknown,
  fallbackMessage: string,
): IdeationCommitFailure | null {
  if (!responseBody || typeof responseBody !== "object") return null;
  const body = responseBody as { error?: Record<string, unknown>; message?: unknown };
  const error = body.error;
  const code = typeof error?.code === "string" ? error.code : null;
  if (!error || !code) return null;

  const numberOr = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const stringOrNull = (value: unknown): string | null => typeof value === "string" ? value : null;

  return {
    code,
    message: typeof error.message === "string"
      ? error.message
      : typeof body.message === "string" ? body.message : fallbackMessage,
    retryable: error.retryable === true,
    commit_run_id: stringOrNull(error.commit_run_id),
    proposal_id: stringOrNull(error.proposal_id),
    ideation_cycle_id: stringOrNull(error.ideation_cycle_id),
    scoring_run_id: stringOrNull(error.scoring_run_id),
    commit_status: stringOrNull(error.commit_status),
    expected_item_count: numberOr(error.expected_item_count, 0),
    committed_item_count: numberOr(error.committed_item_count, 0),
    organic_item_count: numberOr(error.organic_item_count, 0),
    story_item_count: numberOr(error.story_item_count, 0),
    failed_item_count: numberOr(error.failed_item_count, 0),
    current_edit_revision: typeof error.current_edit_revision === "number"
      ? error.current_edit_revision
      : null,
    failed_proposal_slot_key: stringOrNull(error.failed_proposal_slot_key),
    warnings: Array.isArray(error.warnings) ? error.warnings : [],
    details: error.details && typeof error.details === "object"
      ? error.details as Record<string, unknown>
      : null,
  };
}
