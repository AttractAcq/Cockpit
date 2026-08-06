// Programme Stage D — Phase 2 executable contract data access.
//
// Reads go direct to Supabase under RLS. Both writes — generation and approval
// — go through edge functions, so the browser can never write a config, mark
// one approved, or create a calendar slot directly.

import { supabase, invokeFn } from "./supabase";
import type {
  ClientExecutionConfigRow,
  ExecutionConfigCheck,
  ReconciliationStatus,
} from "@/types/execution-config";

export interface ExecutionConfigCheckRow extends ExecutionConfigCheck {
  id: string;
  execution_config_id: string;
  source_execution_file_id: string | null;
  created_at: string;
}

export interface DerivedRequirementRow {
  id: string;
  client_id: string;
  execution_config_id: string | null;
  period_start: string;
  period_end: string;
  platform: string | null;
  asset_format: string;
  channel: string;
  required_count: number;
  fulfilled_count: number;
  cadence: string | null;
  objective_mix: Record<string, number>;
  preferred_origins: Record<string, number>;
  requirement_set_version: number;
}

export interface DerivedSlotRow {
  id: string;
  content_requirement_id: string;
  scheduled_for: string;
  slot_index: number;
  status: "open" | "reserved" | "filled" | "cancelled";
  platform: string | null;
  objective: string | null;
  content_pillar: string | null;
  funnel_stage: string | null;
  offer_ref: string | null;
  preferred_source_type: string | null;
  required_proof_strength: string | null;
  approval_policy: string;
  is_operational: boolean;
}

export interface ExecutionMarkdownFile {
  id: string;
  file_number: number;
  file_name: string;
  content_md: string;
  review_state: string;
  version: number;
}

/** Every config for a client and month, newest version first. */
export async function listExecutionConfigs(
  clientId: string,
  executionMonth: string,
): Promise<ClientExecutionConfigRow[]> {
  const { data, error } = await supabase
    .from("client_execution_configs")
    .select("*")
    .eq("client_id", clientId)
    .eq("execution_month", executionMonth)
    .order("config_version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClientExecutionConfigRow[];
}

/** The reconciliation evidence behind one config. */
export async function listExecutionConfigChecks(
  executionConfigId: string,
): Promise<ExecutionConfigCheckRow[]> {
  const { data, error } = await supabase
    .from("client_execution_config_checks")
    .select("*")
    .eq("execution_config_id", executionConfigId)
    .order("check_code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ExecutionConfigCheckRow[];
}

/**
 * The approved Execution Markdown the config was derived from. This is the
 * human-readable half of the side-by-side review — the operator compares the
 * document they approved against the structured values taken from it.
 */
export async function listApprovedExecutionFiles(
  clientId: string,
  executionMonth: string,
): Promise<ExecutionMarkdownFile[]> {
  const { data, error } = await supabase
    .from("client_execution_files")
    .select("id, file_number, file_name, content_md, review_state, version")
    .eq("client_id", clientId)
    .eq("month", executionMonth)
    .eq("review_state", "approved")
    .order("file_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ExecutionMarkdownFile[];
}

export async function listDerivedRequirements(
  executionConfigId: string,
): Promise<DerivedRequirementRow[]> {
  const { data, error } = await supabase
    .from("content_requirements")
    .select("*")
    .eq("execution_config_id", executionConfigId)
    .order("asset_format", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DerivedRequirementRow[];
}

export async function listSlotsForRequirements(
  requirementIds: readonly string[],
): Promise<DerivedSlotRow[]> {
  if (requirementIds.length === 0) return [];
  const { data, error } = await supabase
    .from("calendar_slots")
    .select("*")
    .in("content_requirement_id", requirementIds as string[])
    .order("scheduled_for", { ascending: true })
    .order("slot_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DerivedSlotRow[];
}

export interface GenerateExecutionConfigResult {
  unchanged: boolean;
  execution_config_id: string;
  config_version: number;
  status: string;
  reconciliation_status?: ReconciliationStatus;
  requirement_count?: number;
  total_quantity?: number;
  message?: string;
}

export async function generateExecutionConfig(
  clientId: string,
  executionMonth: string,
): Promise<GenerateExecutionConfigResult> {
  return await invokeFn<GenerateExecutionConfigResult>("generate-execution-config", {
    client_id: clientId,
    execution_month: executionMonth,
  });
}

export interface ApproveExecutionConfigResult {
  execution_config_id: string;
  status?: string;
  already_approved?: boolean;
  superseded_config_ids?: string[];
  requirements_derived?: number;
  requirements_created?: number;
  slots_written?: number;
}

export async function approveExecutionConfig(
  executionConfigId: string,
): Promise<ApproveExecutionConfigResult> {
  return await invokeFn<ApproveExecutionConfigResult>("approve-execution-config", {
    execution_config_id: executionConfigId,
  });
}
