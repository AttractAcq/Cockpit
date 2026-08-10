import { invokeFn, supabase } from "@/lib/supabase";
import type {
  FinalizeMarketOSResponse,
  IntelligenceDomain,
  IntelligenceEvidence,
  IntelligenceFinding,
  IntelligenceFreshness,
  IntelligenceRecord,
  IntelligenceRefreshPolicy,
  IntelligenceRelease,
  IntelligenceResearchRun,
  IntelligenceResearchStep,
  IntelligenceReviewDecision,
  IntelligenceSource,
  IntelligenceWorkspace,
  PrepareMarketOSResponse,
  RunMarketOSStepResponse,
} from "@/types/intelligence";

function freshnessFor(
  release: IntelligenceRelease | null,
  policy: IntelligenceRefreshPolicy | null,
  now = new Date(),
): { freshness: IntelligenceFreshness; nextRefreshAt: string | null } {
  const authorityDate = release?.approved_at ?? release?.generated_at;
  if (!authorityDate || !policy) return { freshness: "not_available", nextRefreshAt: null };
  const next = new Date(authorityDate);
  next.setUTCDate(next.getUTCDate() + policy.refresh_interval_days);
  const warning = new Date(next);
  warning.setUTCDate(warning.getUTCDate() - policy.due_warning_days);
  return {
    freshness: now >= next ? "stale" : now >= warning ? "due" : "fresh",
    nextRefreshAt: next.toISOString(),
  };
}

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

export async function fetchIntelligenceWorkspace(
  clientId: string,
  domain: IntelligenceDomain,
): Promise<IntelligenceWorkspace> {
  const [latestRelease, activePointer, latestRun, policy] = await Promise.all([
    maybeSingle<IntelligenceRelease>(supabase.from("client_intelligence_releases")
      .select("*").eq("client_id", clientId).eq("intelligence_domain", domain)
      .order("version", { ascending: false }).limit(1).maybeSingle()),
    maybeSingle<{ release_id: string }>(supabase.from("client_intelligence_active_releases")
      .select("release_id").eq("client_id", clientId).eq("intelligence_domain", domain).maybeSingle()),
    maybeSingle<IntelligenceResearchRun>(supabase.from("client_research_runs")
      .select("*").eq("client_id", clientId).eq("intelligence_domain", domain)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()),
    maybeSingle<IntelligenceRefreshPolicy>(supabase.from("client_intelligence_refresh_policies")
      .select("*").eq("client_id", clientId).eq("intelligence_domain", domain).maybeSingle()),
  ]);

  const activeRelease = activePointer?.release_id === latestRelease?.id
    ? latestRelease
    : activePointer
      ? await maybeSingle<IntelligenceRelease>(supabase.from("client_intelligence_releases")
        .select("*").eq("id", activePointer.release_id).eq("client_id", clientId).maybeSingle())
      : null;

  const releaseForWorkspace = latestRelease ?? activeRelease;
  const [steps, records, releaseFindingLinks, sources, costEvents] = await Promise.all([
    latestRun
      ? rows<IntelligenceResearchStep>(supabase.from("client_research_steps")
        .select("*").eq("client_id", clientId).eq("research_run_id", latestRun.id).order("step_order"))
      : Promise.resolve([]),
    releaseForWorkspace
      ? rows<IntelligenceRecord>(supabase.from("client_intelligence_records")
        .select("*").eq("client_id", clientId).eq("release_id", releaseForWorkspace.id).order("display_order"))
      : Promise.resolve([]),
    releaseForWorkspace
      ? rows<{ finding_id: string }>(supabase.from("client_intelligence_release_findings")
        .select("finding_id").eq("client_id", clientId).eq("release_id", releaseForWorkspace.id))
      : Promise.resolve([]),
    latestRun
      ? rows<IntelligenceSource>(supabase.from("client_research_sources")
        .select("id,client_id,research_run_id,url,canonical_url,title,publisher,retrieved_at,source_type,source_quality,inspectable,use_restriction")
        .eq("client_id", clientId).eq("research_run_id", latestRun.id).order("retrieved_at", { ascending: false }))
      : Promise.resolve([]),
    latestRun
      ? rows<{ input_units: number; output_units: number; tool_calls: number; amount_microunits: number | null; currency: string | null }>(
        supabase.from("client_research_cost_events")
          .select("input_units,output_units,tool_calls,amount_microunits,currency")
          .eq("client_id", clientId).eq("research_run_id", latestRun.id),
      )
      : Promise.resolve([]),
  ]);

  const findingIds = releaseFindingLinks.map((link) => link.finding_id);
  const findings = findingIds.length > 0
    ? await rows<IntelligenceFinding>(supabase.from("client_intelligence_findings")
      .select("*").eq("client_id", clientId).in("id", findingIds).order("created_at"))
    : [];

  const findingEvidenceLinks = findingIds.length > 0
    ? await rows<{ evidence_id: string }>(supabase.from("client_intelligence_finding_evidence")
      .select("evidence_id").eq("client_id", clientId).in("finding_id", findingIds))
    : [];
  const evidenceIds = [...new Set(findingEvidenceLinks.map((link) => link.evidence_id))];
  const evidence = evidenceIds.length > 0
    ? await rows<IntelligenceEvidence>(supabase.from("client_evidence_records")
      .select("*").eq("client_id", clientId).in("id", evidenceIds).order("created_at"))
    : [];

  const freshness = freshnessFor(activeRelease, policy);
  const priced = costEvents.filter((event) => event.amount_microunits !== null);
  const currencies = new Set(priced.map((event) => event.currency).filter((value): value is string => Boolean(value)));
  return {
    domain,
    latestRelease,
    activeRelease,
    latestRun,
    steps,
    records,
    findings,
    evidence,
    sources,
    policy,
    usage: {
      inputUnits: costEvents.reduce((total, event) => total + event.input_units, 0),
      outputUnits: costEvents.reduce((total, event) => total + event.output_units, 0),
      toolCalls: costEvents.reduce((total, event) => total + event.tool_calls, 0),
      amountMicrounits: priced.length > 0 && currencies.size <= 1
        ? priced.reduce((total, event) => total + (event.amount_microunits ?? 0), 0)
        : null,
      currency: currencies.size === 1 ? [...currencies][0] : null,
    },
    ...freshness,
  };
}

