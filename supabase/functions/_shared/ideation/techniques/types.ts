import type { ApprovedClientAuthority } from "../../client-authority.ts";
import type { IdeationEvidenceSource } from "../evidence.ts";

export type TechniqueState = "ready" | "reference_ready" | "no_source" | "inactive";

export interface TechniqueResearch {
  researchKey: string;
  techniqueSlug: string;
  sourceIdentifier: string;
  sourceType:
    | "approved_context"
    | "approved_strategic_playbook"
    | "approved_execution"
    | "approved_authority_bundle"
    | "approved_campaign_intelligence"
    | "approved_main_offer"
    | "approved_seasonal_offer"
    | "approved_avatar_os"
    | "external_research";
  sourceUrl: string;
  sourceTitle: string;
  sourceExcerpt: string;
  sourceProvider: "approved_client_authority";
  retrievedAt: string;
  contentHash: string;
  status: "processed" | "insufficient";
  structuredFindings: Record<string, unknown>;
  evidenceSources: IdeationEvidenceSource[];
}

export interface TechniqueModuleResult {
  techniqueNumber: number;
  techniqueSlug: string;
  state: TechniqueState;
  generatesCandidates: boolean;
  research?: TechniqueResearch;
  message: string;
}

export type TechniqueModule = (
  authority: ApprovedClientAuthority,
) => Promise<TechniqueModuleResult>;
