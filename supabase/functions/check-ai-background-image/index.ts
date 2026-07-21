import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";
import {
  buildAiBackgroundStoragePath,
  checkAiBackgroundBatch,
  safeGenerationError,
} from "../_shared/ai-background-image.ts";

const FUNCTION_NAME = "check-ai-background-image";
const BUCKET = "client-assets";

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

const decodeBase64 = (value: string) => {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return fail(405, "request", "POST only");

  const supabase = svc();
  let generationId = "";

  try {
    const jwt = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !auth.user) return fail(401, "authorization", "Not authenticated.");

    const { data: operator } = await supabase
      .from("users")
      .select("role")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (!operator || !STAFF_ROLES.has(operator.role)) {
      return fail(403, "authorization", "Staff role required.");
    }

    generationId = ((await request.json()) as { generation_id?: string }).generation_id?.trim() ?? "";
    if (!generationId) return fail(400, "request", "generation_id is required.");

    const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
    if (!apiKey) return fail(503, "configuration", "OPENAI_API_KEY is not configured.");

    const checkedAt = new Date().toISOString();
    const claimed = await supabase
      .from("client_ai_background_image_generations")
      .update({ prompt_status: "checking", provider_checked_at: checkedAt, updated_at: checkedAt })
      .eq("id", generationId)
      .eq("prompt_status", "provider_submitted")
      .select("*")
      .single();
    if (claimed.error || !claimed.data) {
      return fail(409, "claim", claimed.error?.message ?? "Generation is not awaiting a provider result.");
    }

    const row = claimed.data;
    if (!row.provider_request_id) throw new Error("Provider request ID is missing.");

    const result = await checkAiBackgroundBatch({
      fetchImpl: fetch,
      apiKey,
      batchId: row.provider_request_id,
      generationId,
    });

    if (["validating", "in_progress", "finalizing"].includes(result.status)) {
      const saved = await supabase
        .from("client_ai_background_image_generations")
        .update({
          prompt_status: "provider_submitted",
          provider_status: result.status,
          provider_checked_at: checkedAt,
          check_count: (row.check_count ?? 0) + 1,
          updated_at: checkedAt,
        })
        .eq("id", generationId)
        .eq("prompt_status", "checking")
        .select("*")
        .single();
      if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Could not persist provider status.");
      return json({ ok: true, generation: saved.data });
    }

    if (result.status !== "completed" || !result.base64) {
      const message = safeGenerationError(result.error ?? `Provider status ${result.status}`);
      await supabase
        .from("client_ai_background_image_generations")
        .update({
          prompt_status: "failed",
          provider_status: result.status,
          error_message: message,
          last_provider_error: message,
          provider_checked_at: checkedAt,
          check_count: (row.check_count ?? 0) + 1,
          updated_at: checkedAt,
        })
        .eq("id", generationId)
        .eq("prompt_status", "checking");
      return fail(502, "provider", message);
    }

    const storagePath = buildAiBackgroundStoragePath(row.client_id, row.source_ref, row.id);
    let uploaded = false;
    try {
      const upload = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, decodeBase64(result.base64), { contentType: "image/png", upsert: false });
      if (upload.error) throw upload.error;
      uploaded = true;

      const completedAt = new Date().toISOString();
      const saved = await supabase
        .from("client_ai_background_image_generations")
        .update({
          prompt_status: "generated",
          provider_status: "completed",
          provider_response: result.metadata ?? {},
          storage_bucket: BUCKET,
          storage_path: storagePath,
          generated_at: completedAt,
          provider_completed_at: completedAt,
          provider_checked_at: completedAt,
          check_count: (row.check_count ?? 0) + 1,
          updated_at: completedAt,
        })
        .eq("id", generationId)
        .eq("prompt_status", "checking")
        .select("*")
        .single();
      if (saved.error || !saved.data) {
        throw new Error(saved.error?.message ?? "Could not persist generated metadata.");
      }

      await supabase.from("activity_log").insert({
        client_id: row.client_id,
        event_type: "ai_background_image_generated",
        plain_english_message: `AI background image generated for ${row.source_ref}.`,
        object_type: "client_ai_background_image_generation",
        object_id: generationId,
        metadata: {
          source_ref: row.source_ref,
          model: row.image_model,
          size: row.image_size,
          quality: row.image_quality,
          storage_path: storagePath,
        },
      });
      return json({ ok: true, generation: saved.data });
    } catch (error) {
      if (uploaded) await supabase.storage.from(BUCKET).remove([storagePath]);
      const message = safeGenerationError(error);
      await supabase
        .from("client_ai_background_image_generations")
        .update({
          prompt_status: "failed",
          error_message: message,
          last_provider_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", generationId)
        .eq("prompt_status", "checking");
      throw error;
    }
  } catch (error) {
    const message = safeGenerationError(error);
    if (generationId) {
      const failedAt = new Date().toISOString();
      await supabase
        .from("client_ai_background_image_generations")
        .update({
          prompt_status: "failed",
          error_message: message,
          last_provider_error: message,
          updated_at: failedAt,
        })
        .eq("id", generationId)
        .eq("prompt_status", "checking");
    }
    return fail(500, "check", message);
  }
});
