// Ideation Stage 4 — dependency-injected commit request handler.
//
// There is NO model call here. This handler authenticates, loads every material
// input server-side, runs a read-only eligibility preflight, and then invokes
// exactly one atomic RPC that performs the whole operational write.
//
// It never creates a production brief, an asset, a Reel Studio project, a
// distribution record, an analytics record, or anything in ads_master.

import {
  buildCommitConfigurationSnapshot,
  buildCommitIdempotencyKey,
  hashCommitConfiguration,
} from "../_shared/ideation/commit/configuration.ts";
import {
  evaluateCommitEligibility,
  type CommitCandidateRow,
  type CommitCycleRow,
  type CommitProposalRow,
  type CommitScoreRow,
  type CommitScoringRunRow,
  type CommitSlotRow,
} from "../_shared/ideation/commit/eligibility.ts";
import {
  IDEATION_COMMIT_MAPPING_VERSION,
  IDEATION_COMMIT_MODULE_VERSION,
  IDEATION_COMMIT_OUTPUT_SCHEMA_VERSION,
  IDEATION_COMMIT_REFERENCE_ALLOCATOR_VERSION,
  IDEATION_COMMIT_TARGET_MANIFEST_VERSION,
} from "../_shared/ideation/commit/targets.ts";

const FUNCTION_NAME = "commit-ideation-content";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const IDEATION_COMMIT_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Only a genuinely transient infrastructure fault is retryable. Every integrity
 * failure is permanent for this configuration: retrying it would either fail
 * identically or, worse, invite an operator to keep clicking through a real
 * data problem.
 */
const RETRYABLE_COMMIT_CODES = new Set([
  "COMMIT_PERSISTENCE_FAILED",
  "COMMIT_TRANSACTION_UNAVAILABLE",
]);

export function isRetryableCommitFailure(code: string): boolean {
  return RETRYABLE_COMMIT_CODES.has(code);
}

/** Maps a raw database exception onto the typed Stage 4 failure contract. */
const DB_ERROR_CODES: Array<[string, string, number, string]> = [
  ["IDEATION_COMMIT_FORBIDDEN", "COMMIT_FORBIDDEN", 403, "This caller cannot commit Ideation content."],
  ["IDEATION_COMMIT_PROPOSAL_NOT_FOUND", "PROPOSAL_NOT_FOUND", 404, "The proposal could not be found."],
  ["IDEATION_COMMIT_PROPOSAL_SUPERSEDED", "PROPOSAL_SUPERSEDED", 409, "A newer approved proposal has superseded this one."],
  ["IDEATION_COMMIT_PROPOSAL_NOT_APPROVED", "PROPOSAL_NOT_APPROVED", 409, "Only an approved proposal can be committed."],
  ["IDEATION_COMMIT_PROPOSAL_REVISION_CONFLICT", "PROPOSAL_REVISION_CONFLICT", 409, "The proposal changed since this commit was prepared."],
  ["IDEATION_COMMIT_PROPOSAL_INCOMPLETE", "PROPOSAL_INCOMPLETE", 409, "The proposal is not fully assigned."],
  ["IDEATION_COMMIT_PROPOSAL_CONFLICTS_UNRESOLVED", "PROPOSAL_CONFLICTS_UNRESOLVED", 409, "The proposal still has an unresolved Calendar conflict."],
  ["IDEATION_COMMIT_PROPOSAL_SNAPSHOT_MISMATCH", "PROPOSAL_SNAPSHOT_MISMATCH", 409, "The proposal no longer matches its approved snapshot."],
  ["IDEATION_COMMIT_CYCLE_NOT_ELIGIBLE", "CYCLE_NOT_ELIGIBLE", 409, "The originating Ideation cycle is not eligible."],
  ["IDEATION_COMMIT_SCORING_RUN_NOT_ELIGIBLE", "SCORING_RUN_NOT_ELIGIBLE", 409, "The selected scoring run is not eligible."],
  ["IDEATION_COMMIT_AUTHORITY_SNAPSHOT_MISMATCH", "AUTHORITY_SNAPSHOT_MISMATCH", 409, "Approved authority changed after the proposal was approved."],
  ["IDEATION_COMMIT_CANDIDATE_SNAPSHOT_MISMATCH", "CANDIDATE_SNAPSHOT_MISMATCH", 409, "A candidate changed after the proposal was approved."],
  ["IDEATION_COMMIT_SCORE_SNAPSHOT_MISMATCH", "SCORE_SNAPSHOT_MISMATCH", 409, "A candidate score changed after the proposal was approved."],
  ["IDEATION_COMMIT_CALENDAR_SNAPSHOT_STALE", "CALENDAR_SNAPSHOT_STALE", 409, "The operational Calendar changed. Refresh conflicts and review again."],
  ["IDEATION_COMMIT_CALENDAR_CONFLICT", "CALENDAR_CONFLICT", 409, "An operational Calendar conflict blocks this commit."],
  ["IDEATION_COMMIT_UNSUPPORTED_ASSET_TYPE", "UNSUPPORTED_ASSET_TYPE", 409, "The proposal contains an asset type Stage 4 cannot commit."],
  ["IDEATION_COMMIT_MASTER_MAPPING_INVALID", "MASTER_MAPPING_INVALID", 409, "A proposal slot cannot be mapped to an operational master."],
  ["IDEATION_COMMIT_REQUIRED_FIELD_MISSING", "REQUIRED_FIELD_MISSING", 409, "A required operational field could not be derived."],
  ["IDEATION_COMMIT_REFERENCE_ALLOCATION_FAILED", "REFERENCE_ALLOCATION_FAILED", 409, "An operational reference could not be allocated."],
  ["IDEATION_COMMIT_RECONCILIATION_FAILED", "RECONCILIATION_FAILED", 500, "The commit did not reconcile exactly and was rolled back."],
];

