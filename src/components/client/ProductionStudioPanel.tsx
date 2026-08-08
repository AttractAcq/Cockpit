// Programme Stage I — operator surface for the Shared Production Studio:
// route an approved Content Brief into its studio, then track the resulting
// Production Job's Assets and Reviews. Actual per-studio asset generation
// is not built here — see docs/programme/status/Stage_I_Status.md.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchContentItems, fetchContentBriefsForItem } from "@/lib/content-items";
import {
  fetchProductionJobsForItem,
  fetchAssetsForJob,
  fetchReviewsForJob,
  routeContentBriefToStudio,
  submitProductionReview,
} from "@/lib/production-studio";
import { STUDIO_LABEL, type StudioCapability } from "@/types/production-studio";
import { createDistributionRecordFromContentItem } from "@/lib/distribution-policy";
import type { CanonicalAssetFormat } from "@/types/distribution-policy";
import type { ContentItem, ContentBrief } from "@/types/content-brief";
import type { ProductionJob, ContentItemAsset, ProductionReview, ReviewDecision } from "@/types/production-studio";

const STUDIO_TO_ASSET_FORMAT: Record<StudioCapability, CanonicalAssetFormat> = {
  reel_studio: "reel_video",
  carousel_studio: "carousel",
  story_studio: "story_sequence", // overridden to story_video below when the deliverable is a video
  feed_post_studio: "feed_post",
  ad_studio: "ad_static",
};

type Notice = { kind: "success" | "error" | "info"; text: string } | null;

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const v = error as { message?: string; code?: string };
    return [v.message, v.code && `Code: ${v.code}`].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

const JOB_STATUS_COLOR: Record<string, string> = {
  pending: "text-paper-3",
  running: "text-warn",
  retryable: "text-warn",
  failed: "text-neg",
  completed: "text-teal",
  cancelled: "text-paper-3",
};

interface Props {
  clientId: string;
}

