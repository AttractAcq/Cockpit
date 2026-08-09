// Programme Stage 1B-B — refresh / reconnect health check for an existing
// Facebook Page destination. Re-discovers the client's Pages fresh (never
// trusts the stored external_account_id alone) so Page removal, token
// expiry/revocation, and permission loss are all detected the same way
// discovery detects them at connect time.
import { svc, cors, json, audit } from "../_shared/aa.ts";
import {
  discoverManagedPages, liveDiscoverPagesDeps,
  checkPageCapability, deriveConnectionStatus, classifyCapabilityCheckFailure,
} from "../_shared/facebook-pages.ts";
import { validateFacebookDestinationAccess, resolveClientMetaToken } from "../_shared/facebook-destination-auth.ts";

const FUNCTION_NAME = "verify-facebook-destination-capability";
const fail = (status: number, code: string, message: string) => json({ ok: false, function: FUNCTION_NAME, code, message }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "POST only.");

  let body: { client_id?: string; distribution_account_id?: string };
  try { body = await req.json(); } catch { return fail(400, "INVALID_JSON", "Request body must be valid JSON."); }

  const clientId = (body.client_id ?? "").trim();
  const accountId = (body.distribution_account_id ?? "").trim();
  if (!clientId) return fail(400, "CLIENT_ID_REQUIRED", "client_id is required.");
  if (!accountId) return fail(400, "DISTRIBUTION_ACCOUNT_ID_REQUIRED", "distribution_account_id is required.");

  const access = await validateFacebookDestinationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return fail(access.status, access.code, access.message);

  const sb = svc();

  // Defence in depth: confirm the destination really belongs to this client,
  // even though the caller's own JWT already passed the clients-RLS check above.
  const { data: account, error: accountError } = await sb
    .from("client_distribution_accounts")
    .select("id, client_id, platform, external_account_id")
    .eq("id", accountId).eq("client_id", clientId).maybeSingle();
  if (accountError) return fail(500, "LOOKUP_FAILED", accountError.message);
  if (!account) return fail(404, "DESTINATION_NOT_FOUND", "No Facebook destination with that id exists for this client.");
  if (account.platform !== "facebook") return fail(400, "NOT_A_FACEBOOK_DESTINATION", "This destination is not a Facebook Page.");

  const { data: client, error: clientError } = await sb.from("clients").select("slug").eq("id", clientId).maybeSingle();
  if (clientError || !client) return fail(404, "CLIENT_NOT_FOUND", "Client not found.");

  const { token, missing } = await resolveClientMetaToken(sb, client.slug);
  if (!token) {
    // No credential at all is not the same failure as a bad one -- record it
    // distinctly so an operator sees "reconfigure Meta access", not "token expired".
    await sb.from("client_distribution_accounts").update({ connection_status: "error", updated_at: new Date().toISOString() }).eq("id", accountId);
    return fail(503, "META_CONFIG_MISSING", `Meta configuration missing: ${missing.join("; ")}`);
  }

  let capability;
  let page: { id: string; name: string; category: string | null; tasks: string[] } | undefined;
  try {
    const pages = await discoverManagedPages(liveDiscoverPagesDeps, token);
    page = pages.find((p) => p.id === account.external_account_id);
    if (!page) {
      capability = {
        grantedScopes: [], missingScopes: [], supportedCapabilities: [],
        verificationStatus: "error" as const,
        lastError: "This Page is no longer present among the Pages the connected Meta identity can manage. It may have been removed, or access may have been revoked in Business Manager.",
      };
    } else {
      capability = checkPageCapability(page);
    }
  } catch (error) {
    capability = classifyCapabilityCheckFailure(error);
  }

  const connectionStatus = deriveConnectionStatus(capability);
  const nowIso = new Date().toISOString();

  const { error: updateError } = await sb.from("client_distribution_accounts").update({
    connection_status: connectionStatus, last_verified_at: nowIso, updated_at: nowIso,
    ...(page ? { external_metadata: { name: page.name, category: page.category } } : {}),
  }).eq("id", accountId);
  if (updateError) return fail(500, "UPDATE_FAILED", updateError.message);

  const { error: capError } = await sb.from("client_distribution_account_capabilities").upsert({
    client_id: clientId, distribution_account_id: accountId,
    granted_scopes: capability.grantedScopes, missing_scopes: capability.missingScopes,
    supported_capabilities: capability.supportedCapabilities, verification_status: capability.verificationStatus,
    last_checked_at: nowIso, last_error: capability.lastError,
  }, { onConflict: "distribution_account_id" });
  if (capError) return fail(500, "CAPABILITY_WRITE_FAILED", capError.message);

  await audit(sb, "facebook_destination.verified", "client_distribution_accounts", accountId, {
    client_id: clientId, connection_status: connectionStatus, verification_status: capability.verificationStatus,
  }).catch(() => {});

  return json({ ok: true, function: FUNCTION_NAME, connection_status: connectionStatus, capability }, 200);
});
