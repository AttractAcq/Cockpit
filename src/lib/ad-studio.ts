// Programme Stage L — Ad Studio and Paid Distribution data access.

import { supabase, invokeFn } from "./supabase";
import type {
  AdOpportunityRow, AdOpportunityOrigin, AdBriefRow, AdBriefBody,
  AdCreativeVariantRow, AdBudgetPolicyRow, AdCampaignRow, AdSetRow, AdRow, AdLaunchAttemptRow,
} from "@/types/ad-studio";

export async function fetchAdOpportunities(clientId: string): Promise<AdOpportunityRow[]> {
  const { data, error } = await supabase.from("ad_opportunities").select("*").eq("client_id", clientId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdOpportunityRow[];
}

export async function createAdOpportunity(input: {
  clientId: string; title: string; origin: AdOpportunityOrigin;
  promotedFromContentOpportunityId?: string; coreClaim?: string; offerRef?: string; notes?: string;
}): Promise<{ ok: true; opportunity: AdOpportunityRow }> {
  return await invokeFn("create-ad-opportunity", {
    client_id: input.clientId, title: input.title, origin: input.origin,
    promoted_from_content_opportunity_id: input.promotedFromContentOpportunityId,
    core_claim: input.coreClaim, offer_ref: input.offerRef, notes: input.notes,
  });
}

export async function fetchAdBriefsForOpportunity(opportunityId: string): Promise<AdBriefRow[]> {
  const { data, error } = await supabase.from("ad_briefs").select("*").eq("ad_opportunity_id", opportunityId).order("brief_version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdBriefRow[];
}

export async function createAdBrief(input: { clientId: string; adOpportunityId: string; briefBody: AdBriefBody }): Promise<{ ok: true; brief: AdBriefRow }> {
  return await invokeFn("manage-ad-brief", { client_id: input.clientId, action: "create", ad_opportunity_id: input.adOpportunityId, brief_body: input.briefBody });
}

export async function reviewAdBrief(input: {
  clientId: string; adBriefId: string; action: "submit_for_review" | "approve" | "request_changes";
  proofItemId?: string; feedback?: string;
}): Promise<{ ok: true; brief: AdBriefRow }> {
  return await invokeFn("manage-ad-brief", {
    client_id: input.clientId, action: input.action, ad_brief_id: input.adBriefId,
    proof_item_id: input.proofItemId, feedback: input.feedback,
  });
}

export async function fetchCreativeVariantsForBrief(briefId: string): Promise<AdCreativeVariantRow[]> {
  const { data, error } = await supabase.from("ad_creative_variants").select("*").eq("ad_brief_id", briefId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AdCreativeVariantRow[];
}

export async function generateAdCreativeVariants(input: { clientId: string; adBriefId: string; formats: string[] }): Promise<{ ok: true; new_variant_count: number; total_combinations: number }> {
  return await invokeFn("generate-ad-creative-variants", { client_id: input.clientId, ad_brief_id: input.adBriefId, formats: input.formats });
}

export async function fetchAdBudgetPolicy(clientId: string): Promise<AdBudgetPolicyRow | null> {
  const { data, error } = await supabase.from("ad_budget_policies").select("*").eq("client_id", clientId).maybeSingle();
  if (error) throw error;
  return (data as AdBudgetPolicyRow | null) ?? null;
}

export async function setAdBudgetPolicy(input: {
  clientId: string; adAccountId?: string; adAccountOwnerVerified: boolean; paymentMethodVerified: boolean;
  spendLimitDaily: number | null; spendLimitTotal: number | null; requiresClientApproval: boolean;
  allowedGeographies: string[]; restrictedAudienceFlags: string[]; regulatedCategories: string[];
}): Promise<{ ok: true; policy: AdBudgetPolicyRow }> {
  return await invokeFn("set-ad-budget-policy", {
    client_id: input.clientId, ad_account_id: input.adAccountId,
    ad_account_owner_verified: input.adAccountOwnerVerified, payment_method_verified: input.paymentMethodVerified,
    spend_limit_daily: input.spendLimitDaily, spend_limit_total: input.spendLimitTotal,
    requires_client_approval: input.requiresClientApproval, allowed_geographies: input.allowedGeographies,
    restricted_audience_flags: input.restrictedAudienceFlags, regulated_categories: input.regulatedCategories,
  });
}

export async function fetchAdCampaignsForBrief(briefId: string): Promise<AdCampaignRow[]> {
  const { data, error } = await supabase.from("ad_campaigns").select("*").eq("ad_brief_id", briefId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdCampaignRow[];
}

export async function createAdCampaign(input: {
  clientId: string; adBriefId: string; name: string; objective: string;
  budgetDaily?: number; budgetTotal?: number; selectedVariantIds: string[];
  adSet?: { name?: string; audience?: Record<string, unknown>; placement?: string[]; budgetDaily?: number };
}): Promise<{ ok: true; idempotent_replay: boolean; campaign: AdCampaignRow }> {
  return await invokeFn("create-ad-campaign", {
    client_id: input.clientId, ad_brief_id: input.adBriefId, name: input.name, objective: input.objective,
    budget_daily: input.budgetDaily, budget_total: input.budgetTotal, selected_variant_ids: input.selectedVariantIds,
    ad_set: input.adSet ? { name: input.adSet.name, audience: input.adSet.audience, placement: input.adSet.placement, budget_daily: input.adSet.budgetDaily } : undefined,
  });
}

export async function fetchAdSetsForCampaign(campaignId: string): Promise<AdSetRow[]> {
  const { data, error } = await supabase.from("ad_sets").select("*").eq("ad_campaign_id", campaignId);
  if (error) throw error;
  return (data ?? []) as AdSetRow[];
}

export async function fetchAdsForSet(adSetId: string): Promise<AdRow[]> {
  const { data, error } = await supabase.from("ads").select("*").eq("ad_set_id", adSetId);
  if (error) throw error;
  return (data ?? []) as AdRow[];
}

export async function fetchLaunchAttemptsForCampaign(campaignId: string): Promise<AdLaunchAttemptRow[]> {
  const { data, error } = await supabase.from("ad_launch_attempts").select("*").eq("ad_campaign_id", campaignId).order("attempt_number", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdLaunchAttemptRow[];
}

export async function launchAdCampaign(input: {
  clientId: string; adCampaignId: string; requestedGeographies: string[]; requestedAudienceFlags: string[];
  regulatedCategory?: string; regulatedCategoryAcknowledged?: boolean;
}): Promise<{ ok: boolean; campaign: AdCampaignRow }> {
  return await invokeFn("launch-ad-campaign", {
    client_id: input.clientId, ad_campaign_id: input.adCampaignId,
    requested_geographies: input.requestedGeographies, requested_audience_flags: input.requestedAudienceFlags,
    regulated_category: input.regulatedCategory, regulated_category_acknowledged: input.regulatedCategoryAcknowledged,
  });
}

export async function updateAdCampaignStatus(input: {
  clientId: string; adCampaignId: string; action: "pause" | "resume" | "complete" | "archive" | "reconcile";
  reconciledStatus?: string;
}): Promise<{ ok: true; campaign: AdCampaignRow }> {
  return await invokeFn("update-ad-campaign-status", {
    client_id: input.clientId, ad_campaign_id: input.adCampaignId, action: input.action, reconciled_status: input.reconciledStatus,
  });
}

export async function updateAdCampaignBudget(input: { clientId: string; adCampaignId: string; budgetDaily?: number; budgetTotal?: number }): Promise<{ ok: true; campaign: AdCampaignRow }> {
  return await invokeFn("update-ad-campaign-budget", {
    client_id: input.clientId, ad_campaign_id: input.adCampaignId, budget_daily: input.budgetDaily, budget_total: input.budgetTotal,
  });
}
