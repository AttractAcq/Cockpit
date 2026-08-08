// Programme Stage F — human control actions over a Content Opportunity's
// status. Every transition is validated against the canonical
// CONTENT_OPPORTUNITY_TRANSITIONS table (Stage B, src/types/content-spine.ts)
// — this function never sets a status the table does not allow.
//
// Implements 5 of the 8 named human-control actions from the Stage F scope.
// "Add Proof", "Request another angle" and "Promote for Ads" are deliberately
// deferred — see the Stage F implementation report for precise reasons.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import {
  findTransitionPath,
  CONTENT_OPPORTUNITY_TRANSITIONS,
  type ContentOpportunityStatus,
} from "../_shared/opportunity-intelligence.ts";

type Action = "shortlist" | "reject" | "save_for_later" | "select_for_planning" | "merge";
const VALID_ACTIONS: readonly Action[] = ["shortlist", "reject", "save_for_later", "select_for_planning", "merge"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string;
    content_opportunity_id?: string;
    action?: string;
    reason?: string;
    merge_into_opportunity_id?: string;
    new_expires_at?: string;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const opportunityId = (body.content_opportunity_id ?? "").trim();
  const action = (body.action ?? "").trim() as Action;
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!opportunityId) return json({ code: "CONTENT_OPPORTUNITY_ID_REQUIRED" }, 400);
  if (!VALID_ACTIONS.includes(action)) {
    return json({ code: "INVALID_ACTION", message: `action must be one of: ${VALID_ACTIONS.join(", ")}` }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: opp, error: oppError } = await sb
    .from("content_opportunities")
    .select("id, client_id, status, expires_at")
    .eq("id", opportunityId)
    .maybeSingle();
  if (oppError) return json({ code: "LOOKUP_FAILED", message: oppError.message }, 500);
  if (!opp) return json({ code: "OPPORTUNITY_NOT_FOUND" }, 404);
  if (opp.client_id !== clientId) return json({ code: "CROSS_CLIENT_OPPORTUNITY" }, 403);

  const currentStatus = opp.status as ContentOpportunityStatus;
  const NON_TERMINAL: readonly ContentOpportunityStatus[] = ["draft", "needs_review", "shortlisted"];

  if (action === "shortlist" || action === "select_for_planning") {
    const target: ContentOpportunityStatus = action === "shortlist" ? "shortlisted" : "selected";
    const path = findTransitionPath(CONTENT_OPPORTUNITY_TRANSITIONS, currentStatus, target);
    if (!path) {
      return json({
        code: "INVALID_TRANSITION",
        message: `Cannot reach "${target}" from "${currentStatus}".`,
      }, 409);
    }
    const update: Record<string, unknown> = { status: target };
    if (target === "selected") update.selected_at = new Date().toISOString();
    const { error: updateError } = await sb.from("content_opportunities").update(update).eq("id", opportunityId);
    if (updateError) return json({ code: "UPDATE_FAILED", message: updateError.message }, 500);
    await audit(sb, `content_opportunity.${action}`, "content_opportunities", opportunityId, { client_id: clientId, from: currentStatus, to: target, path });
    return json({ ok: true, content_opportunity_id: opportunityId, status: target }, 200);
  }

  if (action === "reject") {
    const reason = (body.reason ?? "").trim();
    if (!reason) return json({ code: "REASON_REQUIRED" }, 400);
    if (!CONTENT_OPPORTUNITY_TRANSITIONS[currentStatus].includes("rejected")) {
      return json({ code: "INVALID_TRANSITION", message: `Cannot reject from "${currentStatus}".` }, 409);
    }
    const { error: updateError } = await sb
      .from("content_opportunities")
      .update({ status: "rejected", rejected_reason: reason })
      .eq("id", opportunityId);
    if (updateError) return json({ code: "UPDATE_FAILED", message: updateError.message }, 500);
    await audit(sb, "content_opportunity.reject", "content_opportunities", opportunityId, { client_id: clientId, from: currentStatus, reason });
    return json({ ok: true, content_opportunity_id: opportunityId, status: "rejected" }, 200);
  }

  if (action === "save_for_later") {
    if (!NON_TERMINAL.includes(currentStatus)) {
      return json({ code: "INVALID_TRANSITION", message: `Cannot save for later from "${currentStatus}".` }, 409);
    }
    const newExpiresAt = (body.new_expires_at ?? "").trim();
    if (!newExpiresAt || Number.isNaN(Date.parse(newExpiresAt)) || Date.parse(newExpiresAt) <= Date.now()) {
      return json({ code: "INVALID_EXPIRY", message: "new_expires_at must be a valid future timestamp." }, 400);
    }
    const { error: updateError } = await sb
      .from("content_opportunities")
      .update({ expires_at: newExpiresAt })
      .eq("id", opportunityId);
    if (updateError) return json({ code: "UPDATE_FAILED", message: updateError.message }, 500);
    await audit(sb, "content_opportunity.save_for_later", "content_opportunities", opportunityId, { client_id: clientId, new_expires_at: newExpiresAt });
    return json({ ok: true, content_opportunity_id: opportunityId, status: currentStatus }, 200);
  }

  // action === "merge"
  const mergeIntoId = (body.merge_into_opportunity_id ?? "").trim();
  if (!mergeIntoId) return json({ code: "MERGE_TARGET_REQUIRED" }, 400);
  if (mergeIntoId === opportunityId) return json({ code: "CANNOT_MERGE_INTO_SELF" }, 400);
  if (!NON_TERMINAL.includes(currentStatus)) {
    return json({ code: "INVALID_TRANSITION", message: `Cannot merge from "${currentStatus}".` }, 409);
  }
  const { data: target, error: targetError } = await sb
    .from("content_opportunities")
    .select("id, client_id, status")
    .eq("id", mergeIntoId)
    .maybeSingle();
  if (targetError) return json({ code: "LOOKUP_FAILED", message: targetError.message }, 500);
  if (!target) return json({ code: "MERGE_TARGET_NOT_FOUND" }, 404);
  if (target.client_id !== clientId) return json({ code: "CROSS_CLIENT_MERGE_TARGET" }, 403);
  if (target.status === "rejected" || target.status === "expired") {
    return json({ code: "MERGE_TARGET_TERMINAL", message: `Merge target is already "${target.status}".` }, 409);
  }

  const { error: updateError } = await sb
    .from("content_opportunities")
    .update({
      status: "rejected",
      rejected_reason: `merged_into:${mergeIntoId}`,
      duplicate_of_opportunity_id: mergeIntoId,
      dedup_reason: "manual_merge",
    })
    .eq("id", opportunityId);
  if (updateError) return json({ code: "UPDATE_FAILED", message: updateError.message }, 500);

  await audit(sb, "content_opportunity.merge", "content_opportunities", opportunityId, {
    client_id: clientId,
    from: currentStatus,
    merged_into: mergeIntoId,
  });

  return json({ ok: true, content_opportunity_id: opportunityId, status: "rejected", merged_into: mergeIntoId }, 200);
});
