import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";
import { buildAiBackgroundStoragePath, persistAiBackgroundImage, requestAiBackgroundImage, resolveImageConfiguration, safeGenerationError } from "../_shared/ai-background-image.ts";

const FUNCTION_NAME = "generate-ai-background-image";
const BUCKET = "client-assets";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

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
    let imageConfig: { model: string; size: string; quality: string };
    try {
      imageConfig = resolveImageConfiguration({
        model: Deno.env.get("OPENAI_IMAGE_MODEL"),
        defaultSize: Deno.env.get("OPENAI_IMAGE_SIZE_DEFAULT"),
        defaultQuality: Deno.env.get("OPENAI_IMAGE_QUALITY_DEFAULT"),
        requestedSize: body.image_size,
        requestedQuality: body.image_quality,
      });
    } catch (error) {
      return fail(503, "configuration", safeGenerationError(error));
    }
    const { model, size, quality } = imageConfig;

    const { data: claimed, error: claimError } = await sb.rpc("generate_ai_background_image", { p_generation_id: generationId, p_client_id: clientId, p_image_size: size, p_image_quality: quality });
    const row = claimed?.[0];
    if (claimError || !row) return fail(409, "claim", claimError?.message ?? "Prompt is not approved or generation is already active.");

    const provider = await requestAiBackgroundImage({ fetchImpl: fetch, url: OPENAI_IMAGE_URL, apiKey, prompt: row.prompt_text, config: imageConfig });

    const path = buildAiBackgroundStoragePath(row.client_id, row.source_ref, generationId);
    const generatedAt = new Date().toISOString();
    let saved: Record<string, unknown> | null = null;
    await persistAiBackgroundImage({
      path,
      bytes: decodeBase64(provider.base64),
      upload: async (uploadPath, bytes, options) => { const { error } = await sb.storage.from(BUCKET).upload(uploadPath, bytes, options); if (error) throw new Error(`Storage upload failed: ${error.message}`); },
      save: async () => {
        const result = await sb.from("client_ai_background_image_generations").update({
          prompt_status: "generated", image_model: model, image_size: size, image_quality: quality,
          storage_bucket: BUCKET, storage_path: path, provider_response: provider.metadata,
          generated_at: generatedAt, updated_at: generatedAt,
        }).eq("id", generationId).eq("prompt_status", "generating").select("*").single();
        if (result.error || !result.data) throw new Error(result.error?.message ?? "Could not persist generated image metadata.");
        saved = result.data;
      },
      remove: async (removePath) => { const { error } = await sb.storage.from(BUCKET).remove([removePath]); if (error) throw error; },
    });
    await sb.from("activity_log").insert({ client_id: row.client_id, event_type: "ai_background_image_generated", plain_english_message: `AI background image generated for ${row.source_ref}.`, object_type: "client_ai_background_image_generation", object_id: generationId, metadata: { source_ref: row.source_ref, model, size, quality, storage_path: path } });
    return json({ ok: true, generation: saved });
  } catch (error) {
    const message = safeGenerationError(error);
    if (generationId) await sb.from("client_ai_background_image_generations").update({ prompt_status: "failed", error_message: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", generationId).eq("prompt_status", "generating");
    return fail(500, "generate", message);
  }
});
