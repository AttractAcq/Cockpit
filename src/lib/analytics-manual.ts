export type AnalyticsContentKind = "story" | "feed";
export type ManualAnalyticsStatus = "no_metrics" | "partial_metrics" | "metrics_entered" | "business_signals_entered";

export const FEED_METRIC_FIELDS = ["impressions", "reach", "likes", "comments", "shares", "saves", "profile_visits", "follows", "website_clicks"] as const;
export const STORY_METRIC_FIELDS = ["impressions", "reach", "replies", "shares", "profile_visits", "follows", "taps_forward", "taps_back", "exits", "completion_rate"] as const;
// Programme Stage 1B-E: Facebook has no Story surface (Stage 1B-A/1B-D:
// CAROUSEL/STORIES remain blocked) and a narrower confirmed metric set than
// Instagram — see _shared/facebook-insights.ts for why (post_impressions/
// reach and post_engaged_users are deprecated at the Graph API version this
// build targets; there is no "saves"/"profile_visits"/"follows" figure
// exposed on a Page post). Kept in sync with upsert_manual_metric_snapshot's
// own v_allowed array in the 1B-E migration — the DB is authoritative, this
// is only for the UI's field list.
export const FACEBOOK_METRIC_FIELDS = ["impressions", "clicks", "likes", "comments", "shares", "video_views"] as const;

export function analyticsContentKind(assetFormat: string | null | undefined, contentType?: string | null): AnalyticsContentKind {
  return contentType?.toUpperCase() === "STORIES" || (assetFormat ?? "").toLowerCase().includes("story") ? "story" : "feed";
}

export function metricFieldsForFormat(assetFormat: string | null | undefined, contentType?: string | null, platform?: string | null): readonly string[] {
  if ((platform ?? "instagram").toLowerCase() === "facebook") return FACEBOOK_METRIC_FIELDS;
  return analyticsContentKind(assetFormat, contentType) === "story" ? STORY_METRIC_FIELDS : FEED_METRIC_FIELDS;
}

export function sanitizeMetricPayload(values: Record<string, string>, allowedKeys: readonly string[]): Record<string, number> {
  const payload: Record<string, number> = {};
  for (const key of allowedKeys) {
    const raw = values[key]?.trim() ?? "";
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${key.replaceAll("_", " ")} must be a non-negative number.`);
    if (key === "completion_rate" && value > 100) throw new Error("completion rate must be between 0 and 100.");
    payload[key] = value;
  }
  return payload;
}

export function sanitizeBusinessSignals(values: Record<string, string>): Record<string, number | null> {
  const payload: Record<string, number | null> = {};
  for (const [key, rawValue] of Object.entries(values)) {
    const raw = rawValue.trim();
    if (!raw) { payload[key] = null; continue; }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${key.replaceAll("_", " ")} must be a non-negative number.`);
    payload[key] = value;
  }
  return payload;
}

export function deriveManualAnalyticsStatus(metricCount: number, businessSignalCount: number, populatedMetricCount = 0): ManualAnalyticsStatus {
  if (businessSignalCount > 0) return "business_signals_entered";
  if (metricCount === 0) return "no_metrics";
  return populatedMetricCount > 0 ? "metrics_entered" : "partial_metrics";
}
