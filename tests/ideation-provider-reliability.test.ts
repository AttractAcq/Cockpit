// Regression tests for the live Ideation Stage 1 provider failures:
//   review-mined-pain-language -> ANTHROPIC_TRUNCATED (fixed 2 200-token budget)
//   competitor-objections      -> ANTHROPIC_TIMEOUT   (35s correction deadline)
//
// No test in this file performs a real provider call. The Anthropic boundary is
// exercised through an injected fetch, and every environment value is injected
// through a replaced Deno global.

import assert from "node:assert/strict";
import { test } from "node:test";
import { callAnthropic } from "../supabase/functions/_shared/anthropic.ts";
import {
  approximatePromptTokens,
  ideationHeartbeatIntervalMsFor,
  ideationLeaseSecondsFor,
  ideationOutputTokenBudget,
  ideationTruncationCorrectionTokenBudget,
  IDEATION_LEASE_POLICY,
  IDEATION_OUTPUT_TOKEN_POLICY,
  IDEATION_PROMPT_BUDGET,
  IDEATION_PROVIDER_TIME_POLICY,
  resolveBoundedSetting,
  resolveIdeationProviderRuntime,
  resolveIdeationProviderRuntimeDetailed,
} from "../supabase/functions/_shared/ideation/provider-runtime.ts";
import { buildClaimCards } from "../supabase/functions/_shared/ideation/claim-cards.ts";
import {
  buildSupportUnits,
  normalizeExcerptForUnits,
  uncoveredSubstantiveText,
} from "../supabase/functions/_shared/ideation/support-units.ts";
import {
  buildIdeationPrompts,
  generateTechniqueCandidates,
} from "../supabase/functions/_shared/ideation/model.ts";
import {
  buildIdeationConfigurationSnapshot,
  hashIdeationConfiguration,
} from "../supabase/functions/_shared/ideation/configuration.ts";
import { isRetryableIdeationFailure } from "../supabase/functions/_shared/ideation/errors.ts";
import type { IdeationEvidenceSource } from "../supabase/functions/_shared/ideation/evidence.ts";
import type { TechniqueResearch } from "../supabase/functions/_shared/ideation/techniques/types.ts";
import { decodeIdeationFailureBody } from "../src/lib/ideation-failure.ts";

/* ------------------------------------------------------------------ */
/* Injected runtime                                                    */
/* ------------------------------------------------------------------ */

interface TestGlobals {
  Deno?: { env: { get(name: string): string | undefined } };
  fetch: typeof fetch;
}

const globals = globalThis as unknown as TestGlobals;

const AI_ENV: Record<string, string> = {
  AA_AI_GENERATION_ENABLED: "true",
  ANTHROPIC_API_KEY: "test-only-never-logged",
};

function withEnv<T>(env: Record<string, string>, run: () => T): T {
  const originalDeno = globals.Deno;
  globals.Deno = { env: { get: (name: string) => ({ ...AI_ENV, ...env })[name] } };
  try {
    return run();
  } finally {
    globals.Deno = originalDeno;
  }
}

/** Async variant: the injected environment must survive every await inside run. */
async function withEnvAsync<T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const originalDeno = globals.Deno;
  globals.Deno = { env: { get: (name: string) => ({ ...AI_ENV, ...env })[name] } };
  try {
    return await run();
  } finally {
    globals.Deno = originalDeno;
  }
}

async function withProvider<T>(
  env: Record<string, string>,
  handler: (init: RequestInit | undefined) => Promise<Response> | Response,
  run: () => Promise<T>,
): Promise<T> {
  const originalDeno = globals.Deno;
  const originalFetch = globals.fetch;
  globals.Deno = { env: { get: (name: string) => ({ ...AI_ENV, ...env })[name] } };
  globals.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => handler(init)) as typeof fetch;
  try {
    return await run();
  } finally {
    globals.Deno = originalDeno;
    globals.fetch = originalFetch;
  }
}

function requestedMaxTokens(init: RequestInit | undefined): number {
  return JSON.parse(String(init?.body ?? "{}")).max_tokens as number;
}

/**
 * A provider that never sends response headers. It honours the abort signal the
 * way a real fetch does, so the adapter's own deadline is what ends the call.
 */
function neverRespondsToHeaders(init: RequestInit | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
}

/* ------------------------------------------------------------------ */
/* Grounded fixtures                                                   */
/* ------------------------------------------------------------------ */

const EXCERPT = "Buyers feel invisible when their strongest proof stays hidden. They want visible authority.";

const contextSource: IdeationEvidenceSource = {
  source_id: "context:c1:v1",
  source_ref: "02_Avatar_And_Buyer_Psychology.md",
  source_type: "approved_context",
  source_url: "aa-authority://client/client-1/context/c1",
  bounded_excerpt: EXCERPT,
  content_hash: "a".repeat(64),
};

