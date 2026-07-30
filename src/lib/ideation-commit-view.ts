// Ideation Stage 4 — pure view helpers for the commit workflow.
//
// Kept free of React and of any Supabase import so the whole commit-decision
// surface is directly unit-testable.

import type { IdeationCommitItem, IdeationCommitRun } from "@/types/ideation-commit";

/**
 * Failures that are integrity problems rather than transient faults. A blind
 * "Retry" for these would invite the operator to keep clicking through a real
 * data problem, so the UI must offer the specific recovery action instead.
 */
const NON_RETRYABLE_COMMIT_CODES = new Set([
  "PROPOSAL_NOT_FOUND",
  "PROPOSAL_NOT_APPROVED",
  "PROPOSAL_SUPERSEDED",
  "PROPOSAL_REVISION_CONFLICT",
  "PROPOSAL_INCOMPLETE",
  "PROPOSAL_CONFLICTS_UNRESOLVED",
  "PROPOSAL_SNAPSHOT_MISMATCH",
  "CYCLE_NOT_ELIGIBLE",
  "SCORING_RUN_NOT_ELIGIBLE",
  "AUTHORITY_SNAPSHOT_MISMATCH",
  "CANDIDATE_SNAPSHOT_MISMATCH",
  "SCORE_SNAPSHOT_MISMATCH",
  "CALENDAR_SNAPSHOT_STALE",
  "CALENDAR_CONFLICT",
  "UNSUPPORTED_ASSET_TYPE",
  "MASTER_MAPPING_INVALID",
  "REQUIRED_FIELD_MISSING",
  "REFERENCE_ALLOCATION_FAILED",
  "FORBIDDEN_CLIENT",
  "COMMIT_FORBIDDEN",
  "COMMIT_NOT_CONFIRMED",
  "MALFORMED_REQUEST",
]);

export function isNonRetryableCommitFailure(code: string): boolean {
  return NON_RETRYABLE_COMMIT_CODES.has(code);
}

export type CommitRecoveryAction =
  | "refresh_conflicts"
  | "inspect_proposal"
  | "regenerate_proposal"
  | "return_to_review"
  | "retry"
  | "none";

/** The single correct next step for a given typed failure. */
export function commitRecoveryAction(code: string): CommitRecoveryAction {
  switch (code) {
    case "CALENDAR_SNAPSHOT_STALE":
    case "CALENDAR_CONFLICT":
      return "refresh_conflicts";
    case "PROPOSAL_REVISION_CONFLICT":
    case "PROPOSAL_INCOMPLETE":
    case "PROPOSAL_CONFLICTS_UNRESOLVED":
      return "return_to_review";
    case "CANDIDATE_SNAPSHOT_MISMATCH":
    case "SCORE_SNAPSHOT_MISMATCH":
    case "AUTHORITY_SNAPSHOT_MISMATCH":
    case "PROPOSAL_SNAPSHOT_MISMATCH":
    case "PROPOSAL_SUPERSEDED":
      return "regenerate_proposal";
    case "UNSUPPORTED_ASSET_TYPE":
    case "MASTER_MAPPING_INVALID":
    case "REQUIRED_FIELD_MISSING":
    case "CYCLE_NOT_ELIGIBLE":
    case "SCORING_RUN_NOT_ELIGIBLE":
      return "inspect_proposal";
    case "COMMIT_PERSISTENCE_FAILED":
    case "COMMIT_TRANSACTION_UNAVAILABLE":
    case "CONCURRENT_COMMIT_CONFLICT":
      return "retry";
    default:
      return "none";
  }
}

export const COMMIT_RECOVERY_LABELS: Record<CommitRecoveryAction, string> = {
  refresh_conflicts: "Refresh conflicts",
  inspect_proposal: "Inspect proposal",
  regenerate_proposal: "Regenerate proposal",
  return_to_review: "Return to review",
  retry: "Try again",
  none: "",
};

export interface CommitPlanSummary {
  total: number;
  organic: number;
  story: number;
  byAssetType: Array<{ asset_type: string; count: number }>;
  dates: string[];
  unresolvedConflicts: number;
}

/**
 * Everything the confirmation dialog states, derived from the proposal slots
 * rather than from anything the server returns after the fact.
 */
export function summariseCommitPlan(
  slots: Array<{ required_asset_type: string; proposed_date: string; conflict_status: string }>,
  unresolvedConflicts: number,
): CommitPlanSummary {
  const counts = new Map<string, number>();
  const dates = new Set<string>();
  let story = 0;
  for (const slot of slots) {
    counts.set(slot.required_asset_type, (counts.get(slot.required_asset_type) ?? 0) + 1);
    dates.add(slot.proposed_date);
    if (slot.required_asset_type === "story") story += 1;
  }
  return {
    total: slots.length,
    organic: slots.length - story,
    story,
    byAssetType: [...counts.entries()]
      .map(([asset_type, count]) => ({ asset_type, count }))
      .sort((left, right) => left.asset_type.localeCompare(right.asset_type)),
    dates: [...dates].sort(),
    unresolvedConflicts,
  };
}

/** True only for an approved, not-yet-committed proposal. */
export function canCommitProposal(
  proposalStatus: string,
  completedRun: IdeationCommitRun | null,
): boolean {
  return proposalStatus === "approved" && !completedRun;
}

export function commitIsComplete(run: IdeationCommitRun | null): boolean {
  return run?.status === "completed";
}

/** Groups committed refs by their target domain for the result display. */
export function groupCommittedRefs(items: IdeationCommitItem[]): {
  organic: IdeationCommitItem[];
  story: IdeationCommitItem[];
} {
  return {
    organic: items.filter((item) => item.target_master_table === "organic_master"),
    story: items.filter((item) => item.target_master_table === "story_master"),
  };
}

export function commitItemsByDate(items: IdeationCommitItem[]): Array<{
  date: string;
  items: IdeationCommitItem[];
}> {
  const byDate = new Map<string, IdeationCommitItem[]>();
  for (const item of items) {
    byDate.set(item.committed_date, [...(byDate.get(item.committed_date) ?? []), item]);
  }
  return [...byDate.entries()]
    .map(([date, dateItems]) => ({
      date,
      items: [...dateItems].sort((left, right) => left.operational_ref.localeCompare(right.operational_ref)),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}
