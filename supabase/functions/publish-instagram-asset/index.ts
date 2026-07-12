// Phase H3 — manual "Publish Now" entry point. Staff-gated. Delegates to the
// shared publisher, which checks Meta credentials first and never fabricates a
// published state.
import { svc, json, cors } from "../_shared/aa.ts";
import { publishDistributionRecord } from "../_shared/instagram-publish.ts";

const FUNCTION_NAME = "publish-instagram-asset";
const STAFF_ROLES = new Set(["admin", "account_manager", "editor"]);

function failure(status: number, stage: string, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, function: FUNCTION_NAME, stage, error, message: `${FUNCTION_NAME} failed at ${stage}: ${error}`, ...extra }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return failure(405, "request", "POST only");
  const sb = svc();
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !user) return failure(401, "authorization", "Not authenticated.");
    const { data: operator, error: operatorError } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (operatorError) return failure(500, "authorization", "Could not load operator role.");
    if (!operator || !STAFF_ROLES.has(operator.role)) return failure(403, "authorization", "Admin, account manager, or editor access is required.");

    const body = await req.json() as { distribution_record_id?: string; mode?: string; payload_overrides?: Record<string, unknown> };
    const recordId = body.distribution_record_id?.trim() ?? "";
    if (!recordId) return failure(400, "request", "distribution_record_id is required.");
    // Manual endpoint only ever runs the publish_now path; the worker uses its own.
    const outcome = await publishDistributionRecord(sb, recordId, "publish_now", body.payload_overrides ?? {});
    return json({ function: FUNCTION_NAME, ...outcome }, outcome.ok ? 200 : outcome.missing_config ? 409 : 422);
  } catch (error) {
    return failure(500, "unhandled", error instanceof Error ? error.message : String(error));
  }
});
