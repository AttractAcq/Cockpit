// Programme Stage J — select and lock a Reel project's production strategy.
// Idempotent: once a strategy is set, replays the existing decision unless
// the caller explicitly confirms an override (a strategy change after shots
// already exist is a real operational decision, not something to do silently).

import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import { selectReelProductionStrategy, type AutomationPolicy, type QualityRequirement } from "../_shared/reel-production.ts";

const FUNCTION_NAME = "select-reel-production-strategy";
const fail = (status: number, stage: string, message: string, code?: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message, code }, status);

const AUTOMATION_POLICIES: readonly AutomationPolicy[] = ["ai_first", "human_first", "hybrid_allowed"];
const QUALITY_REQUIREMENTS: readonly QualityRequirement[] = ["draft", "standard", "premium"];

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

    const body = (await req.json()) as {
      client_id?: string; video_project_id?: string;
      proof_available?: boolean; real_footage_available?: boolean;
      automation_policy?: string; quality_requirement?: string;
      confirm_override?: boolean;
    };
    const clientId = body.client_id?.trim() ?? "";
    const videoProjectId = body.video_project_id?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");

    const automationPolicy = body.automation_policy as AutomationPolicy;
    const qualityRequirement = body.quality_requirement as QualityRequirement;
    if (!AUTOMATION_POLICIES.includes(automationPolicy)) {
      return fail(400, "request", `automation_policy must be one of: ${AUTOMATION_POLICIES.join(", ")}`);
    }
    if (!QUALITY_REQUIREMENTS.includes(qualityRequirement)) {
      return fail(400, "request", `quality_requirement must be one of: ${QUALITY_REQUIREMENTS.join(", ")}`);
    }

    const project = await sb.from("video_projects")
      .select("id, client_id, production_strategy, reel_style_id")
      .eq("id", videoProjectId).eq("client_id", clientId).maybeSingle();
    if (project.error) return fail(500, "project", project.error.message);
    if (!project.data) return fail(404, "project", "Video project not found for this client.");

    if (project.data.production_strategy && !body.confirm_override) {
      return json({
        ok: true,
        idempotent_replay: true,
        strategy: project.data.production_strategy,
        reason: "A strategy is already set for this project. Pass confirm_override: true to change it.",
      });
    }

    const decision = selectReelProductionStrategy({
      proofAvailable: body.proof_available === true,
      realFootageAvailable: body.real_footage_available === true,
      automationPolicy,
      qualityRequirement,
    });

    // Attach the client's default Reel style if the project has none yet.
    let reelStyleId = project.data.reel_style_id as string | null;
    if (!reelStyleId) {
      const style = await sb.from("client_reel_styles").select("id").eq("client_id", clientId).eq("is_default", true).maybeSingle();
      reelStyleId = style.data?.id ?? null;
    }

    const updated = await sb.from("video_projects")
      .update({ production_strategy: decision.strategy, reel_style_id: reelStyleId })
      .eq("id", videoProjectId)
      .select("id, production_strategy, reel_style_id")
      .single();
    if (updated.error) return fail(500, "update", updated.error.message);

    return json({ ok: true, idempotent_replay: false, strategy: decision.strategy, reason: decision.reason, reel_style_id: reelStyleId });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
