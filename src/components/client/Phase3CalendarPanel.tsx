import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/primitives";
import { drivePhase3Run, fetchAdsMasterRows, fetchCalendarCells, fetchOrganicMasterRows, fetchStoryMasterRows, previewPhase3Scope, startPhase3Scope } from "@/lib/api";
import type { CalendarCellRow, MasterRow, MasterTable, Phase3DuplicatePolicy, Phase3ScopePreview, Phase3SlotProgress, ScopedPhase3Format } from "@/types/phase";
import { MasterContentModal } from "./MastersPanel";

const SCOPED_FORMATS: Array<{ value: ScopedPhase3Format; label: string }> = [
  { value: "feed_post", label: "Feed Post" }, { value: "carousel", label: "Carousel" },
  { value: "reel_video", label: "Reel" }, { value: "story_sequence", label: "Story Sequence" },
  { value: "ad_static", label: "Static Ad" },
];
const DUP_POLICIES: Array<{ value: Phase3DuplicatePolicy; label: string }> = [
  { value: "skip_existing", label: "Skip existing (default)" },
  { value: "fill_missing", label: "Fill missing only" },
  { value: "replace_unapproved", label: "Replace unapproved" },
];
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function addDaysIso(date: string, amount: number): string { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10); }

// Scoped Phase 3 dialog — single_item (Generate Asset) or range (Run Phase 3).
// Uses the backend preview as the single source of truth, then drives the run
// slot-by-slot. Closing does not cancel a persisted run.
function ScopedPhase3Dialog({ clientId, mode, defaultDate, onClose, onDone }: {
  clientId: string; mode: "single_item" | "range"; defaultDate: string; onClose: () => void; onDone: () => void;
}) {
  const [plannedDate, setPlannedDate] = useState(defaultDate);
  const [assetFormat, setAssetFormat] = useState<ScopedPhase3Format>("feed_post");
  const [startDate, setStartDate] = useState(defaultDate);
  const [horizon, setHorizon] = useState<"7" | "14" | "30" | "custom">("7");
  const [customEnd, setCustomEnd] = useState(addDaysIso(defaultDate, 6));
  const [policy, setPolicy] = useState<Phase3DuplicatePolicy>("skip_existing");
  const [preview, setPreview] = useState<Phase3ScopePreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "generate" | null>(null);
  const [progress, setProgress] = useState<Phase3SlotProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keepDriving = useRef(true);
  useEffect(() => () => { keepDriving.current = false; }, []);

  const endDate = mode === "single_item" ? plannedDate : horizon === "custom" ? customEnd : addDaysIso(startDate, Number(horizon) - 1);
  const req = mode === "single_item"
    ? { clientId, generationMode: "single_item" as const, plannedDate, assetFormat, duplicatePolicy: policy }
    : { clientId, generationMode: "range" as const, startDate, endDate, duplicatePolicy: policy };

  async function runPreview() {
    setBusy("preview"); setError(null); setProgress(null);
    try { setPreview(await previewPhase3Scope(req)); }
    catch (e) { setError(errorText(e)); setPreview(null); }
    finally { setBusy(null); }
  }
  async function generate() {
    setBusy("generate"); setError(null);
    try {
      const { run, queued } = await startPhase3Scope(req);
      if (queued === 0) { onDone(); onClose(); return; }
      await drivePhase3Run(run.id, (p) => setProgress(p), () => keepDriving.current);
      onDone();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(null); }
  }

  const field = "rounded border border-line bg-ink px-2.5 py-1.5 text-xs text-paper outline-none focus:border-teal";
  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 sm:items-center" onClick={onClose}>
    <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:rounded-[16px]" onClick={(e) => e.stopPropagation()}>
      <header className="shrink-0 border-b border-line px-5 py-4"><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-medium text-paper">{mode === "single_item" ? "Generate Asset" : "Run Phase 3 (scoped range)"}</h2><p className="mt-1 text-2xs text-paper-3">{mode === "single_item" ? "Creates exactly one Phase 3 content item (master row + calendar cell), needs review. No brief or asset is created." : "Generates one Phase 3 item per cadence slot in the window. New rows enter review; nothing is published."}</p></div><button onClick={onClose} className="text-paper-3 hover:text-paper">✕</button></div></header>
      {error && <div role="alert" className="shrink-0 border-b border-neg/20 bg-neg/5 px-5 py-2 text-xs text-neg">{error}</div>}
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {mode === "single_item" ? <>
            <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Planned date</span><input type="date" className={field} value={plannedDate} onChange={(e) => { setPlannedDate(e.target.value); setPreview(null); }} /></label>
            <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Content format</span><select className={field} value={assetFormat} onChange={(e) => { setAssetFormat(e.target.value as ScopedPhase3Format); setPreview(null); }}>{SCOPED_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
          </> : <>
            <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Start date</span><input type="date" className={field} value={startDate} onChange={(e) => { setStartDate(e.target.value); setPreview(null); }} /></label>
            <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Horizon</span><select className={field} value={horizon} onChange={(e) => { setHorizon(e.target.value as typeof horizon); setPreview(null); }}><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="custom">Custom end date</option></select></label>
            {horizon === "custom" && <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">End date</span><input type="date" className={field} value={customEnd} min={startDate} onChange={(e) => { setCustomEnd(e.target.value); setPreview(null); }} /></label>}
          </>}
          <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Duplicate policy</span><select className={field} value={policy} onChange={(e) => { setPolicy(e.target.value as Phase3DuplicatePolicy); setPreview(null); }}>{DUP_POLICIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
          <div className="flex items-end"><Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void runPreview()}>{busy === "preview" ? "Previewing…" : "Preview"}</Button></div>
        </div>

        {preview && <div className="mt-4 rounded-xl border border-line bg-ink p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"><span className="text-paper">{preview.start_date} → {preview.end_date}</span><span className="text-paper-3">{preview.days} day{preview.days === 1 ? "" : "s"}</span><span className="text-paper-3">{preview.total_slots} slot{preview.total_slots === 1 ? "" : "s"}</span></div>
          <div className="mt-2 flex flex-wrap gap-3 text-2xs"><span className="text-teal">{preview.summary.create} create</span><span className="text-paper-3">{preview.summary.skip} skip</span><span className="text-warn">{preview.summary.replace} replace</span><span className="text-neg">{preview.summary.conflict} protected conflict</span></div>
          {preview.protected_conflicts.length > 0 && <div className="mt-2 rounded border border-neg/20 bg-neg/5 px-2.5 py-1.5 text-2xs text-neg">Protected (won't be replaced): {preview.protected_conflicts.map((c) => `${c.existing_ref ?? c.planned_date} (${c.reason ?? "protected"})`).join("; ")}</div>}
          <div className="mt-3 max-h-56 overflow-y-auto rounded border border-line">
            <table className="w-full text-2xs"><thead className="sticky top-0 bg-ink-200 text-paper-3"><tr><th className="px-2 py-1 text-left">Date</th><th className="px-2 py-1 text-left">Format</th><th className="px-2 py-1 text-left">Action</th><th className="px-2 py-1 text-left">Existing</th></tr></thead>
            <tbody>{preview.slots.map((s) => <tr key={s.slot_key} className="border-t border-line"><td className="px-2 py-1 font-mono text-paper-2">{s.planned_date}{s.end_date && s.end_date !== s.planned_date ? `→${s.end_date}` : ""}</td><td className="px-2 py-1 text-paper-2">{s.asset_format.replaceAll("_", " ")}</td><td className={`px-2 py-1 ${s.action === "create" ? "text-teal" : s.action === "replace" ? "text-warn" : s.action === "conflict" ? "text-neg" : "text-paper-3"}`}>{s.action}</td><td className="px-2 py-1 font-mono text-paper-3">{s.existing_ref ?? "—"}</td></tr>)}</tbody></table>
          </div>
        </div>}

        {progress && <div className="mt-4 rounded-xl border border-teal/20 bg-teal/5 p-3 text-xs text-paper"><div className="flex items-center gap-2"><span>{progress.terminal ? "Complete" : "Generating…"}</span><span className="ml-auto font-mono text-2xs text-paper-3">{progress.progress.complete}/{progress.progress.total} · {progress.progress.failed} failed</span></div>{progress.ref && <div className="mt-1 text-2xs text-paper-3">Last created: {progress.ref}</div>}</div>}
      </main>
      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3"><span className="text-2xs text-paper-3">{preview ? "Preview from the backend. Closing does not cancel a started run." : "Preview first — no records are created until you generate."}</span><Button size="sm" variant="primary" className="ml-auto" disabled={busy !== null || !preview || (preview.summary.create + preview.summary.replace === 0)} onClick={() => void generate()}>{busy === "generate" ? "Generating…" : mode === "single_item" ? "Generate Item" : `Generate ${preview ? preview.summary.create + preview.summary.replace : ""} item(s)`}</Button></footer>
    </div>
  </div>;
}

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
  const [scopedMode, setScopedMode] = useState<"single_item" | "range" | null>(null);

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
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4"><div className="flex shrink-0 flex-wrap items-center gap-2 rounded-[10px] border border-line bg-ink-200 px-4 py-3"><div><div className="text-sm font-medium text-paper">{new Date(`${selectedMonth}-01T00:00:00Z`).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" })}</div><div className="text-2xs text-paper-3">{cells.length} Phase 3 calendar cells · linked to master refs</div></div><div className="ml-4 flex items-center gap-1"><Button size="sm" variant="ghost" onClick={() => setSelectedMonth((month) => shiftMonth(month, -1))}>← Previous Month</Button><Button size="sm" variant="ghost" disabled={selectedMonth === executionMonth} onClick={() => setSelectedMonth(executionMonth)}>Current Month</Button><Button size="sm" variant="ghost" onClick={() => setSelectedMonth((month) => shiftMonth(month, 1))}>Next Month →</Button></div><div className="flex items-center gap-1"><Button size="sm" variant="secondary" onClick={() => setScopedMode("single_item")}>Generate Asset</Button><Button size="sm" variant="secondary" onClick={() => setScopedMode("range")}>Run Phase 3</Button></div><div className="ml-auto flex rounded-md border border-line bg-ink p-0.5"><button className={`rounded px-3 py-1 text-xs ${view === "month" ? "bg-teal/15 text-teal" : "text-paper-3"}`} onClick={() => setView("month")}>Month</button><button className={`rounded px-3 py-1 text-xs ${view === "week" ? "bg-teal/15 text-teal" : "text-paper-3"}`} onClick={() => setView("week")}>Week</button></div>{view === "week" && <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setWeekStart((date) => addDays(date, -7))}>← Previous Week</Button><Button size="sm" variant="ghost" onClick={() => setWeekStart((date) => addDays(date, 7))}>Next Week →</Button></div>}</div>{error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}<div className="max-w-full shrink-0 overflow-x-auto rounded-[10px] border border-line"><div className="min-w-[1050px]"><div className="grid grid-cols-7 bg-ink-100">{WEEKDAYS.map((day) => <div key={day} className="border-r border-line px-2 py-2 text-center text-2xs font-mono uppercase text-paper-3 last:border-r-0">{day}</div>)}</div><div className="grid grid-cols-7">{days.map((date, index) => date ? <Day key={iso(date)} date={date} /> : <div key={`empty-${index}`} className="min-h-64 border-r border-t border-line bg-ink/50" />)}</div></div></div>{scopedMode && <ScopedPhase3Dialog clientId={clientId} mode={scopedMode} defaultDate={`${selectedMonth}-01`} onClose={() => setScopedMode(null)} onDone={() => { void load(); window.dispatchEvent(new Event("aa:reload")); }} />}{open && <MasterContentModal key={`${open.table}:${open.row.id}`} table={open.table} initialRow={open.row} onClose={() => setOpen(null)} onUpdated={(table, row) => { setMasters((current) => new Map(current).set(row.ref, { table, row })); setOpen({ table, row }); }} />}</div>;
}
