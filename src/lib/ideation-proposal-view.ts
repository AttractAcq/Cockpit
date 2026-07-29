import type {
  IdeationCalendarProposal,
  IdeationConflictStatus,
  IdeationProposalAssetType,
  IdeationProposalSlot,
} from "../types/ideation-proposal";

// Kept local rather than imported as a value so this module stays type-only at
// its boundaries and loads under Node's type-stripping test runner.
const BLOCKING_CONFLICT_STATUSES: IdeationConflictStatus[] = [
  "protected",
  "date_capacity_exceeded",
  "stale_calendar_snapshot",
];

function isBlockingConflictStatus(status: IdeationConflictStatus): boolean {
  return BLOCKING_CONFLICT_STATUSES.includes(status);
}

/** The proposal a cycle currently presents: newest by created_at. */
export function activeProposal(
  proposals: IdeationCalendarProposal[],
  cycleId: string | null,
): IdeationCalendarProposal | null {
  if (!cycleId) return null;
  return proposalHistory(proposals, cycleId)[0] ?? null;
}

/** Every proposal for a cycle, newest first. History is never discarded. */
export function proposalHistory(
  proposals: IdeationCalendarProposal[],
  cycleId: string | null,
): IdeationCalendarProposal[] {
  if (!cycleId) return [];
  return proposals
    .filter((proposal) => proposal.ideation_cycle_id === cycleId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export interface ProposalDateGroup {
  date: string;
  slots: IdeationProposalSlot[];
}

/**
 * Chronological grouping for the review interface. Dates ascend, and within a
 * date the server-owned ordinal decides order, so the view never re-derives a
 * placement the server owns.
 */
export function groupSlotsByDate(slots: IdeationProposalSlot[]): ProposalDateGroup[] {
  const byDate = new Map<string, IdeationProposalSlot[]>();
  for (const slot of slots) {
    byDate.set(slot.proposed_date, [...(byDate.get(slot.proposed_date) ?? []), slot]);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, group]) => ({
      date,
      slots: [...group].sort((left, right) =>
        left.date_slot_ordinal !== right.date_slot_ordinal
          ? left.date_slot_ordinal - right.date_slot_ordinal
          : left.proposal_slot_key.localeCompare(right.proposal_slot_key)
      ),
    }));
}

/**
 * Optional score-order audit view: assigned slots by rank ascending, then
 * unassigned slots. Stable and independent of the chronological view.
 */
export function slotsInScoreOrder(slots: IdeationProposalSlot[]): IdeationProposalSlot[] {
  return [...slots].sort((left, right) => {
    const leftRank = left.candidate_rank_snapshot;
    const rightRank = right.candidate_rank_snapshot;
    if (leftRank !== null && rightRank !== null) {
      return leftRank !== rightRank ? leftRank - rightRank : left.proposal_slot_key.localeCompare(right.proposal_slot_key);
    }
    if (leftRank !== null) return -1;
    if (rightRank !== null) return 1;
    return left.proposal_slot_key.localeCompare(right.proposal_slot_key);
  });
}

export interface UnassignedCandidate {
  candidate_id: string;
  display_reference: string;
  asset_type: IdeationProposalAssetType;
  rank: number | null;
  overall_score: number | null;
  working_title: string;
}

/**
 * Candidates in the immutable proposal snapshot that no slot currently holds.
 * Derived from the snapshot rather than a separate table, so the pool can never
 * disagree with the assignments.
 */
export function unassignedCandidates(
  candidateSnapshot: Array<Record<string, unknown>>,
  slots: IdeationProposalSlot[],
  titleByCandidateId: Map<string, string>,
): UnassignedCandidate[] {
  const assigned = new Set(
    slots.filter((slot) => slot.candidate_id !== null).map((slot) => String(slot.candidate_id)),
  );
  return candidateSnapshot
    .filter((entry) => !assigned.has(String(entry.candidate_id)))
    .map((entry) => ({
      candidate_id: String(entry.candidate_id),
      display_reference: String(entry.display_reference ?? ""),
      asset_type: entry.asset_type as IdeationProposalAssetType,
      rank: typeof entry.rank === "number" ? entry.rank : null,
      overall_score: typeof entry.overall_score === "number" ? entry.overall_score : null,
      working_title: titleByCandidateId.get(String(entry.candidate_id)) ?? String(entry.display_reference ?? ""),
    }))
    .sort((left, right) => (left.rank ?? 9999) - (right.rank ?? 9999));
}

