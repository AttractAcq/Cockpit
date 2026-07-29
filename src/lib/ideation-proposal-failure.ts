import type {
  IdeationCalendarProposal,
  IdeationProposalInvocationFailure,
  IdeationProposalSlot,
} from "../types/ideation-proposal";

/**
 * Decodes the Stage 3 structured failure envelope. Mirrors the Stage 1 and
 * Stage 2 decoders: it reads only the documented error shape and never assumes
 * any internal infrastructure field is present.
 */
export function decodeIdeationProposalFailureBody(
  responseBody: unknown,
  fallbackMessage: string,
): IdeationProposalInvocationFailure | null {
  if (!responseBody || typeof responseBody !== "object") return null;
  const body = responseBody as {
    error?: { code?: unknown; message?: unknown; retryable?: unknown; details?: unknown };
    message?: unknown;
  };
  if (!body.error || typeof body.error.code !== "string") return null;
  const details = body.error.details && typeof body.error.details === "object"
    ? body.error.details as Record<string, unknown>
    : {};
  const proposal = details.proposal && typeof details.proposal === "object"
    ? details.proposal as IdeationCalendarProposal
    : null;
  const numberOrNull = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  return {
    code: body.error.code,
    message: typeof body.error.message === "string"
      ? body.error.message
      : typeof body.message === "string" ? body.message : fallbackMessage,
    retryable: body.error.retryable === true,
    proposal_id: typeof details.proposal_id === "string" ? details.proposal_id : proposal?.id ?? null,
    ideation_cycle_id: typeof details.ideation_cycle_id === "string"
      ? details.ideation_cycle_id
      : proposal?.ideation_cycle_id ?? null,
    scoring_run_id: typeof details.scoring_run_id === "string"
      ? details.scoring_run_id
      : proposal?.scoring_run_id ?? null,
    proposal,
    proposal_status: typeof details.proposal_status === "string"
      ? details.proposal_status as IdeationCalendarProposal["status"]
      : proposal?.status ?? null,
    slots: Array.isArray(details.slots) ? details.slots as IdeationProposalSlot[] : [],
    expected_slot_count: numberOrNull(details.expected_slot_count),
    assigned_slot_count: numberOrNull(details.assigned_slot_count),
    unassigned_candidate_count: numberOrNull(details.unassigned_candidate_count),
    conflict_count: numberOrNull(details.conflict_count),
    unresolved_conflict_count: numberOrNull(details.unresolved_conflict_count),
    attempt_count: numberOrNull(details.attempt_count) ?? proposal?.attempt_count ?? null,
    maximum_attempts: numberOrNull(details.maximum_attempts) ?? proposal?.maximum_attempts ?? null,
    edit_revision: numberOrNull(details.edit_revision) ?? proposal?.edit_revision ?? null,
    warnings: Array.isArray(details.warnings)
      ? details.warnings as IdeationCalendarProposal["warnings"]
      : [],
    terminal_reason: typeof details.terminal_reason === "string" ? details.terminal_reason : null,
    retry_allowed: details.retry_allowed === true,
  };
}
