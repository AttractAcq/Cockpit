// Programme Stage G — Calendar Planning and Operational Commitment.

export type CalendarProposalStatus = "draft" | "approved" | "superseded";
export type CalendarProposalMode = "manual" | "assisted" | "automatic";
export type ProposalConflictStatus = "clear" | "occupied" | "protected" | "stale_snapshot";
export type ProposalPlacementSource = "model" | "manual" | "restored";
export type ProposalEditAction = "move" | "swap" | "remove" | "restore";

export interface ContentCalendarProposal {
  id: string;
  client_id: string;
  period_start: string;
  period_end: string;
  status: CalendarProposalStatus;
  mode: CalendarProposalMode;
  edit_revision: number;
  generated_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentCalendarProposalSlot {
  id: string;
  client_id: string;
  proposal_id: string;
  calendar_slot_id: string;
  content_opportunity_id: string | null;
  original_content_opportunity_id: string | null;
  match_score: number | null;
  match_rationale: string | null;
  conflict_status: ProposalConflictStatus;
  conflict_details: Record<string, unknown>;
  placement_source: ProposalPlacementSource | null;
  manually_edited: boolean;
  created_at: string;
  updated_at: string;
}

export const PROPOSAL_CONFLICT_LABELS: Record<ProposalConflictStatus, string> = {
  clear: "No conflict",
  occupied: "Slot already has an unapproved assignment elsewhere",
  protected: "Blocked: Slot already committed",
  stale_snapshot: "Blocked: Calendar changed since this proposal was generated",
};

export interface CreateCalendarProposalInput {
  clientId: string;
  periodStart: string;
  periodEnd: string;
  mode?: CalendarProposalMode;
}

export interface CreateCalendarProposalResponse {
  ok: true;
  proposal_id: string;
  edit_revision: number;
  slots: ContentCalendarProposalSlot[];
  slot_count: number;
  assigned_count: number;
}

export interface UpdateCalendarProposalSlotInput {
  clientId: string;
  proposalId: string;
  action: ProposalEditAction;
  expectedEditRevision: number;
  fromSlotId?: string;
  toSlotId?: string;
  slotId?: string;
}

export interface UpdateCalendarProposalSlotResponse {
  ok: true;
  proposal_id: string;
  action: ProposalEditAction;
  edit_revision: number;
}

export interface ApproveCalendarProposalInput {
  clientId: string;
  proposalId: string;
  expectedEditRevision: number;
}

export interface ApproveCalendarProposalResponse {
  ok: true;
  proposal_id: string;
  created_content_item_ids: string[];
}
