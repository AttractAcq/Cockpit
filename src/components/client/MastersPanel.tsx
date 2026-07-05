import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import {
  fetchAdsMasterRows,
  fetchCalendarCells,
  fetchProductionBriefBySourceRef,
  fetchOrganicMasterRows,
  fetchStoryMasterRows,
  generateProductionBrief,
  logActivity,
  updateMasterRow,
  updateMasterReviewState,
} from "@/lib/api";
import { masterDate, masterType, proofRisk, qaFlags, type QaFlag } from "@/lib/stage3Review";
import type { CalendarCellRow, MasterRow, MasterTable, ProductionBriefRow } from "@/types/phase";
import type { ReviewState } from "@/types/client";
import { ProductionBriefModal } from "./ContentCreationPanel";

const TABLE_LABEL: Record<MasterTable, string> = {
  organic_master: "Organic",
  story_master: "Story",
  ads_master: "Ad",
};

const STATE_STYLE: Record<ReviewState, string> = {
  needs_review: "border-warn/20 bg-warn/10 text-warn",
  approved: "border-teal/20 bg-teal/10 text-teal",
  rejected: "border-neg/20 bg-neg/10 text-neg",
  archived: "border-line bg-ink text-paper-3",
};

const PROTECTED = new Set(["id", "client_id", "month", "ref", "review_state", "status", "created_at", "updated_at", "format_proven", "days"]);
const HIDDEN = new Set(["id", "client_id"]);

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string; hint?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details, value.hint].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

function StateBadge({ state }: { state: ReviewState }) {
  return <span className={`rounded border px-1.5 py-0.5 text-2xs font-mono ${STATE_STYLE[state]}`}>{state.replaceAll("_", " ")}</span>;
}

function titleFor(row: MasterRow): string {
  if ("working_title" in row) return row.working_title ?? row.content_type;
  if ("story_theme" in row) return row.story_theme ?? row.story_type ?? row.ref;
  return row.stint_name ?? row.ref;
}

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
}

