// Shared Instagram publishing path used by BOTH the manual `publish-instagram-asset`
// function and the `process-scheduled-publishing` worker. One code path, no
// duplication, no per-asset cron.
//
// Hard safety contract:
//   • Credentials are checked FIRST. If anything is missing we return
//     { ok:false, missing_config:[...] } and NEVER mark the record published.
//   • A record is only ever set to `published` after a real Meta Graph API
//     success. Success is never fabricated.
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { readCredential } from "./aa.ts";

const GRAPH_VERSION = "v21.0";

export interface PublishOutcome {
  ok: boolean;
  status: string | null;
  record?: Record<string, unknown>;
  missing_config?: string[];
  message?: string;
  error?: string;
}

interface DistributionRecord {
  id: string; client_id: string; execution_month: string; source_ref: string;
  asset_group_ref: string; production_brief_id: string | null; asset_format: string;
  title: string | null; publish_status: string; platform: string | null; destination: string | null;
  publish_payload: Record<string, unknown>; publish_settings: Record<string, unknown>;
}

/** Resolve the Meta credentials for a client, returning what's missing. */
async function resolveMetaConfig(sb: SupabaseClient, clientSlug: string, record: DistributionRecord): Promise<{ token: string | null; igUserId: string | null; missing: string[] }> {
  const token =
    (await readCredential(sb, clientSlug, "META", "SYSTEM_USER_TOKEN")) ??
    (await readCredential(sb, "_GLOBAL", "META", "SYSTEM_USER_TOKEN")) ??
    (Deno.env.get("META_SYSTEM_USER_TOKEN") ?? null);
  const settings = record.publish_settings ?? {};
  const metaSettings = (settings.meta ?? {}) as Record<string, unknown>;
  const igUserId =
    (typeof metaSettings.ig_user_id === "string" && metaSettings.ig_user_id) ||
    (typeof record.destination === "string" && /^\d+$/.test(record.destination) ? record.destination : null) ||
    (await readCredential(sb, clientSlug, "META", "IG_USER_ID")) ||
    null;
  const missing: string[] = [];
  if (!token) missing.push("Meta system-user access token (vault)");
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
  if (!res.ok) throw new Error(`Meta Graph ${path} failed (HTTP ${res.status}): ${JSON.stringify(data)}`);
  return data as Record<string, unknown>;
}

/** Real Meta publish. Only reached when credentials are present. */
async function publishToInstagram(sb: SupabaseClient, record: DistributionRecord, token: string, igUserId: string): Promise<{ external_post_id: string; permalink: string | null }> {
  const payload = record.publish_payload ?? {};
  const caption = typeof payload.caption === "string" ? payload.caption : "";
  const media = Array.isArray(payload.media) ? payload.media as Array<{ storage_bucket: string; storage_path: string }> : [];
  if (media.length === 0) throw new Error("No media in publish payload.");
  const settings = record.publish_settings ?? {};
  const contentType = typeof settings.content_type === "string" ? settings.content_type : "IMAGE";

  if (contentType === "STORIES" || contentType === "REELS") {
    // Video/story publishing is out of scope for H3 — fail clearly, never fake.
    throw new Error(`${contentType} publishing is not implemented in H3 (video/stories are human-only downstream).`);
  }

  if (contentType === "CAROUSEL") {
    const childIds: string[] = [];
    for (const item of media) {
      const url = await signedUrl(sb, item.storage_bucket, item.storage_path);
      const child = await graph(`${igUserId}/media`, { image_url: url, is_carousel_item: "true" }, token);
      childIds.push(String(child.id));
    }
    const container = await graph(`${igUserId}/media`, { media_type: "CAROUSEL", caption, children: childIds.join(",") }, token);
    const published = await graph(`${igUserId}/media_publish`, { creation_id: String(container.id) }, token);
    const permalink = await fetchPermalink(String(published.id), token);
    return { external_post_id: String(published.id), permalink };
  }

  // Single IMAGE (ad_static / feed_post)
  const url = await signedUrl(sb, media[0].storage_bucket, media[0].storage_path);
  const container = await graph(`${igUserId}/media`, { image_url: url, caption }, token);
  const published = await graph(`${igUserId}/media_publish`, { creation_id: String(container.id) }, token);
  const permalink = await fetchPermalink(String(published.id), token);
  return { external_post_id: String(published.id), permalink };
}

async function fetchPermalink(mediaId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    return typeof data.permalink === "string" ? data.permalink : null;
  } catch { return null; }
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
    const message = error instanceof Error ? error.message : String(error);
    await sb.from("client_distribution_records").update({ publish_status: "failed", last_error: message, updated_at: new Date().toISOString() }).eq("id", recordId);
    return { ok: false, status: "failed", error: message, message: "Publish failed. Record marked failed; nothing was falsely marked published." };
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
  await sb.from("client_analytics_records").upsert({
    client_id: record.client_id, execution_month: record.execution_month, source_ref: record.source_ref,
    asset_group_ref: record.asset_group_ref, distribution_record_id: record.id,
    production_brief_id: record.production_brief_id, asset_format: record.asset_format, title: record.title,
    platform: record.platform ?? "instagram", published_at: publishedAt, published_url: result.permalink,
    external_post_id: result.external_post_id, collection_status: "active", updated_at: publishedAt,
  }, { onConflict: "client_id,asset_group_ref" });

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
