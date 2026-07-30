// Ideation Stage 4 — code-owned, versioned target-master manifest.
//
// This is the single declared contract for "which operational domain does an
// Ideation candidate become". The executable mapping lives in the Stage 4 SQL
// RPC; a test asserts the SQL and this manifest agree exactly, so the two can
// never drift apart silently.
//
// Stage 4 writes only organic_master and story_master. ads_master, paid
// campaign tables, and paid-distribution tables have no Stage 4 code path.

export const IDEATION_COMMIT_TARGET_MANIFEST_VERSION = "aa.ideation.commit-targets.v1";
export const IDEATION_COMMIT_MAPPING_VERSION = "aa.ideation.commit-mapping.v1";
export const IDEATION_COMMIT_MODULE_VERSION = "aa.ideation.commit.v1";
export const IDEATION_COMMIT_OUTPUT_SCHEMA_VERSION = "aa.ideation.commit-output.v1";

/**
 * Stage 4 reuses the existing canonical Phase 3 allocator rather than minting a
 * second reference scheme. The version string records that decision so a future
 * change to the allocator invalidates every Stage 4 configuration hash.
 */
export const IDEATION_COMMIT_REFERENCE_ALLOCATOR_VERSION = "aa.phase3.allocate-ref.v1";

export type IdeationCommitAssetType = "reel" | "carousel" | "static" | "story";
export type IdeationCommitTypeCode = "RL" | "CR" | "FP" | "ST";
export type IdeationCommitMasterTable = "organic_master" | "story_master";
export type IdeationCommitCalendarRowType = "reel" | "carousels" | "feed_posts" | "stories";

export interface IdeationCommitTarget {
  asset_type: IdeationCommitAssetType;
  /** Phase 3 type code, consumed verbatim by allocate_phase3_ref. */
  type_code: IdeationCommitTypeCode;
  master_table: IdeationCommitMasterTable;
  calendar_row_type: IdeationCommitCalendarRowType;
}

/**
 * The manifest. Story is the only asset type that targets story_master, and it
 * is never coerced into organic_master.
 */
export const IDEATION_COMMIT_TARGETS: readonly IdeationCommitTarget[] = Object.freeze([
  { asset_type: "reel", type_code: "RL", master_table: "organic_master", calendar_row_type: "reel" },
  { asset_type: "carousel", type_code: "CR", master_table: "organic_master", calendar_row_type: "carousels" },
  { asset_type: "static", type_code: "FP", master_table: "organic_master", calendar_row_type: "feed_posts" },
  { asset_type: "story", type_code: "ST", master_table: "story_master", calendar_row_type: "stories" },
] as const);

/**
 * Domains Stage 4 must never write. Kept as data so the prohibition is
 * assertable by test rather than existing only as a comment.
 */
export const IDEATION_COMMIT_PROHIBITED_TARGETS: readonly string[] = Object.freeze([
  "ads_master",
  "client_production_briefs",
  "client_assets",
  "client_distribution_records",
  "client_analytics_records",
  "video_projects",
  "video_shots",
]);

const BY_ASSET_TYPE = new Map<string, IdeationCommitTarget>(
  IDEATION_COMMIT_TARGETS.map((target) => [target.asset_type, target]),
);

/** Returns null for any unknown or unsupported asset type. Never guesses. */
export function resolveIdeationCommitTarget(assetType: string): IdeationCommitTarget | null {
  return BY_ASSET_TYPE.get(assetType) ?? null;
}

export function isSupportedIdeationCommitAssetType(assetType: string): boolean {
  return BY_ASSET_TYPE.has(assetType);
}

/**
 * Identifies every proposal slot whose asset type Stage 4 cannot commit. A
 * non-empty result must reject the whole commit before any operational write.
 */
export function findUnsupportedCommitSlots(
  slots: Array<{ proposal_slot_key: string; required_asset_type: string }>,
): Array<{ proposal_slot_key: string; asset_type: string }> {
  return slots
    .filter((slot) => !isSupportedIdeationCommitAssetType(slot.required_asset_type))
    .map((slot) => ({ proposal_slot_key: slot.proposal_slot_key, asset_type: slot.required_asset_type }));
}

/** Frozen manifest hashed into the Stage 4 configuration snapshot. */
export const IDEATION_COMMIT_TARGET_MANIFEST = Object.freeze({
  version: IDEATION_COMMIT_TARGET_MANIFEST_VERSION,
  mapping_version: IDEATION_COMMIT_MAPPING_VERSION,
  reference_allocator_version: IDEATION_COMMIT_REFERENCE_ALLOCATOR_VERSION,
  targets: IDEATION_COMMIT_TARGETS,
  prohibited_targets: IDEATION_COMMIT_PROHIBITED_TARGETS,
  story_never_maps_to_organic_master: true,
  review_state_on_commit: "needs_review",
  master_status_on_commit: "idea",
  creates_production_brief: false,
  creates_asset: false,
  publishes: false,
  distributes: false,
  calls_model: false,
});
