// Stage 2 Phase 05 — Marketing IA consolidation. The Campaigns object.
// Deliberately thin: budget_cents/results are real columns but never
// written by any RPC yet -- empty shells pending Finance (08) and real
// Distribution linkage. Asset linkage deferred entirely.

export type MarketingCampaignStatus = "planning" | "active" | "completed" | "archived";

export interface MarketingCampaignRow {
  id: string;
  client_id: string;
  name: string;
  channel: string | null;
  main_offer_id: string | null;
  avatar_release_id: string | null;
  status: MarketingCampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  budget_cents: number | null;
  results: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MainOfferOption {
  id: string;
  offer_name: string;
}

export interface AvatarReleaseOption {
  id: string;
  title: string;
  version: number;
}
