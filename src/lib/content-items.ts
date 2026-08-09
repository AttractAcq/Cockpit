// Programme Stage H — Content Item and Brief data access.

import { supabase, invokeFn } from "./supabase";
import type {
  ContentItem,
  ContentBrief,
  ReviewBriefAction,
  GenerateContentBriefResponse,
  ReviewContentBriefResponse,
  ContentItemRendition,
  RenditionFormat,
  RenditionPlatform,
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

// ── Programme Stage 1B-C: Facebook Renditions ─────────────────────────────

export async function fetchRenditionsForItem(contentItemId: string): Promise<ContentItemRendition[]> {
  const { data, error } = await supabase
    .from("content_item_renditions")
    .select("*")
    .eq("content_item_id", contentItemId)
    .order("platform", { ascending: true })
    .order("rendition_version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ContentItemRendition[];
}

export async function createFacebookRendition(input: {
  clientId: string; contentItemId: string; format: RenditionFormat; platform?: RenditionPlatform;
  copy?: string; cta?: string; media?: string[]; schedulingGuidance?: Record<string, unknown>;
}): Promise<{ ok: true; rendition: ContentItemRendition }> {
  return await invokeFn("create-facebook-rendition", {
    client_id: input.clientId, content_item_id: input.contentItemId, platform: input.platform ?? "facebook",
    format: input.format, copy: input.copy, cta: input.cta, media: input.media, scheduling_guidance: input.schedulingGuidance,
  });
}

export async function updateFacebookRendition(input: {
  clientId: string; renditionId: string; copy?: string; cta?: string; media?: string[]; schedulingGuidance?: Record<string, unknown>;
}): Promise<{ ok: true; rendition: ContentItemRendition }> {
  return await invokeFn("update-facebook-rendition", {
    client_id: input.clientId, rendition_id: input.renditionId,
    copy: input.copy, cta: input.cta, media: input.media, scheduling_guidance: input.schedulingGuidance,
  });
}

export async function reviewFacebookRendition(input: {
  clientId: string; renditionId: string; action: "submit_for_review" | "approve" | "request_changes"; changeRequestNotes?: string;
}): Promise<{ ok: true; rendition: ContentItemRendition }> {
  return await invokeFn("review-facebook-rendition", {
    client_id: input.clientId, rendition_id: input.renditionId, action: input.action, change_request_notes: input.changeRequestNotes,
  });
}

// ── Programme Stage 1B-D: send an approved Rendition to Distribution ──────

export async function createDistributionRecordFromFacebookRendition(input: {
  clientId: string; renditionId: string; destinationAccountId: string;
  trackingUrl?: string; campaignReference?: string; scheduledPublishAt?: string;
}): Promise<{ ok: true; idempotent_replay: boolean; record: Record<string, unknown> }> {
  return await invokeFn("create-distribution-record-from-facebook-rendition", {
    client_id: input.clientId, rendition_id: input.renditionId, destination_account_id: input.destinationAccountId,
    tracking_url: input.trackingUrl, campaign_reference: input.campaignReference, scheduled_publish_at: input.scheduledPublishAt,
  });
}
