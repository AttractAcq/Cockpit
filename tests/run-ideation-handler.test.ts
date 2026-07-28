import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRunIdeationHandler,
  type IdeationPersistence,
  type RpcResult,
  type RunBundle,
  type RunIdeationDependencies,
} from "../supabase/functions/run-ideation/handler.ts";
import { resolveIdeationPeriod } from "../supabase/functions/_shared/ideation/period.ts";
import {
  IDEATION_TECHNIQUE_MANIFEST,
  IDEATION_TECHNIQUE_SLUGS,
} from "../supabase/functions/_shared/ideation/config.ts";
import { resolveIdeationProviderRuntime } from "../supabase/functions/_shared/ideation/provider-runtime.ts";
import type { TechniqueResearch } from "../supabase/functions/_shared/ideation/techniques/types.ts";
import { createIdeationRequestCoordinator } from "../src/lib/ideation-request-coordinator.ts";

const CLIENT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const CYCLE_ID = "30000000-0000-4000-8000-000000000001";
const SOURCE_ID = "context:source:v1";

interface HarnessOptions {
  authorize?: RunIdeationDependencies["authorize"];
  aiConfigured?: boolean;
  authorityFailure?: {
    status: number;
    code: string;
    message: string;
  };
  modelFailure?: {
    code: string;
    error: string;
    retryable: boolean;
  };
  orchestrationFailure?: string;
  beginReplay?: "running" | "failed";
  attemptCount?: number;
  completeError?: string;
  renewError?: string;
  /** Lease is renewed successfully this many times, then reports loss. */
  renewErrorAfterCalls?: number;
  /** Simulates a provider response that takes real time to arrive. */
  slowModelMs?: number;
  failError?: string;
  refreshFailsAfterTerminal?: boolean;
}

interface Harness {
  handler: ReturnType<typeof createRunIdeationHandler>;
  persistence: MemoryPersistence;
  calls: {
    authorize: number;
    createPersistence: number;
    generate: number;
    complete: number;
    telemetry: Array<{ cycleId: string; techniqueSlug: string; attemptNumber: number }>;
  };
}

function research(slug: string): TechniqueResearch {
  return {
    researchKey: `research:${slug}`,
    techniqueSlug: slug,
    sourceIdentifier: SOURCE_ID,
    sourceType: "approved_context",
    sourceUrl: "aa-authority://client/source",
    sourceTitle: "Approved source",
    sourceExcerpt: "Buyers feel invisible when proof stays hidden.",
    sourceProvider: "approved_client_authority",
    retrievedAt: "2026-07-27T00:00:00.000Z",
    contentHash: "a".repeat(64),
    status: "processed",
    structuredFindings: { focus: "hidden proof" },
    evidenceSources: [{
      source_id: SOURCE_ID,
      source_ref: "02_Avatar.md",
      source_type: "approved_context",
      source_url: "aa-authority://client/source",
      bounded_excerpt: "Buyers feel invisible when proof stays hidden.",
      content_hash: "a".repeat(64),
    }],
  };
}

function makeBundle(status = "running", attemptCount = 1): RunBundle {
  const requestedBySlug = new Map([
    ["review-mined-pain-language", ["reel"]],
    ["competitor-objections", ["carousel"]],
    ["end-customer-complaints", ["story"]],
  ]);
  return {
    run: {
      id: CYCLE_ID,
      client_id: CLIENT_ID,
      status,
      expected_candidate_count: 3,
      candidate_count: 0,
      shortfall_count: 3,
      retryable: status === "retryable",
      attempt_count: attemptCount,
      error_code: status === "failed" ? "IDEATION_ATTEMPTS_EXHAUSTED" : null,
      error_message: status === "failed" ? "Maximum attempts exhausted." : null,
      configuration_snapshot: { retry_policy: { max_attempts: 3 } },
      lease_owner: status === "running" ? "lease" : null,
      lease_expires_at: status === "running" ? "2026-07-27T00:03:00.000Z" : null,
    },
    technique_runs: IDEATION_TECHNIQUE_MANIFEST.map((technique) => ({
      id: `run:${technique.slug}`,
      technique_slug: technique.slug,
      technique_order: technique.order,
      technique_version: technique.version,
      technique_snapshot: technique,
      status: "running",
      requested_slots: requestedBySlug.get(technique.slug) ?? [],
      generated_slots: 0,
      failed_slots: 0,
      retryable: false,
      attempt_count: attemptCount,
      error_code: null,
      error_message: null,
    })),
    research_results: [],
    candidates: [],
  };
}

