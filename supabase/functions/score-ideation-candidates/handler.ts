// Ideation Stage 2 — dependency-injected scoring request handler.
//
// The only writes are Stage 2 scoring runs, Stage 2 candidate scores, and
// activity records. Nothing here reaches a content master, Calendar, production
// brief, asset, distribution, or analytics table.

import {
  ideationScoringBatches,
  IDEATION_SCORING_MAX_ATTEMPTS,
  IDEATION_SCORING_MODULE_VERSION,
  IDEATION_SCORING_PROMPT_VERSION,
} from "../_shared/ideation/scoring/config.ts";
import {
  IDEATION_SCORING_OUTPUT_SCHEMA_VERSION,
  IDEATION_SCORING_RUBRIC_SLUG,
  IDEATION_SCORING_RUBRIC_VERSION,
  assignIdeationRanks,
  type IdeationScoreDimensions,
} from "../_shared/ideation/scoring/rubric.ts";
import {
  evaluateScoringEligibility,
  type EligibleScoringCandidate,
  type ScoringCandidateRow,
  type ScoringCycleRow,
  type ScoringTechniqueRunRow,
} from "../_shared/ideation/scoring/eligibility.ts";
import type { ReconstructedScoringAuthority } from "../_shared/ideation/scoring/authority.ts";
import type { ScoringCandidateFingerprint } from "../_shared/ideation/scoring/configuration.ts";
import type { ValidatedCandidateScore } from "../_shared/ideation/scoring/output.ts";
import {
  resolveIdeationProviderRuntime,
  type IdeationProviderRuntime,
} from "../_shared/ideation/provider-runtime.ts";
import { logIdeationLease } from "../_shared/ideation/telemetry.ts";

const FUNCTION_NAME = "score-ideation-candidates";
const PROVIDER = "anthropic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const IDEATION_SCORING_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RETRYABLE_SCORING_CODES = new Set([
  "ANTHROPIC_CONNECT_TIMEOUT",
  "ANTHROPIC_TIMEOUT",
  "ANTHROPIC_HTTP_ERROR",
  "ANTHROPIC_FETCH_ERROR",
  "ANTHROPIC_RESPONSE_INVALID",
  "ANTHROPIC_EMPTY_RESPONSE",
  "ANTHROPIC_TRUNCATED",
  "SCORING_PERSISTENCE_FAILED",
]);

export function isRetryableScoringFailure(code: string): boolean {
  return RETRYABLE_SCORING_CODES.has(code);
}

interface RpcError {
  message: string;
}

export interface RpcResult<T = unknown> {
  data: T | null;
  error: RpcError | null;
}

export interface ScoringBundle {
  scoring_run: Record<string, unknown> & { id: string; status: string };
  scores: Array<Record<string, unknown>>;
}

export interface ScoringPersistence {
  readonly context?: unknown;
  loadCycleBundle(clientId: string, cycleId: string): Promise<{
    cycle: ScoringCycleRow | null;
    techniqueRuns: ScoringTechniqueRunRow[];
    candidates: ScoringCandidateRow[];
  }>;
  loadAuthorityRows(clientId: string): Promise<{
    contextRows: Array<{ id: string; file_number: number; file_name: string; version: number; content_md: string }>;
    executionRows: Array<{ id: string; file_number: number; file_name: string; version: number; content_md: string; month?: string }>;
  }>;
  beginRun(args: Record<string, unknown>): Promise<RpcResult>;
  renewLease(args: Record<string, unknown>): Promise<RpcResult>;
  persistBatch(args: Record<string, unknown>): Promise<RpcResult>;
  completeRun(args: Record<string, unknown>): Promise<RpcResult>;
  failRun(args: Record<string, unknown>): Promise<RpcResult>;
  fetchScoringBundle(scoringRunId: string): Promise<ScoringBundle>;
  scoredCandidateIds(scoringRunId: string): Promise<string[]>;
}

type AccessResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: number; code: string; message: string };

type AuthorityResult =
  | { ok: true; authority: ReconstructedScoringAuthority }
  | { ok: false; code: string; message: string };

type BatchResult =
  | { ok: true; scores: ValidatedCandidateScore[]; model: string; retried: boolean }
  | { ok: false; code: string; error: string; model: string; retried: boolean; retryable: boolean };

