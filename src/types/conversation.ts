import type { UUID, ISODate, Channel } from "./common";

export interface Conversation {
  id: UUID;
  entity_id: UUID | null;
  entity_name: string; // denormalized for list views
  channel: Channel;
  subject: string | null; // email only
  unread_count: number;
  last_message_at: ISODate;
  last_message_preview: string;
  last_message_from: "us" | "them";
  is_pinned: boolean;
  created_at: ISODate;
}

export interface Message {
  id: UUID;
  conversation_id: UUID;
  channel: Channel;
  direction: "inbound" | "outbound";
  body: string;
  sent_at: ISODate;
  sender_name: string;

  // Outbound metadata
  sent_by: "human" | "agent" | "automation";
  agent_run_id: UUID | null;

  // Status
  delivered_at: ISODate | null;
  read_at: ISODate | null;

  // Attachments (filenames only — files live in Supabase Storage)
  attachments: { name: string; url: string; size_bytes: number }[];
}
