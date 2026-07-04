import { useEffect, useState } from "react";
import { Button, EmptyState, Panel } from "@/components/primitives";
import {
  fetchClientExecutionFiles,
  fetchOrganicMasterRows,
  fetchStoryMasterRows,
  fetchAdsMasterRows,
  fetchProofMasterRows,
  fetchAssetBriefRows,
  fetchCalendarCells,
  updateReviewState,
  logActivity,
} from "@/lib/api";
import type { ReviewTable } from "@/lib/api";
import type { ReviewState } from "@/types/client";
import type {
  ClientExecutionFile,
  OrganicMasterRow,
  StoryMasterRow,
  AdsMasterRow,
  ProofMasterRow,
  AssetBriefRow,
  CalendarCellRow,
} from "@/types/phase";

const REVIEW_BADGE: Record<ReviewState, string> = {
  needs_review: "text-warn bg-warn/10 border border-warn/20",
  approved:     "text-teal bg-teal/10 border border-teal/20",
  rejected:     "text-neg bg-neg/10 border border-neg/20",
  archived:     "text-paper-3 bg-ink border border-line",
};

function ReviewBadge({ state }: { state: ReviewState }) {
  return (
    <span
      className={`text-2xs font-mono px-1.5 py-0.5 rounded ${REVIEW_BADGE[state]}`}
    >
      {state.replace("_", " ")}
    </span>
  );
}

interface RowProps {
  id: string;
  ref: string;
  review_state: ReviewState;
  statusLabel: string;
  title: string;
  table: ReviewTable;
  onUpdate: (table: ReviewTable, id: string, rs: ReviewState) => void;
  updating: boolean;
}

