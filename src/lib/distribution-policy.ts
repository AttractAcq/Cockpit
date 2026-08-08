// Programme Stage K — Organic Distribution Consolidation data access.

import { supabase, invokeFn } from "./supabase";
import type { ClientDistributionPolicyRow, ApprovalMode, BlackoutPeriod, CanonicalAssetFormat } from "@/types/distribution-policy";
import type { DistributionRecordRow } from "@/types/phase";

export async function fetchClientDistributionPolicy(clientId: string): Promise<ClientDistributionPolicyRow | null> {
  const { data, error } = await supabase.from("client_distribution_policies").select("*").eq("client_id", clientId).maybeSingle();
  if (error) throw error;
  return (data as ClientDistributionPolicyRow | null) ?? null;
}

export async function setClientDistributionPolicy(input: {
  clientId: string;
  approvalMode: ApprovalMode;
  autoScheduleAfterApproval: boolean;
  manualPublishOnly: boolean;
  blackoutPeriods: BlackoutPeriod[];
  restrictedWeekdays: number[];
}): Promise<{ ok: true; policy: ClientDistributionPolicyRow }> {
  return await invokeFn("set-client-distribution-policy", {
    client_id: input.clientId,
    approval_mode: input.approvalMode,
    auto_schedule_after_approval: input.autoScheduleAfterApproval,
    manual_publish_only: input.manualPublishOnly,
    blackout_periods: input.blackoutPeriods,
    restricted_weekdays: input.restrictedWeekdays,
  });
}

export interface CreateDistributionRecordResult {
  ok: true;
  idempotent_replay: boolean;
  record: DistributionRecordRow;
}

export async function createDistributionRecordFromContentItem(input: {
  clientId: string;
  contentItemId: string;
  assetFormat: CanonicalAssetFormat;
  contentItemAssetId?: string;
  videoProjectDeliverableId?: string;
  platform?: string;
  destination?: string;
  caption?: string;
  hashtags?: string[];
  cta?: string;
  trackingUrl?: string;
  campaignReference?: string;
  scheduledPublishAt?: string;
}): Promise<CreateDistributionRecordResult> {
  return await invokeFn("create-distribution-record-from-content-item", {
    client_id: input.clientId,
    content_item_id: input.contentItemId,
    asset_format: input.assetFormat,
    content_item_asset_id: input.contentItemAssetId,
    video_project_deliverable_id: input.videoProjectDeliverableId,
    platform: input.platform,
    destination: input.destination,
    caption: input.caption,
    hashtags: input.hashtags,
    cta: input.cta,
    tracking_url: input.trackingUrl,
    campaign_reference: input.campaignReference,
    scheduled_publish_at: input.scheduledPublishAt,
  });
}
