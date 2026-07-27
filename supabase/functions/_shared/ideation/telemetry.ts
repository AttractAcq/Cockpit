// Non-sensitive operational telemetry for Ideation Stage 1 provider reliability.
//
// This module exists so provider reliability can be diagnosed from edge logs
// without ever writing authority, prompts, research bodies, candidate bodies, or
// credentials to a log sink. Only the allow-listed shapes below are emitted, and
// every field is a count, a duration, an identifier, or a typed code.

const TELEMETRY_EVENT = "ideation.provider";

export interface IdeationProviderCallTelemetry {
  cycle_id: string | null;
  technique_slug: string;
  attempt_number: number;
  /** 0 for the first provider call, 1 for the bounded correction attempt. */
  call_index: number;
  correction_reason: "none" | "format" | "truncation";
  requested_slot_count: number;
  prompt_chars: number;
  approximate_prompt_tokens: number;
  selected_source_count: number;
  research_result_count: number;
  configured_output_tokens: number;
  configured_call_timeout_ms: number;
  configured_connect_timeout_ms: number;
  technique_deadline_ms: number;
  elapsed_ms: number;
  remaining_budget_ms: number;
  outcome: "ok" | "provider_failure" | "validation_failure";
  stop_reason: string | null;
  failure_code: string | null;
  retryable: boolean | null;
}

export interface IdeationLeaseTelemetry {
  cycle_id: string;
  event: "heartbeat_ok" | "heartbeat_failed" | "ownership_checked" | "ownership_lost";
  elapsed_ms: number;
  lease_seconds: number;
  heartbeat_interval_ms: number;
}

function emit(payload: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify({ event: TELEMETRY_EVENT, ...payload }));
  } catch {
    // Telemetry must never influence generation control flow.
  }
}

export function logIdeationProviderCall(telemetry: IdeationProviderCallTelemetry): void {
  emit({ kind: "provider_call", ...telemetry });
}

export function logIdeationLease(telemetry: IdeationLeaseTelemetry): void {
  emit({ kind: "lease", ...telemetry });
}
