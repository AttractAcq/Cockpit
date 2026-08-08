// Reel Studio Phase 3 + Programme Stage K: asynchronous Instagram Reels and
// Story-video publication. Meta's Content Publishing API uses the identical
// three-step container/poll/publish flow for both — the only difference is
// the `media_type` parameter (REELS vs STORIES) and that `share_to_feed`/
// `thumb_offset` are Reels-only options. A Story video is, architecturally,
// the same approved final MP4 deliverable a Reel is, published to a
// different Instagram surface; this module is shared rather than duplicated
// for the two.
//
// ── Verified official API contract (developers.facebook.com, checked 2026-07-28) ──
// Host: graph.facebook.com (the existing repo integration uses a Facebook-Login
//       system-user token + IG business account id, so we stay on this host).
//       rupload.facebook.com is only for the resumable byte-upload protocol; we
//       use the documented `video_url` pull method instead, so it is not needed.
//
//   1. Create container
//      POST /{ig-user-id}/media
//        media_type=REELS            (required)
//        video_url=<public https url> (required — "We cURL the video using the
//                                      passed-in URL, so it must be on a public
//                                      server")
//        caption=<text>              (optional, max 2200 chars / 30 hashtags / 20 @)
//        share_to_feed=<bool>        (optional, Reels only — appear in Feed too)
//        thumb_offset=<ms>           (optional, cover frame offset)
//      → { id: "<container-id>" }   ← this is the `creation_id`
//
//   2. Poll container
//      GET /{container-id}?fields=status_code
//      → status_code ∈ IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED
//      Meta recommends polling once per minute. A container EXPIRES if it is not
//      published within 24 hours.
//
//   3. Publish
//      POST /{ig-user-id}/media_publish
//        creation_id=<container-id>
//      → { id: "<ig-media-id>" }
//
//   Limits: 100 API-published posts per rolling 24h. Permission
//   instagram_content_publish (Facebook Login) on an Instagram professional
//   account. Reels media spec (duration 3s–15min, ≤300MB, aspect 0.01:1–10:1,
//   ≤1920px wide) is recorded in _shared/final-reel-contract.ts.
//
// ── Why this is a separate module from instagram-publish.ts ──
// Image/carousel/Story publication completes inside one invocation. A Reel cannot:
// Meta transcodes the video asynchronously and may take minutes. Holding an Edge
// Function open would breach the ~150s wall-clock cap. This module therefore
// exposes ONE step of a resumable state machine; the worker calls it repeatedly.
//
// Safety: never logs or persists the signed media URL or the access token.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
// Dependency-free error primitives: importing instagram-publish.ts here would pull
// the Supabase client in at runtime and make this module untestable in isolation.
import { classifyMetaError, MetaPublishError, type MetaErrorClassification } from "./meta-errors.ts";

const GRAPH_VERSION = "v21.0";
export const REEL_SIGNED_URL_TTL_SECONDS = 6 * 60 * 60; // ample for Meta ingestion, well under container expiry
export const REEL_MAX_CONTAINER_POLLS = 20;
export const REEL_CONTAINER_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const REEL_POLL_INTERVAL_MS = 60_000; // Meta recommends ~once per minute

export type ReelContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

const KNOWN_STATUSES = new Set<string>(["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED"]);

export function isReelContainerStatus(value: unknown): value is ReelContainerStatus {
  return typeof value === "string" && KNOWN_STATUSES.has(value);
}

export interface ReelPublishRecord {
  id: string;
  client_id: string;
  source_ref: string;
  asset_format: string;
  publish_status: string;
  external_container_id: string | null;
  container_status: string | null;
  container_created_at: string | null;
  container_poll_count: number;
  external_post_id: string | null;
  published_at: string | null;
  published_url: string | null;
  publish_payload: Record<string, unknown>;
  publish_settings: Record<string, unknown>;
  video_deliverable_id: string | null;
}

/** One resumable step's outcome. The worker translates this into DB state. */
export type ReelStepDisposition =
  | { kind: "container_created"; containerId: string; status: ReelContainerStatus }
  | { kind: "container_processing"; containerId: string; status: ReelContainerStatus; pollCount: number }
  | { kind: "published"; containerId: string; externalPostId: string; permalink: string | null }
  | { kind: "already_published"; externalPostId: string }
  | { kind: "transient_failure"; classification: MetaErrorClassification }
  | { kind: "permanent_failure"; classification: MetaErrorClassification };