const strategicSource: IdeationEvidenceSource = {
  ...contextSource,
  source_id: "strategic:s1:v1",
  source_ref: "09_Content_System.md",
  source_type: "approved_strategic_playbook",
  source_url: "aa-authority://client/client-1/context/s1",
  bounded_excerpt: "Use proof-led education and the approved messaging hierarchy.",
  content_hash: "b".repeat(64),
};

const executionSource: IdeationEvidenceSource = {
  ...contextSource,
  source_id: "execution:e1:v1",
  source_ref: "2026-07:11_Stage_2_SOP_and_Laws.md",
  source_type: "approved_execution",
  source_url: "aa-authority://client/client-1/execution/e1",
  bounded_excerpt: "Never use unsupported guarantees. Reels must use the approved channel format.",
  content_hash: "c".repeat(64),
};

function research(sources: IdeationEvidenceSource[]): TechniqueResearch {
  return {
    researchKey: "technique-2",
    techniqueSlug: "review-mined-pain-language",
    sourceIdentifier: "context:c1",
    sourceType: "approved_context",
    sourceUrl: contextSource.source_url,
    sourceTitle: "Approved Pain-Language Authority",
    sourceExcerpt: EXCERPT,
    sourceProvider: "approved_client_authority",
    retrievedAt: "2026-07-27T00:00:00.000Z",
    contentHash: contextSource.content_hash,
    status: "processed",
    structuredFindings: {},
    evidenceSources: sources,
  } satisfies TechniqueResearch;
}

function promptInput(overrides: Partial<Parameters<typeof buildIdeationPrompts>[0]> = {}) {
  return {
    clientName: "Attract Acquisition",
    techniqueSlug: "review-mined-pain-language",
    techniqueName: "Review-Mined Pain Language",
    techniqueFocus: "Pain language, objections, and supported phrasing.",
    research: research([contextSource]),
    // Deliberately re-supplies the same context source through both standing
    // references, which is exactly what the live persona/format modules do.
    personaReference: research([contextSource, strategicSource]),
    formatReference: research([contextSource]),
    executionSources: [executionSource],
    assetTypes: ["reel"] as const,
    ...overrides,
  } as Parameters<typeof buildIdeationPrompts>[0];
}

const FINDINGS = {
  pain_language: ["proof stays hidden"],
  objections: ["strongest proof stays hidden"],
  desired_outcomes: ["visible authority"],
  content_opportunities: ["show hidden proof as visible authority"],
};

/**
 * Evidence policy v2 unit ids are content-derived, so the fixture resolves them
 * from the real parser rather than hardcoding a hash.
 */
const CONTEXT_UNITS = await buildSupportUnits(contextSource);
/**
 * The widest unit covering the whole excerpt, so this fixture keeps exactly the
 * v1 semantics of citing the entire bounded excerpt. Narrow-unit grounding has
 * its own dedicated tests.
 */
function _widestUnitId(): string {
  const unit = [...CONTEXT_UNITS].sort((left, right) => right.raw_span.length - left.raw_span.length)[0];
  if (!unit) throw new Error("The fixture source produced no support unit.");
  return unit.support_unit_id;
}

const CONTEXT_CARDS = await buildClaimCards(CONTEXT_UNITS);
function widestCardId(): string {
  const card = [...CONTEXT_CARDS].sort((left, right) => right.normalized_text.length - left.normalized_text.length)[0];
  if (!card) throw new Error("The fixture source produced no claim card.");
  return card.claim_card_id;
}

function groundedCandidate() {
  // The server owns the facts; the model only selects a card and writes copy.
  return {
    candidate_index: 1,
    asset_type: "reel",
    claim_card_ids: [widestCardId()],
    working_title: { text: "The hidden proof problem" },
    hook: { text: "Your strongest proof is hidden. Here is why that matters." },
    core_message: { text: "Buyers feel invisible when their strongest proof stays hidden" },
    psychological_angle: { code: "proof_visibility" },
    cta: { text: "Look at what your proof is doing right now" },
  };
}

function providerResponse(body: unknown, stopReason = "end_turn"): Response {
  return new Response(
    JSON.stringify({
      stop_reason: stopReason,
      content: [{ type: "text", text: JSON.stringify(body) }],
    }),
    { status: 200 },
  );
}

/* ================================================================== */
/* 1-5, 10  Timeout configuration                                      */
/* ================================================================== */

