// Programme Stage H — human review actions on a Content Brief: submit for
// review, approve (gated on mandatory Proof), request changes. Enforces
// Stage B's existing 4-state lifecycle (draft/in_review/approved/superseded)
// — see _shared/content-brief.ts for why Stage H's differently-worded
// lifecycle collapses onto it rather than replacing it.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { checkProofGate, type StructuredContentBrief } from "../_shared/content-brief.ts";

type Action = "submit_for_review" | "approve" | "request_changes";
const VALID_ACTIONS: readonly Action[] = ["submit_for_review", "approve", "request_changes"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; content_brief_id?: string; action?: string };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const briefId = (body.content_brief_id ?? "").trim();
  const action = (body.action ?? "").trim() as Action;
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!briefId) return json({ code: "CONTENT_BRIEF_ID_REQUIRED" }, 400);
  if (!VALID_ACTIONS.includes(action)) {
    return json({ code: "INVALID_ACTION", message: `action must be one of: ${VALID_ACTIONS.join(", ")}` }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: brief, error: briefError } = await sb
    .from("content_briefs")
    .select("id, client_id, content_item_id, status, body")
    .eq("id", briefId)
    .maybeSingle();
  if (briefError) return json({ code: "LOOKUP_FAILED", message: briefError.message }, 500);
  if (!brief) return json({ code: "CONTENT_BRIEF_NOT_FOUND" }, 404);
  if (brief.client_id !== clientId) return json({ code: "CROSS_CLIENT_CONTENT_BRIEF" }, 403);

  if (action === "submit_for_review") {
    if (brief.status !== "draft") return json({ code: "INVALID_TRANSITION", message: `Cannot submit from "${brief.status}".` }, 409);
    const { error } = await sb.from("content_briefs").update({ status: "in_review" }).eq("id", briefId);
    if (error) return json({ code: "UPDATE_FAILED", message: error.message }, 500);
    await audit(sb, "content_brief.submit_for_review", "content_briefs", briefId, { client_id: clientId });
    return json({ ok: true, content_brief_id: briefId, status: "in_review" }, 200);
  }

  if (action === "request_changes") {
    if (brief.status !== "in_review") return json({ code: "INVALID_TRANSITION", message: `Cannot request changes from "${brief.status}".` }, 409);
    const { error } = await sb.from("content_briefs").update({ status: "draft" }).eq("id", briefId);
    if (error) return json({ code: "UPDATE_FAILED", message: error.message }, 500);
    await audit(sb, "content_brief.request_changes", "content_briefs", briefId, { client_id: clientId });
    return json({ ok: true, content_brief_id: briefId, status: "draft" }, 200);
  }

  // action === "approve"
  if (brief.status !== "in_review") return json({ code: "INVALID_TRANSITION", message: `Cannot approve from "${brief.status}".` }, 409);

  const structured = brief.body as StructuredContentBrief;
  const { count: verifiedProofCount, error: proofCountError } = await sb
    .from("content_item_proof")
    .select("proof_item_id, proof_items!inner(verification_status)", { count: "exact", head: true })
    .eq("content_item_id", brief.content_item_id)
    .eq("proof_items.verification_status", "verified");
  if (proofCountError) return json({ code: "LOOKUP_FAILED", message: proofCountError.message }, 500);

  const gate = checkProofGate(structured.proof_required === true, verifiedProofCount ?? 0);
  if (!gate.approvable) {
    return json({ code: gate.reason, message: "This Brief requires verified Proof before it can be approved." }, 409);
  }

  const { error: approveError } = await sb
    .from("content_briefs")
    .update({ status: "approved", approved_by: access.userId, approved_at: new Date().toISOString() })
    .eq("id", briefId);
  if (approveError) return json({ code: "UPDATE_FAILED", message: approveError.message }, 500);

  await audit(sb, "content_brief.approve", "content_briefs", briefId, {
    client_id: clientId, verified_proof_count: verifiedProofCount ?? 0,
  });

  return json({ ok: true, content_brief_id: briefId, status: "approved" }, 200);
});
