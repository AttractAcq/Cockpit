// Programme Stage 1B-E — Facebook automated insights collection. Mirrors
// _shared/instagram-insights.ts's shape and windowing discipline exactly,
// but the underlying Graph API surface genuinely differs and is grounded in
// live research against developers.facebook.com at Graph API v21.0 (the
// version this whole build is pinned to — see instagram-publish.ts) rather
// than assumed to be a Facebook-flavoured copy of Instagram's metrics.
//
// Real, live-verified finding (Stage 1B-E): at v21.0, `post_impressions` and
// `post_impressions_unique` (Facebook's closest thing to Instagram's
// `impressions`/`reach`) are BOTH already deprecated — removed, not merely
// scheduled for removal. The only impressions figure still valid at v21.0 is
// channel-split (`post_impressions_organic`/`_paid`/`_viral`/`_nonviral`),
// and there is no unique-accounts ("reach") figure available at all for
// organic content at this API version. This is a real Meta API limitation,
// not a Cockpit gap — documented here rather than fabricating a reach proxy.
// `post_engaged_users` is likewise absent from the current v21.0 metric
// reference. Comments and shares are NOT post-insights metrics on Facebook
// at all (unlike Instagram, where they are) — they live on the post object's
// own `comments`/`shares` fields, fetched with a second Graph call.
//
// Facebook Reels/VIDEO automated collection is deliberately out of scope for
// this stage's v1, matching Instagram's own `insightsKind()` precedent
// (REELS is already "unsupported" for Instagram's automatic collection
// today) — video view-count collection via `post_video_views` is a real,
// separately-scoped follow-on, not silently promised here.

export type FacebookInsightsSnapshotLabel = "t_plus_1h" | "t_plus_6h" | "t_plus_24h" | "t_plus_48h" | "t_plus_7d";
export type FacebookInsightsErrorCategory = "meta_authentication" | "meta_permission" | "meta_rate_limit" | "meta_unsupported_metric" | "meta_media_unavailable" | "meta_network" | "validation" | "unknown";

export interface FacebookInsightsCandidate {
  publish_status: string; external_post_id: string | null; published_at: string | null; platform: string | null;
  asset_format: string | null; publish_settings?: Record<string, unknown> | null;
}
export interface FacebookDueSnapshot { label: FacebookInsightsSnapshotLabel; dueAt: string; }

const FEED_WINDOWS: Array<[FacebookInsightsSnapshotLabel, number]> = [["t_plus_1h", 1], ["t_plus_6h", 6], ["t_plus_24h", 24], ["t_plus_48h", 48], ["t_plus_7d", 168]];

// Verified valid at Graph API v21.0 (see header). Requested via /{post-id}/insights.
export const FACEBOOK_POST_INSIGHT_METRICS = ["post_impressions_organic", "post_clicks", "post_reactions_by_type_total"] as const;
// Requested via a second call, GET /{post-id}?fields=comments.summary(true),shares — not an Insights metric on Facebook.
export const FACEBOOK_POST_OBJECT_FIELDS = "comments.summary(true),shares" as const;

/** Only IMAGE and TEXT_LINK are collectable this stage — matches Stage 1B-A/1B-D's own CAROUSEL/STORIES block and this stage's deliberate VIDEO/REELS deferral. */
export function isFacebookInsightsCollectable(record: FacebookInsightsCandidate): boolean {
  if (record.publish_status !== "published" || !record.external_post_id || !record.published_at) return false;
  if ((record.platform ?? "").toLowerCase() !== "facebook") return false;
  const contentType = typeof record.publish_settings?.content_type === "string" ? record.publish_settings.content_type.toUpperCase() : "";
  return contentType === "IMAGE" || contentType === "TEXT_LINK";
}

export function nextDueFacebookSnapshot(record: FacebookInsightsCandidate, existingLabels: readonly string[], now = new Date()): FacebookDueSnapshot | null {
  if (!isFacebookInsightsCollectable(record) || !record.published_at) return null;
  const published = new Date(record.published_at).getTime();
  if (!Number.isFinite(published)) return null;
  const current = now.getTime();
  for (const [label, hours] of FEED_WINDOWS) {
    if (existingLabels.includes(label)) continue;
    const due = published + hours * 3_600_000;
    if (current < due) return null;
    return { label, dueAt: new Date(due).toISOString() };
  }
  return null;
}

export interface MetaFacebookInsightDatum { name?: unknown; values?: Array<{ value?: unknown }>; }

/** Normalizes both the /insights response and the post-object fields payload into Cockpit's shared metric vocabulary (impressions/clicks/likes/comments/shares) — the same logical names Instagram already uses, so `calculatePerformanceScore` needs no Facebook-specific branch. */
export function normalizeFacebookInsights(insightsData: readonly MetaFacebookInsightDatum[], postObject: { comments?: { summary?: { total_count?: unknown } }; shares?: { count?: unknown } }): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const item of insightsData) {
    if (typeof item.name !== "string") continue;
    const raw = item.values?.[0]?.value;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) continue;
    if (item.name === "post_impressions_organic") normalized.impressions = raw;
    else if (item.name === "post_clicks") normalized.clicks = raw;
    else if (item.name === "post_reactions_by_type_total") normalized.likes = raw;
  }
  const comments = postObject.comments?.summary?.total_count;
  if (typeof comments === "number" && Number.isFinite(comments) && comments >= 0) normalized.comments = comments;
  const shares = postObject.shares?.count;
  if (typeof shares === "number" && Number.isFinite(shares) && shares >= 0) normalized.shares = shares;
  return normalized;
}

export function classifyFacebookInsightsError(status: number, body: unknown): FacebookInsightsErrorCategory {
  const error = body && typeof body === "object" ? (body as { error?: Record<string, unknown> }).error : undefined;
  const code = typeof error?.code === "number" ? error.code : undefined;
  const subcode = typeof error?.error_subcode === "number" ? error.error_subcode : undefined;
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  if (status === 429 || [4, 17, 32, 613].includes(code ?? -1)) return "meta_rate_limit";
  if (code === 190 || [463, 467].includes(subcode ?? -1)) return "meta_authentication";
  if (code === 10 || code === 200 || message.includes("permission")) return "meta_permission";
  if (code === 100 && (message.includes("metric") || message.includes("parameter"))) return "meta_unsupported_metric";
  if (code === 100 || message.includes("unsupported get request")) return "meta_media_unavailable";
  return status >= 500 ? "meta_network" : "unknown";
}
