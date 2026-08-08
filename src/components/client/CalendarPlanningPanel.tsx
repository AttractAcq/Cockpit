// Programme Stage G — operator surface for Calendar Planning: generate an
// assisted proposal, review/edit slot assignments, and approve to commit
// into canonical Content Items. Nothing here writes Content Items directly —
// only approveCalendarProposal (via the atomic commit RPC) does that.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import {
  fetchCalendarProposals,
  fetchProposalSlots,
  createCalendarProposal,
  updateCalendarProposalSlot,
  approveCalendarProposal,
} from "@/lib/calendar-planning";
import { supabase } from "@/lib/supabase";
import {
  PROPOSAL_CONFLICT_LABELS,
  type ContentCalendarProposal,
  type ContentCalendarProposalSlot,
  type CalendarProposalMode,
} from "@/types/calendar-planning";

type Notice = { kind: "success" | "error" | "info"; text: string } | null;

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const v = error as { message?: string; code?: string };
    return [v.message, v.code && `Code: ${v.code}`].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

interface Props {
  clientId: string;
}

export function CalendarPlanningPanel({ clientId }: Props) {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [proposals, setProposals] = useState<ContentCalendarProposal[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [slots, setSlots] = useState<ContentCalendarProposalSlot[]>([]);
  const [opportunityTitles, setOpportunityTitles] = useState<Record<string, string>>({});

  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [mode, setMode] = useState<CalendarProposalMode>("assisted");

  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});
  const [swapTarget, setSwapTarget] = useState<Record<string, string>>({});

  const loadProposals = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchCalendarProposals(clientId);
      setProposals(rows);
      if (!selectedProposalId && rows.length > 0) setSelectedProposalId(rows[0].id);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => { loadProposals(); }, [loadProposals]);

  const loadSlots = useCallback(async (proposalId: string) => {
    try {
      const rows = await fetchProposalSlots(proposalId);
      setSlots(rows);
      const oppIds = [...new Set(rows.map((r) => r.content_opportunity_id).filter((id): id is string => id !== null))];
      if (oppIds.length > 0) {
        const { data } = await supabase.from("content_opportunities").select("id, title").in("id", oppIds);
        const titles: Record<string, string> = {};
        for (const row of data ?? []) titles[row.id as string] = row.title as string;
        setOpportunityTitles(titles);
      }
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    }
  }, []);

  useEffect(() => { if (selectedProposalId) loadSlots(selectedProposalId); }, [selectedProposalId, loadSlots]);

  const selectedProposal = proposals.find((p) => p.id === selectedProposalId) ?? null;

  const handleGenerate = useCallback(async () => {
    if (!periodStart || !periodEnd) {
      setNotice({ kind: "error", text: "Set a period start and end first." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await createCalendarProposal({ clientId, periodStart, periodEnd, mode });
      setNotice({ kind: "success", text: `Proposal generated: ${result.assigned_count}/${result.slot_count} slots assigned.` });
      await loadProposals();
      setSelectedProposalId(result.proposal_id);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }, [clientId, periodStart, periodEnd, mode, loadProposals]);

  const runEdit = useCallback(async (action: "move" | "swap" | "remove" | "restore", args: { fromSlotId?: string; toSlotId?: string; slotId?: string }) => {
    if (!selectedProposal) return;
    setBusy(true);
    setNotice(null);
    try {
      await updateCalendarProposalSlot({
        clientId, proposalId: selectedProposal.id, action,
        expectedEditRevision: selectedProposal.edit_revision, ...args,
      });
      setNotice({ kind: "success", text: `${action} applied.` });
      await loadProposals();
      await loadSlots(selectedProposal.id);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }, [clientId, selectedProposal, loadProposals, loadSlots]);

  const handleApprove = useCallback(async () => {
    if (!selectedProposal) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await approveCalendarProposal({
        clientId, proposalId: selectedProposal.id, expectedEditRevision: selectedProposal.edit_revision,
      });
      setNotice({ kind: "success", text: `Approved. ${result.created_content_item_ids.length} Content Item(s) created.` });
      await loadProposals();
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }, [clientId, selectedProposal, loadProposals]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-2xs uppercase tracking-wide text-paper-3">Period start</label>
          <input type="date" className="rounded border border-line bg-transparent px-2 py-1 text-xs text-paper" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-2xs uppercase tracking-wide text-paper-3">Period end</label>
          <input type="date" className="rounded border border-line bg-transparent px-2 py-1 text-xs text-paper" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-2xs uppercase tracking-wide text-paper-3">Mode</label>
          <select className="rounded border border-line bg-transparent px-2 py-1 text-xs text-paper" value={mode} onChange={(e) => setMode(e.target.value as CalendarProposalMode)}>
            <option value="assisted">Assisted (Cockpit proposes)</option>
            <option value="manual">Manual (empty, you assign)</option>
          </select>
        </div>
        <Button variant="primary" size="sm" disabled={busy} onClick={handleGenerate}>Generate proposal</Button>
      </div>

      {notice && (
        <p className={`mb-3 text-2xs ${notice.kind === "error" ? "text-neg" : notice.kind === "success" ? "text-teal" : "text-paper-3"}`}>
          {notice.text}
        </p>
      )}

      {loading && <p className="text-xs text-paper-3">Loading…</p>}
      {!loading && proposals.length === 0 && <p className="text-xs text-paper-3">No proposals yet — generate one above.</p>}

      {proposals.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1">
          {proposals.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedProposalId(p.id)}
              className={`rounded border px-2 py-1 text-2xs ${selectedProposalId === p.id ? "border-teal text-teal" : "border-line text-paper-3 hover:text-paper"}`}
            >
              {p.period_start} → {p.period_end} · {p.status} · rev {p.edit_revision}
            </button>
          ))}
        </div>
      )}

      {selectedProposal && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-2xs text-paper-3">Mode: {selectedProposal.mode}</span>
            {selectedProposal.status === "draft" && (
              <Button variant="primary" size="sm" disabled={busy} onClick={handleApprove}>
                Approve &amp; commit
              </Button>
            )}
          </div>

          {slots.map((slot) => (
            <div key={slot.id} className="border-b border-line py-2 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-2xs text-paper-3">{slot.calendar_slot_id.slice(0, 8)}</span>
                {slot.content_opportunity_id ? (
                  <span className="text-xs text-paper">{opportunityTitles[slot.content_opportunity_id] ?? slot.content_opportunity_id}</span>
                ) : (
                  <span className="text-xs text-paper-3">Unassigned</span>
                )}
                {slot.match_score !== null && <span className="font-mono text-2xs text-paper-3">{Number(slot.match_score).toFixed(1)}/100</span>}
                {slot.manually_edited && <span className="text-2xs text-warn">manually edited</span>}
                {slot.conflict_status !== "clear" && (
                  <span className="text-2xs text-neg">{PROPOSAL_CONFLICT_LABELS[slot.conflict_status]}</span>
                )}
              </div>
              {slot.match_rationale && <p className="mt-1 text-2xs text-paper-3">{slot.match_rationale}</p>}

              {selectedProposal.status === "draft" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {slot.content_opportunity_id && (
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => runEdit("remove", { slotId: slot.id })}>
                      Remove
                    </Button>
                  )}
                  {slot.original_content_opportunity_id && slot.content_opportunity_id !== slot.original_content_opportunity_id && (
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => runEdit("restore", { slotId: slot.id })}>
                      Restore original
                    </Button>
                  )}
                  <input
                    className="w-32 rounded border border-line bg-transparent px-2 py-1 text-2xs text-paper"
                    placeholder="Move to slot id"
                    value={moveTarget[slot.id] ?? ""}
                    onChange={(e) => setMoveTarget((prev) => ({ ...prev, [slot.id]: e.target.value }))}
                  />
                  <Button variant="secondary" size="sm" disabled={busy || !(moveTarget[slot.id] ?? "").trim()}
                    onClick={() => runEdit("move", { fromSlotId: slot.id, toSlotId: moveTarget[slot.id] })}>
                    Move
                  </Button>
                  <input
                    className="w-32 rounded border border-line bg-transparent px-2 py-1 text-2xs text-paper"
                    placeholder="Swap with slot id"
                    value={swapTarget[slot.id] ?? ""}
                    onChange={(e) => setSwapTarget((prev) => ({ ...prev, [slot.id]: e.target.value }))}
                  />
                  <Button variant="secondary" size="sm" disabled={busy || !(swapTarget[slot.id] ?? "").trim()}
                    onClick={() => runEdit("swap", { fromSlotId: slot.id, toSlotId: swapTarget[slot.id] })}>
                    Swap
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
