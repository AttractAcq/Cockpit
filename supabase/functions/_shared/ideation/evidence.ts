import { sha256 } from "./hash.ts";

export type IdeationEvidenceSourceType =
  | "approved_context"
  | "approved_strategic_playbook"
  | "approved_execution"
  | "approved_intelligence"
  | "approved_campaign_intelligence"
  | "approved_main_offer"
  | "approved_seasonal_offer"
  | "approved_avatar_os"
  | "external_research";

export interface IdeationEvidenceSource {
  source_id: string;
  source_ref: string;
  source_type: IdeationEvidenceSourceType;
  source_url: string;
  bounded_excerpt: string;
  content_hash: string;
}

export async function createEvidenceSource(input: {
  sourceId: string;
  sourceRef: string;
  sourceType: IdeationEvidenceSourceType;
  sourceUrl: string;
  excerpt: string;
}): Promise<IdeationEvidenceSource> {
  const boundedExcerpt = input.excerpt.trim().slice(0, 4000);
  if (!boundedExcerpt) throw new Error(`Evidence source ${input.sourceId} has no bounded excerpt.`);
  return {
    source_id: input.sourceId,
    source_ref: input.sourceRef,
    source_type: input.sourceType,
    source_url: input.sourceUrl,
    bounded_excerpt: boundedExcerpt,
    content_hash: await sha256(boundedExcerpt),
  };
}

export function serializeEvidenceRegistry(sources: IdeationEvidenceSource[]): string {
  return sources.map((source) => [
    `SOURCE_ID: ${source.source_id}`,
    `SOURCE_REF: ${source.source_ref}`,
    `SOURCE_TYPE: ${source.source_type}`,
    `SOURCE_URL: ${source.source_url}`,
    `CONTENT_HASH: ${source.content_hash}`,
    "<bounded_excerpt>",
    source.bounded_excerpt,
    "</bounded_excerpt>",
  ].join("\n")).join("\n\n");
}

/**
 * Identity-only listing of the allowed evidence registry.
 *
 * Every bounded excerpt is already supplied exactly once, under its own trust
 * classification, by serializeEvidenceRegistry. The allowed-registry block only
 * has to establish which identifiers may be cited, so it repeats the provenance
 * fields a reference must copy verbatim — source_id, source_ref, source_url,
 * source_type, content_hash — and never repeats the excerpt body.
 */
export function serializeEvidenceRegistryIdentities(sources: IdeationEvidenceSource[]): string {
  return sources.map((source) =>
    [
      `SOURCE_ID: ${source.source_id}`,
      `SOURCE_REF: ${source.source_ref}`,
      `SOURCE_TYPE: ${source.source_type}`,
      `SOURCE_URL: ${source.source_url}`,
      `CONTENT_HASH: ${source.content_hash}`,
    ].join(" | ")
  ).join("\n");
}
