// Programme Stage 1B-D — the Facebook counterpart to Stage K's
// create-distribution-record-from-content-item: an approved Facebook
// Rendition + a connected Facebook Page destination becomes exactly one
// client_distribution_records row.
//
// Deliberately does NOT reuse that function's exact idempotency key
// (content_item_id alone) — one Content Item can legitimately carry both an
// Instagram AND a Facebook distribution record simultaneously (that is the
// entire point of Renditions), so idempotency here is keyed on the
// Rendition itself via the new content_item_rendition_id column and its
// partial unique index (Stage 1B-D migration).
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string; rendition_id?: string; destination_account_id?: string;
    tracking_url?: string; campaign_reference?: string; scheduled_publish_at?: string;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const renditionId = (body.rendition_id ?? "").trim();
  const destinationAccountId = (body.destination_account_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!renditionId) return json({ code: "RENDITION_ID_REQUIRED" }, 400);
  if (!destinationAccountId) return json({ code: "DESTINATION_ACCOUNT_ID_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  // Idempotent: one active distribution record per Rendition.
  const existing = await sb.from("client_distribution_records").select("*")
    .eq("content_item_rendition_id", renditionId).neq("publish_status", "cancelled").maybeSingle();
  if (existing.error) return json({ code: "LOOKUP_FAILED", message: existing.error.message }, 500);
  if (existing.data) return json({ ok: true, idempotent_replay: true, record: existing.data }, 200);

  const rendition = await sb.from("content_item_renditions")
    .select("id, client_id, content_item_id, platform, status, format, copy, cta, media")
    .eq("id", renditionId).eq("client_id", clientId).maybeSingle();
  if (rendition.error) return json({ code: "LOOKUP_FAILED", message: rendition.error.message }, 500);
  if (!rendition.data) return json({ code: "RENDITION_NOT_FOUND" }, 404);
  if (rendition.data.platform !== "facebook") return json({ code: "NOT_A_FACEBOOK_RENDITION" }, 400);
  if (rendition.data.status !== "approved") {
    return json({ code: "RENDITION_NOT_APPROVED", message: `Rendition status is "${rendition.data.status}", not "approved".` }, 409);
  }

  const destination = await sb.from("client_distribution_accounts")
    .select("id, client_id, platform, external_account_id, connection_status, is_active")
    .eq("id", destinationAccountId).eq("client_id", clientId).maybeSingle();
  if (destination.error) return json({ code: "LOOKUP_FAILED", message: destination.error.message }, 500);
  if (!destination.data) return json({ code: "DESTINATION_NOT_FOUND" }, 404);
  if (destination.data.platform !== "facebook") return json({ code: "NOT_A_FACEBOOK_DESTINATION" }, 400);
  if (!destination.data.is_active || destination.data.connection_status !== "connected") {
    return json({ code: "DESTINATION_NOT_CONNECTED", message: `This Facebook Page's connection status is "${destination.data.connection_status}". Reconnect it in Client Settings before scheduling.` }, 409);
  }

  const item = await sb.from("content_items").select("id, title").eq("id", rendition.data.content_item_id).maybeSingle();
  if (item.error) return json({ code: "LOOKUP_FAILED", message: item.error.message }, 500);
  if (!item.data) return json({ code: "CONTENT_ITEM_NOT_FOUND" }, 404);

  // Resolve real, current media asset rows (never trust stale rendition-stored metadata).
  interface MediaItem { storage_bucket: string; storage_path: string; mime_type: string | null }
  let media: MediaItem[] = [];
  const mediaIds: string[] = Array.isArray(rendition.data.media) ? rendition.data.media : [];
  if (mediaIds.length > 0) {
    const assets = await sb.from("content_item_assets")
      .select("id, storage_bucket, storage_path, mime_type").in("id", mediaIds);
    if (assets.error) return json({ code: "LOOKUP_FAILED", message: assets.error.message }, 500);
    media = (assets.data ?? []).map((a) => ({ storage_bucket: a.storage_bucket, storage_path: a.storage_path, mime_type: a.mime_type }));
  }

  const capability = resolvePublishCapability({
    platform: "facebook", assetFormat: rendition.data.format, contentType: rendition.data.format,
    mediaMimeTypes: media.map((m) => m.mime_type),
  });
  if (!capability.supported) return json({ code: capability.code.toUpperCase(), message: capability.reason }, 422);

  let policy: ClientDistributionPolicy = DEFAULT_DISTRIBUTION_POLICY;
  const policyRow = await sb.from("client_distribution_policies").select("*").eq("client_id", clientId).maybeSingle();
  if (policyRow.data) {
    policy = {
      approvalMode: policyRow.data.approval_mode,
      autoScheduleAfterApproval: policyRow.data.auto_schedule_after_approval,
      manualPublishOnly: policyRow.data.manual_publish_only,
      blackoutPeriods: validateBlackoutPeriods(policyRow.data.blackout_periods) ?? [],
      restrictedWeekdays: validateRestrictedWeekdays(policyRow.data.restricted_weekdays) ?? [],
    };
  }

  const scheduledPublishAt = (body.scheduled_publish_at ?? "").trim() || null;
  if (scheduledPublishAt) {
    if (policy.manualPublishOnly) return json({ code: "MANUAL_PUBLISH_ONLY" }, 409);
    const scheduleCheck = checkScheduleAllowed(policy, scheduledPublishAt);
    if (!scheduleCheck.allowed) return json({ code: "BLACKOUT_OR_RESTRICTED", message: scheduleCheck.reason }, 409);
    const approvalCheck = checkApprovalModeGate(policy, { clientApprovedAt: null });
    if (!approvalCheck.allowed) return json({ code: "CLIENT_APPROVAL_REQUIRED", message: approvalCheck.reason }, 409);
  }

  const executionMonth = (scheduledPublishAt ?? new Date().toISOString()).slice(0, 7);
  const ref = `content_item_rendition:${renditionId}`;

  const insertRow = {
    client_id: clientId,
    execution_month: executionMonth,
    source_ref: ref,
    asset_group_ref: ref,
    sequence_index: 1,
    asset_format: rendition.data.format,
    title: item.data.title,
    publish_status: scheduledPublishAt ? "scheduled" : "ready",
    publish_mode: scheduledPublishAt ? "scheduled" : null,
    scheduled_publish_at: scheduledPublishAt,
    platform: "facebook",
    destination: destination.data.external_account_id,
    publish_payload: {
      caption: rendition.data.copy, cta: rendition.data.cta,
      link: rendition.data.format === "TEXT_LINK" ? (body.tracking_url ?? null) : null,
      media, content_type: rendition.data.format,
    },
    publish_settings: { platform: "facebook", content_type: rendition.data.format },
    content_item_id: rendition.data.content_item_id,
    content_item_rendition_id: renditionId,
    campaign_reference: body.campaign_reference ?? null,
  };

  const inserted = await sb.from("client_distribution_records").insert(insertRow).select("*").single();
  if (inserted.error) return json({ code: "INSERT_FAILED", message: inserted.error.message }, 500);

  await audit(sb, "distribution_record.created_from_facebook_rendition", "client_distribution_records", inserted.data.id, {
    client_id: clientId, rendition_id: renditionId, content_item_id: rendition.data.content_item_id, format: rendition.data.format,
  });

  return json({ ok: true, idempotent_replay: false, record: inserted.data }, 201);
});
