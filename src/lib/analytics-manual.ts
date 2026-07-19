export type AnalyticsContentKind = "story" | "feed";
export type ManualAnalyticsStatus = "no_metrics" | "partial_metrics" | "metrics_entered" | "business_signals_entered";

export const FEED_METRIC_FIELDS = ["impressions", "reach", "likes", "comments", "shares", "saves", "profile_visits", "follows", "website_clicks"] as const;
export const STORY_METRIC_FIELDS = ["impressions", "reach", "replies", "shares", "profile_visits", "follows", "taps_forward", "taps_back", "exits", "completion_rate"] as const;

export function analyticsContentKind(assetFormat: string | null | undefined, contentType?: string | null): AnalyticsContentKind {
  return contentType?.toUpperCase() === "STORIES" || (assetFormat ?? "").toLowerCase().includes("story") ? "story" : "feed";
}

export function metricFieldsForFormat(assetFormat: string | null | undefined, contentType?: string | null): readonly string[] {
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
