import type { UUID, ISODate, ZAR, Percent } from "./common";

/**
 * Pulse = vital signs metrics. Shown in TopBar vitals strip,
 * Cockpit's Pulse panel, and Money page detail.
 */

export type PulseTrend = "up" | "down" | "flat";

export interface PulseMetric {
  key: string;
  label: string;
  value: number;
  display_value: string; // pre-formatted, e.g. "R 4,200", "18%"
  delta_value: number;
  delta_display: string; // e.g. "+R1,200", "+4pp"
  delta_label: string; // e.g. "mo", "wk", "n=58"
  trend: PulseTrend;
  trend_is_good: boolean; // whether trend direction is positive for the business
  // 7-day sparkline data (oldest → newest)
  sparkline: number[];
}

/**
 * Asset = anything in the Studio library (briefs, MJRs, reels, decks, etc.)
 */

export type AssetKind =
  | "reel_brief"
  | "mjr_report"
  | "ad_creative"
  | "pitch_deck"
  | "brand_guide"
  | "onboarding_doc"
  | "trust_doc"
  | "other";

export interface Asset {
  id: UUID;
  kind: AssetKind;
  title: string;
  description: string | null;

  entity_id: UUID | null; // null for AA's own assets
  entity_name: string | null;

  file_name: string;
  file_size_bytes: number;
  file_type: string; // "application/pdf", "video/mp4" etc
  thumbnail_url: string | null;

  status: "draft" | "ready" | "shipped" | "archived";
  generated_by: "human" | "agent";
  agent_name: string | null;

  created_at: ISODate;
  updated_at: ISODate;
  tags: string[];
}
