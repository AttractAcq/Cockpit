// Ideation Stage 2 — scoring handler behaviour: authorization, eligibility,
// retries, leases, idempotent replay, re-scoring, and the structured failure
// contract. The provider is fully injected; no real call is ever made.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createScoreIdeationHandler,
  isRetryableScoringFailure,
  type RpcResult,
  type ScoreIdeationDependencies,
  type ScoringBundle,
  type ScoringPersistence,
} from "../supabase/functions/score-ideation-candidates/handler.ts";
import {
  calculateIdeationOverallScore,
  ideationPriorityBand,
  IDEATION_SCORE_DIMENSION_KEYS,
  type IdeationScoreDimensions,
} from "../supabase/functions/_shared/ideation/scoring/rubric.ts";
import { IDEATION_SCORING_BATCH_POLICY } from "../supabase/functions/_shared/ideation/scoring/config.ts";
import type {
  ScoringCandidateRow,
  ScoringCycleRow,
  ScoringTechniqueRunRow,
} from "../supabase/functions/_shared/ideation/scoring/eligibility.ts";

const CLIENT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const CYCLE_ID = "30000000-0000-4000-8000-000000000001";
const RUN_ID = "40000000-0000-4000-8000-000000000001";
const PREVIOUS_RUN_ID = "40000000-0000-4000-8000-0000000000ff";
const CANDIDATE_COUNT = 7;

function dimensions(value: number): IdeationScoreDimensions {
  const base = {} as IdeationScoreDimensions;
  for (const key of IDEATION_SCORE_DIMENSION_KEYS) base[key] = value;
  return base;
}

function techniqueRuns(): ScoringTechniqueRunRow[] {
  return [
    { id: "50000000-0000-4000-8000-000000000001", client_id: CLIENT_ID, ideation_cycle_id: CYCLE_ID, technique_slug: "review-mined-pain-language" },
    { id: "50000000-0000-4000-8000-000000000002", client_id: CLIENT_ID, ideation_cycle_id: CYCLE_ID, technique_slug: "competitor-objections" },
  ];
}

