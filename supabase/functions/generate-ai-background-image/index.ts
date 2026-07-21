import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";
import { AiBackgroundGenerationError, requestAiBackgroundImage, runAiBackgroundGeneration, safeGenerationError } from "../_shared/ai-background-image.ts";

const FUNCTION_NAME = "generate-ai-background-image";
const BUCKET = "client-assets";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

function logStage(stage: string, generationId: string): void {
  console.info(JSON.stringify({ function: FUNCTION_NAME, stage, generation_id: generationId || null }));
}

function fail(status: number, stage: string, message: string): Response {
  return json({ ok: false, function: FUNCTION_NAME, stage, message }, status);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "request", "POST only");
  const sb = svc();
  let generationId = "";
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !user) return fail(401, "authorization", "Not authenticated.");
    const { data: operator } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (!operator || !STAFF_ROLES.has(operator.role)) return fail(403, "authorization", "Staff role required.");

    const body = await req.json() as { generation_id?: string; client_id?: string; image_size?: string; image_quality?: string };
    generationId = body.generation_id?.trim() ?? "";
    const clientId = body.client_id?.trim() ?? "";
    if (!generationId || !clientId) return fail(400, "request", "generation_id and client_id are required.");
    const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
    if (!apiKey) return fail(503, "configuration", "OPENAI_API_KEY is not configured.");
    const result = await runAiBackgroundGeneration<{ client_id: string; source_ref: string; [key: string]: unknown }>({
      configuration: {
        model: Deno.env.get("OPENAI_IMAGE_MODEL"),
        defaultSize: Deno.env.get("OPENAI_IMAGE_SIZE_DEFAULT"),
        defaultQuality: Deno.env.get("OPENAI_IMAGE_QUALITY_DEFAULT"),
        requestedSize: body.image_size,
        requestedQuality: body.image_quality,
      },
      authorize: async () => {}, // JWT and staff checks have already succeeded above.
      claimGeneration: async ({ size, quality }) => {
        const { data, error } = await sb.rpc("generate_ai_background_image", { p_generation_id: generationId, p_client_id: clientId, p_image_size: size, p_image_quality: quality });
        if (error) throw error;
        return data?.[0] ?? null;
      },
      callProvider: async (claim, config) => {
        const provider = await requestAiBackgroundImage({ fetchImpl: fetch, url: OPENAI_IMAGE_URL, apiKey, prompt: claim.prompt_text, config });
        return { bytes: decodeBase64(provider.base64), metadata: provider.metadata };
      },
      uploadImage: async (path, bytes, options) => { const { error } = await sb.storage.from(BUCKET).upload(path, bytes, options); if (error) throw new Error(`Storage upload failed: ${error.message}`); },
      markGenerated: async (claim, path, metadata, config) => {
        const generatedAt = new Date().toISOString();
        const saved = await sb.from("client_ai_background_image_generations").update({
          prompt_status: "generated", image_model: config.model, image_size: config.size, image_quality: config.quality,
          storage_bucket: BUCKET, storage_path: path, provider_response: metadata,
          generated_at: generatedAt, updated_at: generatedAt,
        }).eq("id", claim.id).eq("prompt_status", "generating").select("*").single();
        if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Could not persist generated image metadata.");
        return saved.data;
      },
      markFailed: async (claim, message) => {
        const { error } = await sb.from("client_ai_background_image_generations").update({ prompt_status: "failed", error_message: message, updated_at: new Date().toISOString() }).eq("id", claim.id).eq("prompt_status", "generating");
        if (error) throw error;
      },
      cleanupStorage: async (path) => { const { error } = await sb.storage.from(BUCKET).remove([path]); if (error) throw error; },
      onStage: (stage, claim) => logStage(stage, claim?.id ?? generationId),
    });
    await sb.from("activity_log").insert({ client_id: result.generated.client_id, event_type: "ai_background_image_generated", plain_english_message: `AI background image generated for ${result.generated.source_ref}.`, object_type: "client_ai_background_image_generation", object_id: generationId, metadata: { source_ref: result.generated.source_ref, model: result.config.model, size: result.config.size, quality: result.config.quality, storage_path: result.path } });
    return json({ ok: true, generation: result.generated });
  } catch (error) {
    const message = safeGenerationError(error);
    const stage = error instanceof AiBackgroundGenerationError ? error.stage : "generate";
    logStage(`${stage}_terminal_error`, generationId);
    return fail(stage === "claim" ? 409 : stage === "configuration" ? 503 : 500, stage, message);
  }
});
