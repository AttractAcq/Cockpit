// Programme Stage J — create the composition contract for a Reel project:
// the structured timeline built from the project's current shots, ready for
// the operator to fill in voice/audio/captions/CTA before marking it ready.
// Idempotent: returns the existing contract if one already exists.

import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import type { TimelineEntry } from "../_shared/reel-production.ts";

const FUNCTION_NAME = "create-composition-contract";
const fail = (status: number, stage: string, message: string, code?: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message, code }, status);

const DEFAULT_SHOT_DURATION_SEC = 3;

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

    const body = (await req.json()) as { client_id?: string; video_project_id?: string; render_mode?: string };
    const clientId = body.client_id?.trim() ?? "";
    const videoProjectId = body.video_project_id?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");

    const project = await sb.from("video_projects").select("id, client_id").eq("id", videoProjectId).eq("client_id", clientId).maybeSingle();
    if (project.error) return fail(500, "project", project.error.message);
    if (!project.data) return fail(404, "project", "Video project not found for this client.");

    const existing = await sb.from("video_composition_contracts").select("*").eq("video_project_id", videoProjectId).maybeSingle();
    if (existing.error) return fail(500, "lookup", existing.error.message);
    if (existing.data) return json({ ok: true, idempotent_replay: true, contract: existing.data });

    const shots = await sb.from("video_shots")
      .select("id, shot_number, duration_sec, transition_to_next")
      .eq("video_project_id", videoProjectId)
      .order("shot_number", { ascending: true });
    if (shots.error) return fail(500, "shots", shots.error.message);

    const timeline: TimelineEntry[] = (shots.data ?? []).map((shot) => ({
      order: shot.shot_number,
      source: "shot",
      shot_id: shot.id,
      duration_sec: typeof shot.duration_sec === "number" && shot.duration_sec > 0 ? shot.duration_sec : DEFAULT_SHOT_DURATION_SEC,
      transition: shot.transition_to_next ?? null,
    }));

    const renderMode = (body.render_mode ?? "human_editor_handoff").trim();

    const inserted = await sb.from("video_composition_contracts")
      .insert({ client_id: clientId, video_project_id: videoProjectId, render_mode: renderMode, timeline, status: "draft" })
      .select("*")
      .single();
    if (inserted.error) return fail(500, "insert", inserted.error.message);

    return json({ ok: true, idempotent_replay: false, contract: inserted.data }, 201);
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
