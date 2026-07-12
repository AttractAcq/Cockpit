// Shared Instagram publishing path used by BOTH the manual `publish-instagram-asset`
// function and the `process-scheduled-publishing` worker. One code path, no
// duplication, no per-asset cron.
//
// Hard safety contract:
//   • Credentials are checked FIRST. If anything is missing we return
//     { ok:false, missing_config:[...] } and NEVER mark the record published.
//   • A record is only ever set to `published` after a real Meta Graph API
//     success. Success is never fabricated.
//   • Meta processes media containers ASYNCHRONOUSLY. We NEVER call /media_publish
//     until every container (each carousel child, then the parent — or the single
//     image container) reports status_code = FINISHED. Publishing early is what
//     produced HTTP 400 code 9007 / subcode 2207027 ("Media ID is not available").
//   • Never log access tokens or signed media URLs.
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { readCredential } from "./aa.ts";

const GRAPH_VERSION = "v21.0";

// ── Readiness / time budget (all safely below the ~150s edge wall-clock cap) ──
export const CHILD_MAX_WAIT_MS = 45_000;   // per carousel child / single image
export const PARENT_MAX_WAIT_MS = 60_000;  // parent CAROUSEL container
export const POLL_INTERVAL_MS = 2_500;     // 2.5s between status polls
export const PUBLISH_DEADLINE_MS = 110_000; // total publish budget for one record

export interface PublishOutcome {
  ok: boolean;
  status: string | null;
  record?: Record<string, unknown>;
  missing_config?: string[];
  message?: string;
  error?: string;
  // Structured classification for failures (surfaced to logs/operators; the DB
  // status stays within its vocabulary — see note in publishDistributionRecord).
  provider?: "meta";
  category?: MetaErrorCategory;
  retryable?: boolean;
}

interface DistributionRecord {
  id: string; client_id: string; execution_month: string; source_ref: string;
  asset_group_ref: string; production_brief_id: string | null; asset_format: string;
  title: string | null; publish_status: string; platform: string | null; destination: string | null;
  publish_payload: Record<string, unknown>; publish_settings: Record<string, unknown>;
  external_post_id: string | null; published_at: string | null; published_url: string | null;
  sequence_index?: number | null; sequence_count?: number | null;
}

// ── Error classification ─────────────────────────────────────────────────────
export type MetaErrorCategory =
  | "container_not_ready"
  | "container_processing_timeout"
  | "container_error"
  | "container_expired"
  | "meta_authentication"
  | "meta_publish_failed"
  | "story_validation";

export interface MetaErrorClassification {
  provider: "meta";
  category: MetaErrorCategory;
  retryable: boolean;
  code?: number;
  subcode?: number;
  message: string;
}

/** Error carrying a structured Meta classification. Never contains tokens/URLs. */
export class MetaPublishError extends Error {
  classification: MetaErrorClassification;
  constructor(classification: MetaErrorClassification) {
    super(classification.message);
    this.name = "MetaPublishError";
    this.classification = classification;
  }
}

/** Permanent Story input error (bad media count/type). Never retryable. */
export function storyValidationError(message: string): MetaPublishError {
  return new MetaPublishError({ provider: "meta", category: "story_validation", retryable: false, message });
}

/** Sequence gate: a Story frame may publish only once every earlier frame is published. */
export function earlierFramesAllPublished(earlierFrameStatuses: string[]): boolean {
  return earlierFrameStatuses.every((status) => status === "published");
}

/**
 * Classify a Meta Graph error response body. code 9007 / subcode 2207027 is the
 * "container not ready" race — retryable. Token problems (190) are auth failures.
 */
export function classifyMetaError(
  httpStatus: number,
  data: unknown,
  fallback: MetaErrorCategory = "meta_publish_failed",
): MetaErrorClassification {
  const err = (data && typeof data === "object" ? (data as { error?: Record<string, unknown> }).error : undefined) ?? {};
  const code = typeof err.code === "number" ? err.code : undefined;
  const subcode = typeof err.error_subcode === "number" ? err.error_subcode : undefined;
  const type = typeof err.type === "string" ? err.type : undefined;
  const message = typeof err.message === "string" && err.message ? err.message : `Meta Graph error (HTTP ${httpStatus}).`;

  if (code === 9007 || subcode === 2207027) {
    return { provider: "meta", category: "container_not_ready", retryable: true, code, subcode, message };
  }
  // Invalid/expired access token or session — not retryable without new creds.
  if (code === 190 || subcode === 463 || subcode === 467 || (type === "OAuthException" && code === 102)) {
    return { provider: "meta", category: "meta_authentication", retryable: false, code, subcode, message };
  }
  return {
    provider: "meta", category: fallback,
    retryable: fallback === "container_not_ready" || fallback === "container_processing_timeout",
    code, subcode, message,
  };
}

