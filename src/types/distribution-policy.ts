// Programme Stage K — Organic Distribution Consolidation, frontend types.

export type ApprovalMode = "internal_only" | "client_approval_required";

export interface BlackoutPeriod {
  start_date: string;
  end_date: string;
  reason: string;
}

export interface ClientDistributionPolicyRow {
  id: string;
  client_id: string;
  approval_mode: ApprovalMode;
  auto_schedule_after_approval: boolean;
  manual_publish_only: boolean;
  blackout_periods: BlackoutPeriod[];
  restricted_weekdays: number[];
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export const WEEKDAY_LABEL: Record<number, string> = {
  0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat",
};

export type CanonicalAssetFormat = "feed_post" | "carousel" | "story_sequence" | "story_video" | "reel_video" | "ad_static";

export const CANONICAL_ASSET_FORMAT_LABEL: Record<CanonicalAssetFormat, string> = {
  feed_post: "Feed image",
  carousel: "Carousel",
  story_sequence: "Story image",
  story_video: "Story video",
  reel_video: "Reel",
  ad_static: "Ad (static)",
};
