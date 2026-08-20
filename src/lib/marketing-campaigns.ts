// Stage 2 Phase 05 — Marketing IA consolidation. Campaigns data access.
// Reads go direct; writes go through the staff-only RPCs, matching the
// established direct-supabase.rpc(...) convention for this class of
// administrative operation.

import { supabase } from "./supabase";
import type { MarketingCampaignRow, MainOfferOption, AvatarReleaseOption } from "@/types/marketing-campaign";

export async function fetchMarketingCampaigns(clientId: string): Promise<MarketingCampaignRow[]> {
  const { data, error } = await supabase
    .from("client_marketing_campaigns")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MarketingCampaignRow[];
}

export async function fetchMainOfferOptions(clientId: string): Promise<MainOfferOption[]> {
  const { data, error } = await supabase
    .from("client_main_offers")
    .select("id, offer_name")
    .eq("client_id", clientId)
    .order("display_order");
  if (error) throw error;
  return (data ?? []) as MainOfferOption[];
}

export async function fetchAvatarReleaseOptions(clientId: string): Promise<AvatarReleaseOption[]> {
  const { data, error } = await supabase
    .from("client_avatar_releases")
    .select("id, title, version")
    .eq("client_id", clientId)
    .eq("status", "approved")
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AvatarReleaseOption[];
}

export async function createMarketingCampaign(input: {
  clientId: string; name: string; channel?: string | null;
  mainOfferId?: string | null; avatarReleaseId?: string | null;
  startsAt?: string | null; endsAt?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_marketing_campaign", {
    p_client_id: input.clientId, p_name: input.name, p_channel: input.channel ?? null,
    p_main_offer_id: input.mainOfferId ?? null, p_avatar_release_id: input.avatarReleaseId ?? null,
    p_starts_at: input.startsAt ?? null, p_ends_at: input.endsAt ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function updateMarketingCampaignStatus(campaignId: string, status: string): Promise<void> {
  const { error } = await supabase.rpc("update_marketing_campaign_status", { p_campaign_id: campaignId, p_new_status: status });
  if (error) throw error;
}
