// Cockpit v3 Step 3 — Team workspace. Business-scoped channels/messages,
// additive alongside the existing read-only Team Directory (Stage 2 Phase
// 09), not a replacement.

export interface TeamChannelRow {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMessageRow {
  id: string;
  channel_id: string;
  parent_message_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
}
