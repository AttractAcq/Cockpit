// Ideation Stage 3 — dependency-injected proposed-Calendar request handler.
//
// The only writes are Stage 3 proposals, Stage 3 proposal slots, and activity
// records. Nothing here writes calendar_cells, any content master, a production
// brief, an asset, distribution, or analytics. Approval is not a commit.

import {
  ideationProposalBatches,
  IDEATION_PROPOSAL_MAX_ATTEMPTS,
  IDEATION_PROPOSAL_MODULE_VERSION,
  IDEATION_PROPOSAL_OUTPUT_SCHEMA_VERSION,
} from "../_shared/ideation/proposal/config.ts";
import {
  evaluateProposalEligibility,
  type EligibleProposalCandidate,
  type ProposalCandidateRow,
  type ProposalCycleRow,
  type ProposalScoreRow,
  type ProposalScoringRunRow,
} from "../_shared/ideation/proposal/eligibility.ts";
import {
  buildCalendarConflictSnapshot,
  classifySlotConflicts,
  type CalendarConflictSnapshot,
  type CalendarOccupancyRow,
  type SlotConflict,
} from "../_shared/ideation/proposal/conflicts.ts";
import {
  IDEATION_SLOT_PLANNER_VERSION,
  parseScheduleContract,
  planIdeationProposalSlots,
  type ProposalSlot,
} from "../_shared/ideation/proposal/slot-planner.ts";
import { ideationCandidateDisplayReference } from "../_shared/ideation/proposal/reference.ts";
import type { ProposalCandidateFingerprint } from "../_shared/ideation/proposal/configuration.ts";
import type { ReconstructedScoringAuthority } from "../_shared/ideation/scoring/authority.ts";
import type { ValidatedProposalAssignment } from "../_shared/ideation/proposal/output.ts";
import {
  resolveIdeationProviderRuntime,
  type IdeationProviderRuntime,
} from "../_shared/ideation/provider-runtime.ts";
import { logIdeationLease } from "../_shared/ideation/telemetry.ts";

const FUNCTION_NAME = "create-ideation-calendar-proposal";
const PROVIDER = "anthropic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const IDEATION_PROPOSAL_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RETRYABLE_PROPOSAL_CODES = new Set([
  "ANTHROPIC_CONNECT_TIMEOUT",
  "ANTHROPIC_TIMEOUT",
  "ANTHROPIC_HTTP_ERROR",
  "ANTHROPIC_FETCH_ERROR",
  "ANTHROPIC_RESPONSE_INVALID",
  "ANTHROPIC_EMPTY_RESPONSE",
  "ANTHROPIC_TRUNCATED",
  "PROPOSAL_PERSISTENCE_FAILED",
]);

export function isRetryableProposalFailure(code: string): boolean {
  return RETRYABLE_PROPOSAL_CODES.has(code);
}

interface RpcError {
  message: string;
}

export interface RpcResult<T = unknown> {
  data: T | null;
  error: RpcError | null;
}

export interface ProposalBundle {
  proposal: Record<string, unknown> & { id: string; status: string };
  slots: Array<Record<string, unknown>>;
}

/** Every action this one public function accepts. */
export type ProposalAction =
  | "create"
  | "retry"
  | "regenerate"
  | "move"
  | "swap"
  | "unassign"
  | "assign"
  | "refresh_conflicts"
  | "approve";

export interface ProposalPersistence {
  readonly context?: unknown;
  loadCycleBundle(cycleId: string): Promise<{
    cycle: ProposalCycleRow | null;
    techniqueRuns: Array<{ id: string; client_id: string; ideation_cycle_id: string; technique_slug: string }>;
    candidates: ProposalCandidateRow[];
  }>;
  loadScoringRun(scoringRunId: string): Promise<{
    scoringRun: ProposalScoringRunRow | null;
    scores: ProposalScoreRow[];
  }>;
  loadAuthorityRows(clientId: string): Promise<{
    contextRows: Array<{ id: string; file_number: number; file_name: string; version: number; content_md: string }>;
    executionRows: Array<{ id: string; file_number: number; file_name: string; version: number; content_md: string; month?: string }>;
  }>;
  loadCalendarOccupancy(clientId: string, periodStart: string, periodEnd: string): Promise<CalendarOccupancyRow[]>;
  clientName(clientId: string): Promise<string>;
  beginProposal(args: Record<string, unknown>): Promise<RpcResult>;
  renewLease(args: Record<string, unknown>): Promise<RpcResult>;
  persistBatch(args: Record<string, unknown>): Promise<RpcResult>;
  completeProposal(args: Record<string, unknown>): Promise<RpcResult>;
  failProposal(args: Record<string, unknown>): Promise<RpcResult>;
  editAssignment(args: Record<string, unknown>): Promise<RpcResult>;
  refreshConflicts(args: Record<string, unknown>): Promise<RpcResult>;
  approveProposal(args: Record<string, unknown>): Promise<RpcResult>;
  fetchProposalBundle(proposalId: string): Promise<ProposalBundle>;
  assignedCandidateIds(proposalId: string): Promise<string[]>;
}

type AccessResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: number; code: string; message: string };

type AuthorityResult =
  | { ok: true; authority: ReconstructedScoringAuthority }
  | { ok: false; code: string; message: string };

type BatchResult =
  | { ok: true; assignments: ValidatedProposalAssignment[]; model: string; retried: boolean }
  | { ok: false; code: string; error: string; model: string; retried: boolean; retryable: boolean };

export interface CreateProposalDependencies {
  authorize(authorizationHeader: string | null, clientId: string): Promise<AccessResult>;
  aiConfigured(): boolean;
  createPersistence(): ProposalPersistence;
  reconstructAuthority(input: {
    clientId: string;
    configurationSnapshot: Record<string, unknown>;
    contextRows: Array<{ id: string; file_number: number; file_name: string; version: number; content_md: string }>;
    executionRows: Array<{ id: string; file_number: number; file_name: string; version: number; content_md: string; month?: string }>;
  }): Promise<AuthorityResult>;
  buildConfigurationSnapshot(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  hashConfiguration(snapshot: Record<string, unknown>): Promise<string>;
  proposeBatch(input: {
    clientName: string;
    periodStart: string;
    periodEnd: string;
    authority: ReconstructedScoringAuthority;
    slots: ProposalSlot[];
    candidates: EligibleProposalCandidate[];
    conflicts: SlotConflict[];
    telemetry?: { proposalId: string; batchIndex: number; attemptNumber: number };
  }): Promise<BatchResult>;
  selectedModel(): string;
  randomUUID(): string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...IDEATION_PROPOSAL_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function safeMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return raw
    .split(/\r?\n/, 1)[0]
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\b/g, "[redacted-token]")
    .replace(/\b(?:SUPABASE_SERVICE_ROLE_KEY|service[_ -]?role key)\b[^,;]*/gi, "[redacted-service-credential]")
    .replace(/\blease[_ -]?owner\s*[:=]\s*\S+/gi, "lease owner [redacted]")
    .slice(0, 1000);
}

function fail(
  status: number,
  stage: string,
  code: string,
  message: string,
  details?: unknown,
  retryable = isRetryableProposalFailure(code),
): Response {
  return json({
    ok: false,
    function: FUNCTION_NAME,
    created: false,
    error: { stage, code, message, retryable, details },
    message,
  }, status);
}

export function structuredProposalFailure(bundle: ProposalBundle) {
  const proposal = bundle.proposal;
  const expected = Number(proposal.expected_slot_count ?? 0);
  const assigned = Number(proposal.assigned_slot_count ?? 0);
  const attempts = Number(proposal.attempt_count ?? 0);
  const maximum = Number(proposal.maximum_attempts ?? IDEATION_PROPOSAL_MAX_ATTEMPTS);
  const status = String(proposal.status ?? "failed");
  const retryAllowed = status === "retryable" && proposal.retryable === true && attempts < maximum;
  return {
    proposal_id: proposal.id,
    proposal,
    slots: bundle.slots,
    ideation_cycle_id: proposal.ideation_cycle_id ?? null,
    scoring_run_id: proposal.scoring_run_id ?? null,
    proposal_status: status,
    expected_slot_count: expected,
    assigned_slot_count: assigned,
    unassigned_candidate_count: Number(proposal.unassigned_candidate_count ?? Math.max(expected - assigned, 0)),
    conflict_count: Number(proposal.conflict_count ?? 0),
    unresolved_conflict_count: Number(proposal.unresolved_conflict_count ?? 0),
    attempt_count: attempts,
    maximum_attempts: maximum,
    edit_revision: Number(proposal.edit_revision ?? 0),
    warnings: Array.isArray(proposal.warnings) ? proposal.warnings : [],
    terminal_reason: status === "failed" ? String(proposal.failure_code ?? "IDEATION_PROPOSAL_FAILED") : null,
    retry_allowed: retryAllowed,
    retryable: retryAllowed,
  };
}

function startLeaseHeartbeat(
  persistence: ProposalPersistence,
  proposalId: string,
  leaseOwner: string,
  runtime: IdeationProviderRuntime,
): { stop(): void; failure(): Error | null } {
  const startedAt = Date.now();
  let failure: Error | null = null;
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight || failure) return;
    inFlight = true;
    void persistence.renewLease({
      p_proposal_id: proposalId,
      p_lease_owner: leaseOwner,
      p_lease_seconds: runtime.lease_seconds,
    }).then((result) => {
      if (result.error) failure = new Error(`PROPOSAL_LEASE_HEARTBEAT_FAILED: ${result.error.message}`);
      logIdeationLease({
        cycle_id: proposalId,
        event: result.error ? "heartbeat_failed" : "heartbeat_ok",
        elapsed_ms: Date.now() - startedAt,
        lease_seconds: runtime.lease_seconds,
        heartbeat_interval_ms: runtime.heartbeat_interval_ms,
      });
    }).catch((error: unknown) => {
      failure = error instanceof Error ? error : new Error(String(error));
    }).finally(() => {
      inFlight = false;
    });
  }, runtime.heartbeat_interval_ms);
  (timer as unknown as { unref?: () => void }).unref?.();
  return { stop: () => clearInterval(timer), failure: () => failure };
}

