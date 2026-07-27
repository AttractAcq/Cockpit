// Deno-compatible Anthropic API adapter for AA Cockpit edge functions.
//
// SERVER-SIDE ONLY. Reads keys from Deno.env at call time.
// Never logs, prints, or returns the API key.
// Fails closed: if the key is absent or the gate is off, returns an error — never silently proceeds.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

export const DEFAULT_AI_MODEL = "claude-opus-4-8";

export type AnthropicErrorCode =
  | "ANTHROPIC_DISABLED"
  | "ANTHROPIC_KEY_MISSING"
  | "ANTHROPIC_CONNECT_TIMEOUT"
  | "ANTHROPIC_TIMEOUT"
  | "ANTHROPIC_HTTP_ERROR"
  | "ANTHROPIC_RESPONSE_INVALID"
  | "ANTHROPIC_EMPTY_RESPONSE"
  | "ANTHROPIC_REFUSAL"
  | "ANTHROPIC_TRUNCATED"
  | "ANTHROPIC_FETCH_ERROR";

export type AnthropicResult =
  | { ok: true; text: string }
  | { ok: false; code: AnthropicErrorCode; error: string; retryable: boolean };

function anthropicFailure(
  code: AnthropicErrorCode,
  error: string,
  retryable: boolean,
): AnthropicResult {
  return { ok: false, code, error, retryable };
}

/** Returns true only if AA_AI_GENERATION_ENABLED is exactly "true" (case-insensitive). */
export function isAiEnabled(): boolean {
  return Deno.env.get("AA_AI_GENERATION_ENABLED")?.toLowerCase() === "true";
}

