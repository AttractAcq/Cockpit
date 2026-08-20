// Stage 2 Phase 11 — Opportunity OS. A human-reviewed Detect/Score/Explain
// finding, deterministically computed from real Finance/Sales/Marketing
// tables. Mirrors opportunity_os_findings' columns exactly.

export type OpportunityFindingType = "margin_risk" | "stalled_lead" | "underperforming_channel";
export type OpportunityFindingStatus = "pending_review" | "confirmed_useful" | "dismissed";

export interface OpportunityFindingRow {
  id: string;
  client_id: string;
  finding_type: OpportunityFindingType;
  title: string;
  explanation: string;
  score: number;
  source_refs: { table: string; id: string }[];
  status: OpportunityFindingStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  generated_at: string;
}
