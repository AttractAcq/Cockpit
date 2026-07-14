export type LifecycleStage = "content" | "brief" | "asset" | "distribution" | "analytics" | "archive";
export type DateDirection = "asc" | "desc";

export const UNSCHEDULED_DATE_KEY = "__unscheduled__";
export const UNSCHEDULED_DATE_LABEL = "Unscheduled / Date unavailable";

export interface LifecycleMasterRecord {
  ref?: string | null;
  source_ref?: string | null;
  distribution_date?: string | null;
  publish_date?: string | null;
  start_date?: string | null;
  content_type?: string | null;
  story_type?: string | null;
  lane?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface LifecycleBriefRecord {
  id?: string | null;
  source_ref?: string | null;
  asset_format?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface LifecycleDistributionRecord {
  id?: string | null;
  source_ref?: string | null;
  production_brief_id?: string | null;
  asset_format?: string | null;
  planned_publish_date?: string | null;
  scheduled_publish_at?: string | null;
  published_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface LifecycleDateContext {
  mastersByRef?: Map<string, LifecycleMasterRecord>;
  calendarDateByRef?: Map<string, string>;
  briefsById?: Map<string, LifecycleBriefRecord>;
  briefsByRef?: Map<string, LifecycleBriefRecord>;
  distributionById?: Map<string, LifecycleDistributionRecord>;
  distributionByRef?: Map<string, LifecycleDistributionRecord>;
}

export interface LifecycleDateResult {
  date: string | null;
  source: string;
}

export interface LifecycleDateGroup<T> {
  key: string;
  date: string | null;
  label: string;
  weekday: string | null;
  records: T[];
}

interface BasicLifecycleRecord {
  ref?: string | null;
  source_ref?: string | null;
  production_brief_id?: string | null;
  distribution_record_id?: string | null;
  asset_format?: string | null;
  planned_publish_date?: string | null;
  scheduled_publish_at?: string | null;
  published_at?: string | null;
  distribution_date?: string | null;
  publish_date?: string | null;
  start_date?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function normalizeDateKey(value: unknown, timeZone = "UTC"): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return raw;
  const dateTimePrefix = raw.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!dateTimePrefix) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : dateTimePrefix[0].slice(0, 10);
}

function firstDate(candidates: Array<[unknown, string]>, timeZone: string): LifecycleDateResult {
  for (const [value, source] of candidates) {
    const date = normalizeDateKey(value, timeZone);
    if (date) return { date, source };
  }
  return { date: null, source: "none" };
}

function metadataCalendarDate(record: { metadata?: Record<string, unknown> | null } | null | undefined, timeZone: string): string | null {
  const calendar = record?.metadata?.calendar;
  if (!Array.isArray(calendar)) return null;
  const dates = calendar
    .map((cell) => normalizeDateKey((cell as { date?: unknown } | null)?.date, timeZone))
    .filter((date): date is string => !!date)
    .sort();
  return dates[0] ?? null;
}

function sourceRef(record: BasicLifecycleRecord): string | null {
  return record.source_ref ?? record.ref ?? null;
}

export function resolveCanonicalPublishDate(
  record: BasicLifecycleRecord,
  lifecycleStage: LifecycleStage,
  context: LifecycleDateContext = {},
  options: { timeZone?: string } = {},
): LifecycleDateResult {
  const timeZone = options.timeZone ?? "UTC";
  const ref = sourceRef(record);
  const master = ref ? context.mastersByRef?.get(ref) ?? null : null;
  const brief = record.production_brief_id
    ? context.briefsById?.get(record.production_brief_id) ?? null
    : ref ? context.briefsByRef?.get(ref) ?? null : null;
  const calendarDate = ref ? context.calendarDateByRef?.get(ref) ?? null : null;
  const distribution = record.distribution_record_id
    ? context.distributionById?.get(record.distribution_record_id) ?? null
    : ref ? context.distributionByRef?.get(ref) ?? null : null;

  if (lifecycleStage === "content") {
    return firstDate([
      [record.distribution_date, "distribution_date"],
      [record.publish_date, "publish_date"],
      [metadataCalendarDate(record, timeZone), "metadata.calendar"],
    ], timeZone);
  }

  if (lifecycleStage === "brief") {
    const linkedContent = master ? resolveCanonicalPublishDate(master, "content", context, options).date : null;
    return firstDate([
      [linkedContent, "linked_content"],
      [calendarDate, "calendar"],
      [metadataCalendarDate(record, timeZone), "metadata.calendar"],
    ], timeZone);
  }

  if (lifecycleStage === "asset") {
    const briefDate = brief ? resolveCanonicalPublishDate(brief, "brief", context, options).date : null;
    const masterDate = master ? resolveCanonicalPublishDate(master, "content", context, options).date : null;
    return firstDate([
      [briefDate, "linked_brief"],
      [masterDate, "linked_content"],
      [calendarDate, "calendar"],
    ], timeZone);
  }

  if (lifecycleStage === "distribution") {
    const masterDate = master ? resolveCanonicalPublishDate(master, "content", context, options).date : null;
    return firstDate([
      [record.planned_publish_date, "planned_publish_date"],
      [record.scheduled_publish_at, "scheduled_publish_at"],
      [masterDate, "linked_content"],
      [record.published_at, "published_at"],
    ], timeZone);
  }

  if (lifecycleStage === "analytics") {
    const masterDate = master ? resolveCanonicalPublishDate(master, "content", context, options).date : null;
    return firstDate([
      [masterDate, "linked_content"],
      [distribution?.planned_publish_date, "distribution.planned_publish_date"],
      [distribution?.scheduled_publish_at, "distribution.scheduled_publish_at"],
      [record.published_at, "published_at"],
    ], timeZone);
  }

  const masterDate = master ? resolveCanonicalPublishDate(master, "content", context, options).date : null;
  return firstDate([
    [masterDate, "linked_content"],
    [distribution?.planned_publish_date, "distribution.planned_publish_date"],
    [distribution?.scheduled_publish_at, "distribution.scheduled_publish_at"],
    [record.published_at ?? distribution?.published_at, "published_at"],
  ], timeZone);
}

export function formatLifecycleDateHeading(date: string | null): { label: string; weekday: string | null } {
  if (!date) return { label: UNSCHEDULED_DATE_LABEL, weekday: null };
  const parsed = new Date(`${date}T12:00:00Z`);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(parsed);
  return { label, weekday };
}

export function groupLifecycleRecordsByDate<T extends BasicLifecycleRecord>(
  records: T[],
  options: {
    lifecycleStage: LifecycleStage;
    context?: LifecycleDateContext;
    direction?: DateDirection;
    timeZone?: string;
  },
): Array<LifecycleDateGroup<T>> {
  const buckets = new Map<string, LifecycleDateGroup<T>>();
  for (const record of records) {
    const resolved = resolveCanonicalPublishDate(record, options.lifecycleStage, options.context ?? {}, { timeZone: options.timeZone });
    const key = resolved.date ?? UNSCHEDULED_DATE_KEY;
    const existing = buckets.get(key);
    if (existing) existing.records.push(record);
    else {
      const heading = formatLifecycleDateHeading(resolved.date);
      buckets.set(key, {
        key,
        date: resolved.date,
        label: heading.label,
        weekday: heading.weekday,
        records: [record],
      });
    }
  }
  const direction = options.direction ?? "asc";
  return [...buckets.values()].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return direction === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
  });
}

