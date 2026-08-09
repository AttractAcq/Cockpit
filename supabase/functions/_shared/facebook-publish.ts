// Programme Stage 1B-D — Facebook Page publishing: photo, feed text/link,
// video and Reels. Dependency-injected (same convention as
// instagram-publish.ts/instagram-reels-publish.ts) so every decision here is
// unit-testable without a real network call or real Meta credentials.
//
// Verified official API contracts (developers.facebook.com, checked live
// during Stages 1B-A and 1B-D):
//   Photo:      POST /{page-id}/photos  {url, caption}                    → {id, post_id}
//   Feed text:  POST /{page-id}/feed    {message, link?}                  → {id}
//   Video:      POST /{page-id}/videos  {file_url, title, description,
//                                        published:true}                  → {id: video_id}
//               GET  /{video-id}?fields=status
//                 → {video_status: "ready"|"processing"|"error", processing_progress}
//   Reels:      POST /{page-id}/video_reels?upload_phase=start            → {video_id, upload_url}
//               POST https://rupload.facebook.com/video-upload/{version}/{video_id}
//                 headers: Authorization: OAuth <token>, file_url: <hosted url>
//               GET  /{video-id}?fields=status  (same shape as regular video)
//               POST /{page-id}/video_reels?upload_phase=finish&video_id=X&video_state=PUBLISHED
//
// Reels deliberately use the "hosted URL" upload variant (Meta's official
// fbsamples Postman collection documents this as Step 2B, an alternative to
// streaming raw bytes) since our media already lives in Supabase Storage
// behind signed URLs — this avoids implementing binary/chunked upload
// entirely, mirroring how Instagram's own container creation already just
// hands Meta a signed URL rather than streaming bytes itself.
//
// A Page-level action needs a PAGE access token, not the raw Meta System
// User token — GET /{page-id}?fields=access_token derives it. Every
// publishing call below requires this exchange first.
//
// Same non-negotiable safety contract as instagram-publish.ts: credentials
// checked first, a record is only ever marked published after a REAL Meta
// success, Meta's async processing is never assumed complete without a
// confirmed status, tokens/signed URLs are never logged.
import { classifyMetaError, MetaPublishError, type MetaErrorClassification } from "./meta-errors.ts";

const GRAPH_VERSION = "v21.0"; // Same version as instagram-publish.ts / meta-ads.ts. Expires 2027-01-21 (verified live, Stage 1B-A).
const RUPLOAD_HOST = "https://rupload.facebook.com";

export const FACEBOOK_MAX_STATUS_POLLS = 20; // mirrors REEL_MAX_CONTAINER_POLLS's order of magnitude
export const FACEBOOK_POLL_INTERVAL_MS = 60_000; // Meta recommends ~once per minute for video processing, same cadence Instagram's Reels use
export const FACEBOOK_PROCESSING_EXPIRY_MS = 24 * 60 * 60 * 1000; // no documented expiry; applying Instagram's own 24h container-expiry ceiling defensively rather than polling forever

// ── Page access token exchange ────────────────────────────────────────────

async function graphGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MetaPublishError(classifyMetaError(res.status, data, "meta_publish_failed"));
  return data as Record<string, unknown>;
}

