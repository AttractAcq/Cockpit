// Programme Stage C — Phase 1 intelligence domain model.
//
// Mirrors migrations 20260803012634 .. 20260803013310. The guard functions here
// are the shared, deterministic rules for traceability and playbook authority;
// backend and frontend must both use them rather than reimplementing checks.

export type SourceDocumentKind =
  | "client_form"
  | "uploaded_document"
  | "website_page"
  | "service_page"
  | "review"
  | "existing_marketing"
  | "sales_document"
  | "offer_document"
  | "brand_document"
  | "competitor_reference"
  | "project_proof";

export type DocumentProcessingStatus =
  | "pending"
  | "extracting"
  | "extracted"
  | "failed"
  | "skipped";

export type ResearchDomain =
  | "business"
  | "market"
  | "competitors"
  | "customer_language"
  | "category_regulation"
  | "market_conditions";

export type ResearchRunStatus =
  | "running"
  | "retryable"
  | "failed"
  | "completed"
  | "cancelled";

export type EvidenceKind = "quoted" | "paraphrased";
export type EvidenceConfidence = "low" | "medium" | "high";

export type UseRestriction =
  | "unrestricted"
  | "attribution_required"
  | "review_required"
  | "do_not_publish";

export type PlaybookVersionStatus = "draft" | "active" | "superseded";

export type CitationSourceType =
  | "client_input"
  | "source_document"
  | "research_source"
  | "approved_inference";

export type ContextClassification =
  | "business_context"
  | "client_strategic_system"
  | "hybrid";

export type ConflictType =
  | "contradictory_documents"
  | "offer_superseded"
  | "deprecated_pricing"
  | "conflicting_positioning"
  | "unsupported_result"
  | "missing_evidence"
  | "region_currency";

export type ConflictSeverity = "info" | "warning" | "blocking";
export type ConflictStatus = "open" | "acknowledged" | "resolved" | "dismissed";

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

interface OwnedRow {
  id: string;
  client_id: string;
  created_at: string;
}

export interface ClientSourceDocument extends OwnedRow {
  source_kind: SourceDocumentKind;
  original_filename: string | null;
  source_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  byte_size: number | null;
  content_hash: string;
  extracted_text: string | null;
  extracted_metadata: Record<string, unknown>;
  processing_status: DocumentProcessingStatus;
  failure_code: string | null;
  failure_message: string | null;
  attempt_count: number;
  maximum_attempts: number;
  processed_at: string | null;
  created_by: string | null;
  updated_at: string;
}

export interface ClientDocumentChunk extends OwnedRow {
  source_document_id: string;
  chunk_index: number;
  content: string;
  content_hash: string;
  char_count: number;
  locator: Record<string, unknown>;
}

export interface ClientResearchRun extends OwnedRow {
  research_domain: ResearchDomain;
  status: ResearchRunStatus;
  idempotency_key: string;
  provider: string | null;
  model: string | null;
  prompt_digest: string | null;
  configuration_snapshot: Record<string, unknown>;
  source_count: number;
  attempt_count: number;
  maximum_attempts: number;
  retryable: boolean;
  lease_owner: string | null;
  lease_expires_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  completed_at: string | null;
  created_by: string | null;
  updated_at: string;
}

export interface ClientResearchSource extends OwnedRow {
  research_run_id: string;
  url: string;
  title: string;
  publisher: string | null;
  retrieved_at: string;
  evidence_kind: EvidenceKind;
  evidence_text: string;
  confidence: EvidenceConfidence;
  use_restriction: UseRestriction;
}

