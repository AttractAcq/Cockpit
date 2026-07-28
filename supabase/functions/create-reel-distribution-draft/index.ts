// Reel Studio Phase 3: create the distribution draft for an approved, current
// final Reel.
//
// This is the ONLY path that produces a REELS distribution record. Every
// prerequisite is proved server-side against the database and storage before the
// draft exists, and the same decision is re-applied by the scheduling trigger,
// the claim RPC and the publishing worker — so a draft can never be created that
// the publisher would later refuse.
//
// Shot clips can never reach this path: they live in client_assets and carry no
// deliverable id, and the SQL capability function blocks any REELS record whose
// video_deliverable_id is null.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/staff-roles.ts";
import {
  FINAL_REEL_BUCKET,
  resolveReelPublicationEligibility,
  type FinalReelDeliverable,
} from "../_shared/final-reel-contract.ts";

const FUNCTION_NAME = "create-reel-distribution-draft";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const fail = (status: number, stage: string, message: string, code?: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message, code }, status);

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
      client_id?: string; video_project_id?: string; caption?: string; planned_publish_date?: string;
      share_to_feed?: boolean;
    };
    const clientId = body.client_id?.trim() ?? "";
    const videoProjectId = body.video_project_id?.trim() ?? "";
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!videoProjectId) return fail(400, "request", "video_project_id is required.");

    const project = await sb.from("video_projects")
      .select("id, client_id, title, current_deliverable_id, client_production_brief_id, organic_master_id, ads_master_id")
      .eq("id", videoProjectId).eq("client_id", clientId).maybeSingle();
    if (project.error) return fail(500, "project", project.error.message);
    if (!project.data) return fail(404, "project", "Video project not found for this client.");
    if (!project.data.current_deliverable_id) {
      return fail(409, "gate", "This project has no final Reel. Upload the finished edit before creating a distribution draft.", "BLOCKED_NO_FINAL_REEL");
    }

    const loaded = await sb.from("video_project_deliverables").select("*")
      .eq("id", project.data.current_deliverable_id).maybeSingle();
    if (loaded.error) return fail(500, "deliverable", loaded.error.message);
    if (!loaded.data) return fail(409, "gate", "The project's current final Reel no longer exists.", "BLOCKED_NO_FINAL_REEL");
    const deliverable = loaded.data as FinalReelDeliverable;

    // The brief carries the source_ref and execution_month the whole pipeline is
    // keyed on; a draft cannot be created without it.
    if (!deliverable.client_production_brief_id) {
      return fail(409, "gate", "The final Reel is not linked to a production brief, so it cannot enter the distribution pipeline.", "BLOCKED_PROJECT_RELATIONSHIP");
    }
    const brief = await sb.from("client_production_briefs")
      .select("id, client_id, source_ref, execution_month, title, asset_format, status")
      .eq("id", deliverable.client_production_brief_id).maybeSingle();
    if (brief.error) return fail(500, "brief", brief.error.message);
    if (!brief.data) return fail(409, "gate", "The linked production brief no longer exists.", "BLOCKED_PROJECT_RELATIONSHIP");
    if (brief.data.client_id !== clientId || brief.data.asset_format !== "reel_video") {
      return fail(409, "gate", "The linked production brief is not a reel_video brief for this client.", "BLOCKED_PROJECT_RELATIONSHIP");
    }
    if (!MONTH_RE.test(brief.data.execution_month ?? "")) {
      return fail(409, "gate", "The linked production brief has no valid execution month.", "BLOCKED_PROJECT_RELATIONSHIP");
    }

    // Confirm the media object is really there before promising a publication.
    const lastSlash = deliverable.storage_path.lastIndexOf("/");
    const listed = await sb.storage.from(FINAL_REEL_BUCKET)
      .list(deliverable.storage_path.slice(0, lastSlash), { search: deliverable.storage_path.slice(lastSlash + 1), limit: 100 });
    const storageObjectPresent = !listed.error && (listed.data ?? []).some((entry) => entry.name === deliverable.storage_path.slice(lastSlash + 1));

    // A configured Instagram account is a prerequisite the operator can fix, so it
    // is reported specifically rather than as a generic failure.
    const accounts = await sb.from("client_distribution_accounts")
      .select("id, external_account_id, handle, is_active")
      .eq("client_id", clientId).eq("platform", "instagram").eq("is_active", true);
    const destinationConfigured = !accounts.error && (accounts.data ?? []).length > 0;

    const eligibility = resolveReelPublicationEligibility({
      deliverable, project: { id: project.data.id, client_id: project.data.client_id },
      recordClientId: clientId, storageObjectPresent, destinationConfigured,
    });
    if (!eligibility.supported) return fail(409, "gate", eligibility.reason, eligibility.code);

    const caption = typeof body.caption === "string" ? body.caption.slice(0, 2200) : "";
    const plannedDate = typeof body.planned_publish_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.planned_publish_date)
      ? body.planned_publish_date : null;

    const created = await sb.rpc("create_reel_distribution_draft", {
      p_client_id: clientId,
      p_video_project_id: videoProjectId,
      p_deliverable_id: deliverable.id,
      p_execution_month: brief.data.execution_month,
      p_source_ref: brief.data.source_ref,
      p_title: project.data.title ?? brief.data.title,
      p_planned_date: plannedDate,
      p_publish_payload: {
        caption,
        hashtags: [],
        media: [{
          storage_bucket: deliverable.storage_bucket,
          storage_path: deliverable.storage_path,
          sequence_index: 1,
          mime_type: deliverable.mime_type,
          width: deliverable.width,
          height: deliverable.height,
        }],
        source_ref: brief.data.source_ref,
        asset_format: "reel_video",
        video_deliverable_id: deliverable.id,
        final_reel_version: deliverable.version,
      },
      p_publish_settings: {
        platform: "instagram",
        destination: null,
        content_type: "REELS",
        aspect_ratio: "9:16",
        proof_restrictions: null,
        share_to_feed: body.share_to_feed !== false,
        safety_checklist: [
          "Final Reel reviewed and approved as the deliverable, not as shot clips",
          "Caption reviewed for accuracy and approved claims only",
          "No unapproved testimonials, metrics, or guarantees",
          "Destination account is the correct client profile",
        ],
        meta: {},
      },
    });
    if (created.error || !created.data) {
      const message = created.error?.message ?? "Could not create the Reel distribution draft.";
      return fail(/REEL_/.test(message) ? 409 : 500, "create", message, message.match(/^(REEL_[A-Z_]+):/)?.[1]);
    }

    return json({
      ok: true,
      record: created.data,
      deliverable_version: deliverable.version,
      destination_configured: destinationConfigured,
      message: "Distribution draft created from the approved final Reel. Nothing has been scheduled or published yet.",
    });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
