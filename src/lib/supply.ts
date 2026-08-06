// Programme Stage E — content supply data access.
//
// Reads go direct to Supabase under RLS. Every write goes through an edge
// function, so the browser never writes supply tables directly and never
// touches the Calendar or production system.

import { supabase, invokeFn } from "./supabase";
import type {
  ContentSourceKind,
  ContentOpportunityStatus,
} from "@/types/content-spine";
import type {
  ConsentStatus,
  ProofUsageState,
  SourceProcessingStatus,
} from "@/types/content-supply";

export interface SupplySourceRow {
  id: string;
  client_id: string;
  source_kind: ContentSourceKind;
  title: string;
  summary: string | null;
  raw_content: string | null;
  raw_content_hash: string | null;
  external_ref: string | null;
  processing_status: SourceProcessingStatus;
  attempt_count: number;
  maximum_attempts: number;
  failure_code: string | null;
  failure_message: string | null;
  ideation_candidate_id: string | null;
  performance_insight_id: string | null;
  source_document_id: string | null;
  proof_item_id: string | null;
  captured_at: string;
  created_at: string;
}

export interface SupplyProofRow {
  id: string;
  client_id: string;
  content_source_id: string;
  proof_kind: string;
  claim: string;
  verification_status: "unverified" | "verified" | "rejected";
  consent_status: ConsentStatus;
  usage_state: ProofUsageState;
  happened_what: string | null;
  happened_for: string | null;
  what_changed: string | null;
  specificity: string | null;
  occurred_on: string | null;
  expires_on: string | null;
  used_count: number;
  created_at: string;
}

export interface SupplyOpportunityRow {
  id: string;
  title: string;
  status: ContentOpportunityStatus;
  origin: string;
  angle: string | null;
  created_at: string;
}

export interface SourceFilters {
  kinds?: ContentSourceKind[];
  processing?: SourceProcessingStatus[];
  search?: string;
}

