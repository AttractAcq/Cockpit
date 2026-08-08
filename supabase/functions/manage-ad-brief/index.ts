// Programme Stage L — the Ad Brief contract: create (operator-authored,
// structured) and review (submit_for_review / approve / request_changes).
// Approval enforces the same proof-required gate content-brief.ts already
// established for organic Briefs (Stage H) — a claim self-flagged as
// requiring proof cannot approve without a real, verified, client-owned
// Proof item linked at approval time.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { validateAdBriefBody, renderAdBriefMarkdown, checkAdClaimGate } from "../_shared/ad-studio.ts";

type Action = "create" | "submit_for_review" | "approve" | "request_changes";
const ACTIONS: readonly Action[] = ["create", "submit_for_review", "approve", "request_changes"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string; action?: string;
    ad_opportunity_id?: string; ad_brief_id?: string;
    brief_body?: unknown; proof_item_id?: string; feedback?: string;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const action = (body.action ?? "").trim() as Action;
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!ACTIONS.includes(action)) return json({ code: "INVALID_ACTION", message: `action must be one of: ${ACTIONS.join(", ")}` }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  if (action === "create") {
    const opportunityId = (body.ad_opportunity_id ?? "").trim();
    if (!opportunityId) return json({ code: "AD_OPPORTUNITY_ID_REQUIRED" }, 400);
    const opportunity = await sb.from("ad_opportunities").select("id, client_id, status").eq("id", opportunityId).maybeSingle();
    if (opportunity.error) return json({ code: "LOOKUP_FAILED", message: opportunity.error.message }, 500);
    if (!opportunity.data || opportunity.data.client_id !== clientId) return json({ code: "CROSS_CLIENT_OPPORTUNITY" }, 403);
    if (opportunity.data.status === "rejected" || opportunity.data.status === "expired") {
      return json({ code: "OPPORTUNITY_NOT_ACTIONABLE", message: `Ad Opportunity status is "${opportunity.data.status}".` }, 409);
    }

    const validated = validateAdBriefBody(body.brief_body);
    if (!validated) return json({ code: "INVALID_BRIEF_BODY" }, 422);

    const existing = await sb.from("ad_briefs").select("brief_version").eq("ad_opportunity_id", opportunityId).order("brief_version", { ascending: false }).limit(1);
    if (existing.error) return json({ code: "LOOKUP_FAILED", message: existing.error.message }, 500);
    const nextVersion = (existing.data?.[0]?.brief_version ?? 0) + 1;

    // Supersede any prior approved version — never two "current" approved Briefs.
    if (nextVersion > 1) {
      await sb.from("ad_briefs").update({ status: "superseded" }).eq("ad_opportunity_id", opportunityId).eq("status", "approved");
    }

    const inserted = await sb.from("ad_briefs").insert({
      client_id: clientId, ad_opportunity_id: opportunityId, brief_version: nextVersion,
      status: "draft", body: validated, rendered_markdown: renderAdBriefMarkdown(validated),
      created_by: access.userId,
    }).select("*").single();
    if (inserted.error) return json({ code: "INSERT_FAILED", message: inserted.error.message }, 500);

    await audit(sb, "ad_brief.created", "ad_briefs", inserted.data.id, { client_id: clientId, ad_opportunity_id: opportunityId });
    return json({ ok: true, brief: inserted.data }, 201);
  }

  const briefId = (body.ad_brief_id ?? "").trim();
  if (!briefId) return json({ code: "AD_BRIEF_ID_REQUIRED" }, 400);
  const brief = await sb.from("ad_briefs").select("*").eq("id", briefId).maybeSingle();
  if (brief.error) return json({ code: "LOOKUP_FAILED", message: brief.error.message }, 500);
  if (!brief.data || brief.data.client_id !== clientId) return json({ code: "CROSS_CLIENT_BRIEF" }, 403);

  if (action === "submit_for_review") {
    if (brief.data.status !== "draft") return json({ code: "INVALID_TRANSITION", message: `Cannot submit for review from status "${brief.data.status}".` }, 409);
    const updated = await sb.from("ad_briefs").update({ status: "in_review" }).eq("id", briefId).select("*").single();
    if (updated.error) return json({ code: "UPDATE_FAILED", message: updated.error.message }, 500);
    return json({ ok: true, brief: updated.data });
  }

  if (action === "request_changes") {
    if (brief.data.status !== "in_review") return json({ code: "INVALID_TRANSITION", message: `Cannot request changes from status "${brief.data.status}".` }, 409);
    const feedback = (body.feedback ?? "").trim();
    if (feedback.length < 8) return json({ code: "FEEDBACK_REQUIRED", message: "Explain what needs to change (at least 8 characters)." }, 422);
    const updated = await sb.from("ad_briefs").update({ status: "draft" }).eq("id", briefId).select("*").single();
    if (updated.error) return json({ code: "UPDATE_FAILED", message: updated.error.message }, 500);
    await audit(sb, "ad_brief.changes_requested", "ad_briefs", briefId, { client_id: clientId, feedback });
    return json({ ok: true, brief: updated.data });
  }

  // approve
  if (brief.data.status !== "in_review") return json({ code: "INVALID_TRANSITION", message: `Cannot approve from status "${brief.data.status}".` }, 409);
  const validated = validateAdBriefBody(brief.data.body);
  if (!validated) return json({ code: "CORRUPT_BRIEF_BODY" }, 500);

  let verifiedCount = 0;
  const proofItemId = (body.proof_item_id ?? "").trim();
  if (proofItemId) {
    const proof = await sb.from("proof_items").select("id, client_id, verification_status").eq("id", proofItemId).maybeSingle();
    if (proof.error) return json({ code: "LOOKUP_FAILED", message: proof.error.message }, 500);
    if (proof.data && proof.data.client_id === clientId && proof.data.verification_status === "verified") verifiedCount = 1;
  }
  const claimGate = checkAdClaimGate(validated.proof_required, verifiedCount);
  if (!claimGate.passed) return json({ code: "UNSUPPORTED_CLAIM", message: claimGate.reason }, 409);

  const updated = await sb.from("ad_briefs").update({
    status: "approved", approved_by: access.userId, approved_at: new Date().toISOString(),
  }).eq("id", briefId).select("*").single();
  if (updated.error) return json({ code: "UPDATE_FAILED", message: updated.error.message }, 500);

  await sb.from("ad_opportunities").update({ status: "selected" }).eq("id", brief.data.ad_opportunity_id).eq("status", "shortlisted");

  await audit(sb, "ad_brief.approved", "ad_briefs", briefId, { client_id: clientId, proof_item_id: proofItemId || null });
  return json({ ok: true, brief: updated.data });
});
