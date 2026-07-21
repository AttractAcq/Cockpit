export interface ImageModelProfile {
  sizes: readonly string[];
  qualities: readonly string[];
  defaultSize: string;
  defaultQuality: string;
}

export const SUPPORTED_IMAGE_MODELS: Readonly<Record<string, ImageModelProfile>> = {
  "gpt-image-2": {
    sizes: ["1024x1024", "1024x1536", "1536x1024"],
    qualities: ["low", "medium", "high"],
    defaultSize: "1024x1024",
    defaultQuality: "high",
  },
  // Explicit compatibility profile only. There is no automatic model fallback.
  "gpt-image-1": {
    sizes: ["1024x1024", "1024x1536", "1536x1024"],
    qualities: ["low", "medium", "high"],
    defaultSize: "1024x1024",
    defaultQuality: "high",
  },
};

export function resolveImageConfiguration(input: {
  model?: string | null;
  requestedSize?: string | null;
  requestedQuality?: string | null;
  defaultSize?: string | null;
  defaultQuality?: string | null;
}): { model: string; size: string; quality: string } {
  const model = input.model?.trim() ?? "";
  if (!model) throw new Error("OPENAI_IMAGE_MODEL is required.");
  const profile = SUPPORTED_IMAGE_MODELS[model];
  if (!profile) throw new Error("OPENAI_IMAGE_MODEL is unsupported by the configured image profile.");
  const configuredSize = input.defaultSize?.trim() ?? "";
  const configuredQuality = input.defaultQuality?.trim() ?? "";
  if (!configuredSize) throw new Error("OPENAI_IMAGE_SIZE_DEFAULT is required.");
  if (!configuredQuality) throw new Error("OPENAI_IMAGE_QUALITY_DEFAULT is required.");
  if (!profile.sizes.includes(configuredSize)) throw new Error("OPENAI_IMAGE_SIZE_DEFAULT is invalid for the configured image model.");
  if (!profile.qualities.includes(configuredQuality)) throw new Error("OPENAI_IMAGE_QUALITY_DEFAULT is invalid for the configured image model.");
  const size = input.requestedSize?.trim() || configuredSize;
  const quality = input.requestedQuality?.trim() || configuredQuality;
  if (!profile.sizes.includes(size)) throw new Error("Requested image size is invalid for the configured image model.");
  if (!profile.qualities.includes(quality)) throw new Error("Requested image quality is invalid for the configured image model.");
  return { model, size, quality };
}

export function cleanAiPathPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

export function buildAiBackgroundStoragePath(clientId: string, sourceRef: string, generationId: string): string {
  return `${clientId}/ai-backgrounds/${cleanAiPathPart(sourceRef)}/${generationId}.png`;
}

export function sanitizeProviderMetadata(value: { revised_prompt?: unknown }): Record<string, unknown> {
  return { revised_prompt: typeof value.revised_prompt === "string" ? value.revised_prompt.slice(0, 4000) : null };
}

export function safeGenerationError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return raw.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").replace(/[\r\n]+/g, " ").slice(0, 1000);
}

export interface AiBackgroundClaim {
  id: string;
  client_id: string;
  source_ref: string;
  prompt_text: string;
}

export class AiBackgroundGenerationError extends Error {
  constructor(public readonly stage: "authorization" | "configuration" | "claim" | "generate", message: string) {
    super(message);
    this.name = "AiBackgroundGenerationError";
  }
}

/**
 * Testable production orchestration. Every external effect is injected so the
 * claim/provider/storage ordering and failure state can be verified without
 * credentials, network calls, storage writes, or final asset generation.
 */
export async function runAiBackgroundGeneration<TGenerated>(input: {
  configuration: Parameters<typeof resolveImageConfiguration>[0];
  authorize: () => Promise<void>;
  claimGeneration: (config: { model: string; size: string; quality: string }) => Promise<AiBackgroundClaim | null>;
  callProvider: (claim: AiBackgroundClaim, config: { model: string; size: string; quality: string }) => Promise<{ bytes: Uint8Array; metadata: Record<string, unknown> }>;
  uploadImage: (path: string, bytes: Uint8Array, options: { contentType: string; upsert: false }) => Promise<void>;
  markGenerated: (claim: AiBackgroundClaim, path: string, metadata: Record<string, unknown>, config: { model: string; size: string; quality: string }) => Promise<TGenerated>;
  markFailed: (claim: AiBackgroundClaim, message: string) => Promise<void>;
  cleanupStorage: (path: string) => Promise<void>;
}): Promise<{ generated: TGenerated; path: string; config: { model: string; size: string; quality: string } }> {
  try {
    await input.authorize();
  } catch (error) {
    throw new AiBackgroundGenerationError("authorization", safeGenerationError(error));
  }
  let config: { model: string; size: string; quality: string };
  try {
    config = resolveImageConfiguration(input.configuration);
  } catch (error) {
    throw new AiBackgroundGenerationError("configuration", safeGenerationError(error));
  }
  let claim: AiBackgroundClaim | null;
  try {
    claim = await input.claimGeneration(config);
  } catch (error) {
    throw new AiBackgroundGenerationError("claim", safeGenerationError(error));
  }
  if (!claim) throw new AiBackgroundGenerationError("claim", "Generation claim was rejected.");

  const path = buildAiBackgroundStoragePath(claim.client_id, claim.source_ref, claim.id);
  let uploaded = false;
  try {
    const provider = await input.callProvider(claim, config);
    await input.uploadImage(path, provider.bytes, { contentType: "image/png", upsert: false });
    uploaded = true;
    const generated = await input.markGenerated(claim, path, provider.metadata, config);
    return { generated, path, config };
  } catch (error) {
    let message = safeGenerationError(error);
    if (uploaded) {
      try {
        await input.cleanupStorage(path);
      } catch {
        message = `${message} Generated file cleanup also failed; operator review required.`.slice(0, 1000);
      }
    }
    try {
      await input.markFailed(claim, message);
    } catch {
      message = `${message} Failed-state persistence also failed; operator review required.`.slice(0, 1000);
    }
    throw new AiBackgroundGenerationError("generate", message);
  }
}

export async function requestAiBackgroundImage(input: {
  fetchImpl: typeof fetch;
  url: string;
  apiKey: string;
  prompt: string;
  config: { model: string; size: string; quality: string };
}): Promise<{ base64: string; metadata: Record<string, unknown> }> {
  const response = await input.fetchImpl(input.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...input.config, prompt: input.prompt, n: 1, background: "opaque", moderation: "auto" }),
    signal: AbortSignal.timeout(180_000),
  });
  const provider = await response.json().catch(() => ({})) as { data?: Array<{ b64_json?: string; revised_prompt?: string }>; error?: { message?: string } };
  const base64 = provider.data?.[0]?.b64_json;
  if (!response.ok || !base64) throw new Error(provider.error?.message ?? `OpenAI Images returned HTTP ${response.status}`);
  return { base64, metadata: sanitizeProviderMetadata(provider.data?.[0] ?? {}) };
}

export async function persistAiBackgroundImage(input: {
  path: string;
  bytes: Uint8Array;
  upload: (path: string, bytes: Uint8Array, options: { contentType: string; upsert: false }) => Promise<void>;
  save: () => Promise<void>;
  remove: (path: string) => Promise<void>;
}): Promise<void> {
  await input.upload(input.path, input.bytes, { contentType: "image/png", upsert: false });
  try {
    await input.save();
  } catch (error) {
    try {
      await input.remove(input.path);
    } catch {
      throw new Error(`${safeGenerationError(error)} Generated file cleanup also failed; operator review required.`);
    }
    throw error;
  }
}
