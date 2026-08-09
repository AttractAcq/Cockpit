// Programme Stage 1B-D — DB-integrated Facebook publish orchestration.
// Bridges the pure advanceFacebookPublication (facebook-publish.ts) with a
// real client_distribution_records row: same non-negotiable safety
// contract as instagram-publish.ts's publishDistributionRecord (credentials
// checked first, duplicate-publication guard before any provider call, a
// record is only ever marked published after a real Meta success).
//
// Split into two entry points, mirroring how Instagram splits its own
// synchronous publishDistributionRecord (instagram-publish.ts) from its
// worker-only async stepper (advanceReel, inside process-scheduled-
// publishing/index.ts):
//   publishFacebookDistributionRecord      — synchronous IMAGE/TEXT_LINK only;
//                                             refuses VIDEO/REELS the same way
//                                             Instagram refuses inline Reels
//                                             ("schedule it instead"), used by
//                                             both the manual entry point and
//                                             the worker's synchronous branch.
//   advanceFacebookAsyncDistributionRecord — worker-only, one step per call,
//                                             for VIDEO/REELS.
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { resolveClientMetaToken } from "./facebook-destination-auth.ts";
import { handoffToAnalytics, hasPublicationEvidence, type DistributionRecord } from "./instagram-publish.ts";
import { MetaPublishError } from "./meta-errors.ts";
import {
  advanceFacebookPublication, resolvePageAccessToken,
  publishFacebookPhoto, publishFacebookFeedText, submitFacebookVideo, checkFacebookVideoStatus,
  startFacebookReelUpload, uploadFacebookReelFromUrl, finishFacebookReel,
  isFacebookProcessingState, type FacebookPublishDeps, type FacebookProcessingState,
} from "./facebook-publish.ts";

export interface FacebookPublishOutcome {
  ok: boolean;
  status: string | null;
  record?: Record<string, unknown>;
  missing_config?: string[];
  message?: string;
  error?: string;
  provider?: "meta";
  category?: string;
  retryable?: boolean;
}

interface FacebookDistributionRow {
  id: string; client_id: string; source_ref: string; asset_format: string;
  publish_status: string; destination: string | null;
  publish_payload: Record<string, unknown> | null; publish_settings: Record<string, unknown> | null;
  provider_processing_state: FacebookProcessingState | null;
  external_post_id: string | null; published_at: string | null; published_url: string | null;
  clients?: { slug?: string } | null;
}