export function MasterContentModal({ table, initialRow, cells, onClose, onUpdated, onApproveNext }: {
  table: MasterTable;
  initialRow: MasterRow;
  cells?: CalendarCellRow[];
  onClose: () => void;
  onUpdated?: (table: MasterTable, row: MasterRow) => void;
  onApproveNext?: (table: MasterTable, row: MasterRow) => void;
}) {
  const [row, setRow] = useState(initialRow);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initialRow).filter(([key, value]) => !PROTECTED.has(key) && (typeof value === "string" || value === null)).map(([key, value]) => [key, value ?? ""])));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [brief, setBrief] = useState<ProductionBriefRow | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const editableEntries = Object.entries(row).filter(([key, value]) => !PROTECTED.has(key) && (typeof value === "string" || value === null));
  const dirty = editableEntries.some(([key, value]) => draft[key] !== (value ?? ""));
  const flags = qaFlags(table, row, cells);
  const hasBlockingFlags = flags.some((flag) => flag.severity === "block");

  useEffect(() => {
    let active = true;
    void fetchProductionBriefBySourceRef(initialRow.client_id, initialRow.month, initialRow.ref)
      .then((value) => { if (active) setBrief(value); })
      .catch((error) => { if (active) setNotice({ error: true, message: errorText(error) }); });
    return () => { active = false; };
  }, [initialRow.client_id, initialRow.month, initialRow.ref]);

  function accept(next: MasterRow) {
    setRow(next);
    setDraft(Object.fromEntries(Object.entries(next).filter(([key, value]) => !PROTECTED.has(key) && (typeof value === "string" || value === null)).map(([key, value]) => [key, value ?? ""])));
    onUpdated?.(table, next);
  }

  function close() {
    if (dirty && !window.confirm("Discard unsaved master-row changes?")) return;
    onClose();
  }

  function reset() {
    setDraft(Object.fromEntries(editableEntries.map(([key, value]) => [key, value ?? ""])));
  }

  async function save() {
    const patch = Object.fromEntries(editableEntries.filter(([key, value]) => draft[key] !== (value ?? "")).map(([key]) => [key, draft[key].trim() || null]));
    if (Object.keys(patch).length === 0) return;
    setBusy("save"); setNotice(null);
    try {
      const next = await updateMasterRow(table, row, patch);
      accept(next); setEditing(false);
      setNotice({ error: false, message: `Changes saved.${row.review_state === "approved" ? " Review reset to needs_review." : ""}` });
      void logActivity(row.client_id, "master_row_saved", `${row.ref} edited in ${table}.`, { table, row_id: row.id, fields: Object.keys(patch) });
    } catch (error) { setNotice({ error: true, message: errorText(error) }); }
    finally { setBusy(null); }
  }

  async function approve(advance = false) {
    if (hasBlockingFlags) { setNotice({ error: true, message: "Resolve blocking QA flags before approval." }); return; }
    if (dirty || !window.confirm("Approve this Phase 3 master row?")) return;
    setBusy("approve"); setNotice(null);
    try {
      const next = await updateMasterReviewState(table, row, "approved");
      accept(next);
      setNotice({ error: false, message: "Master row approved." });
      void logActivity(row.client_id, "master_row_approved", `${row.ref} approved in ${table}.`, { table, row_id: row.id });
      if (advance) onApproveNext?.(table, next);
    } catch (error) { setNotice({ error: true, message: errorText(error) }); }
    finally { setBusy(null); }
  }

  async function generateBrief() {
    const confirmation = brief
      ? "Regenerate this production brief? Existing markdown will be replaced and returned to needs_review."
      : "Generate a production brief for this asset?";
    if (dirty || !window.confirm(confirmation)) return;
    setBriefBusy(true); setNotice(null);
    try {
      const next = await generateProductionBrief({ clientId: row.client_id, executionMonth: row.month, sourceTable: table, sourceRowId: row.id, sourceRef: row.ref });
      setBrief(next); setBriefOpen(true);
      setNotice({ error: false, message: `Production brief ${brief ? "regenerated" : "generated"}.` });
    } catch (error) { setNotice({ error: true, message: errorText(error) }); }
    finally { setBriefBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={close}>
    <div className="flex h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:h-[88vh] sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
      <header className="shrink-0 border-b border-line px-5 py-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-2xs font-mono text-teal">{row.ref}</span><span className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">{TABLE_LABEL[table]}</span><StateBadge state={row.review_state} /></div><h2 className="mt-2 break-words text-base font-medium text-paper">{titleFor(row)}</h2></div><button className="text-paper-3 hover:text-paper" onClick={close}>✕</button></div></header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-2.5"><Button size="sm" variant={editing ? "secondary" : "subtle"} onClick={() => setEditing((value) => !value)}>{editing ? "View Details" : "Edit"}</Button>{editing && <><Button size="sm" variant="ghost" disabled={!dirty || busy !== null} onClick={reset}>Reset Changes</Button><Button size="sm" variant="primary" disabled={!dirty || busy !== null} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save Changes"}</Button></>}{row.review_state === "needs_review" && <><Button size="sm" variant="secondary" disabled={dirty || busy !== null} onClick={() => void approve()}>{busy === "approve" ? "Approving…" : "Approve Review"}</Button>{onApproveNext && <Button size="sm" variant="primary" disabled={dirty || busy !== null} onClick={() => void approve(true)}>Approve &amp; Next</Button>}</>}<span className="ml-auto text-2xs font-mono text-paper-3">Updated {new Date(row.updated_at).toLocaleString()}</span></div>
      {flags.length > 0 && <div className="flex shrink-0 flex-wrap gap-2 border-b border-line px-5 py-2">{flags.map((flag) => <span key={flag.code} className={`rounded border px-2 py-1 text-2xs ${flag.severity === "block" ? "border-neg/20 bg-neg/5 text-neg" : "border-warn/20 bg-warn/5 text-warn"}`}>{flag.label}</span>)}</div>}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-2"><Button size="sm" variant="secondary" disabled={briefBusy || dirty} onClick={() => void generateBrief()}>{briefBusy ? "Generating Brief…" : brief ? "Regenerate Brief" : "Generate Brief"}</Button>{brief && <Button size="sm" variant="ghost" onClick={() => setBriefOpen(true)}>View Brief</Button>}<span className="text-2xs text-paper-3">Instructions only — no asset will be produced.</span></div>
      {notice && <div role={notice.error ? "alert" : "status"} className={`shrink-0 border-b px-5 py-2 text-xs ${notice.error ? "border-neg/20 bg-neg/5 text-neg" : "border-teal/20 bg-teal/5 text-teal"}`}>{notice.message}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="grid min-w-0 gap-3 md:grid-cols-2">{Object.entries(row).filter(([key]) => !HIDDEN.has(key)).map(([key, value]) => {
        const canEdit = editing && !PROTECTED.has(key) && (typeof value === "string" || value === null);
        const long = canEdit && (draft[key]?.length > 100 || ["notes", "caption_script", "core_message", "storyboard_outline", "production_brief"].includes(key));
        return <div key={key} className={`min-w-0 rounded-lg border border-line bg-ink p-3 ${["caption_script", "core_message", "storyboard_outline", "notes", "frame_1", "frame_2", "frame_3"].includes(key) ? "md:col-span-2" : ""}`}><label className="mb-1.5 block text-2xs font-mono uppercase tracking-wide text-paper-3">{key.replaceAll("_", " ")}</label>{canEdit ? long ? <textarea className="min-h-28 w-full resize-y rounded border border-line bg-ink-200 p-2 text-xs leading-5 text-paper outline-none focus:border-teal/50" value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /> : <input className="w-full rounded border border-line bg-ink-200 px-2 py-1.5 text-xs text-paper outline-none focus:border-teal/50" value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /> : <div className="whitespace-pre-wrap break-words text-xs leading-5 text-paper-2">{valueText(value)}</div>}</div>;
      })}</div></div>
      {briefOpen && brief && <ProductionBriefModal initialBrief={brief} onClose={() => setBriefOpen(false)} onUpdated={(next) => setBrief(next)} />}
    </div>
  </div>;
}

function MasterCard({ table, row, flags, selected, onSelected, onOpen, updating, onApprove }: { table: MasterTable; row: MasterRow; flags: QaFlag[]; selected: boolean; onSelected: (checked: boolean) => void; onOpen: () => void; updating: boolean; onApprove: () => void }) {
  const hook = "hook" in row ? row.hook : "hook_angle" in row ? row.hook_angle : row.frame_1;
  const type = "content_type" in row ? row.content_type : "story_type" in row ? row.story_type : row.lane;
  return <div className="min-w-0 border-b border-line px-4 py-3.5 last:border-b-0"><div className="flex flex-col gap-2 sm:flex-row sm:items-start"><input aria-label={`Select ${row.ref}`} type="checkbox" checked={selected} onChange={(event) => onSelected(event.target.checked)} className="mt-1 accent-teal" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-2xs font-mono text-teal">{row.ref}</span><span className="text-2xs font-mono text-paper-3">{type ?? "—"}</span><span className="text-2xs font-mono text-paper-3">{masterDate(row) ?? "No date"}</span><StateBadge state={row.review_state} />{flags.map((flag) => <span key={flag.code} className={`rounded border px-1.5 py-0.5 text-2xs ${flag.severity === "block" ? "border-neg/20 text-neg" : "border-warn/20 text-warn"}`}>{flag.label}</span>)}</div><h3 className="mt-1.5 break-words text-xs font-medium leading-5 text-paper">{titleFor(row)}</h3>{hook && <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-paper-3">{hook}</p>}</div><div className="flex shrink-0 gap-2"><Button size="sm" variant="ghost" onClick={onOpen}>View</Button>{row.review_state === "needs_review" && <Button size="sm" variant="subtle" disabled={updating} onClick={onApprove}>Approve</Button>}</div></div></div>;
}

export function MastersPanel({ clientId, executionMonth }: { clientId: string; executionMonth: string }) {
  const [rows, setRows] = useState<Array<{ table: MasterTable; row: MasterRow }>>([]);
  const [cells, setCells] = useState<CalendarCellRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [open, setOpen] = useState<{ table: MasterTable; row: MasterRow } | null>(null);
  const [expanded, setExpanded] = useState<Record<MasterTable, boolean>>({ organic_master: true, story_master: true, ads_master: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [proofFilter, setProofFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [organic, stories, ads, calendar] = await Promise.all([fetchOrganicMasterRows(clientId, executionMonth), fetchStoryMasterRows(clientId, executionMonth), fetchAdsMasterRows(clientId, executionMonth), fetchCalendarCells(clientId, executionMonth)]);
      setRows([...organic.map((row) => ({ table: "organic_master" as const, row })), ...stories.map((row) => ({ table: "story_master" as const, row })), ...ads.map((row) => ({ table: "ads_master" as const, row }))]);
      setCells(calendar);
    } catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [clientId, executionMonth]);
  useEffect(() => { void load(); }, [load]);

  const assessed = useMemo(() => rows.map((item) => ({ ...item, flags: qaFlags(item.table, item.row, cells) })), [rows, cells]);
  const types = useMemo(() => [...new Set(assessed.map(({ table, row }) => masterType(table, row)))].sort(), [assessed]);
  const filtered = useMemo(() => assessed.filter((item) => {
    const date = masterDate(item.row);
    const matchesQuery = !query.trim() || `${item.row.ref} ${titleFor(item.row)} ${valueText(item.row)}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery
      && (typeFilter === "all" || masterType(item.table, item.row) === typeFilter)
      && (statusFilter === "all" || item.row.review_state === statusFilter)
      && (proofFilter === "all" || (proofFilter === "risk" ? proofRisk(item.flags) : !proofRisk(item.flags)))
      && (!dateFrom || (!!date && date >= dateFrom))
      && (!dateTo || (!!date && date <= dateTo));
  }), [assessed, dateFrom, dateTo, proofFilter, query, statusFilter, typeFilter]);
  const grouped = useMemo(() => ({ organic_master: filtered.filter((item) => item.table === "organic_master"), story_master: filtered.filter((item) => item.table === "story_master"), ads_master: filtered.filter((item) => item.table === "ads_master") }), [filtered]);
  const approved = rows.filter((item) => item.row.review_state === "approved").length;
  const blocking = assessed.filter((item) => item.flags.some((flag) => flag.severity === "block")).length;
  function accept(table: MasterTable, next: MasterRow, keepOpen = true) { setRows((current) => current.map((item) => item.table === table && item.row.id === next.id ? { table, row: next } : item)); setCells((current) => current.map((cell) => cell.ref === next.ref ? { ...cell, review_state: next.review_state } : cell)); if (keepOpen) setOpen({ table, row: next }); }
  async function approve(table: MasterTable, row: MasterRow) { if (qaFlags(table, row, cells).some((flag) => flag.severity === "block")) { setError(`${row.ref} has blocking QA flags. Resolve them before approval.`); return; } if (!window.confirm(`Approve ${row.ref}?`)) return; setUpdating(true); try { const next = await updateMasterReviewState(table, row, "approved"); accept(table, next, false); } catch (value) { setError(errorText(value)); } finally { setUpdating(false); } }
  async function bulkReview(state: Extract<ReviewState, "approved" | "rejected">) {
    const targets = filtered.filter(({ row }) => selected.has(row.id) && row.review_state !== state);
    const blocked = state === "approved" ? targets.filter((item) => item.flags.some((flag) => flag.severity === "block")) : [];
    if (blocked.length) { setError(`${blocked.length} selected row(s) have blocking QA flags. Resolve them before bulk approval.`); return; }
    if (!targets.length || !window.confirm(`${state === "approved" ? "Approve" : "Reject"} ${targets.length} selected Phase 3 row(s)? Calendar review states will be kept in sync.`)) return;
    setUpdating(true); setError(null);
    try {
      for (const item of targets) {
        const next = await updateMasterReviewState(item.table, item.row, state);
        accept(item.table, next, false);
      }
      setSelected(new Set());
      void logActivity(clientId, `phase3_rows_${state}`, `${targets.length} Phase 3 master row(s) marked ${state}.`, { execution_month: executionMonth, count: targets.length, refs: targets.map(({ row }) => row.ref) });
    } catch (value) { setError(errorText(value)); }
    finally { setUpdating(false); }
  }
  function approveNext(table: MasterTable, row: MasterRow) {
    const currentIndex = filtered.findIndex((item) => item.row.id === row.id);
    const next = [...filtered.slice(currentIndex + 1), ...filtered.slice(0, Math.max(0, currentIndex))].find((item) => item.row.review_state === "needs_review");
    setOpen(next ? { table: next.table, row: next.row } : null);
  }

  if (loading && rows.length === 0) return <div className="p-6 text-xs text-paper-3">Loading Phase 3 masters…</div>;
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4"><div className="shrink-0 rounded-[10px] border border-line bg-ink-200 px-4 py-3"><div className="flex flex-wrap gap-4 text-xs"><span className="text-paper">{rows.length} master rows</span><span className="text-teal">{approved} approved</span><span className="text-warn">{rows.length - approved} require review</span><span className={blocking ? "text-neg" : "text-teal"}>{blocking} blocking QA flags</span><span className="text-paper-3">{filtered.length} shown</span></div></div>
    <div className="shrink-0 rounded-[10px] border border-line bg-ink-200 p-3"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ref or content…" className="rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper outline-none focus:border-teal/50 xl:col-span-2" /><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded border border-line bg-ink px-2 py-2 text-xs text-paper"><option value="all">All content types</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded border border-line bg-ink px-2 py-2 text-xs text-paper"><option value="all">All statuses</option><option value="needs_review">Needs review</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><select value={proofFilter} onChange={(event) => setProofFilter(event.target.value)} className="rounded border border-line bg-ink px-2 py-2 text-xs text-paper"><option value="all">All proof risk</option><option value="risk">Proof review required</option><option value="clear">No proof flags</option></select><div className="flex gap-1"><input aria-label="From date" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="min-w-0 flex-1 rounded border border-line bg-ink px-1 py-2 text-2xs text-paper" /><input aria-label="To date" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="min-w-0 flex-1 rounded border border-line bg-ink px-1 py-2 text-2xs text-paper" /></div></div><div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" onClick={() => setSelected(new Set(filtered.map(({ row }) => row.id)))}>Select shown</Button><Button size="sm" variant="ghost" disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear selection</Button><span className="text-2xs text-paper-3">{selected.size} selected</span><Button size="sm" variant="secondary" disabled={!selected.size || updating} onClick={() => void bulkReview("approved")}>Bulk approve</Button><Button size="sm" variant="danger" disabled={!selected.size || updating} onClick={() => void bulkReview("rejected")}>Bulk reject</Button></div></div>
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}{(["organic_master", "story_master", "ads_master"] as MasterTable[]).map((table) => {
    const items = grouped[table];
    const tableApproved = items.filter(({ row }) => row.review_state === "approved").length;
    return <section key={table} className="min-w-0 shrink-0 overflow-hidden rounded-[10px] border border-line bg-ink-200">
      <button aria-expanded={expanded[table]} onClick={() => setExpanded((current) => ({ ...current, [table]: !current[table] }))} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-100">
        <span className="text-2xs text-paper-3">{expanded[table] ? "▼" : "▶"}</span>
        <span className="text-2xs font-medium uppercase tracking-wide text-paper-2">{TABLE_LABEL[table]} Master</span>
        <span className="ml-auto font-mono text-2xs text-paper-3">{items.length} rows</span>
        <span className="font-mono text-2xs text-teal">{tableApproved} approved</span>
        <span className="font-mono text-2xs text-warn">{items.length - tableApproved} need review</span>
      </button>
      {expanded[table] && <div className="border-t border-line">{items.length ? items.map(({ row, flags }) => <MasterCard key={row.id} table={table} row={row} flags={flags} selected={selected.has(row.id)} onSelected={(checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(row.id); else next.delete(row.id); return next; })} updating={updating} onOpen={() => setOpen({ table, row })} onApprove={() => void approve(table, row)} />) : <div className="px-4 py-6 text-xs text-paper-3">No rows match the current filters.</div>}</div>}
    </section>;
  })}{open && <MasterContentModal key={`${open.table}:${open.row.id}`} table={open.table} initialRow={open.row} cells={cells} onClose={() => setOpen(null)} onUpdated={accept} onApproveNext={approveNext} />}</div>;
}
