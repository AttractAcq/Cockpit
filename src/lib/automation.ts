// Programme Stage N — Automation and Fulfilment Orchestration data access.
// RPCs called directly via supabase.rpc(...), matching the established
// convention for this class of policy/review operation (Gate B-G, Stage M's
// analytics/iteration RPCs) rather than wrapping each in an edge function.

import { supabase } from "./supabase";
import type {
  AutomationArea, AutomationLevel, ClientAutomationPolicyRow, ClientCapacityPolicyRow, ClientPriority,
  ExceptionType, ExceptionStatus, ExceptionSeverity, ClientExceptionQueueRow,
} from "@/types/automation";

export async function fetchAutomationPolicies(clientId: string): Promise<ClientAutomationPolicyRow[]> {
  const { data, error } = await supabase.from("client_automation_policies").select("*").eq("client_id", clientId);
  if (error) throw error;
  return (data ?? []) as ClientAutomationPolicyRow[];
}

export async function setAutomationPolicy(input: {
  clientId: string; area: AutomationArea; automationLevel: AutomationLevel; thresholds?: Record<string, unknown>;
}): Promise<ClientAutomationPolicyRow> {
  const { data, error } = await supabase.rpc("set_client_automation_policy", {
    p_client_id: input.clientId, p_area: input.area, p_automation_level: input.automationLevel, p_thresholds: input.thresholds ?? {},
  });
  if (error) throw error;
  return data as ClientAutomationPolicyRow;
}

export async function fetchCapacityPolicy(clientId: string): Promise<ClientCapacityPolicyRow | null> {
  const { data, error } = await supabase.from("client_capacity_policies").select("*").eq("client_id", clientId).maybeSingle();
  if (error) throw error;
  return (data as ClientCapacityPolicyRow | null) ?? null;
}

export async function setCapacityPolicy(input: {
  clientId: string; monthlyGenerationBudgetUnits?: number | null; perAssetBudgetUnits?: number | null;
  providerCreditBudgetUnits?: number | null; maxSimultaneousJobs?: number | null; humanReviewCapacityPerDay?: number | null;
  clientPriority?: ClientPriority; dueDatePriorityEnabled?: boolean; retryCap?: number;
}): Promise<ClientCapacityPolicyRow> {
  const { data, error } = await supabase.rpc("set_client_capacity_policy", {
    p_client_id: input.clientId,
    p_monthly_generation_budget_units: input.monthlyGenerationBudgetUnits ?? null,
    p_per_asset_budget_units: input.perAssetBudgetUnits ?? null,
    p_provider_credit_budget_units: input.providerCreditBudgetUnits ?? null,
    p_max_simultaneous_jobs: input.maxSimultaneousJobs ?? null,
    p_human_review_capacity_per_day: input.humanReviewCapacityPerDay ?? null,
    p_client_priority: input.clientPriority ?? "normal",
    p_due_date_priority_enabled: input.dueDatePriorityEnabled ?? true,
    p_retry_cap: input.retryCap ?? 5,
  });
  if (error) throw error;
  return data as ClientCapacityPolicyRow;
}

export async function fetchExceptionQueue(clientId: string, status?: ExceptionStatus): Promise<ClientExceptionQueueRow[]> {
  let query = supabase.from("client_exception_queue").select("*").eq("client_id", clientId).order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ClientExceptionQueueRow[];
}

export async function fileException(input: {
  clientId: string; exceptionType: ExceptionType; sourceSystem: string; sourceTable?: string | null; sourceId?: string | null;
  title: string; summary: string; severity?: ExceptionSeverity; metadata?: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await supabase.rpc("file_exception", {
    p_client_id: input.clientId, p_exception_type: input.exceptionType, p_source_system: input.sourceSystem,
    p_source_table: input.sourceTable ?? null, p_source_id: input.sourceId ?? null,
    p_title: input.title, p_summary: input.summary, p_severity: input.severity ?? "medium", p_metadata: input.metadata ?? {},
  });
  if (error) throw error;
  return data as string;
}

export async function resolveException(exceptionId: string, newStatus: "acknowledged" | "resolved", resolutionNotes?: string | null): Promise<void> {
  const { error } = await supabase.rpc("resolve_exception", { p_exception_id: exceptionId, p_new_status: newStatus, p_resolution_notes: resolutionNotes ?? null });
  if (error) throw error;
}
