// Reel Studio Phase 2, Workstream E: the ONE authoritative resolver for which
// (platform, content type, asset format, media type, publication method)
// combinations the current publisher can actually execute.
//
// Phase 3 owns final Reel assembly and Instagram Reels publishing. Until then a
// Reel Studio MP4 shot clip must never be led into a scheduling flow the server
// rejects. This module is imported by the frontend (button/modal state), by
// `_shared/instagram-publish.ts` (manual publish + worker publish) and by
// `process-scheduled-publishing` (claim disposition), and the same rule is
// enforced in SQL by the `distribution_publication_supported` trigger so a
// bypassed frontend still cannot schedule an unsupported job.
//
// Phase 3 update: Instagram Reels are no longer blocked unconditionally. They are
// supported ONLY for an approved, current final-Reel deliverable
// (_shared/final-reel-contract.ts). Every other Reel-shaped publication —
// individual shot clips, an unapproved edit, a superseded version — stays blocked
// with a specific reason. Callers that cannot supply the final-Reel context get a
// fail-closed BLOCKED_NO_FINAL_REEL rather than an accidental allow.
import {
  resolveReelPublicationEligibility,
  shotClipPublicationBlocked,
  type ReelPublicationContext,
  type ReelPublicationEligibility,
} from "./final-reel-contract.ts";

export type PublishCapabilityCode =
  | "supported"
  | "unsupported_platform"
  | "unsupported_content_type"
  | "unsupported_asset_format"
  | "unsupported_media_type"
  // Phase 3: Reel-specific blocks, mirrored from ReelPublicationCode so the
  // operator sees exactly which prerequisite is missing.
  | "blocked_no_final_reel"
  | "blocked_final_reel_not_approved"
  | "blocked_shot_clip_not_publishable"
  | "blocked_superseded_version"
  | "blocked_missing_storage_object"
  | "blocked_account_configuration"
  | "blocked_project_relationship";

export interface PublishCapability {
  supported: boolean;
  /** True when no operator action can make this publishable in the current build. */
  permanent: boolean;
  code: PublishCapabilityCode;
  reason: string;
}

export interface PublishCapabilityInput {
  platform: string | null | undefined;
  assetFormat: string | null | undefined;
  contentType: string | null | undefined;
  /** MIME types of every media item on the record. */
  mediaMimeTypes: ReadonlyArray<string | null | undefined>;
  /**
   * Phase 3. Required for any REELS / reel_video publication. Omitting it means
   * the caller could not prove a final Reel exists, so the decision fails closed.
   */
  reelContext?: ReelPublicationContext | null;
}

const REEL_CODE_MAP: Record<string, PublishCapabilityCode> = {
  BLOCKED_NO_FINAL_REEL: "blocked_no_final_reel",
  BLOCKED_FINAL_REEL_NOT_APPROVED: "blocked_final_reel_not_approved",
  BLOCKED_SHOT_CLIP_NOT_PUBLISHABLE: "blocked_shot_clip_not_publishable",
  BLOCKED_SUPERSEDED_VERSION: "blocked_superseded_version",
  BLOCKED_MISSING_STORAGE_OBJECT: "blocked_missing_storage_object",
  BLOCKED_ACCOUNT_CONFIGURATION: "blocked_account_configuration",
  BLOCKED_PROJECT_RELATIONSHIP: "blocked_project_relationship",
  BLOCKED_UNSUPPORTED_MEDIA: "unsupported_media_type",
  BLOCKED_SOURCE_INELIGIBLE: "unsupported_asset_format",
};

function fromReelEligibility(eligibility: ReelPublicationEligibility): PublishCapability {
  if (eligibility.supported) return supported;
  return {
    supported: false,
    permanent: eligibility.permanent,
    code: REEL_CODE_MAP[eligibility.code] ?? "blocked_no_final_reel",
    reason: eligibility.reason,
  };
}

// Programme Stage 1B-D: facebook joins the live platform set. Everything
// Facebook-specific is handled by its own early-branching resolver below
// (resolveFacebookPublishCapability) so none of the pre-existing Instagram
// logic in this file changes shape or behaviour for platform="instagram".
export const SUPPORTED_PUBLISH_PLATFORMS = ["instagram", "facebook"] as const;
export const SUPPORTED_PUBLISH_CONTENT_TYPES = ["IMAGE", "CAROUSEL", "STORIES"] as const;
export const SUPPORTED_PUBLISH_ASSET_FORMATS = ["feed_post", "carousel", "story_sequence", "ad_static"] as const;

// Grounded in the Stage 1B-A capability matrix and Stage 1B-C's
// validateFacebookRenditionFormat (kept in sync with both — CAROUSEL and
// STORIES were never confirmed against Meta's own docs and stay blocked).
export const SUPPORTED_FACEBOOK_PUBLISH_CONTENT_TYPES = ["IMAGE", "VIDEO", "REELS", "TEXT_LINK"] as const;

const PLATFORMS = new Set<string>(SUPPORTED_PUBLISH_PLATFORMS);
const CONTENT_TYPES = new Set<string>(SUPPORTED_PUBLISH_CONTENT_TYPES);
const ASSET_FORMATS = new Set<string>(SUPPORTED_PUBLISH_ASSET_FORMATS);
const FACEBOOK_CONTENT_TYPES = new Set<string>(SUPPORTED_FACEBOOK_PUBLISH_CONTENT_TYPES);