test("default provider deadlines exceed the old 35s constraint and stay bounded", () => {
  const runtime = withEnv({}, resolveIdeationProviderRuntime);

  // The live failure was "Anthropic call timed out after 35s."
  assert.ok(runtime.call_timeout_ms > 35_000, "default whole-call deadline must clear the old 35s constraint");
  assert.equal(runtime.call_timeout_ms, IDEATION_PROVIDER_TIME_POLICY.call_timeout_ms.default);
  assert.equal(runtime.technique_deadline_ms, IDEATION_PROVIDER_TIME_POLICY.technique_deadline_ms.default);
  assert.ok(runtime.call_timeout_ms <= runtime.technique_deadline_ms, "one call may never outlive the technique");

  // The separate request-establishment deadline defaults to disabled. The
  // adapter is non-streaming, so the provider withholds headers until the whole
  // message is ready; a 20s connect default aborted healthy calls in live
  // testing on 2026-07-28.
  assert.equal(runtime.connect_timeout_ms, 0, "connect deadline must default to disabled");

  // Never unbounded, and never past the ~150s edge worker wall clock by default.
  assert.ok(Number.isFinite(runtime.technique_deadline_ms));
  assert.ok(runtime.technique_deadline_ms <= 150_000);
});

test("valid environment overrides are accepted for every bounded deadline", () => {
  const runtime = withEnv({
    AA_IDEATION_PROVIDER_CONNECT_TIMEOUT_MS: "25000",
    AA_IDEATION_PROVIDER_CALL_TIMEOUT_MS: "110000",
    AA_IDEATION_TECHNIQUE_DEADLINE_MS: "140000",
    AA_IDEATION_MIN_CORRECTION_BUDGET_MS: "50000",
  }, resolveIdeationProviderRuntime);

  assert.equal(runtime.connect_timeout_ms, 25_000);
  assert.equal(runtime.call_timeout_ms, 110_000);
  assert.equal(runtime.technique_deadline_ms, 140_000);
  assert.equal(runtime.minimum_correction_budget_ms, 50_000);
});

test("malformed environment overrides fall back to the documented default", () => {
  for (const malformed of ["", "   ", "abc", "-1", "9e9", "12.5", "0", "NaN", "60_000"]) {
    const resolved = withEnv(
      { AA_IDEATION_PROVIDER_CALL_TIMEOUT_MS: malformed },
      () => resolveBoundedSetting(IDEATION_PROVIDER_TIME_POLICY.call_timeout_ms),
    );
    assert.equal(
      resolved.value,
      IDEATION_PROVIDER_TIME_POLICY.call_timeout_ms.default,
      `"${malformed}" must fall back safely`,
    );
    assert.ok(["default", "invalid_fallback"].includes(resolved.source));
  }
});

test("out-of-range overrides are clamped to the documented minimum and maximum", () => {
  const low = withEnv(
    { AA_IDEATION_PROVIDER_CALL_TIMEOUT_MS: "1000" },
    () => resolveBoundedSetting(IDEATION_PROVIDER_TIME_POLICY.call_timeout_ms),
  );
  assert.equal(low.value, IDEATION_PROVIDER_TIME_POLICY.call_timeout_ms.minimum);
  assert.equal(low.source, "clamped_to_minimum");

  const high = withEnv(
    { AA_IDEATION_PROVIDER_CALL_TIMEOUT_MS: "99999999" },
    () => resolveBoundedSetting(IDEATION_PROVIDER_TIME_POLICY.call_timeout_ms),
  );
  assert.equal(high.value, IDEATION_PROVIDER_TIME_POLICY.call_timeout_ms.maximum);
  assert.equal(high.source, "clamped_to_maximum");

  // A model call can never be made unbounded through configuration.
  const maxed = withEnv({
    AA_IDEATION_TECHNIQUE_DEADLINE_MS: "99999999",
    AA_IDEATION_PROVIDER_CALL_TIMEOUT_MS: "99999999",
  }, resolveIdeationProviderRuntime);
  assert.equal(maxed.technique_deadline_ms, IDEATION_PROVIDER_TIME_POLICY.technique_deadline_ms.maximum);
  assert.equal(maxed.call_timeout_ms, IDEATION_PROVIDER_TIME_POLICY.call_timeout_ms.maximum);
});

test("a call deadline may never exceed the technique deadline that contains it", () => {
  const resolution = withEnv({
    AA_IDEATION_TECHNIQUE_DEADLINE_MS: "45000",
    AA_IDEATION_PROVIDER_CALL_TIMEOUT_MS: "180000",
    AA_IDEATION_PROVIDER_CONNECT_TIMEOUT_MS: "60000",
  }, resolveIdeationProviderRuntimeDetailed);

  assert.equal(resolution.runtime.technique_deadline_ms, 45_000);
  assert.equal(resolution.runtime.call_timeout_ms, 45_000);
  assert.equal(resolution.runtime.connect_timeout_ms, 45_000);
  assert.equal(resolution.sources.call_timeout_ms, "coherence_clamped");
});

