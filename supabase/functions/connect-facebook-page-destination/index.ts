// Programme Stage 1B-B — connect a Facebook Page as a real, client-scoped
// distribution destination. Never trusts a page_id typed into a form: the
// requested Page must be present in a FRESH discovery call for this
// client's own Meta identity before it can be connected (ownership check).
// Never stores a raw token -- only the account row + a capability snapshot.
import { svc, cors, json, audit } from "../_shared/aa.ts";
import {
  discoverManagedPages, liveDiscoverPagesDeps,
  verifyPageOwnership, findDuplicateDestination, checkPageCapability, deriveConnectionStatus,
} from "../_shared/facebook-pages.ts";
import { validateFacebookDestinationAccess, resolveClientMetaToken } from "../_shared/facebook-destination-auth.ts";

const FUNCTION_NAME = "connect-facebook-page-destination";
const fail = (status: number, code: string, message: string) => json({ ok: false, function: FUNCTION_NAME, code, message }, status);

function normalizeHandle(pageName: string): string {
  // client_distribution_accounts_handle_normalized requires: lowercase,
  // trimmed, no leading '@', non-empty. Facebook Pages have no Instagram-
  // style handle in the /me/accounts response, so the Page name is the best
  // available real, non-fabricated identifier.
  return pageName.trim().toLowerCase().replace(/^@+/, "") || "facebook-page";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "POST only.");

  let body: { client_id?: string; page_id?: string; label?: string; is_default?: boolean };
  try { body = await req.json(); } catch { return fail(400, "INVALID_JSON", "Request body must be valid JSON."); }

  const clientId = (body.client_id ?? "").trim();
  const pageId = (body.page_id ?? "").trim();
  if (!clientId) return fail(400, "CLIENT_ID_REQUIRED", "client_id is required.");
  if (!pageId) return fail(400, "PAGE_ID_REQUIRED", "page_id is required.");

  const access = await validateFacebookDestinationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return fail(access.status, access.code, access.message);

  const sb = svc();
  const { data: client, error: clientError } = await sb.from("clients").select("slug").eq("id", clientId).maybeSingle();
  if (clientError || !client) return fail(404, "CLIENT_NOT_FOUND", "Client not found.");

  const { token, missing } = await resolveClientMetaToken(sb, client.slug);
  if (!token) return fail(503, "META_CONFIG_MISSING", `Meta configuration missing: ${missing.join("; ")}`);

  // Ownership: re-discover fresh, never trust a page_id from the request body alone.
  let pages;
  try {
    pages = await discoverManagedPages(liveDiscoverPagesDeps, token);
  } catch (error) {
    return fail(502, "META_DISCOVERY_FAILED", error instanceof Error ? error.message : String(error));
  }
  const ownership = verifyPageOwnership(pages, pageId);
  if (!ownership.owned || !ownership.page) return fail(403, "PAGE_NOT_OWNED", ownership.reason ?? "Page ownership could not be verified.");

  // Duplicate check against this client's existing active destinations.
  const { data: existing, error: existingError } = await sb
    .from("client_distribution_accounts")
    .select("platform, external_account_id, is_active")
    .eq("client_id", clientId);
  if (existingError) return fail(500, "LOOKUP_FAILED", existingError.message);
  const duplicate = findDuplicateDestination(existing ?? [], "facebook", pageId);
  if (duplicate) return fail(409, "DUPLICATE_DESTINATION", "This Facebook Page is already connected as an active destination for this client.");

  const capability = checkPageCapability(ownership.page);
  const connectionStatus = deriveConnectionStatus(capability);

  const { data: account, error: upsertError } = await sb
    .from("client_distribution_accounts")
    .insert({
      client_id: clientId,
      platform: "facebook",
      label: (body.label ?? ownership.page.name).trim() || ownership.page.name,
      handle: normalizeHandle(ownership.page.name),
      external_account_id: ownership.page.id,
      account_type: ownership.page.category,
      is_default: body.is_default === true,
      is_active: true,
      connection_status: connectionStatus,
      last_verified_at: new Date().toISOString(),
      external_metadata: { name: ownership.page.name, category: ownership.page.category },
      updated_by: access.userId,
    })
    .select("*")
    .single();
  if (upsertError) return fail(500, "INSERT_FAILED", upsertError.message);

  const { error: capError } = await sb.from("client_distribution_account_capabilities").upsert({
    client_id: clientId,
    distribution_account_id: account.id,
    granted_scopes: capability.grantedScopes,
    missing_scopes: capability.missingScopes,
    supported_capabilities: capability.supportedCapabilities,
    verification_status: capability.verificationStatus,
    last_checked_at: new Date().toISOString(),
    last_error: capability.lastError,
  }, { onConflict: "distribution_account_id" });
  if (capError) return fail(500, "CAPABILITY_WRITE_FAILED", capError.message);

  await audit(sb, "facebook_destination.connected", "client_distribution_accounts", account.id, {
    client_id: clientId, page_id: pageId, page_name: ownership.page.name, connection_status: connectionStatus,
  }).catch(() => {});

  return json({ ok: true, function: FUNCTION_NAME, account, capability }, 200);
});
