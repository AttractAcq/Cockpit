import type { DistributionRecordRow, PublishStatus } from "@/types/phase";

export interface StoryValidation {
  isStory: boolean;
  mediaCount: number;
  valid: boolean;
  message: string | null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function validateStoryRecord(record: Pick<DistributionRecordRow, "asset_format" | "publish_payload" | "publish_settings">): StoryValidation {
  const settings = objectValue(record.publish_settings);
  const payload = objectValue(record.publish_payload);
  const contentType = typeof settings.content_type === "string" ? settings.content_type.toUpperCase() : "";
  const format = record.asset_format.toLowerCase();
  const isStory = contentType === "STORIES" || format.includes("story");
  const mediaCount = Array.isArray(payload.media) ? payload.media.length : 0;
  const valid = !isStory || mediaCount === 1;
  return {
    isStory,
    mediaCount,
    valid,
    message: valid ? null : `Stories must be published one frame per record. This record contains ${mediaCount} media items, so it cannot be published or scheduled as a Story.`,
  };
}

export function normalizeDestinationDisplay(destination: string | null | undefined): string {
  if (!destination) return "—";
  const compact = destination.trim().toLowerCase().replace(/^@/, "").replace(/[\s_-]+/g, "");
  return compact === "attractacq" ? "@attractacq" : destination.trim();
}

export const STATUS_GUIDANCE: Record<PublishStatus, string> = {
  ready: "Ready to publish or schedule",
  scheduled: "Worker will publish when due",
  publishing: "Worker has claimed this record",
  published: "External evidence exists — locked from retry",
  failed: "Review error and recovery path",
  needs_reconciliation: "Manual confirmation required",
  cancelled: "Removed from active publishing queue",
};

export function hasExternalEvidence(record: Pick<DistributionRecordRow, "external_post_id" | "published_at" | "published_url">): boolean {
  return Boolean(record.external_post_id || record.published_at || record.published_url);
}

export function errorCategory(lastError: string | null | undefined): string | null {
  if (!lastError) return null;
  return lastError.match(/^\[([^,\]]+)/)?.[1] ?? null;
}
