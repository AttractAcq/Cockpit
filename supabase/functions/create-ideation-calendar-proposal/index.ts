// Thin production adapter for the dependency-injected Stage 3 proposal handler.
//
// calendar_cells and the content masters are READ here for conflict detection
// only. There is no insert, update, upsert, or delete against any operational
// Calendar, master, brief, asset, distribution, or analytics table.

import { svc } from "../_shared/aa.ts";
import { hasAnthropicKey, isAiEnabled } from "../_shared/anthropic.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { reconstructScoringAuthority } from "../_shared/ideation/scoring/authority.ts";
import {
  buildProposalConfigurationSnapshot,
  hashProposalConfiguration,
  type ProposalConfigurationInput,
} from "../_shared/ideation/proposal/configuration.ts";
import { proposeAssignmentBatch, resolveProposalModel } from "../_shared/ideation/proposal/model.ts";
import {
  createProposalHandler,
  type ProposalBundle,
  type ProposalPersistence,
} from "./handler.ts";

function createProductionPersistence(): ProposalPersistence {
  const sb = svc();

  async function fetchProposalBundle(proposalId: string): Promise<ProposalBundle> {
    const [proposalResult, slotsResult] = await Promise.all([
      sb.from("client_ideation_calendar_proposals").select("*").eq("id", proposalId).single(),
      sb.from("client_ideation_calendar_proposal_slots").select("*")
        .eq("proposal_id", proposalId)
        .order("proposed_date", { ascending: true })
        .order("date_slot_ordinal", { ascending: true }),
    ]);
    const error = proposalResult.error ?? slotsResult.error;
    if (error || !proposalResult.data) throw new Error(error?.message ?? "Could not load the proposal.");
    return { proposal: proposalResult.data, slots: slotsResult.data ?? [] };
  }

  return {
    context: sb,
    async loadCycleBundle(cycleId) {
      const [cycleResult, runsResult, candidatesResult] = await Promise.all([
        sb.from("client_ideation_cycles").select("*").eq("id", cycleId).maybeSingle(),
        sb.from("client_ideation_technique_runs").select("*").eq("ideation_cycle_id", cycleId).order("technique_order"),
        sb.from("client_ideation_candidates").select("*").eq("ideation_cycle_id", cycleId).order("created_at"),
      ]);
      const error = cycleResult.error ?? runsResult.error ?? candidatesResult.error;
      if (error) throw new Error(error.message);
      return {
        cycle: cycleResult.data ?? null,
        techniqueRuns: runsResult.data ?? [],
        candidates: candidatesResult.data ?? [],
      };
    },
    async loadScoringRun(scoringRunId) {
      const [runResult, scoresResult] = await Promise.all([
        sb.from("client_ideation_scoring_runs").select("*").eq("id", scoringRunId).maybeSingle(),
        sb.from("client_ideation_candidate_scores").select("*").eq("scoring_run_id", scoringRunId),
      ]);
      const error = runResult.error ?? scoresResult.error;
      if (error) throw new Error(error.message);
      return { scoringRun: runResult.data ?? null, scores: scoresResult.data ?? [] };
    },
    async loadAuthorityRows(clientId) {
      const [contextResult, executionResult] = await Promise.all([
        sb.from("client_context_files")
          .select("id, file_number, file_name, version, content_md")
          .eq("client_id", clientId).eq("status", "approved"),
        sb.from("client_execution_files")
          .select("id, file_number, file_name, version, content_md, month")
          .eq("client_id", clientId).eq("review_state", "approved"),
      ]);
      const error = contextResult.error ?? executionResult.error;
      if (error) throw new Error(error.message);
      return { contextRows: contextResult.data ?? [], executionRows: executionResult.data ?? [] };
    },
    async loadCalendarOccupancy(clientId, periodStart, periodEnd) {
      // READ ONLY. Bounded projection: no content body is selected or stored.
      const { data, error } = await sb
        .from("calendar_cells")
        .select("id, date, row_type, ref, review_state, updated_at")
        .eq("client_id", clientId)
        .gte("date", periodStart)
        .lte("date", periodEnd)
        .order("date");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async clientName(clientId) {
      const { data, error } = await sb.from("clients").select("name").eq("id", clientId).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.name ?? "Client";
    },
    beginProposal: (args) => sb.rpc("begin_ideation_calendar_proposal", args),
    renewLease: (args) => sb.rpc("renew_ideation_proposal_lease", args),
    persistBatch: (args) => sb.rpc("persist_ideation_proposal_batch", args),
    completeProposal: (args) => sb.rpc("complete_ideation_calendar_proposal", args),
    failProposal: (args) => sb.rpc("fail_ideation_calendar_proposal", args),
    editAssignment: (args) => sb.rpc("edit_ideation_proposal_assignment", args),
    refreshConflicts: (args) => sb.rpc("refresh_ideation_proposal_conflicts", args),
    approveProposal: (args) => sb.rpc("approve_ideation_calendar_proposal", args),
    fetchProposalBundle,
    async assignedCandidateIds(proposalId) {
      const { data, error } = await sb
        .from("client_ideation_calendar_proposal_slots")
        .select("candidate_id")
        .eq("proposal_id", proposalId)
        .not("candidate_id", "is", null);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => String(row.candidate_id));
    },
  };
}

export const handleCreateProposalRequest = createProposalHandler({
  authorize: validateIdeationAccess,
  aiConfigured: () => isAiEnabled() && hasAnthropicKey(),
  createPersistence: createProductionPersistence,
  reconstructAuthority: async (input) => {
    const result = await reconstructScoringAuthority(input);
    return result.ok
      ? { ok: true as const, authority: result.authority }
      : { ok: false as const, code: result.code, message: result.message };
  },
  buildConfigurationSnapshot: (input) =>
    buildProposalConfigurationSnapshot(input as unknown as ProposalConfigurationInput),
  hashConfiguration: hashProposalConfiguration,
  proposeBatch: proposeAssignmentBatch,
  selectedModel: resolveProposalModel,
  randomUUID: () => crypto.randomUUID(),
});

Deno.serve(handleCreateProposalRequest);
