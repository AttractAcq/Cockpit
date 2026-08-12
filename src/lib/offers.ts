import { invokeFn, supabase } from "@/lib/supabase";
import type {
  FinalizeOffersResponse,
  MainOffer,
  MainOfferRelease,
  MoneyModelComponent,
  OfferApprovalDecision,
  OffersBuildSelection,
  OfferType,
  OffersReviewDecision,
  OffersWorkspace,
  PrepareOffersResponse,
  RunOffersStepResponse,
  SeasonalOfferCampaignPeriodOption,
  SeasonalOfferMainOfferOption,
  SeasonalOffer,
  SeasonalOfferRelease,
} from "@/types/offers";
import type { IntelligenceResearchRun, IntelligenceResearchStep } from "@/types/intelligence";

async function maybeSingle<T>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw error;
  return (data as T | null) ?? null;
}

async function rows<T>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw error;
  return (data as T[] | null) ?? [];
}

export async function fetchOffersWorkspace(clientId: string, offerType: "main"): Promise<Extract<OffersWorkspace, { offerType: "main" }>>;
export async function fetchOffersWorkspace(clientId: string, offerType: "seasonal"): Promise<Extract<OffersWorkspace, { offerType: "seasonal" }>>;
export async function fetchOffersWorkspace(clientId: string, offerType: OfferType): Promise<OffersWorkspace>;
export async function fetchOffersWorkspace(clientId: string, offerType: OfferType): Promise<OffersWorkspace> {
  const runPromise = maybeSingle<IntelligenceResearchRun>(supabase.from("client_research_runs")
    .select("*").eq("client_id", clientId).eq("research_domain", "offer_system")
    .eq("configuration_snapshot->>offer_type", offerType)
    .order("created_at", { ascending: false }).limit(1).maybeSingle());

  if (offerType === "main") {
    const [latestRelease, activePointer, latestRun] = await Promise.all([
      maybeSingle<MainOfferRelease>(supabase.from("client_offer_architecture_releases")
        .select("*").eq("client_id", clientId).order("version", { ascending: false }).limit(1).maybeSingle()),
      maybeSingle<{ release_id: string }>(supabase.from("client_offer_architecture_active_releases")
        .select("release_id").eq("client_id", clientId).maybeSingle()),
      runPromise,
    ]);
    const activeRelease = activePointer?.release_id === latestRelease?.id
      ? latestRelease
      : activePointer
        ? await maybeSingle<MainOfferRelease>(supabase.from("client_offer_architecture_releases")
          .select("*").eq("id", activePointer.release_id).eq("client_id", clientId).maybeSingle())
        : null;
    const releaseForWorkspace = latestRelease ?? activeRelease;
    const [steps, offers, moneyModelComponents, approvalDecisions] = await Promise.all([
      latestRun
        ? rows<IntelligenceResearchStep>(supabase.from("client_research_steps")
          .select("*").eq("client_id", clientId).eq("research_run_id", latestRun.id).order("step_order"))
        : Promise.resolve([]),
      releaseForWorkspace
        ? rows<MainOffer>(supabase.from("client_main_offers")
          .select("*").eq("client_id", clientId).eq("release_id", releaseForWorkspace.id).order("display_order"))
        : Promise.resolve([]),
      releaseForWorkspace
        ? rows<MoneyModelComponent>(supabase.from("client_money_model_components")
          .select("*").eq("client_id", clientId).eq("release_id", releaseForWorkspace.id).order("display_order"))
        : Promise.resolve([]),
      releaseForWorkspace
        ? rows<OfferApprovalDecision>(supabase.from("client_offer_approval_decisions")
          .select("*").eq("client_id", clientId).eq("release_kind", "main_offers").eq("release_id", releaseForWorkspace.id).order("decided_at", { ascending: false }))
        : Promise.resolve([]),
    ]);
    return { offerType, latestRelease, activeRelease, latestRun, steps, offers, moneyModelComponents, approvalDecisions };
  }

  const [latestRelease, activePointer, latestRun, campaignPointer, mainPointer] = await Promise.all([
    maybeSingle<SeasonalOfferRelease>(supabase.from("client_seasonal_offer_releases")
      .select("*").eq("client_id", clientId).order("version", { ascending: false }).limit(1).maybeSingle()),
    maybeSingle<{ release_id: string }>(supabase.from("client_seasonal_offer_active_releases")
      .select("release_id").eq("client_id", clientId).maybeSingle()),
    runPromise,
    maybeSingle<{ release_id: string }>(supabase.from("client_campaign_intelligence_active_releases")
      .select("release_id").eq("client_id", clientId).maybeSingle()),
    maybeSingle<{ release_id: string }>(supabase.from("client_offer_architecture_active_releases")
      .select("release_id").eq("client_id", clientId).maybeSingle()),
  ]);
  const activeRelease = activePointer?.release_id === latestRelease?.id
    ? latestRelease
    : activePointer
      ? await maybeSingle<SeasonalOfferRelease>(supabase.from("client_seasonal_offer_releases")
        .select("*").eq("id", activePointer.release_id).eq("client_id", clientId).maybeSingle())
      : null;
  const releaseForWorkspace = latestRelease ?? activeRelease;
  const [steps, offers, campaignPeriodOptions, mainOfferOptions, approvalDecisions] = await Promise.all([
    latestRun
      ? rows<IntelligenceResearchStep>(supabase.from("client_research_steps")
        .select("*").eq("client_id", clientId).eq("research_run_id", latestRun.id).order("step_order"))
      : Promise.resolve([]),
    releaseForWorkspace
      ? rows<SeasonalOffer>(supabase.from("client_seasonal_offers")
        .select("*").eq("client_id", clientId).eq("release_id", releaseForWorkspace.id).order("display_order"))
      : Promise.resolve([]),
    campaignPointer?.release_id
      ? rows<SeasonalOfferCampaignPeriodOption>(supabase.from("client_campaign_periods")
        .select("id,title,strategic_theme,timing_label,pain_point_salience,desired_outcome,positioning_direction,campaign_objective,display_order")
        .eq("client_id", clientId).eq("release_id", campaignPointer.release_id).order("display_order"))
      : Promise.resolve([]),
    mainPointer?.release_id
      ? rows<SeasonalOfferMainOfferOption>(supabase.from("client_main_offers")
        .select("id,offer_name,offer_role,offer_stage,promised_outcome,mechanism,display_order")
        .eq("client_id", clientId).eq("release_id", mainPointer.release_id).order("display_order"))
      : Promise.resolve([]),
    releaseForWorkspace
      ? rows<OfferApprovalDecision>(supabase.from("client_offer_approval_decisions")
        .select("*").eq("client_id", clientId).eq("release_kind", "seasonal_offers").eq("release_id", releaseForWorkspace.id).order("decided_at", { ascending: false }))
      : Promise.resolve([]),
  ]);
  return { offerType, latestRelease, activeRelease, latestRun, steps, offers, campaignPeriodOptions, mainOfferOptions, approvalDecisions };
}

