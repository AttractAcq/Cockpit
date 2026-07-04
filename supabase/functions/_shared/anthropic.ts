// Deno-compatible Anthropic API adapter for AA Cockpit edge functions.
//
// SERVER-SIDE ONLY. Reads keys from Deno.env at call time.
// Never logs, prints, or returns the API key.
// Fails closed: if the key is absent or the gate is off, returns an error — never silently proceeds.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

export const DEFAULT_AI_MODEL = "claude-opus-4-8";

export type AnthropicResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

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
  /** Abort after this many ms. Default 300 000 (5 min). */
  timeoutMs?: number;
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
    return { ok: false, error: "AA_AI_GENERATION_ENABLED is not true. No AI call made." };
  }
  const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
  if (!apiKey) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not set. Cannot proceed with AI generation." };
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

    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return { ok: false, error: `Anthropic API returned HTTP ${res.status}: ${errBody.slice(0, 400)}` };
    }

    if (!res.body) {
      return { ok: false, error: "Anthropic streaming response has no body." };
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
      return { ok: false, error: "Anthropic streaming returned empty text." };
    }

    return { ok: true, text: accumulated };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: `Anthropic call timed out after ${Math.round(timeoutMs / 1000)}s.` };
    }
    return {
      ok: false,
      error: `Anthropic fetch error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Call the Anthropic Messages API.
 * Requires AA_AI_GENERATION_ENABLED=true AND ANTHROPIC_API_KEY set, or returns error.
 * Never throws — all errors are returned as { ok: false, error }.
 */
export async function callAnthropic(opts: AnthropicCallOpts): Promise<AnthropicResult> {
  if (!isAiEnabled()) {
    return {
      ok: false,
      error: "AA_AI_GENERATION_ENABLED is not true. No AI call made.",
    };
  }

  const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY is not set. Cannot proceed with AI generation.",
    };
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
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Anthropic API returned HTTP ${res.status}: ${errBody.slice(0, 400)}`,
      };
    }

    const data = await res.json() as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message: string };
      stop_reason?: string;
    };

    if (data.error) {
      return { ok: false, error: `Anthropic error: ${data.error.message}` };
    }

    const text = (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
    if (!text.trim()) {
      return { ok: false, error: "Anthropic returned an empty response body." };
    }

    return { ok: true, text };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        error: `Anthropic call timed out after ${Math.round(timeoutMs / 1000)}s.`,
      };
    }
    return {
      ok: false,
      error: `Anthropic fetch error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
