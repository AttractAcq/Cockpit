// Ideation Stage 4 — read-only commit eligibility.
//
// Every check here runs BEFORE any operational write, and every one of them is
// re-run inside the commit transaction. This module exists so an ineligible
// proposal is refused with a precise, typed reason instead of failing opaquely
// deep inside SQL.

import { findUnsupportedCommitSlots, resolveIdeationCommitTarget } from "./targets.ts";

export interface CommitProposalRow {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  scoring_run_id: string;
  status: string;
  proposal_version: number;
  edit_revision: number;
  expected_slot_count: number;
  assigned_slot_count: number;
  unassigned_candidate_count: number;
  unresolved_conflict_count: number;
  conflict_count: number;
  approved_at: string | null;
  approved_by: string | null;
  configuration_hash: string;
  calendar_conflict_digest: string;
  authority_snapshot: Record<string, unknown>;
  period_start: string;
  period_end: string;
}

export interface CommitSlotRow {
  id: string;
  client_id: string;
  proposal_id: string;
  ideation_cycle_id: string;
  scoring_run_id: string;
  proposal_slot_key: string;
  proposed_date: string;
  period_start: string;
  period_end: string;
  required_asset_type: string;
  calendar_row_type: string;
  candidate_id: string | null;
  candidate_score_id: string | null;
  candidate_asset_type_snapshot: string | null;
  candidate_content_hash: string | null;
  candidate_rank_snapshot: number | null;
  candidate_score_snapshot: number | null;
  conflict_status: string;
}

export interface CommitCycleRow {
  id: string;
  client_id: string;
  status: string;
  expected_candidate_count: number;
  candidate_count: number;
  shortfall_count: number;
  input_hash: string;
  period_start: string;
  period_end: string;
}

export interface CommitScoringRunRow {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  status: string;
  expected_candidate_count: number;
  scored_candidate_count: number;
  failed_candidate_count: number;
  configuration_hash: string;
}

export interface CommitCandidateRow {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  asset_type: string;
  working_title: string;
  hook: string;
  core_message: string;
  psychological_angle: string | null;
  cta: string;
  input_hash: string;
}

export interface CommitScoreRow {
  id: string;
  client_id: string;
  scoring_run_id: string;
  candidate_id: string;
  rank: number;
  overall_score: number;
  candidate_content_hash: string;
}

export type CommitEligibility =
  | { ok: true; slots: CommitSlotRow[] }
  | { ok: false; code: string; message: string; details?: Record<string, unknown> };

function deny(code: string, message: string, details?: Record<string, unknown>): CommitEligibility {
  return { ok: false, code, message, details };
}

/**
 * Full pre-write eligibility evaluation.
 *
 * Reconciliation is always exact and per-record. An aggregate count is never
 * accepted as evidence that the right individual rows are present.
 */
