// Programme Stage 1B-A — Facebook Architecture and Capability Baseline.
//
// This module defines the CANONICAL, cross-platform domain contract for
// organic distribution: Platform, Destination, Rendition, Publication and
// Receipt. It is deliberately a SEPARATE, additive artifact from
// `publish-capability.ts` — the stage's exit gate is explicit that no
// Facebook credential or publishing implementation may begin until these
// contracts exist and are tested, so this module defines the target shape
// without wiring it into the live gate. `SUPPORTED_PUBLISH_PLATFORMS` in
// `publish-capability.ts` remains `["instagram"]` and is untouched by this
// stage; `LIVE_PLATFORMS` below mirrors that same fact for callers of this
// contract, so nothing reading this module can mistake "defined" for "live".
//
// Every shape here was derived from two real sources, not invented: (1) the
// live `client_distribution_records` / `client_distribution_accounts` /
// `client_analytics_records` schemas (read directly this stage — see
// docs/programme/phase-1b/1B-A-current-state-integration-inventory.md), and
// (2) Meta's own Graph API reference pages for Facebook Page publishing,
// fetched live this stage (see 1B-A-facebook-capability-matrix.md). Where
// Instagram and Facebook genuinely differ (most visibly: Reels), the
// contract keeps them distinct rather than forcing a shared shape.

// ── Platform ──────────────────────────────────────────────────────────────

export const ALL_PLATFORMS = ["instagram", "facebook"] as const;
export type DistributionPlatform = (typeof ALL_PLATFORMS)[number];

/**
 * Platforms with a real, live publisher today. Deliberately narrower than
 * ALL_PLATFORMS — Facebook is a defined contract, not a live capability,
 * until Stage 1B-D. Mirrors `SUPPORTED_PUBLISH_PLATFORMS` in
 * publish-capability.ts; kept as a separate constant rather than importing
 * from there so this contract module has no dependency on the live gate
 * (and the live gate has no dependency on this not-yet-used contract).
 */
export const LIVE_PLATFORMS = ["instagram"] as const;
export type LivePlatform = (typeof LIVE_PLATFORMS)[number];

export function isLivePlatform(platform: string): platform is LivePlatform {
  return (LIVE_PLATFORMS as readonly string[]).includes(platform);
}

// ── Destination ───────────────────────────────────────────────────────────
// Matches the real, live `client_distribution_accounts` row shape exactly —
// that table needed no schema change to hold this contract (verified this
// stage: platform is already free-text, unconstrained, default 'instagram').

export interface Destination {
  id: string;
  clientId: string;
  platform: DistributionPlatform;
  label: string;
  handle: string;
  externalAccountId: string;
  accountType: string | null;
  isDefault: boolean;
  isActive: boolean;
}

// ── Rendition ─────────────────────────────────────────────────────────────
// The platform-specific expression of one canonical Content Item. Per the
// Phase 1-B strategic objective: one Content Item can produce an Instagram
// rendition and a Facebook rendition that differ in copy, hook treatment,
// CTA, aspect ratio, duration, thumbnail, metadata, scheduling policy,
// publication state and analytics. Today this is carried implicitly inside
// `client_distribution_records.publish_payload`/`publish_settings` (jsonb,
// already format-agnostic) — this interface makes that shape explicit and
// typed rather than adding new columns.

export type RenditionContentType =
  | "IMAGE"
  | "CAROUSEL"
  | "STORIES"
  | "REELS"
  | "VIDEO"       // Facebook feed video — not a container-and-poll model like Reels; see ProviderProcessingState.
  | "TEXT_LINK";  // Facebook /feed text/link post — no Instagram equivalent exists.

export interface RenditionMedia {
  storageBucket: string;
  storagePath: string;
  sequenceIndex?: number;
  mimeType?: string;
  width?: number;
  height?: number;
}

export interface Rendition {
  platform: DistributionPlatform;
  contentType: RenditionContentType;
  caption: string;
  media: RenditionMedia[];
  /** Platform-specific fields that do not generalize (e.g. Facebook's `title`/`description` on video posts vs. Instagram's caption-only model). */
  platformFields: Record<string, unknown>;
}

// ── Publication status machine ───────────────────────────────────────────
// Shared, cross-platform. Verified against the live CHECK constraint on
// `client_distribution_records.publish_status` this stage — already
// platform-agnostic, no change needed for Facebook to use the same machine.