/** Returns true if ANTHROPIC_API_KEY is present and non-empty. Does not expose the value. */
export function hasAnthropicKey(): boolean {
  return (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim().length > 0;
}

export interface AnthropicCallOpts {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  /**
   * Whole-call deadline: connection, provider response wait, and response-body
   * read. Abort after this many ms. Default 300 000 (5 min).
   */
  timeoutMs?: number;
  /**
   * Narrower deadline for request establishment only — aborts if response
   * headers have not arrived in time, and reports ANTHROPIC_CONNECT_TIMEOUT
   * rather than the whole-call ANTHROPIC_TIMEOUT. Omitted by default so frozen
   * legacy callers keep a single whole-call deadline.
   */
  connectTimeoutMs?: number;
  /** Reject stop_reason=max_tokens. Defaults false to preserve frozen legacy callers. */
  rejectTruncation?: boolean;
}

/**
 * Streaming variant of callAnthropic. Uses Anthropic's stream:true API.
 * Calls onProgress(textDelta) for each token chunk — use this to write keepalive
 * bytes to a response stream and prevent the Supabase 150s idle timeout.
 * Returns the fully accumulated text as the result.
 * Never throws — all errors returned as { ok: false, error }.
 */
export async function callAnthropicStreaming(
  opts: AnthropicCallOpts,
  onProgress?: (textDelta: string) => Promise<void>,
): Promise<AnthropicResult> {
  if (!isAiEnabled()) {
    return anthropicFailure("ANTHROPIC_DISABLED", "AA_AI_GENERATION_ENABLED is not true. No AI call made.", false);
  }
  const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
  if (!apiKey) {
    return anthropicFailure("ANTHROPIC_KEY_MISSING", "ANTHROPIC_API_KEY is not set. Cannot proceed with AI generation.", false);
  }

  const {
    system,
    user,
    model = DEFAULT_AI_MODEL,
    maxTokens = 16000,
    timeoutMs = 300_000,
  } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return anthropicFailure(
        "ANTHROPIC_HTTP_ERROR",
        `Anthropic API returned HTTP ${res.status}: ${errBody.slice(0, 400)}`,
        res.status === 408 || res.status === 409 || res.status === 429 || res.status >= 500,
      );
    }

    if (!res.body) {
      return anthropicFailure("ANTHROPIC_EMPTY_RESPONSE", "Anthropic streaming response has no body.", true);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    let sseBuffer = "";
    let progressCounter = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (separated by double newline)
      const events = sseBuffer.split("\n\n");
      sseBuffer = events.pop() ?? "";

      for (const event of events) {
        for (const line of event.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as {
              type: string;
              delta?: { type: string; text?: string };
            };
            if (
              parsed.type === "content_block_delta" &&
              parsed.delta?.type === "text_delta" &&
              parsed.delta.text
            ) {
              accumulated += parsed.delta.text;
              // Call onProgress every 10 tokens to avoid excessive micro-writes
              progressCounter++;
              if (onProgress && progressCounter % 10 === 0) {
                await onProgress(parsed.delta.text).catch(() => {});
              }
            }
          } catch { /* ignore malformed SSE */ }
        }
      }
    }

    if (!accumulated.trim()) {
      return anthropicFailure("ANTHROPIC_EMPTY_RESPONSE", "Anthropic streaming returned empty text.", true);
    }

    return { ok: true, text: accumulated };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return anthropicFailure("ANTHROPIC_TIMEOUT", `Anthropic call timed out after ${Math.round(timeoutMs / 1000)}s.`, true);
    }
    return anthropicFailure(
      "ANTHROPIC_FETCH_ERROR",
      `Anthropic fetch error: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the Anthropic Messages API.
 * Requires AA_AI_GENERATION_ENABLED=true AND ANTHROPIC_API_KEY set, or returns error.
 * Never throws — all errors are returned as { ok: false, error }.
 */
export async function callAnthropic(opts: AnthropicCallOpts): Promise<AnthropicResult> {
  if (!isAiEnabled()) {
    return anthropicFailure("ANTHROPIC_DISABLED", "AA_AI_GENERATION_ENABLED is not true. No AI call made.", false);
  }

  const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
  if (!apiKey) {
    return anthropicFailure("ANTHROPIC_KEY_MISSING", "ANTHROPIC_API_KEY is not set. Cannot proceed with AI generation.", false);
  }

  const {
    system,
    user,
    model = DEFAULT_AI_MODEL,
    maxTokens = 16000,
    timeoutMs = 300_000,
    connectTimeoutMs,
    rejectTruncation = false,
  } = opts;

  const controller = new AbortController();
  let connectTimedOut = false;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Only meaningful while it is strictly tighter than the whole-call deadline.
  let connectTimer: ReturnType<typeof setTimeout> | undefined =
    connectTimeoutMs !== undefined && connectTimeoutMs > 0 && connectTimeoutMs < timeoutMs
      ? setTimeout(() => {
        connectTimedOut = true;
        controller.abort();
      }, connectTimeoutMs)
      : undefined;

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });

    // Headers arrived: the connection phase is over, so only the whole-call
    // deadline may still abort the response-body read.
    if (connectTimer !== undefined) {
      clearTimeout(connectTimer);
      connectTimer = undefined;
    }

    const responseText = await res.text();
    if (!res.ok) {
      return anthropicFailure(
        "ANTHROPIC_HTTP_ERROR",
        `Anthropic API returned HTTP ${res.status}: ${responseText.slice(0, 400)}`,
        res.status === 408 || res.status === 409 || res.status === 429 || res.status >= 500,
      );
    }

    let data: {
      content?: Array<{ type: string; text?: string }>;
      error?: { message: string };
      stop_reason?: string;
    };
    try {
      data = JSON.parse(responseText) as typeof data;
    } catch {
      return anthropicFailure("ANTHROPIC_RESPONSE_INVALID", "Anthropic returned an invalid JSON response body.", true);
    }

    if (data.error) {
      return anthropicFailure("ANTHROPIC_HTTP_ERROR", `Anthropic error: ${data.error.message}`, true);
    }
    if (data.stop_reason === "refusal") {
      return anthropicFailure("ANTHROPIC_REFUSAL", "Anthropic refused the generation request.", false);
    }
    if (rejectTruncation && data.stop_reason === "max_tokens") {
      return anthropicFailure(
        "ANTHROPIC_TRUNCATED",
        "Anthropic stopped at the token limit before a complete response was guaranteed.",
        true,
      );
    }

    const text = (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
    if (!text.trim()) {
      return anthropicFailure("ANTHROPIC_EMPTY_RESPONSE", "Anthropic returned an empty response body.", true);
    }

    return { ok: true, text };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (connectTimedOut) {
        return anthropicFailure(
          "ANTHROPIC_CONNECT_TIMEOUT",
          `Anthropic request was not established within ${Math.round((connectTimeoutMs ?? 0) / 1000)}s.`,
          true,
        );
      }
      return anthropicFailure("ANTHROPIC_TIMEOUT", `Anthropic call timed out after ${Math.round(timeoutMs / 1000)}s.`, true);
    }
    return anthropicFailure(
      "ANTHROPIC_FETCH_ERROR",
      `Anthropic fetch error: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  } finally {
    clearTimeout(timer);
    if (connectTimer !== undefined) clearTimeout(connectTimer);
  }
}
