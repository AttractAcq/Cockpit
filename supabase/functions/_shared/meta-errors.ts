// Meta Graph error primitives, deliberately dependency-free.
//
// Extracted from instagram-publish.ts in Phase 3 so the Reels state machine can
// classify provider errors without importing the whole publishing module (which
// pulls in the Supabase client at runtime). instagram-publish.ts re-exports these
// so every existing import keeps working unchanged.
//
// Nothing here ever carries an access token or a signed media URL.

export type MetaErrorCategory =
  | "unsupported_capability"
  | "container_not_ready"
  | "container_processing_timeout"
  | "container_error"
  | "container_expired"
  | "meta_authentication"
  | "meta_rate_limited"
  | "meta_server_error"
  | "transient_media"
  | "meta_publish_failed"
  | "story_validation";

export interface MetaErrorClassification {
  provider: "meta";
  category: MetaErrorCategory;
  retryable: boolean;
  code?: number;
  subcode?: number;
  message: string;
}

/** Error carrying a structured Meta classification. Never contains tokens/URLs. */
export class MetaPublishError extends Error {
  classification: MetaErrorClassification;
  constructor(classification: MetaErrorClassification) {
    super(classification.message);
    this.name = "MetaPublishError";
    this.classification = classification;
  }
}

/** Permanent Story input error (bad media count/type). Never retryable. */
export function storyValidationError(message: string): MetaPublishError {
  return new MetaPublishError({ provider: "meta", category: "story_validation", retryable: false, message });
}

/**
 * Classify a Meta Graph error response body. code 9007 / subcode 2207027 is the
 * "container not ready" race — retryable. Token problems (190) are auth failures.
 */
export function classifyMetaError(
  httpStatus: number,
  data: unknown,
  fallback: MetaErrorCategory = "meta_publish_failed",
): MetaErrorClassification {
  const err = (data && typeof data === "object" ? (data as { error?: Record<string, unknown> }).error : undefined) ?? {};
  const code = typeof err.code === "number" ? err.code : undefined;
  const subcode = typeof err.error_subcode === "number" ? err.error_subcode : undefined;
  const type = typeof err.type === "string" ? err.type : undefined;
  const message = typeof err.message === "string" && err.message ? err.message : `Meta Graph error (HTTP ${httpStatus}).`;

  if (code === 9007 || subcode === 2207027) {
    return { provider: "meta", category: "container_not_ready", retryable: true, code, subcode, message };
  }
  // Invalid/expired access token or session — not retryable without new creds.
  if (code === 190 || subcode === 463 || subcode === 467 || (type === "OAuthException" && code === 102)) {
    return { provider: "meta", category: "meta_authentication", retryable: false, code, subcode, message };
  }
  // Rate limiting (HTTP 429, or Meta app/user/page throttle codes) — retryable with backoff.
  if (httpStatus === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
    return { provider: "meta", category: "meta_rate_limited", retryable: true, code, subcode, message };
  }
  // Transient Meta server errors (5xx / code 1 & 2) — retryable.
  if (httpStatus >= 500 || code === 1 || code === 2) {
    return { provider: "meta", category: "meta_server_error", retryable: true, code, subcode, message };
  }
  return {
    provider: "meta", category: fallback,
    retryable: fallback === "container_not_ready" || fallback === "container_processing_timeout",
    code, subcode, message,
  };
}
