// Programme Stage O — Multi-Client Scale and Operational Control, frontend types.

export type StaffRole = "admin" | "account_manager" | "strategist" | "content_operator" | "editor" | "media_buyer" | "analyst";
export type UserRole = StaffRole | "client_approver" | "client";

export const STAFF_ROLES: StaffRole[] = ["admin", "account_manager", "strategist", "content_operator", "editor", "media_buyer", "analyst"];
export const ALL_ROLES: UserRole[] = [...STAFF_ROLES, "client_approver", "client"];

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin", account_manager: "Account Manager", strategist: "Strategist", content_operator: "Content Operator",
  editor: "Motion Designer / Editor", media_buyer: "Media Buyer", analyst: "Analyst",
  client_approver: "Client Approver", client: "Read-only Stakeholder (client portal)",
};

export interface TeamMemberRow {
  id: string;
  user_id: string;
  client_id: string;
  created_at: string;
}

export type WorkItemPriority = "low" | "normal" | "high" | "urgent";
export type WorkItemStatus = "open" | "in_progress" | "blocked" | "review" | "done";

export interface ClientWorkItemRow {
  id: string;
  client_id: string;
  source_system: string | null;
  source_table: string | null;
  source_id: string | null;
  title: string;
  description: string | null;
  assignee_id: string | null;
  review_owner_id: string | null;
  due_at: string | null;
  priority: WorkItemPriority;
  capacity_estimate_hours: number | null;
  sla_hours: number | null;
  status: WorkItemStatus;
  is_blocked: boolean;
  blocked_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  project_id: string | null;
}

// Stage 2 Phase 07 — Delivery/Operations. The grouping missing above
// individual client_work_items rows. Tasks stay on client_work_items
// (project_id above); Deliverables get their own client-facing
// review/approval state.
export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "archived";
export type DeliverableStatus = "draft" | "in_review" | "delivered" | "approved" | "rejected";

export interface ClientProjectRow {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  owner_id: string | null;
  started_at: string | null;
  target_completion_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientDeliverableRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  status: DeliverableStatus;
  owner_id: string | null;
  due_at: string | null;
  link: string | null;
  delivered_at: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CostCategory = "model_spend" | "storage" | "rendering" | "human_time" | "ad_management_time" | "revision_cost" | "fulfilment_cost";

export const COST_CATEGORIES: CostCategory[] = ["model_spend", "storage", "rendering", "human_time", "ad_management_time", "revision_cost", "fulfilment_cost"];
export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  model_spend: "Model spend", storage: "Storage", rendering: "Rendering", human_time: "Human time",
  ad_management_time: "Ad-management time", revision_cost: "Revision cost", fulfilment_cost: "Fulfilment cost",
};

export interface ClientCostLedgerRow {
  id: string;
  client_id: string;
  cost_category: CostCategory;
  amount: number;
  currency: string;
  source_system: string | null;
  source_table: string | null;
  source_id: string | null;
  occurred_at: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ClientMarginSummaryRow {
  client_id: string;
  client_name: string;
  monthly_revenue_estimate: number | null;
  total_cost: number;
  estimated_margin: number | null;
  cost_by_category: Partial<Record<CostCategory, number>> | null;
}

export interface ClientOnboardingTemplateRow {
  id: string;
  name: string;
  description: string | null;
  default_automation_policies: Array<{ area: string; automation_level: string; thresholds?: Record<string, unknown> }>;
  default_capacity_policy: Record<string, unknown>;
  default_content_requirements: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Stage 2 Phase 01 — Command Center. Manually-authored, cross-business
// (not client-scoped) bottleneck/priority notes. AI inference for this is
// deliberately deferred by the build plan until the manual version is trusted.
export type CommandCenterNoteCategory = "bottleneck" | "priority";

export interface CommandCenterNoteRow {
  id: string;
  category: CommandCenterNoteCategory;
  body: string;
  created_by: string | null;
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
}
