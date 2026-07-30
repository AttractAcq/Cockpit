// Thin production adapter for the Stage 4 commit handler.
//
// calendar_cells is READ here only to recompute the current occupancy digest.
// Every operational INSERT happens inside the one atomic RPC, never from here.
// No Anthropic or OpenAI module is imported anywhere in this function.

import { svc } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { reconstructScoringAuthority } from "../_shared/ideation/scoring/authority.ts";
import { buildCalendarConflictSnapshot } from "../_shared/ideation/proposal/conflicts.ts";
import { sha256 } from "../_shared/ideation/hash.ts";
import { createCommitHandler, type CommitBundle, type CommitPersistence } from "./handler.ts";

function createProductionPersistence(): CommitPersistence {
  const sb = svc();

  return {
    async loadProposalBundle(clientId, proposalId) {
      const [proposalResult, slotsResult, supersededResult] = await Promise.all([
        sb.from("client_ideation_calendar_proposals").select("*")
          .eq("id", proposalId).eq("client_id", clientId).maybeSingle(),
        sb.from("client_ideation_calendar_proposal_slots").select("*")
          .eq("proposal_id", proposalId)
          .order("proposed_date", { ascending: true })
          .order("proposal_slot_key", { ascending: true }),
        sb.from("client_ideation_calendar_proposals").select("id", { count: "exact", head: true })
          .eq("supersedes_proposal_id", proposalId).eq("client_id", clientId).neq("status", "failed"),
      ]);
      const error = proposalResult.error ?? slotsResult.error ?? supersededResult.error;
      if (error) throw new Error(error.message);
      return {
        proposal: proposalResult.data ?? null,
        slots: slotsResult.data ?? [],
        supersededByCount: supersededResult.count ?? 0,
      };
    },

    async loadCycle(cycleId) {
      const { data, error } = await sb.from("client_ideation_cycles").select("*").eq("id", cycleId).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async loadScoringRun(scoringRunId) {
      const { data, error } = await sb.from("client_ideation_scoring_runs").select("*")
        .eq("id", scoringRunId).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async loadCandidates(cycleId) {
      const { data, error } = await sb.from("client_ideation_candidates")
        .select("id, client_id, ideation_cycle_id, asset_type, working_title, hook, core_message, psychological_angle, cta, input_hash")
        .eq("ideation_cycle_id", cycleId);
      if (error) throw new Error(error.message);
      return data ?? [];
    },

    async loadScores(scoringRunId) {
      const { data, error } = await sb.from("client_ideation_candidate_scores")
        .select("id, client_id, scoring_run_id, candidate_id, rank, overall_score, candidate_content_hash")
        .eq("scoring_run_id", scoringRunId);
      if (error) throw new Error(error.message);
      return data ?? [];
    },

    async loadAuthorityIdentities(clientId) {
      const [contextResult, executionResult] = await Promise.all([
        sb.from("client_context_files").select("id, version, content_md")
          .eq("client_id", clientId).eq("status", "approved"),
        sb.from("client_execution_files").select("id, version, content_md")
          .eq("client_id", clientId).eq("review_state", "approved"),
      ]);
      const error = contextResult.error ?? executionResult.error;
      if (error) throw new Error(error.message);
      const rows = [
        ...(contextResult.data ?? []).map((row) => ({ ...row, classification: "context" })),
        ...(executionResult.data ?? []).map((row) => ({ ...row, classification: "execution" })),
      ];
      // Only bounded identities are kept — never an authority body.
      return await Promise.all(rows.map(async (row) => ({
        id: String(row.id),
        version: Number(row.version ?? 0),
        classification: row.classification,
        hash: await sha256(String(row.content_md ?? "")),
      })));
    },

    async currentCalendarDigest(clientId, periodStart, periodEnd) {
      // READ ONLY, bounded projection — identical to the Stage 3 snapshot, so
      // the digests are directly comparable.
      const { data, error } = await sb
        .from("calendar_cells")
        .select("id, date, row_type, ref, review_state, updated_at")
        .eq("client_id", clientId)
        .gte("date", periodStart)
        .lte("date", periodEnd)
        .order("date");
      if (error) throw new Error(error.message);
      const snapshot = await buildCalendarConflictSnapshot({
        periodStart,
        periodEnd,
        rows: data ?? [],
      });
      return snapshot.digest;
    },

    async findCompletedCommitRun(proposalId) {
      const { data, error } = await sb.from("client_ideation_commit_runs").select("id")
        .eq("proposal_id", proposalId).eq("status", "completed").maybeSingle();
      if (error) throw new Error(error.message);
      return data?.id ? String(data.id) : null;
    },

    commitContent: (args) => sb.rpc("commit_ideation_content", args),
    recordFailure: (args) => sb.rpc("record_ideation_commit_failure", args),
    logReplay: (args) => sb.rpc("log_ideation_commit_replay", args),

    async fetchCommitBundle(commitRunId): Promise<CommitBundle> {
      const [runResult, itemsResult] = await Promise.all([
        sb.from("client_ideation_commit_runs").select("*").eq("id", commitRunId).single(),
        sb.from("client_ideation_commit_items").select("*")
          .eq("commit_run_id", commitRunId)
          .order("committed_date", { ascending: true })
          .order("operational_ref", { ascending: true }),
      ]);
      const error = runResult.error ?? itemsResult.error;
      if (error || !runResult.data) throw new Error(error?.message ?? "Could not load the commit run.");
      return { run: runResult.data, items: itemsResult.data ?? [] };
    },
  };
}

export const handleCommitIdeationContentRequest = createCommitHandler({
  authorize: validateIdeationAccess,
  createPersistence: createProductionPersistence,
  async verifyAuthority({ clientId, authoritySnapshot }) {
    const sb = svc();
    const [contextResult, executionResult] = await Promise.all([
      sb.from("client_context_files")
        .select("id, file_number, file_name, version, content_md")
        .eq("client_id", clientId).eq("status", "approved"),
      sb.from("client_execution_files")
        .select("id, file_number, file_name, version, content_md, month")
        .eq("client_id", clientId).eq("review_state", "approved"),
    ]);
    const error = contextResult.error ?? executionResult.error;
    if (error) return { ok: false as const, message: "Approved authority could not be re-verified." };

    // Reused verbatim from Stage 2/3: every recorded authority file must still
    // exist, still be approved, and still match its recorded version and
    // content hash. Anything else is drift and fails the commit closed.
    const result = await reconstructScoringAuthority({
      clientId,
      configurationSnapshot: { authority: authoritySnapshot },
      contextRows: contextResult.data ?? [],
      executionRows: executionResult.data ?? [],
    });
    return result.ok
      ? { ok: true as const }
      : { ok: false as const, message: result.message };
  },
});

Deno.serve(handleCommitIdeationContentRequest);
