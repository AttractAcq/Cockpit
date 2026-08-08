// Programme Stage G — approve a proposed Calendar, committing every assigned
// slot into a canonical Content Item. Thin wrapper around the
// commit_calendar_proposal RPC, which does the actual atomic work — see that
// function's own comment for why this is a Postgres function rather than
// client-orchestrated multi-step writes.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

const ERROR_STATUS: Record<string, number> = {
  PROPOSAL_NOT_FOUND: 404,
  PROPOSAL_NOT_DRAFT: 409,
  STALE_EDIT_REVISION: 409,
  SLOT_ALREADY_FILLED: 409,
  SLOT_ALREADY_COMMITTED: 409,
  OPPORTUNITY_ALREADY_COMMITTED: 409,
  OPPORTUNITY_NOT_READY: 409,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; proposal_id?: string; expected_edit_revision?: number };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const proposalId = (body.proposal_id ?? "").trim();
  const expectedRevision = body.expected_edit_revision;
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!proposalId) return json({ code: "PROPOSAL_ID_REQUIRED" }, 400);
  if (typeof expectedRevision !== "number") return json({ code: "EXPECTED_EDIT_REVISION_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data, error } = await sb.rpc("commit_calendar_proposal", {
    p_client_id: clientId,
    p_proposal_id: proposalId,
    p_expected_edit_revision: expectedRevision,
    p_actor: access.userId,
  });

  if (error) {
    // The RPC raises "CODE" or "CODE:detail" — surface the code, drop the detail.
    const code = (error.message ?? "").split(":")[0].trim() || "COMMIT_FAILED";
    const status = ERROR_STATUS[code] ?? 500;
    return json({ code, message: error.message }, status);
  }

  await audit(sb, "content_calendar_proposal.approved", "content_calendar_proposals", proposalId, {
    client_id: clientId,
    created_content_item_ids: (data as { created_content_item_ids?: string[] })?.created_content_item_ids,
  });

  return json({ ok: true, proposal_id: proposalId, ...(data as Record<string, unknown>) }, 200);
});
