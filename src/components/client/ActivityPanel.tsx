import { useEffect, useState } from "react";
import { EmptyState } from "@/components/primitives";
import { fetchActivityLog } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import type { ActivityLogEntry } from "@/types/client";

const ALERT_EVENTS = new Set([
  "approval_needed",
  "asset_due",
  "automation_failed",
  "api_connection_failed",
  "context_review_needed",
  "payload_failed",
  "report_ready",
  "iteration_update_needed",
]);

const EVENT_COLOUR: Record<string, string> = {
  phase_1_requested:   "text-teal",
  phase_2_requested:   "text-teal",
  phase_2_blocked:     "text-warn",
  raw_input_saved:     "text-paper-3",
  draft_row_approved:  "text-teal",
  draft_row_rejected:  "text-neg",
  approval_needed:     "text-warn",
  automation_failed:   "text-neg",
  api_connection_failed: "text-neg",
  payload_failed:      "text-neg",
};

export function ActivityPanel({ clientId }: { clientId: string }) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchActivityLog({ clientId, limit: 100 })
      .then((data) => { if (alive) setEntries(data); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [clientId]);

  if (loading)
    return <div className="p-6 text-paper-3 text-xs">Loading activity…</div>;

  if (entries.length === 0)
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <EmptyState
          icon="ops"
          title="No activity yet"
          body="Phase 1/2 runs, input saves, and approvals will appear here."
        />
      </div>
    );

  return (
    <div className="flex-1 overflow-y-auto">
      {entries.map((e) => {
        const isAlert = ALERT_EVENTS.has(e.event_type);
        return (
          <div
            key={e.id}
            className={`px-4 py-3 border-b border-line last:border-b-0 flex items-start gap-3 ${
              isAlert ? "bg-warn/5" : ""
            }`}
          >
            <span
              className={`text-2xs font-mono shrink-0 mt-0.5 ${
                EVENT_COLOUR[e.event_type] ?? "text-paper-3"
              }`}
            >
              {e.event_type}
            </span>
            <span className="text-xs text-paper flex-1">
              {e.plain_english_message}
            </span>
            <span className="text-2xs font-mono text-paper-3 shrink-0">
              {fmtRelative(e.created_at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
