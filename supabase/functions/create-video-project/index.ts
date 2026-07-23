// Reel Studio Phase C: creates one video_projects row tied to exactly one
// planned content row (an organic_master or ads_master row for the same
// client -- mirrors the DB's XOR source constraint). This is the entry point
// for turning a planned piece of content into a Reel Studio production.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";

const FUNCTION_NAME = "create-video-project";
const ARCHETYPES = new Set(["A1", "A2", "A3", "A4", "A5"]);
const AWARENESS_STAGES = new Set(["unaware", "problem_aware", "solution_aware", "product_aware", "most_aware"]);
const SOURCE_TABLES = new Set(["organic_master", "ads_master"]);

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

interface Body {
  client_id?: string;
  source_table?: string;
  source_row_id?: string;
  title?: string;
  archetype?: string;
  awareness_stage?: string;
  target_duration_sec?: number;
  brand_prompt_block_id?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "request", "POST only");

  const sb = svc();

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !user) return fail(401, "authorization", "Not authenticated.");

    const { data: operator } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (!operator || !STAFF_ROLES.has(operator.role)) return fail(403, "authorization", "Staff role required.");

    const body = (await req.json()) as Body;
    const clientId = body.client_id?.trim() ?? "";
    const sourceTable = body.source_table?.trim() ?? "";
    const sourceRowId = body.source_row_id?.trim() ?? "";
    const title = body.title?.trim() ?? "";
    const archetype = body.archetype?.trim() ?? "";
    const awarenessStage = body.awareness_stage?.trim() ?? "";
    const targetDurationSec = body.target_duration_sec;

    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!SOURCE_TABLES.has(sourceTable)) return fail(400, "request", "source_table must be organic_master or ads_master.");
    if (!sourceRowId) return fail(400, "request", "source_row_id is required.");
    if (!title) return fail(400, "request", "title is required.");
    if (!ARCHETYPES.has(archetype)) return fail(400, "request", "archetype must be one of A1-A5.");
    if (!AWARENESS_STAGES.has(awarenessStage)) return fail(400, "request", "awareness_stage is not a recognized value.");
    if (typeof targetDurationSec !== "number" || targetDurationSec < 22 || targetDurationSec > 34) {
      return fail(400, "request", "target_duration_sec must be between 22 and 34.");
    }

    const source = await sb.from(sourceTable).select("id, client_id").eq("id", sourceRowId).maybeSingle();
    if (source.error || !source.data) return fail(404, "source", "Source row not found.");
    if (source.data.client_id !== clientId) return fail(400, "source", "Source row does not belong to client_id.");

    let brandBlock;
    if (body.brand_prompt_block_id?.trim()) {
      brandBlock = await sb.from("brand_prompt_blocks").select("id, version").eq("id", body.brand_prompt_block_id.trim()).maybeSingle();
    } else {
      brandBlock = await sb.from("brand_prompt_blocks").select("id, version")
        .eq("block_type", "brand_dna").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
    }
    if (brandBlock.error || !brandBlock.data) return fail(404, "brand_prompt_block", "No brand prompt block found (specify brand_prompt_block_id or activate one).");

    const insert = await sb.from("video_projects").insert({
      client_id: clientId,
      organic_master_id: sourceTable === "organic_master" ? sourceRowId : null,
      ads_master_id: sourceTable === "ads_master" ? sourceRowId : null,
      archetype,
      awareness_stage: awarenessStage,
      target_duration_sec: targetDurationSec,
      brand_prompt_block_id: brandBlock.data.id,
      brand_prompt_block_version: brandBlock.data.version,
      title,
      created_by: user.id,
    }).select("*").single();
    if (insert.error || !insert.data) return fail(500, "insert", insert.error?.message ?? "Could not create video project.");

    return json({ ok: true, project: insert.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(500, "create", message);
  }
});
