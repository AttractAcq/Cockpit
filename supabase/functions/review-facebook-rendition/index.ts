// Programme Stage 1B-C — human review actions on a Facebook Rendition:
// submit for review, approve, request changes. Mirrors review-content-brief
// exactly in shape (same three action names, same state machine) but
// operates entirely on this one rendition row — approving a Facebook
// Rendition never touches the canonical Brief or an Instagram rendition of
// the same Content Item.
import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { checkRenditionReadyForReview, resolveRenditionTransition, type RenditionReviewAction, type RenditionStatus } from "../_shared/facebook-rendition-contract.ts";

const VALID_ACTIONS: readonly RenditionReviewAction[] = ["submit_for_review", "approve", "request_changes"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; rendition_id?: string; action?: string; change_request_notes?: string };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const renditionId = (body.rendition_id ?? "").trim();
  const action = (body.action ?? "").trim() as RenditionReviewAction;
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!renditionId) return json({ code: "RENDITION_ID_REQUIRED" }, 400);
  if (!VALID_ACTIONS.includes(action)) return json({ code: "INVALID_ACTION", message: `action must be one of: ${VALID_ACTIONS.join(", ")}` }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: rendition, error: loadError } = await sb
    .from("content_item_renditions")
    .select("id, client_id, content_item_id, status, format, copy, cta, media")
    .eq("id", renditionId).eq("client_id", clientId).maybeSingle();
  if (loadError) return json({ code: "LOOKUP_FAILED", message: loadError.message }, 500);
  if (!rendition) return json({ code: "RENDITION_NOT_FOUND", message: "No Rendition with that id exists for this client." }, 404);

  const readiness = checkRenditionReadyForReview({
    copy: rendition.copy, cta: rendition.cta, mediaCount: Array.isArray(rendition.media) ? rendition.media.length : 0,
    format: rendition.format,
  });
  const transition = resolveRenditionTransition(rendition.status as RenditionStatus, action, readiness);
  if (!transition.allowed) return json({ code: "TRANSITION_REFUSED", message: transition.reason }, 409);

  const update: Record<string, unknown> = { status: transition.nextStatus };
  if (transition.nextStatus === "approved") {
    update.approved_by = access.userId;
    update.approved_at = new Date().toISOString();
  }
  if (action === "request_changes") {
    update.change_request_notes = (body.change_request_notes ?? "").trim() || null;
    update.approved_by = null;
    update.approved_at = null;
  }

  const { data: updated, error: updateError } = await sb
    .from("content_item_renditions").update(update).eq("id", renditionId).select("*").single();
  if (updateError) return json({ code: "UPDATE_FAILED", message: updateError.message }, 500);

  await audit(sb, `content_item_rendition.${action}`, "content_item_renditions", renditionId, {
    client_id: clientId, content_item_id: rendition.content_item_id, from: rendition.status, to: transition.nextStatus,
  });

  return json({ ok: true, rendition: updated }, 200);
});
