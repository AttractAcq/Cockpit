// Programme Stage O — Multi-Client Scale and Operational Control data
// access. RPCs called directly via supabase.rpc(...), matching the
// established convention for this class of administrative operation
// (Gate B-G, Stage M/N).

import { supabase } from "./supabase";
import type {
  ClientWorkItemRow, WorkItemStatus, WorkItemPriority, ClientCostLedgerRow, CostCategory,
  ClientMarginSummaryRow, ClientOnboardingTemplateRow, TeamMemberRow,
  ClientProjectRow, ProjectStatus, ClientDeliverableRow, DeliverableStatus,
  ClientFinancePeriodRow,
} from "@/types/operations";
import type { ParsedCostEntry } from "./finance-csv";

// ── Team / roles ─────────────────────────────────────────────────────────────

export interface StaffUserRow { id: string; full_name: string | null; email: string | null; role: string }

/** Visible rows are exactly what RLS permits (admin sees all users; anyone else sees only themselves) — never widened client-side. */
export async function fetchStaffUsers(): Promise<StaffUserRow[]> {
  const { data, error } = await supabase.from("users").select("id, full_name, email, role").order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as StaffUserRow[];
}

export async function fetchTeamMembers(clientId?: string): Promise<TeamMemberRow[]> {
  let query = supabase.from("team_members").select("*").order("created_at", { ascending: false });
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as TeamMemberRow[];
}

export async function assignTeamMember(userId: string, clientId: string): Promise<void> {
  const { error } = await supabase.from("team_members").insert({ user_id: userId, client_id: clientId });
  if (error) throw error;
}

export async function removeTeamMember(teamMemberId: string): Promise<void> {
  const { error } = await supabase.from("team_members").delete().eq("id", teamMemberId);
  if (error) throw error;
}

// ── Work items ───────────────────────────────────────────────────────────────

