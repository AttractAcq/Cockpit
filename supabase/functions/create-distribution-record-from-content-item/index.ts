// Programme Stage K — the canonical distribution-record creation path: an
// approved Content Item + its approved deliverable (a Stage I
// content_item_asset for image-family formats, or a Reel Studio
// video_project_deliverable for reel_video/story_video) becomes exactly one
// client_distribution_records row, carrying full canonical provenance
// (content_item_id, content_brief_id, content_item_asset_id,
// caption_version).
//
// Deliberately does not touch the legacy asset_group_ref/production_brief_id
// creation path (client_production_briefs -> client_assets -> distribution)
// -- that remains exactly as-is for the live legacy pipeline. This is a new
// path alongside it, per the same "preserve working systems" principle
// every prior stage has followed.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { resolvePublishCapability } from "../_shared/publish-capability.ts";
import {
  DEFAULT_DISTRIBUTION_POLICY,
  checkScheduleAllowed,
  checkApprovalModeGate,
  validateBlackoutPeriods,
  validateRestrictedWeekdays,
  type ClientDistributionPolicy,
} from "../_shared/distribution-policy.ts";

const IMAGE_FAMILY_FORMATS = new Set(["feed_post", "carousel", "story_sequence", "ad_static"]);
const VIDEO_FAMILY_FORMATS = new Set(["reel_video", "story_video"]);

