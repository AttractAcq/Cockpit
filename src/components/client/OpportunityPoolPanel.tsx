// Programme Stage F — operator surface for the Content Opportunity pool.
//
// Generates Opportunities from existing content_sources, shows the
// explainable score breakdown per Opportunity, and exposes the human-control
// actions that move an Opportunity through its canonical status workflow.
// This panel never writes to the Calendar, Content Items or production —
// Opportunities remain advisory until Stage G selects one into a slot.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import {
  OPPORTUNITY_STATUS_LABEL,
  fetchOpportunityPool,
  fetchOpportunityScoreHistory,
  fetchSupplySources,
  generateOpportunitiesFromSource,
  scoreOpportunity,
  updateOpportunityStatus,
  type SupplySourceRow,
} from "@/lib/supply";
import { OPPORTUNITY_SCORE_DIMENSIONS } from "@/types/content-opportunity-scoring";
import type { ContentOpportunityScore } from "@/types/content-opportunity-scoring";
import type { ContentOpportunity, ContentOpportunityStatus } from "@/types/content-spine";

type Notice = { kind: "success" | "error" | "info"; text: string } | null;

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const v = error as { message?: string; code?: string };
    return [v.message, v.code && `Code: ${v.code}`].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

const STATUS_FILTERS: Array<{ key: ContentOpportunityStatus | "active"; label: string }> = [
  { key: "active", label: "Active" },
  { key: "draft", label: "Draft" },
  { key: "needs_review", label: "Needs review" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "selected", label: "Selected" },
  { key: "rejected", label: "Rejected" },
  { key: "expired", label: "Expired" },
];

const STATUS_COLOR: Record<ContentOpportunityStatus, string> = {
  draft: "text-paper-3",
  needs_review: "text-warn",
  shortlisted: "text-teal",
  selected: "text-teal",
  scheduled: "text-teal",
  produced: "text-teal",
  rejected: "text-neg",
  expired: "text-paper-3",
};

interface Props {
  clientId: string;
}

