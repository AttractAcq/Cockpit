// Stage 2 Phase 10 — Communications Hub data access. Reads comms_identities/
// comms_messages directly (RLS-scoped, staff-only); linking goes through the
// staff-gated RPC; sending goes through send-instagram-message (the golden
// rule: anything touching the outside world invokes an edge function).

import { supabase, invokeFn } from "./supabase";
import type { CommsIdentityRow, CommsMessageRow } from "@/types/comms";

export async function fetchCommsIdentities(): Promise<CommsIdentityRow[]> {
  const { data, error } = await supabase.from("comms_identities").select("*").order("last_seen_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CommsIdentityRow[];
}

export async function fetchCommsMessages(identityId: string): Promise<CommsMessageRow[]> {
  const { data, error } = await supabase.from("comms_messages").select("*").eq("identity_id", identityId).order("occurred_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CommsMessageRow[];
}

export async function linkCommsIdentity(identityId: string, leadId: string | null, clientId: string | null): Promise<void> {
  const { error } = await supabase.rpc("link_comms_identity", { p_identity_id: identityId, p_lead_id: leadId, p_client_id: clientId });
  if (error) throw error;
}

export async function sendInstagramMessage(identityId: string, body: string): Promise<{ message_id: string | null }> {
  return invokeFn("send-instagram-message", { identity_id: identityId, body });
}