test("the request-establishment deadline is opt-in and explicitly disablable", () => {
  // Disabled by default, and explicitly disablable.
  assert.equal(withEnv({}, resolveIdeationProviderRuntime).connect_timeout_ms, 0);
  assert.equal(
    withEnv({ AA_IDEATION_PROVIDER_CONNECT_TIMEOUT_MS: "0" }, resolveIdeationProviderRuntime).connect_timeout_ms,
    0,
  );
  // When enabled it is still bounded.
  assert.equal(
    withEnv({ AA_IDEATION_PROVIDER_CONNECT_TIMEOUT_MS: "30000" }, resolveIdeationProviderRuntime).connect_timeout_ms,
    30_000,
  );
  assert.equal(
    withEnv({ AA_IDEATION_PROVIDER_CONNECT_TIMEOUT_MS: "100" }, resolveIdeationProviderRuntime).connect_timeout_ms,
    IDEATION_PROVIDER_TIME_POLICY.connect_timeout_ms.minimum,
  );
  assert.equal(
    withEnv({ AA_IDEATION_PROVIDER_CONNECT_TIMEOUT_MS: "999999" }, resolveIdeationProviderRuntime).connect_timeout_ms,
    IDEATION_PROVIDER_TIME_POLICY.connect_timeout_ms.maximum,
  );
});

test("lease duration and heartbeat cadence safely cover the configured model deadline", () => {
  for (const deadline of [45_000, 135_000, 200_000, 300_000]) {
    const leaseSeconds = ideationLeaseSecondsFor(deadline);
    const heartbeatMs = ideationHeartbeatIntervalMsFor(leaseSeconds);

    // The lease must outlive the deadline, or a slow response could finish
    // holding an already-expired lease.
    assert.ok(
      leaseSeconds * 1000 > deadline,
      `lease ${leaseSeconds}s must outlive a ${deadline}ms deadline`,
    );
    // begin_ideation_run rejects p_lease_seconds outside 60..600.
    assert.ok(leaseSeconds >= IDEATION_LEASE_POLICY.minimum_seconds);
    assert.ok(leaseSeconds <= IDEATION_LEASE_POLICY.maximum_seconds);
    // Several heartbeats must fit inside one lease.
    assert.ok(heartbeatMs * 2 < leaseSeconds * 1000);
  }

  const runtime = withEnv({}, resolveIdeationProviderRuntime);
  assert.ok(runtime.lease_seconds * 1000 > runtime.technique_deadline_ms);
  assert.ok(runtime.heartbeat_interval_ms < runtime.lease_seconds * 1000);
});

/* ================================================================== */
/* 6-8  Typed timeout failures and abort cleanup                       */
/* ================================================================== */

test("request-establishment timeout is a distinct typed retryable failure", async () => {
  const result = await withProvider({}, neverRespondsToHeaders, async () =>
    await callAnthropic({
      system: "s",
      user: "u",
      timeoutMs: 400,
      connectTimeoutMs: 30,
    }));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "ANTHROPIC_CONNECT_TIMEOUT");
    assert.equal(result.retryable, true);
    assert.equal(isRetryableIdeationFailure(result.code), true);
  }
});

test("response-body timeout remains the typed retryable whole-call failure", async () => {
  const result = await withProvider({}, (init) => {
    // Headers arrive immediately; the body never completes.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener("abort", () =>
          controller.error(new DOMException("Aborted", "AbortError")));
      },
    });
    return new Response(stream, { status: 200 });
  }, async () =>
    await callAnthropic({
      system: "s",
      user: "u",
      timeoutMs: 60,
      // A connect deadline that already passed must NOT mislabel a body stall.
      connectTimeoutMs: 30,
    }));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "ANTHROPIC_TIMEOUT");
    assert.equal(result.retryable, true);
  }
});

test("abort timers are always cleaned up, on success and on timeout", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const live = new Set<unknown>();
  (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
    handler: TimerHandler,
    ms?: number,
    ...rest: unknown[]
  ) => {
    const id = (originalSetTimeout as (...a: unknown[]) => unknown)(handler, ms, ...rest);
    live.add(id);
    return id;
  }) as typeof setTimeout;
  (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = ((id: unknown) => {
    live.delete(id);
    return (originalClearTimeout as (...a: unknown[]) => unknown)(id);
  }) as typeof clearTimeout;

  try {
    await withProvider({}, () => providerResponse({ ok: true }), async () => {
      await callAnthropic({ system: "s", user: "u", timeoutMs: 5_000, connectTimeoutMs: 2_000 });
    });
    assert.equal(live.size, 0, "a successful call must leave no live abort timer");

    await withProvider({}, neverRespondsToHeaders, async () => {
      await callAnthropic({ system: "s", user: "u", timeoutMs: 200, connectTimeoutMs: 20 });
    });
    assert.equal(live.size, 0, "a timed-out call must leave no live abort timer");
  } finally {
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = originalSetTimeout;
    (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = originalClearTimeout;
  }
});

