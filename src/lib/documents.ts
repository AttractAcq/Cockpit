// Cockpit v3 Step 3 — Documents. Reads two tables that have existed since
// Programme Stage C1/C3b but were never surfaced in any UI (Phase 04's own
// finding): client_source_documents (raw ingested files, distinct from the
// curated Context/Execution Files) and client_context_file_citations
// (claim-level provenance). This is the first real activation of that
// read-path -- it surfaces whatever citations genuinely exist, which per
// Phase 04's finding is honestly zero for AA's content today, rather than
// fabricating any.

import { supabase } from "./supabase";
import type { ClientSourceDocument, ContextFileCitation } from "@/types/phase1-intelligence";

export async function fetchClientSourceDocuments(clientId: string): Promise<ClientSourceDocument[]> {
  const { data, error } = await supabase
    .from("client_source_documents")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClientSourceDocument[];
}

export async function fetchContextFileCitations(clientId: string): Promise<ContextFileCitation[]> {
  const { data, error } = await supabase
    .from("client_context_file_citations")
    .select("*")
    .eq("client_id", clientId);
  if (error) throw error;
  return (data ?? []) as ContextFileCitation[];
}
