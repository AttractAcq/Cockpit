import { createClient } from "jsr:@supabase/supabase-js@2";
import { SUPABASE_URL } from "../aa.ts";

export type IntelligenceAccessResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: number; code: string; message: string };

export async function validateIntelligenceAccess(
  authorizationHeader: string | null,
  clientId: string,
): Promise<IntelligenceAccessResult> {
  const jwt = (authorizationHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return { ok: false, status: 401, code: "NOT_AUTHENTICATED", message: "A bearer token is required." };

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
  if (roleError || !new Set(["admin", "account_manager"]).has(role)) {
    return { status: 403, ok: false, code: "STAFF_ROLE_REQUIRED", message: "Intelligence requires an admin or account manager role." };
  }

  const { data: client, error: clientError } = await userClient
    .from("clients").select("id").eq("id", clientId).maybeSingle();
  if (clientError || !client) {
    return { ok: false, status: 403, code: "CLIENT_ACCESS_DENIED", message: "The caller cannot access this client." };
  }
  return { ok: true, userId: authData.user.id, role };
}
