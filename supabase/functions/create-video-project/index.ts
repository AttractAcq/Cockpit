// Reel Studio Phase C: creates one video_projects row, optionally tied to a
// planned content row (an organic_master or ads_master row for the same
// client -- mirrors the DB's "at most one" source constraint). source_table
// and source_row_id may both be omitted for a genuinely original reel that
// isn't already planned in the content pipeline (a standalone project).
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import { validateBoundReelBrief } from "../_shared/reel-studio-contract.ts";
import { resolveReelSourceEligibility } from "../_shared/reel-studio-eligibility.ts";
import { isProductionMode, type ProductionMode } from "../_shared/production-mode-contract.ts";

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
  client_production_brief_id?: string;
  avatar_asset_ids?: unknown;
}

type JsonRecord = Record<string, unknown>;

const AVATAR_COMPONENT_TYPES = [
  "appearance",
  "environment",
  "voice_personality",
  "creative_direction",
  "knowledge_expertise",
  "content_format",
] as const;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function compactText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function payloadSummary(payload: JsonRecord): JsonRecord {
  return {
    title: compactText(payload.title, 300),
    summary: compactText(payload.summary, 900),
    strategic_rationale: compactText(payload.strategic_rationale, 900),
    structured_payload: payload.structured_payload && typeof payload.structured_payload === "object"
      ? payload.structured_payload
      : {},
  };
}

