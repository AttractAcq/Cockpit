// Thin production adapter for the dependency-injected Stage 2 scoring handler.
// The only writes remain Ideation scoring runs, candidate scores, and activity
// records. No content master, Calendar, production, distribution, or analytics
// table is reachable from this function.

import { svc } from "../_shared/aa.ts";
import { hasAnthropicKey, isAiEnabled } from "../_shared/anthropic.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { reconstructScoringAuthority } from "../_shared/ideation/scoring/authority.ts";
import {
  buildScoringConfigurationSnapshot,
  fingerprintScoringCandidates,
  hashScoringConfiguration,
} from "../_shared/ideation/scoring/configuration.ts";
import { resolveScoringModel, scoreCandidateBatch } from "../_shared/ideation/scoring/model.ts";
import {
  createScoreIdeationHandler,
  type ScoringBundle,
  type ScoringPersistence,
} from "./handler.ts";

function createProductionPersistence(): ScoringPersistence {
  const sb = svc();

  async function fetchScoringBundle(scoringRunId: string): Promise<ScoringBundle> {
    const [runResult, scoresResult] = await Promise.all([
      sb.from("client_ideation_scoring_runs").select("*").eq("id", scoringRunId).single(),
      sb.from("client_ideation_candidate_scores").select("*").eq("scoring_run_id", scoringRunId)
        .order("rank", { ascending: true, nullsFirst: false }),
    ]);
    const error = runResult.error ?? scoresResult.error;
    if (error || !runResult.data) throw new Error(error?.message ?? "Could not load the scoring run.");
    return { scoring_run: runResult.data, scores: scoresResult.data ?? [] };
  }

  return {
    context: sb,
    async loadCycleBundle(clientId, cycleId) {
      const [cycleResult, runsResult, candidatesResult] = await Promise.all([
        sb.from("client_ideation_cycles").select("*").eq("id", cycleId).maybeSingle(),
        sb.from("client_ideation_technique_runs").select("*").eq("ideation_cycle_id", cycleId).order("technique_order"),
        sb.from("client_ideation_candidates").select("*").eq("ideation_cycle_id", cycleId).order("created_at"),
      ]);
      const error = cycleResult.error ?? runsResult.error ?? candidatesResult.error;
      if (error) throw new Error(error.message);
      // Client scoping is re-checked in eligibility; this read is by cycle id.
      void clientId;
      return {
        cycle: cycleResult.data ?? null,
        techniqueRuns: runsResult.data ?? [],
        candidates: candidatesResult.data ?? [],
      };
    },
    async loadAuthorityRows(clientId) {
      const [contextResult, executionResult] = await Promise.all([
        sb.from("client_context_files")
          .select("id, file_number, file_name, version, content_md")
          .eq("client_id", clientId)
          .eq("status", "approved"),
        sb.from("client_execution_files")
          .select("id, file_number, file_name, version, content_md, month")
          .eq("client_id", clientId)
          .eq("review_state", "approved"),
      ]);
      const error = contextResult.error ?? executionResult.error;
      if (error) throw new Error(error.message);
      return {
        contextRows: contextResult.data ?? [],
        executionRows: executionResult.data ?? [],
      };
    },
    beginRun: (args) => sb.rpc("begin_ideation_scoring_run", args),
    renewLease: (args) => sb.rpc("renew_ideation_scoring_lease", args),
    persistBatch: (args) => sb.rpc("persist_ideation_score_batch", args),
    completeRun: (args) => sb.rpc("complete_ideation_scoring_run", args),
    failRun: (args) => sb.rpc("fail_ideation_scoring_run", args),
    fetchScoringBundle,
    async scoredCandidateIds(scoringRunId) {
      const { data, error } = await sb
        .from("client_ideation_candidate_scores")
        .select("candidate_id")
        .eq("scoring_run_id", scoringRunId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => String(row.candidate_id));
    },
  };
}

export const handleScoreIdeationRequest = createScoreIdeationHandler({
  authorize: validateIdeationAccess,
  aiConfigured: () => isAiEnabled() && hasAnthropicKey(),
  createPersistence: createProductionPersistence,
  clientName: async (persistence, clientId) => {
    const sb = persistence.context as ReturnType<typeof svc>;
    const { data, error } = await sb.from("clients").select("name").eq("id", clientId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.name ?? "Client";
  },
  reconstructAuthority: async (input) => {
    const result = await reconstructScoringAuthority(input);
    return result.ok
      ? { ok: true as const, authority: result.authority }
      : { ok: false as const, code: result.code, message: result.message };
  },
  fingerprintCandidates: fingerprintScoringCandidates,
  buildConfigurationSnapshot: buildScoringConfigurationSnapshot,
  hashConfiguration: hashScoringConfiguration,
  scoreBatch: scoreCandidateBatch,
  selectedModel: resolveScoringModel,
  randomUUID: () => crypto.randomUUID(),
});

Deno.serve(handleScoreIdeationRequest);
