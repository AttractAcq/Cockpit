// Start a persisted multi-image AI generation job (carousel slides / story frames).
//
// This function does NO image generation — it validates, plans, and returns fast
// (well under the edge wall-clock cap). It creates one parent job + N child slide
// items (each with a precomputed prompt) and a shared asset_group_ref. The actual
// images are produced one-at-a-time afterwards by generate-carousel-slide.
import { svc, json, cors } from "../_shared/aa.ts";
import {
  BUCKET, FORMAT_CONFIG, MULTI_IMAGE_AI_FORMATS, STAFF_ROLES,
  buildVisualDirection, cleanPathPart, expectedItemCount, selfContainedPrompt,
  type SupportedAssetFormat,
} from "../_shared/ai-asset-generation.ts";

const FUNCTION_NAME = "start-carousel-generation";

function failure(status: number, stage: string, error: string, details?: unknown): Response {
  return json({ ok: false, function: FUNCTION_NAME, stage, error, details, message: `${FUNCTION_NAME} failed at ${stage}: ${error}` }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return failure(405, "request", "POST only");
  const sb = svc();
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !user) return failure(401, "authorization", "Not authenticated.");
    const { data: operator, error: operatorError } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (operatorError) return failure(500, "authorization", "Could not load operator role.", operatorError.message);
    if (!operator || !STAFF_ROLES.has(operator.role)) return failure(403, "authorization", "Admin, account manager, or editor access is required.");

    const body = await req.json() as {
      production_brief_id?: string; expected_count?: number;
      visual_mode?: string; uploaded_image_path?: string | null; uploaded_image_mime_type?: string | null;
      uploaded_image_filename?: string | null; visual_instructions?: string | null; background_strength?: string | null;
    };
    const briefId = body.production_brief_id?.trim() ?? "";
    const overrideCount = typeof body.expected_count === "number" ? body.expected_count : undefined;
    if (!briefId) return failure(400, "request", "production_brief_id is required.");
    if (!(Deno.env.get("OPENAI_API_KEY") ?? "").trim()) return failure(503, "configuration", "AI image production is not configured. OPENAI_API_KEY is required.");

    const { data: brief, error: briefError } = await sb.from("client_production_briefs").select("*").eq("id", briefId).maybeSingle();
    if (briefError || !brief) return failure(404, "load_brief", "Production brief not found.", briefError?.message);
    if (brief.status !== "approved") return failure(409, "gate", "Production brief must be approved before AI production.");
    if (!MULTI_IMAGE_AI_FORMATS.has(brief.asset_format)) {
      return failure(422, "gate", `${FUNCTION_NAME} handles carousel and story briefs only; received ${brief.asset_format}. Single-image formats use their own generator.`);
    }

    const format = brief.asset_format as SupportedAssetFormat;
    let itemCount: number;
    try { itemCount = expectedItemCount(brief, overrideCount); }
    catch (error) { return failure(422, "validate_brief", error instanceof Error ? error.message : String(error)); }

    const visual = buildVisualDirection(body);
    const uploadedImagePath = typeof body.uploaded_image_path === "string" ? body.uploaded_image_path.trim() : "";
    if (visual.visualMode === "uploaded_background" || visual.visualMode === "uploaded_insert") {
      if (!uploadedImagePath) return failure(400, "validate_visual", `${visual.visualMode} requires an uploaded image, but none was provided.`);
      // Fail fast if the stored image is unreadable — do NOT discover it slide-by-slide.
      const { error: signErr } = await sb.storage.from(BUCKET).createSignedUrl(uploadedImagePath, 60);
      if (signErr) return failure(502, "validate_visual", `Could not access the uploaded image at ${uploadedImagePath}: ${signErr.message}`);
      visual.hasImage = true;
    }

    const assetGroupRef = `${cleanPathPart(brief.source_ref)}-${Date.now()}`;
    const storagePrefix = `${brief.client_id}/${brief.execution_month}/${cleanPathPart(brief.source_ref)}`;
    const generationConfig = {
      visual_mode: visual.visualMode,
      background_strength: visual.backgroundStrength,
      visual_instructions: visual.visualInstructions || null,
      uploaded_image_path: uploadedImagePath || null,
      uploaded_image_mime_type: uploadedImagePath ? (body.uploaded_image_mime_type ?? null) : null,
      uploaded_image_filename: uploadedImagePath ? (body.uploaded_image_filename ?? null) : null,
      storage_prefix: storagePrefix,
      brief_title: brief.title,
      expected_count_source: overrideCount ? "operator_confirmed" : "brief",
    };

    // Create the parent job. The single-active-job partial unique index makes a
    // concurrent duplicate Generate click fail here (23505) → 409, not a rival run.
    const { data: job, error: jobError } = await sb.from("client_asset_generation_jobs").insert({
      client_id: brief.client_id,
      production_brief_id: brief.id,
      source_ref: brief.source_ref,
      asset_group_ref: assetGroupRef,
      asset_format: format,
      expected_output_count: itemCount,
      status: "queued",
      visual_mode: visual.visualMode,
      generation_config: generationConfig,
      created_by: user.id,
    }).select("*").single();
    if (jobError || !job) {
      if (jobError?.code === "23505") return failure(409, "start", "A generation job for this production brief is already in progress.");
      return failure(500, "start", "Could not create the generation job.", jobError?.message);
    }

    // Precompute one prompt per slide/frame so the full brief is not re-parsed per image.
    const items = Array.from({ length: itemCount }, (_, i) => ({
      generation_job_id: job.id,
      sequence_index: i + 1,
      status: "queued",
      prompt_md: selfContainedPrompt(brief as Record<string, unknown>, format, i + 1, itemCount, visual),
    }));
    const { error: itemsError } = await sb.from("client_asset_generation_items").insert(items);
    if (itemsError) {
      // Roll back the parent job so no half-created job lingers.
      await sb.from("client_asset_generation_jobs").delete().eq("id", job.id);
      return failure(500, "start", "Could not create slide items.", itemsError.message);
    }

    // Reflect in-progress on the brief (recoverable — set to 'failed' by the worker
    // if the job cannot complete; never left permanently 'producing').
    await sb.from("client_production_briefs")
      .update({ production_mode: "ai", production_status: "producing", updated_at: new Date().toISOString() })
      .eq("id", brief.id);

    await sb.from("activity_log").insert({
      client_id: brief.client_id, event_type: "asset_generation_job_started",
      plain_english_message: `${brief.source_ref} AI generation queued: ${itemCount} ${format === "carousel" ? "slides" : "frames"}.`,
      object_type: "client_asset_generation_job", object_id: job.id,
      metadata: { source_ref: brief.source_ref, asset_format: format, expected_output_count: itemCount, asset_group_ref: assetGroupRef },
    }).select("id").maybeSingle();

    return json({ ok: true, function: FUNCTION_NAME, job, expected_count: itemCount, items_created: itemCount, asset_group_ref: assetGroupRef, config: FORMAT_CONFIG[format] });
  } catch (error) {
    return failure(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
