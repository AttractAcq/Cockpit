// Programme Stage G — proposed-Calendar edit actions: move, swap, remove,
// restore. Mirrors the Ideation calendar proposal's edit contract
// (edit_revision optimistic concurrency, manual edits preserve provenance
// via original_content_opportunity_id) generalised to content_opportunities.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { applyProposalEdit, type ProposalEditAction, type ProposalSlotState } from "../_shared/calendar-planning.ts";

const VALID_ACTIONS: readonly ProposalEditAction[] = ["move", "swap", "remove", "restore"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string;
    proposal_id?: string;
    action?: string;
    expected_edit_revision?: number;
    from_slot_id?: string;
    to_slot_id?: string;
    slot_id?: string;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const proposalId = (body.proposal_id ?? "").trim();
  const action = (body.action ?? "").trim() as ProposalEditAction;
  const expectedRevision = body.expected_edit_revision;
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!proposalId) return json({ code: "PROPOSAL_ID_REQUIRED" }, 400);
  if (!VALID_ACTIONS.includes(action)) {
    return json({ code: "INVALID_ACTION", message: `action must be one of: ${VALID_ACTIONS.join(", ")}` }, 400);
  }
  if (typeof expectedRevision !== "number") return json({ code: "EXPECTED_EDIT_REVISION_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: proposal, error: proposalError } = await sb
    .from("content_calendar_proposals")
    .select("id, client_id, status, edit_revision")
    .eq("id", proposalId)
    .maybeSingle();
  if (proposalError) return json({ code: "LOOKUP_FAILED", message: proposalError.message }, 500);
  if (!proposal) return json({ code: "PROPOSAL_NOT_FOUND" }, 404);
  if (proposal.client_id !== clientId) return json({ code: "CROSS_CLIENT_PROPOSAL" }, 403);
  if (proposal.status !== "draft") {
    return json({ code: "PROPOSAL_NOT_DRAFT", message: `Proposal status is ${proposal.status}.` }, 409);
  }
  if (proposal.edit_revision !== expectedRevision) {
    return json({
      code: "STALE_EDIT_REVISION",
      message: "The proposal has changed since you last loaded it.",
      current_edit_revision: proposal.edit_revision,
    }, 409);
  }

  const { data: slotRows, error: slotsError } = await sb
    .from("content_calendar_proposal_slots")
    .select("id, calendar_slot_id, content_opportunity_id, original_content_opportunity_id")
    .eq("proposal_id", proposalId);
  if (slotsError) return json({ code: "LOOKUP_FAILED", message: slotsError.message }, 500);

  const slots: ProposalSlotState[] = (slotRows ?? []).map((s) => ({
    id: s.id,
    calendar_slot_id: s.calendar_slot_id,
    content_opportunity_id: s.content_opportunity_id,
    original_content_opportunity_id: s.original_content_opportunity_id,
  }));

  const bySlotId = (id: string | undefined) => (id ? slots.find((s) => s.id === id || s.calendar_slot_id === id)?.id : undefined);

  const result = applyProposalEdit(action, slots, {
    fromSlotId: bySlotId(body.from_slot_id),
    toSlotId: bySlotId(body.to_slot_id),
    slotId: bySlotId(body.slot_id),
  });
  if (!result.ok) {
    return json({ code: result.code ?? "EDIT_REJECTED" }, 409);
  }

  // Cross-client / already-committed guard: an Opportunity being moved into
  // a slot must still belong to this client and must not already be committed.
  for (const update of result.updates) {
    if (!update.content_opportunity_id) continue;
    const { data: opp, error: oppError } = await sb
      .from("content_opportunities")
      .select("id, client_id, status")
      .eq("id", update.content_opportunity_id)
      .maybeSingle();
    if (oppError) return json({ code: "LOOKUP_FAILED", message: oppError.message }, 500);
    if (!opp || opp.client_id !== clientId) return json({ code: "CROSS_CLIENT_OPPORTUNITY" }, 403);
    const { count } = await sb
      .from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("content_opportunity_id", update.content_opportunity_id);
    if ((count ?? 0) > 0) return json({ code: "OPPORTUNITY_ALREADY_COMMITTED" }, 409);
  }

  for (const update of result.updates) {
    const { error: updateError } = await sb
      .from("content_calendar_proposal_slots")
      .update({
        content_opportunity_id: update.content_opportunity_id,
        placement_source: update.placement_source,
        manually_edited: update.manually_edited,
      })
      .eq("id", update.slotId);
    if (updateError) return json({ code: "UPDATE_FAILED", message: updateError.message }, 500);
  }

  const { data: updatedProposal, error: revisionError } = await sb
    .from("content_calendar_proposals")
    .update({ edit_revision: proposal.edit_revision + 1 })
    .eq("id", proposalId)
    .select("edit_revision")
    .single();
  if (revisionError) return json({ code: "UPDATE_FAILED", message: revisionError.message }, 500);

  await audit(sb, `content_calendar_proposal.${action}`, "content_calendar_proposals", proposalId, {
    client_id: clientId, action, updates: result.updates,
  });

  return json({
    ok: true,
    proposal_id: proposalId,
    action,
    edit_revision: updatedProposal.edit_revision,
    updates: result.updates,
  }, 200);
});
