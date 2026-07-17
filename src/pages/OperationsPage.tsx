import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, Icon } from "@/components/primitives";
import { fetchActivityLog, fetchClients } from "@/lib/api";
import type { ActivityLogEntry, Client } from "@/types/client";
import { fmtRelative } from "@/lib/format";
import { resolveOperationDestination } from "@/lib/operation-destination";

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
  const [searchParams] = useSearchParams();
  const [entries, setEntries]     = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [filterClient, setFilterClient] = useState("all");
  const [pageSize, setPageSize] = useState(20);
  const [clients, setClients] = useState<Client[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextEntries, nextClients] = await Promise.all([
        fetchActivityLog({ limit: 100 }),
        fetchClients(),
      ]);
      setEntries(nextEntries);
      setClients(nextClients);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    function reload() { void load(); }
    window.addEventListener("aa:reload", reload);
    return () => window.removeEventListener("aa:reload", reload);
  }, [load]);

  const eventTypes = useMemo(
    () => ["all", ...Array.from(new Set(entries.map((entry) => entry.event_type))).sort()],
    [entries],
  );

  const filtered = entries.filter((entry) => {
    if (filterType !== "all" && entry.event_type !== filterType) return false;
    if (filterClient !== "all" && entry.client_id !== filterClient) return false;
    return true;
  });
  const visible = filtered.slice(0, pageSize);
  const focusedOperationId = searchParams.get("operation_id");

  if (loading) return <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">Loading…</div>;
  if (error)   return <div className="flex-1 flex items-center justify-center text-neg text-xs">{error}</div>;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium text-paper">Operations Log</h1>
        <span className="text-2xs text-paper-3 font-mono">Showing {visible.length} of {filtered.length} matching entries</span>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Icon name="filter" size={12} className="text-paper-3" />
          <span className="text-2xs text-paper-3 uppercase tracking-cap">Event type</span>
        </div>
        <select
          aria-label="Filter operations by event"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-ink-200 border border-line rounded px-2 py-1 text-xs text-paper outline-none"
        >
          {eventTypes.map((t) => (
            <option key={t} value={t}>{t === "all" ? "All Events" : t}</option>
          ))}
        </select>
        <select
          aria-label="Filter operations by client"
          value={filterClient}
          onChange={(event) => setFilterClient(event.target.value)}
          className="bg-ink-200 border border-line rounded px-2 py-1 text-xs text-paper outline-none"
        >
          <option value="all">All Clients</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
        <label className="ml-auto flex items-center gap-2 text-2xs uppercase tracking-cap text-paper-3">
          Show
          <select
            aria-label="Operations page size"
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
            className="bg-ink-200 border border-line rounded px-2 py-1 text-xs normal-case tracking-normal text-paper outline-none"
          >
            {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>

      {/* Log */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No matching activity"
          body="No operations match the selected client and event filters."
        />
      ) : (
        <div className="min-w-0 shrink-0 rounded-[10px] border border-line bg-ink-200">
          {visible.map((entry, i) => {
            const destination = resolveOperationDestination(entry);
            const meta = entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
            const highlighted = focusedOperationId && meta.operation_id === focusedOperationId;
            const rowClass = `px-4 py-3 flex items-start gap-3 ${
              i < visible.length - 1 ? "border-b border-line" : ""
            } ${highlighted ? "bg-teal/5" : ""}`;
            const content = <>
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
                  {destination && (
                    <span className="text-2xs text-teal">· {destination.label}</span>
                  )}
                </div>
              </div>
              <span className="text-2xs text-paper-3 font-mono flex-shrink-0">
                {fmtRelative(entry.created_at)}
              </span>
            </>;
            return destination ? (
              <Link
                key={entry.id}
                to={{ pathname: destination.pathname, search: destination.search }}
                className={`${rowClass} transition-colors hover:bg-ink-100 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-teal/50`}
              >
                {content}
              </Link>
            ) : (
              <div key={entry.id} className={rowClass}>{content}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