async function signMedia(sb: SupabaseClient, bucket: string, path: string): Promise<string> {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(`Could not sign media ${bucket}/${path}: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

function buildInput(record: FacebookDistributionRow) {
  const payload = record.publish_payload ?? {};
  const settings = record.publish_settings ?? {};
  const contentType = (typeof settings.content_type === "string" ? settings.content_type : record.asset_format) as "IMAGE" | "VIDEO" | "REELS" | "TEXT_LINK";
  const media = Array.isArray(payload.media)
    ? (payload.media as Array<Record<string, unknown>>).map((m) => ({ storageBucket: String(m.storage_bucket ?? ""), storagePath: String(m.storage_path ?? "") }))
    : [];
  return {
    contentType,
    caption: typeof payload.caption === "string" ? payload.caption : "",
    cta: typeof payload.cta === "string" ? payload.cta : "",
    link: typeof payload.link === "string" ? payload.link : null,
    media,
    processingState: isFacebookProcessingState(record.provider_processing_state) ? record.provider_processing_state : null,
  };
}

async function loadRecordAndToken(sb: SupabaseClient, recordId: string): Promise<
  | { ok: true; record: FacebookDistributionRow; pageToken: string }
  | { ok: false; outcome: FacebookPublishOutcome }
> {
  const { data: loaded, error: loadError } = await sb.from("client_distribution_records").select("*, clients(slug)").eq("id", recordId).maybeSingle();
  if (loadError) return { ok: false, outcome: { ok: false, status: null, error: loadError.message, message: "Could not load distribution record." } };
  if (!loaded) return { ok: false, outcome: { ok: false, status: null, error: "not_found", message: "Distribution record not found." } };
  const record = loaded as FacebookDistributionRow;
  if (record.publish_status === "cancelled") return { ok: false, outcome: { ok: false, status: "cancelled", message: "Record is cancelled." } };

  const clientSlug = record.clients?.slug ?? "";
  const { token, missing } = await resolveClientMetaToken(sb, clientSlug);
  if (!token) {
    return { ok: false, outcome: { ok: false, status: record.publish_status, missing_config: missing, message: `Meta configuration missing: ${missing.join("; ")}` } };
  }
  if (!record.destination) {
    return { ok: false, outcome: { ok: false, status: record.publish_status, message: "This record has no Facebook Page destination set." } };
  }
  const pageId = record.destination;
  const pageToken = await resolvePageAccessToken(pageId, token).catch((error) => { throw error; });
  void pageId;
  return { ok: true, record, pageToken };
}

function makeDeps(sb: SupabaseClient, pageToken: string): FacebookPublishDeps {
  return {
    signMedia: (bucket, path) => signMedia(sb, bucket, path),
    resolvePageToken: () => Promise.resolve(pageToken),
    publishPhoto: publishFacebookPhoto,
    publishFeedText: publishFacebookFeedText,
    submitVideo: submitFacebookVideo,
    checkVideoStatus: checkFacebookVideoStatus,
    startReelUpload: startFacebookReelUpload,
    uploadReelFromUrl: uploadFacebookReelFromUrl,
    finishReel: finishFacebookReel,
    now: () => Date.now(),
  };
}

/** Synchronous formats only (IMAGE/TEXT_LINK). VIDEO/REELS are refused here and must be scheduled — same UX Instagram already uses for Reels. */
export async function publishFacebookDistributionRecord(sb: SupabaseClient, recordId: string, mode: "publish_now" | "scheduled_worker"): Promise<FacebookPublishOutcome> {
  const { data: loaded, error: loadError } = await sb.from("client_distribution_records").select("*, clients(slug)").eq("id", recordId).maybeSingle();
  if (loadError) return { ok: false, status: null, error: loadError.message, message: "Could not load distribution record." };
  if (!loaded) return { ok: false, status: null, error: "not_found", message: "Distribution record not found." };
  const record = loaded as FacebookDistributionRow;
  if (record.publish_status === "published") return { ok: true, status: "published", record: loaded as Record<string, unknown>, message: "Already published." };
  if (record.publish_status === "cancelled") return { ok: false, status: "cancelled", message: "Record is cancelled." };
  if (hasPublicationEvidence({ external_post_id: record.external_post_id, published_at: record.published_at, published_url: record.published_url })) {
    return { ok: true, status: "published", record: loaded as Record<string, unknown>, message: "Duplicate-publication guard: record already carries a Meta publication reference; nothing was re-attempted." };
  }

  const input = buildInput(record);
  if (input.contentType === "VIDEO" || input.contentType === "REELS") {
    return {
      ok: false, status: record.publish_status, error: "video_requires_scheduling",
      provider: "meta", category: "unsupported_capability", retryable: false,
      message: `Facebook ${input.contentType === "VIDEO" ? "video" : "Reels"} posts are processed asynchronously by the scheduled worker. Schedule this record instead of publishing it inline.`,
    };
  }

  const loadResult = await loadRecordAndToken(sb, recordId).catch((error) => {
    const classification = error instanceof MetaPublishError ? error.classification : null;
    return {
      ok: false as const,
      outcome: {
        ok: false, status: record.publish_status,
        error: error instanceof Error ? error.message : String(error),
        provider: "meta" as const, category: classification?.category, retryable: classification?.retryable,
        message: "Could not resolve a Facebook Page access token.",
      },
    };
  });
  if (!loadResult.ok) return loadResult.outcome;

  const priorStatus = record.publish_status;
  await sb.from("client_distribution_records").update({ publish_status: "publishing", last_error: null, updated_at: new Date().toISOString() }).eq("id", recordId);

  const deps = makeDeps(sb, loadResult.pageToken);
  const disposition = await advanceFacebookPublication(deps, record.destination!, input);

  if (disposition.kind === "published") {
    const publishedAt = new Date().toISOString();
    const { data: updated } = await sb.from("client_distribution_records").update({
      publish_status: "published", published_at: publishedAt, external_post_id: disposition.externalPostId,
      provider_processing_state: null, last_error: null, updated_at: publishedAt,
    }).eq("id", recordId).select("*").single();
    await handoffToAnalytics(sb, { ...record, platform: "facebook" } as unknown as DistributionRecord, { external_post_id: disposition.externalPostId, permalink: null }, publishedAt).catch(() => {});
    return { ok: true, status: "published", record: updated as Record<string, unknown>, message: "Published to Facebook." };
  }

  const failStatus = mode === "scheduled_worker" ? "failed" : priorStatus;
  const message = disposition.classification.message;
  await sb.from("client_distribution_records").update({
    publish_status: failStatus, last_error: `[${disposition.classification.category}${disposition.classification.retryable ? ", retryable" : ", non-retryable"}] ${message}`, updated_at: new Date().toISOString(),
  }).eq("id", recordId);
  return {
    ok: false, status: failStatus, error: message, provider: "meta",
    category: disposition.classification.category, retryable: disposition.classification.retryable,
    message: "Publish failed. Record marked failed; nothing was falsely marked published.",
  };
}

/** Worker-only: advance exactly one step of an async VIDEO/REELS publication. */
export async function advanceFacebookAsyncDistributionRecord(sb: SupabaseClient, recordId: string): Promise<FacebookPublishOutcome & { disposition?: string }> {
  const { data: loaded, error: loadError } = await sb.from("client_distribution_records").select("*, clients(slug)").eq("id", recordId).maybeSingle();
  if (loadError) return { ok: false, status: null, error: loadError.message };
  if (!loaded) return { ok: false, status: null, error: "not_found" };
  const record = loaded as FacebookDistributionRow;
  if (hasPublicationEvidence({ external_post_id: record.external_post_id, published_at: record.published_at, published_url: record.published_url })) {
    return { ok: true, status: "published", disposition: "already_published" };
  }

  const loadResult = await loadRecordAndToken(sb, recordId).catch((error) => {
    const classification = error instanceof MetaPublishError ? error.classification : null;
    return {
      ok: false as const,
      outcome: {
        ok: false, status: record.publish_status,
        error: error instanceof Error ? error.message : String(error),
        provider: "meta" as const, category: classification?.category, retryable: classification?.retryable,
      } as FacebookPublishOutcome,
    };
  });
  if (!loadResult.ok) return loadResult.outcome;

  const input = buildInput(record);
  const deps = makeDeps(sb, loadResult.pageToken);
  const disposition = await advanceFacebookPublication(deps, record.destination!, input);
  const nowIso = new Date().toISOString();

  if (disposition.kind === "published") {
    const { data: updated } = await sb.from("client_distribution_records").update({
      publish_status: "published", published_at: nowIso, external_post_id: disposition.externalPostId,
      provider_processing_state: null, last_error: null, claimed_at: null, claimed_by: null, updated_at: nowIso,
    }).eq("id", recordId).select("*").single();
    await handoffToAnalytics(sb, { ...record, platform: "facebook" } as unknown as DistributionRecord, { external_post_id: disposition.externalPostId, permalink: null }, nowIso).catch(() => {});
    return { ok: true, status: "published", record: updated as Record<string, unknown>, disposition: "published" };
  }
  if (disposition.kind === "reel_upload_started" || disposition.kind === "processing") {
    await sb.from("client_distribution_records").update({
      provider_processing_state: disposition.state, updated_at: nowIso,
    }).eq("id", recordId);
    return { ok: true, status: record.publish_status, disposition: disposition.kind === "reel_upload_started" ? "reel_upload_started" : "processing" };
  }

  // transient_failure / permanent_failure: caller (the worker) applies retry/backoff policy.
  return {
    ok: false, status: record.publish_status, error: disposition.classification.message,
    provider: "meta", category: disposition.classification.category, retryable: disposition.classification.retryable,
    disposition: disposition.kind,
  };
}
