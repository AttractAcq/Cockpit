// Programme Stage 1B-B — auth and credential resolution for Facebook
// destination endpoints. Split out from facebook-pages.ts specifically
// because these two functions need the Supabase client (a jsr: import Deno
// resolves but Node's ESM loader cannot) — keeping facebook-pages.ts fully
// dependency-free is what makes its pure logic unit-testable under
// `node --test` (same reasoning meta-errors.ts documents for its own split
// from instagram-publish.ts).
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { SUPABASE_URL, readCredential } from "./aa.ts";

// ── Auth: staff role + real, RLS-verified client access ─────────────────
// Edge functions run as service_role, which bypasses RLS entirely -- so the
// only way to genuinely verify "can this caller access this specific
// client" is to check it under the CALLER's own JWT against the real
// client_distribution_accounts RLS policy (fixed this stage to include
// client_id = ANY(auth_client_ids())), not just a coarse role lookup. This
// mirrors the safe pattern already used by _shared/ideation/auth.ts's
// validateIdeationAccess, widened from its 2-role ideation set to the
// 3-role STAFF_ROLES set (admin, account_manager, editor) that this stage's
// own RLS policies grant.
export const FACEBOOK_DESTINATION_STAFF_ROLES = new Set(["admin", "account_manager", "editor"]);

export type FacebookDestinationAccessResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: number; code: string; message: string };

export async function validateFacebookDestinationAccess(
  authorizationHeader: string | null,
  clientId: string,
): Promise<FacebookDestinationAccessResult> {
  const jwt = (authorizationHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return { ok: false, status: 401, code: "NOT_AUTHENTICATED", message: "A bearer token is required." };

  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  if (!anonKey) return { ok: false, status: 503, code: "AUTH_CONFIGURATION_MISSING", message: "User-scoped authentication is not configured." };

  const userClient = createClient(SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
  if (authError || !authData.user) return { ok: false, status: 401, code: "NOT_AUTHENTICATED", message: "The supplied session is not valid." };

  const { data: roleData, error: roleError } = await userClient.rpc("auth_role");
  const role = typeof roleData === "string" ? roleData : "";
  if (roleError || !FACEBOOK_DESTINATION_STAFF_ROLES.has(role)) {
    return { ok: false, status: 403, code: "STAFF_ROLE_REQUIRED", message: "A staff role (admin, account manager or editor) is required." };
  }

  // Real client-ownership check: reads under the caller's own JWT, so this
  // fails closed for any client the caller's team_members grants don't cover.
  const { data: client, error: clientError } = await userClient.from("clients").select("id, slug").eq("id", clientId).maybeSingle();
  if (clientError || !client) return { ok: false, status: 403, code: "CLIENT_ACCESS_DENIED", message: "The caller cannot access this client." };

  return { ok: true, userId: authData.user.id, role };
}

// ── Credential resolution ─────────────────────────────────────────────────
// Facebook Page publishing and Instagram Business publishing both go through
// Facebook's identity layer -- a Meta System User granted access to both the
// IG account and the Page in Business Manager. Deliberately reuses the exact
// same resolution chain and env var names instagram-publish.ts's
// resolveMetaConfig already uses, rather than inventing a parallel Facebook-
// specific credential path this stage cannot live-verify (see Stage 1B-A's
// security model doc, "Credential storage" -- confirmed not yet live-tested,
// carried forward as an open item here too). `client_distribution_accounts.
// credential_reference` is stored for future flexibility and operator
// visibility but is not yet consulted here -- deliberately, since the
// underlying vault_read_credential RPC this would route through does not
// exist in the live database (confirmed this stage; see status report).

export interface ResolvedMetaToken {
  token: string | null;
  missing: string[];
}

export async function resolveClientMetaToken(sb: SupabaseClient, clientSlug: string): Promise<ResolvedMetaToken> {
  const token =
    (Deno.env.get("_GLOBAL_META_SYSTEM_USER_TOKEN") ?? null) ??
    (Deno.env.get("META_SYSTEM_USER_TOKEN") ?? null) ??
    (await readCredential(sb, clientSlug, "META", "SYSTEM_USER_TOKEN")) ??
    (await readCredential(sb, "_GLOBAL", "META", "SYSTEM_USER_TOKEN"));
  return { token, missing: token ? [] : ["Meta system-user access token"] };
}
