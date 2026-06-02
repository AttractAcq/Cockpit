import type { UUID, ISODate, ZAR } from "./common";

export type CampaignStatus = "draft" | "live" | "paused" | "flagged" | "ended";

export type CampaignObjective =
  | "leads"
  | "messages"
  | "traffic"
  | "engagement"
  | "awareness";

export interface Campaign {
  id: UUID;
  meta_campaign_id: string | null; // Meta's own ID
  entity_id: UUID | null; // null for AA's own campaigns
  entity_name: string | null;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;

  // Spend
  budget_daily: ZAR;
  spend_total: ZAR;
  spend_today: ZAR;

  // Performance
  impressions: number;
  clicks: number;
  ctr: number; // percent
  leads: number;
  cpa: ZAR | null;
  cpc: ZAR | null;
  cpl: ZAR | null;

  // Trend (last 7 days, oldest → newest)
  spend_trend_7d: ZAR[];
  cpa_trend_7d: ZAR[];

  // Lifecycle
  started_at: ISODate | null;
  ended_at: ISODate | null;
  flagged_at: ISODate | null;
  flag_reason: string | null;

  // Creative count for quick scan
  creative_count: number;

  created_at: ISODate;
  updated_at: ISODate;
}
