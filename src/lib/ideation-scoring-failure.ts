import type {
  IdeationCandidateScore,
  IdeationScoringInvocationFailure,
  IdeationScoringRun,
} from "../types/ideation-scoring";

/**
 * Decodes the Stage 2 structured failure envelope.
 *
 * Mirrors the Stage 1 decoder: it reads only the documented error shape and
 * never assumes the presence of any internal infrastructure field.
 */
export function decodeIdeationScoringFailureBody(
  responseBody: unknown,
  fallbackMessage: string,
): IdeationScoringInvocationFailure | null {
  if (!responseBody || typeof responseBody !== "object") return null;
  const body = responseBody as {
    error?: { code?: unknown; message?: unknown; retryable?: unknown; details?: unknown };
    message?: unknown;
  };
  if (!body.error || typeof body.error.code !== "string") return null;
  const details = body.error.details && typeof body.error.details === "object"
    ? body.error.details as Record<string, unknown>
    : {};
  const run = details.scoring_run && typeof details.scoring_run === "object"
    ? details.scoring_run as IdeationScoringRun
    : null;
  const numberOrNull = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  return {
    code: body.error.code,
    message: typeof body.error.message === "string"
      ? body.error.message
      : typeof body.message === "string"
        ? body.message
        : fallbackMessage,
    retryable: body.error.retryable === true,
    scoring_run_id: typeof details.scoring_run_id === "string"
      ? details.scoring_run_id
      : run?.id ?? null,
    ideation_cycle_id: typeof details.ideation_cycle_id === "string"
      ? details.ideation_cycle_id
      : run?.ideation_cycle_id ?? null,
    scoring_run: run,
    scoring_run_status: typeof details.scoring_run_status === "string"
      ? details.scoring_run_status as IdeationScoringRun["status"]
      : run?.status ?? null,
    scores: Array.isArray(details.scores) ? details.scores as IdeationCandidateScore[] : [],
    warnings: Array.isArray(details.warnings)
      ? details.warnings as IdeationScoringRun["warnings"]
      : [],
    expected_candidate_count: numberOrNull(details.expected_candidate_count),
    scored_candidate_count: numberOrNull(details.scored_candidate_count),
    failed_candidate_count: numberOrNull(details.failed_candidate_count),
    shortfall: numberOrNull(details.shortfall),
    attempt_count: numberOrNull(details.attempt_count) ?? run?.attempt_count ?? null,
    maximum_attempts: numberOrNull(details.maximum_attempts) ?? run?.maximum_attempts ?? null,
    terminal_reason: typeof details.terminal_reason === "string" ? details.terminal_reason : null,
    retry_allowed: details.retry_allowed === true,
  };
}
