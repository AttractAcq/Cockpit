import { invokeFn, supabase } from "@/lib/supabase";
import type {
  CampaignIntelligenceApprovalDecision,
  CampaignIntelligenceRelease,
  CampaignIntelligenceReviewDecision,
  CampaignIntelligenceWorkspace,
  CampaignPeriod,
  CampaignPeriodSourceLink,
  FinalizeCampaignIntelligenceResponse,
  PrepareCampaignIntelligenceResponse,
  RunCampaignIntelligenceStepResponse,
} from "@/types/campaign-intelligence";
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

export async function fetchCampaignIntelligenceWorkspace(clientId: string): Promise<CampaignIntelligenceWorkspace> {
  const [latestRelease, activePointer, latestRun] = await Promise.all([
    maybeSingle<CampaignIntelligenceRelease>(supabase.from("client_campaign_intelligence_releases")
      .select("*").eq("client_id", clientId).order("version", { ascending: false }).limit(1).maybeSingle()),
    maybeSingle<{ release_id: string }>(supabase.from("client_campaign_intelligence_active_releases")
      .select("release_id").eq("client_id", clientId).maybeSingle()),
    maybeSingle<IntelligenceResearchRun>(supabase.from("client_research_runs")
      .select("*").eq("client_id", clientId).eq("research_domain", "campaign_intelligence")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()),
  ]);

  const activeRelease = activePointer?.release_id === latestRelease?.id
    ? latestRelease
    : activePointer
      ? await maybeSingle<CampaignIntelligenceRelease>(supabase.from("client_campaign_intelligence_releases")
        .select("*").eq("id", activePointer.release_id).eq("client_id", clientId).maybeSingle())
      : null;

  const releaseForWorkspace = latestRelease ?? activeRelease;
  const [steps, periods, approvalDecisions, costEvents] = await Promise.all([
    latestRun
      ? rows<IntelligenceResearchStep>(supabase.from("client_research_steps")
        .select("*").eq("client_id", clientId).eq("research_run_id", latestRun.id).order("step_order"))
      : Promise.resolve([]),
    releaseForWorkspace
      ? rows<CampaignPeriod>(supabase.from("client_campaign_periods")
        .select("*").eq("client_id", clientId).eq("release_id", releaseForWorkspace.id).order("display_order"))
      : Promise.resolve([]),
    releaseForWorkspace
      ? rows<CampaignIntelligenceApprovalDecision>(supabase.from("client_campaign_intelligence_approval_decisions")
        .select("*").eq("client_id", clientId).eq("release_id", releaseForWorkspace.id).order("decided_at", { ascending: false }))
      : Promise.resolve([]),
    latestRun
      ? rows<{ input_units: number; output_units: number; tool_calls: number; amount_microunits: number | null; currency: string | null }>(
        supabase.from("client_research_cost_events")
          .select("input_units,output_units,tool_calls,amount_microunits,currency")
          .eq("client_id", clientId).eq("research_run_id", latestRun.id),
      )
      : Promise.resolve([]),
  ]);

  const periodIds = periods.map((period) => period.id);
  const sourceLinks = periodIds.length > 0
    ? await rows<CampaignPeriodSourceLink>(supabase.from("client_campaign_period_source_links")
      .select("*").eq("client_id", clientId).in("campaign_period_id", periodIds).order("created_at"))
    : [];

  const priced = costEvents.filter((event) => event.amount_microunits !== null);
  const currencies = new Set(priced.map((event) => event.currency).filter((value): value is string => Boolean(value)));
  return {
    latestRelease,
    activeRelease,
    latestRun,
    steps,
    periods,
    sourceLinks,
    approvalDecisions,
    usage: {
      inputUnits: costEvents.reduce((total, event) => total + event.input_units, 0),
      outputUnits: costEvents.reduce((total, event) => total + event.output_units, 0),
      toolCalls: costEvents.reduce((total, event) => total + event.tool_calls, 0),
      amountMicrounits: priced.length > 0 && currencies.size <= 1
        ? priced.reduce((total, event) => total + (event.amount_microunits ?? 0), 0)
        : null,
      currency: currencies.size === 1 ? [...currencies][0] : null,
    },
  };
}

export async function prepareCampaignIntelligence(clientId: string): Promise<PrepareCampaignIntelligenceResponse> {
  return invokeFn<PrepareCampaignIntelligenceResponse>("run-campaign-intelligence", { action: "prepare", client_id: clientId });
}

export async function runCampaignIntelligenceStep(
  clientId: string,
  researchRunId: string,
): Promise<RunCampaignIntelligenceStepResponse> {
  return invokeFn<RunCampaignIntelligenceStepResponse>("run-campaign-intelligence", {
    action: "step",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function finalizeCampaignIntelligence(
  clientId: string,
  researchRunId: string,
): Promise<FinalizeCampaignIntelligenceResponse> {
  return invokeFn<FinalizeCampaignIntelligenceResponse>("run-campaign-intelligence", {
    action: "finalize",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function driveCampaignIntelligenceBuild(
  clientId: string,
  onProgress?: (progress: RunCampaignIntelligenceStepResponse["progress"]) => void,
): Promise<FinalizeCampaignIntelligenceResponse> {
  const prepared = await prepareCampaignIntelligence(clientId);
  if (!prepared.ok || !prepared.research_run_id) throw new Error(prepared.message);
  for (let guard = 0; guard < 10; guard += 1) {
    const result = await runCampaignIntelligenceStep(clientId, prepared.research_run_id);
    onProgress?.(result.progress);
    if (!result.ok && result.terminal) throw new Error(result.message);
    if (result.terminal) return finalizeCampaignIntelligence(clientId, prepared.research_run_id);
  }
  throw new Error("Campaign Intelligence workflow exceeded its step guard.");
}

export async function reviewCampaignIntelligenceRelease(
  releaseId: string,
  decision: CampaignIntelligenceReviewDecision,
  note?: string,
): Promise<CampaignIntelligenceRelease> {
  const { data, error } = await supabase.rpc("review_campaign_intelligence_release", {
    p_release_id: releaseId,
    p_decision: decision,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as CampaignIntelligenceRelease;
}