export interface ScoreIdeationDependencies {
  authorize(authorizationHeader: string | null, clientId: string): Promise<AccessResult>;
  aiConfigured(): boolean;
  createPersistence(): ScoringPersistence;
  clientName(persistence: ScoringPersistence, clientId: string): Promise<string>;
  reconstructAuthority(input: {
    clientId: string;
    configurationSnapshot: Record<string, unknown>;
    contextRows: Array<{ id: string; file_number: number; file_name: string; version: number; content_md: string }>;
    executionRows: Array<{ id: string; file_number: number; file_name: string; version: number; content_md: string; month?: string }>;
  }): Promise<AuthorityResult>;
  fingerprintCandidates(candidates: EligibleScoringCandidate[]): Promise<ScoringCandidateFingerprint[]>;
  buildConfigurationSnapshot(input: {
    clientId: string;
    ideationCycleId: string;
    cycleInputHash: string;
    candidates: ScoringCandidateFingerprint[];
    authority: ReconstructedScoringAuthority;
    selectedModel: string;
  }): Promise<Record<string, unknown>>;
  hashConfiguration(snapshot: Record<string, unknown>): Promise<string>;
  scoreBatch(input: {
    clientName: string;
    authority: ReconstructedScoringAuthority;
    candidates: EligibleScoringCandidate[];
    telemetry?: { scoringRunId: string; batchIndex: number; attemptNumber: number };
  }): Promise<BatchResult>;
  selectedModel(): string;
  randomUUID(): string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...IDEATION_SCORING_CORS_HEADERS, "Content-Type": "application/json" },
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
  retryable = isRetryableScoringFailure(code),
): Response {
  return json({
    ok: false,
    function: FUNCTION_NAME,
    created: false,
    error: { stage, code, message, retryable, details },
    message,
  }, status);
}

export function structuredScoringFailure(bundle: ScoringBundle) {
  const run = bundle.scoring_run;
  const expected = Number(run.expected_candidate_count ?? 0);
  const scored = Number(run.scored_candidate_count ?? bundle.scores.length);
  const attempts = Number(run.attempt_count ?? 0);
  const maximum = Number(run.maximum_attempts ?? IDEATION_SCORING_MAX_ATTEMPTS);
  const status = String(run.status ?? "failed");
  const retryAllowed = status === "retryable" && run.retryable === true && attempts < maximum;
  return {
    scoring_run_id: run.id,
    scoring_run: run,
    ideation_cycle_id: run.ideation_cycle_id ?? null,
    scoring_run_status: status,
    scores: bundle.scores,
    warnings: Array.isArray(run.warnings) ? run.warnings : [],
    expected_candidate_count: expected,
    scored_candidate_count: scored,
    failed_candidate_count: Number(run.failed_candidate_count ?? Math.max(expected - scored, 0)),
    shortfall: Math.max(expected - scored, 0),
    attempt_count: attempts,
    maximum_attempts: maximum,
    terminal_reason: status === "failed" ? String(run.error_code ?? "IDEATION_SCORING_FAILED") : null,
    retry_allowed: retryAllowed,
    retryable: retryAllowed,
  };
}

function dimensionRow(score: ValidatedCandidateScore): Record<string, unknown> {
  const dimensions = score.dimensions as IdeationScoreDimensions;
  return {
    candidate_id: score.candidate_id,
    ...dimensions,
    overall_score: score.overall_score,
    priority_band: score.priority_band,
    rationale: score.rationale,
    strengths: score.strengths,
    risks: score.risks,
    authority_references: score.authority_references,
    evidence_references: score.evidence_references,
    prompt_version: IDEATION_SCORING_PROMPT_VERSION,
  };
}