class MemoryPersistence implements IdeationPersistence {
  bundle: RunBundle;
  private options: HarnessOptions;
  failPersisted = false;
  beginArgs: Record<string, unknown> = {};
  renewArgs: Array<Record<string, unknown>> = [];
  beginCalls = 0;
  renewCalls = 0;
  completeCalls = 0;
  failCalls = 0;
  fetchCalls = 0;

  constructor(options: HarnessOptions) {
    this.options = options;
    this.bundle = makeBundle(options.beginReplay ?? "running", options.attemptCount ?? 1);
  }

  async beginRun(args: Record<string, unknown>): Promise<RpcResult> {
    this.beginCalls += 1;
    this.beginArgs = args;
    if (this.options.beginReplay) {
      return {
        data: {
          created: false,
          reclaimed: false,
          attempts_exhausted: this.options.beginReplay === "failed",
          cycle: {
            id: CYCLE_ID,
            status: this.options.beginReplay,
            attempt_count: this.options.attemptCount ?? (this.options.beginReplay === "failed" ? 3 : 1),
          },
        },
        error: null,
      };
    }
    return {
      data: {
        created: true,
        reclaimed: false,
        cycle: { id: CYCLE_ID, status: "running", attempt_count: this.options.attemptCount ?? 1 },
      },
      error: null,
    };
  }

  async renewLease(args: Record<string, unknown>): Promise<RpcResult> {
    this.renewCalls += 1;
    this.renewArgs.push(args);
    if (this.options.renewError) return { data: null, error: { message: this.options.renewError } };
    if (
      this.options.renewErrorAfterCalls !== undefined &&
      this.renewCalls > this.options.renewErrorAfterCalls
    ) {
      return { data: null, error: { message: "LEASE_OWNERSHIP_LOST" } };
    }
    return { data: { renewed: true }, error: null };
  }

  async completeRun(args: Record<string, unknown>): Promise<RpcResult> {
    this.completeCalls += 1;
    if (this.options.completeError) return { data: null, error: { message: this.options.completeError } };
    const candidates = args.p_candidates as Array<Record<string, unknown>>;
    const results = args.p_run_results as Array<Record<string, unknown>>;
    const resultBySlug = new Map(results.map((result) => [result.technique_slug, result]));
    this.bundle.candidates = candidates.map((candidate, index) => ({
      id: `candidate:${index}`,
      ...candidate,
      technique: {
        slug: candidate.technique_slug,
        name: String(candidate.technique_slug),
        version: 1,
        order: index + 2,
      },
    }));
    let anyRetryable = false;
    let anyTerminal = false;
    this.bundle.technique_runs = this.bundle.technique_runs.map((run) => {
      const result = resultBySlug.get(run.technique_slug);
      if (!result || result.success === true) {
        return {
          ...run,
          status: "completed",
          generated_slots: Array.isArray(run.requested_slots) ? run.requested_slots.length : 0,
          failed_slots: 0,
          retryable: false,
        };
      }
      const summary = result.summary as Record<string, unknown>;
      const requested = Number(summary.requested_slots ?? 0);
      const generated = Number(summary.generated_slots ?? 0);
      const canRetry = result.retryable === true && Number(this.bundle.run.attempt_count) < 3;
      anyRetryable ||= canRetry;
      anyTerminal ||= !canRetry;
      return {
        ...run,
        status: canRetry ? "shortfall" : "failed",
        generated_slots: generated,
        failed_slots: requested - generated,
        retryable: canRetry,
        error_code: result.error_code,
        error_message: result.error_message,
      };
    });
    const generated = candidates.length;
    const expected = Number(this.bundle.run.expected_candidate_count);
    const failed = anyTerminal || (anyRetryable && Number(this.bundle.run.attempt_count) >= 3);
    this.bundle.run = {
      ...this.bundle.run,
      status: failed ? "failed" : anyRetryable ? "retryable" : "completed",
      candidate_count: generated,
      shortfall_count: expected - generated,
      retryable: !failed && anyRetryable,
      error_code: failed ? String(
        this.bundle.technique_runs.find((run) => Number(run.failed_slots) > 0)?.error_code
          ?? "NON_RETRYABLE_TECHNIQUE_SHORTFALL",
      ) : anyRetryable ? "RETRYABLE_TECHNIQUE_SHORTFALL" : null,
      error_message: failed ? "A required technique failed." : null,
      lease_owner: null,
      lease_expires_at: null,
    };
    return { data: { cycle: this.bundle.run }, error: null };
  }

