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
  const configuredSize = input.defaultSize?.trim() || profile.defaultSize;
  const configuredQuality = input.defaultQuality?.trim() || profile.defaultQuality;
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
