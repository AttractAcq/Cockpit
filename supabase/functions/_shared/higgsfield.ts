// Higgsfield AI REST adapter for the Reel Studio Phase B two-step generation
// pipeline. Plain fetch() only -- no SDK dependency (JS/TS SDK is still
// "Coming Soon" per docs.higgsfield.ai as of 2026-07-22).
//
// SERVER-SIDE ONLY. Reads the API key from Deno.env at call time. Never logs,
// prints, or returns the key. Fails closed if the key or a required model_id
// is absent.
//
// Corrected 2026-07-23: Higgsfield's DoP model family (the only video model
// confirmed available on the account, categorized "Image to Video" on
// Higgsfield's own dashboard) is image-to-video, not text-to-video. Every
// shot therefore requires two separate Higgsfield calls:
//   1. Text-to-image (Soul Standard / Popcorn Auto) -- submitHiggsfieldTextToImage
//   2. Image-to-video (DoP), using the still from step 1 plus a camera-motion
//      directive -- submitHiggsfieldImageToVideo
// Confirmed via docs.higgsfield.ai (auth/status/lifecycle) plus third-party
// reseller docs corroborating DoP's request shape (MindCloud, WaveSpeedAI) --
// no official first-party per-model parameter reference was found, so only
// fields confirmed by at least two independent sources are sent.
//
// Source: docs.higgsfield.ai (images.md, video.md, webhooks.md, faq.md) +
// github.com/higgsfield-ai, confirmed 2026-07-22. See memory file
// higgsfield-api.md for the full reconnaissance notes and open gaps.

const HIGGSFIELD_BASE_URL = "https://platform.higgsfield.ai";
const DEFAULT_TIMEOUT_MS = 30_000;

export type HiggsfieldRenderTier = "draft" | "final";

export type HiggsfieldJobStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw";

const ALL_STATUSES = new Set<HiggsfieldJobStatus>(["queued", "in_progress", "completed", "failed", "nsfw"]);
const TERMINAL_STATUSES = new Set<HiggsfieldJobStatus>(["completed", "failed", "nsfw"]);

/** True only for a status value Higgsfield's docs actually define. An unrecognized string is neither known-terminal nor known-running -- callers must not silently treat it as "still rendering". */
export function isKnownHiggsfieldStatus(status: string): status is HiggsfieldJobStatus {
  return ALL_STATUSES.has(status as HiggsfieldJobStatus);
}

export function isTerminalHiggsfieldStatus(status: string): status is HiggsfieldJobStatus {
  return TERMINAL_STATUSES.has(status as HiggsfieldJobStatus);
}

/** Redacts the key_id:key_secret credential from any error text before it is logged or returned. */
export function safeHiggsfieldError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return raw
    .replace(/Key\s+[^\s"']+/gi, "Key [redacted]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 1000);
}

/** The two-part credential Higgsfield's docs require: `Authorization: Key {api_key}:{api_key_secret}`. */
export interface HiggsfieldCredential {
  key: string;
  secret: string;
}

/** Reads HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET as two separate Supabase secrets. Returns null unless both are present -- never assembles the header from a partial credential. */
export function readHiggsfieldCredential(): HiggsfieldCredential | null {
  const key = (Deno.env.get("HIGGSFIELD_API_KEY") ?? "").trim();
  const secret = (Deno.env.get("HIGGSFIELD_API_SECRET") ?? "").trim();
  if (!key || !secret) return null;
  return { key, secret };
}