/** True if the record already has evidence of a real Meta publication. */
export function hasPublicationEvidence(record: Pick<DistributionRecord, "external_post_id" | "published_at" | "published_url">): boolean {
  return !!(record.external_post_id || record.published_at || record.published_url);
}

/** Resolve the Meta credentials for a client, returning what's missing. */
async function resolveMetaConfig(sb: SupabaseClient, clientSlug: string, record: DistributionRecord): Promise<{ token: string | null; igUserId: string | null; missing: string[] }> {
  // Priority: the deployed edge-function secret first (this is the live source),
  // then a legacy env name, then per-client Vault, then global Vault.
  const token =
    (Deno.env.get("_GLOBAL_META_SYSTEM_USER_TOKEN") ?? null) ??
    (Deno.env.get("META_SYSTEM_USER_TOKEN") ?? null) ??
    (await readCredential(sb, clientSlug, "META", "SYSTEM_USER_TOKEN")) ??
    (await readCredential(sb, "_GLOBAL", "META", "SYSTEM_USER_TOKEN"));
  const settings = record.publish_settings ?? {};
  const metaSettings = (settings.meta ?? {}) as Record<string, unknown>;
  const igUserId =
    (typeof metaSettings.ig_user_id === "string" && metaSettings.ig_user_id) ||
    (typeof record.destination === "string" && /^\d+$/.test(record.destination) ? record.destination : null) ||
    (await readCredential(sb, clientSlug, "META", "IG_USER_ID")) ||
    null;
  const missing: string[] = [];
  if (!token) missing.push("Meta system-user access token");
  if (!igUserId) missing.push("Instagram business account id (publish settings › destination or vault)");
  return { token, igUserId, missing };
}