export const PUBLICATION_STATUSES = [
  "ready", "scheduled", "publishing", "published", "failed", "cancelled", "needs_reconciliation",
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

const TERMINAL_STATUSES = new Set<PublicationStatus>(["published", "cancelled"]);
export function isTerminalPublicationStatus(status: PublicationStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// ── Provider processing state (Receipt) ──────────────────────────────────
// Deliberately NOT unified across platforms — Instagram's container model
// and Facebook's Reels upload-session model are genuinely different state
// machines (verified against Meta's own docs this stage), and Facebook's
// non-Reels video/photo/feed publishing is synchronous with no processing
// state at all. A discriminated union keeps each platform's real shape
// instead of forcing a lowest-common-denominator that would misrepresent
// either one.

/** Instagram: create container → poll status_code → media_publish. */
export interface InstagramContainerState {
  kind: "instagram_container";
  containerId: string;
  statusCode: "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";
  pollCount: number;
}

/** Facebook Reels: start an upload session → push bytes to upload_url → finish. */
export interface FacebookReelUploadState {
  kind: "facebook_reel_upload";
  videoId: string;
  uploadPhase: "START" | "UPLOADING" | "FINISH";
  videoState: "DRAFT" | "PUBLISHED" | "SCHEDULED";
}

/** Facebook feed video, photo, and text/link posts: one synchronous call, no processing state. */
export interface SynchronousPublishState {
  kind: "synchronous";
}

export type ProviderProcessingState = InstagramContainerState | FacebookReelUploadState | SynchronousPublishState;

// ── Receipt ───────────────────────────────────────────────────────────────
// Evidence of a real provider publication. `hasEvidence` mirrors the exact
// duplicate-publication guard already live in instagram-publish.ts
// (hasPublicationEvidence) — restated generically so Facebook's publisher
// can reuse the same non-negotiable rule: a record with any evidence field
// set must never be re-published.

export interface Receipt {
  externalPostId: string | null;
  publishedAt: string | null; // ISO 8601
  publishedUrl: string | null;
}

export function hasPublicationEvidence(receipt: Receipt): boolean {
  return !!(receipt.externalPostId || receipt.publishedAt || receipt.publishedUrl);
}

// ── Publication ───────────────────────────────────────────────────────────
// The full record of one attempt to publish one Rendition to one
// Destination. Maps 1:1 onto a real `client_distribution_records` row.

export interface Publication {
  id: string;
  clientId: string;
  destinationId: string;
  rendition: Rendition;
  status: PublicationStatus;
  receipt: Receipt;
  processingState: ProviderProcessingState | null;
  lastError: string | null;
}

// ── Compatibility: map a real, live Instagram client_distribution_records
// row into this contract, losslessly. Required by the stage's acceptance
// criteria ("no existing Instagram path regresses") and exercised by
// distribution-platform-contract.test.ts's compatibility tests against
// real status/content-type/asset-format vocabularies already live today.

export interface LegacyInstagramDistributionRow {
  id: string;
  client_id: string;
  platform: string | null;
  destination: string | null;
  asset_format: string | null;
  publish_status: string;
  publish_payload: Record<string, unknown> | null;
  publish_settings: Record<string, unknown> | null;
  external_post_id: string | null;
  published_at: string | null;
  published_url: string | null;
  external_container_id: string | null;
  container_status: string | null;
  container_poll_count: number | null;
  last_error: string | null;
}

/** Maps asset_format (e.g. 'feed_post', 'carousel') to the contract's RenditionContentType. */
const ASSET_FORMAT_CONTENT_TYPE: Record<string, RenditionContentType> = {
  feed_post: "IMAGE",
  ad_static: "IMAGE",
  carousel: "CAROUSEL",
  story_sequence: "STORIES",
  story_video: "STORIES",
  reel_video: "REELS",
};

function resolveContentType(row: LegacyInstagramDistributionRow): RenditionContentType {
  const settings = row.publish_settings ?? {};
  const declared = typeof settings.content_type === "string" ? settings.content_type.toUpperCase() : null;
  if (declared === "IMAGE" || declared === "CAROUSEL" || declared === "STORIES" || declared === "REELS") return declared;
  const fromFormat = row.asset_format ? ASSET_FORMAT_CONTENT_TYPE[row.asset_format] : undefined;
  return fromFormat ?? "IMAGE";
}

export function fromLegacyInstagramRow(row: LegacyInstagramDistributionRow): Publication {
  const payload = row.publish_payload ?? {};
  const media = Array.isArray(payload.media)
    ? (payload.media as Array<Record<string, unknown>>).map((item) => ({
        storageBucket: String(item.storage_bucket ?? ""),
        storagePath: String(item.storage_path ?? ""),
        sequenceIndex: typeof item.sequence_index === "number" ? item.sequence_index : undefined,
        mimeType: typeof item.mime_type === "string" ? item.mime_type : undefined,
        width: typeof item.width === "number" ? item.width : undefined,
        height: typeof item.height === "number" ? item.height : undefined,
      }))
    : [];

  const processingState: ProviderProcessingState | null = row.external_container_id
    ? {
        kind: "instagram_container",
        containerId: row.external_container_id,
        statusCode: (row.container_status as InstagramContainerState["statusCode"]) ?? "IN_PROGRESS",
        pollCount: row.container_poll_count ?? 0,
      }
    : null;

  return {
    id: row.id,
    clientId: row.client_id,
    destinationId: row.destination ?? "",
    rendition: {
      platform: (row.platform as DistributionPlatform) ?? "instagram",
      contentType: resolveContentType(row),
      caption: typeof payload.caption === "string" ? payload.caption : "",
      media,
      platformFields: {},
    },
    status: row.publish_status as PublicationStatus,
    receipt: {
      externalPostId: row.external_post_id,
      publishedAt: row.published_at,
      publishedUrl: row.published_url,
    },
    processingState,
    lastError: row.last_error,
  };
}
