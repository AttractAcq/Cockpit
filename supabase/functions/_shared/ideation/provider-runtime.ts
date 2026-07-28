// Server-side provider time and output budgets for Ideation Stage 1.
//
// SERVER-SIDE ONLY. Every value here is bounded: an operator can tune the
// deadlines through Supabase secrets, but never make a model call unbounded and
// never push the worker past the platform wall clock.
//
// Platform constraint (already proven live by generate-production-brief): the
// edge worker is hard-killed at ~150s with HTTP 546 / WORKER_RESOURCE_LIMIT. The
// three sourcing techniques issue their provider calls concurrently, so a single
// technique's total deadline is effectively the request's whole model wall clock.
//
// Database constraint: begin_ideation_run rejects p_lease_seconds outside
// 60..600, so the derived lease is clamped into that window.

export interface IdeationBoundedSetting {
  readonly env: string;
  readonly default: number;
  readonly minimum: number;
  readonly maximum: number;
  /** When present, this exact value is accepted as "feature disabled". */
  readonly disabled_value?: number;
}

export type IdeationSettingSource =
  | "default"
  | "environment"
  | "clamped_to_minimum"
  | "clamped_to_maximum"
  | "invalid_fallback"
  | "coherence_clamped";

/**
 * Bounded provider deadlines.
 *
 * `call_timeout_ms` is the whole-call deadline for ONE provider request:
 * connection, provider response wait, and response-body read.
 * `technique_deadline_ms` bounds ALL provider calls for one technique, including
 * the single bounded correction attempt.
 *
 * `connect_timeout_ms` is a narrower deadline for request establishment, and it
 * DEFAULTS TO DISABLED (0). Live testing on 2026-07-28 confirmed why: the
 * Anthropic adapter is non-streaming, so the provider withholds response headers
 * until the completed message is ready. Time-to-headers therefore equals
 * time-to-full-response, and any connect deadline shorter than normal generation
 * latency aborts healthy calls — a 20s default did exactly that, failing both
 * sourcing techniques with ANTHROPIC_CONNECT_TIMEOUT after 20s.
 *
 * The separate phase is kept, bounded and opt-in, because it is meaningful for a
 * provider that does send headers early. It is not enabled by default because
 * this boundary cannot observe the two phases separately.
 */
export const IDEATION_PROVIDER_TIME_POLICY = Object.freeze({
  connect_timeout_ms: Object.freeze({
    env: "AA_IDEATION_PROVIDER_CONNECT_TIMEOUT_MS",
    /** 0 disables the separate request-establishment deadline. */
    default: 0,
    disabled_value: 0,
    minimum: 5_000,
    maximum: 60_000,
  }),
  call_timeout_ms: Object.freeze({
    env: "AA_IDEATION_PROVIDER_CALL_TIMEOUT_MS",
    default: 95_000,
    minimum: 40_000,
    maximum: 180_000,
  }),
  technique_deadline_ms: Object.freeze({
    env: "AA_IDEATION_TECHNIQUE_DEADLINE_MS",
    default: 135_000,
    minimum: 45_000,
    maximum: 300_000,
  }),
  minimum_correction_budget_ms: Object.freeze({
    env: "AA_IDEATION_MIN_CORRECTION_BUDGET_MS",
    default: 45_000,
    minimum: 20_000,
    maximum: 150_000,
  }),
});

/**
 * Deterministic slot-aware output budget.
 *
 * `base_tokens` covers the fixed part of the response contract — the four
 * structured_findings arrays and the JSON envelope — which does not shrink when
 * a technique is allocated a single slot. `per_slot_tokens` covers one candidate
 * plus the evidence references every persisted candidate field requires.
 */
export const IDEATION_OUTPUT_TOKEN_POLICY = Object.freeze({
  base_tokens: 2_600,
  per_slot_tokens: 1_400,
  minimum_tokens: 4_000,
  maximum_tokens: 16_000,
  truncation_correction_multiplier: 1.5,
});

export const IDEATION_LEASE_POLICY = Object.freeze({
  // The lease must outlive the technique deadline, otherwise a worker could
  // finish a slow provider call holding a lease that already expired.
  safety_margin_seconds: 45,
  minimum_seconds: 60,
  maximum_seconds: 600,
  heartbeat_divisor: 3,
  minimum_heartbeat_interval_ms: 15_000,
});

/**
 * Hard prompt ceiling. Required approved authority is never silently truncated
 * mid-claim: if it cannot fit, the technique fails closed instead.
 */
export const IDEATION_PROMPT_BUDGET = Object.freeze({
  maximum_prompt_chars: 400_000,
  approximate_chars_per_token: 4,
});

export interface IdeationProviderRuntime {
  readonly connect_timeout_ms: number;
  readonly call_timeout_ms: number;
  readonly technique_deadline_ms: number;
  readonly minimum_correction_budget_ms: number;
  readonly lease_seconds: number;
  readonly heartbeat_interval_ms: number;
}

export interface IdeationProviderRuntimeResolution {
  readonly runtime: IdeationProviderRuntime;
  readonly sources: Readonly<Record<string, IdeationSettingSource>>;
}

/**
 * Reads a server-side environment value without assuming a Deno global. Returns
 * undefined under any runtime that does not expose one, so the documented
 * defaults apply identically in tests and in the edge runtime.
 */