export function resolveLifecycleContentType(record: {
  asset_format?: string | null;
  content_type?: string | null;
  story_type?: string | null;
  lane?: string | null;
}): { key: string; label: string } {
  if (record.story_type) return { key: "story_sequence", label: "Story" };
  if (record.lane) return { key: "ad_static", label: "Static Ad" };
  const format = (record.asset_format ?? record.content_type ?? record.story_type ?? record.lane ?? "").toLowerCase();
  if (["feed_post", "feed post", "static", "image"].includes(format)) return { key: "feed_post", label: "Feed Post" };
  if (["carousel", "carousels"].includes(format)) return { key: "carousel", label: "Carousel" };
  if (["reel", "reels", "reel_video", "reel video"].includes(format)) return { key: "reel_video", label: "Reel" };
  if (["story", "stories", "story_sequence", "story sequence"].includes(format)) return { key: "story_sequence", label: "Story" };
  if (["ad_static", "static_ad", "static ad", "ad", "ads"].includes(format)) return { key: "ad_static", label: "Static Ad" };
  if (["ad_video", "video_ad", "video ad"].includes(format)) return { key: "ad_video", label: "Video Ad" };
  return { key: "unknown", label: "Legacy / Unknown" };
}

export function dateSortValue(date: string | null, direction: DateDirection): string {
  if (date) return date;
  return direction === "asc" ? "9999-99-99" : "0000-00-00";
}
