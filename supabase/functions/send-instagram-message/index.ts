// Stage 2 Phase 10 — Communications Hub. The one legitimate outbound path:
// a staff member replies to a comms_identities conversation. Real send via
// Meta's Graph API only -- the message row is written only after Meta
// confirms success, never speculatively before.
import { cors, json, svc } from "../_shared/aa.ts";
import { resolveAaMetaToken, resolveAaInstagramAccountId, sendInstagramMessage } from "../_shared/comms-meta.ts";

const STAFF_ROLES = new Set(["admin", "account_manager", "strategist", "content_operator", "editor", "media_buyer", "analyst"]);

const FUNCTION_NAME = "send-instagram-message";
const fail = (status: number, stage: string, message: string) => json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

interface Body { identity_id?: string; body?: string }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "request", "POST only");

  const sb = svc();

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !user) return fail(401, "authorization", "Not authenticated.");

    const { data: operator } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (!operator || !STAFF_ROLES.has(operator.role)) return fail(403, "authorization", "Staff role required.");

    const requestBody = (await req.json()) as Body;
    const identityId = requestBody.identity_id?.trim() ?? "";
    const messageBody = requestBody.body?.trim() ?? "";
    if (!identityId) return fail(400, "request", "identity_id is required.");
    if (!messageBody) return fail(400, "request", "body is required.");

    const { data: identity, error: identityError } = await sb
      .from("comms_identities")
      .select("id, platform, external_user_id")
      .eq("id", identityId)
      .maybeSingle();
    if (identityError) return fail(500, "lookup", identityError.message);
    if (!identity) return fail(404, "lookup", "Conversation identity not found.");
    if (identity.platform !== "instagram") return fail(400, "request", `Sending is not implemented for platform "${identity.platform}".`);

    const [token, igUserId] = await Promise.all([resolveAaMetaToken(sb), resolveAaInstagramAccountId(sb)]);
    const missing: string[] = [];
    if (!token) missing.push("Meta system-user access token");
    if (!igUserId) missing.push("AA Instagram business account id");
    if (missing.length > 0) return fail(503, "configuration", `Meta configuration missing: ${missing.join("; ")}. Nothing was sent.`);

    const result = await sendInstagramMessage(igUserId!, identity.external_user_id, messageBody, token!);
    if (!result.ok) return fail(502, "send", result.error);

    const { data: messageId, error: recordError } = await sb.rpc("record_comms_message", {
      p_platform: "instagram",
      p_external_user_id: identity.external_user_id,
      p_direction: "outbound",
      p_body: messageBody,
      p_external_message_id: result.externalMessageId,
      p_sent_by: user.id,
    });
    if (recordError) {
      // The message DID send — a recording failure must not be reported as a send failure.
      console.error("[send-instagram-message] sent to Meta but record_comms_message failed:", recordError);
      return json({ ok: true, function: FUNCTION_NAME, message_id: null, warning: "Sent, but the local record failed to save — check comms_messages manually." });
    }

    return json({ ok: true, function: FUNCTION_NAME, message_id: messageId });
  } catch (e) {
    return fail(500, "unexpected", e instanceof Error ? e.message : String(e));
  }
});
