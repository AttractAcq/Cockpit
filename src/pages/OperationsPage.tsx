import { useEffect, useState } from "react";
import { EmptyState, Icon } from "@/components/primitives";
import { fetchActivityLog } from "@/lib/api";
import type { ActivityLogEntry } from "@/types/client";
import { fmtRelative } from "@/lib/format";

const EVENT_TYPE_COLOURS: Record<string, string> = {
  phase1_started:   "text-teal",
  phase1_completed: "text-teal",
  phase2_started:   "text-teal",
  phase2_completed: "text-teal",
  playbook_run:     "text-info",
  automation_run:   "text-warn",
  error:            "text-neg",
  client_created:   "text-paper-2",
  asset_uploaded:   "text-paper-2",
};

export function OperationsPage() {
  const [entries, setEntries]     = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [filterType, setFilterType] = useState("all");

  useEffect(() => {
    fetchActivityLog({ limit: 200 })
      .then(setEntries)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const eventTypes = ["all", ...Array.from(new Set(entries.map((e) => e.event_type)))];

  const filtered =
    filterType === "all" ? entries : entries.filter((e) => e.event_type === filterType);

  if (loading) return <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">Loading…</div>;
  if (error)   return <div className="flex-1 flex items-center justify-center text-neg text-xs">{error}</div>;

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium text-paper">Operations Log</h1>
        <span className="text-2xs text-paper-3 font-mono">{filtered.length} entries</span>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Icon name="filter" size={12} className="text-paper-3" />
          <span className="text-2xs text-paper-3 uppercase tracking-cap">Event type</span>
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-ink-200 border border-line rounded px-2 py-1 text-xs text-paper outline-none"
        >
          {eventTypes.map((t) => (
            <option key={t} value={t}>{t === "all" ? "All Events" : t}</option>
          ))}
        </select>
      </div>

      {/* Log */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No activity yet"
          body="System events (phase runs, playbook commits, automation runs, errors) will appear here."
        />
      ) : (
        <div className="bg-ink-200 border border-line rounded-[10px] overflow-hidden">
          {filtered.map((entry, i) => (
            <div
              key={entry.id}
              className={`px-4 py-3 flex items-start gap-3 ${
                i < filtered.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <div className="flex-shrink-0 w-2 h-2 rounded-full bg-paper-3 mt-1.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-paper">{entry.plain_english_message}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`text-2xs font-mono uppercase ${
                      EVENT_TYPE_COLOURS[entry.event_type] ?? "text-paper-3"
                    }`}
                  >
                    {entry.event_type}
                  </span>
                  {entry.clients?.name && (
                    <span className="text-2xs text-paper-3">· {entry.clients.name}</span>
                  )}
                  {entry.users?.full_name && (
                    <span className="text-2xs text-paper-3">· {entry.users.full_name}</span>
                  )}
                </div>
              </div>
              <span className="text-2xs text-paper-3 font-mono flex-shrink-0">
                {fmtRelative(entry.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