async function signedUrl(sb: SupabaseClient, bucket: string, path: string): Promise<string> {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(`Could not sign media ${bucket}/${path}: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

async function graph(path: string, params: Record<string, string>, token: string): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MetaPublishError(classifyMetaError(res.status, data, "meta_publish_failed"));
  return data as Record<string, unknown>;
}

/**
 * GET helper for read-only Graph calls (e.g. container status). Uses the same
 * token but NEVER logs it or any URL. Throws a classified MetaPublishError on
 * HTTP failure so auth problems during polling surface correctly.
 */
async function graphGet(path: string, fields: string, token: string): Promise<Record<string, unknown>> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(path)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MetaPublishError(classifyMetaError(res.status, data, "meta_publish_failed"));
  return data as Record<string, unknown>;
}

/** Read a container's processing status_code, or undefined if absent. */
async function fetchContainerStatus(containerId: string, token: string): Promise<string | undefined> {
  const data = await graphGet(containerId, "status_code", token);
  const status = data.status_code;
  return typeof status === "string" ? status : undefined;
}

const READY_STATUSES = new Set(["FINISHED", "PUBLISHED"]);

export interface WaitForContainerOptions {
  /** Per-container ceiling (child 45s / parent 60s). */
  maxWaitMs: number;
  /** Delay between polls. */
  pollIntervalMs?: number;
  /** Absolute wall-clock deadline (ms epoch) for the whole publish — the effective
   *  ceiling is min(now+maxWaitMs, deadline). */
  deadline?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchStatus?: (containerId: string, token: string) => Promise<string | undefined>;
}

/**
 * Poll a Meta container until it is ready. Elapsed-time budgeted (not just a fixed
 * attempt count) so it never polls indefinitely and never exceeds the overall
 * publish deadline.
 *   • FINISHED (or PUBLISHED)      → resolve.
 *   • ERROR                        → throw container_error (permanent for this container).
 *   • EXPIRED                      → throw container_expired (permanent for this container).
 *   • IN_PROGRESS / unknown        → not ready; wait and retry within budget.
 *   • budget exhausted             → throw container_processing_timeout.
 */
export async function waitForContainerReady(containerId: string, token: string, options: WaitForContainerOptions): Promise<void> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const fetchStatus = options.fetchStatus ?? fetchContainerStatus;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  const start = now();
  const localCeiling = start + options.maxWaitMs;
  const hardDeadline = typeof options.deadline === "number" ? Math.min(localCeiling, options.deadline) : localCeiling;

  while (true) {
    const status = await fetchStatus(containerId, token);
    if (status && READY_STATUSES.has(status)) return;
    if (status === "ERROR") {
      throw new MetaPublishError({ provider: "meta", category: "container_error", retryable: true, message: `Meta container ${containerId} failed processing (status ERROR).` });
    }
    if (status === "EXPIRED") {
      throw new MetaPublishError({ provider: "meta", category: "container_expired", retryable: true, message: `Meta container ${containerId} expired before publishing (status EXPIRED).` });
    }
    // IN_PROGRESS or unknown → not ready. Stop if another poll would breach budget.
    if (now() + pollIntervalMs >= hardDeadline) {
      throw new MetaPublishError({ provider: "meta", category: "container_processing_timeout", retryable: true, message: `Meta container ${containerId} not ready within budget (last status ${status ?? "unknown"}).` });
    }
    await sleep(pollIntervalMs);
  }
}

// ── Orchestration (dependency-injected so it is unit-testable without network) ─
export interface PublishMedia { storage_bucket: string; storage_path: string; sequence_index?: number; mime_type?: string; width?: number; height?: number }

export interface PublishDeps {
  signMedia(bucket: string, path: string): Promise<string>;
  createChildContainer(igUserId: string, imageUrl: string, token: string): Promise<string>;
  createSingleContainer(igUserId: string, imageUrl: string, caption: string, token: string): Promise<string>;
  createCarouselContainer(igUserId: string, childIds: string[], caption: string, token: string): Promise<string>;
  // Story container: media_type=STORIES, one image, NO caption (Meta does not
  // render a Cockpit caption on an image Story).
  createStoryContainer(igUserId: string, imageUrl: string, token: string): Promise<string>;
  waitReady(containerId: string, token: string, maxWaitMs: number): Promise<void>;
  mediaPublish(igUserId: string, creationId: string, token: string): Promise<string>;
  fetchPermalink(mediaId: string, token: string): Promise<string | null>;
  now(): number;
}

const STORY_IMAGE_MIME = new Set(["image/png", "image/jpeg"]);

/** Validate a Story's media BEFORE any container creation. Permanent (non-retryable). */
export function validateStoryMedia(media: PublishMedia[]): PublishMedia {
  if (media.length === 0) throw storyValidationError("Story publish requires exactly one image, but the record has no media.");
  if (media.length > 1) throw storyValidationError(`Story publish requires exactly one image; this record has ${media.length}. Split a multi-frame Story into one record per frame.`);
  const item = media[0];
  const mime = (item.mime_type ?? "").toLowerCase();
  if (mime.startsWith("video/")) throw storyValidationError("Video Story publishing is not yet supported. Only image Stories (PNG/JPEG) can be published.");
  if (!STORY_IMAGE_MIME.has(mime)) throw storyValidationError(`Story image must be PNG or JPEG; got "${item.mime_type ?? "unknown"}".`);
  return item;
}

export interface RunPublishOptions {
  media: PublishMedia[];
  caption: string;
  contentType: string;
  igUserId: string;
  token: string;
  overallDeadline: number; // ms epoch
  childMaxWaitMs: number;
  parentMaxWaitMs: number;
}

/**
 * The gated publish flow. Creates containers, waits for FINISHED, and only then
 * publishes. Carousel children keep sequence_index order. Never publishes while
 * anything is unready; never exceeds the overall deadline.
 */
export async function runPublish(deps: PublishDeps, opts: RunPublishOptions): Promise<{ external_post_id: string; permalink: string | null }> {
  const ensureBudget = () => {
    if (deps.now() >= opts.overallDeadline) {
      throw new MetaPublishError({ provider: "meta", category: "container_processing_timeout", retryable: true, message: "Publish deadline reached before Meta finished processing. Nothing was published." });
    }
  };

  if (opts.contentType === "STORIES") {
    // Exactly one image, PNG/JPEG, no video — validated BEFORE container creation.
    const item = validateStoryMedia(opts.media);
    ensureBudget();
    let url: string;
    try { url = await deps.signMedia(item.storage_bucket, item.storage_path); }
    catch (error) { throw storyValidationError(`Could not generate a signed URL for the Story image: ${error instanceof Error ? error.message : String(error)}`); }
    const containerId = await deps.createStoryContainer(opts.igUserId, url, opts.token); // media_type=STORIES, no caption
    await deps.waitReady(containerId, opts.token, opts.childMaxWaitMs); // must FINISH first
    ensureBudget();
    const publishedId = await deps.mediaPublish(opts.igUserId, containerId, opts.token);
    // Stories may not expose a stable permalink — success requires external_post_id only.
    return { external_post_id: publishedId, permalink: await deps.fetchPermalink(publishedId, opts.token) };
  }

  if (opts.contentType === "CAROUSEL") {
    // Preserve child order by sequence_index (defensive — payload is pre-sorted).
    const ordered = [...opts.media].sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0));
    const childIds: string[] = [];
    for (const item of ordered) {
      ensureBudget();
      const url = await deps.signMedia(item.storage_bucket, item.storage_path);
      const childId = await deps.createChildContainer(opts.igUserId, url, opts.token);
      await deps.waitReady(childId, opts.token, opts.childMaxWaitMs); // must FINISH first
      childIds.push(childId);
    }
    ensureBudget();
    const parentId = await deps.createCarouselContainer(opts.igUserId, childIds, opts.caption, opts.token);
    await deps.waitReady(parentId, opts.token, opts.parentMaxWaitMs); // parent must FINISH
    ensureBudget();
    const publishedId = await deps.mediaPublish(opts.igUserId, parentId, opts.token);
    return { external_post_id: publishedId, permalink: await deps.fetchPermalink(publishedId, opts.token) };
  }

  // Single IMAGE (ad_static / feed_post) — same readiness gate.
  ensureBudget();
  const url = await deps.signMedia(opts.media[0].storage_bucket, opts.media[0].storage_path);
  const containerId = await deps.createSingleContainer(opts.igUserId, url, opts.caption, opts.token);
  await deps.waitReady(containerId, opts.token, opts.childMaxWaitMs);
  ensureBudget();
  const publishedId = await deps.mediaPublish(opts.igUserId, containerId, opts.token);
  return { external_post_id: publishedId, permalink: await deps.fetchPermalink(publishedId, opts.token) };
}

async function fetchPermalink(mediaId: string, token: string): Promise<string | null> {
  try {
    const data = await graphGet(mediaId, "permalink", token);
    return typeof data.permalink === "string" ? data.permalink : null;
  } catch { return null; }
}

/** Real Meta publish. Only reached when credentials are present and no duplicate exists. */
async function publishToInstagram(sb: SupabaseClient, record: DistributionRecord, token: string, igUserId: string): Promise<{ external_post_id: string; permalink: string | null }> {
  // Duplicate-publication guard — refuse to create new containers for a record
  // that already carries a Meta publication reference.
  if (hasPublicationEvidence(record)) {
    throw new MetaPublishError({ provider: "meta", category: "meta_publish_failed", retryable: false, message: "Duplicate-publication guard: record already has a Meta publication reference." });
  }

  const payload = record.publish_payload ?? {};
  const caption = typeof payload.caption === "string" ? payload.caption : "";
  const media = Array.isArray(payload.media) ? payload.media as PublishMedia[] : [];
  if (media.length === 0) throw new Error("No media in publish payload.");
  const settings = record.publish_settings ?? {};
  const contentType = typeof settings.content_type === "string" ? settings.content_type : "IMAGE";

  if (contentType === "REELS") {
    // Video publishing (Reels / video Stories) is out of scope — fail clearly, never fake.
    throw new Error("REELS (video) publishing is not implemented; video is human-only downstream.");
  }
  // Image Stories (content_type STORIES) ARE supported — validated + gated in runPublish.

  const overallDeadline = Date.now() + PUBLISH_DEADLINE_MS;
  const deps: PublishDeps = {
    signMedia: (bucket, path) => signedUrl(sb, bucket, path),
    createChildContainer: (ig, url, tok) => graph(`${ig}/media`, { image_url: url, is_carousel_item: "true" }, tok).then((d) => String(d.id)),
    createSingleContainer: (ig, url, cap, tok) => graph(`${ig}/media`, { image_url: url, caption: cap }, tok).then((d) => String(d.id)),
    createCarouselContainer: (ig, childIds, cap, tok) => graph(`${ig}/media`, { media_type: "CAROUSEL", caption: cap, children: childIds.join(",") }, tok).then((d) => String(d.id)),
    createStoryContainer: (ig, imageUrl, tok) => graph(`${ig}/media`, { media_type: "STORIES", image_url: imageUrl }, tok).then((d) => String(d.id)),
    waitReady: (containerId, tok, maxWaitMs) => waitForContainerReady(containerId, tok, { maxWaitMs, pollIntervalMs: POLL_INTERVAL_MS, deadline: overallDeadline, fetchStatus: fetchContainerStatus }),
    mediaPublish: (ig, creationId, tok) => graph(`${ig}/media_publish`, { creation_id: creationId }, tok).then((d) => String(d.id)),
    fetchPermalink: (mediaId, tok) => fetchPermalink(mediaId, tok),
    now: () => Date.now(),
  };

  return runPublish(deps, {
    media, caption, contentType, igUserId, token,
    overallDeadline, childMaxWaitMs: CHILD_MAX_WAIT_MS, parentMaxWaitMs: PARENT_MAX_WAIT_MS,
  });
}

/**
 * The one publishing path. `mode` is informational (manual vs scheduled_worker)
 * and only changes how a missing-config outcome is recorded: a manual attempt
 * reverts to its prior status so the operator can retry; the worker marks the
 * record `failed` so it is not retried every run.
 */
export async function publishDistributionRecord(
  sb: SupabaseClient,
  recordId: string,
  mode: "publish_now" | "scheduled_worker",
  payloadOverrides: Record<string, unknown> = {},
): Promise<PublishOutcome> {
  const { data: loaded, error: loadError } = await sb.from("client_distribution_records").select("*, clients(slug)").eq("id", recordId).maybeSingle();
  if (loadError) return { ok: false, status: null, error: loadError.message, message: "Could not load distribution record." };
  if (!loaded) return { ok: false, status: null, error: "not_found", message: "Distribution record not found." };
  const record = loaded as DistributionRecord & { clients?: { slug?: string } | null; publish_status: string };
  if (record.publish_status === "published") return { ok: true, status: "published", record: loaded as Record<string, unknown>, message: "Already published." };
  if (record.publish_status === "cancelled") return { ok: false, status: "cancelled", message: "Record is cancelled." };

  // Duplicate-publication guard — BEFORE credentials or any container creation.
  // A retry is only allowed while external_post_id / published_at / published_url
  // are all still null; otherwise a real post exists and we must not re-create.
  if (hasPublicationEvidence(record)) {
    return { ok: true, status: "published", record: loaded as Record<string, unknown>, message: "Duplicate-publication guard: record already carries a Meta publication reference; no new containers were created." };
  }

  const priorStatus = record.publish_status;
  const clientSlug = record.clients?.slug ?? "";
  // Apply any operator overrides to the stored payload before validating.
  const mergedPayload = { ...(record.publish_payload ?? {}), ...(payloadOverrides.publish_payload as Record<string, unknown> ?? {}) };
  const mergedSettings = { ...(record.publish_settings ?? {}), ...(payloadOverrides.publish_settings as Record<string, unknown> ?? {}) };
  const working: DistributionRecord = { ...record, publish_payload: mergedPayload, publish_settings: mergedSettings };

  // 1) Credentials FIRST — never touch Meta or the published state without them.
  const config = await resolveMetaConfig(sb, clientSlug, working);
  if (config.missing.length > 0) {
    const failStatus = mode === "scheduled_worker" ? "failed" : priorStatus;
    await sb.from("client_distribution_records").update({
      publish_status: failStatus,
      last_error: `Meta configuration missing: ${config.missing.join("; ")}`,
      updated_at: new Date().toISOString(),
    }).eq("id", recordId);
    return { ok: false, status: failStatus, missing_config: config.missing, message: "Meta credentials/config are not configured. Nothing was published." };
  }

  // 2) Mark publishing (optimistic) and attempt the real publish.
  await sb.from("client_distribution_records").update({ publish_status: "publishing", last_error: null, updated_at: new Date().toISOString() }).eq("id", recordId);
  let result: { external_post_id: string; permalink: string | null };
  try {
    result = await publishToInstagram(sb, working, config.token!, config.igUserId!);
  } catch (error) {
    // Classify (9007/2207027 → container_not_ready retryable, etc.). The DB status
    // vocabulary has no `retryable_failed`, so a non-published record stays
    // `failed` (already the operator-retryable state) and we carry the structured
    // retryability in last_error + the returned outcome. It is NEVER `published`.
    const classification = error instanceof MetaPublishError ? error.classification : null;
    const message = error instanceof Error ? error.message : String(error);
    const lastError = classification
      ? `[${classification.category}${classification.retryable ? ", retryable" : ", non-retryable"}] ${message}`
      : message;
    await sb.from("client_distribution_records").update({ publish_status: "failed", last_error: lastError, updated_at: new Date().toISOString() }).eq("id", recordId);
    return {
      ok: false, status: "failed", error: message,
      provider: classification?.provider, category: classification?.category, retryable: classification?.retryable,
      message: "Publish failed. Record marked failed; nothing was falsely marked published.",
    };
  }

  // 3) Real success only. Mark published + hand off to analytics + advance stage.
  const publishedAt = new Date().toISOString();
  const { data: updated } = await sb.from("client_distribution_records").update({
    publish_status: "published", published_at: publishedAt, published_url: result.permalink,
    external_post_id: result.external_post_id, publish_payload: mergedPayload, publish_settings: mergedSettings,
    last_error: null, updated_at: publishedAt,
  }).eq("id", recordId).select("*").single();

  await handoffToAnalytics(sb, working, result, publishedAt).catch(() => { /* record is published; analytics handoff is best-effort */ });

  return { ok: true, status: "published", record: updated as Record<string, unknown>, message: "Published to Instagram." };
}

/** Only published assets reach analytics. Also advances pipeline state + snapshot. */
async function handoffToAnalytics(sb: SupabaseClient, record: DistributionRecord, result: { external_post_id: string; permalink: string | null }, publishedAt: string): Promise<void> {
  const contentType = typeof record.publish_settings?.content_type === "string" ? record.publish_settings.content_type : null;
  const surface = contentType === "STORIES" ? "STORY" : contentType === "CAROUSEL" ? "CAROUSEL" : "FEED";
  const sequenceIndex = record.sequence_index ?? 1;
  // Per-frame analytics: keyed by (client, asset_group_ref, sequence_index) so
  // each Story frame lands as its own analytics row (permalink may be null).
  await sb.from("client_analytics_records").upsert({
    client_id: record.client_id, execution_month: record.execution_month, source_ref: record.source_ref,
    asset_group_ref: record.asset_group_ref, sequence_index: sequenceIndex, distribution_record_id: record.id,
    production_brief_id: record.production_brief_id, asset_format: record.asset_format, title: record.title,
    platform: record.platform ?? "instagram", published_at: publishedAt, published_url: result.permalink,
    external_post_id: result.external_post_id, collection_status: "active",
    metadata: { surface, sequence_index: sequenceIndex, sequence_count: record.sequence_count ?? null },
    updated_at: publishedAt,
  }, { onConflict: "client_id,asset_group_ref,sequence_index" });

  // Snapshot the distribution stage being left, then advance pipeline state.
  await sb.from("client_asset_archive_snapshots").insert({
    client_id: record.client_id, execution_month: record.execution_month, source_ref: record.source_ref,
    asset_group_ref: record.asset_group_ref, stage: "distribution", title: record.title, asset_format: record.asset_format,
    source_table: "client_distribution_records", source_row_id: record.id,
    snapshot_data: { published_at: publishedAt, external_post_id: result.external_post_id, published_url: result.permalink },
    snapshot_reason: "asset_published",
  });
  await sb.from("client_asset_pipeline_state").upsert({
    client_id: record.client_id, execution_month: record.execution_month, source_ref: record.source_ref,
    asset_group_ref: record.asset_group_ref, production_brief_id: record.production_brief_id,
    current_stage: "analytics", previous_stage: "distribution", title: record.title, asset_format: record.asset_format,
    transition_reason: "asset_published", stage_entered_at: publishedAt, last_transition_at: publishedAt, updated_at: publishedAt,
  }, { onConflict: "client_id,execution_month,source_ref" });
}