export interface CommitFailureClassification {
  code: string;
  status: number;
  message: string;
  slotKey: string | null;
}

export function classifyCommitDatabaseError(raw: string): CommitFailureClassification {
  for (const [marker, code, status, message] of DB_ERROR_CODES) {
    if (raw.includes(marker)) {
      const detail = raw.slice(raw.indexOf(marker) + marker.length);
      const slot = detail.match(/([0-9]{4}-[0-9]{2}-[0-9]{2}:[a-z]+:[0-9]+)/);
      return { code, status, message, slotKey: slot ? slot[1] : null };
    }
  }
  if (raw.includes("could not serialize") || raw.includes("deadlock detected")) {
    return {
      code: "CONCURRENT_COMMIT_CONFLICT",
      status: 409,
      message: "Another commit for this proposal was in progress. Reload and check the result.",
      slotKey: null,
    };
  }
  // Anything unrecognised is reported as a generic persistence failure. The raw
  // database text is never returned to the caller.
  return {
    code: "COMMIT_PERSISTENCE_FAILED",
    status: 500,
    message: "The commit could not be completed and was rolled back.",
    slotKey: null,
  };
}

interface RpcError {
  message: string;
}

export interface RpcResult<T = unknown> {
  data: T | null;
  error: RpcError | null;
}

export interface CommitBundle {
  run: Record<string, unknown> & { id: string; status: string };
  items: Array<Record<string, unknown>>;
}

export interface CommitPersistence {
  loadProposalBundle(clientId: string, proposalId: string): Promise<{
    proposal: CommitProposalRow | null;
    slots: CommitSlotRow[];
    supersededByCount: number;
  }>;
  loadCycle(cycleId: string): Promise<CommitCycleRow | null>;
  loadScoringRun(scoringRunId: string): Promise<CommitScoringRunRow | null>;
  loadCandidates(cycleId: string): Promise<CommitCandidateRow[]>;
  loadScores(scoringRunId: string): Promise<CommitScoreRow[]>;
  loadAuthorityIdentities(clientId: string): Promise<Array<{
    id: string;
    version: number;
    classification: string;
    hash: string;
  }>>;
  currentCalendarDigest(clientId: string, periodStart: string, periodEnd: string): Promise<string>;
  findCompletedCommitRun(proposalId: string): Promise<string | null>;
  commitContent(args: Record<string, unknown>): Promise<RpcResult<{ replayed: boolean; commit_run_id: string }>>;
  recordFailure(args: Record<string, unknown>): Promise<RpcResult>;
  logReplay(args: Record<string, unknown>): Promise<RpcResult>;
  fetchCommitBundle(commitRunId: string): Promise<CommitBundle>;
}

type AccessResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: number; code: string; message: string };

export interface CommitDependencies {
  authorize(authorizationHeader: string | null, clientId: string): Promise<AccessResult>;
  createPersistence(): CommitPersistence;
  /**
   * Re-reconstructs the proposal's recorded authority against the live approved
   * files. This is the same mechanism Stages 2 and 3 use, reused rather than
   * reimplemented, so a Stage 4 commit cannot pass on authority that has since
   * been edited, superseded, or unapproved.
   */
  verifyAuthority(input: {
    clientId: string;
    authoritySnapshot: Record<string, unknown>;
  }): Promise<{ ok: true } | { ok: false; message: string }>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...IDEATION_COMMIT_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function safeMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return raw
    .split(/\r?\n/, 1)[0]
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\b/g, "[redacted-token]")
    .replace(/\b(?:SUPABASE_SERVICE_ROLE_KEY|service[_ -]?role key)\b[^,;]*/gi, "[redacted-service-credential]")
    .slice(0, 1000);
}

/** The complete typed failure payload. Never carries raw SQL or a stack trace. */
export function commitFailurePayload(input: {
  code: string;
  message: string;
  proposalId: string | null;
  commitRunId?: string | null;
  cycleId?: string | null;
  scoringRunId?: string | null;
  commitStatus?: string | null;
  expectedItemCount?: number;
  committedItemCount?: number;
  organicItemCount?: number;
  storyItemCount?: number;
  failedItemCount?: number;
  currentEditRevision?: number | null;
  failedProposalSlotKey?: string | null;
  warnings?: unknown[];
  details?: Record<string, unknown>;
}) {
  return {
    code: input.code,
    message: input.message,
    retryable: isRetryableCommitFailure(input.code),
    commit_run_id: input.commitRunId ?? null,
    proposal_id: input.proposalId,
    ideation_cycle_id: input.cycleId ?? null,
    scoring_run_id: input.scoringRunId ?? null,
    commit_status: input.commitStatus ?? null,
    expected_item_count: input.expectedItemCount ?? 0,
    committed_item_count: input.committedItemCount ?? 0,
    organic_item_count: input.organicItemCount ?? 0,
    story_item_count: input.storyItemCount ?? 0,
    failed_item_count: input.failedItemCount ?? 0,
    current_edit_revision: input.currentEditRevision ?? null,
    failed_proposal_slot_key: input.failedProposalSlotKey ?? null,
    warnings: input.warnings ?? [],
    details: input.details ?? null,
  };
}

const ALLOWED_BODY_KEYS = new Set([
  "client_id",
  "proposal_id",
  "expected_edit_revision",
  "confirm_commit",
]);