/** Empty slots a given candidate could legally occupy. */
export function compatibleEmptySlots(
  slots: IdeationProposalSlot[],
  assetType: IdeationProposalAssetType,
): IdeationProposalSlot[] {
  return slots.filter((slot) => slot.candidate_id === null && slot.required_asset_type === assetType);
}

/** Assigned slots a given slot's candidate could legally swap with. */
export function compatibleSwapTargets(
  slots: IdeationProposalSlot[],
  slot: IdeationProposalSlot,
): IdeationProposalSlot[] {
  if (!slot.candidate_asset_type_snapshot) return [];
  return slots.filter((other) =>
    other.proposal_slot_key !== slot.proposal_slot_key
    && other.candidate_id !== null
    && other.candidate_asset_type_snapshot === slot.required_asset_type
    && other.required_asset_type === slot.candidate_asset_type_snapshot
  );
}

export function canCreateProposal(
  scoringRunStatus: string | undefined,
  proposal: IdeationCalendarProposal | null,
): boolean {
  return scoringRunStatus === "completed" && proposal === null;
}

export function canRetryProposal(proposal: IdeationCalendarProposal | null): boolean {
  return Boolean(
    proposal
      && proposal.status === "retryable"
      && proposal.retryable
      && proposal.attempt_count < proposal.maximum_attempts,
  );
}

export function canReviewProposal(proposal: IdeationCalendarProposal | null): boolean {
  return proposal?.status === "draft" || proposal?.status === "approved";
}

export function canEditProposal(proposal: IdeationCalendarProposal | null): boolean {
  return proposal?.status === "draft";
}

export function canRegenerateProposal(proposal: IdeationCalendarProposal | null): boolean {
  return proposal?.status === "draft" || proposal?.status === "approved";
}

/** Approval is blocked while anything is unassigned or any conflict is unresolved. */
export function canApproveProposal(
  proposal: IdeationCalendarProposal | null,
  slots: IdeationProposalSlot[],
): boolean {
  if (proposal?.status !== "draft") return false;
  if (proposal.unassigned_candidate_count !== 0) return false;
  if (proposal.assigned_slot_count !== proposal.expected_slot_count) return false;
  if (slots.some((slot) => slot.candidate_id === null)) return false;
  return !slots.some((slot) => isBlockingConflictStatus(slot.conflict_status));
}

/** Plain-text reason approval is unavailable, announced rather than implied. */
export function approvalBlockReason(
  proposal: IdeationCalendarProposal | null,
  slots: IdeationProposalSlot[],
): string | null {
  if (!proposal) return "No proposal exists yet.";
  if (proposal.status === "approved") return "This proposal is already approved.";
  if (proposal.status !== "draft") return "Only a draft proposal can be approved.";
  const unassigned = proposal.unassigned_candidate_count;
  if (unassigned > 0) {
    return `${unassigned} candidate${unassigned === 1 ? " is" : "s are"} still unassigned.`;
  }
  const blocking = slots.filter((slot) => isBlockingConflictStatus(slot.conflict_status));
  if (blocking.length > 0) {
    return `${blocking.length} slot${blocking.length === 1 ? " has" : "s have"} an unresolved Calendar conflict.`;
  }
  return null;
}

export function proposalProgressLabel(proposal: IdeationCalendarProposal): string {
  return `${proposal.assigned_slot_count} of ${proposal.expected_slot_count} slots assigned`
    + ` · attempt ${proposal.attempt_count} of ${proposal.maximum_attempts}`;
}