function buildHiggsfieldAuthHeader(credential: HiggsfieldCredential): string {
  return `Key ${credential.key}:${credential.secret}`;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Higgsfield request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the DoP (image-to-video) model_id to use for a given render tier. Returns null if not configured -- fails closed rather than guessing a model_id. */
export function readHiggsfieldModelId(tier: HiggsfieldRenderTier): string | null {
  const envKey = tier === "draft" ? "HIGGSFIELD_MODEL_DRAFT" : "HIGGSFIELD_MODEL_FINAL";
  const value = (Deno.env.get(envKey) ?? "").trim();
  return value.length > 0 ? value : null;
}

/** Reads the text-to-image model_id (Soul Standard / Popcorn Auto) used for the still-frame step. Single model regardless of render tier -- fails closed rather than guessing a model_id. */
export function readHiggsfieldStillModelId(): string | null {
  const value = (Deno.env.get("HIGGSFIELD_MODEL_STILL") ?? "").trim();
  return value.length > 0 ? value : null;
}

export interface HiggsfieldSubmitResult {
  requestId: string;
  status: HiggsfieldJobStatus;
  statusUrl: string | null;
  cancelUrl: string | null;
}

export interface HiggsfieldSubmitParams {
  fetchImpl: typeof fetch;
  credential: HiggsfieldCredential;
  modelId: string;
  prompt: string;
  /** Optional per-model extra parameters. Per-model_id parameter schemas are not fully documented -- pass only fields already confirmed for the chosen model. */
  extraParams?: Record<string, unknown>;
  timeoutMs?: number;
}

/** POST https://platform.higgsfield.ai/{model_id} -- text-to-image still-frame step (Soul Standard / Popcorn Auto). */
export async function submitHiggsfieldTextToImage(params: HiggsfieldSubmitParams): Promise<HiggsfieldSubmitResult> {
  const { fetchImpl, credential, modelId, prompt, extraParams, timeoutMs = DEFAULT_TIMEOUT_MS } = params;
  const response = await fetchWithTimeout(fetchImpl, `${HIGGSFIELD_BASE_URL}/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: buildHiggsfieldAuthHeader(credential),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, ...extraParams }),
  }, timeoutMs);

  const body = await response.json().catch(() => ({})) as {
    request_id?: string;
    status?: string;
    status_url?: string;
    cancel_url?: string;
    error?: string;
  };

  if (!response.ok || !body.request_id) {
    throw new Error(`Higgsfield text-to-image submit returned HTTP ${response.status}: ${body.error ?? JSON.stringify(body).slice(0, 400)}`);
  }

  return {
    requestId: body.request_id,
    status: (body.status as HiggsfieldJobStatus) ?? "queued",
    statusUrl: body.status_url ?? null,
    cancelUrl: body.cancel_url ?? null,
  };
}

/** A single camera-motion directive for a DoP image-to-video request. Confirmed 2026-07-23 via two live validation responses from the real API: (1) the field is `id`, not `motion` as third-party docs implied; (2) `id` must be an actual UUID from Higgsfield's motion catalog (e.g. "Zoom In" -> "fbcbec5b-30f8-4b17-ba6e-8e8d5b265562"), not a free-text slug like "push_in" -- a slug value fails with a `uuid_parsing` 422. The catalog is listed at `GET https://platform.higgsfield.ai/v1/motions` (undocumented in official/third-party docs found so far; discovered empirically). There is currently no code path in this repo that calls that endpoint or caches its result -- `video_shots.motion_type` must be populated with a real catalog UUID by whatever writes it (Phase C UI, once built). */
export interface HiggsfieldMotion {
  id: string;
  strength: number;
}

export interface HiggsfieldImageToVideoParams {
  fetchImpl: typeof fetch;
  credential: HiggsfieldCredential;
  modelId: string;
  prompt: string;
  /** Source still-frame URL to animate. Must be reachable by Higgsfield -- a signed URL if the source bucket is private. */
  imageUrl: string;
  /** 1-2 motion directives per DoP's confirmed request shape. */
  motions: HiggsfieldMotion[];
  /** Optional end-frame URL for DoP's "first last frame" variants. */
  endImageUrl?: string;
  timeoutMs?: number;
}

/** POST https://platform.higgsfield.ai/{model_id} -- DoP image-to-video step. Requires a source image plus motion directives; DoP is not callable with a prompt alone. Field names (`image_url`, `motions[].id`) confirmed 2026-07-23 via a live 422 validation response from the real API -- the previously-assumed `image`/`motions[].motion` names (from third-party reseller docs) were wrong. */
export async function submitHiggsfieldImageToVideo(params: HiggsfieldImageToVideoParams): Promise<HiggsfieldSubmitResult> {
  const { fetchImpl, credential, modelId, prompt, imageUrl, motions, endImageUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = params;
  const response = await fetchWithTimeout(fetchImpl, `${HIGGSFIELD_BASE_URL}/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: buildHiggsfieldAuthHeader(credential),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_url: imageUrl,
      motions,
      ...(endImageUrl ? { end_image: endImageUrl } : {}),
    }),
  }, timeoutMs);

  const body = await response.json().catch(() => ({})) as {
    request_id?: string;
    status?: string;
    status_url?: string;
    cancel_url?: string;
    error?: string;
  };

  if (!response.ok || !body.request_id) {
    throw new Error(`Higgsfield image-to-video submit returned HTTP ${response.status}: ${body.error ?? JSON.stringify(body).slice(0, 400)}`);
  }

  return {
    requestId: body.request_id,
    status: (body.status as HiggsfieldJobStatus) ?? "queued",
    statusUrl: body.status_url ?? null,
    cancelUrl: body.cancel_url ?? null,
  };
}

export interface HiggsfieldStatusResult {
  status: HiggsfieldJobStatus;
  videoUrl: string | null;
  imageUrls: string[];
  error: string | null;
}

/** GET https://platform.higgsfield.ai/requests/{request_id}/status -- shared by both pipeline stages (still-image status returns `images`, DoP status returns `video`). */
export async function checkHiggsfieldGeneration(
  fetchImpl: typeof fetch,
  credential: HiggsfieldCredential,
  requestId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<HiggsfieldStatusResult> {
  const response = await fetchWithTimeout(fetchImpl, `${HIGGSFIELD_BASE_URL}/requests/${requestId}/status`, {
    method: "GET",
    headers: { Authorization: buildHiggsfieldAuthHeader(credential) },
  }, timeoutMs);

  const body = await response.json().catch(() => ({})) as {
    status?: string;
    video?: { url?: string };
    images?: Array<{ url?: string }>;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(`Higgsfield status returned HTTP ${response.status}: ${body.error ?? JSON.stringify(body).slice(0, 400)}`);
  }

  return {
    status: (body.status as HiggsfieldJobStatus) ?? "queued",
    videoUrl: body.video?.url ?? null,
    imageUrls: (body.images ?? []).map((i) => i.url).filter((u): u is string => !!u),
    error: body.error ?? null,
  };
}
