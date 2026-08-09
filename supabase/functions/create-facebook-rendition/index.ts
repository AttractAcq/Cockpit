// Programme Stage 1B-C — create a new Facebook Rendition for a canonical
// Content Item. Never mutates the canonical Brief. A new version
// automatically supersedes the previous active (non-superseded) Rendition
// for the same platform, exactly mirroring generate-content-brief's own
// versioning discipline for content_briefs.
import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { validateFacebookRenditionFormat } from "../_shared/facebook-rendition-contract.ts";

const VALID_FORMATS = ["IMAGE", "CAROUSEL", "STORIES", "REELS", "VIDEO", "TEXT_LINK"];
const VALID_PLATFORMS = ["instagram", "facebook"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string; content_item_id?: string; platform?: string; format?: string;
    copy?: string; cta?: string; media?: unknown; scheduling_guidance?: unknown;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const contentItemId = (body.content_item_id ?? "").trim();
  const platform = (body.platform ?? "facebook").trim();
  const format = (body.format ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!contentItemId) return json({ code: "CONTENT_ITEM_ID_REQUIRED" }, 400);
  if (!VALID_PLATFORMS.includes(platform)) return json({ code: "INVALID_PLATFORM", message: `platform must be one of: ${VALID_PLATFORMS.join(", ")}` }, 400);
  if (!VALID_FORMATS.includes(format)) return json({ code: "INVALID_FORMAT", message: `format must be one of: ${VALID_FORMATS.join(", ")}` }, 400);

  const media = Array.isArray(body.media) ? body.media.filter((x): x is string => typeof x === "string") : [];
  const schedulingGuidance = (body.scheduling_guidance && typeof body.scheduling_guidance === "object") ? body.scheduling_guidance as Record<string, unknown> : {};

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: item, error: itemError } = await sb
    .from("content_items")
    .select("id, client_id")
    .eq("id", contentItemId).eq("client_id", clientId).maybeSingle();
  if (itemError) return json({ code: "LOOKUP_FAILED", message: itemError.message }, 500);
  if (!item) return json({ code: "CONTENT_ITEM_NOT_FOUND", message: "No Content Item with that id exists for this client." }, 404);

  // Ownership: every referenced asset must genuinely belong to this Content Item.
  if (media.length > 0) {
    const { data: ownedAssets, error: assetError } = await sb
      .from("content_item_assets")
      .select("id")
      .eq("content_item_id", contentItemId)
      .in("id", media);
    if (assetError) return json({ code: "ASSET_LOOKUP_FAILED", message: assetError.message }, 500);
    const ownedIds = new Set((ownedAssets ?? []).map((a) => a.id));
    const unowned = media.filter((id) => !ownedIds.has(id));
    if (unowned.length > 0) {
      return json({ code: "ASSET_NOT_OWNED", message: `These media ids do not belong to this Content Item: ${unowned.join(", ")}` }, 403);
    }
  }

  const capability = validateFacebookRenditionFormat(format as never);

  const { data: existing } = await sb
    .from("content_item_renditions")
    .select("id, rendition_version, status")
    .eq("content_item_id", contentItemId).eq("platform", platform)
    .neq("status", "superseded");

  const previousActive = (existing ?? [])[0] ?? null;
  const nextVersion = (previousActive?.rendition_version ?? 0) + 1;

  if (previousActive) {
    // content_item_renditions_approval_check is biconditional: status='approved'
    // iff approved_by/approved_at are set. Superseding a rendition that was
    // approved must clear both, or this update violates that constraint and
    // fails silently if its error isn't checked -- confirmed live this stage
    // (the same latent pattern exists, unexercised, in generate-content-brief's
    // own supersede-previous-approved step for content_briefs).
    const { error: supersedeError } = await sb
      .from("content_item_renditions")
      .update({ status: "superseded", approved_by: null, approved_at: null })
      .eq("id", previousActive.id);
    if (supersedeError) return json({ code: "SUPERSEDE_FAILED", message: supersedeError.message }, 500);
  }

  const { data: rendition, error: insertError } = await sb
    .from("content_item_renditions")
    .insert({
      client_id: clientId, content_item_id: contentItemId, platform, rendition_version: nextVersion,
      status: "draft", format, copy: (body.copy ?? "").trim(), cta: (body.cta ?? "").trim(),
      media, scheduling_guidance: schedulingGuidance,
      capability_snapshot: capability, created_by: access.userId,
    })
    .select("*")
    .single();
  if (insertError) return json({ code: "INSERT_FAILED", message: insertError.message }, 500);

  await audit(sb, "content_item_rendition.created", "content_item_renditions", rendition.id, {
    client_id: clientId, content_item_id: contentItemId, platform, format, rendition_version: nextVersion,
    superseded_id: previousActive?.id ?? null,
  });

  return json({ ok: true, rendition, capability }, 201);
});
