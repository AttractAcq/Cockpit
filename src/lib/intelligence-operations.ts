import { supabase } from "./supabase";
import type { IntelligenceDomain } from "@/types/intelligence";
import type {
  IntelligenceChangeProposal,
  IntelligenceConsumption,
  IntelligenceOperationalStatus,
  IntelligenceRefreshRequest,
} from "@/types/intelligence-operations";

async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw error;
  return (data as T[] | null) ?? [];
}

export async function fetchIntelligenceOperationalStatus(): Promise<IntelligenceOperationalStatus[]> {
  return rows<IntelligenceOperationalStatus>(supabase
    .from("client_intelligence_operational_status")
    .select("*")
    .order("client_name")
    .order("intelligence_domain"));
}

export async function fetchIntelligenceRefreshRequests(): Promise<IntelligenceRefreshRequest[]> {
  return rows<IntelligenceRefreshRequest>(supabase
    .from("client_intelligence_refresh_requests")
    .select("*")
    .order("requested_at", { ascending: false })
    .limit(200));
}

export async function fetchIntelligenceChangeProposals(): Promise<IntelligenceChangeProposal[]> {
  return rows<IntelligenceChangeProposal>(supabase
    .from("client_intelligence_change_proposals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200));
}

export async function fetchIntelligenceConsumptions(): Promise<IntelligenceConsumption[]> {
  return rows<IntelligenceConsumption>(supabase
    .from("client_intelligence_consumptions")
    .select("*")
    .order("consumed_at", { ascending: false })
    .limit(200));
}

export async function requestIntelligenceRefresh(
  clientId: string,
  domain: IntelligenceDomain,
  reason: string,
): Promise<IntelligenceRefreshRequest> {
  const { data, error } = await supabase.rpc("request_intelligence_refresh", {
    p_client_id: clientId,
    p_intelligence_domain: domain,
    p_reason: reason,
  });
  if (error) throw error;
  return data as IntelligenceRefreshRequest;
}

export async function createIntelligenceChangeProposal(input: {
  clientId: string;
  targetKind: "context" | "intelligence";
  targetDomain: IntelligenceDomain | null;
  proposalType: IntelligenceChangeProposal["proposal_type"];
  title: string;
  summary: string;
  rationale: string;
  priority: IntelligenceChangeProposal["priority"];
}): Promise<IntelligenceChangeProposal> {
  const { data, error } = await supabase.rpc("create_intelligence_change_proposal", {
    p_client_id: input.clientId,
    p_target_kind: input.targetKind,
    p_target_domain: input.targetDomain,
    p_target_release_id: null,
    p_proposal_type: input.proposalType,
    p_title: input.title,
    p_summary: input.summary,
    p_rationale: input.rationale,
    p_evidence: {},
    p_priority: input.priority,
    p_source_type: "operator_feedback",
    p_source_key: null,
  });
  if (error) throw error;
  return data as IntelligenceChangeProposal;
}

export async function reviewIntelligenceChangeProposal(
  proposalId: string,
  decision: "approved" | "dismissed" | "converted_to_draft",
  note?: string,
): Promise<IntelligenceChangeProposal> {
  const { data, error } = await supabase.rpc("review_intelligence_change_proposal", {
    p_proposal_id: proposalId,
    p_decision: decision,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as IntelligenceChangeProposal;
}