export interface ReelPublishDeps {
  /** Mint a short-lived public URL for the private final MP4. Never logged. */
  signMedia(bucket: string, path: string, ttlSeconds: number): Promise<string>;
  createReelContainer(igUserId: string, params: ReelContainerParams, token: string): Promise<string>;
  fetchContainerStatus(containerId: string, token: string): Promise<string | undefined>;
  mediaPublish(igUserId: string, creationId: string, token: string): Promise<string>;
  fetchPermalink(mediaId: string, token: string): Promise<string | null>;
  /** Persist the container id the instant Meta returns it (before anything else). */
  persistContainerId(containerId: string, status: ReelContainerStatus): Promise<void>;
  /** Persist the media id the instant Meta returns it, before the permalink fetch. */
  persistExternalPostId(externalPostId: string): Promise<void>;
  now(): number;
}

export type VideoContainerMediaType = "REELS" | "STORIES";

export interface ReelContainerParams {
  videoUrl: string;
  caption: string;
  shareToFeed: boolean;
  thumbOffsetMs?: number | null;
  /** Defaults to REELS for full backward compatibility with existing callers. */
  mediaType?: VideoContainerMediaType;
}

export interface ReelStepInput {
  record: ReelPublishRecord;
  igUserId: string;
  token: string;
  media: { storage_bucket: string; storage_path: string };
  /** Defaults to REELS for full backward compatibility with existing callers. */
  mediaType?: VideoContainerMediaType;
}

function permanent(category: MetaErrorClassification["category"], message: string): MetaErrorClassification {
  return { provider: "meta", category, retryable: false, message };
}

/**
 * Advance ONE step of the Reel publication state machine. Idempotent at every
 * boundary: an existing container is never recreated, and an existing media id is
 * never republished.
 */
