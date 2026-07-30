import { useMemo, useRef } from "react";
import { Button, Modal } from "@/components/primitives";
import { summariseCommitPlan } from "@/lib/ideation-commit-view";
import type { IdeationCalendarProposal, IdeationProposalSlot } from "@/types/ideation-proposal";

function longDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Explicit commit confirmation.
 *
 * The operator is told exactly what will be created, that it enters the normal
 * review workflow, and that nothing downstream starts automatically. The
 * confirmation carries the proposal revision it was opened against; if the
 * proposal moves underneath the dialog, the commit is refused server-side and
 * the operator must review and confirm again.
 */
export function IdeationCommitConfirmation({
  proposal,
  slots,
  busy,
  onCancel,
  onConfirm,
}: {
  proposal: IdeationCalendarProposal;
  slots: IdeationProposalSlot[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (expectedEditRevision: number) => void;
}) {
  // Captured once, when the dialog opens: this is the revision the operator is
  // actually confirming, not whatever the latest render happens to hold.
  const confirmedRevision = useRef(proposal.edit_revision);
  // Focus opens on the summary rather than on an action, so the consequences
  // are announced before either button can be pressed.
  const summaryRef = useRef<HTMLElement>(null);
  const summary = useMemo(
    () => summariseCommitPlan(slots, proposal.unresolved_conflict_count),
    [slots, proposal.unresolved_conflict_count],
  );
  const revisionMoved = proposal.edit_revision !== confirmedRevision.current;

  return (
    <Modal
      title="Commit Content"
      description={`Proposal version ${proposal.proposal_version} · ${proposal.period_start} to ${proposal.period_end}`}
      onClose={onCancel}
      closeDisabled={busy}
      widthClass="max-w-2xl"
      initialFocusRef={summaryRef}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || revisionMoved || summary.unresolvedConflicts > 0 || summary.total === 0}
            aria-describedby="commit-confirmation-status"
            onClick={() => onConfirm(confirmedRevision.current)}
          >
            {busy ? "Committing…" : `Commit ${summary.total} Content Items`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <section
          ref={summaryRef}
          tabIndex={-1}
          className="grid gap-x-4 gap-y-1 rounded border border-line bg-ink p-3 text-2xs text-paper-3 outline-none sm:grid-cols-2"
          aria-label="Commit summary"
        >
          <div><span className="text-paper-2">Proposal version:</span> {proposal.proposal_version}</div>
          <div><span className="text-paper-2">Revision:</span> {confirmedRevision.current}</div>
          <div><span className="text-paper-2">Period:</span> {proposal.period_start} to {proposal.period_end}</div>
          <div><span className="text-paper-2">Total content items:</span> {summary.total}</div>
          <div><span className="text-paper-2">Organic content:</span> {summary.organic}</div>
          <div><span className="text-paper-2">Stories:</span> {summary.story}</div>
          <div className="sm:col-span-2">
            <span className="text-paper-2">Unresolved conflicts:</span> {summary.unresolvedConflicts}
          </div>
        </section>

        <section aria-labelledby="commit-breakdown">
          <h3
            id="commit-breakdown"
            className="border-b border-line pb-1 text-2xs font-medium uppercase tracking-wide text-paper-2"
          >
            By asset type
          </h3>
          <ul className="mt-2 space-y-1 text-2xs text-paper-3">
            {summary.byAssetType.map((entry) => (
              <li key={entry.asset_type}>
                {entry.asset_type}: {entry.count}
                {entry.asset_type === "story" ? " (Story master)" : " (Organic master)"}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="commit-dates">
          <h3
            id="commit-dates"
            className="border-b border-line pb-1 text-2xs font-medium uppercase tracking-wide text-paper-2"
          >
            Affected dates ({summary.dates.length})
          </h3>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-paper-3">
            {summary.dates.map((date) => <li key={date}>{longDate(date)}</li>)}
          </ul>
        </section>

        <section
          className="rounded border border-line bg-ink p-3 text-2xs leading-5 text-paper-3"
          aria-labelledby="commit-effects"
        >
          <h3 id="commit-effects" className="text-2xs font-medium uppercase tracking-wide text-paper-2">
            What this will do
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>{summary.total} operational Calendar rows will be created.</li>
            <li>
              {summary.total} operational Content rows will be created
              ({summary.organic} in the Organic master, {summary.story} in the Story master).
            </li>
            <li>Committed content enters the normal review workflow and is not approved automatically.</li>
            <li>Production, publishing, and distribution will not begin automatically.</li>
          </ul>
        </section>

        <p id="commit-confirmation-status" role="status" className="text-2xs text-paper-3">
          {revisionMoved
            ? "This proposal changed while the dialog was open. Close this dialog, review the proposal again, and re-confirm."
            : summary.unresolvedConflicts > 0
              ? "Resolve every Calendar conflict before committing."
              : `Confirming will create ${summary.total} Content records and ${summary.total} Calendar records.`}
        </p>
      </div>
    </Modal>
  );
}
