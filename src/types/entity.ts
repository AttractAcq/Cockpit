import type { UUID, ISODate, ZAR, PipelineStage, Channel, Tier } from "./common";

/**
 * Entity = unified record for prospects + clients.
 * In Supabase this maps to the `entities` table; pipeline_stage moves
 * the entity through its lifecycle from cold → delivering.
 */
export interface Entity {
  id: UUID;
  business_name: string;
  contact_name: string | null;
  industry: string;
  location: string; // e.g. "Sea Point, Cape Town"
  pipeline_stage: PipelineStage;
  tier: Tier | null;

  // Contact handles
  instagram_handle: string | null;
  whatsapp_number: string | null;
  email: string | null;
  website: string | null;

  // Commercial
  mrr: ZAR;
  pipeline_value: ZAR;

  // Source + scoring
  source: "apify_maps" | "referral" | "inbound_dm" | "ad_lead" | "manual";
  icp_score: number; // 0-100, AA fit
  agent_score: number | null; // 0-1, OpenClaw hotness

  // Account ownership
  account_manager: UUID | null;
  account_manager_name: string | null;

  // Lifecycle timestamps
  created_at: ISODate;
  updated_at: ISODate;
  last_contact_at: ISODate | null;
  stage_changed_at: ISODate;

  // Free text
  notes: string | null;
  tags: string[];

  // Last touch summary (derived/denormalized)
  last_channel: Channel | null;
  last_message_preview: string | null;
}

export type ProspectEntity = Entity & {
  pipeline_stage: Exclude<PipelineStage, "active" | "delivering" | "churned">;
};

export type ClientEntity = Entity & {
  pipeline_stage: Extract<PipelineStage, "active" | "delivering" | "churned">;
  tier: Tier; // clients always have a tier
};
