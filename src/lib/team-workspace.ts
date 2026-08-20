// Cockpit v3 Step 3 — Team workspace data access. Reads channels/messages
// directly (RLS-scoped, staff-only); writes go through the staff-gated
// RPCs, matching the established direct-supabase.rpc(...) convention
// (see src/lib/sales.ts).

import { supabase } from "./supabase";
import type { TeamChannelRow, TeamMessageRow } from "@/types/team-workspace";

export async function fetchTeamChannels(businessId?: string): Promise<TeamChannelRow[]> {
  let query = supabase.from("team_channels").select("*").order("created_at", { ascending: true });
  if (businessId) query = query.eq("business_id", businessId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as TeamChannelRow[];
}

export async function fetchTeamMessages(channelId: string): Promise<TeamMessageRow[]> {
  const { data, error } = await supabase.from("team_messages").select("*").eq("channel_id", channelId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TeamMessageRow[];
}

export async function createTeamChannel(businessId: string, name: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_team_channel", { p_business_id: businessId, p_name: name });
  if (error) throw error;
  return data as string;
}

export async function postTeamMessage(channelId: string, body: string, parentMessageId: string | null = null): Promise<string> {
  const { data, error } = await supabase.rpc("post_team_message", { p_channel_id: channelId, p_body: body, p_parent_message_id: parentMessageId });
  if (error) throw error;
  return data as string;
}
