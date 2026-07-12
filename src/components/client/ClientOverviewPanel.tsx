import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, Panel } from "@/components/primitives";
import { fetchActivityLog, fetchCalendarCells, fetchMasterRowByRef } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import type { ActivityLogEntry } from "@/types/client";
import type { CalendarCellRow, MasterRow, MasterTable } from "@/types/phase";
import { MasterContentModal } from "./MastersPanel";

const SLOTS = [
  ["ad1", "Ad 1"], ["ad2", "Ad 2"], ["ad3", "Ad 3"], ["reels", "Reels"],
  ["story", "Story"], ["carousel", "Carousel"], ["feed", "Feed Posts"],
] as const;

function iso(date: Date): string { return date.toISOString().slice(0, 10); }
function addDays(date: Date, amount: number): Date { const next = new Date(date); next.setDate(next.getDate() + amount); return next; }
function monthOf(date: Date): string { return iso(date).slice(0, 7); }
function slotFor(rowType: string): string {
  const value = rowType.toLowerCase().replaceAll("_", "").replaceAll(" ", "");
  if (["ad1", "ad2", "ad3"].includes(value)) return value;
  if (value.includes("reel")) return "reels";
  if (value.includes("stor")) return "story";
  if (value.includes("carousel")) return "carousel";
  if (value.includes("feed") || value.includes("static") || value === "post") return "feed";
  return "other";
}

export function ClientOverviewPanel({ clientId }: { clientId: string }) {
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [cells, setCells] = useState<CalendarCellRow[]>([]);
  const [open, setOpen] = useState<{ table: MasterTable; row: MasterRow } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(new Date(), index)), []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const months = [...new Set(days.map(monthOf))];
      const [events, ...monthCells] = await Promise.all([
        fetchActivityLog({ clientId, limit: 10 }),
        ...months.map((month) => fetchCalendarCells(clientId, month)),
      ]);
      setActivity(events);
      setCells(monthCells.flat());
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setLoading(false); }
  }, [clientId, days]);
  useEffect(() => { void load(); }, [load]);

  async function openRef(ref: string) {
    try {
      const found = await fetchMasterRowByRef(clientId, ref);
      if (!found) throw new Error(`No Phase 3 master row found for ${ref}.`);
      setOpen(found);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
  }

  if (loading) return <div className="p-6 text-xs text-paper-3">Loading client overview…</div>;
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <Panel title="Recent Activity" meta="latest 10" className="min-w-0">
        {activity.length === 0 ? <EmptyState icon="clock" title="No activity yet" body="Client-specific events will appear here." /> : activity.map((entry) => <div key={entry.id} className="border-b border-line px-4 py-3 last:border-b-0"><div className="flex flex-wrap items-start gap-2"><span className="font-mono text-2xs text-teal">{entry.event_type}</span><span className="min-w-0 flex-1 text-xs leading-5 text-paper">{entry.plain_english_message}</span><span className="font-mono text-2xs text-paper-3">{fmtRelative(entry.created_at)}</span></div></div>)}
      </Panel>
      <Panel title="Pipeline" meta="data source not connected" className="min-w-0">
        <div className="p-5"><div className="rounded-lg border border-dashed border-line-2 bg-ink p-4"><p className="text-xs text-paper-2">Current pipeline data source is not connected.</p><p className="mt-2 text-2xs leading-5 text-paper-3">Future scope: applications, diagnostics, proposals, wins and losses. No pipeline totals are inferred here.</p></div></div>
      </Panel>
    </div>
    <Panel title="Next 7 Days" meta="Phase 3 calendar preview" className="min-w-0 shrink-0">
      <div className="overflow-x-auto"><div className="grid min-w-[980px] grid-cols-7">
        {days.map((date) => {
          const dateCells = cells.filter((cell) => cell.date === iso(date));
          return <article key={iso(date)} className="min-w-0 border-r border-line p-2 last:border-r-0"><div className="mb-2"><div className="text-xs font-medium text-paper">{date.toLocaleDateString("en", { weekday: "short", day: "numeric" })}</div><div className="text-2xs text-paper-3">{date.toLocaleDateString("en", { month: "short", year: "numeric" })}</div></div><div className="space-y-1">{SLOTS.map(([slot, label]) => { const items = dateCells.filter((cell) => slotFor(cell.row_type) === slot); return <div key={slot} className="rounded border border-line bg-ink p-1.5"><div className="text-[9px] font-mono uppercase text-paper-3">{label}</div>{items.length ? items.map((cell) => <button key={cell.id} onClick={() => void openRef(cell.ref)} className="mt-0.5 block w-full break-words text-left font-mono text-2xs text-teal hover:underline">{cell.ref}</button>) : <span className="text-2xs text-paper-3">—</span>}</div>; })}</div></article>;
        })}
      </div></div>
    </Panel>
    <Panel title="Analytics — Past 7 Days" meta="awaiting analytics data" className="min-w-0 shrink-0">
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">{["Posts published", "Reach", "Profile visits", "Engagement", "Leads / enquiries"].map((label) => <div key={label} className="rounded-lg border border-line bg-ink p-3"><div className="text-2xs uppercase tracking-wide text-paper-3">{label}</div><div className="mt-3 text-xs text-paper-2">Not connected</div></div>)}</div>
    </Panel>
    {open && <MasterContentModal table={open.table} initialRow={open.row} onClose={() => setOpen(null)} onUpdated={(table, row) => setOpen({ table, row })} />}
  </div>;
}
