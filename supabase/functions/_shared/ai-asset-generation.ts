import { cors, json, svc } from "./aa.ts";
import { resolveMultiImageCount, type AssetFormat } from "./production-brief-contract.ts";

const STAFF_ROLES = new Set(["admin", "account_manager", "editor"]);
const AI_FORMATS = new Set<AssetFormat>(["feed_post", "carousel", "story_sequence", "ad_static"]);
const BUCKET = "client-assets";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

type SupportedAssetFormat = Exclude<AssetFormat, "reel_video">;

interface FormatConfig {
  aspectRatio: string;
  width: number;
  height: number;
  label: string;
  maxItems: number;
}

const FORMAT_CONFIG: Record<SupportedAssetFormat, FormatConfig> = {
  feed_post: { aspectRatio: "4:5", width: 1024, height: 1280, label: "Instagram feed post", maxItems: 1 },
  ad_static: { aspectRatio: "4:5", width: 1024, height: 1280, label: "Instagram static image ad", maxItems: 1 },
  carousel: { aspectRatio: "4:5 per slide", width: 1024, height: 1280, label: "Instagram carousel slide", maxItems: 10 },
  story_sequence: { aspectRatio: "9:16 per frame", width: 720, height: 1280, label: "Instagram story frame", maxItems: 12 },
};

interface OpenAiImageResponse {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string; code?: string; type?: string };
}

function failure(functionName: string, status: number, stage: string, error: string, details?: unknown): Response {
  return json({ ok: false, function: functionName, stage, error, details, message: `${functionName} failed at ${stage}: ${error}` }, status);
}

function cleanPathPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "asset";
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// Resolve the required slide/frame count from the approved brief. The brief is
// authoritative: a confidently-resolved count is used as-is. Only when the brief
// is genuinely ambiguous may an operator-confirmed `overrideCount` be used — and
// if neither yields a count, we throw rather than defaulting (never guess 3).
function expectedItemCount(
  brief: { asset_format: AssetFormat; content_md: string; metadata?: Record<string, unknown> },
  overrideCount?: number,
): number {
  if (brief.asset_format === "feed_post" || brief.asset_format === "ad_static") return 1;
  const config = FORMAT_CONFIG[brief.asset_format];
  const resolved = resolveMultiImageCount(brief);
  const label = resolved.label;

  let count = resolved.count;
  if (count === null || resolved.source === "ambiguous") {
    // Ambiguous brief: require an explicit, in-range operator-confirmed count.
    if (typeof overrideCount === "number" && Number.isFinite(overrideCount)) count = Math.trunc(overrideCount);
    else throw new Error(`Could not determine the ${label} count from the approved brief. Add a "Slide Count"/"Frame Count" field or metadata.${label}_count, or confirm the count before generating.`);
  }

  if (count < 2) throw new Error(`The approved ${brief.asset_format} brief must enumerate at least two ${label}s before AI production.`);
  if (count > config.maxItems) throw new Error(`${brief.asset_format} supports at most ${config.maxItems} ${label}s per generated group; the brief defines ${count}.`);
  return count;
}

function sequenceInstruction(markdown: string, format: SupportedAssetFormat, index: number): string {
  if (format === "feed_post" || format === "ad_static") return "Generate the single approved image described by the brief.";
  const label = format === "carousel" ? "slide" : "frame";
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`\\b${label}\\s*${index}\\b`, "i").test(line));
  if (start < 0) return `Generate ${label} ${index} exactly as enumerated in the full approved brief.`;
  const selected = [lines[start]];
  for (let cursor = start + 1; cursor < lines.length && selected.length < 10; cursor += 1) {
    if (new RegExp(`\\b${label}\\s*\\d+\\b`, "i").test(lines[cursor])) break;
    if (/^##\s+/.test(lines[cursor])) break;
    selected.push(lines[cursor]);
  }
  return selected.join("\n").trim();
}

