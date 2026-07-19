export type InsightsKind = "feed" | "story" | "unsupported";
export type InsightsSnapshotLabel = "t_plus_1h" | "t_plus_6h" | "t_plus_24h" | "t_plus_48h" | "t_plus_7d" | "story_t_plus_1h" | "story_t_plus_6h" | "story_t_plus_23h";
export type InsightsErrorCategory = "meta_authentication" | "meta_permission" | "meta_rate_limit" | "meta_unsupported_metric" | "meta_media_unavailable" | "meta_network" | "validation" | "unknown";

export interface InsightsCandidate {
  publish_status: string; external_post_id: string | null; published_at: string | null; platform: string | null;
  asset_format: string | null; publish_settings?: Record<string, unknown> | null;
}
export interface DueSnapshot { label: InsightsSnapshotLabel; dueAt: string; expired: boolean; }

const FEED_WINDOWS: Array<[InsightsSnapshotLabel, number]> = [["t_plus_1h",1],["t_plus_6h",6],["t_plus_24h",24],["t_plus_48h",48],["t_plus_7d",168]];
const STORY_WINDOWS: Array<[InsightsSnapshotLabel, number]> = [["story_t_plus_1h",1],["story_t_plus_6h",6],["story_t_plus_23h",23]];

export const FEED_INSIGHT_METRICS = ["impressions","reach","likes","comments","shares","saved","follows","profile_visits"] as const;
export const STORY_INSIGHT_METRICS = ["impressions","reach","replies","shares","navigation","follows","profile_visits"] as const;

export function clampBatchSize(value: unknown): number {
  const parsed = Number(value ?? 5);
  return Number.isFinite(parsed) ? Math.min(20, Math.max(1, Math.trunc(parsed))) : 5;
}

export function insightsKind(assetFormat: string | null | undefined, publishSettings?: Record<string, unknown> | null): InsightsKind {
  const contentType = typeof publishSettings?.content_type === "string" ? publishSettings.content_type.toUpperCase() : "";
  const format = (assetFormat ?? "").toLowerCase();
  if (contentType === "STORIES" || format.includes("story")) return "story";
  if (contentType === "REELS" || format.includes("reel")) return "unsupported";
  return ["feed_post","carousel","ad_static","image"].includes(format) || contentType === "IMAGE" || contentType === "CAROUSEL" ? "feed" : "unsupported";
}

export function isCollectable(record: InsightsCandidate): boolean {
  return record.publish_status === "published" && Boolean(record.external_post_id) && Boolean(record.published_at) && (record.platform ?? "").toLowerCase() === "instagram" && insightsKind(record.asset_format, record.publish_settings) !== "unsupported";
}

export function isTerminallyExpiredStory(record: InsightsCandidate, hasSkippedExpiredAttempt: boolean): boolean {
  return hasSkippedExpiredAttempt && insightsKind(record.asset_format, record.publish_settings) === "story";
}

export function nextDueSnapshot(record: InsightsCandidate, existingLabels: readonly string[], now = new Date()): DueSnapshot | null {
  if (!isCollectable(record) || !record.published_at) return null;
  const published = new Date(record.published_at).getTime();
  if (!Number.isFinite(published)) return null;
  const story = insightsKind(record.asset_format, record.publish_settings) === "story";
  const windows = story ? STORY_WINDOWS : FEED_WINDOWS;
  const current = now.getTime();
  for (const [label, hours] of windows) {
    if (existingLabels.includes(label)) continue;
    const due = published + hours * 3_600_000;
    if (current < due) return null;
    return { label, dueAt: new Date(due).toISOString(), expired: story && current > published + 24 * 3_600_000 };
  }
  return null;
}

export function metricsForKind(kind: InsightsKind): readonly string[] {
  return kind === "story" ? STORY_INSIGHT_METRICS : kind === "feed" ? FEED_INSIGHT_METRICS : [];
}

export interface MetaInsightDatum { name?: unknown; value?: unknown; values?: Array<{ value?: unknown }>; }
export function normalizeMetaInsights(data: readonly MetaInsightDatum[]): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const item of data) {
    if (typeof item.name !== "string") continue;
    const raw = item.value ?? item.values?.[0]?.value;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) continue;
    const key = item.name === "saved" ? "saves" : item.name;
    normalized[key] = raw;
  }
  return normalized;
}

export function classifyInsightsError(status: number, body: unknown): InsightsErrorCategory {
  const error = body && typeof body === "object" ? (body as { error?: Record<string, unknown> }).error : undefined;
  const code = typeof error?.code === "number" ? error.code : undefined;
  const subcode = typeof error?.error_subcode === "number" ? error.error_subcode : undefined;
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  if (status === 429 || [4,17,32,613].includes(code ?? -1)) return "meta_rate_limit";
  if (code === 190 || [463,467].includes(subcode ?? -1)) return "meta_authentication";
  if (code === 10 || code === 200 || message.includes("permission")) return "meta_permission";
  if (code === 100 && (message.includes("metric") || message.includes("parameter"))) return "meta_unsupported_metric";
  if (code === 100 || message.includes("media") || message.includes("unsupported get request")) return "meta_media_unavailable";
  return status >= 500 ? "meta_network" : "unknown";
}
