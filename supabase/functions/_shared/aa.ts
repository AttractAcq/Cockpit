import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function svc(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function useStubs(): boolean {
  return (Deno.env.get("AA_USE_STUBS") ?? "true").toLowerCase() !== "false";
}

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function vaultName(clientSlug: string, service: string, credentialType: string): string {
  const norm = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
  return `${norm(clientSlug)}_${norm(service)}_${norm(credentialType)}`;
}

export async function readCredential(
  sb: SupabaseClient,
  clientSlug: string,
  service: string,
  credentialType: string,
): Promise<string | null> {
  const name = vaultName(clientSlug, service, credentialType);
  const { data, error } = await sb.rpc("vault_read_credential", { p_name: name });
  if (error || !data) return null;
  return data as string;
}

export async function audit(
  sb: SupabaseClient,
  action: string,
  table_name: string | null,
  record_id: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await sb.from("audit_log").insert({ action, table_name, record_id, metadata });
}

export async function agentEvent(
  sb: SupabaseClient,
  entity_id: string | null,
  agent: string,
  event_type: string,
  payload: Record<string, unknown> = {},
  status = "processed",
): Promise<void> {
  await sb.from("agent_events").insert({ entity_id, agent, event_type, payload, status });
}