function startLeaseHeartbeat(
  persistence: ScoringPersistence,
  scoringRunId: string,
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
      p_scoring_run_id: scoringRunId,
      p_lease_owner: leaseOwner,
      p_lease_seconds: runtime.lease_seconds,
    }).then((result) => {
      if (result.error) failure = new Error(`SCORING_LEASE_HEARTBEAT_FAILED: ${result.error.message}`);
      logIdeationLease({
        cycle_id: scoringRunId,
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

export function createScoreIdeationHandler(deps: ScoreIdeationDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: IDEATION_SCORING_CORS_HEADERS });
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
    const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
    const cycleId = typeof body.ideation_cycle_id === "string" ? body.ideation_cycle_id.trim() : "";
    const rescoreOf = typeof body.rescore_of_scoring_run_id === "string"
      ? body.rescore_of_scoring_run_id.trim()
      : null;
    if (!UUID_PATTERN.test(clientId)) {
      return fail(400, "request", "CLIENT_ID_INVALID", "client_id must be a valid UUID.");
    }
    if (!UUID_PATTERN.test(cycleId)) {
      return fail(400, "request", "CYCLE_ID_INVALID", "ideation_cycle_id must be a valid UUID.");
    }
    if (rescoreOf !== null && !UUID_PATTERN.test(rescoreOf)) {
      return fail(400, "request", "RESCORE_TARGET_INVALID", "rescore_of_scoring_run_id must be a valid UUID.");
    }

    const access = await deps.authorize(req.headers.get("Authorization"), clientId);
    if (!access.ok) return fail(access.status, "authorization", access.code, access.message);

    if (!deps.aiConfigured()) {
      return fail(
        503,
        "configuration",
        "ANTHROPIC_NOT_CONFIGURED",
        "Server-side Anthropic scoring is not configured.",
        undefined,
        false,
      );
    }

    // Service-role persistence is created only after caller authentication,
    // role validation, and caller-scoped client authorization.
    const persistence = deps.createPersistence();

    let cycleBundle;
    try {
      cycleBundle = await persistence.loadCycleBundle(clientId, cycleId);
    } catch (error) {
      return fail(500, "load_cycle", "CYCLE_READ_FAILED", safeMessage(error));
    }
    const eligibility = evaluateScoringEligibility({
      clientId,
      cycle: cycleBundle.cycle,
      techniqueRuns: cycleBundle.techniqueRuns,
      candidates: cycleBundle.candidates,
    });
    if (!eligibility.ok) {
      const status = eligibility.code === "CYCLE_NOT_FOUND"
        ? 404
        : eligibility.code === "CYCLE_CLIENT_MISMATCH" || eligibility.code === "CANDIDATE_CROSS_CLIENT"
        ? 403
        : 409;
      return fail(status, "eligibility", eligibility.code, eligibility.message, undefined, false);
    }
    const candidates = eligibility.candidates;
    const cycle = cycleBundle.cycle!;

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

    const selectedModel = deps.selectedModel();
    const providerRuntime = resolveIdeationProviderRuntime();
    const fingerprints = await deps.fingerprintCandidates(candidates);
    const configurationSnapshot = await deps.buildConfigurationSnapshot({
      clientId,
      ideationCycleId: cycleId,
      cycleInputHash: cycle.input_hash,
      candidates: fingerprints,
      authority,
      selectedModel,
    });
    const configurationHash = await deps.hashConfiguration(configurationSnapshot);

    // The idempotency key is derived entirely server-side from the immutable
    // configuration and the named predecessor. A caller cannot craft or
    // manipulate it, and an identical accidental resubmission replays.
    const idempotencyKey = rescoreOf
      ? `scoring:${cycleId}:${configurationHash.slice(0, 32)}:after:${rescoreOf}`
      : `scoring:${cycleId}:${configurationHash.slice(0, 32)}`;

    const leaseOwner = deps.randomUUID();
    const begin = await persistence.beginRun({
      p_client_id: clientId,
      p_ideation_cycle_id: cycleId,
      p_idempotency_key: idempotencyKey,
      p_configuration_hash: configurationHash,
      p_configuration_snapshot: configurationSnapshot,
      p_authority_snapshot: (configurationSnapshot as Record<string, unknown>).authority ?? {},
      p_candidate_snapshot: fingerprints,
      p_rubric_slug: IDEATION_SCORING_RUBRIC_SLUG,
      p_rubric_version: IDEATION_SCORING_RUBRIC_VERSION,
      p_prompt_digest: String(
        ((configurationSnapshot as Record<string, unknown>).prompt as Record<string, unknown>)?.digest ?? "",
      ),
      p_provider: PROVIDER,
      p_model: selectedModel,
      p_output_schema_version: IDEATION_SCORING_OUTPUT_SCHEMA_VERSION,
      p_module_version: IDEATION_SCORING_MODULE_VERSION,
      p_expected_candidate_count: candidates.length,
      p_maximum_attempts: IDEATION_SCORING_MAX_ATTEMPTS,
      p_supersedes_scoring_run_id: rescoreOf,
      p_lease_owner: leaseOwner,
      p_lease_seconds: providerRuntime.lease_seconds,
      p_actor_id: access.userId,
    });
    if (begin.error) {
      const message = begin.error.message;
      if (message.includes("SCORING_IDEMPOTENCY_CONFLICT")) {
        return fail(
          409,
          "begin_scoring",
          "SCORING_IDEMPOTENCY_CONFLICT",
          "This scoring identity was already used with a different configuration.",
          undefined,
          false,
        );
      }
      if (message.includes("RESCORE_PREDECESSOR_INVALID")) {
        return fail(
          409,
          "begin_scoring",
          "RESCORE_PREDECESSOR_INVALID",
          "A re-score must name a completed scoring run for this cycle.",
          undefined,
          false,
        );
      }
      if (message.includes("CYCLE_NOT_ELIGIBLE")) {
        return fail(409, "begin_scoring", "CYCLE_NOT_ELIGIBLE", "The Ideation cycle is not eligible for scoring.", undefined, false);
      }
      return fail(500, "begin_scoring", "BEGIN_SCORING_FAILED", safeMessage(message));
    }

    const beginData = begin.data as {
      created: boolean;
      reclaimed: boolean;
      attempts_exhausted?: boolean;
      run: { id: string; status: string; attempt_count: number };
    };
    if (!beginData.created) {
      if (beginData.run.status === "running") {
        return fail(409, "begin_scoring", "SCORING_RUN_IN_PROGRESS", "This scoring run has an active lease.", undefined, false);
      }
      let bundle: ScoringBundle;
      try {
        bundle = await persistence.fetchScoringBundle(beginData.run.id);
      } catch (error) {
        return fail(500, "read_persisted_run", "SCORING_READ_FAILED", safeMessage(error), {
          scoring_run_id: beginData.run.id,
        });
      }
      if (bundle.scoring_run.status === "failed") {
        return fail(
          409,
          "begin_scoring",
          String(bundle.scoring_run.error_code ?? (
            beginData.attempts_exhausted ? "SCORING_ATTEMPTS_EXHAUSTED" : "IDEATION_SCORING_FAILED"
          )),
          String(bundle.scoring_run.error_message ?? "The persisted scoring run is terminal."),
          structuredScoringFailure(bundle),
          false,
        );
      }
      // Completed replay: the existing run is returned and no provider call is made.
      return json({
        ok: true,
        function: FUNCTION_NAME,
        created: false,
        idempotent_replay: true,
        ...bundle,
      });
    }

    const scoringRunId = beginData.run.id;
    const attemptNumber = Number(beginData.run.attempt_count ?? 1);

    try {
      const alreadyScored = new Set(await persistence.scoredCandidateIds(scoringRunId));
      const fingerprintById = new Map(fingerprints.map((entry) => [entry.candidate_id, entry]));
      const outstanding = candidates.filter((candidate) => !alreadyScored.has(candidate.candidate_id));
      const clientName = await deps.clientName(persistence, clientId);

      const warnings: Array<Record<string, unknown>> = [];
      let anyRetryable = false;
      let anyNonRetryable = false;
      let firstFailureCode: string | null = null;
      let firstFailureMessage: string | null = null;

      const heartbeat = startLeaseHeartbeat(persistence, scoringRunId, leaseOwner, providerRuntime);
      try {
        const batches = ideationScoringBatches(outstanding);
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          const batch = batches[batchIndex];
          const result = await deps.scoreBatch({
            clientName,
            authority,
            candidates: batch,
            telemetry: { scoringRunId, batchIndex, attemptNumber },
          });
          if (!result.ok) {
            if (result.retryable) anyRetryable = true;
            else anyNonRetryable = true;
            if (!firstFailureCode) {
              firstFailureCode = result.code;
              firstFailureMessage = result.error;
            }
            warnings.push({
              batch_index: batchIndex,
              candidate_ids: batch.map((candidate) => candidate.candidate_id),
              code: result.code,
              message: safeMessage(result.error),
              retryable: result.retryable,
            });
            continue;
          }
          const payload = result.scores.map((score) => {
            const fingerprint = fingerprintById.get(score.candidate_id)!;
            return {
              ...dimensionRow(score),
              candidate_content_hash: fingerprint.content_hash,
              candidate_evidence_hash: fingerprint.evidence_hash,
            };
          });
          const persisted = await persistence.persistBatch({
            p_scoring_run_id: scoringRunId,
            p_lease_owner: leaseOwner,
            p_scores: payload,
          });
          if (persisted.error) {
            throw new Error(`SCORING_PERSISTENCE_FAILED: ${persisted.error.message}`);
          }
        }
      } finally {
        heartbeat.stop();
      }
      const heartbeatFailure = heartbeat.failure();
      if (heartbeatFailure) throw heartbeatFailure;

      const scoredIds = await persistence.scoredCandidateIds(scoringRunId);
      const complete = scoredIds.length === candidates.length
        && candidates.every((candidate) => scoredIds.includes(candidate.candidate_id));

      if (!complete) {
        const failed = await persistence.failRun({
          p_scoring_run_id: scoringRunId,
          p_lease_owner: leaseOwner,
          p_error_code: firstFailureCode ?? "SCORING_INCOMPLETE",
          p_error_message: firstFailureMessage
            ? safeMessage(firstFailureMessage)
            : "Scoring did not cover every candidate.",
          p_retryable: anyRetryable && !anyNonRetryable,
          p_warnings: warnings,
          p_actor_id: access.userId,
        });
        if (failed.error) {
          const leaseLost = failed.error.message.includes("SCORING_LEASE_OWNERSHIP_LOST");
          return fail(
            leaseLost ? 409 : 500,
            "terminal_state",
            leaseLost ? "SCORING_LEASE_LOST" : "SCORING_TERMINAL_PERSISTENCE_FAILED",
            safeMessage(failed.error.message),
            { scoring_run_id: scoringRunId },
            false,
          );
        }
        const bundle = await persistence.fetchScoringBundle(scoringRunId);
        const details = structuredScoringFailure(bundle);
        const code = firstFailureCode ?? "SCORING_INCOMPLETE";
        return fail(
          code === "ANTHROPIC_TIMEOUT" || code === "ANTHROPIC_CONNECT_TIMEOUT" ? 504 : 502,
          "scoring",
          code,
          firstFailureMessage ? safeMessage(firstFailureMessage) : "Scoring did not cover every candidate.",
          details,
          details.retry_allowed,
        );
      }

      // Ranking happens only once every expected candidate is scored exactly once.
      const bundleForRanks = await persistence.fetchScoringBundle(scoringRunId);
      const rankable = bundleForRanks.scores.map((score) => {
        const candidate = candidates.find((entry) => entry.candidate_id === score.candidate_id);
        return {
          candidate_id: String(score.candidate_id),
          technique_slug: candidate?.technique_slug ?? "",
          candidate_index: candidate?.candidate_index ?? 0,
          overall_score: Number(score.overall_score),
          dimensions: {
            execution_plan_alignment: Number(score.execution_plan_alignment),
            business_and_positioning_alignment: Number(score.business_and_positioning_alignment),
            audience_and_pain_relevance: Number(score.audience_and_pain_relevance),
            proof_and_evidence_strength: Number(score.proof_and_evidence_strength),
            hook_and_attention_strength: Number(score.hook_and_attention_strength),
            commercial_potential: Number(score.commercial_potential),
            specificity_and_clarity: Number(score.specificity_and_clarity),
            originality_and_distinctiveness: Number(score.originality_and_distinctiveness),
            platform_and_format_fit: Number(score.platform_and_format_fit),
            production_feasibility: Number(score.production_feasibility),
          } as IdeationScoreDimensions,
        };
      });
      const ranks = assignIdeationRanks(rankable)
        .map((entry) => ({ candidate_id: entry.candidate_id, rank: entry.rank }));

      const completed = await persistence.completeRun({
        p_scoring_run_id: scoringRunId,
        p_lease_owner: leaseOwner,
        p_ranks: ranks,
        p_warnings: warnings,
        p_actor_id: access.userId,
      });
      if (completed.error) {
        throw new Error(`Ideation scoring completion failed: ${completed.error.message}`);
      }

      const bundle = await persistence.fetchScoringBundle(scoringRunId);
      return json({
        ok: true,
        function: FUNCTION_NAME,
        created: !beginData.reclaimed,
        idempotent_replay: false,
        reclaimed: beginData.reclaimed,
        ...bundle,
      }, beginData.reclaimed ? 200 : 201);
    } catch (error) {
      const originalMessage = safeMessage(error);
      const terminal = await persistence.failRun({
        p_scoring_run_id: scoringRunId,
        p_lease_owner: leaseOwner,
        p_error_code: "IDEATION_SCORING_ORCHESTRATION_FAILED",
        p_error_message: originalMessage,
        p_retryable: false,
        p_warnings: [],
        p_actor_id: access.userId,
      });
      if (terminal.error) {
        const leaseLost = terminal.error.message.includes("SCORING_LEASE_OWNERSHIP_LOST");
        return fail(
          leaseLost ? 409 : 500,
          "terminal_state",
          leaseLost ? "SCORING_LEASE_LOST" : "SCORING_TERMINAL_PERSISTENCE_FAILED",
          safeMessage(terminal.error.message),
          { scoring_run_id: scoringRunId, original_error: originalMessage },
          false,
        );
      }
      try {
        const bundle = await persistence.fetchScoringBundle(scoringRunId);
        return fail(
          500,
          "orchestration",
          "IDEATION_SCORING_ORCHESTRATION_FAILED",
          originalMessage,
          structuredScoringFailure(bundle),
          false,
        );
      } catch (refreshError) {
        return fail(
          500,
          "orchestration",
          "IDEATION_SCORING_ORCHESTRATION_FAILED",
          originalMessage,
          { scoring_run_id: scoringRunId, state_refresh_error: safeMessage(refreshError) },
          false,
        );
      }
    }
  };
}
