// Stage 2 Phase 10 — Communications Hub. v1 is Instagram DMs only
// (Decision 3, Phase 00) — one channel, not the full list.

export type CommsPlatform = "instagram";
export type CommsMessageDirection = "inbound" | "outbound";

export interface CommsIdentityRow {
  id: string;
  platform: CommsPlatform;
  external_user_id: string;
  display_name: string | null;
  matched_lead_id: string | null;
  matched_client_id: string | null;
  matched_at: string | null;
  matched_by: string | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
}

export interface CommsMessageRow {
  id: string;
  identity_id: string;
  direction: CommsMessageDirection;
  body: string;
  external_message_id: string | null;
  occurred_at: string;
  sent_by: string | null;
  created_at: string;
}
