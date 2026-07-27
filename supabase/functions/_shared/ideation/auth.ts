import { createClient } from "jsr:@supabase/supabase-js@2";
import { SUPABASE_URL } from "../aa.ts";
import { isIdeationStaffRole } from "./access-policy.ts";

// Editors currently receive no client IDs from production auth_client_ids().
// PR 1.1 therefore fails closed instead of advertising an unusable role.
export type IdeationAccessResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: number; code: string; message: string };

export async function validateIdeationAccess(
  authorizationHeader: string | null,
  clientId: string,
): Promise<IdeationAccessResult> {
  const jwt = (authorizationHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return { ok: false, status: 401, code: "NOT_AUTHENTICATED", message: "A bearer token is required." };
  }

  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  if (!anonKey) {
    return { ok: false, status: 503, code: "AUTH_CONFIGURATION_MISSING", message: "User-scoped authentication is not configured." };
  }

  const userClient = createClient(SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
  if (authError || !authData.user) {
    return { ok: false, status: 401, code: "NOT_AUTHENTICATED", message: "The supplied session is not valid." };
  }

  const { data: roleData, error: roleError } = await userClient.rpc("auth_role");
  const role = typeof roleData === "string" ? roleData : "";
  if (roleError || !isIdeationStaffRole(role)) {
    return {
      ok: false,
      status: 403,
      code: "STAFF_ROLE_REQUIRED",
      message: "Ideation requires an admin or account manager role.",
    };
  }

  // This read intentionally uses the caller's JWT and the existing clients RLS
  // policy. Service-role access is not created until this check succeeds.
  const { data: client, error: clientError } = await userClient
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError || !client) {
    return { ok: false, status: 403, code: "CLIENT_ACCESS_DENIED", message: "The caller cannot access this client." };
  }

  return { ok: true, userId: authData.user.id, role };
}
