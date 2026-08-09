// Programme Stage I — Shared Production Studio data access.

import { supabase, invokeFn } from "./supabase";
import type {
  ProductionJob,
  ContentItemAsset,
  ProductionReview,
  AssetPlanItem,
  RouteContentBriefResponse,
  SubmitProductionReviewResponse,
  ReviewDecision,
  QualityCheckType,
} from "@/types/production-studio";

export async function fetchProductionJobsForItem(contentItemId: string): Promise<ProductionJob[]> {
  const { data, error } = await supabase
    .from("production_jobs")
    .select("*")
    .eq("content_item_id", contentItemId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProductionJob[];
}

export async function fetchAssetsForJob(productionJobId: string): Promise<ContentItemAsset[]> {
  const { data, error } = await supabase
    .from("content_item_assets")
    .select("*")
    .eq("production_job_id", productionJobId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ContentItemAsset[];
}

/** Programme Stage 1B-C — every current asset for a Content Item, across all its production jobs, for the Facebook Rendition media picker. */
export async function fetchAssetsForItem(contentItemId: string): Promise<ContentItemAsset[]> {
  const { data, error } = await supabase
    .from("content_item_assets")
    .select("*")
    .eq("content_item_id", contentItemId)
    .eq("is_current", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ContentItemAsset[];
}

export async function fetchReviewsForJob(productionJobId: string): Promise<ProductionReview[]> {
  const { data, error } = await supabase
    .from("production_reviews")
    .select("*")
    .eq("production_job_id", productionJobId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProductionReview[];
}

export async function routeContentBriefToStudio(input: {
  clientId: string;
  contentBriefId: string;
  assetPlan?: AssetPlanItem[];
}): Promise<RouteContentBriefResponse> {
  return await invokeFn<RouteContentBriefResponse>("route-content-brief-to-studio", {
    client_id: input.clientId,
    content_brief_id: input.contentBriefId,
    asset_plan: input.assetPlan,
  });
}

export async function submitProductionReview(input: {
  clientId: string;
  productionJobId: string;
  contentItemAssetId?: string;
  decision: ReviewDecision;
  notes?: string;
  manualChecks?: { check: QualityCheckType; passed: boolean; detail?: string }[];
}): Promise<SubmitProductionReviewResponse> {
  return await invokeFn<SubmitProductionReviewResponse>("submit-production-review", {
    client_id: input.clientId,
    production_job_id: input.productionJobId,
    content_item_asset_id: input.contentItemAssetId,
    decision: input.decision,
    notes: input.notes,
    manual_checks: input.manualChecks,
  });
}