async function graphPost(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;
  const res = await fetch(url, { method: "POST", body: new URLSearchParams(params) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MetaPublishError(classifyMetaError(res.status, data, "meta_publish_failed"));
  return data as Record<string, unknown>;
}

export async function resolvePageAccessToken(pageId: string, userToken: string): Promise<string> {
  const data = await graphGet(pageId, { fields: "access_token", access_token: userToken });
  const token = typeof data.access_token === "string" ? data.access_token : null;
  if (!token) {
    throw new MetaPublishError({
      provider: "meta", category: "meta_authentication", retryable: false,
      message: "Meta did not return a Page access token. The connected identity may not have CREATE_CONTENT access on this Page.",
    });
  }
  return token;
}

// ── Synchronous publishers: photo, feed text/link ─────────────────────────

export interface PhotoPublishResult { externalPostId: string }
export async function publishFacebookPhoto(pageId: string, pageToken: string, imageUrl: string, caption: string): Promise<PhotoPublishResult> {
  const data = await graphPost(`${pageId}/photos`, { url: imageUrl, caption, access_token: pageToken });
  const postId = typeof data.post_id === "string" ? data.post_id : typeof data.id === "string" ? data.id : null;
  if (!postId) throw new MetaPublishError({ provider: "meta", category: "meta_publish_failed", retryable: false, message: "Meta accepted the photo but returned no post id." });
  return { externalPostId: postId };
}

export interface FeedPublishResult { externalPostId: string }
export async function publishFacebookFeedText(pageId: string, pageToken: string, message: string, link: string | null): Promise<FeedPublishResult> {
  const params: Record<string, string> = { message, access_token: pageToken };
  if (link) params.link = link;
  const data = await graphPost(`${pageId}/feed`, params);
  const postId = typeof data.id === "string" ? data.id : null;
  if (!postId) throw new MetaPublishError({ provider: "meta", category: "meta_publish_failed", retryable: false, message: "Meta accepted the post but returned no post id." });
  return { externalPostId: postId };
}

// ── Video status (shared by regular Video and Reels) ──────────────────────

export type FacebookVideoStatus = "ready" | "processing" | "error";
export interface VideoStatusResult { videoStatus: FacebookVideoStatus; processingProgress: number | null }

export async function checkFacebookVideoStatus(videoId: string, pageToken: string): Promise<VideoStatusResult> {
  const data = await graphGet(videoId, { fields: "status", access_token: pageToken });
  const status = (data.status ?? {}) as Record<string, unknown>;
  const videoStatus = typeof status.video_status === "string" ? status.video_status : "processing";
  const progress = typeof status.processing_progress === "number" ? status.processing_progress : null;
  return {
    videoStatus: videoStatus === "ready" || videoStatus === "error" ? videoStatus : "processing",
    processingProgress: progress,
  };
}

// ── Regular video (async transcode, synchronous submission) ──────────────

export async function submitFacebookVideo(pageId: string, pageToken: string, fileUrl: string, title: string, description: string): Promise<{ videoId: string }> {
  const data = await graphPost(`${pageId}/videos`, { file_url: fileUrl, title, description, published: "true", access_token: pageToken });
  const videoId = typeof data.id === "string" ? data.id : null;
  if (!videoId) throw new MetaPublishError({ provider: "meta", category: "meta_publish_failed", retryable: false, message: "Meta accepted the video but returned no video id." });
  return { videoId };
}

// ── Reels (multi-step resumable upload session) ───────────────────────────

export async function startFacebookReelUpload(pageId: string, pageToken: string): Promise<{ videoId: string; uploadUrl: string }> {
  const data = await graphPost(`${pageId}/video_reels`, { upload_phase: "start", access_token: pageToken });
  const videoId = typeof data.video_id === "string" ? data.video_id : null;
  const uploadUrl = typeof data.upload_url === "string" ? data.upload_url : null;
  if (!videoId || !uploadUrl) throw new MetaPublishError({ provider: "meta", category: "meta_publish_failed", retryable: false, message: "Meta did not return a video id and upload url for the Reel session." });
  return { videoId, uploadUrl };
}

/** Step 2B of Meta's documented Reels flow: hand Meta a hosted URL instead of streaming bytes. */
export async function uploadFacebookReelFromUrl(videoId: string, pageToken: string, fileUrl: string): Promise<void> {
  const res = await fetch(`${RUPLOAD_HOST}/video-upload/${GRAPH_VERSION}/${videoId}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${pageToken}`, file_url: fileUrl },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MetaPublishError(classifyMetaError(res.status, data, "meta_publish_failed"));
}

export async function finishFacebookReel(
  pageId: string, pageToken: string, videoId: string,
  videoState: "PUBLISHED" | "DRAFT" | "SCHEDULED", description: string, title: string,
): Promise<{ externalPostId: string }> {
  const data = await graphPost(`${pageId}/video_reels`, {
    upload_phase: "finish", video_id: videoId, video_state: videoState, description, title, access_token: pageToken,
  });
  // Meta's finish step does not consistently document a post_id in every
  // response shape across Reel states; video_id is always present and is
  // itself real, durable provider evidence of the publication attempt.
  const postId = typeof data.post_id === "string" ? data.post_id : videoId;
  return { externalPostId: postId };
}

// ── Async processing state (persisted in client_distribution_records.provider_processing_state) ──

export type FacebookProcessingKind = "facebook_video" | "facebook_reel";
export type FacebookReelPhase = "uploaded" | "processing";

export interface FacebookVideoProcessingState {
  kind: "facebook_video";
  videoId: string;
  pollCount: number;
  startedAt: string; // ISO 8601, for the expiry ceiling
}
export interface FacebookReelProcessingState {
  kind: "facebook_reel";
  videoId: string;
  phase: FacebookReelPhase;
  pollCount: number;
  startedAt: string;
}
export type FacebookProcessingState = FacebookVideoProcessingState | FacebookReelProcessingState;

export function isFacebookProcessingState(value: unknown): value is FacebookProcessingState {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "facebook_video" || kind === "facebook_reel";
}

/** True once a processing state has exceeded the poll or wall-clock ceiling — mirrors Instagram Reels' own two-part expiry guard. */
export function isFacebookProcessingExpired(state: FacebookProcessingState, now: () => number = () => Date.now()): boolean {
  if (state.pollCount >= FACEBOOK_MAX_STATUS_POLLS) return true;
  const started = Date.parse(state.startedAt);
  return !Number.isNaN(started) && now() - started > FACEBOOK_PROCESSING_EXPIRY_MS;
}

// ── Orchestration: one resumable step per worker invocation ──────────────
// Synchronous formats (IMAGE/TEXT_LINK) complete in a single step. VIDEO and
// REELS are asynchronous and advance exactly one step per call, exactly like
// Instagram Reels' advanceReelPublication — never publishes without a
// confirmed ready state, always persists evidence the instant it exists,
// never blocks a worker invocation on Meta's own processing time.

export interface FacebookPublishMedia { storageBucket: string; storagePath: string }

export interface FacebookPublishRecordInput {
  contentType: "IMAGE" | "VIDEO" | "REELS" | "TEXT_LINK";
  caption: string;
  cta: string;
  link: string | null;
  media: FacebookPublishMedia[];
  processingState: FacebookProcessingState | null;
}

export type FacebookStepDisposition =
  | { kind: "published"; externalPostId: string }
  | { kind: "already_published"; externalPostId: string }
  | { kind: "reel_upload_started"; state: FacebookReelProcessingState }
  | { kind: "processing"; state: FacebookProcessingState }
  | { kind: "transient_failure"; classification: MetaErrorClassification }
  | { kind: "permanent_failure"; classification: MetaErrorClassification };

export interface FacebookPublishDeps {
  signMedia(bucket: string, path: string): Promise<string>;
  resolvePageToken(): Promise<string>;
  publishPhoto: typeof publishFacebookPhoto;
  publishFeedText: typeof publishFacebookFeedText;
  submitVideo: typeof submitFacebookVideo;
  checkVideoStatus: typeof checkFacebookVideoStatus;
  startReelUpload: typeof startFacebookReelUpload;
  uploadReelFromUrl: typeof uploadFacebookReelFromUrl;
  finishReel: typeof finishFacebookReel;
  now(): number;
}

function toMetaFailure(error: unknown): { kind: "transient_failure" | "permanent_failure"; classification: MetaErrorClassification } {
  const classification = error instanceof MetaPublishError
    ? error.classification
    : { provider: "meta" as const, category: "meta_publish_failed" as const, retryable: false, message: error instanceof Error ? error.message : String(error) };
  return { kind: classification.retryable ? "transient_failure" : "permanent_failure", classification };
}

/** Advance exactly one step of Facebook publication for one distribution record. Never publishes without confirmed evidence. */
export async function advanceFacebookPublication(deps: FacebookPublishDeps, pageId: string, input: FacebookPublishRecordInput): Promise<FacebookStepDisposition> {
  const nowIso = () => new Date(deps.now()).toISOString();

  if (input.contentType === "IMAGE" || input.contentType === "TEXT_LINK") {
    try {
      const pageToken = await deps.resolvePageToken();
      if (input.contentType === "TEXT_LINK") {
        const result = await deps.publishFeedText(pageId, pageToken, input.caption || input.cta, input.link);
        return { kind: "published", externalPostId: result.externalPostId };
      }
      if (input.media.length === 0) return toMetaFailure(new Error("An image post requires exactly one media asset."));
      const imageUrl = await deps.signMedia(input.media[0].storageBucket, input.media[0].storagePath);
      const result = await deps.publishPhoto(pageId, pageToken, imageUrl, input.caption);
      return { kind: "published", externalPostId: result.externalPostId };
    } catch (error) {
      return toMetaFailure(error);
    }
  }

  if (input.contentType === "VIDEO") {
    const state = input.processingState?.kind === "facebook_video" ? input.processingState : null;
    if (!state) {
      try {
        if (input.media.length === 0) return toMetaFailure(new Error("A video post requires exactly one media asset."));
        const pageToken = await deps.resolvePageToken();
        const fileUrl = await deps.signMedia(input.media[0].storageBucket, input.media[0].storagePath);
        const { videoId } = await deps.submitVideo(pageId, pageToken, fileUrl, input.cta, input.caption);
        return { kind: "processing", state: { kind: "facebook_video", videoId, pollCount: 0, startedAt: nowIso() } };
      } catch (error) {
        return toMetaFailure(error);
      }
    }
    if (isFacebookProcessingExpired(state, deps.now)) {
      return toMetaFailure(new MetaPublishError({ provider: "meta", category: "container_processing_timeout", retryable: false, message: `Facebook did not finish processing this video after ${state.pollCount} status checks.` }));
    }
    try {
      const pageToken = await deps.resolvePageToken();
      const status = await deps.checkVideoStatus(state.videoId, pageToken);
      if (status.videoStatus === "ready") return { kind: "published", externalPostId: state.videoId };
      if (status.videoStatus === "error") return toMetaFailure(new MetaPublishError({ provider: "meta", category: "meta_publish_failed", retryable: false, message: "Facebook reported an error processing this video." }));
      return { kind: "processing", state: { ...state, pollCount: state.pollCount + 1 } };
    } catch (error) {
      return toMetaFailure(error);
    }
  }

  // REELS
  const state = input.processingState?.kind === "facebook_reel" ? input.processingState : null;
  if (!state) {
    try {
      if (input.media.length === 0) return toMetaFailure(new Error("A Reel requires exactly one media asset."));
      const pageToken = await deps.resolvePageToken();
      const { videoId, uploadUrl } = await deps.startReelUpload(pageId, pageToken);
      const fileUrl = await deps.signMedia(input.media[0].storageBucket, input.media[0].storagePath);
      await deps.uploadReelFromUrl(videoId, pageToken, fileUrl);
      void uploadUrl; // returned by Meta but unused: uploadFacebookReelFromUrl posts to the documented rupload host directly, not this URL (Meta's own hosted-URL variant does not require it)
      return { kind: "reel_upload_started", state: { kind: "facebook_reel", videoId, phase: "uploaded", pollCount: 0, startedAt: nowIso() } };
    } catch (error) {
      return toMetaFailure(error);
    }
  }
  if (isFacebookProcessingExpired(state, deps.now)) {
    return toMetaFailure(new MetaPublishError({ provider: "meta", category: "container_processing_timeout", retryable: false, message: `Facebook did not finish processing this Reel after ${state.pollCount} status checks.` }));
  }
  try {
    const pageToken = await deps.resolvePageToken();
    const status = await deps.checkVideoStatus(state.videoId, pageToken);
    if (status.videoStatus === "error") return toMetaFailure(new MetaPublishError({ provider: "meta", category: "meta_publish_failed", retryable: false, message: "Facebook reported an error processing this Reel." }));
    if (status.videoStatus !== "ready") {
      return { kind: "processing", state: { ...state, pollCount: state.pollCount + 1 } };
    }
    const result = await deps.finishReel(pageId, pageToken, state.videoId, "PUBLISHED", input.caption, input.cta);
    return { kind: "published", externalPostId: result.externalPostId };
  } catch (error) {
    return toMetaFailure(error);
  }
}
