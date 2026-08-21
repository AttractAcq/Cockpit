// Stage 2 Phase 06 — Sales. The additive pipeline: Leads -> Conversations ->
// Opportunities -> Follow-Up -> Closing. Deliberately thin: no
// forecasting/quota columns yet (Stage 2 build plan, Principle 01).

export type SalesLeadStage = "lead" | "conversation" | "opportunity" | "follow_up" | "closed_won" | "closed_lost";

export const SALES_STAGE_LABEL: Record<SalesLeadStage, string> = {
  lead: "Lead", conversation: "Conversation", opportunity: "Opportunity",
  follow_up: "Follow-Up", closed_won: "Closed Won", closed_lost: "Closed Lost",
};

export interface SalesLeadRow {
  id: string;
  business_id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  source: string | null;
  estimated_value_cents: number | null;
  stage: SalesLeadStage;
  assignee_id: string | null;
  lost_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  /** Cockpit v3 Step 4: folded onto the lead rather than a separate
   * sales_companies table -- see that migration's header for the trace. */
  company: string | null;
  /** Cockpit v3 Step 4: presentational only, no reminder/notification infra. */
  follow_up_at: string | null;
}

export interface SalesConversationRow {
  id: string;
  lead_id: string;
  channel: string;
  summary: string;
  occurred_at: string;
  logged_by: string | null;
  created_at: string;
}

// Cockpit v3 Step 4 — Sales proposals. A lead may have zero, one, or several
// over its lifetime, which is why this is its own table rather than columns
// on sales_leads.
export type SalesProposalStatus = "draft" | "sent" | "accepted" | "declined";

export const SALES_PROPOSAL_STATUS_LABEL: Record<SalesProposalStatus, string> = {
  draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined",
};

export interface SalesProposalRow {
  id: string;
  lead_id: string;
  title: string;
  amount_cents: number | null;
  status: SalesProposalStatus;
  sent_at: string | null;
  responded_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