/* ================================================================== */
/* 11-13  Slot-aware output budgets                                    */
/* ================================================================== */

test("a one-slot technique receives the required minimum output budget", () => {
  const budget = ideationOutputTokenBudget(1);

  // The live truncation happened at the old fixed 2 200-token floor.
  assert.ok(budget > 2_200, "a single slot must clear the budget that truncated live");
  assert.equal(budget, IDEATION_OUTPUT_TOKEN_POLICY.minimum_tokens);
  assert.ok(budget >= IDEATION_OUTPUT_TOKEN_POLICY.base_tokens + IDEATION_OUTPUT_TOKEN_POLICY.per_slot_tokens);
});

test("multi-slot techniques receive a larger deterministic budget", () => {
  const one = ideationOutputTokenBudget(1);
  const two = ideationOutputTokenBudget(2);
  const four = ideationOutputTokenBudget(4);

  assert.ok(two > one);
  assert.ok(four > two);
  assert.equal(
    two,
    IDEATION_OUTPUT_TOKEN_POLICY.base_tokens + (2 * IDEATION_OUTPUT_TOKEN_POLICY.per_slot_tokens),
  );
  assert.equal(four - two, 2 * IDEATION_OUTPUT_TOKEN_POLICY.per_slot_tokens);
  // Deterministic: same input, same budget, every time.
  assert.equal(ideationOutputTokenBudget(4), four);
  assert.equal(ideationOutputTokenBudget(0), IDEATION_OUTPUT_TOKEN_POLICY.minimum_tokens);
});

test("the output budget is capped and the correction allowance cannot grow without limit", () => {
  assert.equal(ideationOutputTokenBudget(1_000), IDEATION_OUTPUT_TOKEN_POLICY.maximum_tokens);
  assert.equal(ideationOutputTokenBudget(Number.MAX_SAFE_INTEGER), IDEATION_OUTPUT_TOKEN_POLICY.maximum_tokens);

  const one = ideationOutputTokenBudget(1);
  const corrected = ideationTruncationCorrectionTokenBudget(one);
  assert.ok(corrected > one, "a truncation correction must be allowed more room");
  assert.ok(corrected <= IDEATION_OUTPUT_TOKEN_POLICY.maximum_tokens);

  // Repeated application can never exceed the cap.
  let escalating = one;
  for (let i = 0; i < 20; i += 1) escalating = ideationTruncationCorrectionTokenBudget(escalating);
  assert.equal(escalating, IDEATION_OUTPUT_TOKEN_POLICY.maximum_tokens);
  assert.equal(
    ideationTruncationCorrectionTokenBudget(IDEATION_OUTPUT_TOKEN_POLICY.maximum_tokens),
    IDEATION_OUTPUT_TOKEN_POLICY.maximum_tokens,
  );
});

/* ================================================================== */
/* 14-17  Truncation rejection and the bounded correction              */
/* ================================================================== */

test("stop_reason max_tokens always fails, even when the JSON parses cleanly", async () => {
  let calls = 0;
  const result = await withProvider({}, () => {
    calls += 1;
    // Structurally valid, fully grounded output — but the provider reported it
    // stopped at the token limit, so it is not a guaranteed complete response.
    return providerResponse(
      { structured_findings: FINDINGS, candidates: [groundedCandidate()] },
      "max_tokens",
    );
  }, () => generateTechniqueCandidates(promptInput()));

  assert.equal(result.ok, false, "valid-looking truncated JSON must never be accepted");
  if (!result.ok) {
    assert.equal(result.code, "ANTHROPIC_TRUNCATED");
    assert.equal(result.retryable, true, "truncation stays typed and retryable");
    assert.equal(isRetryableIdeationFailure(result.code), true);
  }
  assert.equal(calls, 2, "one bounded correction attempt, then a typed failure");
});

test("a truncation correction receives the permitted increased budget exactly once", async () => {
  const budgets: number[] = [];
  const result = await withProvider({}, (init) => {
    budgets.push(requestedMaxTokens(init));
    return budgets.length === 1
      ? providerResponse({ structured_findings: FINDINGS, candidates: [groundedCandidate()] }, "max_tokens")
      : providerResponse({ structured_findings: FINDINGS, candidates: [groundedCandidate()] });
  }, () => generateTechniqueCandidates(promptInput()));

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.retried, true);
  assert.equal(budgets.length, 2);
  assert.equal(budgets[0], ideationOutputTokenBudget(1));
  assert.equal(budgets[1], ideationTruncationCorrectionTokenBudget(ideationOutputTokenBudget(1)));
  assert.ok(budgets[1] > budgets[0]);
  assert.ok(budgets[1] <= IDEATION_OUTPUT_TOKEN_POLICY.maximum_tokens);
});