function selfContainedPrompt(brief: Record<string, unknown>, format: SupportedAssetFormat, index: number, count: number): string {
  const config = FORMAT_CONFIG[format];
  const content = String(brief.content_md ?? "").trim();
  const item = sequenceInstruction(content, format, index);
  return `# AI Image Production Request

## Output Contract
- Asset format: ${config.label}
- Source reference: ${String(brief.source_ref)}
- Sequence item: ${index} of ${count}
- Exact aspect ratio: ${config.aspectRatio}
- Exact pixel dimensions: ${config.width}x${config.height}
- Output: one finished PNG image only
- Platform: Instagram

## Item-Specific Direction
${item}

## Exact Text Rules
- Render only wording the approved production brief explicitly identifies as display text, headline, overlay text, cover copy, slide copy, frame copy, or CTA copy.
- Preserve the approved wording and spelling. Do not add slogans, testimonials, metrics, prices, logos, badges, or claims.
- If the brief provides direction rather than exact display copy, create the visual composition without inventing visible text.

## Brand and Styling Authority
Use the brand, hierarchy, visual direction, composition, and styling rules in the complete approved brief below. This request is self-contained; do not assume any hidden brand context.

## Proof and Claim Restrictions
- Treat every proof boundary and claim restriction in the approved brief as binding.
- Do not invent testimonials, case studies, client outcomes, ROI, lead results, revenue results, customer logos, scarcity, endorsements, consent, or performance numbers.
- Do not visually imply unsupported proof.

## Complete Approved Production Brief
${content}

## Final Check
Return one image for sequence item ${index} only. It must match the required dimensions, remain legible on mobile, follow the approved hierarchy, and contain no unapproved text or proof claims.`;
}

async function generateImage(prompt: string, config: FormatConfig): Promise<{ bytes: Uint8Array; model: string; quality: string }> {
  const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const model = (Deno.env.get("OPENAI_IMAGE_MODEL") ?? "gpt-image-2").trim();
  const quality = (Deno.env.get("OPENAI_IMAGE_QUALITY") ?? "medium").trim();
  if (!new Set(["low", "medium", "high", "auto"]).has(quality)) throw new Error("OPENAI_IMAGE_QUALITY must be low, medium, high, or auto.");
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: `${config.width}x${config.height}`,
      quality,
      background: "opaque",
      moderation: "auto",
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.json().catch(() => ({})) as OpenAiImageResponse;
  if (!response.ok) throw new Error(`OpenAI Images returned HTTP ${response.status}: ${body.error?.message ?? "unknown provider error"}`);
  const base64 = body.data?.[0]?.b64_json;
  if (!base64) throw new Error("OpenAI Images returned no base64 image data.");
  return { bytes: decodeBase64(base64), model, quality };
}