export async function prepareMarketOS(clientId: string): Promise<PrepareMarketOSResponse> {
  return invokeFn<PrepareMarketOSResponse>("run-market-os", { action: "prepare", client_id: clientId });
}

export async function runMarketOSStep(
  clientId: string,
  researchRunId: string,
): Promise<RunMarketOSStepResponse> {
  return invokeFn<RunMarketOSStepResponse>("run-market-os", {
    action: "step",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function finalizeMarketOS(
  clientId: string,
  researchRunId: string,
): Promise<FinalizeMarketOSResponse> {
  return invokeFn<FinalizeMarketOSResponse>("run-market-os", {
    action: "finalize",
    client_id: clientId,
    research_run_id: researchRunId,
  });
}

export async function driveMarketOSBuild(
  clientId: string,
  onProgress?: (progress: RunMarketOSStepResponse["progress"]) => void,
): Promise<FinalizeMarketOSResponse> {
  const prepared = await prepareMarketOS(clientId);
  if (!prepared.ok || !prepared.research_run_id) throw new Error(prepared.message);
  for (let guard = 0; guard < 20; guard += 1) {
    const result = await runMarketOSStep(clientId, prepared.research_run_id);
    onProgress?.(result.progress);
    if (!result.ok && result.terminal) throw new Error(result.message);
    if (result.terminal) return finalizeMarketOS(clientId, prepared.research_run_id);
  }
  throw new Error("Market OS workflow exceeded its step guard.");
}

export async function reviewIntelligenceRelease(
  releaseId: string,
  decision: IntelligenceReviewDecision,
  note?: string,
): Promise<IntelligenceRelease> {
  const { data, error } = await supabase.rpc("review_intelligence_release", {
    p_release_id: releaseId,
    p_decision: decision,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as IntelligenceRelease;
}