test("a provider timeout is returned as a typed retryable failure without a second call", async () => {
  let calls = 0;
  const result = await withProvider({
    // Keep the regression fast: the behaviour under test is the typed failure
    // and the absence of a second call, not the wall-clock value itself.
    AA_IDEATION_PROVIDER_CONNECT_TIMEOUT_MS: "5000",
    AA_IDEATION_PROVIDER_CALL_TIMEOUT_MS: "40000",
    AA_IDEATION_TECHNIQUE_DEADLINE_MS: "45000",
  }, (init) => {
    calls += 1;
    return neverRespondsToHeaders(init);
  }, () => generateTechniqueCandidates(promptInput()));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(["ANTHROPIC_TIMEOUT", "ANTHROPIC_CONNECT_TIMEOUT"].includes(result.code));
    assert.equal(result.retryable, true);
  }
  // A timeout is left to the cycle-level retry contract, not re-issued inside
  // the same request where it would risk the worker wall clock.
  assert.equal(calls, 1);
}, { timeout: 120_000 });

test("the correction is skipped when the technique deadline cannot absorb it", async () => {
  let calls = 0;
  const result = await withProvider({
    // A deadline smaller than the minimum correction budget leaves no room.
    AA_IDEATION_TECHNIQUE_DEADLINE_MS: "45000",
    AA_IDEATION_MIN_CORRECTION_BUDGET_MS: "150000",
  }, () => {
    calls += 1;
    return providerResponse({ structured_findings: FINDINGS, candidates: [groundedCandidate()] }, "max_tokens");
  }, () => generateTechniqueCandidates(promptInput()));

  assert.equal(calls, 1, "never issue a correction the deadline cannot afford");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "ANTHROPIC_TRUNCATED");
    assert.equal(result.retryable, true);
  }
});

/* ================================================================== */
/* 18  Configuration hashing                                           */
/* ================================================================== */

test("effective provider and token configuration participate in the idempotency hash", async () => {
  const snapshotInput = {
    clientId: "client-1",
    clientName: "Attract Acquisition",
    period: { periodType: "one_day", executionMonths: ["2026-07"] },
    quantityPlan: { total: 2 },
    slotAllocation: {
      "review-mined-pain-language": ["reel"],
      "competitor-objections": ["story"],
    },
    authority: { context: [], strategic_playbooks: [], execution: [] },
    selectedModel: "claude-sonnet-4-6",
  };

  const baseSnapshot = await withEnvAsync({}, () => buildIdeationConfigurationSnapshot(snapshotInput));
  const timeoutSnapshot = await withEnvAsync(
    { AA_IDEATION_PROVIDER_CALL_TIMEOUT_MS: "120000" },
    () => buildIdeationConfigurationSnapshot(snapshotInput),
  );
  const deadlineSnapshot = await withEnvAsync(
    { AA_IDEATION_TECHNIQUE_DEADLINE_MS: "150000" },
    () => buildIdeationConfigurationSnapshot(snapshotInput),
  );

  const baseHash = await hashIdeationConfiguration(baseSnapshot);
  const timeoutHash = await hashIdeationConfiguration(timeoutSnapshot);
  const deadlineHash = await hashIdeationConfiguration(deadlineSnapshot);

  assert.notEqual(baseHash, timeoutHash, "a changed provider deadline must change the hash");
  assert.notEqual(baseHash, deadlineHash, "a changed technique deadline must change the hash");

  // The effective values are auditable in the persisted snapshot.
  const model = baseSnapshot.model as Record<string, unknown>;
  const effective = model.effective as Record<string, unknown>;
  assert.equal(effective.call_timeout_ms, IDEATION_PROVIDER_TIME_POLICY.call_timeout_ms.default);
  assert.equal(effective.technique_deadline_ms, IDEATION_PROVIDER_TIME_POLICY.technique_deadline_ms.default);
  const budgets = effective.output_token_budgets as Record<string, { max_output_tokens: number }>;
  assert.equal(budgets["review-mined-pain-language"].max_output_tokens, ideationOutputTokenBudget(1));
  assert.equal(budgets["competitor-objections"].max_output_tokens, ideationOutputTokenBudget(1));

  // The lease persisted with the run still covers the deadline it must survive.
  const retry = baseSnapshot.retry_policy as Record<string, number>;
  assert.equal(retry.max_attempts, 3);
  assert.ok(retry.lease_seconds * 1000 > Number(effective.technique_deadline_ms));

  // Re-resolving identical configuration is deterministic.
  const repeat = await withEnvAsync({}, () => buildIdeationConfigurationSnapshot(snapshotInput));
  assert.equal(await hashIdeationConfiguration(repeat), baseHash);
});