function readEnvValue(name: string): string | undefined {
  const runtime = (globalThis as {
    Deno?: { env?: { get(name: string): string | undefined } };
  }).Deno;
  try {
    const value = runtime?.env?.get(name);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves one bounded setting. Malformed values fall back to the documented
 * default; out-of-range values are clamped to the documented bound. Never throws
 * and never returns an unbounded value.
 */
export function resolveBoundedSetting(
  setting: IdeationBoundedSetting,
): { value: number; source: IdeationSettingSource } {
  const raw = readEnvValue(setting.env)?.trim();
  if (raw === undefined || raw.length === 0) {
    return { value: setting.default, source: "default" };
  }
  if (!/^\d+$/.test(raw)) {
    return { value: setting.default, source: "invalid_fallback" };
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return { value: setting.default, source: "invalid_fallback" };
  }
  if (setting.disabled_value !== undefined && parsed === setting.disabled_value) {
    return { value: setting.disabled_value, source: "environment" };
  }
  if (parsed === 0) {
    return { value: setting.default, source: "invalid_fallback" };
  }
  if (parsed < setting.minimum) {
    return { value: setting.minimum, source: "clamped_to_minimum" };
  }
  if (parsed > setting.maximum) {
    return { value: setting.maximum, source: "clamped_to_maximum" };
  }
  return { value: parsed, source: "environment" };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.round(value), minimum), maximum);
}

/** Lease duration that safely covers the supplied technique deadline. */
export function ideationLeaseSecondsFor(techniqueDeadlineMs: number): number {
  return clampInteger(
    Math.ceil(techniqueDeadlineMs / 1000) + IDEATION_LEASE_POLICY.safety_margin_seconds,
    IDEATION_LEASE_POLICY.minimum_seconds,
    IDEATION_LEASE_POLICY.maximum_seconds,
  );
}

/** Heartbeat cadence that renews a lease several times before it can expire. */
export function ideationHeartbeatIntervalMsFor(leaseSeconds: number): number {
  return Math.max(
    IDEATION_LEASE_POLICY.minimum_heartbeat_interval_ms,
    Math.floor((leaseSeconds * 1000) / IDEATION_LEASE_POLICY.heartbeat_divisor),
  );
}

/**
 * Resolves the effective provider runtime from bounded environment settings and
 * reconciles the settings with each other so no deadline can exceed the budget
 * that contains it.
 */
export function resolveIdeationProviderRuntimeDetailed(): IdeationProviderRuntimeResolution {
  const deadline = resolveBoundedSetting(IDEATION_PROVIDER_TIME_POLICY.technique_deadline_ms);
  const call = resolveBoundedSetting(IDEATION_PROVIDER_TIME_POLICY.call_timeout_ms);
  const connect = resolveBoundedSetting(IDEATION_PROVIDER_TIME_POLICY.connect_timeout_ms);
  const correction = resolveBoundedSetting(IDEATION_PROVIDER_TIME_POLICY.minimum_correction_budget_ms);

  const techniqueDeadlineMs = deadline.value;
  const callTimeoutMs = Math.min(call.value, techniqueDeadlineMs);
  // 0 means disabled: the whole-call deadline governs the entire request.
  const connectTimeoutMs = connect.value === 0 ? 0 : Math.min(connect.value, callTimeoutMs);
  const minimumCorrectionBudgetMs = Math.min(correction.value, techniqueDeadlineMs);
  const leaseSeconds = ideationLeaseSecondsFor(techniqueDeadlineMs);

  return {
    runtime: Object.freeze({
      connect_timeout_ms: connectTimeoutMs,
      call_timeout_ms: callTimeoutMs,
      technique_deadline_ms: techniqueDeadlineMs,
      minimum_correction_budget_ms: minimumCorrectionBudgetMs,
      lease_seconds: leaseSeconds,
      heartbeat_interval_ms: ideationHeartbeatIntervalMsFor(leaseSeconds),
    }),
    sources: Object.freeze({
      technique_deadline_ms: deadline.source,
      call_timeout_ms: callTimeoutMs === call.value ? call.source : "coherence_clamped",
      connect_timeout_ms: connectTimeoutMs === connect.value ? connect.source : "coherence_clamped",
      minimum_correction_budget_ms: minimumCorrectionBudgetMs === correction.value
        ? correction.source
        : "coherence_clamped",
    }),
  };
}

export function resolveIdeationProviderRuntime(): IdeationProviderRuntime {
  return resolveIdeationProviderRuntimeDetailed().runtime;
}

/** Deterministic output-token budget for one technique's requested slots. */
export function ideationOutputTokenBudget(slotCount: number): number {
  const slots = Number.isSafeInteger(slotCount) && slotCount > 0 ? slotCount : 0;
  return clampInteger(
    IDEATION_OUTPUT_TOKEN_POLICY.base_tokens + (slots * IDEATION_OUTPUT_TOKEN_POLICY.per_slot_tokens),
    IDEATION_OUTPUT_TOKEN_POLICY.minimum_tokens,
    IDEATION_OUTPUT_TOKEN_POLICY.maximum_tokens,
  );
}

/**
 * Capped allowance for the single bounded correction attempt that follows a
 * truncated response. It can never exceed the documented maximum, and there is
 * only ever one correction attempt, so the budget cannot grow without limit.
 */
export function ideationTruncationCorrectionTokenBudget(baseTokens: number): number {
  return clampInteger(
    baseTokens * IDEATION_OUTPUT_TOKEN_POLICY.truncation_correction_multiplier,
    IDEATION_OUTPUT_TOKEN_POLICY.minimum_tokens,
    IDEATION_OUTPUT_TOKEN_POLICY.maximum_tokens,
  );
}

/** Locally calculable prompt-size estimate. Never includes prompt content. */
export function approximatePromptTokens(promptChars: number): number {
  return Math.ceil(promptChars / IDEATION_PROMPT_BUDGET.approximate_chars_per_token);
}
