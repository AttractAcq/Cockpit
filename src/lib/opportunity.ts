// Stage 2 Phase 11 — Opportunity OS data access. Reads findings directly
// (RLS-scoped, staff-only); detection and review both go through the
// staff-gated RPCs, matching the established direct-supabase.rpc(...)
// convention for this class of administrative operation.

import { supabase } from "./supabase";
import type { OpportunityFindingRow, OpportunityFindingStatus } from "@/types/opportunity";

export async function fetchOpportunityFindings(clientId?: string): Promise<OpportunityFindingRow[]> {
  let query = supabase.from("opportunity_os_findings").select("*").order("score", { ascending: false });
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as OpportunityFindingRow[];
}

export async function runOpportunityDetection(clientId: string): Promise<number> {
  const { data, error } = await supabase.rpc("run_opportunity_detection", { p_client_id: clientId });
  if (error) throw error;
  return data as number;
}

export async function reviewOpportunityFinding(
  findingId: string,
  status: Extract<OpportunityFindingStatus, "confirmed_useful" | "dismissed">,
  notes: string | null = null,
): Promise<void> {
  const { error } = await supabase.rpc("review_opportunity_finding", { p_finding_id: findingId, p_status: status, p_notes: notes });
  if (error) throw error;
}