function MasterRow({ id, ref, review_state, statusLabel, title, table, onUpdate, updating }: RowProps) {
  return (
    <div className="px-4 py-2.5 border-b border-line last:border-b-0 flex items-center gap-3 flex-wrap">
      <span className="text-2xs font-mono text-teal w-28 shrink-0">{ref}</span>
      <span className="text-xs text-paper flex-1 min-w-0 truncate">{title || "—"}</span>
      <span className="text-2xs font-mono text-paper-3 shrink-0">{statusLabel}</span>
      <ReviewBadge state={review_state} />
      {review_state === "needs_review" && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="subtle"
            disabled={updating}
            onClick={() => onUpdate(table, id, "approved")}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={updating}
            onClick={() => onUpdate(table, id, "rejected")}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}

export function Stage2Panel({
  clientId,
  executionMonth,
}: {
  clientId: string;
  executionMonth: string;
}) {
  const [execFiles, setExecFiles] = useState<ClientExecutionFile[]>([]);
  const [organic, setOrganic]     = useState<OrganicMasterRow[]>([]);
  const [story, setStory]         = useState<StoryMasterRow[]>([]);
  const [ads, setAds]             = useState<AdsMasterRow[]>([]);
  const [proof, setProof]         = useState<ProofMasterRow[]>([]);
  const [briefs, setBriefs]       = useState<AssetBriefRow[]>([]);
  const [cells, setCells]         = useState<CalendarCellRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [updating, setUpdating]   = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchClientExecutionFiles(clientId, executionMonth),
      fetchOrganicMasterRows(clientId, executionMonth),
      fetchStoryMasterRows(clientId, executionMonth),
      fetchAdsMasterRows(clientId, executionMonth),
      fetchProofMasterRows(clientId, executionMonth),
      fetchAssetBriefRows(clientId, executionMonth),
      fetchCalendarCells(clientId, executionMonth),
    ])
      .then(([ef, om, sm, am, pm, bi, cc]) => {
        setExecFiles(ef);
        setOrganic(om);
        setStory(sm);
        setAds(am);
        setProof(pm);
        setBriefs(bi);
        setCells(cc);
      })
      .finally(() => setLoading(false));
  }, [clientId, executionMonth]);

  async function handleUpdate(table: ReviewTable, id: string, rs: ReviewState) {
    setUpdating(true);
    try {
      await updateReviewState(table, id, rs);
      await logActivity(
        clientId,
        rs === "approved" ? "draft_row_approved" : "draft_row_rejected",
        `${rs === "approved" ? "Approved" : "Rejected"} draft row in ${table}.`,
        { table, row_id: id }
      );
      // Refresh the changed table
      if (table === "organic_master")
        setOrganic(await fetchOrganicMasterRows(clientId, executionMonth));
      if (table === "story_master")
        setStory(await fetchStoryMasterRows(clientId, executionMonth));
      if (table === "ads_master")
        setAds(await fetchAdsMasterRows(clientId, executionMonth));
      if (table === "proof_master")
        setProof(await fetchProofMasterRows(clientId, executionMonth));
      if (table === "asset_brief_index")
        setBriefs(await fetchAssetBriefRows(clientId, executionMonth));
    } finally {
      setUpdating(false);
    }
  }

  if (loading)
    return (
      <div className="p-6 text-paper-3 text-xs">Loading Stage 2 data…</div>
    );

  const totalRows =
    organic.length + story.length + ads.length + proof.length + briefs.length;

  if (totalRows === 0 && execFiles.length === 0 && cells.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <EmptyState
          icon="calendar"
          title="No Stage 2 data for this month"
          body="Run Phase 2 after Phase 1 context files exist. Draft rows will appear here as needs_review and require approval before anything goes live."
        />
      </div>
    );
  }

  const needsReview = [
    ...organic.map((r) => r.review_state),
    ...story.map((r) => r.review_state),
    ...ads.map((r) => r.review_state),
    ...proof.map((r) => r.review_state),
    ...briefs.map((r) => r.status),
  ].filter((s) => s === "needs_review").length;

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {/* Summary banner */}
      <div className="bg-ink-200 border border-line rounded-[10px] px-4 py-3 flex items-center gap-4 flex-wrap">
        <span className="text-xs font-mono text-paper">{executionMonth}</span>
        <span className="text-2xs font-mono text-paper-3">
          {totalRows} master rows · {cells.length} calendar cells
        </span>
        {needsReview > 0 && (
          <span className="text-2xs font-mono text-warn">
            {needsReview} need review
          </span>
        )}
        <span className="text-2xs font-mono text-teal ml-auto">
          {totalRows - needsReview} approved / other
        </span>
      </div>

      {/* Execution files */}
      {execFiles.length > 0 && (
        <Panel title="Execution Files" meta={`${execFiles.length}`}>
          {execFiles.map((f) => (
            <div
              key={f.id}
              className="px-4 py-2.5 border-b border-line last:border-b-0 flex items-center gap-3"
            >
              <span className="text-xs text-paper flex-1">{f.file_name}</span>
              <span className="text-2xs font-mono text-paper-3">{f.status ?? "—"}</span>
              <ReviewBadge state={f.review_state} />
            </div>
          ))}
        </Panel>
      )}

      {/* Organic master */}
      {organic.length > 0 && (
        <Panel title="Organic Master" meta={`${organic.length}`}>
          {organic.map((r) => (
            <MasterRow
              key={r.id}
              id={r.id}
              ref={r.ref}
              review_state={r.review_state}
              statusLabel={r.status}
              title={r.working_title ?? r.content_type}
              table="organic_master"
              onUpdate={handleUpdate}
              updating={updating}
            />
          ))}
        </Panel>
      )}

      {/* Story master */}
      {story.length > 0 && (
        <Panel title="Story Master" meta={`${story.length}`}>
          {story.map((r) => (
            <MasterRow
              key={r.id}
              id={r.id}
              ref={r.ref}
              review_state={r.review_state}
              statusLabel={r.status}
              title={r.story_theme ?? r.story_type ?? "—"}
              table="story_master"
              onUpdate={handleUpdate}
              updating={updating}
            />
          ))}
        </Panel>
      )}

      {/* Ads master */}
      {ads.length > 0 && (
        <Panel title="Ads Master" meta={`${ads.length}`}>
          {ads.map((r) => (
            <MasterRow
              key={r.id}
              id={r.id}
              ref={r.ref}
              review_state={r.review_state}
              statusLabel={r.status}
              title={r.stint_name ?? "—"}
              table="ads_master"
              onUpdate={handleUpdate}
              updating={updating}
            />
          ))}
        </Panel>
      )}

      {/* Proof master */}
      {proof.length > 0 && (
        <Panel title="Proof Master" meta={`${proof.length}`}>
          {proof.map((r) => (
            <MasterRow
              key={r.id}
              id={r.id}
              ref={r.ref}
              review_state={r.review_state}
              statusLabel={r.status}
              title={r.proof_asset_name ?? r.proof_type ?? "—"}
              table="proof_master"
              onUpdate={handleUpdate}
              updating={updating}
            />
          ))}
        </Panel>
      )}

      {/* Asset Brief Index */}
      {briefs.length > 0 && (
        <Panel title="Asset Brief Index" meta={`${briefs.length}`}>
          {briefs.map((r) => (
            <MasterRow
              key={r.id}
              id={r.id}
              ref={r.brief_id}
              review_state={r.status}
              statusLabel={r.production_status}
              title={`${r.source_ref} · ${r.asset_type ?? r.source_ref_type}`}
              table="asset_brief_index"
              onUpdate={handleUpdate}
              updating={updating}
            />
          ))}
        </Panel>
      )}

      {/* Calendar cells */}
      {cells.length > 0 && (
        <Panel title="Calendar Cells" meta={`${cells.length}`}>
          {cells.slice(0, 30).map((c) => (
            <div
              key={c.id}
              className="px-4 py-2 border-b border-line last:border-b-0 flex items-center gap-3"
            >
              <span className="text-2xs font-mono text-paper-3 w-20 shrink-0">
                {c.date}
              </span>
              <span className="text-2xs font-mono text-paper-3 w-20 shrink-0">
                {c.row_type}
              </span>
              <span className="text-xs font-mono text-teal flex-1">{c.ref}</span>
              <ReviewBadge state={c.review_state} />
            </div>
          ))}
          {cells.length > 30 && (
            <div className="px-4 py-2 text-2xs text-paper-3">
              … and {cells.length - 30} more cells
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
