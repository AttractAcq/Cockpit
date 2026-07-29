export type IdeationProposalStatus =
  | "running" | "retryable" | "failed" | "draft" | "approved" | "superseded";

export type IdeationConflictStatus =
  | "clear" | "occupied" | "protected" | "date_capacity_exceeded" | "stale_calendar_snapshot";

export type IdeationProposalAssetType = "reel" | "carousel" | "static" | "story";

export type IdeationProposalAction =
  | "create" | "retry" | "regenerate"
  | "move" | "swap" | "unassign" | "assign"
  | "refresh_conflicts" | "approve";

export interface IdeationCalendarProposal {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  scoring_run_id: string;
  status: IdeationProposalStatus;
  proposal_version: number;
  supersedes_proposal_id: string | null;
  configuration_hash: string;
  calendar_conflict_digest: string;
  slot_planner_version: string;
  provider: string;
  model: string;
  output_schema_version: string;
  module_version: string;
  period_start: string;
  period_end: string;
  expected_slot_count: number;
  assigned_slot_count: number;
  unassigned_candidate_count: number;
  conflict_count: number;
  unresolved_conflict_count: number;
  attempt_count: number;
  maximum_attempts: number;
  retryable: boolean;
  warnings: Array<{
    batch_index?: number;
    slot_keys?: string[];
    code?: string;
    message?: string;
    retryable?: boolean;
  }>;
  failure_code: string | null;
  failure_message: string | null;
  edit_revision: number;
  generated_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdeationProposalSlot {
  id: string;
  client_id: string;
  proposal_id: string;
  ideation_cycle_id: string;
  scoring_run_id: string;
  proposal_slot_key: string;
  proposed_date: string;
  period_start: string;
  period_end: string;
  date_slot_ordinal: number;
  required_asset_type: IdeationProposalAssetType;
  calendar_row_type: string;
  placement_basis: "execution_cadence" | "deterministic_spread";
  candidate_id: string | null;
  candidate_score_id: string | null;
  candidate_asset_type_snapshot: IdeationProposalAssetType | null;
  candidate_content_hash: string | null;
  candidate_rank_snapshot: number | null;
  candidate_score_snapshot: number | null;
  candidate_display_reference: string | null;
  placement_rationale: string | null;
  authority_references: string[];
  evidence_references: string[];
  slot_warnings: string[];
  conflict_status: IdeationConflictStatus;
  conflict_details: {
    matched_rows?: Array<{ id: string; ref: string; review_state: string; row_type: string }>;
    reason?: string | null;
  };
  placement_source: "model" | "manual" | "restored" | null;
  manually_edited: boolean;
  created_at: string;
  updated_at: string;
}

export interface IdeationProposalOverview {
  proposals: IdeationCalendarProposal[];
  slots: IdeationProposalSlot[];
}

export interface IdeationProposalRequest {
  action: IdeationProposalAction;
  client_id: string;
  ideation_cycle_id?: string;
  scoring_run_id?: string;
  proposal_id?: string;
  regenerate_from_proposal_id?: string;
  expected_edit_revision?: number;
  from_slot_key?: string;
  to_slot_key?: string;
  candidate_id?: string;
}

export interface IdeationProposalResponse {
  ok: true;
  action: IdeationProposalAction;
  created: boolean;
  idempotent_replay?: boolean;
  reclaimed?: boolean;
  proposal: IdeationCalendarProposal;
  slots: IdeationProposalSlot[];
}

export interface IdeationProposalInvocationFailure {
  code: string;
  message: string;
  retryable: boolean;
  proposal_id: string | null;
  ideation_cycle_id: string | null;
  scoring_run_id: string | null;
  proposal: IdeationCalendarProposal | null;
  proposal_status: IdeationProposalStatus | null;
  slots: IdeationProposalSlot[];
  expected_slot_count: number | null;
  assigned_slot_count: number | null;
  unassigned_candidate_count: number | null;
  conflict_count: number | null;
  unresolved_conflict_count: number | null;
  attempt_count: number | null;
  maximum_attempts: number | null;
  edit_revision: number | null;
  warnings: IdeationCalendarProposal["warnings"];
  terminal_reason: string | null;
  retry_allowed: boolean;
}

/** Conflict wording. Conflict state is always conveyed as text, never colour. */
export const IDEATION_CONFLICT_LABELS: Record<IdeationConflictStatus, string> = {
  clear: "No conflict",
  occupied: "Date already has unapproved content",
  protected: "Blocked: approved content already on this date",
  date_capacity_exceeded: "Blocked: too many placements on this date",
  stale_calendar_snapshot: "Blocked: Calendar changed since generation",
};

export const IDEATION_BLOCKING_CONFLICTS: IdeationConflictStatus[] = [
  "protected",
  "date_capacity_exceeded",
  "stale_calendar_snapshot",
];

export function isBlockingConflictStatus(status: IdeationConflictStatus): boolean {
  return IDEATION_BLOCKING_CONFLICTS.includes(status);
}
