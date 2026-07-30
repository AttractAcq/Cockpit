// Ideation Stage 4 — commit configuration snapshot and idempotency hash.
//
// The snapshot is the auditable record of every material commit input. The hash
// derived from it is server-owned: the caller can neither supply nor influence
// it. Any change to a candidate, score, date, asset type, proposal revision,
// Calendar state, or mapping version produces a different hash.

import { sha256, stableJson } from "../hash.ts";
import {
  IDEATION_COMMIT_MAPPING_VERSION,
  IDEATION_COMMIT_MODULE_VERSION,
  IDEATION_COMMIT_OUTPUT_SCHEMA_VERSION,
  IDEATION_COMMIT_REFERENCE_ALLOCATOR_VERSION,
  IDEATION_COMMIT_TARGET_MANIFEST_VERSION,
  resolveIdeationCommitTarget,
} from "./targets.ts";
import type { CommitCycleRow, CommitProposalRow, CommitScoringRunRow, CommitSlotRow } from "./eligibility.ts";

export interface CommitConfigurationInput {
  clientId: string;
  cycle: CommitCycleRow;
  scoringRun: CommitScoringRunRow;
  proposal: CommitProposalRow;
  slots: CommitSlotRow[];
  authorityIdentities: Array<{ id: string; version: number; classification: string; hash: string }>;
  currentCalendarDigest: string;
}

/**
 * Bounded, ordered, fully auditable commit input. No authority body, no
 * candidate body, no secret, and nothing volatile (no request id, token,
 * worker id, or execution timestamp) is included.
 */
export function buildCommitConfigurationSnapshot(input: CommitConfigurationInput): Record<string, unknown> {
  const slots = [...input.slots].sort((left, right) =>
    left.proposed_date < right.proposed_date ? -1
      : left.proposed_date > right.proposed_date ? 1
      : left.proposal_slot_key.localeCompare(right.proposal_slot_key)
  );

  return {
    stage: "ideation.stage4.commit",
    client_id: input.clientId,

    ideation_cycle_id: input.cycle.id,
    cycle_configuration_hash: input.cycle.input_hash,

    scoring_run_id: input.scoringRun.id,
    scoring_configuration_hash: input.scoringRun.configuration_hash,

    proposal_id: input.proposal.id,
    proposal_configuration_hash: input.proposal.configuration_hash,
    proposal_version: input.proposal.proposal_version,
    proposal_edit_revision: input.proposal.edit_revision,
    proposal_approved_at: input.proposal.approved_at,
    proposal_approved_by: input.proposal.approved_by,

    period_start: input.proposal.period_start,
    period_end: input.proposal.period_end,
    expected_item_count: slots.length,

    items: slots.map((slot) => {
      const target = resolveIdeationCommitTarget(slot.required_asset_type);
      return {
        proposal_slot_id: slot.id,
        proposal_slot_key: slot.proposal_slot_key,
        proposed_date: slot.proposed_date,
        asset_type: slot.required_asset_type,
        calendar_row_type: slot.calendar_row_type,
        candidate_id: slot.candidate_id,
        candidate_content_hash: slot.candidate_content_hash,
        candidate_score_id: slot.candidate_score_id,
        candidate_rank: slot.candidate_rank_snapshot,
        candidate_score: slot.candidate_score_snapshot,
        // Null is impossible for an eligible proposal; recording it rather than
        // throwing keeps the snapshot a faithful record of what was seen.
        target_master_table: target?.master_table ?? null,
        target_type_code: target?.type_code ?? null,
      };
    }),

    authority_identities: [...input.authorityIdentities]
      .map((entry) => ({
        id: entry.id,
        version: entry.version,
        classification: entry.classification,
        hash: entry.hash,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),

    calendar_digest: input.currentCalendarDigest,

    target_manifest_version: IDEATION_COMMIT_TARGET_MANIFEST_VERSION,
    mapping_version: IDEATION_COMMIT_MAPPING_VERSION,
    reference_allocator_version: IDEATION_COMMIT_REFERENCE_ALLOCATOR_VERSION,
    output_schema_version: IDEATION_COMMIT_OUTPUT_SCHEMA_VERSION,
    module_version: IDEATION_COMMIT_MODULE_VERSION,
  };
}

export function hashCommitConfiguration(snapshot: Record<string, unknown>): Promise<string> {
  return sha256(stableJson(snapshot));
}

/**
 * Server-derived idempotency key. It is a function of the proposal lineage and
 * the configuration hash only, so an identical request always resolves to the
 * same commit run.
 */
export function buildCommitIdempotencyKey(input: {
  proposalId: string;
  configurationHash: string;
}): string {
  return `commit:${input.proposalId}:${input.configurationHash.slice(0, 24)}`;
}
