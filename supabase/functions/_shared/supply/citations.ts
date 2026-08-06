// Programme Stage C: claim-level citation validation.
//
// The database constraint client_context_file_citations_origin_check enforces
// exactly one origin per citation, but it cannot know whether the id refers to
// a real row. Existence is checked here, and a citation naming a source that
// was not supplied is an ERROR — the file is rejected, not written with a bad
// citation attached.
//
// Pure and side-effect free so it can be unit tested without a database.

export interface ModelCitation {
  claim_excerpt: string;
  source_type: "client_input" | "source_document" | "research_source";
  client_input_field?: string;
  source_document_id?: string;
  research_source_id?: string;
}

export interface SourceInventory {
  inputFields: string[];
  documents: Array<{ id: string; label: string }>;
  researchSources: Array<{ id: string; title: string }>;
}

/** Returns one error string per invalid citation. Empty means all valid. */
export function validateCitations(
  citations: readonly ModelCitation[],
  inventory: SourceInventory,
  tag = "",
): string[] {
  const errors: string[] = [];
  const validFields = new Set(inventory.inputFields);
  const validDocs = new Set(inventory.documents.map((d) => d.id));
  const validResearch = new Set(inventory.researchSources.map((r) => r.id));

  citations.forEach((c, i) => {
    const at = `${tag} citation ${i + 1}`.trim();
    if (!c || typeof c.claim_excerpt !== "string" || c.claim_excerpt.trim().length === 0) {
      errors.push(`${at} has no claim_excerpt.`);
      return;
    }
    switch (c.source_type) {
      case "client_input":
        if (!c.client_input_field || !validFields.has(c.client_input_field)) {
          errors.push(`${at} cites client input "${c.client_input_field ?? "(none)"}", which was not supplied.`);
        }
        break;
      case "source_document":
        if (!c.source_document_id || !validDocs.has(c.source_document_id)) {
          errors.push(`${at} cites document "${c.source_document_id ?? "(none)"}", which does not exist for this client.`);
        }
        break;
      case "research_source":
        if (!c.research_source_id || !validResearch.has(c.research_source_id)) {
          errors.push(`${at} cites research source "${c.research_source_id ?? "(none)"}", which does not exist for this client.`);
        }
        break;
      default:
        errors.push(`${at} has invalid source_type "${String((c as { source_type?: unknown }).source_type)}". approved_inference is never model-emitted.`);
    }
  });

  return errors;
}
