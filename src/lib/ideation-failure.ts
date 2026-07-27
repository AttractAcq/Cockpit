import type {
  IdeationCandidate,
  IdeationInvocationFailure,
  IdeationResearchResult,
  IdeationRun,
  IdeationTechniqueRun,
  RunIdeationResponse,
} from "../types/ideation";

export function decodeIdeationFailureBody(
  responseBody: unknown,
  fallbackMessage: string,
): IdeationInvocationFailure | null {
  if (!responseBody || typeof responseBody !== "object") return null;
  const body = responseBody as {
    error?: {
      code?: unknown;
      message?: unknown;
      retryable?: unknown;
      details?: unknown;
    };
    message?: unknown;
  };
  if (!body.error || typeof body.error.code !== "string") return null;
  const details = body.error.details && typeof body.error.details === "object"
    ? body.error.details as Record<string, unknown>
    : {};
  const run = details.run && typeof details.run === "object"
    ? details.run as IdeationRun
    : null;
  return {
    code: body.error.code,
    message: typeof body.error.message === "string"
      ? body.error.message
      : typeof body.message === "string"
        ? body.message
        : fallbackMessage,
    retryable: body.error.retryable === true,
    cycle_id: typeof details.cycle_id === "string" ? details.cycle_id : run?.id ?? null,
    run,
    technique_runs: Array.isArray(details.technique_runs)
      ? details.technique_runs as IdeationTechniqueRun[]
      : [],
    research_results: Array.isArray(details.research_results)
      ? details.research_results as IdeationResearchResult[]
      : [],
    candidates: Array.isArray(details.candidates)
      ? details.candidates as IdeationCandidate[]
      : [],
    warnings: Array.isArray(details.warnings)
      ? details.warnings as RunIdeationResponse["warnings"]
      : [],
    failed_techniques: Array.isArray(details.failed_techniques)
      ? details.failed_techniques.filter((value): value is string => typeof value === "string")
      : [],
    failed_technique_details: Array.isArray(details.failed_technique_details)
      ? details.failed_technique_details as RunIdeationResponse["warnings"]
      : Array.isArray(details.warnings)
        ? details.warnings as RunIdeationResponse["warnings"]
        : [],
    expected_total: typeof details.expected_total === "number"
      ? details.expected_total
      : typeof details.expected_candidate_count === "number"
        ? details.expected_candidate_count
        : null,
    generated_total: typeof details.generated_total === "number"
      ? details.generated_total
      : typeof details.generated_candidate_count === "number"
        ? details.generated_candidate_count
        : null,
    shortfall: typeof details.shortfall === "number"
      ? details.shortfall
      : typeof details.shortfall_count === "number"
        ? details.shortfall_count
        : null,
    cycle_status: typeof details.cycle_status === "string"
      ? details.cycle_status as IdeationRun["status"]
      : run?.status ?? null,
    attempt_count: typeof details.attempt_count === "number"
      ? details.attempt_count
      : run?.attempt_count ?? null,
    maximum_attempts: typeof details.maximum_attempts === "number"
      ? details.maximum_attempts
      : null,
    terminal_reason: typeof details.terminal_reason === "string"
      ? details.terminal_reason
      : null,
    retry_allowed: details.retry_allowed === true,
  };
}
