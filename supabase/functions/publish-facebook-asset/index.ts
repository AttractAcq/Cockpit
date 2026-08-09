// Programme Stage 1B-D — manual "Publish Now" entry point for a Facebook
// distribution record. Delegates to the shared publisher, which checks
// credentials first and never fabricates a published state.
//
// Deliberately adds a real client-ownership check that its Instagram
// sibling (publish-instagram-asset) does not have — that function trusts
// any staff role globally via the service-role client, without verifying
// the caller's real, team_members-scoped access to the record's specific
// client (a pre-existing gap, confirmed unchanged, not fixed here since
// it's out of this stage's scope — flagged in the status report). This
// stage's own required test list explicitly names "cross-client
// destination spoofing," so this new function closes that gap for itself
// rather than copying it forward.
import { svc, cors, json } from "../_shared/aa.ts";
import { validateFacebookDestinationAccess } from "../_shared/facebook-destination-auth.ts";
import { publishFacebookDistributionRecord } from "../_shared/facebook-publish-orchestrator.ts";

const FUNCTION_NAME = "publish-facebook-asset";

function failure(status: number, code: string, message: string): Response {
  return json({ ok: false, function: FUNCTION_NAME, code, message }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return failure(405, "METHOD_NOT_ALLOWED", "POST only.");

  let body: { client_id?: string; distribution_record_id?: string };
  try { body = await req.json(); } catch { return failure(400, "INVALID_JSON", "Request body must be valid JSON."); }

  const clientId = (body.client_id ?? "").trim();
  const recordId = (body.distribution_record_id ?? "").trim();
  if (!clientId) return failure(400, "CLIENT_ID_REQUIRED", "client_id is required.");
  if (!recordId) return failure(400, "DISTRIBUTION_RECORD_ID_REQUIRED", "distribution_record_id is required.");

  const access = await validateFacebookDestinationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return failure(access.status, access.code, access.message);

  const sb = svc();

  // Defence in depth: the record must genuinely belong to the client the
  // caller was just verified against, closing the cross-client spoofing
  // path even though the caller already passed a real ownership check.
  const { data: record, error: recordError } = await sb
    .from("client_distribution_records").select("id, client_id, platform").eq("id", recordId).eq("client_id", clientId).maybeSingle();
  if (recordError) return failure(500, "LOOKUP_FAILED", recordError.message);
  if (!record) return failure(404, "RECORD_NOT_FOUND", "No distribution record with that id exists for this client.");
  if (record.platform !== "facebook") return failure(400, "NOT_A_FACEBOOK_RECORD", "This distribution record is not a Facebook record.");

  const outcome = await publishFacebookDistributionRecord(sb, recordId, "publish_now");
  return json({ function: FUNCTION_NAME, ...outcome }, outcome.ok ? 200 : outcome.missing_config ? 409 : 422);
});