export interface PlaybookVersion {
  id: string;
  playbook_id: string;
  version: number;
  content_md: string;
  content_hash: string;
  status: PlaybookVersionStatus;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContextFilePlaybook extends OwnedRow {
  context_file_id: string;
  context_file_version: number;
  playbook_id: string;
  playbook_version_id: string;
  playbook_version: number;
  playbook_content_hash: string;
  applied_sections: string[];
}

export interface ContextFileCitation extends OwnedRow {
  context_file_id: string;
  context_file_version: number;
  claim_excerpt: string;
  source_type: CitationSourceType;
  client_input_field: string | null;
  source_document_id: string | null;
  document_chunk_id: string | null;
  research_source_id: string | null;
  inference_rationale: string | null;
  inference_approved_by: string | null;
  inference_approved_at: string | null;
}

export interface ClientInputConflict extends OwnedRow {
  conflict_type: ConflictType;
  severity: ConflictSeverity;
  status: ConflictStatus;
  title: string;
  detail: string;
  left_source_kind: string;
  left_source_ref: string;
  right_source_kind: string | null;
  right_source_ref: string | null;
  detected_by: string;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Guards — deterministic Phase 1 rules
// ---------------------------------------------------------------------------

/**
 * Mirrors client_context_file_citations_origin_check. A citation is valid only
 * when exactly one origin is present, and an inference additionally requires a
 * rationale and a recorded human approval. Unsupported claims fail closed.
 */
export function isCitationTraceable(
  citation: Pick<
    ContextFileCitation,
    | "source_type"
    | "client_input_field"
    | "source_document_id"
    | "research_source_id"
    | "inference_rationale"
    | "inference_approved_by"
    | "inference_approved_at"
  >,
): boolean {
  const {
    source_type,
    client_input_field,
    source_document_id,
    research_source_id,
    inference_rationale,
    inference_approved_by,
    inference_approved_at,
  } = citation;

  switch (source_type) {
    case "client_input":
      return (
        client_input_field !== null &&
        source_document_id === null &&
        research_source_id === null
      );
    case "source_document":
      return (
        source_document_id !== null &&
        research_source_id === null &&
        client_input_field === null
      );
    case "research_source":
      return (
        research_source_id !== null &&
        source_document_id === null &&
        client_input_field === null
      );
    case "approved_inference":
      return (
        inference_rationale !== null &&
        inference_approved_by !== null &&
        inference_approved_at !== null &&
        source_document_id === null &&
        research_source_id === null &&
        client_input_field === null
      );
    default:
      return false;
  }
}

/** A generated file is traceable only when every claim carries a valid citation. */
export function areAllClaimsTraceable(
  citations: ReadonlyArray<Parameters<typeof isCitationTraceable>[0]>,
): boolean {
  return citations.length > 0 && citations.every(isCitationTraceable);
}

/**
 * Generation identity. Changing any applied playbook version or content hash
 * changes this string, so a regeneration cannot be mistaken for the prior run.
 */
export function playbookGenerationIdentity(
  applied: ReadonlyArray<
    Pick<ContextFilePlaybook, "playbook_id" | "playbook_version" | "playbook_content_hash">
  >,
): string {
  return applied
    .map((p) => `${p.playbook_id}:${p.playbook_version}:${p.playbook_content_hash}`)
    .sort()
    .join("|");
}

/**
 * A recorded playbook reference is still current only if the live active version
 * matches both the version number and the content hash frozen at generation.
 * Prevents a stale playbook silently replacing locked authority.
 */
export function isPlaybookAuthorityCurrent(
  recorded: Pick<ContextFilePlaybook, "playbook_version" | "playbook_content_hash">,
  active: Pick<PlaybookVersion, "version" | "content_hash" | "status">,
): boolean {
  return (
    active.status === "active" &&
    active.version === recorded.playbook_version &&
    active.content_hash === recorded.playbook_content_hash
  );
}

/** Only extracted document text may feed generation. */
export function isDocumentUsableForGeneration(
  doc: Pick<ClientSourceDocument, "processing_status" | "extracted_text">,
): boolean {
  return (
    doc.processing_status === "extracted" &&
    typeof doc.extracted_text === "string" &&
    doc.extracted_text.length > 0
  );
}

/** A failed document is retryable until its attempt cap is reached. */
export function isDocumentRecoverable(
  doc: Pick<ClientSourceDocument, "processing_status" | "attempt_count" | "maximum_attempts">,
): boolean {
  return doc.processing_status === "failed" && doc.attempt_count < doc.maximum_attempts;
}

/** Research marked do_not_publish may inform review but never reach output. */
export function isResearchSourcePublishable(
  source: Pick<ClientResearchSource, "use_restriction">,
): boolean {
  return (
    source.use_restriction === "unrestricted" ||
    source.use_restriction === "attribution_required"
  );
}

/** Blocking conflicts that are still open must halt Phase 1 approval. */
export function blockingConflicts(
  conflicts: ReadonlyArray<Pick<ClientInputConflict, "severity" | "status">>,
): number {
  return conflicts.filter(
    (c) => c.severity === "blocking" && (c.status === "open" || c.status === "acknowledged"),
  ).length;
}

/**
 * Missing information is disclosed, never invented. A field with no supporting
 * source must be reported as a gap rather than filled.
 */
export function missingRequiredFields(
  required: readonly string[],
  provided: Readonly<Record<string, unknown>>,
): string[] {
  return required.filter((field) => {
    const value = provided[field];
    if (value === undefined || value === null) return true;
    return typeof value === "string" && value.trim().length === 0;
  });
}