  async failRun(args: Record<string, unknown>): Promise<RpcResult> {
    this.failCalls += 1;
    if (this.options.failError) return { data: null, error: { message: this.options.failError } };
    this.failPersisted = true;
    this.bundle.run = {
      ...this.bundle.run,
      status: "failed",
      retryable: false,
      error_code: args.p_error_code,
      error_message: args.p_error_message,
      lease_owner: null,
      lease_expires_at: null,
    };
    this.bundle.technique_runs = this.bundle.technique_runs.map((run) => ({
      ...run,
      status: run.status === "running" ? "failed" : run.status,
      error_code: run.status === "running" ? args.p_error_code : run.error_code,
      error_message: run.status === "running" ? args.p_error_message : run.error_message,
      failed_slots: run.status === "running" && Array.isArray(run.requested_slots)
        ? run.requested_slots.length
        : run.failed_slots,
      retryable: false,
    }));
    return { data: this.bundle.run, error: null };
  }

  async fetchRunBundle(): Promise<RunBundle> {
    this.fetchCalls += 1;
    if (this.options.refreshFailsAfterTerminal && this.failPersisted) {
      throw new Error("controlled refresh failure");
    }
    return structuredClone(this.bundle);
  }
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const persistence = new MemoryPersistence(options);
  const calls: Harness["calls"] = {
    authorize: 0,
    createPersistence: 0,
    generate: 0,
    complete: 0,
    telemetry: [],
  };
  const defaultAuthorize: RunIdeationDependencies["authorize"] = async (header) => {
    calls.authorize += 1;
    if (!header) {
      return { ok: false, status: 401, code: "NOT_AUTHENTICATED", message: "A bearer token is required." };
    }
    const token = header.replace(/^Bearer\s+/i, "");
    if (token === "admin") return { ok: true, userId: USER_ID, role: "admin" };
    if (token === "manager") return { ok: true, userId: USER_ID, role: "account_manager" };
    if (token === "wrong-client" || token === "missing-team") {
      return { ok: false, status: 403, code: "CLIENT_ACCESS_DENIED", message: "The caller cannot access this client." };
    }
    return { ok: false, status: 403, code: "STAFF_ROLE_REQUIRED", message: "Staff role required." };
  };
  const modules = IDEATION_TECHNIQUE_MANIFEST
    .filter((technique) => !["live-objection-log", "trigger-event"].includes(technique.slug))
    .map((technique) => ({
      techniqueNumber: technique.order,
      techniqueSlug: technique.slug,
      state: technique.role === "standing_reference" ? "reference_ready" as const : "ready" as const,
      generatesCandidates: technique.role === "sourcing",
      message: technique.effective_focus,
      research: research(technique.slug),
    }));
  const deps: RunIdeationDependencies = {
    authorize: options.authorize ?? defaultAuthorize,
    aiConfigured: () => options.aiConfigured ?? true,
    createPersistence: () => {
      calls.createPersistence += 1;
      return persistence;
    },
    loadAuthority: async () => options.authorityFailure
      ? { ok: false, ...options.authorityFailure }
      : {
        ok: true,
        authority: {
          client: { id: CLIENT_ID, name: "Test Client" },
        },
      },
    resolvePeriod: resolveIdeationPeriod,
    deriveQuantityPlan: () => ({
      total: 3,
      slots: ["reel", "carousel", "story"],
      by_asset_type: { reel: 1, carousel: 1, static: 0, story: 1 },
    }),
    buildAuthoritySnapshot: async () => ({ context: [], strategic_playbooks: [], execution: [] }),
    buildConfigurationSnapshot: async () => ({ retry_policy: { max_attempts: 3 } }),
    hashConfiguration: async () => "a".repeat(64),
    runTechniqueModules: async () => {
      if (options.orchestrationFailure) throw new Error(options.orchestrationFailure);
      return { results: modules, failures: [] };
    },
    buildExecutionEvidenceSources: async () => [],
    generateTechniqueCandidates: async ({ assetTypes, telemetry }) => {
      calls.generate += 1;
      if (telemetry) calls.telemetry.push(telemetry);
      if (options.slowModelMs) {
        await new Promise((resolve) => setTimeout(resolve, options.slowModelMs));
      }
      if (options.modelFailure) {
        return {
          ok: false,
          ...options.modelFailure,
          model: "test-model",
          retried: options.modelFailure.code === "MODEL_OUTPUT_INVALID",
        };
      }
      return {
        ok: true,
        model: "test-model",
        retried: false,
        structuredFindings: {
          pain_language: ["proof stays hidden"],
          objections: ["proof stays hidden"],
          desired_outcomes: ["visible proof"],
          content_opportunities: ["show hidden proof"],
        },
        candidates: assetTypes.map((assetType) => ({
          asset_type: assetType,
          working_title: "Show hidden proof",
          hook: "Proof stays hidden",
          core_message: "Make hidden proof visible",
          psychological_angle: "Visible proof",
          cta: "Review hidden proof",
          evidence_references: [],
        })),
      };
    },
    now: () => new Date("2026-07-27T00:00:00.000Z"),
    randomUUID: () => "40000000-0000-4000-8000-000000000001",
    selectedModel: () => "test-model",
  };
  const originalComplete = persistence.completeRun.bind(persistence);
  persistence.completeRun = async (args) => {
    calls.complete += 1;
    return await originalComplete(args);
  };
  return { handler: createRunIdeationHandler(deps), persistence, calls };
}

