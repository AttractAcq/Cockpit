// Reel Studio Phase 2, Workstream B: the ONE authoritative resolver that decides
// whether a content source may enter Reel Studio.
//
// Product rule in force (the conservative rule; no Ads-video product model is
// invented here):
//
//   Reel Studio consumes exactly one thing — an approved `reel_video` production
//   brief whose production mode permits AI production.
//
// `resolveAssetFormat` in production-brief-contract.ts maps every `ads_master` row
// to `ad_static`, so an Ads row can never own a `reel_video` brief. Ads sources are
// therefore permanently ineligible; the UI must not offer a Reel Studio action for
// them. Existing Ads-linked projects stay readable and manually operable — this
// resolver gates NEW work (project creation, storyboard generation, handoff), never
// reads.
//
// Imported by Edge Functions AND the frontend so one decision drives both.

import { resolveAssetFormat, type ProductionSourceTable } from "./production-brief-contract.ts";
import {
  allowsReelStudio,
  resolveBriefProductionMode,
  type BriefModeIdentity,
  type ProductionMode,
} from "./production-mode-contract.ts";

export const REEL_REQUIRED_ASSET_FORMAT = "reel_video";

export type ReelIneligibilityCode =
  | "source_table_unsupported"
  | "source_content_type_unsupported"
  | "source_unreadable"
  | "brief_missing"
  | "brief_ambiguous"
  | "brief_wrong_format"
  | "brief_not_approved"
  | "brief_mode_unset"
  | "brief_mode_human"
  | "brief_mode_contradictory";

export interface ReelSourceEligibility {
  eligible: boolean;
  /**
   * True when the reason can never be resolved for this source (hide the action).
   * False when the operator can fix it — generate/approve the brief, set the mode
   * (disable the action and explain instead).
   */
  permanent: boolean;
  code: ReelIneligibilityCode | null;
  reason: string;
  requiredAssetFormat: typeof REEL_REQUIRED_ASSET_FORMAT;
  resolvedMode: ProductionMode | null;
}

const ELIGIBLE: Omit<ReelSourceEligibility, "resolvedMode"> = {
  eligible: true,
  permanent: false,
  code: null,
  reason: "",
  requiredAssetFormat: REEL_REQUIRED_ASSET_FORMAT,
};

function ineligible(code: ReelIneligibilityCode, permanent: boolean, reason: string, resolvedMode: ProductionMode | null = null): ReelSourceEligibility {
  return { eligible: false, permanent, code, reason, requiredAssetFormat: REEL_REQUIRED_ASSET_FORMAT, resolvedMode };
}

export interface ReelSourceInput {
  sourceTable: string;
  /** The master row, used only to resolve its canonical asset format. */
  sourceRow: Record<string, unknown> | null;
  /** The candidate production brief, or null when none exists. */
  brief: (BriefModeIdentity & { id?: string; status?: string | null }) | null;
  /** Number of candidate reel_video briefs found for the source (ambiguity check). */
  briefCandidateCount?: number;
}

/**
 * Decide whether a source row may start (or continue) a Reel Studio workflow.
 * The order of checks is deliberate: permanent/intrinsic reasons first (so the UI
 * hides rather than teases), then resolvable brief-state reasons.
 */
export function resolveReelSourceEligibility(input: ReelSourceInput): ReelSourceEligibility {
  if (input.sourceTable === "ads_master") {
    return ineligible(
      "source_table_unsupported",
      true,
      "Ads content resolves to a static image ad brief (ad_static). Reel Studio requires an approved reel_video brief, and no Ads video brief format exists in this system.",
    );
  }
  if (input.sourceTable !== "organic_master") {
    return ineligible(
      "source_table_unsupported",
      true,
      "Reel Studio can only be produced from an Organic content row that resolves to a Reel.",
    );
  }
  if (!input.sourceRow) {
    return ineligible("source_unreadable", false, "The source content row could not be read.");
  }

  let format: string;
  try {
    format = resolveAssetFormat(input.sourceTable as ProductionSourceTable, input.sourceRow);
  } catch {
    return ineligible(
      "source_content_type_unsupported",
      true,
      "This Organic row has no recognised content type, so it cannot produce a Reel brief.",
    );
  }
  if (format !== REEL_REQUIRED_ASSET_FORMAT) {
    return ineligible(
      "source_content_type_unsupported",
      true,
      `This Organic row is a ${format.replaceAll("_", " ")} row. Reel Studio only produces Reels.`,
    );
  }

  if ((input.briefCandidateCount ?? (input.brief ? 1 : 0)) > 1) {
    return ineligible(
      "brief_ambiguous",
      false,
      "More than one approved reel_video production brief matches this content row. Bind one explicitly before using Reel Studio.",
    );
  }
  if (!input.brief) {
    return ineligible(
      "brief_missing",
      false,
      "No reel_video production brief exists for this content row yet. Generate and approve one first.",
    );
  }
  if (input.brief.asset_format !== REEL_REQUIRED_ASSET_FORMAT) {
    return ineligible("brief_wrong_format", false, "The linked production brief is not a reel_video brief.");
  }
  if (input.brief.status !== "approved") {
    return ineligible(
      "brief_not_approved",
      false,
      "The reel_video production brief must be approved before Reel Studio can produce it.",
    );
  }

  const resolution = resolveBriefProductionMode(input.brief);
  if (resolution.mode === null) {
    return ineligible(
      "brief_mode_unset",
      false,
      resolution.reason ?? "This brief has no production mode assigned. Set it to AI or Hybrid to use Reel Studio.",
    );
  }
  if (resolution.contradictory) {
    return ineligible(
      "brief_mode_contradictory",
      false,
      resolution.reason ?? "This brief's production mode contradicts its own instructions. Confirm the mode before using Reel Studio.",
      resolution.mode,
    );
  }
  if (!allowsReelStudio(resolution.mode)) {
    return ineligible(
      "brief_mode_human",
      false,
      "This brief is marked for human production. Change its production mode to AI or Hybrid before producing it in Reel Studio.",
      resolution.mode,
    );
  }

  return { ...ELIGIBLE, resolvedMode: resolution.mode };
}

/**
 * Eligibility for an EXISTING project (used by storyboard generation and handoff).
 * A standalone project (no source, no brief) is manually operable but can never
 * run brief-derived operations.
 */
export function resolveReelProjectEligibility(input: {
  organicMasterId: string | null;
  adsMasterId: string | null;
  sourceRow: Record<string, unknown> | null;
  brief: (BriefModeIdentity & { status?: string | null }) | null;
  briefCandidateCount?: number;
}): ReelSourceEligibility {
  if (!input.organicMasterId && !input.adsMasterId) {
    return ineligible(
      "brief_missing",
      false,
      "This standalone project has no linked content source or production brief. Add and generate shots manually.",
    );
  }
  return resolveReelSourceEligibility({
    sourceTable: input.organicMasterId ? "organic_master" : "ads_master",
    sourceRow: input.sourceRow,
    brief: input.brief,
    briefCandidateCount: input.briefCandidateCount,
  });
}
