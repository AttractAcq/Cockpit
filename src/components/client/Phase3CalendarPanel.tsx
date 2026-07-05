import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchAdsMasterRows, fetchCalendarCells, fetchOrganicMasterRows, fetchStoryMasterRows } from "@/lib/api";
import type { CalendarCellRow, MasterRow, MasterTable } from "@/types/phase";
import { MasterContentModal } from "./MastersPanel";

type View = "month" | "week";
type Slot = "ad1" | "ad2" | "ad3" | "reels" | "story" | "carousel" | "feed" | "other";

const SLOTS: Array<{ key: Slot; label: string }> = [
  { key: "ad1", label: "Ad 1" }, { key: "ad2", label: "Ad 2" }, { key: "ad3", label: "Ad 3" },
  { key: "reels", label: "Reels" }, { key: "story", label: "Story" },
  { key: "carousel", label: "Carousel" }, { key: "feed", label: "Feed Posts" },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function slotFor(rowType: string): Slot {
  const value = rowType.toLowerCase().replaceAll("_", "").replaceAll(" ", "");
  if (value === "ad1") return "ad1";
  if (value === "ad2") return "ad2";
  if (value === "ad3") return "ad3";
  if (value.includes("reel")) return "reels";
  if (value.includes("stor")) return "story";
  if (value.includes("carousel")) return "carousel";
  if (value.includes("feed") || value.includes("static") || value === "post") return "feed";
  return "other";
}

function iso(date: Date): string { return date.toISOString().slice(0, 10); }
function addDays(date: Date, amount: number): Date { const next = new Date(date); next.setUTCDate(next.getUTCDate() + amount); return next; }
function monday(date: Date): Date { const day = date.getUTCDay() || 7; return addDays(date, 1 - day); }
function monthDays(month: string): Array<Date | null> {
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const values: Array<Date | null> = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= count; day += 1) values.push(new Date(Date.UTC(year, number - 1, day)));
  while (values.length % 7) values.push(null);
  return values;
}
function shiftMonth(month: string, amount: number): string {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function tableForRef(ref: string): MasterTable { return ref.includes("-AD-") ? "ads_master" : ref.includes("-ST-") ? "story_master" : "organic_master"; }

export function Phase3CalendarPanel({ clientId, executionMonth }: { clientId: string; executionMonth: string }) {
  const [selectedMonth, setSelectedMonth] = useState(executionMonth);
  const [cells, setCells] = useState<CalendarCellRow[]>([]);
  const [masters, setMasters] = useState<Map<string, { table: MasterTable; row: MasterRow }>>(new Map());
  const [view, setView] = useState<View>("month");
  const [weekStart, setWeekStart] = useState(() => monday(new Date(`${executionMonth}-01T00:00:00Z`)));
  const [open, setOpen] = useState<{ table: MasterTable; row: MasterRow } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [calendar, organic, stories, ads] = await Promise.all([fetchCalendarCells(clientId, selectedMonth), fetchOrganicMasterRows(clientId, selectedMonth), fetchStoryMasterRows(clientId, selectedMonth), fetchAdsMasterRows(clientId, selectedMonth)]);
      setCells(calendar);
      const next = new Map<string, { table: MasterTable; row: MasterRow }>();
      organic.forEach((row) => next.set(row.ref, { table: "organic_master", row }));
      stories.forEach((row) => next.set(row.ref, { table: "story_master", row }));
      ads.forEach((row) => next.set(row.ref, { table: "ads_master", row }));
      setMasters(next);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setLoading(false); }
  }, [clientId, selectedMonth]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setWeekStart(monday(new Date(`${selectedMonth}-01T00:00:00Z`))); }, [selectedMonth]);

  const byDate = useMemo(() => {
    const map = new Map<string, Map<Slot, CalendarCellRow[]>>();
    for (const cell of cells) {
      const slots = map.get(cell.date) ?? new Map<Slot, CalendarCellRow[]>();
      const slot = slotFor(cell.row_type);
      slots.set(slot, [...(slots.get(slot) ?? []), cell]);
      map.set(cell.date, slots);
    }
    return map;
  }, [cells]);

  const days = view === "month" ? monthDays(selectedMonth) : Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  function openRef(ref: string) { const found = masters.get(ref); if (found) setOpen(found); else setError(`No master row found for ${ref} (${tableForRef(ref)}).`); }

  function refState(ref: string): "needs_review" | "approved" | "rejected" | "archived" | "missing" {
    return masters.get(ref)?.row.review_state ?? "missing";
  }

  function refStyle(ref: string): string {
    const state = refState(ref);
    if (state === "approved") return "border-teal/20 bg-teal/5 text-teal";
    if (state === "rejected" || state === "missing") return "border-neg/20 bg-neg/5 text-neg";
    return "border-warn/20 bg-warn/5 text-warn";
  }

  function Day({ date }: { date: Date }) {
    const dateKey = iso(date);
    const slots = byDate.get(dateKey) ?? new Map<Slot, CalendarCellRow[]>();
    const unmapped = slots.get("other") ?? [];
    return <article className="min-h-64 border-r border-t border-line bg-ink-200 p-2 last:border-r-0">
      <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-paper">{date.getUTCDate()}</span><span className="text-2xs text-paper-3">{date.toLocaleDateString("en", { month: "short", timeZone: "UTC" })}</span></div>
      <div className="space-y-1.5">{SLOTS.map(({ key, label }) => {
        const items = slots.get(key) ?? [];
        return <div key={key} className="rounded border border-line bg-ink p-1.5"><div className="text-[9px] font-mono uppercase tracking-wide text-paper-3">{label}</div>{items.length === 0 ? <div className="mt-0.5 text-2xs text-paper-3">—</div> : <div className="mt-1 space-y-1">{items.map((item) => <button key={item.id} title={`${refState(item.ref).replaceAll("_", " ")} · calendar ${item.review_state.replaceAll("_", " ")}`} className={`block w-full rounded border px-1 py-0.5 text-left font-mono text-2xs hover:underline ${refStyle(item.ref)}`} onClick={() => openRef(item.ref)}>{item.review_state !== refState(item.ref) ? "⚠ " : refState(item.ref) === "approved" ? "✓ " : refState(item.ref) === "rejected" ? "✕ " : "• "}{item.ref}</button>)}</div>}</div>;
      })}{unmapped.length > 0 && <div className="rounded border border-warn/20 bg-warn/5 p-1.5"><div className="text-[9px] uppercase text-warn">Unmapped</div>{unmapped.map((item) => <button key={item.id} className={`block break-words font-mono text-2xs ${refStyle(item.ref)}`} onClick={() => openRef(item.ref)}>{item.ref}</button>)}</div>}</div>
    </article>;
  }

  if (loading) return <div className="p-6 text-xs text-paper-3">Loading Phase 3 calendar…</div>;
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4"><div className="flex shrink-0 flex-wrap items-center gap-2 rounded-[10px] border border-line bg-ink-200 px-4 py-3"><div><div className="text-sm font-medium text-paper">{new Date(`${selectedMonth}-01T00:00:00Z`).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" })}</div><div className="text-2xs text-paper-3">{cells.length} Phase 3 calendar cells · linked to master refs</div></div><div className="ml-4 flex items-center gap-1"><Button size="sm" variant="ghost" onClick={() => setSelectedMonth((month) => shiftMonth(month, -1))}>← Previous Month</Button><Button size="sm" variant="ghost" disabled={selectedMonth === executionMonth} onClick={() => setSelectedMonth(executionMonth)}>Current Month</Button><Button size="sm" variant="ghost" onClick={() => setSelectedMonth((month) => shiftMonth(month, 1))}>Next Month →</Button></div><div className="ml-auto flex rounded-md border border-line bg-ink p-0.5"><button className={`rounded px-3 py-1 text-xs ${view === "month" ? "bg-teal/15 text-teal" : "text-paper-3"}`} onClick={() => setView("month")}>Month</button><button className={`rounded px-3 py-1 text-xs ${view === "week" ? "bg-teal/15 text-teal" : "text-paper-3"}`} onClick={() => setView("week")}>Week</button></div>{view === "week" && <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setWeekStart((date) => addDays(date, -7))}>← Previous Week</Button><Button size="sm" variant="ghost" onClick={() => setWeekStart((date) => addDays(date, 7))}>Next Week →</Button></div>}</div>{error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}<div className="max-w-full shrink-0 overflow-x-auto rounded-[10px] border border-line"><div className="min-w-[1050px]"><div className="grid grid-cols-7 bg-ink-100">{WEEKDAYS.map((day) => <div key={day} className="border-r border-line px-2 py-2 text-center text-2xs font-mono uppercase text-paper-3 last:border-r-0">{day}</div>)}</div><div className="grid grid-cols-7">{days.map((date, index) => date ? <Day key={iso(date)} date={date} /> : <div key={`empty-${index}`} className="min-h-64 border-r border-t border-line bg-ink/50" />)}</div></div></div>{open && <MasterContentModal key={`${open.table}:${open.row.id}`} table={open.table} initialRow={open.row} onClose={() => setOpen(null)} onUpdated={(table, row) => { setMasters((current) => new Map(current).set(row.ref, { table, row })); setOpen({ table, row }); }} />}</div>;
}
