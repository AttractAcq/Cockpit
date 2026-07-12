// Regenerate ONE carousel slide / story frame as a NEW version (v2, v3, …).
//
// HELD — do not deploy until the H7 versioning migration is applied.
//
// Reuses the frame's exact stored prompt (and its uploaded visual input, if any),
// generates a single image (well under the edge wall-clock cap), stores it under
// a versioned path, and inserts a NEW client_assets row — never overwriting prior
// versions. The new version becomes current (needs_review); other frames in the
// group are untouched. A per-frame lock prevents concurrent regeneration.
import { svc, json, cors } from "../_shared/aa.ts";
import {
  BUCKET, FORMAT_CONFIG, INPUT_MIME, STAFF_ROLES, cleanPathPart, generateImage,
  type SupportedAssetFormat,
} from "../_shared/ai-asset-generation.ts";

const FUNCTION_NAME = "regenerate-asset-frame";
const STALE_LOCK_MS = 3 * 60 * 1000;

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

    const body = await req.json() as { client_asset_id?: string };
    const assetId = body.client_asset_id?.trim() ?? "";
    if (!assetId) return failure(400, "request", "client_asset_id is required.");
    if (!(Deno.env.get("OPENAI_API_KEY") ?? "").trim()) return failure(503, "configuration", "AI image production is not configured. OPENAI_API_KEY is required.");

    const { data: asset, error: assetError } = await sb.from("client_assets").select("*").eq("id", assetId).maybeSingle();
    if (assetError || !asset) return failure(404, "load_asset", "Asset not found.", assetError?.message);
    const format = asset.asset_format as SupportedAssetFormat;
    const config = FORMAT_CONFIG[format];
    if (!config) return failure(422, "gate", `Cannot regenerate a ${asset.asset_format} asset.`);
    const brief = asset.production_brief_id as string;
    const group = asset.asset_group_ref as string;
    const seq = asset.sequence_index as number;

    // Per-frame concurrency lock: claim the frame's CURRENT row if it is unlocked
    // or its lock is stale. No match → a regeneration is already running.
    const nowIso = new Date().toISOString();
    const staleIso = new Date(Date.now() - STALE_LOCK_MS).toISOString();
    const { data: locked, error: lockError } = await sb.from("client_assets")
      .update({ regen_started_at: nowIso })
      .eq("production_brief_id", brief).eq("asset_group_ref", group).eq("sequence_index", seq).eq("is_current", true)
      .or(`regen_started_at.is.null,regen_started_at.lt.${staleIso}`)
      .select("id, prompt_md, metadata, storage_path, source_ref, client_id");
    if (lockError) return failure(500, "lock", "Could not acquire the regeneration lock.", lockError.message);
    if (!locked || locked.length === 0) return failure(409, "lock", "Another regeneration for this frame is already in progress.");
    const current = locked[0] as { id: string; prompt_md: string; metadata: Record<string, unknown>; storage_path: string; source_ref: string; client_id: string };

    try {
      // Next version = max existing + 1.
      const { data: versions } = await sb.from("client_assets").select("version")
        .eq("production_brief_id", brief).eq("asset_group_ref", group).eq("sequence_index", seq);
      const newVersion = Math.max(1, ...((versions ?? []).map((row) => Number(row.version) || 1))) + 1;

      // Reuse the exact stored prompt, and the uploaded visual input if the frame
      // used one (so an uploaded-background regen keeps its base image).
      const prompt = current.prompt_md;
      const meta = current.metadata ?? {};
      let imageInput: { bytes: Uint8Array; mime: string } | undefined;
      if (meta.image_input_used === true && typeof meta.uploaded_image_path === "string" && meta.uploaded_image_path) {
        const { data: blob } = await sb.storage.from(BUCKET).download(meta.uploaded_image_path as string);
        if (blob) {
          const mime = INPUT_MIME.has(blob.type) ? blob.type : "image/png";
          imageInput = { bytes: new Uint8Array(await blob.arrayBuffer()), mime };
        }
      }

      const generated = await generateImage(prompt, config, imageInput); // one image only

      // Store under a versioned path in the same folder as the current version.
      const dir = current.storage_path.split("/").slice(0, -1).join("/");
      const storagePath = `${dir}/v${newVersion}-${String(seq).padStart(2, "0")}.png`;
      const { error: uploadError } = await sb.storage.from(BUCKET).upload(storagePath, generated.bytes, { contentType: "image/png", upsert: false });
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      // Insert the new version (not yet current), then atomically promote it.
      const { data: inserted, error: insertError } = await sb.from("client_assets").insert({
        client_id: current.client_id,
        production_brief_id: brief,
        source_ref: current.source_ref,
        asset_format: format,
        asset_group_ref: group,
        sequence_index: seq,
        version: newVersion,
        is_current: false,
        title: asset.title,
        storage_bucket: BUCKET,
        storage_path: storagePath,
        mime_type: "image/png",
        width: config.width,
        height: config.height,
        status: "needs_review",
        generation_provider: "openai",
        generation_model: generated.model,
        prompt_md: prompt,
        metadata: { ...meta, version: newVersion, regenerated_from_asset_id: asset.id, regenerated_at: new Date().toISOString(), image_input_used: generated.imageInputUsed },
      }).select("id").single();
      if (insertError || !inserted) throw new Error(`Version insert failed: ${insertError?.message ?? "no row returned"}`);

      const { error: activateError } = await sb.rpc("activate_asset_version", { p_asset_id: inserted.id });
      if (activateError) throw new Error(`Could not activate the new version: ${activateError.message}`);

      // Clear the lock on the now-superseded row.
      await sb.from("client_assets").update({ regen_started_at: null }).eq("id", current.id);

      await sb.from("activity_log").insert({
        client_id: current.client_id, event_type: "asset_frame_regenerated",
        plain_english_message: `${current.source_ref} ${format === "carousel" ? "slide" : "frame"} ${seq} regenerated as v${newVersion}.`,
        object_type: "client_asset", object_id: inserted.id,
        metadata: { source_ref: current.source_ref, asset_group_ref: group, sequence_index: seq, version: newVersion },
      }).select("id").maybeSingle();

      const { data: newAsset } = await sb.from("client_assets").select("*").eq("id", inserted.id).single();
      return json({ ok: true, function: FUNCTION_NAME, asset: newAsset, version: newVersion, sequence_index: seq });
    } catch (error) {
      // Release the lock so the frame is not wedged, then surface the error.
      await sb.from("client_assets").update({ regen_started_at: null }).eq("id", current.id);
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("timed out") ? 504 : message.includes("OpenAI Images") ? 502 : 500;
      return failure(status, "regenerate", message);
    }
  } catch (error) {
    return failure(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
