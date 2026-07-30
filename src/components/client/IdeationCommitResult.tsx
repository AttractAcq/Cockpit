import { useMemo } from "react";
import { Button } from "@/components/primitives";
import { commitItemsByDate, groupCommittedRefs } from "@/lib/ideation-commit-view";
import type { IdeationCommitItem, IdeationCommitRun } from "@/types/ideation-commit";

/**
 * The committed result. Once this is shown, "Commit Content" is gone: a
 * completed commit is terminal, and the operator's next step is to open the
 * created records, not to commit again.
 */
export function IdeationCommitResult({
  run,
  items,
  onOpenCalendar,
  onOpenContent,
}: {
  run: IdeationCommitRun;
  items: IdeationCommitItem[];
  onOpenCalendar: (date: string) => void;
  onOpenContent: (item: IdeationCommitItem) => void;
}) {
  const grouped = useMemo(() => groupCommittedRefs(items), [items]);
  const byDate = useMemo(() => commitItemsByDate(items), [items]);

  return (
    <section
      className="rounded border border-pos/30 bg-pos/5 p-3"
      aria-labelledby="ideation-commit-result"
    >
      <h3 id="ideation-commit-result" className="text-sm font-medium text-paper">
        Content Committed
      </h3>

      <dl className="mt-2 grid gap-x-4 gap-y-1 text-2xs text-paper-3 sm:grid-cols-2">
        <div className="flex gap-1">
          <dt className="text-paper-2">Content items:</dt>
          <dd>{run.committed_item_count}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-paper-2">Committed:</dt>
          <dd>{run.completed_at ? new Date(run.completed_at).toLocaleString() : "—"}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-paper-2">Organic master rows:</dt>
          <dd>{run.organic_item_count}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-paper-2">Story master rows:</dt>
          <dd>{run.story_item_count}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-paper-2">Source proposal version:</dt>
          <dd>{run.proposal_version}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-paper-2">Period:</dt>
          <dd>{run.period_start} to {run.period_end}</dd>
        </div>
        <div className="flex gap-1 break-all sm:col-span-2">
          <dt className="text-paper-2">Source scoring run:</dt>
          <dd>{run.scoring_run_id}</dd>
        </div>
        <div className="flex gap-1 break-all sm:col-span-2">
          <dt className="text-paper-2">Source Ideation cycle:</dt>
          <dd>{run.ideation_cycle_id}</dd>
        </div>
      </dl>

      <p className="mt-2 text-2xs leading-4 text-paper-3">
        These records are in the normal review workflow. Production, publishing, and
        distribution have not started.
      </p>

      <div className="mt-3 space-y-3">
        {byDate.map((group) => (
          <div key={group.date}>
            <div className="flex flex-wrap items-center gap-2 border-b border-line pb-1">
              <h4 className="text-2xs font-medium uppercase tracking-wide text-paper-2">
                {group.date}
              </h4>
              <Button size="sm" variant="subtle" onClick={() => onOpenCalendar(group.date)}>
                Open Calendar
              </Button>
            </div>
            <ul className="mt-1 space-y-1">
              {group.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-2xs text-teal">{item.operational_ref}</span>
                  <span className="text-2xs text-paper-3">
                    {item.asset_type} · {item.target_master_table === "story_master" ? "Story master" : "Organic master"}
                    {" · "}rank {item.candidate_rank_snapshot} · {item.candidate_score_snapshot}/100
                  </span>
                  <Button size="sm" variant="subtle" onClick={() => onOpenContent(item)}>
                    Open Content record
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {grouped.organic.length + grouped.story.length !== run.committed_item_count && (
        <p role="status" className="mt-2 text-2xs text-warn">
          Showing {grouped.organic.length + grouped.story.length} of {run.committed_item_count} committed
          records. Reload to see the rest.
        </p>
      )}
    </section>
  );
}
