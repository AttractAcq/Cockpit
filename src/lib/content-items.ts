// Programme Stage H — Content Item and Brief data access.

import { supabase, invokeFn } from "./supabase";
import type {
  ContentItem,
  ContentBrief,
  ReviewBriefAction,
  GenerateContentBriefResponse,
  ReviewContentBriefResponse,
} from "@/types/content-brief";

export async function fetchContentItems(clientId: string): Promise<ContentItem[]> {
  const { data, error } = await supabase
    .from("content_items")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as ContentItem[];
}

export async function fetchContentBriefsForItem(contentItemId: string): Promise<ContentBrief[]> {
  const { data, error } = await supabase
    .from("content_briefs")
    .select("*")
    .eq("content_item_id", contentItemId)
    .order("brief_version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ContentBrief[];
}

export async function generateContentBrief(input: { clientId: string; contentItemId: string }): Promise<GenerateContentBriefResponse> {
  return await invokeFn<GenerateContentBriefResponse>("generate-content-brief", {
    client_id: input.clientId,
    content_item_id: input.contentItemId,
  });
}

export async function reviewContentBrief(input: {
  clientId: string;
  contentBriefId: string;
  action: ReviewBriefAction;
}): Promise<ReviewContentBriefResponse> {
  return await invokeFn<ReviewContentBriefResponse>("review-content-brief", {
    client_id: input.clientId,
    content_brief_id: input.contentBriefId,
    action: input.action,
  });
}
