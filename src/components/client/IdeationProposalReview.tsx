import { useMemo, useState } from "react";
import { Button, Modal, Tag } from "@/components/primitives";
import {
  approvalBlockReason,
  canApproveProposal,
  canEditProposal,
  canRegenerateProposal,
  compatibleEmptySlots,
  compatibleSwapTargets,
  groupSlotsByDate,
  proposalHistory,
  slotsInScoreOrder,
  unassignedCandidates,
} from "@/lib/ideation-proposal-view";
import {
  IDEATION_CONFLICT_LABELS,
  isBlockingConflictStatus,
  type IdeationCalendarProposal,
  type IdeationProposalAction,
  type IdeationProposalSlot,
} from "@/types/ideation-proposal";
import type { IdeationCandidate } from "@/types/ideation";

const FIELD_CLASS =
  "rounded border border-line bg-ink px-2 py-1 text-2xs text-paper outline-none focus:border-teal/50";

export interface ProposalEditRequest {
  action: Extract<IdeationProposalAction, "move" | "swap" | "unassign" | "assign">;
  from_slot_key?: string;
  to_slot_key?: string;
  candidate_id?: string;
}

function longDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function SlotRow({
  slot,
  candidate,
  allSlots,
  editable,
  busy,
  onEdit,
  onOpenCandidate,
}: {
  slot: IdeationProposalSlot;
  candidate: IdeationCandidate | null;
  allSlots: IdeationProposalSlot[];
  editable: boolean;
  busy: boolean;
  onEdit: (request: ProposalEditRequest) => void;
  onOpenCandidate: (candidate: IdeationCandidate) => void;
}) {
  const [moveTarget, setMoveTarget] = useState("");
  const [swapTarget, setSwapTarget] = useState("");
  const moveOptions = useMemo(
    () => slot.candidate_asset_type_snapshot
      ? compatibleEmptySlots(allSlots, slot.candidate_asset_type_snapshot)
      : [],
    [allSlots, slot.candidate_asset_type_snapshot],
  );
  const swapOptions = useMemo(() => compatibleSwapTargets(allSlots, slot), [allSlots, slot]);
  const blocking = isBlockingConflictStatus(slot.conflict_status);
  const conflictLabel = IDEATION_CONFLICT_LABELS[slot.conflict_status];

  return (
    <li className="rounded border border-line bg-ink p-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-2xs text-paper-2">
          #{slot.date_slot_ordinal}
        </span>
        <Tag kind="task">{slot.required_asset_type}</Tag>
        {slot.candidate_id ? (
          <>
            <span className="font-mono text-2xs text-teal">{slot.candidate_display_reference}</span>
            {slot.candidate_rank_snapshot !== null && (
              <span className="font-mono text-2xs text-paper-2">
                rank {slot.candidate_rank_snapshot} · {slot.candidate_score_snapshot}/100
              </span>
            )}
          </>
        ) : (
          <span className="text-2xs font-medium text-warn">Unassigned slot</span>
        )}
        <span className={`ml-auto text-2xs ${blocking ? "text-neg" : slot.conflict_status === "clear" ? "text-paper-3" : "text-warn"}`}>
          {conflictLabel}
        </span>
      </div>

      {slot.candidate_id && candidate && (
        <button
          type="button"
          className="mt-2 block w-full rounded text-left text-sm text-paper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/60"
          onClick={() => onOpenCandidate(candidate)}
        >
          {candidate.working_title}
        </button>
      )}
      {slot.placement_rationale && (
        <p className="mt-1 text-2xs leading-4 text-paper-3">{slot.placement_rationale}</p>
      )}
      {slot.conflict_details?.reason && (
        <p className="mt-1 text-2xs text-warn">{slot.conflict_details.reason}</p>
      )}
      {slot.manually_edited && (
        <p className="mt-1 text-2xs text-paper-3">Manually edited by an operator.</p>
      )}

      {editable && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
          {slot.candidate_id ? (
            <>
              <label className="sr-only" htmlFor={`move-${slot.proposal_slot_key}`}>
                Move {slot.candidate_display_reference} to another slot
              </label>
              <select
                id={`move-${slot.proposal_slot_key}`}
                className={FIELD_CLASS}
                value={moveTarget}
                disabled={busy || moveOptions.length === 0}
                onChange={(event) => setMoveTarget(event.target.value)}
              >
                <option value="">Move to…</option>
                {moveOptions.map((option) => (
                  <option key={option.proposal_slot_key} value={option.proposal_slot_key}>
                    {option.proposed_date} #{option.date_slot_ordinal}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !moveTarget}
                onClick={() => onEdit({ action: "move", from_slot_key: slot.proposal_slot_key, to_slot_key: moveTarget })}
              >
                Move
              </Button>

              <label className="sr-only" htmlFor={`swap-${slot.proposal_slot_key}`}>
                Swap {slot.candidate_display_reference} with another placement
              </label>
              <select
                id={`swap-${slot.proposal_slot_key}`}
                className={FIELD_CLASS}
                value={swapTarget}
                disabled={busy || swapOptions.length === 0}
                onChange={(event) => setSwapTarget(event.target.value)}
              >
                <option value="">Swap with…</option>
                {swapOptions.map((option) => (
                  <option key={option.proposal_slot_key} value={option.proposal_slot_key}>
                    {option.proposed_date} #{option.date_slot_ordinal} · {option.candidate_display_reference}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !swapTarget}
                onClick={() => onEdit({ action: "swap", from_slot_key: slot.proposal_slot_key, to_slot_key: swapTarget })}
              >
                Swap
              </Button>

              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => onEdit({ action: "unassign", from_slot_key: slot.proposal_slot_key })}
              >
                Remove
              </Button>
            </>
          ) : (
            <span className="text-2xs text-paper-3">
              Restore a candidate from the unassigned list below.
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export function IdeationProposalReview({
  proposal,
  proposals,
  slots,
  candidatesById,
  candidateSnapshot,
  busy,
  onClose,
  onEdit,
  onRefreshConflicts,
  onRegenerate,
  onApprove,
  onOpenCandidate,
}: {
  proposal: IdeationCalendarProposal;
  proposals: IdeationCalendarProposal[];
  slots: IdeationProposalSlot[];
  candidatesById: Map<string, IdeationCandidate>;
  candidateSnapshot: Array<Record<string, unknown>>;
  busy: boolean;
  onClose: () => void;
  onEdit: (request: ProposalEditRequest) => void;
  onRefreshConflicts: () => void;
  onRegenerate: () => void;
  onApprove: () => void;
  onOpenCandidate: (candidate: IdeationCandidate) => void;
}) {
  const [order, setOrder] = useState<"chronological" | "score">("chronological");
  const [restoreTargets, setRestoreTargets] = useState<Record<string, string>>({});
  const editable = canEditProposal(proposal);
  const groups = useMemo(() => groupSlotsByDate(slots), [slots]);
  const scoreOrdered = useMemo(() => slotsInScoreOrder(slots), [slots]);
  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, candidate] of candidatesById) map.set(id, candidate.working_title);
    return map;
  }, [candidatesById]);
  const pool = useMemo(
    () => unassignedCandidates(candidateSnapshot, slots, titles),
    [candidateSnapshot, slots, titles],
  );
  const history = useMemo(
    () => proposalHistory(proposals, proposal.ideation_cycle_id),
    [proposals, proposal.ideation_cycle_id],
  );
  const approvable = canApproveProposal(proposal, slots);
  const blockReason = approvalBlockReason(proposal, slots);

  return (
    <Modal
      title="Proposed Calendar"
      description={`Version ${proposal.proposal_version} · ${proposal.status.replaceAll("_", " ")} · advisory only, nothing is committed`}
      onClose={onClose}
      closeDisabled={busy}
      widthClass="max-w-5xl"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>Close</Button>
          {editable && (
            <Button variant="secondary" disabled={busy} onClick={onRefreshConflicts}>
              {busy ? "Working…" : "Refresh conflicts"}
            </Button>
          )}
          {canRegenerateProposal(proposal) && (
            <Button variant="secondary" disabled={busy} onClick={onRegenerate}>
              Regenerate Proposal
            </Button>
          )}
          <Button
            variant="primary"
            disabled={busy || !approvable}
            aria-describedby="proposal-approval-status"
            onClick={onApprove}
          >
            {proposal.status === "approved" ? "Approved" : busy ? "Approving…" : "Approve Proposed Calendar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <section
          className="grid gap-x-4 gap-y-1 rounded border border-line bg-ink p-3 text-2xs text-paper-3 sm:grid-cols-2"
          aria-label="Proposal summary"
        >
          <div><span className="text-paper-2">Period:</span> {proposal.period_start} to {proposal.period_end} (inclusive)</div>
          <div><span className="text-paper-2">Status:</span> {proposal.status.replaceAll("_", " ")}</div>
          <div><span className="text-paper-2">Slots assigned:</span> {proposal.assigned_slot_count} / {proposal.expected_slot_count}</div>
          <div><span className="text-paper-2">Unassigned:</span> {proposal.unassigned_candidate_count}</div>
          <div><span className="text-paper-2">Conflicts:</span> {proposal.conflict_count} ({proposal.unresolved_conflict_count} unresolved)</div>
          <div><span className="text-paper-2">Revision:</span> {proposal.edit_revision}</div>
          <div className="break-all"><span className="text-paper-2">Scoring run:</span> {proposal.scoring_run_id}</div>
          <div><span className="text-paper-2">Slot planner:</span> {proposal.slot_planner_version}</div>
          {proposal.supersedes_proposal_id && (
            <div className="break-all sm:col-span-2">
              <span className="text-paper-2">Supersedes:</span> {proposal.supersedes_proposal_id}
            </div>
          )}
          {history.length > 1 && (
            <div className="sm:col-span-2">{history.length} proposal versions in history</div>
          )}
        </section>

        <p id="proposal-approval-status" role="status" className="text-2xs text-paper-3">
          {proposal.status === "approved"
            ? "This proposal is approved and immutable. No operational Calendar or master row was created."
            : blockReason ?? "Every slot is assigned and every conflict is resolved. This proposal can be approved."}
        </p>

        {proposal.warnings.length > 0 && (
          <ul className="space-y-1">
            {proposal.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="text-2xs text-warn">
                {warning.code}: {warning.message}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-paper-3">Order</span>
          <Button
            variant={order === "chronological" ? "primary" : "secondary"}
            size="sm"
            aria-pressed={order === "chronological"}
            onClick={() => setOrder("chronological")}
          >
            Chronological
          </Button>
          <Button
            variant={order === "score" ? "primary" : "secondary"}
            size="sm"
            aria-pressed={order === "score"}
            onClick={() => setOrder("score")}
          >
            Score order (audit)
          </Button>
        </div>

        {order === "chronological" ? (
          groups.map((group) => (
            <section key={group.date} aria-labelledby={`proposal-date-${group.date}`}>
              <h3
                id={`proposal-date-${group.date}`}
                className="border-b border-line pb-1 text-2xs font-medium uppercase tracking-wide text-paper-2"
              >
                {longDate(group.date)}
              </h3>
              <ul className="mt-2 space-y-2">
                {group.slots.map((slot) => (
                  <SlotRow
                    key={slot.proposal_slot_key}
                    slot={slot}
                    candidate={slot.candidate_id ? candidatesById.get(slot.candidate_id) ?? null : null}
                    allSlots={slots}
                    editable={editable}
                    busy={busy}
                    onEdit={onEdit}
                    onOpenCandidate={onOpenCandidate}
                  />
                ))}
              </ul>
            </section>
          ))
        ) : (
          <section aria-labelledby="proposal-score-order">
            <h3
              id="proposal-score-order"
              className="border-b border-line pb-1 text-2xs font-medium uppercase tracking-wide text-paper-2"
            >
              Score order (audit view)
            </h3>
            <ul className="mt-2 space-y-2">
              {scoreOrdered.map((slot) => (
                <SlotRow
                  key={slot.proposal_slot_key}
                  slot={slot}
                  candidate={slot.candidate_id ? candidatesById.get(slot.candidate_id) ?? null : null}
                  allSlots={slots}
                  editable={editable}
                  busy={busy}
                  onEdit={onEdit}
                  onOpenCandidate={onOpenCandidate}
                />
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="proposal-unassigned">
          <h3
            id="proposal-unassigned"
            className="border-b border-line pb-1 text-2xs font-medium uppercase tracking-wide text-paper-2"
          >
            Unassigned candidates ({pool.length})
          </h3>
          {pool.length === 0 ? (
            <p className="mt-2 text-2xs text-paper-3">
              Every candidate is assigned to a slot.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {pool.map((entry) => {
                const options = compatibleEmptySlots(slots, entry.asset_type);
                const selected = restoreTargets[entry.candidate_id] ?? "";
                return (
                  <li key={entry.candidate_id} className="rounded border border-warn/30 bg-warn/5 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag kind="task">{entry.asset_type}</Tag>
                      <span className="font-mono text-2xs text-teal">{entry.display_reference}</span>
                      {entry.rank !== null && (
                        <span className="font-mono text-2xs text-paper-2">
                          rank {entry.rank} · {entry.overall_score}/100
                        </span>
                      )}
                      <span className="text-2xs text-warn">Not placed on the Calendar</span>
                    </div>
                    <div className="mt-1 text-sm text-paper">{entry.working_title}</div>
                    {editable && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`restore-${entry.candidate_id}`}>
                          Restore {entry.display_reference} to a slot
                        </label>
                        <select
                          id={`restore-${entry.candidate_id}`}
                          className={FIELD_CLASS}
                          value={selected}
                          disabled={busy || options.length === 0}
                          onChange={(event) =>
                            setRestoreTargets((current) => ({ ...current, [entry.candidate_id]: event.target.value }))}
                        >
                          <option value="">Restore to…</option>
                          {options.map((option) => (
                            <option key={option.proposal_slot_key} value={option.proposal_slot_key}>
                              {option.proposed_date} #{option.date_slot_ordinal}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy || !selected}
                          onClick={() =>
                            onEdit({ action: "assign", to_slot_key: selected, candidate_id: entry.candidate_id })}
                        >
                          Restore
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
