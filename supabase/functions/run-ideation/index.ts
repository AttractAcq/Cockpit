// Thin production adapter for the dependency-injected Ideation request handler.
// The only writes remain Ideation cycles, dedicated technique runs, bounded
// research, needs-review candidates, and activity records.

import { svc } from "../_shared/aa.ts";
import { hasAnthropicKey, isAiEnabled } from "../_shared/anthropic.ts";
import {
  loadApprovedClientAuthority,
  type ApprovedClientAuthority,
} from "../_shared/client-authority.ts";
import {
  buildAuthorityConfigurationSnapshot,
  buildExecutionEvidenceSources,
} from "../_shared/ideation/authority-evidence.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { IDEATION_MODEL_CONFIGURATION, IDEATION_TECHNIQUE_MANIFEST } from "../_shared/ideation/config.ts";
import {
  buildIdeationConfigurationSnapshot,
  hashIdeationConfiguration,
} from "../_shared/ideation/configuration.ts";
import { generateTechniqueCandidates } from "../_shared/ideation/model.ts";
import {
  deriveIdeationQuantityPlan,
  resolveIdeationPeriod,
} from "../_shared/ideation/period.ts";
import { loadIdeationStrategicInputs } from "../_shared/ideation/strategic-inputs.ts";
import { runAllTechniqueModules } from "../_shared/ideation/techniques/index.ts";
import {
  createRunIdeationHandler,
  type IdeationPersistence,
  type RunBundle,
} from "./handler.ts";

function createProductionPersistence(): IdeationPersistence {
  const sb = svc();

  async function fetchRunBundle(cycleId: string): Promise<RunBundle> {
    const [cycleResult, runsResult, researchResult, candidatesResult] = await Promise.all([
      sb.from("client_ideation_cycles").select("*").eq("id", cycleId).single(),
      sb.from("client_ideation_technique_runs").select("*").eq("ideation_cycle_id", cycleId).order("technique_order"),
      sb.from("client_ideation_research_results").select("*").eq("ideation_cycle_id", cycleId).order("created_at"),
      sb.from("client_ideation_candidates").select("*").eq("ideation_cycle_id", cycleId).order("created_at"),
    ]);
    const error = cycleResult.error ?? runsResult.error ?? researchResult.error ?? candidatesResult.error;
    if (error || !cycleResult.data) throw new Error(error?.message ?? "Could not load Ideation run.");
    const techniques = new Map(IDEATION_TECHNIQUE_MANIFEST.map((technique) => [technique.slug, technique]));
    const research = new Map((researchResult.data ?? []).map((row) => [row.id, row]));
    const runs = new Map((runsResult.data ?? []).map((row) => [row.id, row]));
    return {
      run: cycleResult.data,
      technique_runs: runsResult.data ?? [],
      research_results: researchResult.data ?? [],
      candidates: (candidatesResult.data ?? []).map((candidate) => ({
        ...candidate,
        technique: techniques.get(runs.get(candidate.technique_run_id)?.technique_slug) ?? null,
        technique_run: runs.get(candidate.technique_run_id) ?? null,
        research_result: research.get(candidate.research_result_id) ?? null,
      })),
    };
  }

  return {
    context: sb,
    beginRun: (args) => sb.rpc("begin_ideation_run", args),
    renewLease: (args) => sb.rpc("renew_ideation_run_lease", args),
    completeRun: (args) => sb.rpc("complete_ideation_run", args),
    failRun: (args) => sb.rpc("fail_ideation_run", args),
    recordIntelligenceConsumption: (args) => sb.rpc("record_intelligence_consumption", args),
    recordAuthorityInputs: async (args) => {
      const rows = ((args.p_inputs as Array<Record<string, unknown>> | undefined) ?? []).map((row) => ({
        ...row,
        client_id: args.p_client_id,
        ideation_cycle_id: args.p_cycle_id,
      }));
      if (rows.length === 0) return { data: { inserted: 0 }, error: null };
      const { error } = await sb.from("client_ideation_authority_inputs").upsert(rows, {
        onConflict: "ideation_cycle_id,source_url",
        ignoreDuplicates: true,
      });
      return error ? { data: null, error } : { data: { inserted: rows.length }, error: null };
    },
    fetchRunBundle,
  };
}

export const handleRunIdeationRequest = createRunIdeationHandler({
  authorize: validateIdeationAccess,
  aiConfigured: () => isAiEnabled() && hasAnthropicKey(),
  createPersistence: createProductionPersistence,
  loadAuthority: async (persistence, clientId, executionMonths) => {
    return await loadApprovedClientAuthority(
      persistence.context as ReturnType<typeof svc>,
      clientId,
      executionMonths,
    );
  },
  resolvePeriod: resolveIdeationPeriod,
  deriveQuantityPlan: (period, result) =>
    deriveIdeationQuantityPlan(
      period,
      (result.authority as unknown as ApprovedClientAuthority).executionFilesByMonth,
    ),
  buildAuthoritySnapshot: (result) =>
    buildAuthorityConfigurationSnapshot(result.authority as unknown as ApprovedClientAuthority),
  buildConfigurationSnapshot: buildIdeationConfigurationSnapshot,
  hashConfiguration: hashIdeationConfiguration,
  runTechniqueModules: (result) =>
    runAllTechniqueModules(result.authority as unknown as ApprovedClientAuthority),
  buildExecutionEvidenceSources: (result) =>
    buildExecutionEvidenceSources(result.authority as unknown as ApprovedClientAuthority),
  buildStrategicInputEvidenceSources: (persistence, clientId, sourceKinds) =>
    loadIdeationStrategicInputs(persistence.context as ReturnType<typeof svc>, clientId, { sourceKinds }),
  generateTechniqueCandidates,
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
  selectedModel: () =>
    Deno.env.get(IDEATION_MODEL_CONFIGURATION.primary_model_env)
      ?? Deno.env.get(IDEATION_MODEL_CONFIGURATION.fallback_model_env)
      ?? IDEATION_MODEL_CONFIGURATION.fallback_model,
});

Deno.serve(handleRunIdeationRequest);