/* ================================================================== */
/* 19-22  Prompt compaction                                            */
/* ================================================================== */

test("duplicate authority excerpts are supplied once and provenance is preserved", async () => {
  const prompts = await buildIdeationPrompts(promptInput());

  // The same approved context file reaches the prompt through research, the
  // persona reference, and the format reference.
  const excerptOccurrences = prompts.user.split(EXCERPT).length - 1;
  assert.equal(excerptOccurrences, 1, "an identical excerpt must appear exactly once");

  // Every source is still cited by identity, and every provenance field a
  // reference must copy verbatim is still present.
  for (const source of [contextSource, strategicSource, executionSource]) {
    assert.ok(prompts.user.includes(source.source_id), `${source.source_id} must remain citable`);
    assert.ok(prompts.user.includes(source.source_ref));
    assert.ok(prompts.user.includes(source.source_url));
    assert.ok(prompts.user.includes(source.content_hash));
    // Authority now reaches the model as server-owned claim cards. Coverage is
    // still checked at the unit level — no substantive line may be omitted —
    // and every cardable unit must be represented by exactly one card.
    const own = prompts.supportUnits.filter((unit) => unit.source_id === source.source_id);
    assert.ok(own.length > 0, `${source.source_id} must yield support units`);
    assert.deepEqual(
      uncoveredSubstantiveText(normalizeExcerptForUnits(source.bounded_excerpt), own),
      [],
      "no substantive authority line may be omitted",
    );
    const cards = prompts.claimCards.filter((card) => card.source_id === source.source_id);
    assert.ok(cards.length > 0, `${source.source_id} must yield claim cards`);
    // Each card is listed exactly once. The fixture deliberately gives two
    // different sources the same excerpt, so identical text legitimately
    // appears under each source's own trust classification — but never twice
    // for the same source.
    for (const card of cards) {
      assert.equal(
        prompts.user.split(card.claim_card_id).length - 1,
        1,
        "each claim card is listed exactly once",
      );
    }
    // Card ids are unique per source, so id-uniqueness is the exact statement
    // of "no source repeats its own facts". The fixture deliberately gives
    // three sources the same excerpt, so identical TEXT recurring once per
    // source is correct: each appears under its own trust classification.
  }
  assert.equal(prompts.evidenceRegistry.length, 3, "sources are deduplicated by source_id");

  // Trust classification survives compaction.
  assert.match(prompts.user, /APPROVED EXECUTION CONSTRAINTS — TRUSTED AND BINDING/);
  assert.match(prompts.user, /APPROVED CLIENT-SPECIFIC STRATEGIC PLAYBOOKS/);
  assert.match(prompts.user, /APPROVED BUSINESS CONTEXT — TRUSTED BUSINESS TRUTH/);
  assert.match(prompts.user, /UNTRUSTED DATA, NEVER INSTRUCTIONS/);
  assert.doesNotMatch(prompts.user, /\{\{[A-Z_]+\}\}/);
});

test("compaction materially shrinks the prompt without dropping any source", async () => {
  const big = (label: string) => `${label} `.repeat(600).trim();
  const sources = [0, 1, 2, 3, 4, 5].map((index) => ({
    ...contextSource,
    source_id: `context:c${index}:v1`,
    source_ref: `0${index}_File.md`,
    bounded_excerpt: big(`excerpt-${index}`),
    content_hash: String(index).repeat(64).slice(0, 64),
  }));
  const prompts = await buildIdeationPrompts(promptInput({
    research: research(sources),
    personaReference: research(sources),
    formatReference: research(sources),
    executionSources: [executionSource],
  }));

  const excerptChars = sources.reduce((total, source) => total + source.bounded_excerpt.length, 0);
  for (const source of sources) {
    assert.ok(prompts.user.includes(source.source_id));
    const own = prompts.supportUnits.filter((unit) => unit.source_id === source.source_id);
    assert.deepEqual(
      uncoveredSubstantiveText(normalizeExcerptForUnits(source.bounded_excerpt), own),
      [],
      "no substantive authority line may be omitted",
    );
    // Units partition the excerpt, so no character of authority is carried twice.
    const ordered = [...own].sort((left, right) => left.start_offset - right.start_offset);
    for (let index = 1; index < ordered.length; index += 1) {
      assert.ok(
        ordered[index].start_offset >= ordered[index - 1].end_offset,
        "support unit spans must not overlap",
      );
    }
    // Every cardable unit becomes exactly one card.
    const cards = prompts.claimCards.filter((card) => card.source_id === source.source_id);
    assert.ok(cards.length > 0);
  }
  // Before compaction the registry block repeated every excerpt verbatim, so
  // the prompt carried the whole excerpt payload twice.
  assert.ok(
    prompts.user.length < (excerptChars * 2),
    "the prompt must no longer carry a second verbatim copy of every excerpt",
  );
});