export async function fetchSupplySources(
  clientId: string,
  filters: SourceFilters = {},
): Promise<SupplySourceRow[]> {
  let query = supabase
    .from("content_sources")
    .select(
      "id, client_id, source_kind, title, summary, raw_content, raw_content_hash, external_ref, processing_status, attempt_count, maximum_attempts, failure_code, failure_message, ideation_candidate_id, performance_insight_id, source_document_id, proof_item_id, captured_at, created_at",
    )
    .eq("client_id", clientId)
    .order("captured_at", { ascending: false })
    .limit(200);

  if (filters.kinds && filters.kinds.length > 0) {
    query = query.in("source_kind", filters.kinds);
  }
  if (filters.processing && filters.processing.length > 0) {
    query = query.in("processing_status", filters.processing);
  }
  const search = (filters.search ?? "").trim();
  if (search.length > 0) {
    // Escape PostgREST or-filter separators before interpolating.
    const safe = search.replace(/[(),*]/g, " ").trim();
    if (safe.length > 0) {
      query = query.or(`title.ilike.%${safe}%,summary.ilike.%${safe}%`);
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SupplySourceRow[];
}

export async function fetchProofItems(clientId: string): Promise<SupplyProofRow[]> {
  const { data, error } = await supabase
    .from("proof_items")
    .select(
      "id, client_id, content_source_id, proof_kind, claim, verification_status, consent_status, usage_state, happened_what, happened_for, what_changed, specificity, occurred_on, expires_on, used_count, created_at",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as SupplyProofRow[];
}

export async function fetchOpportunitiesForSource(
  sourceId: string,
): Promise<SupplyOpportunityRow[]> {
  const { data, error } = await supabase
    .from("content_opportunity_sources")
    .select("content_opportunities(id, title, status, origin, angle, created_at)")
    .eq("content_source_id", sourceId);
  if (error) throw error;
  // PostgREST types an embedded relation as an array even when it resolves to
  // a single row, so normalise both shapes before returning.
  const rows = (data ?? []) as unknown as Array<{
    content_opportunities: SupplyOpportunityRow | SupplyOpportunityRow[] | null;
  }>;
  return rows.flatMap((r) => {
    const value = r.content_opportunities;
    if (value === null) return [];
    return Array.isArray(value) ? value : [value];
  });
}

export interface IngestResult {
  duplicate: boolean;
  content_source_id: string;
  manual_idea_id?: string;
  proof_item_id?: string;
  message?: string;
}

export async function ingestManualIdea(input: {
  clientId: string;
  title: string;
  body: string;
  notes?: string;
  sourceUrl?: string;
}): Promise<IngestResult> {
  return await invokeFn<IngestResult>("ingest-content-source", {
    client_id: input.clientId,
    source_kind: "manual_idea",
    title: input.title,
    summary: input.notes?.trim() ? input.notes.trim() : null,
    raw_content: input.body,
    external_ref: input.sourceUrl?.trim() ? input.sourceUrl.trim() : null,
  });
}

export async function ingestProof(input: {
  clientId: string;
  claim: string;
  proofKind: string;
  detail: string;
  sourceUrl?: string;
}): Promise<IngestResult> {
  return await invokeFn<IngestResult>("ingest-content-source", {
    client_id: input.clientId,
    source_kind: "proof_item",
    title: input.claim.slice(0, 400),
    raw_content: input.detail,
    claim: input.claim,
    proof_kind: input.proofKind,
    external_ref: input.sourceUrl?.trim() ? input.sourceUrl.trim() : null,
  });
}

export interface OpportunityResult {
  duplicate: boolean;
  content_opportunity_id: string;
  origin?: string;
  linked_sources?: number;
}

export async function createOpportunityFromSource(input: {
  clientId: string;
  sourceId: string;
  title: string;
  angle?: string;
  rationale?: string;
}): Promise<OpportunityResult> {
  return await invokeFn<OpportunityResult>("create-content-opportunity", {
    client_id: input.clientId,
    content_source_id: input.sourceId,
    title: input.title,
    angle: input.angle?.trim() ? input.angle.trim() : null,
    rationale: input.rationale?.trim() ? input.rationale.trim() : null,
  });
}

export const SOURCE_KIND_LABEL: Record<ContentSourceKind, string> = {
  manual_idea: "Manual Idea",
  proof_item: "Proof",
  research_candidate: "Research",
  performance_insight: "Performance",
};

export const PROOF_KINDS = [
  "testimonial",
  "result",
  "case_study",
  "metric",
  "credential",
  "artefact",
] as const;

export interface InputConflictRow {
  id: string;
  client_id: string;
  conflict_type: string;
  severity: "info" | "warning" | "blocking";
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  title: string;
  detail: string;
  left_source_kind: string;
  left_source_ref: string;
  detected_by: string;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
}

export async function fetchInputConflicts(clientId: string): Promise<InputConflictRow[]> {
  const { data, error } = await supabase
    .from("client_input_conflicts")
    .select(
      "id, client_id, conflict_type, severity, status, title, detail, left_source_kind, left_source_ref, detected_by, resolution_note, resolved_at, created_at",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as InputConflictRow[];
}

export interface DetectionResult {
  scanned_fields: number;
  found: number;
  inserted: number;
  already_open: number;
  has_verified_proof: boolean;
}

export async function runConflictDetection(clientId: string): Promise<DetectionResult> {
  return await invokeFn<DetectionResult>("detect-input-conflicts", { client_id: clientId });
}

export async function reviewConflict(input: {
  conflictId: string;
  status: "acknowledged" | "resolved" | "dismissed";
  note?: string;
}): Promise<{ conflict_id: string; status: string }> {
  return await invokeFn("resolve-input-conflict", {
    conflict_id: input.conflictId,
    status: input.status,
    resolution_note: input.note ?? "",
  });
}

/** Blocking conflicts still awaiting a decision. These should hold approval. */
export function unresolvedBlocking(conflicts: readonly InputConflictRow[]): InputConflictRow[] {
  return conflicts.filter(
    (c) => c.severity === "blocking" && (c.status === "open" || c.status === "acknowledged"),
  );
}

export interface ContextFileProvenance {
  id: string;
  file_number: number;
  file_name: string;
  status: string;
  version: number;
  classification: string | null;
  citations: Array<{
    id: string;
    claim_excerpt: string;
    source_type: string;
    client_input_field: string | null;
  }>;
  playbooks: Array<{
    id: string;
    playbook_version: number;
    playbook_content_hash: string;
  }>;
}

export async function fetchContextFileProvenance(
  clientId: string,
): Promise<ContextFileProvenance[]> {
  const [filesRes, citesRes, pbRes] = await Promise.all([
    supabase
      .from("client_context_files")
      .select("id, file_number, file_name, status, version, classification")
      .eq("client_id", clientId)
      .order("file_number"),
    supabase
      .from("client_context_file_citations")
      .select("id, context_file_id, claim_excerpt, source_type, client_input_field")
      .eq("client_id", clientId),
    supabase
      .from("client_context_file_playbooks")
      .select("id, context_file_id, playbook_version, playbook_content_hash")
      .eq("client_id", clientId),
  ]);
  if (filesRes.error) throw filesRes.error;
  if (citesRes.error) throw citesRes.error;
  if (pbRes.error) throw pbRes.error;

  const cites = (citesRes.data ?? []) as Array<Record<string, unknown>>;
  const pbs = (pbRes.data ?? []) as Array<Record<string, unknown>>;

  return ((filesRes.data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    id: f.id as string,
    file_number: f.file_number as number,
    file_name: f.file_name as string,
    status: f.status as string,
    version: (f.version as number) ?? 1,
    classification: (f.classification as string) ?? null,
    citations: cites
      .filter((c) => c.context_file_id === f.id)
      .map((c) => ({
        id: c.id as string,
        claim_excerpt: c.claim_excerpt as string,
        source_type: c.source_type as string,
        client_input_field: (c.client_input_field as string) ?? null,
      })),
    playbooks: pbs
      .filter((p) => p.context_file_id === f.id)
      .map((p) => ({
        id: p.id as string,
        playbook_version: p.playbook_version as number,
        playbook_content_hash: p.playbook_content_hash as string,
      })),
  }));
}

/** A file with no citations cannot be approved as traceable authority. */
export function untraceableFiles(files: readonly ContextFileProvenance[]): ContextFileProvenance[] {
  return files.filter((f) => f.citations.length === 0);
}

/** Where a source came from, for the provenance view. */
export function provenanceOf(source: SupplySourceRow): string {
  if (source.ideation_candidate_id) return `Ideation candidate ${source.ideation_candidate_id.slice(0, 8)}`;
  if (source.performance_insight_id) return `Performance insight ${source.performance_insight_id.slice(0, 8)}`;
  if (source.source_document_id) return `Uploaded document ${source.source_document_id.slice(0, 8)}`;
  if (source.proof_item_id) return `Proof item ${source.proof_item_id.slice(0, 8)}`;
  return "Entered directly in Cockpit";
}
