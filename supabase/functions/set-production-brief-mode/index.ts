// Reel Studio Phase 2, Workstream A: the only server path that changes a
// production brief's production mode.
//
// Approved authority is never silently overwritten. Changing the mode of an
// already-approved brief requires an explicit acknowledgement, and adopting an
// AI/hybrid mode while the brief's own markdown still reads "Human Production
// Only" requires a second, separate acknowledgement. Every change is audited in
// activity_log and recorded in the brief's metadata.
//
// This never edits the brief's markdown and never changes its review status —
// resolving contradictory text is a deliberate regeneration, not a side effect.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import {
  PRODUCTION_BRIEF_CONTRACTS,
  type AssetFormat,
} from "../_shared/production-brief-contract.ts";
import {
  briefTextIsHumanOnly,
  isProductionMode,
  PRODUCTION_MODE_ERROR,
  validateProductionModeTransition,
  type ProductionMode,
} from "../_shared/production-mode-contract.ts";

const FUNCTION_NAME = "set-production-brief-mode";

const fail = (status: number, stage: string, message: string, code?: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message, code }, status);

interface Body {
  production_brief_id?: string;
  production_mode?: string;
  expected_updated_at?: string;
  acknowledge_approved_change?: boolean;
  acknowledge_text_conflict?: boolean;
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
    const briefId = body.production_brief_id?.trim() ?? "";
    const targetMode = body.production_mode?.trim() ?? "";
    const expectedUpdatedAt = body.expected_updated_at?.trim() ?? "";
    if (!briefId) return fail(400, "request", "production_brief_id is required.");
    if (!isProductionMode(targetMode)) return fail(400, "request", PRODUCTION_MODE_ERROR);
    if (!expectedUpdatedAt) return fail(400, "request", "expected_updated_at is required for optimistic concurrency.");

    const loaded = await sb.from("client_production_briefs").select("*").eq("id", briefId).maybeSingle();
    if (loaded.error) return fail(500, "brief", loaded.error.message);
    if (!loaded.data) return fail(404, "brief", "Production brief not found.");
    const brief = loaded.data as {
      id: string; client_id: string; source_ref: string; asset_format: string;
      status: string; production_mode: string | null; production_status: string;
      content_md: string; metadata: Record<string, unknown> | null; updated_at: string;
    };

    const contract = PRODUCTION_BRIEF_CONTRACTS[brief.asset_format as AssetFormat];
    if (!contract) return fail(409, "contract", `Unknown asset_format "${brief.asset_format}".`);

    const transition = validateProductionModeTransition({
      brief,
      targetMode: targetMode as ProductionMode,
      supportedModes: contract.supportedModes,
      acknowledgedApprovedChange: body.acknowledge_approved_change === true,
      acknowledgedTextConflict: body.acknowledge_text_conflict === true,
    });
    if (!transition.ok) return fail(409, "transition", transition.error, transition.code);
    if (transition.unchanged) return json({ ok: true, brief: loaded.data, unchanged: true });

    const previousMode = brief.production_mode;
    const changedAt = new Date().toISOString();
    const textConflict = transition.textConflict;
    const metadata = {
      ...(brief.metadata ?? {}),
      human_only: targetMode === "human" || targetMode === "human_led",
      production_mode: targetMode,
      production_mode_source: "explicit_operator_selection",
      production_mode_set_at: changedAt,
      production_mode_set_by: user.id,
      production_mode_previous: previousMode,
      ai_production_path: targetMode === "human" || targetMode === "human_led" ? null : contract.aiPath,
      // Kept visible so the UI can warn that the markdown still contradicts the
      // selected mode until the brief is regenerated in that mode.
      production_mode_text_conflict: textConflict,
      production_mode_text_conflict_confirmed_at: textConflict ? changedAt : null,
    };

    // Optimistic concurrency: a stale request must fail rather than overwrite.
    const updated = await sb.from("client_production_briefs")
      .update({ production_mode: targetMode, metadata, updated_at: changedAt })
      .eq("id", briefId)
      .eq("updated_at", expectedUpdatedAt)
      .select("*")
      .single();
    if (updated.error || !updated.data) {
      return fail(409, "concurrency", "The production brief changed while the mode was being set; reload and try again.", "BRIEF_STALE");
    }

    await sb.from("activity_log").insert({
      client_id: brief.client_id,
      event_type: "production_brief_mode_changed",
      plain_english_message: `${brief.source_ref} production mode set to ${targetMode}${previousMode ? ` (was ${previousMode})` : ""}.`,
      object_type: "client_production_brief",
      object_id: brief.id,
      metadata: {
        production_brief_id: brief.id,
        source_ref: brief.source_ref,
        asset_format: brief.asset_format,
        previous_mode: previousMode,
        new_mode: targetMode,
        brief_status: brief.status,
        text_conflict_confirmed: textConflict,
        ai_production_path: targetMode === "human" || targetMode === "human_led" ? null : contract.aiPath,
      },
    });

    return json({
      ok: true,
      brief: updated.data,
      unchanged: false,
      text_conflict: textConflict,
      text_still_human_only: briefTextIsHumanOnly(updated.data as { asset_format: string; production_mode: string | null; content_md: string; metadata: Record<string, unknown> }),
    });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