function request(
  token = "admin",
  body: unknown = {
    client_id: CLIENT_ID,
    period_type: "one_day",
    start_date: "2026-07-27",
    idempotency_key: "handler-test",
  },
): Request {
  return new Request("http://local.test/functions/v1/run-ideation", {
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

test("handler authorization allows admin/account manager and denies unsupported, missing, and wrong-client access", async () => {
  for (const token of ["admin", "manager"]) {
    const harness = makeHarness();
    const response = await harness.handler(request(token));
    assert.equal(response.status, 201, token);
  }
  for (const [token, status, code] of [
    ["editor", 403, "STAFF_ROLE_REQUIRED"],
    ["wrong-client", 403, "CLIENT_ACCESS_DENIED"],
    ["missing-team", 403, "CLIENT_ACCESS_DENIED"],
    ["", 401, "NOT_AUTHENTICATED"],
  ] as const) {
    const harness = makeHarness();
    const response = await harness.handler(request(token));
    const payload = await body(response);
    assert.equal(response.status, status, token || "missing");
    assert.equal((payload.error as Record<string, unknown>).code, code);
    assert.equal(harness.calls.createPersistence, 0);
  }
});

test("handler rejects role spoofing, malformed/non-object JSON, wrong types, invalid client IDs, and invalid periods", async () => {
  const cases: Array<[Request, string]> = [
    [request("admin", { client_id: CLIENT_ID, period_type: "one_day", role: "admin" }), "MALFORMED_REQUEST"],
    [new Request("http://local.test", {
      method: "POST",
      headers: { Authorization: "Bearer admin", "Content-Type": "application/json" },
      body: "{",
    }), "INVALID_JSON"],
    [request("admin", []), "MALFORMED_REQUEST"],
    [request("admin", { client_id: 7, period_type: "one_day" }), "MALFORMED_REQUEST"],
    [request("admin", { client_id: "not-a-uuid", period_type: "one_day" }), "CLIENT_ID_INVALID"],
    [request("admin", { client_id: CLIENT_ID, period_type: "date_range", start_date: "bad", end_date: "2026-07-27" }), "INVALID_PERIOD"],
  ];
  for (const [edgeRequest, code] of cases) {
    const harness = makeHarness();
    const response = await harness.handler(edgeRequest);
    const payload = await body(response);
    assert.equal(response.status, 400, code);
    assert.equal((payload.error as Record<string, unknown>).code, code);
    assert.equal(harness.calls.createPersistence, 0);
  }
});

test("configuration and authority failures are non-retryable before orchestration", async () => {
  const missingConfig = makeHarness({ aiConfigured: false });
  const configResponse = await missingConfig.handler(request());
  const configBody = await body(configResponse);
  assert.equal(configResponse.status, 503);
  assert.equal((configBody.error as Record<string, unknown>).code, "ANTHROPIC_NOT_CONFIGURED");
  assert.equal((configBody.error as Record<string, unknown>).retryable, false);

  const authority = makeHarness({
    authorityFailure: {
      status: 409,
      code: "CONTEXT_AUTHORITY_INCOMPLETE",
      message: "Approved authority is incomplete.",
    },
  });
  const authorityResponse = await authority.handler(request());
  const authorityBody = await body(authorityResponse);
  assert.equal(authorityResponse.status, 409);
  assert.equal((authorityBody.error as Record<string, unknown>).retryable, false);
  assert.equal(authority.calls.generate, 0);
});

test("retryable Anthropic timeout, truncation, and transient provider failures preserve exact structured shortfalls", async () => {
  for (const code of ["ANTHROPIC_TIMEOUT", "ANTHROPIC_TRUNCATED", "ANTHROPIC_HTTP_ERROR"]) {
    const harness = makeHarness({
      modelFailure: { code, error: `${code} controlled failure`, retryable: true },
    });
    const response = await harness.handler(request());
    const payload = await body(response);
    assert.equal(response.status, 202, code);
    assert.equal(payload.ok, true);
    const run = payload.run as Record<string, unknown>;
    assert.equal(run.status, "retryable");
    assert.equal(run.expected_candidate_count, 3);
    assert.equal(run.candidate_count, 0);
    assert.equal(run.shortfall_count, 3);
    const warnings = payload.warnings as Array<Record<string, unknown>>;
    assert.equal(warnings.length, 3);
    assert.equal(warnings.every((warning) => warning.retryable === true), true);
    assert.equal(harness.persistence.completeCalls, 1);
  }
});

test("model validation failure and attempt exhaustion are terminal and non-retryable", async () => {
  const invalid = makeHarness({
    modelFailure: {
      code: "MODEL_OUTPUT_INVALID",
      error: "Grounding validation failed.",
      retryable: false,
    },
  });
  const invalidResponse = await invalid.handler(request());
  const invalidBody = await body(invalidResponse);
  assert.equal(invalidResponse.status, 502);
  assert.equal((invalidBody.error as Record<string, unknown>).code, "MODEL_OUTPUT_INVALID");
  assert.equal((invalidBody.error as Record<string, unknown>).retryable, false);
  const invalidDetails = (invalidBody.error as Record<string, unknown>).details as Record<string, unknown>;
  assert.equal(invalidDetails.cycle_status, "failed");
  assert.equal(invalidDetails.retry_allowed, false);

  const exhausted = makeHarness({ beginReplay: "failed", attemptCount: 3 });
  const exhaustedResponse = await exhausted.handler(request());
  const exhaustedBody = await body(exhaustedResponse);
  assert.equal(exhaustedResponse.status, 409);
  assert.equal((exhaustedBody.error as Record<string, unknown>).code, "IDEATION_ATTEMPTS_EXHAUSTED");
  assert.equal((exhaustedBody.error as Record<string, unknown>).retryable, false);
  const exhaustedDetails = (exhaustedBody.error as Record<string, unknown>).details as Record<string, unknown>;
  assert.equal(exhaustedDetails.attempt_count, 3);
  assert.equal(exhaustedDetails.maximum_attempts, 3);
  assert.equal(exhaustedDetails.retry_allowed, false);
  assert.equal(exhausted.calls.generate, 0);
});

test("terminal orchestration failure persists and returns the refreshed structured run state", async () => {
  const harness = makeHarness({ orchestrationFailure: "Controlled orchestration failure." });
  const response = await harness.handler(request());
  const payload = await body(response);
  assert.equal(response.status, 500);
  assert.equal(payload.ok, false);
  assert.equal(harness.persistence.failPersisted, true);
  const error = payload.error as Record<string, unknown>;
  assert.equal(error.code, "IDEATION_ORCHESTRATION_FAILED");
  assert.equal(error.message, "Controlled orchestration failure.");
  assert.equal(error.retryable, false);
  const details = error.details as Record<string, unknown>;
  assert.equal(details.cycle_id, CYCLE_ID);
  assert.equal(details.cycle_status, "failed");
  assert.equal(details.expected_candidate_count, 3);
  assert.equal(details.generated_candidate_count, 0);
  assert.equal(details.shortfall_count, 3);
  assert.equal(details.attempt_count, 1);
  assert.equal(details.maximum_attempts, 3);
  assert.equal(details.terminal_reason, "IDEATION_ORCHESTRATION_FAILED");
  assert.equal(details.retry_allowed, false);
  assert.equal((details.technique_runs as unknown[]).length, 7);
  assert.equal((details.failed_techniques as unknown[]).length, 7);
  assert.equal((details.failed_technique_details as unknown[]).length, 7);
});

test("terminal refresh failure keeps the original orchestration error and useful RPC fallback state", async () => {
  const harness = makeHarness({
    orchestrationFailure: "Primary controlled failure.",
    refreshFailsAfterTerminal: true,
  });
  const response = await harness.handler(request());
  const payload = await body(response);
  assert.equal(response.status, 500);
  const error = payload.error as Record<string, unknown>;
  assert.equal(error.message, "Primary controlled failure.");
  assert.equal(error.retryable, false);
  const details = error.details as Record<string, unknown>;
  assert.equal(details.cycle_id, CYCLE_ID);
  assert.equal(details.cycle_status, "failed");
  assert.equal(details.expected_candidate_count, 3);
  assert.equal(details.shortfall_count, 3);
  assert.equal(details.state_refresh_failed, true);
  assert.equal(details.state_refresh_error, "controlled refresh failure");
  assert.equal(details.retry_allowed, false);
});

test("lost or expired leases prevent completion persistence", async () => {
  const lostAtCompletion = makeHarness({
    completeError: "LEASE_OWNERSHIP_LOST",
    failError: "LEASE_OWNERSHIP_LOST",
  });
  const completionResponse = await lostAtCompletion.handler(request());
  const completionBody = await body(completionResponse);
  assert.equal(completionResponse.status, 409);
  assert.equal((completionBody.error as Record<string, unknown>).code, "LEASE_OWNERSHIP_LOST");
  assert.equal(lostAtCompletion.persistence.completeCalls, 1);
  assert.equal(lostAtCompletion.persistence.failPersisted, false);

  const expiredBeforeCompletion = makeHarness({
    renewError: "LEASE_OWNERSHIP_LOST",
    failError: "LEASE_OWNERSHIP_LOST",
  });
  const expiredResponse = await expiredBeforeCompletion.handler(request());
  assert.equal(expiredResponse.status, 409);
  assert.equal(expiredBeforeCompletion.persistence.completeCalls, 0);
  assert.equal(expiredBeforeCompletion.persistence.failPersisted, false);
});

test("active replay does not duplicate generation or persistence", async () => {
  const harness = makeHarness({ beginReplay: "running" });
  const response = await harness.handler(request());
  const payload = await body(response);
  assert.equal(response.status, 409);
  assert.equal((payload.error as Record<string, unknown>).code, "RUN_IN_PROGRESS");
  assert.equal(harness.calls.generate, 0);
  assert.equal(harness.persistence.renewCalls, 0);
  assert.equal(harness.persistence.completeCalls, 0);
  assert.equal(harness.persistence.failCalls, 0);
});

test("HTTP status and retryability are independent and success/failure contracts stay compatible", async () => {
  const success = makeHarness();
  const successResponse = await success.handler(request());
  const successBody = await body(successResponse);
  assert.equal(successResponse.status, 201);
  assert.equal(successBody.ok, true);
  assert.equal(typeof (successBody.run as Record<string, unknown>).id, "string");
  assert.equal(Array.isArray(successBody.technique_runs), true);

  const timeout = makeHarness({
    modelFailure: { code: "ANTHROPIC_TIMEOUT", error: "timeout", retryable: true },
  });
  const timeoutResponse = await timeout.handler(request());
  const timeoutBody = await body(timeoutResponse);
  assert.equal(timeoutResponse.status, 202);
  assert.equal(timeoutBody.ok, true);
  assert.equal((timeoutBody.run as Record<string, unknown>).retryable, true);

  const terminal = makeHarness({ orchestrationFailure: "terminal" });
  const terminalResponse = await terminal.handler(request());
  const terminalBody = await body(terminalResponse);
  assert.equal(terminalResponse.status >= 400, true);
  assert.equal(terminalBody.ok, false);
  const terminalDetails = (terminalBody.error as Record<string, unknown>).details as Record<string, unknown>;
  assert.equal(typeof (terminalDetails.run as Record<string, unknown>).id, "string");
  assert.equal(Array.isArray(terminalDetails.technique_runs), true);
});

test("handler responses redact credentials, tokens, lease values, stacks, and provider payloads", async () => {
  const secret = "eyJabcdefghijklmnopqrstuvwxyz0123456789";
  const harness = makeHarness({
    modelFailure: {
      code: "MODEL_OUTPUT_INVALID",
      error: `service_role key secret-value ${secret}\ninternal stack line`,
      retryable: false,
    },
  });
  const response = await harness.handler(request());
  const serialized = JSON.stringify(await body(response));
  assert.equal(serialized.includes("secret-value"), false);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("internal stack line"), false);
  assert.equal(serialized.includes("lease_owner"), true, "persisted terminal run exposes only a cleared lease field");
  assert.equal(serialized.includes('"lease_owner":"'), false);
});

test("a stale client's terminal handler response cannot regain frontend coordinator ownership", async () => {
  const coordinator = createIdeationRequestCoordinator(CLIENT_ID);
  const token = coordinator.begin("generate", CLIENT_ID);
  assert.ok(token);
  const harness = makeHarness({ orchestrationFailure: "old client terminal response" });
  const responsePromise = harness.handler(request());
  const nextClient = "50000000-0000-4000-8000-000000000001";
  coordinator.synchronizeClient(nextClient);
  const response = await responsePromise;
  assert.equal(response.status, 500);
  assert.equal(coordinator.isCurrent(token), false);
  assert.equal(coordinator.begin("generate", nextClient)?.clientId, nextClient);
});

test("canonical technique set remains exact in handler fixtures", () => {
  assert.deepEqual(
    IDEATION_TECHNIQUE_MANIFEST.map((technique) => technique.slug),
    [...IDEATION_TECHNIQUE_SLUGS],
  );
});

test("the persisted lease safely covers the configured provider deadline", async () => {
  const harness = makeHarness();
  const response = await harness.handler(request());
  assert.equal(response.status, 201);

  const runtime = resolveIdeationProviderRuntime();
  const leaseSeconds = Number(harness.persistence.beginArgs.p_lease_seconds);

  // A lease shorter than the model deadline would let a slow provider response
  // finish while the run is already reclaimable by another worker.
  assert.ok(
    leaseSeconds * 1000 > runtime.technique_deadline_ms,
    `lease ${leaseSeconds}s must outlive the ${runtime.technique_deadline_ms}ms technique deadline`,
  );
  assert.equal(leaseSeconds, runtime.lease_seconds);
  // begin_ideation_run rejects anything outside 60..600.
  assert.ok(leaseSeconds >= 60 && leaseSeconds <= 600);
  // Every renewal uses the same duration the run was created with.
  for (const args of harness.persistence.renewArgs) {
    assert.equal(Number(args.p_lease_seconds), leaseSeconds);
  }
});

test("a worker that loses its lease during a slow provider response cannot persist", async () => {
  const harness = makeHarness({
    // The pre-generation renewal succeeds; ownership is lost while the provider
    // is still responding, so the post-generation ownership check fails.
    renewErrorAfterCalls: 1,
    slowModelMs: 20,
  });
  const response = await harness.handler(request());

  assert.equal(harness.calls.generate, 3, "generation still ran");
  assert.equal(harness.persistence.completeCalls, 0, "nothing may be persisted after losing the lease");
  assert.equal(harness.persistence.failCalls, 1, "the run is driven to a recorded terminal state");
  assert.equal(response.status, 500);

  const payload = await body(response);
  const error = payload.error as Record<string, unknown>;
  assert.equal(error.code, "IDEATION_ORCHESTRATION_FAILED");
  assert.equal(error.retryable, false);
  assert.ok(String(error.message).includes("LEASE_HEARTBEAT_FAILED"));
  assert.ok(!JSON.stringify(payload).includes("lease_owner="));
});

test("a provider connect timeout behaves exactly like the whole-call timeout", async () => {
  const failure = {
    error: "Anthropic request was not established in time.",
    retryable: true,
  };

  // While attempts remain, both timeout codes are retryable shortfalls, not
  // terminal failures — HTTP status stays independent of retryability.
  for (const code of ["ANTHROPIC_TIMEOUT", "ANTHROPIC_CONNECT_TIMEOUT"]) {
    const harness = makeHarness({ modelFailure: { code, ...failure } });
    const response = await harness.handler(request());
    const payload = await body(response);

    assert.equal(response.status, 202, code);
    assert.equal((payload.run as Record<string, unknown>).status, "retryable", code);
    const warnings = payload.warnings as Array<Record<string, unknown>>;
    assert.equal(warnings.length, 3, code);
    assert.equal(warnings.every((warning) => warning.retryable === true), true, code);
    assert.equal(warnings.every((warning) => warning.code === code), true, code);
    assert.equal(harness.persistence.completeCalls, 1, code);
  }

  // Once the run is terminal, both timeout codes report a gateway timeout.
  for (const code of ["ANTHROPIC_TIMEOUT", "ANTHROPIC_CONNECT_TIMEOUT"]) {
    const harness = makeHarness({ modelFailure: { code, ...failure }, attemptCount: 3 });
    const response = await harness.handler(request());
    const payload = await body(response);

    assert.equal(response.status, 504, code);
    const error = payload.error as Record<string, unknown>;
    assert.equal(error.code, code);
    assert.equal(error.retryable, false, "an exhausted run is not retryable");
    const details = error.details as Record<string, unknown>;
    assert.equal(details.retry_allowed, false);
    assert.equal(details.shortfall, 3);
    assert.equal(details.maximum_attempts, 3);
  }
});

test("telemetry context reaches the model boundary and carries no content", async () => {
  const harness = makeHarness();
  await harness.handler(request());

  assert.equal(harness.calls.telemetry.length, 3);
  for (const entry of harness.calls.telemetry) {
    assert.equal(entry.cycleId, CYCLE_ID);
    assert.equal(entry.attemptNumber, 1);
    assert.ok(IDEATION_TECHNIQUE_SLUGS.includes(entry.techniqueSlug as typeof IDEATION_TECHNIQUE_SLUGS[number]));
    // Identifiers and counters only — never authority, prompts, or candidates.
    assert.deepEqual(Object.keys(entry).sort(), ["attemptNumber", "cycleId", "techniqueSlug"]);
  }
  assert.deepEqual(
    harness.calls.telemetry.map((entry) => entry.techniqueSlug).sort(),
    ["competitor-objections", "end-customer-complaints", "review-mined-pain-language"],
  );
});
