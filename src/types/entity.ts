import type { UUID, ISODate, PipelineStage, Channel, Tier } from "./common";

/**
 * Entity = unified record for prospects + clients.
 * Maps to the `entities` table in Supabase.
 * Field names match the real DB columns (stage, niche, city, icp_fit_score).
 * `kind` distinguishes prospects from clients.
 */
export interface Entity {
  id: UUID;
  business_name: string;
  kind: "prospect" | "client";

  // Pipeline position
  stage: PipelineStage;

  // Contact (optional — byStage() doesn't select all fields)
  contact_name?: string | null;
  whatsapp_number?: string | null;
  instagram_handle?: string | null;
  email?: string | null;
  website?: string | null;

  // Classification
  niche: string | null;   // industry / category
  city: string | null;    // city / location
  tier: Tier | null;      // set on conversion

  // Scoring
  icp_fit_score: number | null;  // 0-100 ICP match
  agent_score: number | null;    // 0-1 OpenClaw hotness (may not exist in DB)

  // Legacy/demo-only; not present on the canonical entities table.
  source?: "apify_maps" | "referral" | "inbound_dm" | "ad_lead" | "manual" | string | null;

  // Denormalized inbox previews (may not exist in all DB rows)
  last_channel: Channel | null;
  last_message_preview: string | null;
  last_contact_at: ISODate | null;

  // Lifecycle
  created_at: ISODate;
  updated_at: ISODate;

  // Optional fields that exist in full entity records
  notes: string | null;
  tags?: string[];
  account_manager?: UUID | null;
  account_manager_name?: string | null;
  stage_changed_at?: ISODate;

  // Revenue — denormalized or joined from contracts
  mrr?: number;
  mrr_cents?: number;
  pipeline_value?: number;
}
