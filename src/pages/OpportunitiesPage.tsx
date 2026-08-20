// Stage 2 Phase 11 — Opportunity OS. A specialist "what opportunities exist"
// report: every finding, across every client, human-reviewed only. Built
// ahead of the phase's own stated prerequisite on Alex's explicit override
// (see the migration header) -- findings will be sparse until Finance/Sales
// have real reconciled history behind them. Nothing here auto-acts; running
// detection and reviewing a finding are both explicit staff actions.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, Panel, Tag } from "@/components/primitives";
import { fetchOpportunityFindings, runOpportunityDetection, reviewOpportunityFinding } from "@/lib/opportunity";
import { fetchClients } from "@/lib/api";
import type { OpportunityFindingRow, OpportunityFindingStatus, OpportunityFindingType } from "@/types/opportunity";
import type { Client } from "@/types/client";
import { fmtRelative } from "@/lib/format";

const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";

const TYPE_LABEL: Record<OpportunityFindingType, string> = {
  margin_risk: "Margin Risk", stalled_lead: "Stalled Lead", underperforming_channel: "Underperforming Channel",
};
const STATUS_LABEL: Record<OpportunityFindingStatus, string> = {
  pending_review: "Pending Review", confirmed_useful: "Confirmed Useful", dismissed: "Dismissed",
};
const STATUS_TAG: Record<OpportunityFindingStatus, "decision" | "approve" | "muted"> = {
  pending_review: "decision", confirmed_useful: "approve", dismissed: "muted",
};

export function OpportunitiesPage() {
  const [findings, setFindings] = useState<OpportunityFindingRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<OpportunityFindingStatus | "">("pending_review");
  const [detectClientId, setDetectClientId] = useState("");
  const [notesByFinding, setNotesByFinding] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [f, c] = await Promise.all([fetchOpportunityFindings(), fetchClients()]);
      setFindings(f); setClients(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;

  const visible = useMemo(() => findings.filter((f) =>
    (!clientFilter || f.client_id === clientFilter) && (!statusFilter || f.status === statusFilter)
  ), [findings, clientFilter, statusFilter]);

  async function runDetection() {
    if (!detectClientId) return;
    setBusy("detect"); setError(null);
    try {
      await runOpportunityDetection(detectClientId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function review(findingId: string, status: "confirmed_useful" | "dismissed") {
    setBusy(findingId); setError(null);
    try {
      await reviewOpportunityFinding(findingId, status, notesByFinding[findingId]?.trim() || null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">Loading…</div>;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium text-paper">Opportunities</h1>
        <span className="text-2xs text-paper-3 font-mono">{visible.length} of {findings.length}</span>
      </div>
      {error && <p className="text-2xs text-neg">{error}</p>}
      <p className="text-2xs text-paper-3">
        A human-reviewed report over real Finance, Sales and Marketing data — never a black box: every finding cites its exact source rows.
        Nothing here triggers automatically; reviewing a finding is the only thing that closes it out.
      </p>

      <div className="flex flex-wrap items-end gap-2 rounded-[10px] border border-line bg-ink-200 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-paper-3">Run detection for</span>
          <select className={field} value={detectClientId} onChange={(e) => setDetectClientId(e.target.value)}>
            <option value="">Select a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <Button size="sm" variant="primary" disabled={busy === "detect" || !detectClientId} onClick={() => void runDetection()}>
          {busy === "detect" ? "Running…" : "Run detection"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={field} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={field} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as OpportunityFindingStatus | "")}>
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as OpportunityFindingStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      <Panel title="Findings" meta={`${visible.length}`}>
        {visible.length === 0 ? (
          <EmptyState
            icon="alert-circle"
            title="No findings"
            body="Run detection for a client above. Findings will be sparse until Finance and Sales have real reconciled history behind them — that's expected, not a bug."
          />
        ) : (
          <div className="space-y-1 p-2">
            {visible.map((f) => (
              <div key={f.id} className="rounded border border-line bg-ink p-3 text-2xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono uppercase text-info">{TYPE_LABEL[f.finding_type]}</span>
                  <span className="text-paper font-medium">{f.title}</span>
                  <Tag kind={STATUS_TAG[f.status]}>{STATUS_LABEL[f.status]}</Tag>
                  <span className="text-paper-3 ml-auto">{clientName(f.client_id)}</span>
                  <span className="text-paper-3 font-mono">score {f.score}</span>
                  <span className="text-paper-3 font-mono">{fmtRelative(f.generated_at)}</span>
                </div>
                <p className="text-paper-2 mt-2">{f.explanation}</p>
                {f.status === "pending_review" ? (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <input
                      className={`${field} flex-1 min-w-[160px]`}
                      placeholder="Review notes (optional)"
                      value={notesByFinding[f.id] ?? ""}
                      onChange={(e) => setNotesByFinding({ ...notesByFinding, [f.id]: e.target.value })}
                    />
                    <Button size="sm" variant="primary" disabled={busy === f.id} onClick={() => void review(f.id, "confirmed_useful")}>Confirm useful</Button>
                    <Button size="sm" disabled={busy === f.id} onClick={() => void review(f.id, "dismissed")}>Dismiss</Button>
                  </div>
                ) : (
                  <p className="text-paper-3 mt-2">
                    {STATUS_LABEL[f.status]}{f.reviewed_at ? ` — ${fmtRelative(f.reviewed_at)}` : ""}{f.review_notes ? `: "${f.review_notes}"` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