export async function prepareOffers(
  clientId: string,
  offerType: OfferType,
  selection?: OffersBuildSelection,
): Promise<PrepareOffersResponse> {
  return invokeFn<PrepareOffersResponse>("run-offers", {
    action: "prepare",
    offer_type: offerType,
    client_id: clientId,
    campaign_period_id: selection?.campaign_period_id,
    main_offer_id: selection?.main_offer_id,
  });
}

export async function runOffersStep(
  clientId: string,
  offerType: OfferType,
  researchRunId: string,
): Promise<RunOffersStepResponse> {
  return invokeFn<RunOffersStepResponse>("run-offers", {
    action: "step",
    offer_type: offerType,
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function finalizeOffers(
  clientId: string,
  offerType: OfferType,
  researchRunId: string,
): Promise<FinalizeOffersResponse> {
  return invokeFn<FinalizeOffersResponse>("run-offers", {
    action: "finalize",
    offer_type: offerType,
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function driveOffersBuild(
  clientId: string,
  offerType: OfferType,
  onProgress?: (progress: RunOffersStepResponse["progress"]) => void,
  selection?: OffersBuildSelection,
): Promise<FinalizeOffersResponse> {
  const prepared = await prepareOffers(clientId, offerType, selection);
  if (!prepared.ok || !prepared.research_run_id) throw new Error(prepared.message);
  for (let guard = 0; guard < 10; guard += 1) {
    const result = await runOffersStep(clientId, offerType, prepared.research_run_id);
    onProgress?.(result.progress);
    if (!result.ok && result.terminal) throw new Error(result.message);
    if (result.terminal) return finalizeOffers(clientId, offerType, prepared.research_run_id);
  }
  throw new Error("Offers workflow exceeded its step guard.");
}

export async function reviewOffersRelease(
  releaseId: string,
  offerType: OfferType,
  decision: OffersReviewDecision,
  note?: string,
): Promise<MainOfferRelease | SeasonalOfferRelease> {
  const rpcName = offerType === "main" ? "review_offer_architecture_release" : "review_seasonal_offer_release";
  const { data, error } = await supabase.rpc(rpcName, {
    p_release_id: releaseId,
    p_decision: decision,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as MainOfferRelease | SeasonalOfferRelease;
}