export function OpportunityPoolPanel({ clientId }: Props) {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [opportunities, setOpportunities] = useState<ContentOpportunity[]>([]);
  const [sources, setSources] = useState<SupplySourceRow[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ContentOpportunityStatus | "active">("active");
  const [selectedSourceId, setSelectedSourceId] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scoreHistory, setScoreHistory] = useState<Record<string, ContentOpportunityScore[]>>({});
  const [mergeTargetInput, setMergeTargetInput] = useState<Record<string, string>>({});
  const [rejectReasonInput, setRejectReasonInput] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [opps, srcs] = await Promise.all([
        fetchOpportunityPool(clientId, {
          statuses: statusFilter === "active" ? undefined : [statusFilter],
          activeOnly: statusFilter === "active",
          search,
        }),
        fetchSupplySources(clientId),
      ]);
      setOpportunities(opps);
      setSources(srcs);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setLoading(false);
    }
  }, [clientId, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const eligibleSources = useMemo(
    () => sources.filter((s) => (s.raw_content ?? "").trim().length > 0),
    [sources],
  );

  const runAction = useCallback(async (fn: () => Promise<unknown>, successText: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice({ kind: "success", text: successText });
      await load();
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const handleGenerate = useCallback(async () => {
    if (!selectedSourceId) {
      setNotice({ kind: "error", text: "Choose a source first." });
      return;
    }
    await runAction(
      () => generateOpportunitiesFromSource({ clientId, sourceId: selectedSourceId }),
      "Generation complete.",
    );
  }, [clientId, selectedSourceId, runAction]);

  const handleScore = useCallback((opportunityId: string) => {
    void runAction(
      () => scoreOpportunity({ clientId, opportunityId }),
      "Scored.",
    );
  }, [clientId, runAction]);

  const toggleExpand = useCallback(async (opportunityId: string) => {
    if (expandedId === opportunityId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(opportunityId);
    if (!scoreHistory[opportunityId]) {
      try {
        const history = await fetchOpportunityScoreHistory(opportunityId);
        setScoreHistory((prev) => ({ ...prev, [opportunityId]: history }));
      } catch (e) {
        setNotice({ kind: "error", text: errorMessage(e) });
      }
    }
  }, [expandedId, scoreHistory]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-2xs uppercase tracking-wide text-paper-3">Generate from source</label>
          <div className="flex gap-2">
            <select
              className="rounded border border-line bg-transparent px-2 py-1 text-xs text-paper"
              value={selectedSourceId}
              onChange={(e) => setSelectedSourceId(e.target.value)}
            >
              <option value="">Choose a source…</option>
              {eligibleSources.map((s) => (
                <option key={s.id} value={s.id}>{s.source_kind} — {s.title.slice(0, 60)}</option>
              ))}
            </select>
            <Button variant="primary" size="sm" disabled={busy || !selectedSourceId} onClick={handleGenerate}>
              Generate
            </Button>
          </div>
        </div>

        <div className="ml-auto">
          <label className="mb-1 block text-2xs uppercase tracking-wide text-paper-3">Search</label>
          <input
            className="rounded border border-line bg-transparent px-2 py-1 text-xs text-paper"
            placeholder="Title, claim, audience…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`rounded border px-2 py-1 text-2xs transition-colors ${
              statusFilter === f.key
                ? "border-teal text-teal"
                : "border-line text-paper-3 hover:text-paper"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {notice && (
        <p className={`mb-3 text-2xs ${notice.kind === "error" ? "text-neg" : notice.kind === "success" ? "text-teal" : "text-paper-3"}`}>
          {notice.text}
        </p>
      )}

      {loading && <p className="text-xs text-paper-3">Loading…</p>}
      {!loading && opportunities.length === 0 && (
        <p className="text-xs text-paper-3">No Opportunities in this view yet.</p>
      )}

      {opportunities.map((opp) => {
        const isExpanded = expandedId === opp.id;
        const latestScore = scoreHistory[opp.id]?.[0];
        return (
          <div key={opp.id} className="border-b border-line py-3 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => toggleExpand(opp.id)} className="text-left text-xs text-paper hover:text-teal">
                {opp.title}
              </button>
              <span className={`text-2xs ${STATUS_COLOR[opp.status]}`}>{OPPORTUNITY_STATUS_LABEL[opp.status]}</span>
              <span className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">{opp.origin}</span>
              {opp.generated_by === "ai" && (
                <span className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">AI-generated</span>
              )}
              {opp.eligibility_status === "ineligible" && (
                <span className="text-2xs text-neg">ineligible: {opp.eligibility_reason}</span>
              )}
              {opp.duplicate_of_opportunity_id && (
                <span className="text-2xs text-warn">possible duplicate ({opp.dedup_reason})</span>
              )}
              <span className="ml-auto font-mono text-2xs text-paper-3">
                {opp.score !== null ? `${Number(opp.score).toFixed(1)}/100` : "unscored"}
              </span>
            </div>

            {isExpanded && (
              <div className="mt-3 space-y-3 rounded border border-line p-3">
                {opp.core_claim && <p className="text-xs text-paper"><span className="text-paper-3">Core claim: </span>{opp.core_claim}</p>}
                {opp.audience && <p className="text-xs text-paper"><span className="text-paper-3">Audience: </span>{opp.audience}</p>}
                {opp.hook_direction && <p className="text-xs text-paper"><span className="text-paper-3">Hook: </span>{opp.hook_direction}</p>}
                {opp.rationale && <p className="text-xs text-paper-2">{opp.rationale}</p>}
                {(opp.candidate_formats.length > 0 || opp.candidate_channels.length > 0) && (
                  <p className="text-2xs text-paper-3">
                    {opp.candidate_formats.join(", ")} {opp.candidate_channels.length > 0 && `· ${opp.candidate_channels.join(", ")}`}
                  </p>
                )}

                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-2xs uppercase tracking-wide text-paper-3">Score</span>
                    <Button variant="secondary" size="sm" disabled={busy || opp.eligibility_status === "ineligible"} onClick={() => handleScore(opp.id)}>
                      {latestScore ? "Re-score" : "Score"}
                    </Button>
                  </div>
                  {latestScore ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                      {OPPORTUNITY_SCORE_DIMENSIONS.map((d) => (
                        <div key={d.key} className="text-2xs text-paper-3">
                          {d.label}: <span className="font-mono text-paper">{Number(latestScore[d.key]).toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-2xs text-paper-3">Not yet scored.</p>
                  )}
                  {latestScore?.rationale && <p className="mt-1 text-2xs text-paper-3">{latestScore.rationale}</p>}
                  {scoreHistory[opp.id] && scoreHistory[opp.id].length > 1 && (
                    <p className="mt-1 text-2xs text-paper-3">{scoreHistory[opp.id].length} scoring runs recorded.</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                  <Button
                    variant="secondary" size="sm" disabled={busy}
                    onClick={() => runAction(() => updateOpportunityStatus({ clientId, opportunityId: opp.id, action: "shortlist" }), "Shortlisted.")}
                  >
                    Shortlist
                  </Button>
                  <Button
                    variant="secondary" size="sm" disabled={busy}
                    onClick={() => runAction(() => updateOpportunityStatus({ clientId, opportunityId: opp.id, action: "select_for_planning" }), "Selected for planning.")}
                  >
                    Select for planning
                  </Button>
                  <Button
                    variant="secondary" size="sm" disabled={busy}
                    onClick={() => {
                      const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                      runAction(() => updateOpportunityStatus({ clientId, opportunityId: opp.id, action: "save_for_later", newExpiresAt: in30 }), "Saved for later (+30 days).");
                    }}
                  >
                    Save for later
                  </Button>

                  <input
                    className="w-40 rounded border border-line bg-transparent px-2 py-1 text-2xs text-paper"
                    placeholder="Reject reason"
                    value={rejectReasonInput[opp.id] ?? ""}
                    onChange={(e) => setRejectReasonInput((prev) => ({ ...prev, [opp.id]: e.target.value }))}
                  />
                  <Button
                    variant="danger" size="sm" disabled={busy || !(rejectReasonInput[opp.id] ?? "").trim()}
                    onClick={() => runAction(() => updateOpportunityStatus({ clientId, opportunityId: opp.id, action: "reject", reason: rejectReasonInput[opp.id] }), "Rejected.")}
                  >
                    Reject
                  </Button>

                  <input
                    className="w-40 rounded border border-line bg-transparent px-2 py-1 text-2xs text-paper"
                    placeholder="Merge into opportunity id"
                    value={mergeTargetInput[opp.id] ?? (opp.duplicate_of_opportunity_id ?? "")}
                    onChange={(e) => setMergeTargetInput((prev) => ({ ...prev, [opp.id]: e.target.value }))}
                  />
                  <Button
                    variant="secondary" size="sm" disabled={busy || !(mergeTargetInput[opp.id] ?? opp.duplicate_of_opportunity_id ?? "").trim()}
                    onClick={() => runAction(() => updateOpportunityStatus({
                      clientId, opportunityId: opp.id, action: "merge",
                      mergeIntoOpportunityId: mergeTargetInput[opp.id] ?? opp.duplicate_of_opportunity_id ?? "",
                    }), "Merged.")}
                  >
                    Merge
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
