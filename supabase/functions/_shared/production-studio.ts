// Programme Stage I — the shared production contract: format router,
// provider capability registry, asset-plan contract, and the handful of
// quality checks that have a real, deterministic signal to check against.
//
// All pure/testable — no database or network dependency.

// ---------------------------------------------------------------------------
// Format router
// ---------------------------------------------------------------------------

export type StudioCapability =
  | "reel_studio" | "carousel_studio" | "story_studio"
  | "feed_post_studio" | "ad_studio";

export interface RouteInput {
  format: string;
  organicOrPaid: "organic" | "paid";
}

export interface RouteResult {
  routable: boolean;
  studio: StudioCapability | null;
  reason: string | null;
}

const FORMAT_STUDIO_MAP: Record<string, StudioCapability> = {
  reel: "reel_studio",
  video: "reel_studio",
  carousel: "carousel_studio",
  story: "story_studio",
  stories: "story_studio",
  feed_post: "feed_post_studio",
  feed: "feed_post_studio",
  static: "feed_post_studio",
};

/**
 * Routes a Brief's format to its studio. Paid content always routes to Ad
 * Studio regardless of the underlying creative format — the organic studios
 * are organic-only by construction (mirrors calendar_slots.preferred_source_
 * type / content_requirements.channel already separating organic and paid
 * elsewhere in the schema).
 */
export function routeToStudio(input: RouteInput): RouteResult {
  if (input.organicOrPaid === "paid") {
    return { routable: true, studio: "ad_studio", reason: null };
  }
  const key = input.format.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const studio = FORMAT_STUDIO_MAP[key];
  if (!studio) {
    return { routable: false, studio: null, reason: `Unrecognised format "${input.format}".` };
  }
  return { routable: true, studio, reason: null };
}

// ---------------------------------------------------------------------------
// Provider capability registry
// ---------------------------------------------------------------------------

export type ProductionCapability =
  | "text_generation" | "still_image_generation" | "image_to_video"
  | "carousel_slide_generation" | "story_frame_generation";

const PROVIDER_CAPABILITIES: Record<string, readonly ProductionCapability[]> = {
  anthropic: ["text_generation"],
  higgsfield: ["still_image_generation", "image_to_video", "carousel_slide_generation", "story_frame_generation"],
};

export interface CapabilityCheckResult {
  supported: boolean;
  reason: string | null;
}

/** Fails cleanly (never throws) for an unknown provider or unsupported capability. */
export function checkProviderCapability(provider: string, capability: ProductionCapability): CapabilityCheckResult {
  const capabilities = PROVIDER_CAPABILITIES[provider];
  if (!capabilities) {
    return { supported: false, reason: `Unknown provider "${provider}".` };
  }
  if (!capabilities.includes(capability)) {
    return { supported: false, reason: `Provider "${provider}" does not support "${capability}".` };
  }
  return { supported: true, reason: null };
}

// ---------------------------------------------------------------------------
// Asset-plan contract
// ---------------------------------------------------------------------------

export const ASSET_PLAN_CATEGORIES = [
  "existing_client_asset", "proof_asset", "screenshot", "document", "stock",
  "generated_image", "generated_video", "motion_graphic", "diagram",
  "typography", "voice_over", "music", "sound_effect",
] as const;

export type AssetPlanCategory = typeof ASSET_PLAN_CATEGORIES[number];

export interface AssetPlanItem {
  category: AssetPlanCategory;
  description: string;
  required: boolean;
}

/** Strict validation — an asset plan with an unrecognised category is rejected wholesale. */
export function validateAssetPlan(raw: unknown): AssetPlanItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: AssetPlanItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (!ASSET_PLAN_CATEGORIES.includes(row.category as AssetPlanCategory)) return null;
    if (typeof row.description !== "string" || row.description.trim().length === 0) return null;
    if (typeof row.required !== "boolean") return null;
    items.push({ category: row.category as AssetPlanCategory, description: row.description, required: row.required });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Quality checks — only the ones with a real, checkable signal are
// implemented. See the Stage I implementation report for the rest
// (spelling, brand alignment, generated-media disclosure policy, asset
// ownership, consent) and why they're deferred rather than faked.
// ---------------------------------------------------------------------------

export const QUALITY_CHECK_TYPES = [
  "claim_accuracy", "proof_accuracy", "brand_alignment", "spelling",
  "aspect_ratio", "platform_safe_area", "cta", "asset_ownership",
  "consent", "generated_media_disclosure",
] as const;

export type QualityCheckType = typeof QUALITY_CHECK_TYPES[number];

export interface QualityCheckResult {
  check: QualityCheckType;
  passed: boolean;
  detail: string;
}

/** "CTA" check: the Brief must actually declare one. */
export function checkCtaPresent(cta: string | null | undefined): QualityCheckResult {
  const present = typeof cta === "string" && cta.trim().length > 0;
  return { check: "cta", passed: present, detail: present ? "CTA present." : "Brief has no CTA." };
}

/**
 * "Proof accuracy" check: mirrors Stage H's proof-approval gate — if the
 * Brief self-flagged proof_required, at least one verified Proof must
 * actually be linked. Reuses the same real signal, not a new one.
 */
export function checkProofAccuracy(proofRequired: boolean, linkedVerifiedProofCount: number): QualityCheckResult {
  if (!proofRequired) return { check: "proof_accuracy", passed: true, detail: "No proof required for this Brief." };
  const passed = linkedVerifiedProofCount > 0;
  return {
    check: "proof_accuracy",
    passed,
    detail: passed
      ? `${linkedVerifiedProofCount} verified Proof item(s) linked.`
      : "Proof required but none verified and linked.",
  };
}

/** "Aspect ratio" check against a target platform's expected ratio, with tolerance. */
const PLATFORM_ASPECT_RATIOS: Record<string, number> = {
  instagram_reel: 9 / 16,
  instagram_story: 9 / 16,
  instagram_feed: 1,
  instagram_carousel: 1,
};

export function checkAspectRatio(
  platform: string,
  format: string,
  width: number | null,
  height: number | null,
): QualityCheckResult {
  const key = `${platform.trim().toLowerCase()}_${format.trim().toLowerCase()}`.replace(/[\s-]+/g, "_");
  const expected = PLATFORM_ASPECT_RATIOS[key];
  if (!expected) {
    return { check: "aspect_ratio", passed: true, detail: `No known aspect-ratio rule for "${key}" — not checked.` };
  }
  if (!width || !height) {
    return { check: "aspect_ratio", passed: false, detail: "Asset has no recorded dimensions." };
  }
  const actual = width / height;
  const tolerance = 0.02;
  const passed = Math.abs(actual - expected) <= tolerance;
  return {
    check: "aspect_ratio",
    passed,
    detail: passed
      ? `${width}x${height} matches expected ${key} ratio.`
      : `${width}x${height} (ratio ${actual.toFixed(3)}) does not match expected ${key} ratio (${expected.toFixed(3)}).`,
  };
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/** Deterministic — the same Content Item + capability always resolves to the same job. */
export function buildProductionJobIdempotencyKey(contentItemId: string, capability: StudioCapability): string {
  return `production:${contentItemId}:${capability}`;
}
