// Ideation nav consolidation, Phase 6: the unified Sources approve/disapprove
// gate. Every intake method (Add Idea, Add Proof, and scored AI Ideation
// candidates) converges on content_sources; this is the one action that
// moves a source out of the Sources queue, either into an unscheduled
// Content Items row (approve) or nowhere at all (reject).
//
// Supersedes commit-manual-content, which committed straight to the
// operational Calendar. Approval here never writes calendar_cells -- the
// resulting master row is unscheduled and only Distribute to Calendar
// (distribute-content-items-to-calendar) ever assigns it a date.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

const ACTIONS = new Set(["approve", "reject"]);
const ASSET_TYPES = new Set(["reel", "carousel", "static", "story"]);

interface ReviewBody {
  client_id?: string;
  content_source_id?: string;
  action?: string;
  asset_type?: string;
  reason?: string;
}

function statusForRpcError(message: string): number {
  if (message.includes("FORBIDDEN")) return 403;
  if (message.includes("NOT_FOUND")) return 404;
  if (
    message.includes("ALREADY_COMMITTED") ||
    message.includes("ALREADY_DISAPPROVED") ||
    message.includes("PROOF_NOT_USABLE") ||
    message.includes("CANDIDATE_NOT_SCORED")
  ) {
    return 409;
  }
  if (
    message.includes("ASSET_TYPE_REQUIRED") ||
    message.includes("UNSUPPORTED_ASSET_TYPE") ||
    message.includes("PROOF_LINK_MISSING") ||
    message.includes("UNSUPPORTED_KIND")
  ) {
    return 400;
  }
  return 500;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: ReviewBody;
  try {
    body = await req.json();
  } catch {
    return json({ code: "INVALID_JSON", message: "Request body must be JSON." }, 400);
  }

  const clientId = (body.client_id ?? "").trim();
  const contentSourceId = (body.content_source_id ?? "").trim();
  const action = (body.action ?? "").trim();
  const assetType = (body.asset_type ?? "").trim();
  const reason = (body.reason ?? "").trim();

  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!contentSourceId) return json({ code: "CONTENT_SOURCE_ID_REQUIRED" }, 400);
  if (!ACTIONS.has(action)) {
    return json({ code: "INVALID_ACTION", allowed: [...ACTIONS] }, 400);
  }
  if (action === "approve" && assetType && !ASSET_TYPES.has(assetType)) {
    return json({ code: "INVALID_ASSET_TYPE", allowed: [...ASSET_TYPES] }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) {
    return json({ code: access.code, message: access.message }, access.status);
  }

  const sb = svc();

  if (action === "approve") {
    const { data, error } = await sb.rpc("approve_content_source_to_master", {
      p_client_id: clientId,
      p_actor_id: access.userId,
      p_content_source_id: contentSourceId,
      p_asset_type: assetType || null,
    });
    if (error) {
      return json({ code: "APPROVE_FAILED", message: error.message }, statusForRpcError(error.message));
    }
    await audit(sb, "content_source.approved", data.master_table as string, data.master_id as string, {
      client_id: clientId,
      content_source_id: contentSourceId,
      ref: data.ref,
    });
    return json(data, 201);
  }

  const { data, error } = await sb.rpc("reject_content_source", {
    p_client_id: clientId,
    p_actor_id: access.userId,
    p_content_source_id: contentSourceId,
    p_reason: reason || null,
  });
  if (error) {
    return json({ code: "REJECT_FAILED", message: error.message }, statusForRpcError(error.message));
  }
  await audit(sb, "content_source.rejected", "content_sources", contentSourceId, {
    client_id: clientId,
    reason,
  });
  return json(data, 200);
});
