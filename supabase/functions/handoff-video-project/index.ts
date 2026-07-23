// Reel Studio Phase D: the sole legitimate path that turns a completed Reel
// Studio project into AI-produced client_assets on a real, already-approved
// client_production_briefs row. This is deliberately NOT a relaxation of the
// existing reel_video/humanOnly gates in _shared/production-brief-contract.ts,
// _shared/ai-asset-generation.ts, or send-production-brief-to-contractor --
// those remain correct for the old synchronous AI-image pipeline and for
// blocking AI reels from going to a human contractor. This function is a new,
// narrowly-scoped addition: it only ever attaches assets to a brief that a
// human already approved, and only once every shot in the project has a real
// rendered clip.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES, cleanPathPart } from "../_shared/ai-asset-generation.ts";

const FUNCTION_NAME = "handoff-video-project";
const VIDEO_BUCKET = "video-assets";
// Matches the 9:16 aspect ratio declared for reel_video in production-brief-contract.ts.
const REEL_WIDTH = 1080;
const REEL_HEIGHT = 1920;

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "request", "POST only");

  const sb = svc();
  let insertedAssetIds: string[] = [];

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !user) return fail(401, "authorization", "Not authenticated.");

    const { data: operator } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (!operator || !STAFF_ROLES.has(operator.role)) return fail(403, "authorization", "Staff role required.");

    const videoProjectId = ((await req.json()) as { video_project_id?: string }).video_project_id?.trim() ?? "";
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");

    const project = await sb.from("video_projects").select("*").eq("id", videoProjectId).maybeSingle();
    if (project.error || !project.data) return fail(404, "project", "Video project not found.");
    if (project.data.status !== "approved") return fail(409, "gate", `Project must be 'approved' before handoff (currently '${project.data.status}').`);

    const shots = await sb.from("video_shots").select("*").eq("video_project_id", videoProjectId).order("shot_number", { ascending: true });
    if (shots.error) return fail(500, "shots", shots.error.message);
    if (!shots.data || shots.data.length === 0) return fail(409, "gate", "Project has no shots to hand off.");
    const incomplete = shots.data.find((shot) => shot.status !== "complete" || !shot.clip_url);
    if (incomplete) return fail(409, "gate", `Shot ${incomplete.shot_number} is not a completed, rendered clip.`);

    // Resolve the linked production brief. Never auto-create one -- a human
    // must already have approved a reel_video brief for this same source row.
    let briefId = project.data.client_production_brief_id as string | null;
    if (!briefId) {
      const sourceTable = project.data.organic_master_id ? "organic_master" : "ads_master";
      const sourceRowId = project.data.organic_master_id ?? project.data.ads_master_id;
      const matches = await sb.from("client_production_briefs").select("id")
        .eq("client_id", project.data.client_id).eq("source_table", sourceTable).eq("source_row_id", sourceRowId).eq("asset_format", "reel_video");
      if (matches.error) return fail(500, "resolve_brief", matches.error.message);
      if (!matches.data || matches.data.length === 0) return fail(409, "gate", "No reel_video production brief exists for this project's source row. Create and approve one first.");
      if (matches.data.length > 1) return fail(409, "gate", "Multiple reel_video production briefs exist for this source row -- link video_projects.client_production_brief_id explicitly before handoff.");
      briefId = matches.data[0].id;
    }

    const brief = await sb.from("client_production_briefs").select("*").eq("id", briefId).maybeSingle();
    if (brief.error || !brief.data) return fail(404, "brief", "Linked production brief not found.");
    if (brief.data.status !== "approved") return fail(409, "gate", "Linked production brief must be approved before handoff.");
    if (brief.data.asset_format !== "reel_video") return fail(409, "gate", "Linked production brief is not a reel_video brief.");

    if (!project.data.client_production_brief_id) {
      await sb.from("video_projects").update({ client_production_brief_id: briefId }).eq("id", videoProjectId);
    }

    const groupRef = `${cleanPathPart(brief.data.source_ref)}-${Date.now()}`;
    const generatedAssets: Record<string, unknown>[] = [];
    for (const shot of shots.data) {
      const { data: asset, error: assetError } = await sb.from("client_assets").insert({
        client_id: brief.data.client_id,
        production_brief_id: brief.data.id,
        source_ref: brief.data.source_ref,
        asset_format: "reel_video",
        asset_group_ref: groupRef,
        sequence_index: shot.shot_number,
        title: `${brief.data.title} — Shot ${shot.shot_number}`,
        storage_bucket: VIDEO_BUCKET,
        storage_path: shot.clip_url,
        mime_type: "video/mp4",
        width: REEL_WIDTH,
        height: REEL_HEIGHT,
        status: "needs_review",
        generation_provider: "higgsfield",
        generation_model: shot.model,
        prompt_md: shot.compiled_prompt,
        metadata: {
          video_project_id: videoProjectId, shot_id: shot.id, shot_number: shot.shot_number,
          duration_sec: shot.duration_sec, render_tier: shot.render_tier, motion_type: shot.motion_type,
        },
      }).select("id").single();
      if (assetError || !asset) throw new Error(`Asset row insert failed for shot ${shot.shot_number}: ${assetError?.message ?? "no row returned"}`);
      insertedAssetIds.push(asset.id as string);
      generatedAssets.push(asset);
    }

    const completedAt = new Date().toISOString();
    const { data: updatedBrief, error: briefUpdateError } = await sb.from("client_production_briefs")
      .update({ production_mode: "ai", production_status: "produced", updated_at: completedAt }).eq("id", brief.data.id).select("*").single();
    if (briefUpdateError || !updatedBrief) throw new Error(`Could not finalize the production brief: ${briefUpdateError?.message ?? "no row returned"}`);

    const previousArchive = await sb.from("client_assets").update({ status: "archived", updated_at: completedAt })
      .eq("production_brief_id", brief.data.id).neq("asset_group_ref", groupRef).neq("status", "archived");
    if (previousArchive.error) throw new Error(`Could not archive the previous generated asset group: ${previousArchive.error.message}`);

    const updatedProject = await sb.from("video_projects")
      .update({ status: "handed_off", updated_at: completedAt })
      .eq("id", videoProjectId).eq("status", "approved").select("*").single();
    if (updatedProject.error || !updatedProject.data) throw new Error(`Could not mark project as handed off: ${updatedProject.error?.message ?? "no row returned"}`);

    await sb.from("activity_log").insert({
      client_id: brief.data.client_id,
      event_type: "reel_studio_handoff",
      plain_english_message: `${brief.data.source_ref} handed off ${shots.data.length} Reel Studio clip${shots.data.length === 1 ? "" : "s"} to production.`,
      object_type: "client_production_brief",
      object_id: brief.data.id,
      metadata: { video_project_id: videoProjectId, asset_group_ref: groupRef, shot_count: shots.data.length },
    });

    return json({ ok: true, asset_group_ref: groupRef, asset_count: generatedAssets.length, assets: generatedAssets, brief: updatedBrief, project: updatedProject.data });
  } catch (error) {
    if (insertedAssetIds.length) await sb.from("client_assets").delete().in("id", insertedAssetIds);
    const message = error instanceof Error ? error.message : String(error);
    return fail(500, "handoff", message);
  }
});
