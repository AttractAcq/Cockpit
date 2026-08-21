// Stage 2 Phase 06 — Sales data access. Reads leads/conversations directly
// (RLS-scoped, staff-only); writes go through the staff-gated RPCs, matching
// the established direct-supabase.rpc(...) convention for this class of
// administrative operation.

import { supabase } from "./supabase";
import type { SalesLeadRow, SalesConversationRow, SalesLeadStage, SalesProposalRow, SalesProposalStatus } from "@/types/sales";

export async function fetchSalesLeads(businessId?: string): Promise<SalesLeadRow[]> {
  let query = supabase.from("sales_leads").select("*").order("created_at", { ascending: false });
  if (businessId) query = query.eq("business_id", businessId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SalesLeadRow[];
}

export async function fetchSalesConversations(leadId: string): Promise<SalesConversationRow[]> {
  const { data, error } = await supabase.from("sales_conversations").select("*").eq("lead_id", leadId).order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SalesConversationRow[];
}

export async function createSalesLead(input: {
  businessId: string; name: string; contactEmail: string | null; contactPhone: string | null;
  source: string | null; estimatedValueCents: number | null; company?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_sales_lead", {
    p_business_id: input.businessId, p_name: input.name, p_contact_email: input.contactEmail,
    p_contact_phone: input.contactPhone, p_source: input.source, p_estimated_value_cents: input.estimatedValueCents,
    p_company: input.company ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function setSalesLeadFollowUp(leadId: string, followUpAt: string | null): Promise<void> {
  const { error } = await supabase.rpc("set_sales_lead_follow_up", { p_lead_id: leadId, p_follow_up_at: followUpAt });
  if (error) throw error;
}

export async function updateSalesLeadStage(leadId: string, newStage: SalesLeadStage, lostReason: string | null = null): Promise<void> {
  const { error } = await supabase.rpc("update_sales_lead_stage", { p_lead_id: leadId, p_new_stage: newStage, p_lost_reason: lostReason });
  if (error) throw error;
}

export async function assignSalesLead(leadId: string, assigneeId: string | null): Promise<void> {
  const { error } = await supabase.rpc("assign_sales_lead", { p_lead_id: leadId, p_assignee_id: assigneeId });
  if (error) throw error;
}

export async function logSalesConversation(leadId: string, summary: string, channel = "manual"): Promise<string> {
  const { data, error } = await supabase.rpc("log_sales_conversation", { p_lead_id: leadId, p_summary: summary, p_channel: channel });
  if (error) throw error;
  return data as string;
}

export async function fetchSalesProposals(leadId: string): Promise<SalesProposalRow[]> {
  const { data, error } = await supabase.from("sales_proposals").select("*").eq("lead_id", leadId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SalesProposalRow[];
}

export async function createSalesProposal(leadId: string, title: string, amountCents: number | null = null): Promise<string> {
  const { data, error } = await supabase.rpc("create_sales_proposal", { p_lead_id: leadId, p_title: title, p_amount_cents: amountCents });
  if (error) throw error;
  return data as string;
}

export async function updateSalesProposalStatus(proposalId: string, newStatus: SalesProposalStatus): Promise<void> {
  const { error } = await supabase.rpc("update_sales_proposal_status", { p_proposal_id: proposalId, p_new_status: newStatus });
  if (error) throw error;
}
