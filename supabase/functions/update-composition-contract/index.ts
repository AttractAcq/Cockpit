// Programme Stage J — edit a composition contract's fields, or transition
// its status. "ready" requires every field to validate against the shared
// contract and the render mode to actually be supported. "rendered" requires
// linking an already-uploaded, already-approved final Reel from the existing
// live Phase 3 system (video_project_deliverables) -- this function never
// creates or approves a deliverable itself, it only records which one this
// contract's timeline produced.

import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import {
  validateTimeline,
  validateVoiceTrack,
  validateAudioSpec,
  validateCaptionSpec,
  checkRenderCapability,
  checkDurationAlignment,
  type RenderMode,
} from "../_shared/reel-production.ts";

const FUNCTION_NAME = "update-composition-contract";
const fail = (status: number, stage: string, message: string, code?: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message, code }, status);

const RENDER_MODES: readonly RenderMode[] = ["automated_template", "provider_render", "human_editor_handoff", "manual_upload"];

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
      client_id?: string; composition_contract_id?: string;
      timeline?: unknown; voice_track?: unknown; audio?: unknown; captions?: unknown; cta_frame?: unknown;
      render_mode?: string; status?: string; rendered_deliverable_id?: string;
    };
    const clientId = body.client_id?.trim() ?? "";
    const contractId = body.composition_contract_id?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!contractId) return fail(400, "request", "composition_contract_id is required.");

    const existing = await sb.from("video_composition_contracts").select("*").eq("id", contractId).eq("client_id", clientId).maybeSingle();
    if (existing.error) return fail(500, "lookup", existing.error.message);
    if (!existing.data) return fail(404, "contract", "Composition contract not found for this client.");
    const contract = existing.data;

    const patch: Record<string, unknown> = {};

    if (body.timeline !== undefined) {
      const timeline = validateTimeline(body.timeline);
      if (timeline === null) return fail(422, "validation", "Invalid timeline.", "INVALID_TIMELINE");
      patch.timeline = timeline;
    }
    if (body.voice_track !== undefined) {
      const voiceTrack = validateVoiceTrack(body.voice_track);
      if (voiceTrack === null) return fail(422, "validation", "Invalid voice track.", "INVALID_VOICE_TRACK");
      patch.voice_track = voiceTrack;
    }
    if (body.audio !== undefined) {
      const audio = validateAudioSpec(body.audio);
      if (audio === null) return fail(422, "validation", "Invalid audio spec.", "INVALID_AUDIO");
      patch.audio = audio;
    }
    if (body.captions !== undefined) {
      const captions = validateCaptionSpec(body.captions);
      if (captions === null) return fail(422, "validation", "Invalid captions spec.", "INVALID_CAPTIONS");
      patch.captions = captions;
    }
    if (body.cta_frame !== undefined) {
      if (typeof body.cta_frame !== "object" || body.cta_frame === null) return fail(422, "validation", "Invalid CTA frame.", "INVALID_CTA_FRAME");
      patch.cta_frame = body.cta_frame;
    }
    if (body.render_mode !== undefined) {
      if (!RENDER_MODES.includes(body.render_mode as RenderMode)) {
        return fail(422, "validation", `render_mode must be one of: ${RENDER_MODES.join(", ")}`, "INVALID_RENDER_MODE");
      }
      patch.render_mode = body.render_mode;
    }

    const warnings: string[] = [];

    if (body.status !== undefined) {
      if (body.status === "ready") {
        const merged = { ...contract, ...patch };
        const timeline = validateTimeline(merged.timeline);
        const voiceTrack = validateVoiceTrack(merged.voice_track);
        const audio = validateAudioSpec(merged.audio);
        const captions = validateCaptionSpec(merged.captions);
        if (!timeline || timeline.length === 0) return fail(409, "status", "The timeline must have at least one entry before this contract can be marked ready.", "TIMELINE_REQUIRED");
        if (!voiceTrack) return fail(409, "status", "A valid voice track is required before this contract can be marked ready.", "VOICE_TRACK_REQUIRED");
        if (!audio) return fail(409, "status", "A valid audio spec is required before this contract can be marked ready.", "AUDIO_REQUIRED");
        if (!captions) return fail(409, "status", "A valid captions spec is required before this contract can be marked ready.", "CAPTIONS_REQUIRED");
        const capability = checkRenderCapability(merged.render_mode as RenderMode);
        if (!capability.supported) return fail(409, "status", capability.reason ?? "This render mode is not supported.", "RENDER_MODE_UNSUPPORTED");

        const project = await sb.from("video_projects").select("target_duration_sec").eq("id", contract.video_project_id).maybeSingle();
        if (project.data) {
          const alignment = checkDurationAlignment(timeline, project.data.target_duration_sec);
          if (!alignment.aligned) warnings.push(alignment.detail);
        }
        patch.status = "ready";
      } else if (body.status === "rendered") {
        const deliverableId = (body.rendered_deliverable_id ?? "").trim();
        if (!deliverableId) return fail(400, "request", "rendered_deliverable_id is required to mark a contract rendered.");
        const deliverable = await sb.from("video_project_deliverables")
          .select("id, client_id, video_project_id, status, mime_type")
          .eq("id", deliverableId).maybeSingle();
        if (deliverable.error) return fail(500, "deliverable", deliverable.error.message);
        if (!deliverable.data) return fail(404, "deliverable", "Deliverable not found.");
        if (deliverable.data.client_id !== clientId || deliverable.data.video_project_id !== contract.video_project_id) {
          return fail(409, "deliverable", "This deliverable does not belong to the contract's project.", "DELIVERABLE_PROJECT_MISMATCH");
        }
        if (deliverable.data.status !== "approved") {
          return fail(409, "deliverable", "The final Reel must be approved before this contract can be marked rendered.", "DELIVERABLE_NOT_APPROVED");
        }
        patch.status = "rendered";
        patch.rendered_deliverable_id = deliverableId;
      } else if (body.status === "draft") {
        patch.status = "draft";
      } else {
        return fail(422, "validation", "status must be one of: draft, ready, rendered.", "INVALID_STATUS");
      }
    }

    if (Object.keys(patch).length === 0) return json({ ok: true, contract, warnings: [] });

    const updated = await sb.from("video_composition_contracts").update(patch).eq("id", contractId).select("*").single();
    if (updated.error) return fail(500, "update", updated.error.message);

    return json({ ok: true, contract: updated.data, warnings });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
