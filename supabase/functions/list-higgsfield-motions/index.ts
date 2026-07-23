// Reel Studio Phase C: staff-authenticated wrapper around Higgsfield's
// undocumented motion catalog endpoint (GET /v1/motions), so the Studio UI's
// shot editor can offer a searchable name->UUID motion picker instead of
// requiring raw catalog UUID entry. See _shared/higgsfield.ts for the
// discovery notes on this endpoint.
import { cors, json, svc } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";
import { listHiggsfieldMotions, readHiggsfieldCredential, safeHiggsfieldError } from "../_shared/higgsfield.ts";

const FUNCTION_NAME = "list-higgsfield-motions";

const fail = (status: number, stage: string, message: string) =>
  json({ ok: false, function: FUNCTION_NAME, stage, message }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST" && req.method !== "GET") return fail(405, "request", "POST or GET only");

  const sb = svc();

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !user) return fail(401, "authorization", "Not authenticated.");

    const { data: operator } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (!operator || !STAFF_ROLES.has(operator.role)) return fail(403, "authorization", "Staff role required.");

    const credential = readHiggsfieldCredential();
    if (!credential) return fail(503, "configuration", "HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET are not configured.");

    const motions = await listHiggsfieldMotions(fetch, credential);
    return json({ ok: true, motions });
  } catch (error) {
    const message = safeHiggsfieldError(error);
    return fail(500, "list", message);
  }
});
