// Programme Stage 1B-B — read-only discovery of the Facebook Pages the
// client's connected Meta identity can manage. Writes nothing. The token
// itself is never returned to the caller/browser.
import { svc, cors, json } from "../_shared/aa.ts";
import { discoverManagedPages, liveDiscoverPagesDeps } from "../_shared/facebook-pages.ts";
import { validateFacebookDestinationAccess, resolveClientMetaToken } from "../_shared/facebook-destination-auth.ts";

const FUNCTION_NAME = "discover-facebook-pages";
const fail = (status: number, code: string, message: string) => json({ ok: false, function: FUNCTION_NAME, code, message }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "POST only.");

  let body: { client_id?: string };
  try { body = await req.json(); } catch { return fail(400, "INVALID_JSON", "Request body must be valid JSON."); }

  const clientId = (body.client_id ?? "").trim();
  if (!clientId) return fail(400, "CLIENT_ID_REQUIRED", "client_id is required.");

  const access = await validateFacebookDestinationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return fail(access.status, access.code, access.message);

  const sb = svc();
  const { data: client, error: clientError } = await sb.from("clients").select("slug").eq("id", clientId).maybeSingle();
  if (clientError || !client) return fail(404, "CLIENT_NOT_FOUND", "Client not found.");

  const { token, missing } = await resolveClientMetaToken(sb, client.slug);
  if (!token) return fail(503, "META_CONFIG_MISSING", `Meta configuration missing: ${missing.join("; ")}`);

  try {
    const pages = await discoverManagedPages(liveDiscoverPagesDeps, token);
    return json({ ok: true, function: FUNCTION_NAME, pages }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(502, "META_DISCOVERY_FAILED", message);
  }
});