const EDIT_ACTIONS = new Set<ProposalAction>(["move", "swap", "unassign", "assign"]);
const GENERATION_ACTIONS = new Set<ProposalAction>(["create", "retry", "regenerate"]);
const ALLOWED_BODY_KEYS = new Set([
  "action",
  "client_id",
  "ideation_cycle_id",
  "scoring_run_id",
  "proposal_id",
  "regenerate_from_proposal_id",
  "expected_edit_revision",
  "from_slot_key",
  "to_slot_key",
  "candidate_id",
]);

export function createProposalHandler(deps: CreateProposalDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: IDEATION_PROPOSAL_CORS_HEADERS });
    if (req.method !== "POST") return fail(405, "request", "METHOD_NOT_ALLOWED", "POST only.");

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return fail(400, "request", "INVALID_JSON", "A valid JSON request body is required.");
    }
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return fail(400, "request", "INVALID_REQUEST", "A JSON object body is required.");
    }
    const body = rawBody as Record<string, unknown>;
    // Unknown fields are rejected outright, so a caller can never smuggle a role,
    // a configuration hash, or an operational identifier into the request.
    for (const key of Object.keys(body)) {
      if (!ALLOWED_BODY_KEYS.has(key)) {
        return fail(400, "request", "UNEXPECTED_REQUEST_FIELD", `Unexpected request field ${key}.`);
      }
    }

    const action = (typeof body.action === "string" ? body.action.trim() : "create") as ProposalAction;
    if (!GENERATION_ACTIONS.has(action) && !EDIT_ACTIONS.has(action)
      && action !== "refresh_conflicts" && action !== "approve") {
      return fail(400, "request", "PROPOSAL_ACTION_INVALID", "Unsupported proposal action.");
    }
    const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
    if (!UUID_PATTERN.test(clientId)) {
      return fail(400, "request", "CLIENT_ID_INVALID", "client_id must be a valid UUID.");
    }

    const access = await deps.authorize(req.headers.get("Authorization"), clientId);
    if (!access.ok) return fail(access.status, "authorization", access.code, access.message);

    const persistence = deps.createPersistence();
    const providerRuntime = resolveIdeationProviderRuntime();

    /* ---------------- Editing, conflict refresh, and approval ---------------- */
    if (EDIT_ACTIONS.has(action) || action === "refresh_conflicts" || action === "approve") {
      const proposalId = typeof body.proposal_id === "string" ? body.proposal_id.trim() : "";
      if (!UUID_PATTERN.test(proposalId)) {
        return fail(400, "request", "PROPOSAL_ID_INVALID", "proposal_id must be a valid UUID.");
      }
      const expectedRevision = Number(body.expected_edit_revision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        return fail(400, "request", "PROPOSAL_EDIT_REVISION_INVALID", "expected_edit_revision must be a non-negative integer.");
      }

      let existing: ProposalBundle;
      try {
        existing = await persistence.fetchProposalBundle(proposalId);
      } catch (error) {
        return fail(404, "load_proposal", "PROPOSAL_NOT_FOUND", safeMessage(error), undefined, false);
      }
      if (existing.proposal.client_id !== clientId) {
        return fail(403, "authorization", "PROPOSAL_CLIENT_MISMATCH", "The proposal belongs to another client.", undefined, false);
      }

      // Both conflict refresh and approval re-read the live Calendar.
      let currentSnapshot: CalendarConflictSnapshot | null = null;
      let currentConflicts: SlotConflict[] = [];
      if (action === "refresh_conflicts" || action === "approve") {
        const manifest = Array.isArray(existing.proposal.slot_manifest_snapshot)
          ? existing.proposal.slot_manifest_snapshot as ProposalSlot[]
          : [];
        const occupancy = await persistence.loadCalendarOccupancy(
          clientId,
          String(existing.proposal.period_start),
          String(existing.proposal.period_end),
        );
        currentSnapshot = await buildCalendarConflictSnapshot({
          periodStart: String(existing.proposal.period_start),
          periodEnd: String(existing.proposal.period_end),
          rows: occupancy,
        });
        // Conflicts are recomputed against the slots as they now stand, so a
        // manual move is re-evaluated rather than keeping its original state.
        const liveSlots: ProposalSlot[] = existing.slots.map((slot) => ({
          proposal_slot_key: String(slot.proposal_slot_key),
          proposed_date: String(slot.proposed_date),
          date_slot_ordinal: Number(slot.date_slot_ordinal),
          required_asset_type: slot.required_asset_type as ProposalSlot["required_asset_type"],
          execution_month: String(slot.proposed_date).slice(0, 7),
          calendar_row_type: String(slot.calendar_row_type),
          placement_basis: slot.placement_basis as ProposalSlot["placement_basis"],
        }));
        currentConflicts = classifySlotConflicts({
          slots: liveSlots.length > 0 ? liveSlots : manifest,
          snapshot: currentSnapshot,
        });
      }

      if (action === "approve") {
        // Approval requires the proposal's stored digest to still equal live
        // Calendar state; otherwise the operator must refresh and re-review.
        const approved = await persistence.approveProposal({
          p_proposal_id: proposalId,
          p_client_id: clientId,
          p_expected_edit_revision: expectedRevision,
          p_current_calendar_digest: currentSnapshot!.digest,
          p_actor_id: access.userId,
        });
        if (approved.error) return proposalRpcFailure(approved.error.message, proposalId, persistence);
        const bundle = await persistence.fetchProposalBundle(proposalId);
        return json({ ok: true, function: FUNCTION_NAME, action, created: false, ...bundle });
      }

      if (action === "refresh_conflicts") {
        const refreshed = await persistence.refreshConflicts({
          p_proposal_id: proposalId,
          p_client_id: clientId,
          p_conflicts: currentConflicts,
          p_calendar_conflict_snapshot: currentSnapshot,
          p_calendar_conflict_digest: currentSnapshot!.digest,
          p_expected_edit_revision: expectedRevision,
          p_actor_id: access.userId,
        });
        if (refreshed.error) return proposalRpcFailure(refreshed.error.message, proposalId, persistence);
        const bundle = await persistence.fetchProposalBundle(proposalId);
        return json({ ok: true, function: FUNCTION_NAME, action, created: false, ...bundle });
      }

      const candidateId = typeof body.candidate_id === "string" ? body.candidate_id.trim() : null;
      if (action === "assign" && (!candidateId || !UUID_PATTERN.test(candidateId))) {
        return fail(400, "request", "CANDIDATE_ID_INVALID", "candidate_id must be a valid UUID.");
      }
      const edited = await persistence.editAssignment({
        p_proposal_id: proposalId,
        p_client_id: clientId,
        p_action: action,
        p_from_slot_key: typeof body.from_slot_key === "string" ? body.from_slot_key : null,
        p_to_slot_key: typeof body.to_slot_key === "string" ? body.to_slot_key : null,
        p_candidate_id: candidateId,
        p_expected_edit_revision: expectedRevision,
        p_actor_id: access.userId,
      });
      if (edited.error) return proposalRpcFailure(edited.error.message, proposalId, persistence);
      const bundle = await persistence.fetchProposalBundle(proposalId);
      return json({ ok: true, function: FUNCTION_NAME, action, created: false, ...bundle });
    }

    /* ---------------------------- Generation ---------------------------- */
    if (!deps.aiConfigured()) {
      return fail(503, "configuration", "ANTHROPIC_NOT_CONFIGURED", "Server-side Anthropic proposal generation is not configured.", undefined, false);
    }
    const cycleId = typeof body.ideation_cycle_id === "string" ? body.ideation_cycle_id.trim() : "";
    const scoringRunId = typeof body.scoring_run_id === "string" ? body.scoring_run_id.trim() : "";
    const regenerateFrom = typeof body.regenerate_from_proposal_id === "string"
      ? body.regenerate_from_proposal_id.trim()
      : null;
    if (!UUID_PATTERN.test(cycleId)) {
      return fail(400, "request", "CYCLE_ID_INVALID", "ideation_cycle_id must be a valid UUID.");
    }
    if (!UUID_PATTERN.test(scoringRunId)) {
      return fail(400, "request", "SCORING_RUN_ID_INVALID", "scoring_run_id must be a valid UUID.");
    }
    if (action === "regenerate" && (!regenerateFrom || !UUID_PATTERN.test(regenerateFrom))) {
      return fail(400, "request", "REGENERATE_TARGET_INVALID", "regenerate_from_proposal_id must be a valid UUID.");
    }
    if (action !== "regenerate" && regenerateFrom) {
      return fail(400, "request", "REGENERATE_TARGET_INVALID", "regenerate_from_proposal_id is only valid for a regenerate action.");
    }

    let cycleBundle;
    let scoringBundle;
    try {
      cycleBundle = await persistence.loadCycleBundle(cycleId);
      scoringBundle = await persistence.loadScoringRun(scoringRunId);
    } catch (error) {
      return fail(500, "load_cycle", "PROPOSAL_READ_FAILED", safeMessage(error));
    }

    const eligibility = evaluateProposalEligibility({
      clientId,
      cycle: cycleBundle.cycle,
      scoringRun: scoringBundle.scoringRun,
      techniqueRuns: cycleBundle.techniqueRuns,
      candidates: cycleBundle.candidates,
      scores: scoringBundle.scores,
    });
    if (!eligibility.ok) {
      const status = eligibility.code === "CYCLE_NOT_FOUND" || eligibility.code === "SCORING_RUN_NOT_FOUND"
        ? 404
        : eligibility.code === "CYCLE_CLIENT_MISMATCH" || eligibility.code === "SCORING_RUN_CLIENT_MISMATCH"
        ? 403
        : 409;
      return fail(status, "eligibility", eligibility.code, eligibility.message, undefined, false);
    }
    const candidates = eligibility.candidates;
    const cycle = cycleBundle.cycle!;
    const scoringRun = scoringBundle.scoringRun!;

    let authorityRows;
    try {
      authorityRows = await persistence.loadAuthorityRows(clientId);
    } catch (error) {
      return fail(500, "load_authority", "AUTHORITY_READ_FAILED", safeMessage(error));
    }
    const authorityResult = await deps.reconstructAuthority({
      clientId,
      configurationSnapshot: cycle.configuration_snapshot,
      contextRows: authorityRows.contextRows,
      executionRows: authorityRows.executionRows,
    });
    if (!authorityResult.ok) {
      return fail(409, "authority", authorityResult.code, authorityResult.message, undefined, false);
    }
    const authority = authorityResult.authority;

    // Deterministic slot manifest from immutable quantity + Execution cadence.
    let slots: ProposalSlot[];
    let scheduleContract;
    try {
      scheduleContract = parseScheduleContract(
        authorityRows.executionRows.map((row) => ({ file_name: row.file_name, content_md: row.content_md })),
      );
      slots = planIdeationProposalSlots({
        periodStart: cycle.period_start,
        periodEnd: cycle.period_end,
        requiredByAssetType: eligibility.requiredByAssetType,
        weekdays: scheduleContract.weekdays,
      });
    } catch (error) {
      return fail(409, "slot_manifest", "SLOT_MANIFEST_INVALID", safeMessage(error), undefined, false);
    }
    if (slots.length !== candidates.length) {
      return fail(409, "slot_manifest", "SLOT_MANIFEST_INVALID",
        "The slot manifest does not reconcile with the candidate set.", undefined, false);
    }

    const occupancy = await persistence.loadCalendarOccupancy(clientId, cycle.period_start, cycle.period_end);
    const conflictSnapshot = await buildCalendarConflictSnapshot({
      periodStart: cycle.period_start,
      periodEnd: cycle.period_end,
      rows: occupancy,
    });
    const conflicts = classifySlotConflicts({ slots, snapshot: conflictSnapshot });
    const conflictByKey = new Map(conflicts.map((conflict) => [conflict.proposal_slot_key, conflict]));

    const selectedModel = deps.selectedModel();
    const fingerprints: ProposalCandidateFingerprint[] = candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      candidate_score_id: candidate.candidate_score_id,
      technique_slug: candidate.technique_slug,
      candidate_index: candidate.candidate_index,
      asset_type: candidate.asset_type,
      content_hash: candidate.candidate_content_hash,
      evidence_hash: candidate.candidate_evidence_hash,
      rank: candidate.rank,
      overall_score: candidate.overall_score,
      execution_plan_alignment: candidate.execution_plan_alignment,
      proof_and_evidence_strength: candidate.proof_and_evidence_strength,
      audience_and_pain_relevance: candidate.audience_and_pain_relevance,
    }));
    const configurationSnapshot = await deps.buildConfigurationSnapshot({
      clientId,
      ideationCycleId: cycleId,
      cycleInputHash: cycle.input_hash,
      scoringRunId,
      scoringConfigurationHash: scoringRun.configuration_hash,
      rubricSlug: scoringRun.rubric_slug,
      rubricVersion: scoringRun.rubric_version,
      periodStart: cycle.period_start,
      periodEnd: cycle.period_end,
      quantityPlan: cycle.quantity_plan,
      requiredByAssetType: eligibility.requiredByAssetType,
      candidates: fingerprints,
      slots,
      scheduleContractSource: scheduleContract.source,
      scheduleContractFile: scheduleContract.source_file,
      conflictSnapshot,
      authority,
      selectedModel,
    });
    const configurationHash = await deps.hashConfiguration(configurationSnapshot);

    // Server-derived scoring identity. A caller cannot supply or manipulate it.
    const idempotencyKey = regenerateFrom
      ? `proposal:${cycleId}:${scoringRunId}:${configurationHash.slice(0, 24)}:after:${regenerateFrom}`
      : `proposal:${cycleId}:${scoringRunId}:${configurationHash.slice(0, 24)}`;

    // The candidate snapshot carries the display reference so a restore can
    // reinstate it without inventing a new one.
    const candidateSnapshot = fingerprints.map((fingerprint) => ({
      ...fingerprint,
      display_reference: ideationCandidateDisplayReference({
        ideationCycleId: cycleId,
        techniqueSlug: fingerprint.technique_slug,
        assetType: fingerprint.asset_type,
        candidateIndex: fingerprint.candidate_index,
      }),
    }));

    const leaseOwner = deps.randomUUID();
    const begin = await persistence.beginProposal({
      p_client_id: clientId,
      p_ideation_cycle_id: cycleId,
      p_scoring_run_id: scoringRunId,
      p_idempotency_key: idempotencyKey,
      p_configuration_hash: configurationHash,
      p_configuration_snapshot: configurationSnapshot,
      p_authority_snapshot: (configurationSnapshot as Record<string, unknown>).authority ?? {},
      p_candidate_snapshot: candidateSnapshot,
      p_scoring_snapshot: {
        scoring_run_id: scoringRunId,
        configuration_hash: scoringRun.configuration_hash,
        rubric_slug: scoringRun.rubric_slug,
        rubric_version: scoringRun.rubric_version,
      },
      p_slot_manifest: slots.map((slot) => ({
        ...slot,
        conflict_status: conflictByKey.get(slot.proposal_slot_key)?.conflict_status ?? "clear",
        conflict_details: conflictByKey.get(slot.proposal_slot_key)?.conflict_details ?? {},
      })),
      p_calendar_conflict_snapshot: conflictSnapshot,
      p_calendar_conflict_digest: conflictSnapshot.digest,
      p_slot_planner_version: IDEATION_SLOT_PLANNER_VERSION,
      p_prompt_digest: String(
        ((configurationSnapshot as Record<string, unknown>).prompt as Record<string, unknown>)?.digest ?? "",
      ),
      p_provider: PROVIDER,
      p_model: selectedModel,
      p_output_schema_version: IDEATION_PROPOSAL_OUTPUT_SCHEMA_VERSION,
      p_module_version: IDEATION_PROPOSAL_MODULE_VERSION,
      p_period_start: cycle.period_start,
      p_period_end: cycle.period_end,
      p_expected_slot_count: slots.length,
      p_maximum_attempts: IDEATION_PROPOSAL_MAX_ATTEMPTS,
      p_supersedes_proposal_id: regenerateFrom,
      p_lease_owner: leaseOwner,
      p_lease_seconds: providerRuntime.lease_seconds,
      p_actor_id: access.userId,
    });
    if (begin.error) {
      const message = begin.error.message;
      for (
        const [needle, code, text] of [
          ["PROPOSAL_IDEMPOTENCY_CONFLICT", "PROPOSAL_IDEMPOTENCY_CONFLICT", "This proposal identity was already used with a different configuration."],
          ["REGENERATE_PREDECESSOR_INVALID", "REGENERATE_PREDECESSOR_INVALID", "A regeneration must name a draft or approved proposal for this cycle."],
          ["CYCLE_NOT_ELIGIBLE", "CYCLE_NOT_ELIGIBLE", "The Ideation cycle is not eligible for a proposal."],
          ["SCORING_RUN_NOT_ELIGIBLE", "SCORING_RUN_NOT_ELIGIBLE", "The scoring run is not eligible for a proposal."],
          ["PERIOD_MISMATCH", "PERIOD_MISMATCH", "The proposal period does not match the originating Ideation cycle."],
          ["SLOT_MANIFEST_INVALID", "SLOT_MANIFEST_INVALID", "The slot manifest is invalid."],
        ] as const
      ) {
        if (message.includes(needle)) return fail(409, "begin_proposal", code, text, undefined, false);
      }
      return fail(500, "begin_proposal", "BEGIN_PROPOSAL_FAILED", safeMessage(message));
    }

    const beginData = begin.data as {
      created: boolean;
      reclaimed: boolean;
      attempts_exhausted?: boolean;
      proposal: { id: string; status: string; attempt_count: number };
    };
    if (!beginData.created) {
      if (beginData.proposal.status === "running") {
        return fail(409, "begin_proposal", "PROPOSAL_RUN_IN_PROGRESS", "This proposal has an active lease.", undefined, false);
      }
      const bundle = await persistence.fetchProposalBundle(beginData.proposal.id);
      if (bundle.proposal.status === "failed") {
        return fail(
          409,
          "begin_proposal",
          String(bundle.proposal.failure_code ?? (
            beginData.attempts_exhausted ? "PROPOSAL_ATTEMPTS_EXHAUSTED" : "IDEATION_PROPOSAL_FAILED"
          )),
          String(bundle.proposal.failure_message ?? "The persisted proposal is terminal."),
          structuredProposalFailure(bundle),
          false,
        );
      }
      // Draft, approved, or superseded replay: no provider call is made.
      return json({ ok: true, function: FUNCTION_NAME, action, created: false, idempotent_replay: true, ...bundle });
    }

    const proposalId = beginData.proposal.id;
    const attemptNumber = Number(beginData.proposal.attempt_count ?? 1);

    try {
      const alreadyAssigned = new Set(await persistence.assignedCandidateIds(proposalId));
      const bundleNow = await persistence.fetchProposalBundle(proposalId);
      const openSlotKeys = new Set(
        bundleNow.slots.filter((slot) => slot.candidate_id === null)
          .map((slot) => String(slot.proposal_slot_key)),
      );
      const outstandingSlots = slots.filter((slot) => openSlotKeys.has(slot.proposal_slot_key));
      const outstandingCandidates = candidates.filter((candidate) => !alreadyAssigned.has(candidate.candidate_id));
      const clientName = await persistence.clientName(clientId);
      const displayByCandidate = new Map(candidateSnapshot.map((entry) => [entry.candidate_id, entry.display_reference]));

      const warnings: Array<Record<string, unknown>> = [];
      let anyRetryable = false;
      let anyNonRetryable = false;
      let firstFailureCode: string | null = null;
      let firstFailureMessage: string | null = null;

      const heartbeat = startLeaseHeartbeat(persistence, proposalId, leaseOwner, providerRuntime);
      try {
        // Batches pair slots with the candidates of the matching asset types, so
        // every batch is independently satisfiable.
        const slotBatches = ideationProposalBatches(outstandingSlots);
        let candidatePool = [...outstandingCandidates];
        for (let batchIndex = 0; batchIndex < slotBatches.length; batchIndex += 1) {
          const batchSlots = slotBatches[batchIndex];
          const needed: EligibleProposalCandidate[] = [];
          for (const slot of batchSlots) {
            const match = candidatePool.find((candidate) => candidate.asset_type === slot.required_asset_type);
            if (!match) {
              anyNonRetryable = true;
              firstFailureCode ??= "SLOT_MANIFEST_INVALID";
              firstFailureMessage ??= "No remaining candidate matches a required slot asset type.";
              break;
            }
            needed.push(match);
            candidatePool = candidatePool.filter((candidate) => candidate.candidate_id !== match.candidate_id);
          }
          if (needed.length !== batchSlots.length) continue;

          const result = await deps.proposeBatch({
            clientName,
            periodStart: cycle.period_start,
            periodEnd: cycle.period_end,
            authority,
            slots: batchSlots,
            candidates: needed,
            conflicts: batchSlots.map((slot) => conflictByKey.get(slot.proposal_slot_key)!).filter(Boolean),
            telemetry: { proposalId, batchIndex, attemptNumber },
          });
          if (!result.ok) {
            if (result.retryable) anyRetryable = true;
            else anyNonRetryable = true;
            firstFailureCode ??= result.code;
            firstFailureMessage ??= result.error;
            warnings.push({
              batch_index: batchIndex,
              slot_keys: batchSlots.map((slot) => slot.proposal_slot_key),
              code: result.code,
              message: safeMessage(result.error),
              retryable: result.retryable,
            });
            // Return this batch's candidates to the pool for a later attempt.
            candidatePool = [...candidatePool, ...needed];
            continue;
          }
          const payload = result.assignments.map((assignment) => ({
            ...assignment,
            candidate_display_reference: displayByCandidate.get(assignment.candidate_id) ?? null,
          }));
          const persisted = await persistence.persistBatch({
            p_proposal_id: proposalId,
            p_lease_owner: leaseOwner,
            p_assignments: payload,
          });
          if (persisted.error) throw new Error(`PROPOSAL_PERSISTENCE_FAILED: ${persisted.error.message}`);
        }
      } finally {
        heartbeat.stop();
      }
      const heartbeatFailure = heartbeat.failure();
      if (heartbeatFailure) throw heartbeatFailure;

      const assignedIds = await persistence.assignedCandidateIds(proposalId);
      const complete = assignedIds.length === candidates.length
        && candidates.every((candidate) => assignedIds.includes(candidate.candidate_id));

      if (!complete) {
        const failed = await persistence.failProposal({
          p_proposal_id: proposalId,
          p_lease_owner: leaseOwner,
          p_failure_code: firstFailureCode ?? "PROPOSAL_INCOMPLETE",
          p_failure_message: firstFailureMessage ? safeMessage(firstFailureMessage) : "The proposal did not fill every slot.",
          p_retryable: anyRetryable && !anyNonRetryable,
          p_warnings: warnings,
          p_actor_id: access.userId,
        });
        if (failed.error) return proposalRpcFailure(failed.error.message, proposalId, persistence);
        const bundle = await persistence.fetchProposalBundle(proposalId);
        const details = structuredProposalFailure(bundle);
        const code = firstFailureCode ?? "PROPOSAL_INCOMPLETE";
        return fail(
          code === "ANTHROPIC_TIMEOUT" || code === "ANTHROPIC_CONNECT_TIMEOUT" ? 504 : 502,
          "proposal",
          code,
          firstFailureMessage ? safeMessage(firstFailureMessage) : "The proposal did not fill every slot.",
          details,
          details.retry_allowed,
        );
      }

      const completed = await persistence.completeProposal({
        p_proposal_id: proposalId,
        p_lease_owner: leaseOwner,
        p_warnings: warnings,
        p_actor_id: access.userId,
      });
      if (completed.error) throw new Error(`Proposal completion failed: ${completed.error.message}`);

      const bundle = await persistence.fetchProposalBundle(proposalId);
      return json({
        ok: true,
        function: FUNCTION_NAME,
        action,
        created: !beginData.reclaimed,
        idempotent_replay: false,
        reclaimed: beginData.reclaimed,
        ...bundle,
      }, beginData.reclaimed ? 200 : 201);
    } catch (error) {
      const originalMessage = safeMessage(error);
      const terminal = await persistence.failProposal({
        p_proposal_id: proposalId,
        p_lease_owner: leaseOwner,
        p_failure_code: "IDEATION_PROPOSAL_ORCHESTRATION_FAILED",
        p_failure_message: originalMessage,
        p_retryable: false,
        p_warnings: [],
        p_actor_id: access.userId,
      });
      if (terminal.error) return proposalRpcFailure(terminal.error.message, proposalId, persistence);
      try {
        const bundle = await persistence.fetchProposalBundle(proposalId);
        return fail(500, "orchestration", "IDEATION_PROPOSAL_ORCHESTRATION_FAILED", originalMessage,
          structuredProposalFailure(bundle), false);
      } catch (refreshError) {
        return fail(500, "orchestration", "IDEATION_PROPOSAL_ORCHESTRATION_FAILED", originalMessage,
          { proposal_id: proposalId, state_refresh_error: safeMessage(refreshError) }, false);
      }
    }
  };

  /** Maps a raised RPC exception onto the typed structured failure contract. */
  async function proposalRpcFailure(
    message: string,
    proposalId: string,
    persistence: ProposalPersistence,
  ): Promise<Response> {
    const mapping: Array<[string, number, string]> = [
      ["PROPOSAL_EDIT_REVISION_CONFLICT", 409, "Another edit was applied first. Reload the proposal and try again."],
      ["PROPOSAL_LEASE_OWNERSHIP_LOST", 409, "This proposal is owned by another worker."],
      ["PROPOSAL_CALENDAR_SNAPSHOT_STALE", 409, "Calendar state changed since this proposal was generated. Refresh conflicts and review again."],
      ["PROPOSAL_UNRESOLVED_CONFLICT", 409, "The proposal still has an unresolved Calendar conflict."],
      ["PROPOSAL_CANDIDATE_DRIFTED", 409, "A candidate or its score changed since this proposal was generated."],
      ["PROPOSAL_CANDIDATE_RECONCILIATION_FAILED", 409, "The proposal does not assign exactly the expected candidate set."],
      ["PROPOSAL_INCOMPLETE", 409, "The proposal still has an unassigned slot."],
      ["PROPOSAL_ASSET_TYPE_INCOMPATIBLE", 409, "That candidate cannot occupy a slot of a different asset type."],
      ["PROPOSAL_SLOT_ALREADY_OCCUPIED", 409, "That slot already holds a candidate."],
      ["PROPOSAL_CANDIDATE_ALREADY_ASSIGNED", 409, "That candidate is already assigned to a slot."],
      ["PROPOSAL_CANDIDATE_NOT_ASSIGNED", 409, "That slot has no candidate to move."],
      ["PROPOSAL_NOT_EDITABLE", 409, "Only a draft proposal can be edited."],
      ["PROPOSAL_NOT_APPROVABLE", 409, "Only a draft proposal can be approved."],
      ["PROPOSAL_CLIENT_MISMATCH", 403, "The proposal belongs to another client."],
      ["PROPOSAL_SLOT_NOT_FOUND", 404, "That proposal slot was not found."],
      ["PROPOSAL_CANDIDATE_NOT_FOUND", 404, "That candidate was not found."],
      ["PROPOSAL_NOT_FOUND", 404, "The proposal was not found."],
      ["CYCLE_NOT_ELIGIBLE", 409, "The Ideation cycle is no longer eligible."],
      ["SCORING_RUN_NOT_ELIGIBLE", 409, "The scoring run is no longer eligible."],
    ];
    for (const [needle, status, text] of mapping) {
      if (message.includes(needle)) {
        let details: unknown;
        try {
          details = structuredProposalFailure(await persistence.fetchProposalBundle(proposalId));
        } catch {
          details = { proposal_id: proposalId };
        }
        return fail(status, "proposal", needle, text, details, false);
      }
    }
    return fail(500, "proposal", "PROPOSAL_PERSISTENCE_FAILED", safeMessage(message), { proposal_id: proposalId });
  }
}