function candidateId(index: number): string {
  return `60000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
}

function cycleFixture(): ScoringCycleRow {
  return {
    id: CYCLE_ID,
    client_id: CLIENT_ID,
    status: "completed",
    expected_candidate_count: CANDIDATE_COUNT,
    candidate_count: CANDIDATE_COUNT,
    shortfall_count: 0,
    slot_allocation: {
      "review-mined-pain-language": ["reel", "reel", "reel", "reel"],
      "competitor-objections": ["story", "story", "story"],
    },
    configuration_snapshot: { authority: { context: [], strategic_playbooks: [], execution: [] } },
    input_hash: "b".repeat(64),
  };
}

function candidateFixtures(): ScoringCandidateRow[] {
  const runs = techniqueRuns();
  const rows: ScoringCandidateRow[] = [];
  for (let index = 0; index < 4; index += 1) {
    rows.push(candidateRow(candidateId(index), runs[0].id, index, "reel"));
  }
  for (let index = 0; index < 3; index += 1) {
    rows.push(candidateRow(candidateId(4 + index), runs[1].id, index, "story"));
  }
  return rows;
}

function candidateRow(
  id: string,
  techniqueRunId: string,
  index: number,
  assetType: string,
): ScoringCandidateRow {
  return {
    id,
    client_id: CLIENT_ID,
    ideation_cycle_id: CYCLE_ID,
    technique_run_id: techniqueRunId,
    candidate_index: index,
    asset_type: assetType,
    working_title: `Title ${id}`,
    hook: "Hook",
    core_message: "Message",
    psychological_angle: null,
    cta: "CTA",
    evidence_references: [{
      evidence_type: "paraphrase",
      source_ids: ["context:c1:v1"],
      source_ref: "02_Avatar.md",
      source_url: "aa-authority://client/c/context/c1",
      claim: `Title ${id}`,
      support_span: "Span",
      support_note: "Note",
    }],
    input_hash: "a".repeat(64),
  };
}

interface HarnessOptions {
  authorizeRole?: "admin" | "account_manager" | "editor" | "none" | "wrong-client";
  aiConfigured?: boolean;
  cycle?: Partial<ScoringCycleRow> | null;
  candidates?: ScoringCandidateRow[];
  authorityFailure?: { code: string; message: string };
  beginReplay?: "completed" | "failed" | "running";
  attemptsExhausted?: boolean;
  batchFailures?: Record<number, { code: string; error: string; retryable: boolean }>;
  alreadyScored?: string[];
  persistError?: string;
  completeError?: string;
  renewError?: string;
  beginError?: string;
}

interface Harness {
  handler: ReturnType<typeof createScoreIdeationHandler>;
  persistence: MemoryPersistence;
  calls: {
    scoreBatch: number;
    scoredCandidateIds: string[][];
    beginArgs: Record<string, unknown>[];
    failArgs: Record<string, unknown>[];
    completeArgs: Record<string, unknown>[];
  };
}

class MemoryPersistence implements ScoringPersistence {
  private options: HarnessOptions;
  private calls: Harness["calls"];
  private stored = new Map<string, Record<string, unknown>>();
  run: Record<string, unknown>;
  persistCalls = 0;
  completeCalls = 0;
  failCalls = 0;
  renewCalls = 0;

  constructor(options: HarnessOptions, calls: Harness["calls"]) {
    this.options = options;
    this.calls = calls;
    for (const id of options.alreadyScored ?? []) {
      this.stored.set(id, { candidate_id: id, overall_score: 50, ...dimensions(5) });
    }
    this.run = {
      id: RUN_ID,
      client_id: CLIENT_ID,
      ideation_cycle_id: CYCLE_ID,
      status: options.beginReplay ?? "running",
      expected_candidate_count: CANDIDATE_COUNT,
      scored_candidate_count: this.stored.size,
      failed_candidate_count: 0,
      attempt_count: 1,
      maximum_attempts: 3,
      retryable: false,
      warnings: [],
      error_code: options.beginReplay === "failed" ? "SCORING_ATTEMPTS_EXHAUSTED" : null,
      error_message: options.beginReplay === "failed" ? "Attempts exhausted." : null,
      supersedes_scoring_run_id: null,
    };
  }

  async loadCycleBundle() {
    const cycle = this.options.cycle === null ? null : { ...cycleFixture(), ...this.options.cycle };
    return {
      cycle,
      techniqueRuns: techniqueRuns(),
      candidates: this.options.candidates ?? candidateFixtures(),
    };
  }

  async loadAuthorityRows() {
    return { contextRows: [], executionRows: [] };
  }

  async beginRun(args: Record<string, unknown>): Promise<RpcResult> {
    this.calls.beginArgs.push(args);
    if (this.options.beginError) return { data: null, error: { message: this.options.beginError } };
    if (this.options.beginReplay) {
      return {
        data: {
          created: false,
          reclaimed: false,
          attempts_exhausted: this.options.attemptsExhausted ?? false,
          run: { id: RUN_ID, status: this.options.beginReplay, attempt_count: 1 },
        },
        error: null,
      };
    }
    this.run.supersedes_scoring_run_id = args.p_supersedes_scoring_run_id ?? null;
    return {
      data: { created: true, reclaimed: false, run: { id: RUN_ID, status: "running", attempt_count: 1 } },
      error: null,
    };
  }

  async renewLease(): Promise<RpcResult> {
    this.renewCalls += 1;
    return this.options.renewError
      ? { data: null, error: { message: this.options.renewError } }
      : { data: { renewed: true }, error: null };
  }

  async persistBatch(args: Record<string, unknown>): Promise<RpcResult> {
    this.persistCalls += 1;
    if (this.options.persistError) return { data: null, error: { message: this.options.persistError } };
    for (const row of args.p_scores as Array<Record<string, unknown>>) {
      // One score per candidate per run: a repeat insert is ignored.
      if (!this.stored.has(String(row.candidate_id))) {
        this.stored.set(String(row.candidate_id), row);
      }
    }
    this.run.scored_candidate_count = this.stored.size;
    return { data: { inserted: this.stored.size }, error: null };
  }

  async completeRun(args: Record<string, unknown>): Promise<RpcResult> {
    this.completeCalls += 1;
    this.calls.completeArgs.push(args);
    if (this.options.completeError) return { data: null, error: { message: this.options.completeError } };
    const ranks = args.p_ranks as Array<{ candidate_id: string; rank: number }>;
    // The RPC would reject an incomplete set; mirror that invariant here.
    if (this.stored.size !== CANDIDATE_COUNT) return { data: null, error: { message: "SCORING_INCOMPLETE" } };
    for (const entry of ranks) {
      const row = this.stored.get(entry.candidate_id);
      if (row) row.rank = entry.rank;
    }
    this.run.status = "completed";
    this.run.scored_candidate_count = this.stored.size;
    return { data: this.run, error: null };
  }

  async failRun(args: Record<string, unknown>): Promise<RpcResult> {
    this.failCalls += 1;
    this.calls.failArgs.push(args);
    if (this.options.renewError) return { data: null, error: { message: "SCORING_LEASE_OWNERSHIP_LOST" } };
    const retryable = args.p_retryable === true
      && Number(this.run.attempt_count) < Number(this.run.maximum_attempts);
    this.run.status = retryable ? "retryable" : "failed";
    this.run.retryable = retryable;
    this.run.error_code = args.p_error_code;
    this.run.error_message = args.p_error_message;
    this.run.warnings = args.p_warnings ?? [];
    this.run.scored_candidate_count = this.stored.size;
    this.run.failed_candidate_count = CANDIDATE_COUNT - this.stored.size;
    return { data: this.run, error: null };
  }

  async fetchScoringBundle(): Promise<ScoringBundle> {
    return {
      scoring_run: structuredClone(this.run) as ScoringBundle["scoring_run"],
      scores: [...this.stored.values()].map((row) => structuredClone(row)),
    };
  }

  async scoredCandidateIds(): Promise<string[]> {
    const ids = [...this.stored.keys()];
    this.calls.scoredCandidateIds.push(ids);
    return ids;
  }
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const calls: Harness["calls"] = {
    scoreBatch: 0,
    scoredCandidateIds: [],
    beginArgs: [],
    failArgs: [],
    completeArgs: [],
  };
  const persistence = new MemoryPersistence(options, calls);
  let batchIndex = -1;

  const deps: ScoreIdeationDependencies = {
    authorize: async (header) => {
      const role = options.authorizeRole ?? "admin";
      if (!header) return { ok: false, status: 401, code: "NOT_AUTHENTICATED", message: "A bearer token is required." };
      if (role === "none") return { ok: false, status: 403, code: "STAFF_ROLE_REQUIRED", message: "Staff role required." };
      if (role === "wrong-client") return { ok: false, status: 403, code: "CLIENT_ACCESS_DENIED", message: "The caller cannot access this client." };
      if (role === "editor") return { ok: false, status: 403, code: "STAFF_ROLE_REQUIRED", message: "Staff role required." };
      return { ok: true, userId: USER_ID, role };
    },
    aiConfigured: () => options.aiConfigured ?? true,
    createPersistence: () => persistence,
    clientName: async () => "Test Client",
    reconstructAuthority: async () => options.authorityFailure
      ? { ok: false, ...options.authorityFailure }
      : {
        ok: true,
        authority: {
          context: [],
          strategicPlaybooks: [],
          execution: [],
          verified: { context: [], strategic_playbooks: [], execution: [] },
        },
      },
    fingerprintCandidates: async (candidates) => candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      technique_slug: candidate.technique_slug,
      candidate_index: candidate.candidate_index,
      asset_type: candidate.asset_type,
      content_hash: "c".repeat(64),
      evidence_hash: "d".repeat(64),
      evidence_source_ids: candidate.evidence_source_ids,
    })),
    buildConfigurationSnapshot: async () => ({
      authority: { context: [], strategic_playbooks: [], execution: [] },
      prompt: { digest: "e".repeat(64) },
    }),
    hashConfiguration: async () => "f".repeat(64),
    scoreBatch: async ({ candidates }) => {
      calls.scoreBatch += 1;
      batchIndex += 1;
      const failure = options.batchFailures?.[batchIndex];
      if (failure) return { ok: false, ...failure, model: "test-model", retried: false };
      return {
        ok: true,
        model: "test-model",
        retried: false,
        scores: candidates.map((candidate, offset) => {
          const value = (offset % 10);
          const dims = dimensions(value);
          const overall = calculateIdeationOverallScore(dims);
          return {
            candidate_id: candidate.candidate_id,
            dimensions: dims,
            overall_score: overall,
            priority_band: ideationPriorityBand(overall),
            rationale: "Rationale",
            strengths: ["Strength"],
            risks: [],
            authority_references: [],
            evidence_references: [],
          };
        }),
      };
    },
    selectedModel: () => "test-model",
    randomUUID: () => "70000000-0000-4000-8000-000000000001",
  };
  return { handler: createScoreIdeationHandler(deps), persistence, calls };
}

function request(token: string | null = "admin", body: unknown = {
  client_id: CLIENT_ID,
  ideation_cycle_id: CYCLE_ID,
}): Request {
  return new Request("http://local.test/functions/v1/score-ideation-candidates", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

/* ================================================================== */
/* Authorization and request validation                                */
/* ================================================================== */

test("admin and account manager are allowed; every other role and caller is denied", async () => {
  for (const role of ["admin", "account_manager"] as const) {
    const harness = makeHarness({ authorizeRole: role });
    const response = await harness.handler(request(role));
    assert.equal(response.status, 201, role);
  }
  for (const [role, status, code] of [
    ["editor", 403, "STAFF_ROLE_REQUIRED"],
    ["none", 403, "STAFF_ROLE_REQUIRED"],
    ["wrong-client", 403, "CLIENT_ACCESS_DENIED"],
  ] as const) {
    const harness = makeHarness({ authorizeRole: role });
    const response = await harness.handler(request("token"));
    assert.equal(response.status, status, role);
    const payload = await body(response);
    assert.equal((payload.error as Record<string, unknown>).code, code);
    // Authorization is decided before any persistence or provider work.
    assert.equal(harness.calls.scoreBatch, 0);
  }
  const anonymous = makeHarness();
  const anonymousResponse = await anonymous.handler(request(null));
  assert.equal(anonymousResponse.status, 401);
  assert.equal(anonymous.calls.scoreBatch, 0);
});

test("the request body cannot spoof role or client access and must be well formed", async () => {
  // A body claiming a role changes nothing: the role comes from the JWT.
  const spoof = makeHarness({ authorizeRole: "editor" });
  const spoofResponse = await spoof.handler(request("token", {
    client_id: CLIENT_ID,
    ideation_cycle_id: CYCLE_ID,
    role: "admin",
    auth_role: "admin",
    user_id: USER_ID,
  }));
  assert.equal(spoofResponse.status, 403);

  for (const [label, payload, code] of [
    ["missing client", { ideation_cycle_id: CYCLE_ID }, "CLIENT_ID_INVALID"],
    ["bad client", { client_id: "nope", ideation_cycle_id: CYCLE_ID }, "CLIENT_ID_INVALID"],
    ["missing cycle", { client_id: CLIENT_ID }, "CYCLE_ID_INVALID"],
    ["bad cycle", { client_id: CLIENT_ID, ideation_cycle_id: "nope" }, "CYCLE_ID_INVALID"],
    ["bad rescore target", { client_id: CLIENT_ID, ideation_cycle_id: CYCLE_ID, rescore_of_scoring_run_id: "nope" }, "RESCORE_TARGET_INVALID"],
    ["array body", [], "INVALID_REQUEST"],
    ["scalar body", 7, "INVALID_REQUEST"],
  ] as const) {
    const harness = makeHarness();
    const response = await harness.handler(request("admin", payload));
    assert.equal(response.status, 400, label);
    assert.equal((await body(response)).error && ((await body(await harness.handler(request("admin", payload)))).error as Record<string, unknown>).code, code, label);
  }

  const badMethod = await makeHarness().handler(
    new Request("http://local.test/x", { method: "GET" }),
  );
  assert.equal(badMethod.status, 405);
});

test("an unconfigured provider fails closed before any run is created", async () => {
  const harness = makeHarness({ aiConfigured: false });
  const response = await harness.handler(request());
  assert.equal(response.status, 503);
  const payload = await body(response);
  const error = payload.error as Record<string, unknown>;
  assert.equal(error.code, "ANTHROPIC_NOT_CONFIGURED");
  assert.equal(error.retryable, false);
  assert.equal(harness.calls.beginArgs.length, 0);
});

/* ================================================================== */
/* Eligibility and authority                                           */
/* ================================================================== */

test("ineligible cycles are rejected before any scoring run is created", async () => {
  const cases: Array<[string, HarnessOptions, number, string]> = [
    ["missing cycle", { cycle: null }, 404, "CYCLE_NOT_FOUND"],
    ["other client", { cycle: { client_id: "10000000-0000-4000-8000-0000000000aa" } }, 403, "CYCLE_CLIENT_MISMATCH"],
    ["retryable cycle", { cycle: { status: "retryable" } }, 409, "CYCLE_NOT_COMPLETED"],
    ["failed cycle", { cycle: { status: "failed" } }, 409, "CYCLE_NOT_COMPLETED"],
    ["running cycle", { cycle: { status: "running" } }, 409, "CYCLE_NOT_COMPLETED"],
    ["shortfall", { cycle: { shortfall_count: 1 } }, 409, "CYCLE_SHORTFALL"],
    ["count mismatch", { cycle: { candidate_count: 3 } }, 409, "CYCLE_COUNT_MISMATCH"],
    ["missing slot", { candidates: candidateFixtures().slice(0, 6) }, 409, "CANDIDATE_SLOT_MISSING"],
  ];
  for (const [label, options, status, code] of cases) {
    const harness = makeHarness(options);
    const response = await harness.handler(request());
    assert.equal(response.status, status, label);
    const error = (await body(response)).error as Record<string, unknown>;
    assert.equal(error.code, code, label);
    assert.equal(error.retryable, false, label);
    assert.equal(harness.calls.beginArgs.length, 0, `${label} must not create a scoring run`);
    assert.equal(harness.calls.scoreBatch, 0, label);
  }
});

test("authority that cannot be reconstructed fails closed and is not retryable", async () => {
  const harness = makeHarness({
    authorityFailure: {
      code: "AUTHORITY_SNAPSHOT_MISMATCH",
      message: "Authority 02_Avatar.md content changed since this cycle was generated.",
    },
  });
  const response = await harness.handler(request());
  assert.equal(response.status, 409);
  const error = (await body(response)).error as Record<string, unknown>;
  assert.equal(error.code, "AUTHORITY_SNAPSHOT_MISMATCH");
  assert.equal(error.retryable, false);
  assert.equal(harness.calls.beginArgs.length, 0, "no scoring run may be created on drifted authority");
});

/* ================================================================== */
/* Happy path, batching, and ranking                                   */
/* ================================================================== */

test("a full scoring run batches deterministically, ranks, and completes", async () => {
  const harness = makeHarness();
  const response = await harness.handler(request());
  assert.equal(response.status, 201);
  const payload = await body(response);
  assert.equal(payload.ok, true);
  assert.equal(payload.idempotent_replay, false);

  const expectedBatches = Math.ceil(CANDIDATE_COUNT / IDEATION_SCORING_BATCH_POLICY.batch_size);
  assert.equal(harness.calls.scoreBatch, expectedBatches, "candidates are scored in bounded batches");
  assert.equal(harness.persistence.persistCalls, expectedBatches, "each batch persists transactionally");
  assert.equal(harness.persistence.completeCalls, 1);
  assert.equal(harness.persistence.failCalls, 0);

  const scores = payload.scores as Array<Record<string, unknown>>;
  assert.equal(scores.length, CANDIDATE_COUNT, "one score per candidate");
  assert.equal(new Set(scores.map((score) => score.candidate_id)).size, CANDIDATE_COUNT);

  // Ranks are gap-free 1..N and unique.
  const ranks = harness.calls.completeArgs[0].p_ranks as Array<{ candidate_id: string; rank: number }>;
  assert.equal(ranks.length, CANDIDATE_COUNT);
  assert.deepEqual([...ranks.map((entry) => entry.rank)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(ranks.map((entry) => entry.candidate_id)).size, CANDIDATE_COUNT);

  // The lease is renewed for the run being completed.
  assert.equal(harness.calls.completeArgs[0].p_scoring_run_id, RUN_ID);
});

test("the scoring identity is server-derived and cannot be supplied by the caller", async () => {
  const harness = makeHarness();
  await harness.handler(request("admin", {
    client_id: CLIENT_ID,
    ideation_cycle_id: CYCLE_ID,
    idempotency_key: "attacker-supplied",
    configuration_hash: "0".repeat(64),
  }));
  const args = harness.calls.beginArgs[0];
  assert.equal(args.p_configuration_hash, "f".repeat(64), "the hash comes from the server snapshot");
  assert.match(String(args.p_idempotency_key), /^scoring:/);
  assert.equal(String(args.p_idempotency_key).includes("attacker-supplied"), false);
  assert.equal(args.p_supersedes_scoring_run_id, null);
  assert.equal(args.p_expected_candidate_count, CANDIDATE_COUNT);
  assert.equal(args.p_maximum_attempts, 3);
});

/* ================================================================== */
/* Retry, partial failure, and lease loss                              */
/* ================================================================== */

test("successful scores persist during a partial failure and the run becomes retryable", async () => {
  const harness = makeHarness({
    batchFailures: { 1: { code: "ANTHROPIC_TIMEOUT", error: "Provider timed out.", retryable: true } },
  });
  const response = await harness.handler(request());
  assert.equal(response.status, 504, "a provider timeout reports a gateway timeout");
  const payload = await body(response);
  const error = payload.error as Record<string, unknown>;
  assert.equal(error.code, "ANTHROPIC_TIMEOUT");
  assert.equal(error.retryable, true);
  assert.equal(isRetryableScoringFailure("ANTHROPIC_TIMEOUT"), true);

  const details = error.details as Record<string, unknown>;
  assert.equal(details.scoring_run_status, "retryable");
  assert.equal(details.expected_candidate_count, CANDIDATE_COUNT);
  assert.equal(details.scored_candidate_count, 5, "the successful batch was retained");
  assert.equal(details.failed_candidate_count, 2);
  assert.equal(details.shortfall, 2);
  assert.equal(details.retry_allowed, true);
  assert.equal(harness.persistence.completeCalls, 0, "a partial run is never completed");

  const warnings = details.warnings as Array<Record<string, unknown>>;
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].batch_index, 1);
  assert.equal(warnings[0].retryable, true);
});

test("a retry scores only the missing candidates and never rescores completed ones", async () => {
  const alreadyScored = [candidateId(0), candidateId(1), candidateId(2), candidateId(3), candidateId(4)];
  const harness = makeHarness({ alreadyScored });
  const response = await harness.handler(request());
  assert.equal(response.status, 201);

  // Only the two outstanding candidates were sent to the provider.
  assert.equal(harness.calls.scoreBatch, 1, "one batch covers the two missing candidates");
  assert.equal(harness.persistence.persistCalls, 1);
  const payload = await body(response);
  assert.equal((payload.scores as unknown[]).length, CANDIDATE_COUNT);
  assert.equal(harness.persistence.completeCalls, 1);
});

test("a non-retryable batch failure is terminal and does not become retryable", async () => {
  const harness = makeHarness({
    batchFailures: {
      0: { code: "SCORING_OUTPUT_INVALID", error: "Scoring output was invalid.", retryable: false },
    },
  });
  const response = await harness.handler(request());
  assert.equal(response.status, 502);
  const error = (await body(response)).error as Record<string, unknown>;
  assert.equal(error.code, "SCORING_OUTPUT_INVALID");
  assert.equal(error.retryable, false);
  const details = error.details as Record<string, unknown>;
  assert.equal(details.scoring_run_status, "failed");
  assert.equal(details.retry_allowed, false);
  assert.equal(isRetryableScoringFailure("SCORING_OUTPUT_INVALID"), false);

  // A mixed retryable/non-retryable outcome stays terminal.
  const mixed = makeHarness({
    batchFailures: {
      0: { code: "ANTHROPIC_TIMEOUT", error: "timeout", retryable: true },
      1: { code: "SCORING_OUTPUT_INVALID", error: "invalid", retryable: false },
    },
  });
  const mixedResponse = await mixed.handler(request());
  const mixedDetails = ((await body(mixedResponse)).error as Record<string, unknown>).details as Record<string, unknown>;
  assert.equal(mixedDetails.scoring_run_status, "failed");
  assert.equal(mixedDetails.retry_allowed, false);
  assert.equal(mixed.calls.failArgs[0].p_retryable, false);
});

test("a worker that loses its lease cannot persist or complete", async () => {
  const harness = makeHarness({ persistError: "SCORING_LEASE_OWNERSHIP_LOST" });
  const response = await harness.handler(request());
  assert.equal(harness.persistence.completeCalls, 0, "nothing may be completed after losing the lease");
  assert.equal(harness.persistence.failCalls, 1, "the run is driven to a recorded terminal state");
  assert.equal(response.status, 500);
  const error = (await body(response)).error as Record<string, unknown>;
  assert.equal(error.code, "IDEATION_SCORING_ORCHESTRATION_FAILED");
  assert.equal(error.retryable, false);
  assert.match(String(error.message), /SCORING_PERSISTENCE_FAILED/);
});

test("a completion rejected by the database never presents a partial run as complete", async () => {
  const harness = makeHarness({ completeError: "SCORING_CANDIDATE_RECONCILIATION_FAILED" });
  const response = await harness.handler(request());
  assert.equal(response.status, 500);
  const error = (await body(response)).error as Record<string, unknown>;
  assert.equal(error.code, "IDEATION_SCORING_ORCHESTRATION_FAILED");
  assert.match(String(error.message), /SCORING_CANDIDATE_RECONCILIATION_FAILED/);
  const details = error.details as Record<string, unknown>;
  assert.notEqual(details.scoring_run_status, "completed");
});

/* ================================================================== */
/* Replay, terminal state, and re-scoring                              */
/* ================================================================== */

test("an active run is refused and a completed run replays without a provider call", async () => {
  const active = makeHarness({ beginReplay: "running" });
  const activeResponse = await active.handler(request());
  assert.equal(activeResponse.status, 409);
  assert.equal(((await body(activeResponse)).error as Record<string, unknown>).code, "SCORING_RUN_IN_PROGRESS");
  assert.equal(active.calls.scoreBatch, 0);

  const replay = makeHarness({
    beginReplay: "completed",
    alreadyScored: Array.from({ length: CANDIDATE_COUNT }, (_, index) => candidateId(index)),
  });
  const replayResponse = await replay.handler(request());
  assert.equal(replayResponse.status, 200);
  const payload = await body(replayResponse);
  assert.equal(payload.ok, true);
  assert.equal(payload.created, false);
  assert.equal(payload.idempotent_replay, true);
  assert.equal((payload.scores as unknown[]).length, CANDIDATE_COUNT);
  assert.equal(replay.calls.scoreBatch, 0, "a completed replay invokes no provider call");
  assert.equal(replay.persistence.persistCalls, 0);
  assert.equal(replay.persistence.completeCalls, 0);
});

test("a terminal run replays as a structured non-retryable failure", async () => {
  const harness = makeHarness({ beginReplay: "failed", attemptsExhausted: true });
  const response = await harness.handler(request());
  assert.equal(response.status, 409);
  const error = (await body(response)).error as Record<string, unknown>;
  assert.equal(error.code, "SCORING_ATTEMPTS_EXHAUSTED");
  assert.equal(error.retryable, false);
  const details = error.details as Record<string, unknown>;
  assert.equal(details.retry_allowed, false, "attempt 3 can never become attempt 4");
  assert.equal(harness.calls.scoreBatch, 0);
});

test("a re-score names its predecessor and produces a distinct scoring identity", async () => {
  const plain = makeHarness();
  await plain.handler(request());
  const plainKey = String(plain.calls.beginArgs[0].p_idempotency_key);

  const rescore = makeHarness();
  const response = await rescore.handler(request("admin", {
    client_id: CLIENT_ID,
    ideation_cycle_id: CYCLE_ID,
    rescore_of_scoring_run_id: PREVIOUS_RUN_ID,
  }));
  assert.equal(response.status, 201);
  const rescoreArgs = rescore.calls.beginArgs[0];
  assert.equal(rescoreArgs.p_supersedes_scoring_run_id, PREVIOUS_RUN_ID);
  const rescoreKey = String(rescoreArgs.p_idempotency_key);
  assert.notEqual(plainKey, rescoreKey, "a re-score is a distinct scoring identity");
  assert.ok(rescoreKey.includes(PREVIOUS_RUN_ID));
  // Same configuration, same predecessor -> same identity, so an accidental
  // duplicate submission replays instead of creating a third run.
  const repeat = makeHarness();
  await repeat.handler(request("admin", {
    client_id: CLIENT_ID,
    ideation_cycle_id: CYCLE_ID,
    rescore_of_scoring_run_id: PREVIOUS_RUN_ID,
  }));
  assert.equal(String(repeat.calls.beginArgs[0].p_idempotency_key), rescoreKey);
});

test("an invalid re-score predecessor and a configuration conflict are both refused", async () => {
  const badPredecessor = makeHarness({ beginError: "RESCORE_PREDECESSOR_INVALID" });
  const badResponse = await badPredecessor.handler(request("admin", {
    client_id: CLIENT_ID,
    ideation_cycle_id: CYCLE_ID,
    rescore_of_scoring_run_id: PREVIOUS_RUN_ID,
  }));
  assert.equal(badResponse.status, 409);
  const badError = (await body(badResponse)).error as Record<string, unknown>;
  assert.equal(badError.code, "RESCORE_PREDECESSOR_INVALID");
  assert.equal(badError.retryable, false);

  const conflict = makeHarness({ beginError: "SCORING_IDEMPOTENCY_CONFLICT" });
  const conflictResponse = await conflict.handler(request());
  assert.equal(conflictResponse.status, 409);
  const conflictError = (await body(conflictResponse)).error as Record<string, unknown>;
  assert.equal(conflictError.code, "SCORING_IDEMPOTENCY_CONFLICT");
  assert.equal(conflictError.retryable, false);
  assert.equal(conflict.calls.scoreBatch, 0);
});

/* ================================================================== */
/* Leak safety                                                         */
/* ================================================================== */

test("scoring responses never leak credentials, prompts, or provider payloads", async () => {
  const harness = makeHarness({
    batchFailures: {
      0: {
        code: "ANTHROPIC_HTTP_ERROR",
        error: "Anthropic API returned HTTP 500: sk-ant-secret\nstack trace line\nservice_role key abc",
        retryable: true,
      },
    },
  });
  const response = await harness.handler(request());
  const serialized = JSON.stringify(await body(response));
  assert.equal(serialized.includes("sk-ant-secret") && serialized.includes("service_role key abc"), false);
  assert.equal(serialized.includes("stack trace line"), false, "multi-line detail is truncated to one line");
  assert.equal(serialized.includes("70000000-0000-4000-8000-000000000001"), false, "the lease owner is never returned");
});