async function loadApprovedAvatarReferences(
  sb: ReturnType<typeof svc>,
  clientId: string,
  requestedAssetIds: string[],
): Promise<{ ok: true; releaseId: string; componentIds: string[]; assetIds: string[]; payload: JsonRecord } | { ok: false; message: string }> {
  const active = await sb.from("client_avatar_active_releases")
    .select("release_id, release:client_avatar_releases(id, client_id, version, status, title, summary)")
    .eq("client_id", clientId)
    .maybeSingle();
  if (active.error) return { ok: false, message: active.error.message };
  const release = Array.isArray(active.data?.release) ? active.data?.release[0] : active.data?.release;
  if (!active.data?.release_id || !release || release.status !== "approved") {
    return { ok: false, message: "Avatar-led Reel Studio projects require an active approved Avatar OS release." };
  }

  const components = await sb.from("client_avatar_components")
    .select("id, component_type, title, summary, strategic_rationale, structured_payload")
    .eq("client_id", clientId)
    .eq("release_id", active.data.release_id)
    .in("component_type", [...AVATAR_COMPONENT_TYPES])
    .order("display_order");
  if (components.error) return { ok: false, message: components.error.message };

  let assetQuery = sb.from("client_avatar_assets")
    .select("id, asset_type, title, description, storage_bucket, storage_path, external_url, prompt_payload, generation_provider, generation_model, version")
    .eq("client_id", clientId)
    .eq("release_id", active.data.release_id)
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  if (requestedAssetIds.length) assetQuery = assetQuery.in("id", requestedAssetIds);
  const assets = await assetQuery;
  if (assets.error) return { ok: false, message: assets.error.message };

  const componentRows = (components.data ?? []) as JsonRecord[];
  const assetRows = (assets.data ?? []) as JsonRecord[];
  if (requestedAssetIds.length && assetRows.length !== new Set(requestedAssetIds).size) {
    return { ok: false, message: "One or more requested Avatar OS assets are not approved for the active release." };
  }

  const componentIds = componentRows.map((row) => String(row.id));
  const assetIds = assetRows.map((row) => String(row.id));
  const payload = {
    avatar_release: {
      id: release.id,
      version: release.version,
      title: release.title,
      summary: release.summary,
      status: release.status,
    },
    components: Object.fromEntries(
      componentRows.map((row) => [String(row.component_type), payloadSummary(row)]),
    ),
    approved_assets: assetRows.map((row) => ({
      id: row.id,
      asset_type: row.asset_type,
      title: row.title,
      description: row.description,
      storage_bucket: row.storage_bucket,
      storage_path: row.storage_path,
      external_url: row.external_url,
      generation_provider: row.generation_provider,
      generation_model: row.generation_model,
      version: row.version,
      prompt_payload: row.prompt_payload,
    })),
    guardrails: [
      "Use only approved Avatar OS components and approved assets from this payload.",
      "Do not invent appearance, voice, knowledge, proof, or rights clearance beyond approved Avatar OS authority.",
      "Avatar-led production is optional downstream authority, not a requirement for non-avatar production modes.",
    ],
  };

  return { ok: true, releaseId: active.data.release_id, componentIds, assetIds, payload };
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
    const productionBriefId = body.client_production_brief_id?.trim() ?? "";
    const requestedAvatarAssetIds = strings(body.avatar_asset_ids);

    if (!clientId) return fail(400, "request", "client_id is required.");
    if (sourceTable || sourceRowId) {
      if (!SOURCE_TABLES.has(sourceTable)) return fail(400, "request", "source_table must be organic_master or ads_master.");
      if (!sourceRowId) return fail(400, "request", "source_table and source_row_id must both be provided, or both omitted.");
    }
    if (productionBriefId && (!sourceTable || !sourceRowId)) {
      return fail(400, "request", "A bound production brief requires source_table and source_row_id.");
    }
    // Phase 2, Workstream B: a source-linked project MUST carry the approved
    // reel_video brief it will be produced from. Without one, storyboard
    // generation and handoff can never complete, so creating it would strand the
    // operator in an impossible workflow. Standalone (sourceless) projects remain
    // supported and are manually operable.
    if ((sourceTable || sourceRowId) && !productionBriefId) {
      return fail(
        409,
        "eligibility",
        "A Reel Studio project linked to a content row must be bound to its approved reel_video production brief. Open the brief in Content Briefs and choose Produce → AI, or create a standalone project with no linked source.",
      );
    }
    if (!title) return fail(400, "request", "title is required.");
    if (!ARCHETYPES.has(archetype)) return fail(400, "request", "archetype must be one of A1-A5.");
    if (!AWARENESS_STAGES.has(awarenessStage)) return fail(400, "request", "awareness_stage is not a recognized value.");
    if (typeof targetDurationSec !== "number" || !Number.isInteger(targetDurationSec) || targetDurationSec < 22 || targetDurationSec > 34) {
      return fail(400, "request", "target_duration_sec must be an integer between 22 and 34.");
    }

    let sourceRow: Record<string, unknown> | null = null;
    if (sourceTable && sourceRowId) {
      const source = await sb.from(sourceTable).select("*").eq("id", sourceRowId).maybeSingle();
      if (source.error || !source.data) return fail(404, "source", "Source row not found.");
      if (source.data.client_id !== clientId) return fail(400, "source", "Source row does not belong to client_id.");
      sourceRow = source.data as Record<string, unknown>;
    }

    let productionMode: ProductionMode | null = null;
    if (productionBriefId) {
      const brief = await sb.from("client_production_briefs")
        .select("id, client_id, source_table, source_row_id, asset_format, status, production_mode, production_status, content_md, metadata")
        .eq("id", productionBriefId)
        .maybeSingle();
      if (brief.error) return fail(500, "brief", brief.error.message);
      if (!brief.data) return fail(404, "brief", "Production brief not found.");
      const validation = validateBoundReelBrief(
        { clientId, sourceTable, sourceRowId },
        brief.data,
      );
      if (!validation.ok) return fail(409, "brief", validation.error);

      // The single authoritative eligibility decision — the same resolver the UI
      // renders and every downstream Reel Studio operation re-applies. This is
      // what stops a static Ads source, a non-Reel Organic row, or a human-only
      // brief from entering an impossible workflow.
      const eligibility = resolveReelSourceEligibility({
        sourceTable, sourceRow, brief: brief.data, briefCandidateCount: 1,
      });
      if (!eligibility.eligible) return fail(409, "eligibility", eligibility.reason);
      productionMode = isProductionMode(brief.data.production_mode) ? brief.data.production_mode : null;
    }

    let brandBlock;
    if (body.brand_prompt_block_id?.trim()) {
      brandBlock = await sb.from("brand_prompt_blocks").select("id, version").eq("id", body.brand_prompt_block_id.trim()).maybeSingle();
    } else {
      brandBlock = await sb.from("brand_prompt_blocks").select("id, version")
        .eq("block_type", "brand_dna").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
    }
    if (brandBlock.error || !brandBlock.data) return fail(404, "brand_prompt_block", "No brand prompt block found (specify brand_prompt_block_id or activate one).");

    const insert = productionBriefId
      ? await sb.rpc("create_bound_reel_video_project", {
        p_client_id: clientId,
        p_source_table: sourceTable,
        p_source_row_id: sourceRowId,
        p_client_production_brief_id: productionBriefId,
        p_title: title,
        p_archetype: archetype,
        p_awareness_stage: awarenessStage,
        p_target_duration_sec: targetDurationSec,
        p_brand_prompt_block_id: brandBlock.data.id,
        p_created_by: user.id,
      })
      : await sb.from("video_projects").insert({
        client_id: clientId,
        organic_master_id: sourceTable === "organic_master" ? sourceRowId : null,
        ads_master_id: sourceTable === "ads_master" ? sourceRowId : null,
        client_production_brief_id: null,
        archetype,
        awareness_stage: awarenessStage,
        target_duration_sec: targetDurationSec,
        brand_prompt_block_id: brandBlock.data.id,
        brand_prompt_block_version: brandBlock.data.version,
        title,
        created_by: user.id,
      }).select("*").single();
    if (insert.error || !insert.data) {
      const message = insert.error?.message ?? "Could not create video project.";
      return fail(productionBriefId && message.includes("REEL_") ? 409 : 500, "insert", message);
    }

    let project = insert.data;
    let avatarReferencePayload: JsonRecord | null = null;
    if (productionMode === "avatar_led") {
      const avatarRefs = await loadApprovedAvatarReferences(sb, clientId, requestedAvatarAssetIds);
      if (!avatarRefs.ok) return fail(409, "avatar_os", avatarRefs.message);
      avatarReferencePayload = avatarRefs.payload;
      const avatarPatch = {
        avatar_release_id: avatarRefs.releaseId,
        avatar_asset_ids: avatarRefs.assetIds,
        avatar_reference_payload: avatarRefs.payload,
      };
      const updatedProject = await sb.from("video_projects")
        .update(avatarPatch)
        .eq("id", project.id)
        .eq("client_id", clientId)
        .select("*")
        .single();
      if (updatedProject.error || !updatedProject.data) {
        return fail(500, "avatar_os", updatedProject.error?.message ?? "Could not attach Avatar OS references to the Reel Studio project.");
      }
      project = updatedProject.data;

      await sb.from("client_production_briefs")
        .update({
          avatar_release_id: avatarRefs.releaseId,
          avatar_component_ids: avatarRefs.componentIds,
          avatar_asset_ids: avatarRefs.assetIds,
          avatar_reference_payload: avatarRefs.payload,
        })
        .eq("id", productionBriefId)
        .eq("client_id", clientId);
    }

    return json({
      ok: true,
      project,
      bound_production_brief_id: productionBriefId || null,
      avatar_reference_attached: avatarReferencePayload !== null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(500, "create", message);
  }
});
