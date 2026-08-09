// Programme Stage 1B-C — edit a Rendition's own creative fields. Only ever
// touches this one rendition row: never the canonical Brief, never another
// platform's Rendition. Only permitted while status is 'draft' — matching
// content_briefs' own "only draft is freely editable" convention. Format is
// immutable after creation (a different format is a different creative
// treatment and deserves its own version via create-facebook-rendition).
import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { isRenditionEditable, validateFacebookRenditionFormat } from "../_shared/facebook-rendition-contract.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; rendition_id?: string; copy?: string; cta?: string; media?: unknown; scheduling_guidance?: unknown };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const renditionId = (body.rendition_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!renditionId) return json({ code: "RENDITION_ID_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: rendition, error: loadError } = await sb
    .from("content_item_renditions")
    .select("id, client_id, content_item_id, status, format")
    .eq("id", renditionId).eq("client_id", clientId).maybeSingle();
  if (loadError) return json({ code: "LOOKUP_FAILED", message: loadError.message }, 500);
  if (!rendition) return json({ code: "RENDITION_NOT_FOUND", message: "No Rendition with that id exists for this client." }, 404);
  if (!isRenditionEditable(rendition.status)) {
    return json({ code: "NOT_EDITABLE", message: `A rendition in status "${rendition.status}" cannot be edited. Request changes to return it to draft, or create a new version.` }, 409);
  }

  const update: Record<string, unknown> = {};
  if (typeof body.copy === "string") update.copy = body.copy.trim();
  if (typeof body.cta === "string") update.cta = body.cta.trim();
  if (Array.isArray(body.media)) {
    const media = body.media.filter((x): x is string => typeof x === "string");
    const { data: ownedAssets, error: assetError } = await sb
      .from("content_item_assets").select("id").eq("content_item_id", rendition.content_item_id).in("id", media);
    if (assetError) return json({ code: "ASSET_LOOKUP_FAILED", message: assetError.message }, 500);
    const ownedIds = new Set((ownedAssets ?? []).map((a) => a.id));
    const unowned = media.filter((id) => !ownedIds.has(id));
    if (unowned.length > 0) return json({ code: "ASSET_NOT_OWNED", message: `These media ids do not belong to this Content Item: ${unowned.join(", ")}` }, 403);
    update.media = media;
  }
  if (body.scheduling_guidance && typeof body.scheduling_guidance === "object") update.scheduling_guidance = body.scheduling_guidance;

  if (Object.keys(update).length === 0) return json({ code: "NO_FIELDS_TO_UPDATE" }, 400);

  // Re-validate capability on every edit — format itself never changes here,
  // but keeping the snapshot fresh means the operator always sees a
  // just-computed reason, not a stale one from creation time.
  update.capability_snapshot = validateFacebookRenditionFormat(rendition.format as never);

  const { data: updated, error: updateError } = await sb
    .from("content_item_renditions").update(update).eq("id", renditionId).select("*").single();
  if (updateError) return json({ code: "UPDATE_FAILED", message: updateError.message }, 500);

  await audit(sb, "content_item_rendition.updated", "content_item_renditions", renditionId, {
    client_id: clientId, content_item_id: rendition.content_item_id, fields: Object.keys(update),
  });

  return json({ ok: true, rendition: updated }, 200);
});