export async function advanceReelPublication(deps: ReelPublishDeps, input: ReelStepInput): Promise<ReelStepDisposition> {
  const { record } = input;

  // Duplicate-publication guard first: real evidence means the post is live.
  if (record.external_post_id) {
    return { kind: "already_published", externalPostId: record.external_post_id };
  }

  // ── Step 1: no container yet → create exactly one ────────────────────────
  if (!record.external_container_id) {
    let videoUrl: string;
    try {
      videoUrl = await deps.signMedia(input.media.storage_bucket, input.media.storage_path, REEL_SIGNED_URL_TTL_SECONDS);
    } catch (error) {
      // A missing object is permanent; a signing outage is transient. We can only
      // distinguish by the storage error, so treat a signing failure as transient
      // and let the attempt budget bound it.
      return {
        kind: "transient_failure",
        classification: {
          provider: "meta", category: "transient_media", retryable: true,
          message: `Could not create a signed media URL for the final Reel: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }

    const settings = record.publish_settings ?? {};
    const payload = record.publish_payload ?? {};
    const caption = typeof payload.caption === "string" ? payload.caption : "";
    const shareToFeed = settings.share_to_feed !== false; // default true
    const thumbOffset = typeof settings.thumb_offset_ms === "number" ? settings.thumb_offset_ms : null;

    let containerId: string;
    try {
      containerId = await deps.createReelContainer(input.igUserId, {
        videoUrl, caption, shareToFeed, thumbOffsetMs: thumbOffset, mediaType: input.mediaType ?? "REELS",
      }, input.token);
    } catch (error) {
      const classification = error instanceof MetaPublishError
        ? error.classification
        : permanent("meta_publish_failed", error instanceof Error ? error.message : String(error));
      return classification.retryable
        ? { kind: "transient_failure", classification }
        : { kind: "permanent_failure", classification };
    }

    // Persist BEFORE returning so a crash here can never cause a second container.
    await deps.persistContainerId(containerId, "IN_PROGRESS");
    return { kind: "container_created", containerId, status: "IN_PROGRESS" };
  }

  // ── Step 2: container exists → poll, then publish when FINISHED ──────────
  const containerId = record.external_container_id;
  const createdAt = record.container_created_at ? Date.parse(record.container_created_at) : null;
  if (createdAt !== null && deps.now() - createdAt > REEL_CONTAINER_EXPIRY_MS) {
    return {
      kind: "permanent_failure",
      classification: permanent("container_expired", "The Instagram media container expired before it could be published (Meta expires containers after 24 hours). Schedule the Reel again to create a new container."),
    };
  }
  if (record.container_poll_count >= REEL_MAX_CONTAINER_POLLS) {
    return {
      kind: "permanent_failure",
      classification: permanent("container_processing_timeout", `Instagram did not finish processing this Reel after ${REEL_MAX_CONTAINER_POLLS} status checks. Nothing was published.`),
    };
  }

  let status: string | undefined;
  try {
    status = await deps.fetchContainerStatus(containerId, input.token);
  } catch (error) {
    const classification = error instanceof MetaPublishError
      ? error.classification
      : { provider: "meta" as const, category: "meta_server_error" as const, retryable: true, message: error instanceof Error ? error.message : String(error) };
    return classification.retryable
      ? { kind: "transient_failure", classification }
      : { kind: "permanent_failure", classification };
  }

  if (!isReelContainerStatus(status)) {
    return {
      kind: "transient_failure",
      classification: { provider: "meta", category: "meta_server_error", retryable: true, message: `Unrecognised Instagram container status: ${status ?? "none"}.` },
    };
  }
  if (status === "ERROR") {
    return {
      kind: "permanent_failure",
      classification: permanent("container_error", "Instagram rejected this Reel during processing. The video does not meet Reels requirements (check duration, codec, aspect ratio and file size)."),
    };
  }
  if (status === "EXPIRED") {
    return {
      kind: "permanent_failure",
      classification: permanent("container_expired", "The Instagram media container expired before publication. Schedule the Reel again."),
    };
  }
  if (status === "IN_PROGRESS") {
    return { kind: "container_processing", containerId, status, pollCount: record.container_poll_count + 1 };
  }

  // FINISHED (or PUBLISHED — Meta already published it; media_publish would
  // duplicate, so treat it as terminal-success and let reconciliation attach the
  // id if we never received one).
  if (status === "PUBLISHED") {
    return {
      kind: "transient_failure",
      classification: {
        provider: "meta", category: "meta_publish_failed", retryable: false,
        message: "Instagram reports this container as already PUBLISHED but Cockpit holds no media id. Reconcile manually before any retry — do not republish.",
      },
    };
  }

  let externalPostId: string;
  try {
    externalPostId = await deps.mediaPublish(input.igUserId, containerId, input.token);
  } catch (error) {
    const classification = error instanceof MetaPublishError
      ? error.classification
      : permanent("meta_publish_failed", error instanceof Error ? error.message : String(error));
    return classification.retryable
      ? { kind: "transient_failure", classification }
      : { kind: "permanent_failure", classification };
  }

  // Persist evidence immediately — before the permalink fetch — so a crash here
  // can never produce a duplicate post.
  await deps.persistExternalPostId(externalPostId);
  const permalink = await deps.fetchPermalink(externalPostId, input.token).catch(() => null);
  return { kind: "published", containerId, externalPostId, permalink };
}

// ── Live Graph helpers (plain fetch; token never logged) ────────────────────

async function graphPost(path: string, params: Record<string, string>, token: string): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MetaPublishError(classifyMetaError(res.status, data, "meta_publish_failed"));
  return data as Record<string, unknown>;
}

async function graphGet(path: string, fields: string, token: string): Promise<Record<string, unknown>> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(path)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MetaPublishError(classifyMetaError(res.status, data, "meta_publish_failed"));
  return data as Record<string, unknown>;
}

/** Production dependency set. `sb` must be a service-role client. */
export function liveReelPublishDeps(sb: SupabaseClient, recordId: string): ReelPublishDeps {
  return {
    signMedia: async (bucket, path, ttlSeconds) => {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, ttlSeconds);
      if (error || !data?.signedUrl) throw new Error(error?.message ?? "no signed url returned");
      return data.signedUrl;
    },
    createReelContainer: (igUserId, params, token) => {
      const mediaType = params.mediaType ?? "REELS";
      const body: Record<string, string> = {
        media_type: mediaType,
        video_url: params.videoUrl,
      };
      if (params.caption) body.caption = params.caption;
      // share_to_feed and thumb_offset are Reels-only options; Meta's Stories
      // video container does not document or accept them.
      if (mediaType === "REELS") {
        body.share_to_feed = params.shareToFeed ? "true" : "false";
        if (typeof params.thumbOffsetMs === "number" && params.thumbOffsetMs >= 0) {
          body.thumb_offset = String(Math.round(params.thumbOffsetMs));
        }
      }
      return graphPost(`${igUserId}/media`, body, token).then((data) => String(data.id));
    },
    fetchContainerStatus: async (containerId, token) => {
      const data = await graphGet(containerId, "status_code", token);
      return typeof data.status_code === "string" ? data.status_code : undefined;
    },
    mediaPublish: (igUserId, creationId, token) =>
      graphPost(`${igUserId}/media_publish`, { creation_id: creationId }, token).then((data) => String(data.id)),
    fetchPermalink: async (mediaId, token) => {
      try {
        const data = await graphGet(mediaId, "permalink", token);
        return typeof data.permalink === "string" ? data.permalink : null;
      } catch { return null; }
    },
    persistContainerId: async (containerId, status) => {
      await sb.from("client_distribution_records").update({
        external_container_id: containerId,
        container_status: status,
        container_created_at: new Date().toISOString(),
        container_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", recordId).is("external_container_id", null);
    },
    persistExternalPostId: async (externalPostId) => {
      await sb.from("client_distribution_records").update({
        publish_status: "published",
        external_post_id: externalPostId,
        published_at: new Date().toISOString(),
        container_status: "PUBLISHED",
        updated_at: new Date().toISOString(),
      }).eq("id", recordId);
    },
    now: () => Date.now(),
  };
}
