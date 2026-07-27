import {
  boundedAuthorityExcerpt,
  STRATEGIC_PLAYBOOK_CONTEXT_FILES,
  type ApprovedClientAuthority,
} from "../../client-authority.ts";
import { createEvidenceSource } from "../evidence.ts";
import { sha256 } from "../hash.ts";
import type { TechniqueModuleResult } from "./types.ts";

export async function authorityResearch(
  authority: ApprovedClientAuthority,
  options: {
    techniqueNumber: number;
    techniqueSlug: string;
    sourceTitle: string;
    contextFileNumbers: number[];
    focus: string;
    generatesCandidates: boolean;
    state?: "ready" | "reference_ready";
  },
): Promise<TechniqueModuleResult> {
  const bounded = boundedAuthorityExcerpt(
    authority.allContextFiles,
    options.contextFileNumbers,
    8000,
    Math.max(900, Math.floor(8000 / options.contextFileNumbers.length)),
  );
  if (!bounded.excerpt.trim()) {
    throw new Error(`${options.techniqueSlug} has no usable approved authority.`);
  }
  const contentHash = await sha256(bounded.excerpt);
  const wanted = new Set(options.contextFileNumbers);
  const strategicNumbers = new Set<number>(
    STRATEGIC_PLAYBOOK_CONTEXT_FILES.map((file) => file.file_number),
  );
  const evidenceSources = await Promise.all(
    authority.allContextFiles
      .filter((file) => wanted.has(file.file_number))
      .sort((left, right) => left.file_number - right.file_number)
      .map((file) => createEvidenceSource({
        sourceId: `context:${file.id}:v${file.version}`,
        sourceRef: file.file_name,
        sourceType: strategicNumbers.has(file.file_number)
          ? "approved_strategic_playbook"
          : "approved_context",
        sourceUrl: `aa-authority://client/${authority.client.id}/context/${file.id}`,
        excerpt: file.content_md,
      })),
  );
  return {
    techniqueNumber: options.techniqueNumber,
    techniqueSlug: options.techniqueSlug,
    state: options.state ?? "ready",
    generatesCandidates: options.generatesCandidates,
    message: options.focus,
    research: {
      researchKey: `technique-${options.techniqueNumber}`,
      techniqueSlug: options.techniqueSlug,
      sourceIdentifier: `client:${authority.client.id}:technique:${options.techniqueNumber}`,
      sourceType: "approved_authority_bundle",
      sourceUrl: `aa-authority://client/${authority.client.id}/technique/${options.techniqueNumber}`,
      sourceTitle: options.sourceTitle,
      sourceExcerpt: bounded.excerpt,
      sourceProvider: "approved_client_authority",
      retrievedAt: new Date().toISOString(),
      contentHash,
      status: "processed",
      structuredFindings: {
        focus: options.focus,
        authority_references: bounded.references,
        evidence_mode: "classified_approved_client_authority",
        context_source_ids: evidenceSources
          .filter((source) => source.source_type === "approved_context")
          .map((source) => source.source_id),
        strategic_playbook_source_ids: evidenceSources
          .filter((source) => source.source_type === "approved_strategic_playbook")
          .map((source) => source.source_id),
        raw_html_stored: false,
      },
      evidenceSources,
    },
  };
}
