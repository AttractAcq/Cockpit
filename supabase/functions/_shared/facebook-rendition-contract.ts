// Programme Stage 1B-C — Facebook Rendition capability and lifecycle rules.
// Dependency-free (same convention as facebook-pages.ts / meta-errors.ts) so
// it is unit-testable under `node --test` without pulling in the Supabase
// client.
//
// Reuses RenditionContentType from _shared/distribution-platform-contract.ts
// (Stage 1B-A's canonical domain contract) rather than inventing a second
// format vocabulary -- this is the first real use of that contract.
import type { RenditionContentType } from "./distribution-platform-contract.ts";

// Grounded in the Stage 1B-A capability matrix (docs/programme/phase-1b/
// 1B-A-facebook-capability-matrix.md), fetched live from Meta's own Graph API
// docs: photo (IMAGE), video (VIDEO), Reels (REELS), and text/link (TEXT_LINK)
// posts are confirmed. CAROUSEL (multi-photo album) and STORIES were
// explicitly left unverified against primary documentation in Stage 1B-A --
// blocked here rather than assumed supported, matching "Facebook capability
// is not inferred from Instagram capability."
export const SUPPORTED_FACEBOOK_RENDITION_FORMATS: readonly RenditionContentType[] = ["IMAGE", "VIDEO", "REELS", "TEXT_LINK"];

export interface FormatCapabilityResult {
  supported: boolean;
  reason: string | null;
}

export function validateFacebookRenditionFormat(format: RenditionContentType): FormatCapabilityResult {
  if (SUPPORTED_FACEBOOK_RENDITION_FORMATS.includes(format)) {
    return { supported: true, reason: null };
  }
  if (format === "CAROUSEL" || format === "STORIES") {
    return {
      supported: false,
      reason: `Facebook ${format === "CAROUSEL" ? "multi-photo albums" : "Stories"} capability was not confirmed against Meta's primary documentation (Stage 1B-A). This format is blocked until it is verified, not assumed from Instagram parity.`,
    };
  }
  return { supported: false, reason: `Format "${format}" is not a recognised Facebook rendition format.` };
}

// ── Media: shared vs platform-specific, expressed structurally ──────────
// A content_item_asset_id used by more than one rendition (or that matches
// the content item's other real usages) is "shared"; one referenced only by
// this rendition is "platform-specific". No redundant boolean to drift out
// of sync -- this is derived, not stored.

export interface MediaClassification {
  sharedAssetIds: string[];
  platformSpecificAssetIds: string[];
}

export function classifyRenditionMedia(thisRenditionAssetIds: readonly string[], otherRenditionAssetIdSets: readonly (readonly string[])[]): MediaClassification {
  const otherIds = new Set(otherRenditionAssetIdSets.flat());
  const sharedAssetIds: string[] = [];
  const platformSpecificAssetIds: string[] = [];
  for (const id of thisRenditionAssetIds) {
    (otherIds.has(id) ? sharedAssetIds : platformSpecificAssetIds).push(id);
  }
  return { sharedAssetIds, platformSpecificAssetIds };
}

// ── Lifecycle / approval-readiness ───────────────────────────────────────
// Mirrors content_briefs' review-gate discipline (checkProofGate) but for a
// Rendition's own, independent fields. Never lets a rendition reach
// in_review or approved with empty creative content or an unsupported
// format -- "unsupported destination capabilities block publication
// clearly" is enforced HERE, at the review gate, not only at publish time.

export interface RenditionReadiness {
  ready: boolean;
  reasons: string[];
}

export interface RenditionReadinessInput {
  copy: string;
  cta: string;
  mediaCount: number;
  format: RenditionContentType;
}

export function checkRenditionReadyForReview(input: RenditionReadinessInput): RenditionReadiness {
  const reasons: string[] = [];
  if (input.copy.trim().length === 0) reasons.push("Copy is required before this rendition can be reviewed.");
  if (input.cta.trim().length === 0) reasons.push("A call to action is required before this rendition can be reviewed.");
  if (input.mediaCount === 0 && input.format !== "TEXT_LINK") reasons.push("At least one media asset is required for this format.");
  const capability = validateFacebookRenditionFormat(input.format);
  if (!capability.supported) reasons.push(capability.reason ?? "This format is not supported.");
  return { ready: reasons.length === 0, reasons };
}

// ── Status transitions ────────────────────────────────────────────────────
// Mirrors content_briefs' exact 3-action lifecycle (submit_for_review /
// approve / request_changes) -- deliberately the same action names and the
// same state machine shape, per review-content-brief.ts's own convention
// note that new lifecycles in this area should collapse onto the existing
// one rather than inventing new vocabulary.

export type RenditionStatus = "draft" | "in_review" | "approved" | "superseded";
export type RenditionReviewAction = "submit_for_review" | "approve" | "request_changes";

export interface TransitionResult {
  allowed: boolean;
  nextStatus: RenditionStatus | null;
  reason: string | null;
}

export function resolveRenditionTransition(currentStatus: RenditionStatus, action: RenditionReviewAction, readiness: RenditionReadiness): TransitionResult {
  if (currentStatus === "superseded") {
    return { allowed: false, nextStatus: null, reason: "A superseded rendition cannot be reviewed. Create a new version instead." };
  }
  if (action === "submit_for_review") {
    if (currentStatus !== "draft") return { allowed: false, nextStatus: null, reason: `Cannot submit for review from status "${currentStatus}".` };
    if (!readiness.ready) return { allowed: false, nextStatus: null, reason: readiness.reasons.join(" ") };
    return { allowed: true, nextStatus: "in_review", reason: null };
  }
  if (action === "approve") {
    if (currentStatus !== "in_review") return { allowed: false, nextStatus: null, reason: `Cannot approve from status "${currentStatus}". Submit for review first.` };
    if (!readiness.ready) return { allowed: false, nextStatus: null, reason: readiness.reasons.join(" ") };
    return { allowed: true, nextStatus: "approved", reason: null };
  }
  // request_changes
  if (currentStatus !== "in_review") return { allowed: false, nextStatus: null, reason: `Cannot request changes from status "${currentStatus}".` };
  return { allowed: true, nextStatus: "draft", reason: null };
}

/** Can this rendition's editable fields (copy/cta/media/scheduling_guidance) still be changed? Mirrors content_briefs: only draft is freely editable. */
export function isRenditionEditable(status: RenditionStatus): boolean {
  return status === "draft";
}