export function createCommitHandler(deps: CommitDependencies) {
  return async function handleCommitRequest(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers: IDEATION_COMMIT_CORS_HEADERS });
    if (req.method !== "POST") {
      return json({
        ok: false,
        function: FUNCTION_NAME,
        committed: false,
        error: commitFailurePayload({ code: "MALFORMED_REQUEST", message: "POST is required.", proposalId: null }),
      }, 405);
    }

    // Authentication happens before any body processing beyond reading the two
    // identifiers needed to scope the access check.
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return json({
        ok: false,
        function: FUNCTION_NAME,
        committed: false,
        error: commitFailurePayload({
          code: "MALFORMED_REQUEST",
          message: "The request body must be a JSON object.",
          proposalId: null,
        }),
      }, 400);
    }

    for (const key of Object.keys(body)) {
      if (!ALLOWED_BODY_KEYS.has(key)) {
        return json({
          ok: false,
          function: FUNCTION_NAME,
          committed: false,
          error: commitFailurePayload({
            code: "MALFORMED_REQUEST",
            message: `The request contains the unexpected field ${key}.`,
            proposalId: null,
          }),
        }, 400);
      }
    }

    const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id.trim() : "";
    if (!UUID_PATTERN.test(clientId) || !UUID_PATTERN.test(proposalId)) {
      return json({
        ok: false,
        function: FUNCTION_NAME,
        committed: false,
        error: commitFailurePayload({
          code: "MALFORMED_REQUEST",
          message: "A valid client_id and proposal_id are required.",
          proposalId: null,
        }),
      }, 400);
    }

    const access = await deps.authorize(req.headers.get("Authorization"), clientId);
    if (!access.ok) {
      return json({
        ok: false,
        function: FUNCTION_NAME,
        committed: false,
        error: commitFailurePayload({
          code: access.code === "CLIENT_ACCESS_DENIED" ? "FORBIDDEN_CLIENT" : access.code,
          message: access.message,
          proposalId,
        }),
      }, access.status);
    }

    const expectedEditRevision = body.expected_edit_revision;
    if (typeof expectedEditRevision !== "number" || !Number.isInteger(expectedEditRevision) || expectedEditRevision < 0) {
      return json({
        ok: false,
        function: FUNCTION_NAME,
        committed: false,
        error: commitFailurePayload({
          code: "MALFORMED_REQUEST",
          message: "An integer expected_edit_revision is required.",
          proposalId,
        }),
      }, 400);
    }
    if (body.confirm_commit !== true) {
      return json({
        ok: false,
        function: FUNCTION_NAME,
        committed: false,
        error: commitFailurePayload({
          code: "COMMIT_NOT_CONFIRMED",
          message: "An explicit confirmation is required to commit content.",
          proposalId,
        }),
      }, 400);
    }

    const persistence = deps.createPersistence();

    try {
      const { proposal, slots, supersededByCount } = await persistence.loadProposalBundle(clientId, proposalId);
      if (!proposal) {
        return json({
          ok: false,
          function: FUNCTION_NAME,
          committed: false,
          error: commitFailurePayload({
            code: "PROPOSAL_NOT_FOUND",
            message: "The proposal could not be found.",
            proposalId,
          }),
        }, 404);
      }

      // A completed commit replays as a SUCCESS, before eligibility is judged:
      // a proposal that already produced content is not an error to report.
      const completedRunId = await persistence.findCompletedCommitRun(proposalId);
      if (completedRunId) {
        await persistence.logReplay({
          p_client_id: clientId,
          p_commit_run_id: completedRunId,
          p_actor_id: access.userId,
        });
        const bundle = await persistence.fetchCommitBundle(completedRunId);
        return json({
          ok: true,
          function: FUNCTION_NAME,
          committed: true,
          replayed: true,
          commit_run_id: completedRunId,
          commit: bundle.run,
          items: bundle.items,
          message: "This proposal was already committed; the existing result was returned.",
        });
      }

      const [cycle, scoringRun, candidates, scores, authorityIdentities] = await Promise.all([
        persistence.loadCycle(proposal.ideation_cycle_id),
        persistence.loadScoringRun(proposal.scoring_run_id),
        persistence.loadCandidates(proposal.ideation_cycle_id),
        persistence.loadScores(proposal.scoring_run_id),
        persistence.loadAuthorityIdentities(clientId),
      ]);

      const currentCalendarDigest = await persistence.currentCalendarDigest(
        clientId,
        proposal.period_start,
        proposal.period_end,
      );

      const authorityVerification = await deps.verifyAuthority({
        clientId,
        authoritySnapshot: proposal.authority_snapshot ?? {},
      });

      const eligibility = evaluateCommitEligibility({
        clientId,
        expectedEditRevision,
        proposal,
        slots,
        cycle,
        scoringRun,
        candidates,
        scores,
        supersededByCount,
        completedCommitRunId: null,
        currentCalendarDigest,
        authorityVerification,
      });

      if (!eligibility.ok) {
        return json({
          ok: false,
          function: FUNCTION_NAME,
          committed: false,
          error: commitFailurePayload({
            code: eligibility.code,
            message: eligibility.message,
            proposalId,
            cycleId: proposal.ideation_cycle_id,
            scoringRunId: proposal.scoring_run_id,
            expectedItemCount: proposal.expected_slot_count,
            currentEditRevision: proposal.edit_revision,
            details: eligibility.details,
          }),
        }, eligibility.code === "PROPOSAL_NOT_FOUND" ? 404 : 409);
      }

      const snapshot = buildCommitConfigurationSnapshot({
        clientId,
        cycle: cycle!,
        scoringRun: scoringRun!,
        proposal,
        slots: eligibility.slots,
        authorityIdentities,
        currentCalendarDigest,
      });
      const configurationHash = await hashCommitConfiguration(snapshot);
      const idempotencyKey = buildCommitIdempotencyKey({ proposalId, configurationHash });

      const result = await persistence.commitContent({
        p_client_id: clientId,
        p_proposal_id: proposalId,
        p_expected_edit_revision: expectedEditRevision,
        p_actor_id: access.userId,
        p_configuration_hash: configurationHash,
        p_commit_input_snapshot: snapshot,
        p_calendar_digest: currentCalendarDigest,
        p_idempotency_key: idempotencyKey,
        p_target_manifest_version: IDEATION_COMMIT_TARGET_MANIFEST_VERSION,
        p_mapping_version: IDEATION_COMMIT_MAPPING_VERSION,
        p_reference_allocator_version: IDEATION_COMMIT_REFERENCE_ALLOCATOR_VERSION,
        p_output_schema_version: IDEATION_COMMIT_OUTPUT_SCHEMA_VERSION,
        p_module_version: IDEATION_COMMIT_MODULE_VERSION,
      });

      if (result.error || !result.data) {
        const classification = classifyCommitDatabaseError(result.error?.message ?? "");
        // The transaction has already rolled back; this only records the attempt.
        await persistence.recordFailure({
          p_client_id: clientId,
          p_proposal_id: proposalId,
          p_actor_id: access.userId,
          p_failure_code: classification.code,
          p_failure_message: classification.message,
          p_failed_proposal_slot_key: classification.slotKey,
          p_configuration_hash: configurationHash,
          p_calendar_digest: currentCalendarDigest,
          p_idempotency_key: idempotencyKey,
          p_target_manifest_version: IDEATION_COMMIT_TARGET_MANIFEST_VERSION,
          p_mapping_version: IDEATION_COMMIT_MAPPING_VERSION,
          p_reference_allocator_version: IDEATION_COMMIT_REFERENCE_ALLOCATOR_VERSION,
          p_output_schema_version: IDEATION_COMMIT_OUTPUT_SCHEMA_VERSION,
          p_module_version: IDEATION_COMMIT_MODULE_VERSION,
        }).catch(() => undefined);

        return json({
          ok: false,
          function: FUNCTION_NAME,
          committed: false,
          error: commitFailurePayload({
            code: classification.code,
            message: classification.message,
            proposalId,
            cycleId: proposal.ideation_cycle_id,
            scoringRunId: proposal.scoring_run_id,
            commitStatus: "failed",
            expectedItemCount: proposal.expected_slot_count,
            currentEditRevision: proposal.edit_revision,
            failedProposalSlotKey: classification.slotKey,
          }),
        }, classification.status);
      }

      const bundle = await persistence.fetchCommitBundle(result.data.commit_run_id);
      return json({
        ok: true,
        function: FUNCTION_NAME,
        committed: true,
        replayed: result.data.replayed === true,
        commit_run_id: result.data.commit_run_id,
        commit: bundle.run,
        items: bundle.items,
        message: result.data.replayed
          ? "This proposal was already committed; the existing result was returned."
          : "Operational Content and Calendar records were created. They enter the normal review workflow.",
      });
    } catch (error) {
      return json({
        ok: false,
        function: FUNCTION_NAME,
        committed: false,
        error: commitFailurePayload({
          code: "COMMIT_PERSISTENCE_FAILED",
          message: safeMessage(error),
          proposalId,
        }),
      }, 500);
    }
  };
}