export function serveAiAssetFunction(functionName: string, expectedFormat: SupportedAssetFormat): void {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return failure(functionName, 405, "request", "POST only");
    const sb = svc();
    let briefId = "";
    let groupRef = "";
    const uploadedPaths: string[] = [];
    try {
      const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
      if (userError || !user) return failure(functionName, 401, "authorization", "Not authenticated.");
      const { data: operator, error: operatorError } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
      if (operatorError) return failure(functionName, 500, "authorization", "Could not load operator role.", operatorError.message);
      if (!operator || !STAFF_ROLES.has(operator.role)) return failure(functionName, 403, "authorization", "Admin, account manager, or editor access is required.");

      const body = await req.json() as { production_brief_id?: string; expected_count?: number };
      briefId = body.production_brief_id?.trim() ?? "";
      const overrideCount = typeof body.expected_count === "number" ? body.expected_count : undefined;
      if (!briefId) return failure(functionName, 400, "request", "production_brief_id is required.");
      const { data: brief, error: briefError } = await sb.from("client_production_briefs").select("*").eq("id", briefId).maybeSingle();
      if (briefError || !brief) return failure(functionName, 404, "load_brief", "Production brief not found.", briefError?.message);
      if (brief.status !== "approved") return failure(functionName, 409, "gate", "Production brief must be approved before AI production.");
      if (brief.asset_format === "reel_video") return failure(functionName, 409, "gate", "AI video generation is not supported. Reel and video briefs are human-only.");
      if (brief.production_status === "producing") return failure(functionName, 409, "gate", "This production brief already has an AI generation request in progress.");
      if (!AI_FORMATS.has(brief.asset_format) || brief.asset_format !== expectedFormat) {
        return failure(functionName, 422, "gate", `${functionName} accepts ${expectedFormat} briefs only; received ${brief.asset_format}.`);
      }
      if (!(Deno.env.get("OPENAI_API_KEY") ?? "").trim()) return failure(functionName, 503, "configuration", "AI image production is not configured. OPENAI_API_KEY is required.");

      const format = brief.asset_format as SupportedAssetFormat;
      const config = FORMAT_CONFIG[format];
      let itemCount: number;
      try { itemCount = expectedItemCount(brief, overrideCount); }
      catch (error) { return failure(functionName, 422, "validate_brief", error instanceof Error ? error.message : String(error)); }

      groupRef = `${cleanPathPart(brief.source_ref)}-${Date.now()}`;
      const startedAt = new Date().toISOString();
      const { data: producingBrief, error: producingError } = await sb.from("client_production_briefs")
        .update({ production_mode: "ai", production_status: "producing", updated_at: startedAt })
        .eq("id", brief.id).neq("production_status", "producing").select("id").maybeSingle();
      if (producingError) return failure(functionName, 500, "start_generation", "Could not mark the production brief as producing.", producingError.message);
      if (!producingBrief) return failure(functionName, 409, "start_generation", "Another AI generation request started for this production brief.");

      const generatedAssets: Record<string, unknown>[] = [];
      for (let index = 1; index <= itemCount; index += 1) {
        const prompt = selfContainedPrompt(brief, format, index, itemCount);
        const generated = await generateImage(prompt, config);
        const storagePath = `${brief.client_id}/${brief.execution_month}/${cleanPathPart(brief.source_ref)}/${groupRef}/${String(index).padStart(2, "0")}.png`;
        const { error: uploadError } = await sb.storage.from(BUCKET).upload(storagePath, generated.bytes, { contentType: "image/png", upsert: false });
        if (uploadError) throw new Error(`Storage upload failed for item ${index}: ${uploadError.message}`);
        uploadedPaths.push(storagePath);
        const { data: asset, error: assetError } = await sb.from("client_assets").insert({
          client_id: brief.client_id,
          production_brief_id: brief.id,
          source_ref: brief.source_ref,
          asset_format: format,
          asset_group_ref: groupRef,
          sequence_index: index,
          title: itemCount === 1 ? brief.title : `${brief.title} — ${format === "carousel" ? "Slide" : "Frame"} ${index}`,
          storage_bucket: BUCKET,
          storage_path: storagePath,
          mime_type: "image/png",
          width: config.width,
          height: config.height,
          status: "needs_review",
          generation_provider: "openai",
          generation_model: generated.model,
          prompt_md: prompt,
          metadata: { aspect_ratio: config.aspectRatio, sequence_count: itemCount, quality: generated.quality, function: functionName },
        }).select("*").single();
        if (assetError || !asset) throw new Error(`Asset row insert failed for item ${index}: ${assetError?.message ?? "no row returned"}`);
        generatedAssets.push(asset);
      }

      if (generatedAssets.length !== itemCount || uploadedPaths.length !== itemCount) throw new Error(`Incomplete asset group: expected ${itemCount}, created ${generatedAssets.length}.`);
      const completedAt = new Date().toISOString();
      const { data: updatedBrief, error: briefUpdateError } = await sb.from("client_production_briefs")
        .update({ production_mode: "ai", production_status: "produced", updated_at: completedAt }).eq("id", brief.id).select("*").single();
      if (briefUpdateError || !updatedBrief) throw new Error(`Could not finalize the production brief: ${briefUpdateError?.message ?? "no row returned"}`);
      const previousArchive = await sb.from("client_assets").update({ status: "archived", updated_at: completedAt })
        .eq("production_brief_id", brief.id).neq("asset_group_ref", groupRef).neq("status", "archived");
      if (previousArchive.error) throw new Error(`Could not archive the previous generated asset group: ${previousArchive.error.message}`);
      await sb.from("activity_log").insert({
        client_id: brief.client_id,
        event_type: "production_assets_generated_ai",
        plain_english_message: `${brief.source_ref} generated ${itemCount} AI image asset${itemCount === 1 ? "" : "s"}.`,
        object_type: "client_production_brief",
        object_id: brief.id,
        metadata: { source_ref: brief.source_ref, asset_format: format, asset_group_ref: groupRef, asset_count: itemCount, function: functionName },
      });
      return json({ ok: true, function: functionName, asset_group_ref: groupRef, asset_count: itemCount, assets: generatedAssets, brief: updatedBrief });
    } catch (error) {
      if (uploadedPaths.length) await sb.storage.from(BUCKET).remove(uploadedPaths);
      if (groupRef) await sb.from("client_assets").delete().eq("asset_group_ref", groupRef);
      if (briefId) await sb.from("client_production_briefs").update({ production_mode: "ai", production_status: "failed", updated_at: new Date().toISOString() }).eq("id", briefId);
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("timed out") ? 504 : message.includes("OpenAI Images") ? 502 : 500;
      return failure(functionName, status, "generate_assets", message);
    }
  });
}
