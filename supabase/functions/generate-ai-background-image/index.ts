import { cors, json, svc } from "../_shared/aa.ts";
import { cleanPathPart, STAFF_ROLES } from "../_shared/ai-asset-generation.ts";

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

    const body = await req.json() as { generation_id?: string; image_size?: string; image_quality?: string };
    generationId = body.generation_id?.trim() ?? "";
    if (!generationId) return fail(400, "request", "generation_id is required.");
    const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
    if (!apiKey) return fail(503, "configuration", "OPENAI_API_KEY is not configured.");
    const model = (Deno.env.get("OPENAI_IMAGE_MODEL") ?? "gpt-image-1").trim();
    if (!model) return fail(503, "configuration", "OPENAI_IMAGE_MODEL is empty.");
    const size = body.image_size?.trim() || (Deno.env.get("OPENAI_IMAGE_SIZE_DEFAULT") ?? "1024x1536").trim();
    const quality = body.image_quality?.trim() || (Deno.env.get("OPENAI_IMAGE_QUALITY_DEFAULT") ?? "medium").trim();

    const { data: claimed, error: claimError } = await sb.rpc("generate_ai_background_image", { p_generation_id: generationId, p_image_size: size, p_image_quality: quality });
    const row = claimed?.[0];
    if (claimError || !row) return fail(409, "claim", claimError?.message ?? "Prompt is not approved or generation is already active.");

    const response = await fetch(OPENAI_IMAGE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: row.prompt_text, n: 1, size, quality, background: "opaque", moderation: "auto" }),
      signal: AbortSignal.timeout(180_000),
    });
    const provider = await response.json().catch(() => ({})) as { data?: Array<{ b64_json?: string; revised_prompt?: string }>; error?: { message?: string } };
    const base64 = provider.data?.[0]?.b64_json;
    if (!response.ok || !base64) throw new Error(provider.error?.message ?? `OpenAI Images returned HTTP ${response.status}`);

    const path = `${row.client_id}/ai-backgrounds/${cleanPathPart(row.source_ref)}/${generationId}.png`;
    const { error: uploadError } = await sb.storage.from(BUCKET).upload(path, decodeBase64(base64), { contentType: "image/png", upsert: false });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
    const safeProvider = { revised_prompt: provider.data?.[0]?.revised_prompt ?? null };
    const generatedAt = new Date().toISOString();
    const { data: saved, error: saveError } = await sb.from("client_ai_background_image_generations").update({
      prompt_status: "generated", image_model: model, image_size: size, image_quality: quality,
      storage_bucket: BUCKET, storage_path: path, provider_response: safeProvider,
      generated_at: generatedAt, updated_at: generatedAt,
    }).eq("id", generationId).eq("prompt_status", "generating").select("*").single();
    if (saveError || !saved) {
      await sb.storage.from(BUCKET).remove([path]).catch(() => {});
      throw new Error(saveError?.message ?? "Could not persist generated image metadata.");
    }
    await sb.from("activity_log").insert({ client_id: row.client_id, event_type: "ai_background_image_generated", plain_english_message: `AI background image generated for ${row.source_ref}.`, object_type: "client_ai_background_image_generation", object_id: generationId, metadata: { source_ref: row.source_ref, model, size, quality, storage_path: path } });
    return json({ ok: true, generation: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (generationId) await sb.from("client_ai_background_image_generations").update({ prompt_status: "failed", error_message: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", generationId).eq("prompt_status", "generating");
    return fail(500, "generate", message);
  }
});