const CONTENT_TYPE_FOR_FORMAT: Record<string, string> = {
  feed_post: "IMAGE",
  ad_static: "IMAGE",
  carousel: "CAROUSEL",
  story_sequence: "STORIES",
  story_video: "STORIES",
  reel_video: "REELS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string;
    content_item_id?: string;
    asset_format?: string;
    content_item_asset_id?: string;
    video_project_deliverable_id?: string;
    platform?: string;
    destination?: string;
    caption?: string;
    hashtags?: string[];
    cta?: string;
    tracking_url?: string;
    campaign_reference?: string;
    scheduled_publish_at?: string;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const contentItemId = (body.content_item_id ?? "").trim();
  const assetFormat = (body.asset_format ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!contentItemId) return json({ code: "CONTENT_ITEM_ID_REQUIRED" }, 400);
  if (!IMAGE_FAMILY_FORMATS.has(assetFormat) && !VIDEO_FAMILY_FORMATS.has(assetFormat)) {
    return json({ code: "INVALID_ASSET_FORMAT", message: `asset_format must be one of: ${[...IMAGE_FAMILY_FORMATS, ...VIDEO_FAMILY_FORMATS].join(", ")}` }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  // Idempotent: one canonical distribution record per Content Item.
  const existing = await sb.from("client_distribution_records").select("*").eq("content_item_id", contentItemId).maybeSingle();
  if (existing.error) return json({ code: "LOOKUP_FAILED", message: existing.error.message }, 500);
  if (existing.data) return json({ ok: true, idempotent_replay: true, record: existing.data }, 200);

  const item = await sb.from("content_items")
    .select("id, client_id, title, current_content_brief_id, distribution_record_id")
    .eq("id", contentItemId).eq("client_id", clientId).maybeSingle();
  if (item.error) return json({ code: "LOOKUP_FAILED", message: item.error.message }, 500);
  if (!item.data) return json({ code: "CONTENT_ITEM_NOT_FOUND" }, 404);
  if (!item.data.current_content_brief_id) return json({ code: "NO_CONTENT_BRIEF" }, 409);

  const brief = await sb.from("content_briefs").select("id, status, brief_version").eq("id", item.data.current_content_brief_id).maybeSingle();
  if (brief.error) return json({ code: "LOOKUP_FAILED", message: brief.error.message }, 500);
  if (!brief.data || brief.data.status !== "approved") {
    return json({ code: "CONTENT_BRIEF_NOT_APPROVED", message: `Content Brief status is "${brief.data?.status ?? "missing"}", not "approved".` }, 409);
  }

  interface MediaItem { storage_bucket: string; storage_path: string; mime_type: string | null; width?: number | null; height?: number | null }
  let media: MediaItem[] = [];
  let contentItemAssetId: string | null = null;
  let videoDeliverableId: string | null = null;

  if (IMAGE_FAMILY_FORMATS.has(assetFormat)) {
    const assetId = (body.content_item_asset_id ?? "").trim();
    if (!assetId) return json({ code: "CONTENT_ITEM_ASSET_ID_REQUIRED" }, 400);
    const asset = await sb.from("content_item_assets")
      .select("id, client_id, content_item_id, kind, is_current, storage_bucket, storage_path, mime_type, width, height")
      .eq("id", assetId).maybeSingle();
    if (asset.error) return json({ code: "LOOKUP_FAILED", message: asset.error.message }, 500);
    if (!asset.data || asset.data.client_id !== clientId || asset.data.content_item_id !== contentItemId) {
      return json({ code: "CROSS_CLIENT_OR_ITEM_ASSET" }, 403);
    }
    if (asset.data.kind !== "deliverable" || !asset.data.is_current) {
      return json({ code: "ASSET_NOT_APPROVED_DELIVERABLE", message: "content_item_asset must be the current deliverable-kind asset." }, 409);
    }
    if (!asset.data.storage_bucket || !asset.data.storage_path) {
      return json({ code: "ASSET_MISSING_STORAGE_OBJECT" }, 409);
    }
    contentItemAssetId = asset.data.id;
    media = [{ storage_bucket: asset.data.storage_bucket, storage_path: asset.data.storage_path, mime_type: asset.data.mime_type, width: asset.data.width, height: asset.data.height }];
  } else {
    const deliverableId = (body.video_project_deliverable_id ?? "").trim();
    if (!deliverableId) return json({ code: "VIDEO_PROJECT_DELIVERABLE_ID_REQUIRED" }, 400);
    const deliverable = await sb.from("video_project_deliverables")
      .select("id, client_id, status, is_current, superseded_at, storage_bucket, storage_path, mime_type")
      .eq("id", deliverableId).maybeSingle();
    if (deliverable.error) return json({ code: "LOOKUP_FAILED", message: deliverable.error.message }, 500);
    if (!deliverable.data || deliverable.data.client_id !== clientId) return json({ code: "CROSS_CLIENT_DELIVERABLE" }, 403);
    if (deliverable.data.status !== "approved" || !deliverable.data.is_current || deliverable.data.superseded_at !== null) {
      return json({ code: "DELIVERABLE_NOT_APPROVED", message: "video_project_deliverable must be the current, approved final Reel/Story video." }, 409);
    }
    videoDeliverableId = deliverable.data.id;
    media = [{ storage_bucket: deliverable.data.storage_bucket, storage_path: deliverable.data.storage_path, mime_type: deliverable.data.mime_type }];
  }

  const capability = resolvePublishCapability({
    platform: body.platform ?? "instagram",
    assetFormat,
    contentType: CONTENT_TYPE_FOR_FORMAT[assetFormat],
    mediaMimeTypes: media.map((m) => m.mime_type),
    reelContext: VIDEO_FAMILY_FORMATS.has(assetFormat)
      ? { deliverable: null, project: null, recordClientId: clientId } // final eligibility is re-proven at publish time; creation only checks format/media shape here
      : undefined,
  });
  // Format/media-shape failures are real gate failures; Reel/Story-video
  // eligibility itself is re-proven with full context by the publish worker
  // (matches the existing "re-prove eligibility every step" convention).
  if (!capability.supported && capability.code !== "blocked_no_final_reel") {
    return json({ code: capability.code.toUpperCase(), message: capability.reason }, 422);
  }

  let policy: ClientDistributionPolicy = DEFAULT_DISTRIBUTION_POLICY;
  const policyRow = await sb.from("client_distribution_policies").select("*").eq("client_id", clientId).maybeSingle();
  if (policyRow.data) {
    const blackout = validateBlackoutPeriods(policyRow.data.blackout_periods) ?? [];
    const restricted = validateRestrictedWeekdays(policyRow.data.restricted_weekdays) ?? [];
    policy = {
      approvalMode: policyRow.data.approval_mode,
      autoScheduleAfterApproval: policyRow.data.auto_schedule_after_approval,
      manualPublishOnly: policyRow.data.manual_publish_only,
      blackoutPeriods: blackout,
      restrictedWeekdays: restricted,
    };
  }

  const scheduledPublishAt = (body.scheduled_publish_at ?? "").trim() || null;
  if (scheduledPublishAt) {
    if (policy.manualPublishOnly) {
      return json({ code: "MANUAL_PUBLISH_ONLY", message: "This client's policy requires manual publish; records cannot be pre-scheduled." }, 409);
    }
    const scheduleCheck = checkScheduleAllowed(policy, scheduledPublishAt);
    if (!scheduleCheck.allowed) return json({ code: "BLACKOUT_OR_RESTRICTED", message: scheduleCheck.reason }, 409);
    const approvalCheck = checkApprovalModeGate(policy, { clientApprovedAt: null });
    if (!approvalCheck.allowed) return json({ code: "CLIENT_APPROVAL_REQUIRED", message: approvalCheck.reason }, 409);
  }

  const executionMonth = (scheduledPublishAt ?? new Date().toISOString()).slice(0, 7);
  const ref = `content_item:${contentItemId}`;

  const insertRow: Record<string, unknown> = {
    client_id: clientId,
    execution_month: executionMonth,
    source_ref: ref,
    asset_group_ref: ref,
    sequence_index: 1,
    asset_format: assetFormat,
    title: item.data.title,
    publish_status: scheduledPublishAt ? "scheduled" : "ready",
    publish_mode: scheduledPublishAt ? "scheduled" : null,
    scheduled_publish_at: scheduledPublishAt,
    platform: body.platform ?? "instagram",
    destination: body.destination ?? null,
    publish_payload: {
      caption: body.caption ?? "",
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
      cta: body.cta ?? null,
      tracking_url: body.tracking_url ?? null,
      media,
      content_type: CONTENT_TYPE_FOR_FORMAT[assetFormat],
    },
    content_item_id: contentItemId,
    content_item_asset_id: contentItemAssetId,
    content_brief_id: brief.data.id,
    caption_version: brief.data.brief_version,
    campaign_reference: body.campaign_reference ?? null,
    video_deliverable_id: videoDeliverableId,
  };

  const inserted = await sb.from("client_distribution_records").insert(insertRow).select("*").single();
  if (inserted.error) return json({ code: "INSERT_FAILED", message: inserted.error.message }, 500);

  if (!item.data.distribution_record_id) {
    await sb.from("content_items").update({ distribution_record_id: inserted.data.id }).eq("id", contentItemId).is("distribution_record_id", null);
  }

  await audit(sb, "distribution_record.created_from_content_item", "client_distribution_records", inserted.data.id, {
    client_id: clientId, content_item_id: contentItemId, asset_format: assetFormat,
  });

  return json({ ok: true, idempotent_replay: false, record: inserted.data }, 201);
});