export function ProductionStudioPanel({ clientId }: Props) {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [items, setItems] = useState<ContentItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<ContentBrief[]>([]);
  const [jobs, setJobs] = useState<ProductionJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [assets, setAssets] = useState<ContentItemAsset[]>([]);
  const [reviews, setReviews] = useState<ProductionReview[]>([]);
  const [distributeCaption, setDistributeCaption] = useState("");

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchContentItems(clientId));
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const loadItemDetail = useCallback(async (itemId: string) => {
    try {
      const [briefRows, jobRows] = await Promise.all([
        fetchContentBriefsForItem(itemId),
        fetchProductionJobsForItem(itemId),
      ]);
      setBriefs(briefRows);
      setJobs(jobRows);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    setSelectedJobId(null);
    setAssets([]);
    setReviews([]);
    if (selectedItemId) loadItemDetail(selectedItemId);
  }, [selectedItemId, loadItemDetail]);

  const loadJobDetail = useCallback(async (jobId: string) => {
    try {
      const [assetRows, reviewRows] = await Promise.all([
        fetchAssetsForJob(jobId),
        fetchReviewsForJob(jobId),
      ]);
      setAssets(assetRows);
      setReviews(reviewRows);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    }
  }, []);

  useEffect(() => { if (selectedJobId) loadJobDetail(selectedJobId); }, [selectedJobId, loadJobDetail]);

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;
  const approvedBrief = briefs.find((b) => b.status === "approved") ?? null;
  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;

  const handleRoute = useCallback(async () => {
    if (!approvedBrief) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await routeContentBriefToStudio({ clientId, contentBriefId: approvedBrief.id });
      setNotice({
        kind: "success",
        text: result.idempotent_replay
          ? `Already routed to ${STUDIO_LABEL[result.studio]}.`
          : `Routed to ${STUDIO_LABEL[result.studio]}.`,
      });
      if (selectedItemId) await loadItemDetail(selectedItemId);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }, [clientId, approvedBrief, selectedItemId, loadItemDetail]);

  const handleReview = useCallback(async (decision: ReviewDecision) => {
    if (!selectedJobId) return;
    setBusy(true);
    setNotice(null);
    try {
      await submitProductionReview({ clientId, productionJobId: selectedJobId, decision });
      setNotice({ kind: "success", text: `Review recorded: ${decision.replace(/_/g, " ")}.` });
      await loadJobDetail(selectedJobId);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }, [clientId, selectedJobId, loadJobDetail]);

  // Only image-backed deliverables can be distributed from here: Reel/Story
  // video distribution requires a Reel Studio video_project_deliverable
  // (the approved final edit), which the Production Studio's own
  // content_item_assets path does not produce — see Stage I/J status
  // reports. Distributing a video goes through Reel Studio's own flow.
  function canDistributeFromHere(job: ProductionJob, asset: ContentItemAsset): boolean {
    if (job.capability === "reel_studio") return false;
    if (job.capability === "story_studio" && (asset.mime_type ?? "").startsWith("video/")) return false;
    return asset.kind === "deliverable" && asset.is_current;
  }

  const handleDistribute = useCallback(async (job: ProductionJob, asset: ContentItemAsset) => {
    if (!selectedItemId) return;
    setBusy(true);
    setNotice(null);
    try {
      const assetFormat: CanonicalAssetFormat = STUDIO_TO_ASSET_FORMAT[job.capability];
      const result = await createDistributionRecordFromContentItem({
        clientId,
        contentItemId: selectedItemId,
        assetFormat,
        contentItemAssetId: asset.id,
        caption: distributeCaption,
      });
      setNotice({
        kind: "success",
        text: result.idempotent_replay
          ? "A distribution record already exists for this Content Item."
          : `Distribution record created (${assetFormat.replace(/_/g, " ")}, status ${result.record.publish_status}).`,
      });
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }, [clientId, selectedItemId, distributeCaption]);

  return (
    <div className="flex gap-6">
      <div className="w-64 flex-none">
        {loading && <p className="text-xs text-paper-3">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="text-xs text-paper-3">No Content Items yet.</p>
        )}
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setSelectedItemId(item.id)}
            className={`block w-full border-b border-line px-2 py-2 text-left text-xs ${selectedItemId === item.id ? "text-teal" : "text-paper hover:text-teal"}`}
          >
            {item.title}
          </button>
        ))}
      </div>

      <div className="flex-1">
        {notice && (
          <p className={`mb-3 text-2xs ${notice.kind === "error" ? "text-neg" : notice.kind === "success" ? "text-teal" : "text-paper-3"}`}>
            {notice.text}
          </p>
        )}

        {!selectedItem && <p className="text-xs text-paper-3">Select a Content Item.</p>}

        {selectedItem && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm text-paper">{selectedItem.title}</h3>
              {approvedBrief ? (
                <Button variant="secondary" size="sm" disabled={busy} onClick={handleRoute}>
                  Route approved Brief to studio
                </Button>
              ) : (
                <span className="text-2xs text-paper-3">No approved Brief to route yet.</span>
              )}
            </div>

            {jobs.length === 0 && <p className="text-xs text-paper-3">No Production Jobs yet.</p>}

            {jobs.length > 0 && (
              <div className="flex gap-6">
                <div className="w-56 flex-none border-r border-line pr-4">
                  {jobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={`block w-full border-b border-line py-2 text-left text-xs ${selectedJobId === job.id ? "text-teal" : "text-paper hover:text-teal"}`}
                    >
                      {STUDIO_LABEL[job.capability]}
                      <span className={`ml-2 text-2xs ${JOB_STATUS_COLOR[job.status]}`}>{job.status}</span>
                    </button>
                  ))}
                </div>

                <div className="flex-1">
                  {!selectedJob && <p className="text-xs text-paper-3">Select a Production Job.</p>}

                  {selectedJob && (
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-2xs text-paper-3">Mode: {selectedJob.production_mode ?? "unset"}</span>
                        <span className="text-2xs text-paper-3">Attempts: {selectedJob.attempt_count}/{selectedJob.maximum_attempts}</span>
                        {selectedJob.failure_message && (
                          <span className="text-2xs text-neg">{selectedJob.failure_message}</span>
                        )}
                      </div>

                      <h4 className="mb-1 text-xs text-paper">Assets ({assets.length})</h4>
                      {assets.length === 0 && (
                        <p className="mb-3 text-2xs text-paper-3">
                          No Assets yet — per-studio generation is not wired to this Job yet.
                        </p>
                      )}
                      {assets.length > 0 && (
                        <input
                          className="mb-2 w-full rounded border border-line bg-ink px-2 py-1 text-2xs text-paper outline-none focus:border-teal/50"
                          placeholder="Caption for distribution (optional)"
                          value={distributeCaption}
                          onChange={(e) => setDistributeCaption(e.target.value)}
                        />
                      )}
                      {assets.map((asset) => (
                        <div key={asset.id} className="mb-1 flex flex-wrap items-center gap-2 text-2xs text-paper-2">
                          <span>{asset.kind}</span>
                          <span className="text-paper-3">v{asset.version}</span>
                          {asset.is_current && <span className="text-teal">current</span>}
                          {asset.storage_path && <span className="text-paper-3">{asset.storage_path}</span>}
                          {canDistributeFromHere(selectedJob, asset) && (
                            <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleDistribute(selectedJob, asset)}>
                              Distribute
                            </Button>
                          )}
                        </div>
                      ))}

                      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                        <Button variant="primary" size="sm" disabled={busy} onClick={() => handleReview("approved")}>
                          Approve
                        </Button>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleReview("changes_requested")}>
                          Request changes
                        </Button>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleReview("rejected")}>
                          Reject
                        </Button>
                      </div>

                      <h4 className="mb-1 mt-4 text-xs text-paper">Reviews ({reviews.length})</h4>
                      {reviews.map((review) => (
                        <div key={review.id} className="mb-2 border-b border-line pb-2 text-2xs">
                          <span className={review.decision === "approved" ? "text-teal" : review.decision === "rejected" ? "text-neg" : "text-warn"}>
                            {review.decision.replace(/_/g, " ")}
                          </span>
                          {review.quality_checks.length > 0 && (
                            <ul className="mt-1 list-inside list-disc text-paper-3">
                              {review.quality_checks.map((check, i) => (
                                <li key={i} className={check.passed ? "text-paper-3" : "text-neg"}>
                                  {check.check}: {check.passed ? "pass" : "fail"} — {check.detail}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