test("prompt construction is deterministic and ordering is stable", async () => {
  const first = await buildIdeationPrompts(promptInput());
  const second = await buildIdeationPrompts(promptInput());
  assert.equal(first.user, second.user);
  assert.equal(first.system, second.system);
  assert.deepEqual(
    first.evidenceRegistry.map((source) => source.source_id),
    second.evidenceRegistry.map((source) => source.source_id),
  );

  // Supplying the same sources in a different order changes nothing.
  const reordered = await buildIdeationPrompts(promptInput({
    research: research([strategicSource, contextSource]),
    personaReference: research([contextSource]),
    formatReference: research([strategicSource]),
  }));
  assert.deepEqual(
    reordered.evidenceRegistry.map((source) => source.source_id),
    first.evidenceRegistry.map((source) => source.source_id),
  );
});

test("required authority is never silently omitted — an oversized prompt fails closed", async () => {
  let calls = 0;
  const oversized = "x".repeat(IDEATION_PROMPT_BUDGET.maximum_prompt_chars + 1);
  const result = await withProvider({}, () => {
    calls += 1;
    return providerResponse({ structured_findings: FINDINGS, candidates: [groundedCandidate()] });
  }, () =>
    generateTechniqueCandidates(promptInput({
      research: research([{
        ...contextSource,
        source_id: "context:oversized:v1",
        content_hash: "d".repeat(64),
        bounded_excerpt: oversized,
      }]),
    })));

  assert.equal(calls, 0, "no truncated authority may ever be sent to the provider");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "IDEATION_PROMPT_BUDGET_EXCEEDED");
    assert.equal(result.retryable, false, "a configuration limit is not retryable");
    assert.equal(isRetryableIdeationFailure(result.code), false);
  }
  assert.ok(approximatePromptTokens(oversized.length) > 0);
});

test("conflicting content for one source_id fails closed rather than picking a copy", async () => {
  const result = await withProvider({}, () => providerResponse({}), () =>
    generateTechniqueCandidates(promptInput({
      research: research([contextSource]),
      personaReference: research([{ ...contextSource, content_hash: "f".repeat(64) }]),
    })));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "EVIDENCE_REGISTRY_INVALID");
    assert.equal(result.retryable, false);
  }
});

/* ================================================================== */
/* 28, 30  Leak safety and frontend compatibility                      */
/* ================================================================== */

test("provider failures never leak keys, prompts, authority, or provider payloads", async () => {
  const result = await withProvider({}, () =>
    new Response("boom: sk-ant-secret-value", { status: 500 }), () =>
    generateTechniqueCandidates(promptInput()));

  assert.equal(result.ok, false);
  if (!result.ok) {
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(AI_ENV.ANTHROPIC_API_KEY));
    assert.ok(!serialized.includes(EXCERPT), "no authority excerpt may appear in a failure");
    assert.ok(!serialized.includes("Attract Acquisition"));
    assert.equal(result.retryable, true, "provider 5xx stays retryable");
  }
});

test("timeout and truncation failures stay decodable by the frontend failure decoder", () => {
  for (const code of ["ANTHROPIC_TIMEOUT", "ANTHROPIC_CONNECT_TIMEOUT", "ANTHROPIC_TRUNCATED"]) {
    const decoded = decodeIdeationFailureBody({
      ok: false,
      error: {
        stage: "generation",
        code,
        message: "Technique did not fill its requested slots.",
        retryable: true,
        details: {
          cycle_id: "30000000-0000-4000-8000-000000000001",
          expected_total: 2,
          generated_total: 0,
          shortfall: 2,
          attempt_count: 1,
          maximum_attempts: 3,
          retry_allowed: true,
          cycle_status: "retryable",
          warnings: [{ technique: "competitor-objections", code, message: "m", retryable: true }],
        },
      },
    }, "fallback");

    assert.ok(decoded);
    assert.equal(decoded!.code, code);
    assert.equal(decoded!.retryable, true);
    assert.equal(decoded!.retry_allowed, true);
    assert.equal(decoded!.shortfall, 2);
    assert.equal(decoded!.warnings.length, 1);
    // No infrastructure detail is required by, or exposed to, the decoder.
    assert.ok(!JSON.stringify(decoded).includes("timeout_ms"));
  }
});