export function evaluateCommitEligibility(input: {
  clientId: string;
  expectedEditRevision: number;
  proposal: CommitProposalRow | null;
  slots: CommitSlotRow[];
  cycle: CommitCycleRow | null;
  scoringRun: CommitScoringRunRow | null;
  candidates: CommitCandidateRow[];
  scores: CommitScoreRow[];
  supersededByCount: number;
  completedCommitRunId: string | null;
  currentCalendarDigest: string;
  /**
   * Outcome of re-reconstructing the proposal's recorded authority against the
   * live approved files, using the same mechanism Stages 2 and 3 use. A hash
   * taken from the proposal itself would compare equal to itself and prove
   * nothing, so the verification is performed by the caller and passed in.
   */
  authorityVerification: { ok: true } | { ok: false; message: string };
}): CommitEligibility {
  const proposal = input.proposal;
  if (!proposal) return deny("PROPOSAL_NOT_FOUND", "The proposal could not be found.");
  if (proposal.client_id !== input.clientId) {
    return deny("PROPOSAL_CLIENT_MISMATCH", "The proposal belongs to a different client.");
  }
  if (proposal.status === "superseded" || input.supersededByCount > 0) {
    return deny("PROPOSAL_SUPERSEDED", "A newer approved proposal has superseded this one.");
  }
  if (proposal.status !== "approved") {
    return deny(
      "PROPOSAL_NOT_APPROVED",
      "Only an approved proposal can be committed.",
      { proposal_status: proposal.status },
    );
  }
  if (!proposal.approved_at || !proposal.approved_by) {
    return deny("PROPOSAL_NOT_APPROVED", "The proposal is missing its approval identity.");
  }
  if (proposal.edit_revision !== input.expectedEditRevision) {
    return deny(
      "PROPOSAL_REVISION_CONFLICT",
      "The proposal changed since this commit was prepared. Review it again.",
      { current_edit_revision: proposal.edit_revision, expected_edit_revision: input.expectedEditRevision },
    );
  }

  // A completed commit is a success to replay, not an eligibility failure. The
  // caller distinguishes the two; here it simply short-circuits further checks.
  if (input.completedCommitRunId) {
    return deny(
      "PROPOSAL_ALREADY_COMMITTED",
      "This proposal has already been committed.",
      { commit_run_id: input.completedCommitRunId },
    );
  }

  const cycle = input.cycle;
  if (!cycle || cycle.id !== proposal.ideation_cycle_id || cycle.client_id !== input.clientId) {
    return deny("CYCLE_NOT_ELIGIBLE", "The originating Ideation cycle could not be verified.");
  }
  if (cycle.status !== "completed") {
    return deny("CYCLE_NOT_ELIGIBLE", "The originating Ideation cycle is not complete.", { cycle_status: cycle.status });
  }
  if (cycle.candidate_count !== cycle.expected_candidate_count || cycle.shortfall_count !== 0) {
    return deny("CYCLE_NOT_ELIGIBLE", "The originating Ideation cycle did not generate its full candidate set.");
  }

  const scoringRun = input.scoringRun;
  if (
    !scoringRun || scoringRun.id !== proposal.scoring_run_id ||
    scoringRun.client_id !== input.clientId || scoringRun.ideation_cycle_id !== cycle.id
  ) {
    return deny("SCORING_RUN_NOT_ELIGIBLE", "The selected scoring run could not be verified.");
  }
  if (scoringRun.status !== "completed") {
    return deny("SCORING_RUN_NOT_ELIGIBLE", "The selected scoring run is not complete.", {
      scoring_run_status: scoringRun.status,
    });
  }
  if (
    scoringRun.scored_candidate_count !== scoringRun.expected_candidate_count ||
    scoringRun.failed_candidate_count !== 0
  ) {
    return deny("SCORING_RUN_NOT_ELIGIBLE", "The selected scoring run did not score every candidate.");
  }

  if (proposal.unassigned_candidate_count !== 0) {
    return deny("PROPOSAL_INCOMPLETE", "The proposal still has an unassigned candidate.");
  }
  if (proposal.unresolved_conflict_count !== 0) {
    return deny("PROPOSAL_CONFLICTS_UNRESOLVED", "The proposal still has an unresolved Calendar conflict.");
  }

  const slots = [...input.slots].sort((left, right) =>
    left.proposed_date < right.proposed_date ? -1
      : left.proposed_date > right.proposed_date ? 1
      : left.proposal_slot_key.localeCompare(right.proposal_slot_key)
  );
  if (slots.length !== proposal.expected_slot_count) {
    return deny("PROPOSAL_SNAPSHOT_MISMATCH", "The proposal slot set no longer matches its expected size.", {
      expected_slot_count: proposal.expected_slot_count,
      actual_slot_count: slots.length,
    });
  }
  if (proposal.assigned_slot_count !== proposal.expected_slot_count) {
    return deny("PROPOSAL_INCOMPLETE", "Not every proposal slot carries a candidate.");
  }

  const unsupported = findUnsupportedCommitSlots(
    slots.map((slot) => ({
      proposal_slot_key: slot.proposal_slot_key,
      required_asset_type: slot.required_asset_type,
    })),
  );
  if (unsupported.length > 0) {
    return deny(
      "UNSUPPORTED_ASSET_TYPE",
      "The proposal contains an asset type Stage 4 cannot commit.",
      { unsupported_slots: unsupported },
    );
  }

  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const scoreById = new Map(input.scores.map((score) => [score.id, score]));
  const seenSlotKeys = new Set<string>();
  const seenCandidates = new Set<string>();

  for (const slot of slots) {
    if (slot.proposal_id !== proposal.id || slot.client_id !== input.clientId) {
      return deny("PROPOSAL_SNAPSHOT_MISMATCH", "A proposal slot does not belong to this proposal.");
    }
    if (slot.ideation_cycle_id !== cycle.id || slot.scoring_run_id !== scoringRun.id) {
      return deny("PROPOSAL_SNAPSHOT_MISMATCH", "A proposal slot references a different cycle or scoring run.");
    }
    if (seenSlotKeys.has(slot.proposal_slot_key)) {
      return deny("PROPOSAL_SNAPSHOT_MISMATCH", "A proposal slot key appears more than once.");
    }
    seenSlotKeys.add(slot.proposal_slot_key);

    if (slot.proposed_date < proposal.period_start || slot.proposed_date > proposal.period_end) {
      return deny("PROPOSAL_SNAPSHOT_MISMATCH", "A proposed date lies outside the Ideation period.", {
        proposal_slot_key: slot.proposal_slot_key,
      });
    }
    if (!slot.candidate_id || !slot.candidate_score_id) {
      return deny("PROPOSAL_INCOMPLETE", "A proposal slot has no candidate.", {
        proposal_slot_key: slot.proposal_slot_key,
      });
    }
    if (seenCandidates.has(slot.candidate_id)) {
      return deny("PROPOSAL_SNAPSHOT_MISMATCH", "A candidate is assigned to more than one slot.");
    }
    seenCandidates.add(slot.candidate_id);

    const target = resolveIdeationCommitTarget(slot.required_asset_type);
    if (!target) {
      return deny("UNSUPPORTED_ASSET_TYPE", "The proposal contains an unsupported asset type.", {
        proposal_slot_key: slot.proposal_slot_key,
        asset_type: slot.required_asset_type,
      });
    }
    if (slot.calendar_row_type !== target.calendar_row_type) {
      return deny("MASTER_MAPPING_INVALID", "A proposal slot's Calendar lane contradicts the target manifest.", {
        proposal_slot_key: slot.proposal_slot_key,
      });
    }

    const candidate = candidateById.get(slot.candidate_id);
    if (!candidate) {
      return deny("CANDIDATE_SNAPSHOT_MISMATCH", "A proposed candidate no longer exists.", {
        proposal_slot_key: slot.proposal_slot_key,
      });
    }
    if (candidate.client_id !== input.clientId || candidate.ideation_cycle_id !== cycle.id) {
      return deny("CANDIDATE_SNAPSHOT_MISMATCH", "A proposed candidate belongs to a different client or cycle.");
    }
    if (candidate.asset_type !== slot.required_asset_type || candidate.asset_type !== slot.candidate_asset_type_snapshot) {
      return deny("CANDIDATE_SNAPSHOT_MISMATCH", "A candidate's asset type no longer matches its slot.", {
        proposal_slot_key: slot.proposal_slot_key,
      });
    }
    if (candidate.input_hash !== slot.candidate_content_hash) {
      return deny("CANDIDATE_SNAPSHOT_MISMATCH", "A candidate changed after the proposal was approved.", {
        proposal_slot_key: slot.proposal_slot_key,
      });
    }

    const score = scoreById.get(slot.candidate_score_id);
    if (!score) {
      return deny("SCORE_SNAPSHOT_MISMATCH", "A candidate score no longer exists.", {
        proposal_slot_key: slot.proposal_slot_key,
      });
    }
    if (score.scoring_run_id !== scoringRun.id || score.client_id !== input.clientId) {
      return deny("SCORE_SNAPSHOT_MISMATCH", "A candidate score belongs to a different scoring run or client.");
    }
    if (score.candidate_id !== slot.candidate_id) {
      return deny("SCORE_SNAPSHOT_MISMATCH", "A candidate score references a different candidate.");
    }
    if (
      score.rank !== slot.candidate_rank_snapshot ||
      score.overall_score !== slot.candidate_score_snapshot ||
      score.candidate_content_hash !== slot.candidate_content_hash
    ) {
      return deny("SCORE_SNAPSHOT_MISMATCH", "A candidate score changed after the proposal was approved.", {
        proposal_slot_key: slot.proposal_slot_key,
      });
    }
  }

  if (seenSlotKeys.size !== proposal.expected_slot_count || seenCandidates.size !== proposal.expected_slot_count) {
    return deny("PROPOSAL_SNAPSHOT_MISMATCH", "Slots and candidates did not reconcile exactly.");
  }

  if (!input.authorityVerification.ok) {
    return deny(
      "AUTHORITY_SNAPSHOT_MISMATCH",
      input.authorityVerification.message,
    );
  }

  if (proposal.calendar_conflict_digest !== input.currentCalendarDigest) {
    return deny(
      "CALENDAR_SNAPSHOT_STALE",
      "The operational Calendar changed after the proposal was approved. Refresh conflicts and review again.",
    );
  }

  return { ok: true, slots };
}