/**
 * Phase 2 blocked every Reel with this message. Phase 3 keeps it ONLY for the
 * case it still describes accurately: a Reel-shaped publication with no final
 * Reel behind it (i.e. shot clips). It is no longer a blanket block.
 */
export const REEL_PUBLISHING_UNAVAILABLE_REASON =
  "Individual Reel Studio shot clips cannot be published. Upload the finished edit to the Reel Studio project, approve it, and publish that instead.";

const VIDEO_UNAVAILABLE_REASON =
  "Video publishing is not implemented. Only image posts, image carousels, and image Stories can be published from Cockpit today.";

const supported: PublishCapability = {
  supported: true,
  permanent: false,
  code: "supported",
  reason: "",
};

/**
 * Programme Stage 1B-D. Facebook's capability rules are structurally
 * different enough (no Instagram-style asset_format vocabulary, a genuinely
 * different set of supported content types, no final-Reel-contract gate —
 * Facebook Reel eligibility is proven at Rendition-approval time in Stage
 * 1B-C, not here) that branching early into a dedicated resolver is safer
 * than interleaving conditions into the Instagram logic below.
 */
function resolveFacebookPublishCapability(input: PublishCapabilityInput): PublishCapability {
  const contentType = (input.contentType ?? "IMAGE").trim().toUpperCase();
  if (!FACEBOOK_CONTENT_TYPES.has(contentType)) {
    return {
      supported: false, permanent: true, code: "unsupported_content_type",
      reason: `Facebook content type "${contentType}" is not supported by the current publisher.`,
    };
  }
  if (contentType !== "TEXT_LINK" && input.mediaMimeTypes.length === 0) {
    return {
      supported: false, permanent: true, code: "unsupported_asset_format",
      reason: `At least one media asset is required for Facebook content type "${contentType}".`,
    };
  }
  return supported;
}

export function resolvePublishCapability(input: PublishCapabilityInput): PublishCapability {
  const platform = (input.platform ?? "instagram").trim().toLowerCase();
  if (!PLATFORMS.has(platform)) {
    return {
      supported: false, permanent: true, code: "unsupported_platform",
      reason: `Publishing to "${platform}" is not supported.`,
    };
  }
  if (platform === "facebook") {
    return resolveFacebookPublishCapability(input);
  }

  const contentType = (input.contentType ?? "IMAGE").trim().toUpperCase();
  const assetFormat = (input.assetFormat ?? "").trim().toLowerCase();

  // ── Reels and Story video (Stage K) ─────────────────────────────────────
  // Both are decided entirely by the final-Reel contract: a Story video is
  // the same kind of thing as a Reel (a single approved, current MP4
  // deliverable) published to a different Instagram surface. Without a
  // context we cannot prove one exists, so we fail closed rather than
  // assume; with one, the specific blocking reason is surfaced.
  const isReelShaped = contentType === "REELS" || assetFormat === "reel_video";
  const isStoryVideoShaped = (contentType === "STORIES" && assetFormat === "story_video") || assetFormat === "story_video";
  if (isReelShaped || isStoryVideoShaped) {
    if (input.reelContext === undefined || input.reelContext === null) {
      return fromReelEligibility(shotClipPublicationBlocked());
    }
    const mediaTypes = input.mediaMimeTypes.map((mime) => (mime ?? "").trim().toLowerCase());
    if (mediaTypes.length > 0 && !mediaTypes.every((mime) => mime === "video/mp4")) {
      return {
        supported: false, permanent: true, code: "unsupported_media_type",
        reason: isStoryVideoShaped ? "An Instagram Story video must be a single MP4 video." : "An Instagram Reel must be a single MP4 video.",
      };
    }
    return fromReelEligibility(resolveReelPublicationEligibility(input.reelContext));
  }
  if (!CONTENT_TYPES.has(contentType)) {
    return {
      supported: false, permanent: true, code: "unsupported_content_type",
      reason: `Content type "${contentType}" is not supported by the current publisher.`,
    };
  }
  if (assetFormat && !ASSET_FORMATS.has(assetFormat)) {
    return {
      supported: false, permanent: true, code: "unsupported_asset_format",
      reason: `Asset format "${assetFormat.replaceAll("_", " ")}" is not supported by the current publisher.`,
    };
  }
  if (input.mediaMimeTypes.some((mime) => (mime ?? "").trim().toLowerCase().startsWith("video/"))) {
    return {
      supported: false, permanent: true, code: "unsupported_media_type",
      reason: VIDEO_UNAVAILABLE_REASON,
    };
  }
  return supported;
}

interface MediaLike { mime_type?: string | null }

/**
 * Convenience wrapper for a stored distribution record shape. `reelContext` must
 * be supplied by callers that have loaded the record's linked deliverable; the UI
 * passes what it has read, the backend passes what it has verified.
 */
export function resolveRecordPublishCapability(record: {
  platform?: string | null;
  asset_format?: string | null;
  publish_settings?: Record<string, unknown> | null;
  publish_payload?: Record<string, unknown> | null;
}, reelContext?: ReelPublicationContext | null): PublishCapability {
  const settings = record.publish_settings ?? {};
  const payload = record.publish_payload ?? {};
  const media = Array.isArray(payload.media) ? payload.media as MediaLike[] : [];
  return resolvePublishCapability({
    platform: typeof settings.platform === "string" ? settings.platform : record.platform,
    assetFormat: record.asset_format,
    contentType: typeof settings.content_type === "string" ? settings.content_type : "IMAGE",
    mediaMimeTypes: media.map((item) => item?.mime_type ?? null),
    reelContext,
  });
}