export async function fetchWorkItems(clientId?: string, status?: WorkItemStatus): Promise<ClientWorkItemRow[]> {
  let query = supabase.from("client_work_items").select("*").order("created_at", { ascending: false });
  if (clientId) query = query.eq("client_id", clientId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ClientWorkItemRow[];
}

export async function createWorkItem(input: {
  clientId: string; title: string; description?: string | null; sourceSystem?: string | null; sourceTable?: string | null;
  sourceId?: string | null; assigneeId?: string | null; reviewOwnerId?: string | null; dueAt?: string | null;
  priority?: WorkItemPriority; capacityEstimateHours?: number | null; slaHours?: number | null; projectId?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_work_item", {
    p_client_id: input.clientId, p_title: input.title, p_description: input.description ?? null,
    p_source_system: input.sourceSystem ?? null, p_source_table: input.sourceTable ?? null, p_source_id: input.sourceId ?? null,
    p_assignee_id: input.assigneeId ?? null, p_review_owner_id: input.reviewOwnerId ?? null, p_due_at: input.dueAt ?? null,
    p_priority: input.priority ?? "normal", p_capacity_estimate_hours: input.capacityEstimateHours ?? null, p_sla_hours: input.slaHours ?? null,
    p_project_id: input.projectId ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function updateWorkItemStatus(workItemId: string, newStatus: WorkItemStatus, blockedReason?: string | null): Promise<void> {
  const { error } = await supabase.rpc("update_work_item_status", { p_work_item_id: workItemId, p_new_status: newStatus, p_blocked_reason: blockedReason ?? null });
  if (error) throw error;
}

export async function assignWorkItem(workItemId: string, assigneeId: string | null): Promise<void> {
  const { error } = await supabase.rpc("assign_work_item", { p_work_item_id: workItemId, p_assignee_id: assigneeId });
  if (error) throw error;
}

// ── Cost & margin ────────────────────────────────────────────────────────────

export async function fetchCostLedger(clientId: string): Promise<ClientCostLedgerRow[]> {
  const { data, error } = await supabase.from("client_cost_ledger").select("*").eq("client_id", clientId).order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClientCostLedgerRow[];
}

export async function fetchMarginSummary(): Promise<ClientMarginSummaryRow[]> {
  const { data, error } = await supabase.from("client_margin_summary").select("*").order("client_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ClientMarginSummaryRow[];
}

export async function recordCostEntry(input: {
  clientId: string; costCategory: CostCategory; amount: number; currency?: string; sourceSystem?: string | null;
  sourceTable?: string | null; sourceId?: string | null; occurredAt?: string; notes?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("record_cost_entry", {
    p_client_id: input.clientId, p_cost_category: input.costCategory, p_amount: input.amount, p_currency: input.currency ?? "EUR",
    p_source_system: input.sourceSystem ?? null, p_source_table: input.sourceTable ?? null, p_source_id: input.sourceId ?? null,
    p_occurred_at: input.occurredAt ?? new Date().toISOString(), p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function setClientRevenueEstimate(clientId: string, monthlyRevenueEstimate: number | null): Promise<void> {
  const { error } = await supabase.from("clients").update({ monthly_revenue_estimate: monthlyRevenueEstimate }).eq("id", clientId);
  if (error) throw error;
}

// ── Onboarding ───────────────────────────────────────────────────────────────

export async function fetchOnboardingTemplates(): Promise<ClientOnboardingTemplateRow[]> {
  const { data, error } = await supabase.from("client_onboarding_templates").select("*").order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ClientOnboardingTemplateRow[];
}

export async function createOnboardingTemplate(input: {
  name: string; description?: string | null;
  defaultAutomationPolicies: Array<{ area: string; automation_level: string }>;
  defaultCapacityPolicy: Record<string, unknown>;
  defaultContentRequirements: string[];
}): Promise<ClientOnboardingTemplateRow> {
  const { data, error } = await supabase.from("client_onboarding_templates").insert({
    name: input.name, description: input.description ?? null,
    default_automation_policies: input.defaultAutomationPolicies, default_capacity_policy: input.defaultCapacityPolicy,
    default_content_requirements: input.defaultContentRequirements,
  }).select("*").single();
  if (error) throw error;
  return data as ClientOnboardingTemplateRow;
}

export async function onboardClient(input: {
  name: string; slug: string; packageTier?: string; templateId?: string | null; accountManagerId?: string | null; geography?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("onboard_client", {
    p_name: input.name, p_slug: input.slug, p_package_tier: input.packageTier ?? "proof_sprint",
    p_template_id: input.templateId ?? null, p_account_manager_id: input.accountManagerId ?? null, p_geography: input.geography ?? null,
  });
  if (error) throw error;
  return data as string;
}

// ── Projects & Deliverables ──────────────────────────────────────────────────
// Stage 2 Phase 07. Tasks reuse client_work_items above (project_id) rather
// than a third new table.

export async function fetchProjects(clientId?: string): Promise<ClientProjectRow[]> {
  let query = supabase.from("client_projects").select("*").order("created_at", { ascending: false });
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ClientProjectRow[];
}

export async function createProject(input: {
  clientId: string; name: string; description?: string | null; ownerId?: string | null;
  startedAt?: string | null; targetCompletionAt?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_project", {
    p_client_id: input.clientId, p_name: input.name, p_description: input.description ?? null,
    p_owner_id: input.ownerId ?? null, p_started_at: input.startedAt ?? null, p_target_completion_at: input.targetCompletionAt ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function updateProjectStatus(projectId: string, newStatus: ProjectStatus): Promise<void> {
  const { error } = await supabase.rpc("update_project_status", { p_project_id: projectId, p_new_status: newStatus });
  if (error) throw error;
}

export async function fetchDeliverables(projectId: string): Promise<ClientDeliverableRow[]> {
  const { data, error } = await supabase.from("client_deliverables").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClientDeliverableRow[];
}

export async function createDeliverable(input: {
  projectId: string; name: string; description?: string | null; ownerId?: string | null; dueAt?: string | null; link?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_deliverable", {
    p_project_id: input.projectId, p_name: input.name, p_description: input.description ?? null,
    p_owner_id: input.ownerId ?? null, p_due_at: input.dueAt ?? null, p_link: input.link ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function updateDeliverableStatus(deliverableId: string, newStatus: DeliverableStatus, link?: string | null): Promise<void> {
  const { error } = await supabase.rpc("update_deliverable_status", { p_deliverable_id: deliverableId, p_new_status: newStatus, p_link: link ?? null });
  if (error) throw error;
}

// ── Finance periods & CSV import ─────────────────────────────────────────────
// Stage 2 Phase 08. Extends Stage O's client_cost_ledger/client_margin_summary
// -- a real accounting period with a reconciliation step, distinct from the
// mutable clients.monthly_revenue_estimate.

export async function fetchFinancePeriods(clientId?: string): Promise<ClientFinancePeriodRow[]> {
  let query = supabase.from("client_finance_periods").select("*").order("period_start", { ascending: false });
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ClientFinancePeriodRow[];
}

export async function openFinancePeriod(input: { clientId: string; periodStart: string; periodEnd: string; notes?: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("open_finance_period", {
    p_client_id: input.clientId, p_period_start: input.periodStart, p_period_end: input.periodEnd, p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function reconcileFinancePeriod(periodId: string, actualRevenue: number, notes?: string | null): Promise<void> {
  const { error } = await supabase.rpc("reconcile_finance_period", { p_period_id: periodId, p_actual_revenue: actualRevenue, p_notes: notes ?? null });
  if (error) throw error;
}

export async function importCostEntries(clientId: string, entries: ParsedCostEntry[]): Promise<number> {
  const { data, error } = await supabase.rpc("import_cost_entries", { p_client_id: clientId, p_entries: entries });
  if (error) throw error;
  return data as number;
}
