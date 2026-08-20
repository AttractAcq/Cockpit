// Cockpit v3 Step 2 — extracted from OperationsControlPanel.tsx's Cost &
// Margin tab (Stage 2 Phase 08) so it can be shared by both the original
// Operations location and the new top-level Finance page
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 2) without duplicating the
// JSX or the data source. No behaviour change from the original tab. Made
// self-contained (fetches its own `clients`) so it works identically from
// either parent, matching the Workflows/Triggers/TeamRoles precedent.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchClients } from "@/lib/api";
import {
  fetchMarginSummary, recordCostEntry, setClientRevenueEstimate,
  fetchFinancePeriods, openFinancePeriod, reconcileFinancePeriod, importCostEntries,
} from "@/lib/operations-admin";
import { parseCostEntriesCsv } from "@/lib/finance-csv";
import { COST_CATEGORIES, COST_CATEGORY_LABEL } from "@/types/operations";
import type { Client } from "@/types/client";
import type { ClientMarginSummaryRow, CostCategory, ClientFinancePeriodRow, FinancePeriodStatus } from "@/types/operations";

const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";
type Notice = { kind: "success" | "error"; text: string } | null;
function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: string }).message);
  return error instanceof Error ? error.message : String(error);
}

export function CostMarginSection() {
  const [clients, setClients] = useState<Client[]>([]);
  useEffect(() => { void fetchClients().then(setClients); }, []);

  const [summary, setSummary] = useState<ClientMarginSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [entryForm, setEntryForm] = useState({ clientId: "", category: "model_spend" as CostCategory, amount: "", notes: "" });
  const [revenueForm, setRevenueForm] = useState({ clientId: "", amount: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setSummary(await fetchMarginSummary()); } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function record() {
    if (!entryForm.clientId || !entryForm.amount) return;
    setBusy(true); setNotice(null);
    try {
      await recordCostEntry({ clientId: entryForm.clientId, costCategory: entryForm.category, amount: Number(entryForm.amount), notes: entryForm.notes || null });
      setEntryForm({ ...entryForm, amount: "", notes: "" }); await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }
  async function saveRevenue() {
    if (!revenueForm.clientId) return;
    setBusy(true); setNotice(null);
    try {
      await setClientRevenueEstimate(revenueForm.clientId, revenueForm.amount ? Number(revenueForm.amount) : null);
      setNotice({ kind: "success", text: "Revenue estimate saved." }); await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  return <div className="space-y-3">
    {notice && <p className={`text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded border border-line bg-ink-200 p-3">
        <h4 className="mb-2 text-xs font-medium text-paper">Record a cost entry</h4>
        <div className="flex flex-wrap items-end gap-2">
          <select className={field} value={entryForm.clientId} onChange={(e) => setEntryForm({ ...entryForm, clientId: e.target.value })}><option value="">Client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className={field} value={entryForm.category} onChange={(e) => setEntryForm({ ...entryForm, category: e.target.value as CostCategory })}>{COST_CATEGORIES.map((c) => <option key={c} value={c}>{COST_CATEGORY_LABEL[c]}</option>)}</select>
          <input type="number" min="0" step="0.01" className={field} placeholder="Amount (EUR)" value={entryForm.amount} onChange={(e) => setEntryForm({ ...entryForm, amount: e.target.value })} />
          <Button size="sm" variant="primary" disabled={busy || !entryForm.clientId || !entryForm.amount} onClick={() => void record()}>Record</Button>
        </div>
      </div>
      <div className="rounded border border-line bg-ink-200 p-3">
        <h4 className="mb-2 text-xs font-medium text-paper">Set monthly revenue estimate</h4>
        <p className="mb-2 text-2xs text-paper-3">Optional. No margin figure is shown until this is set — never fabricated.</p>
        <div className="flex flex-wrap items-end gap-2">
          <select className={field} value={revenueForm.clientId} onChange={(e) => setRevenueForm({ ...revenueForm, clientId: e.target.value })}><option value="">Client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input type="number" min="0" step="0.01" className={field} placeholder="EUR / month" value={revenueForm.amount} onChange={(e) => setRevenueForm({ ...revenueForm, amount: e.target.value })} />
          <Button size="sm" variant="primary" disabled={busy || !revenueForm.clientId} onClick={() => void saveRevenue()}>Save</Button>
        </div>
      </div>
    </div>
    {loading ? <p className="text-2xs text-paper-3">Loading…</p> : <div className="space-y-1">
      {summary.filter((row) => row.total_cost > 0 || row.monthly_revenue_estimate != null).map((row) => <div key={row.client_id} className="rounded border border-line bg-ink p-2 text-2xs">
        <div className="flex flex-wrap items-center gap-2"><span className="text-paper">{row.client_name}</span><span className="text-paper-3">Total cost: €{row.total_cost.toFixed(2)}{row.estimated_margin != null && ` · Estimated margin: €${row.estimated_margin.toFixed(2)}`}</span></div>
        {row.cost_by_category && <p className="mt-1 text-paper-3">{Object.entries(row.cost_by_category).map(([cat, amt]) => `${COST_CATEGORY_LABEL[cat as CostCategory] ?? cat}: €${Number(amt).toFixed(2)}`).join(" · ")}</p>}
      </div>)}
      {summary.every((row) => row.total_cost === 0 && row.monthly_revenue_estimate == null) && <p className="text-2xs text-paper-3">No cost entries or revenue estimates recorded yet.</p>}
    </div>}
    <CsvImportSection clients={clients} onImported={() => void load()} />
    <FinancePeriodsSection clients={clients} />
  </div>;
}

function CsvImportSection({ clients, onImported }: { clients: Client[]; onImported: () => void }) {
  const [clientId, setClientId] = useState("");
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  async function doImport() {
    if (!clientId || !csvText.trim()) return;
    const { rows, errors } = parseCostEntriesCsv(csvText);
    setParseErrors(errors);
    if (errors.length > 0 || rows.length === 0) return;
    setBusy(true); setNotice(null);
    try {
      const count = await importCostEntries(clientId, rows);
      setNotice({ kind: "success", text: `${count} cost entries imported.` });
      setCsvText("");
      onImported();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  return <div className="rounded border border-line bg-ink-200 p-3">
    <h4 className="mb-1 text-xs font-medium text-paper">Bulk import cost entries (CSV)</h4>
    <p className="mb-2 text-2xs text-paper-3">One row per line: cost_category,amount,occurred_at[,notes]. An optional header row is skipped. The whole batch is all-or-nothing — one bad row rejects the import, nothing partial is written.</p>
    {notice && <p className={`mb-2 text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}
    {parseErrors.length > 0 && <div className="mb-2 space-y-0.5">{parseErrors.map((e, i) => <p key={i} className="text-2xs text-neg">{e}</p>)}</div>}
    <div className="flex flex-wrap items-start gap-2">
      <select className={field} value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">Client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <textarea
        className={`${field} min-h-[80px] w-full max-w-md font-mono`}
        placeholder={"model_spend,42.50,2026-07-15,Anthropic usage\nstorage,3.20,2026-07-16"}
        value={csvText}
        onChange={(e) => { setCsvText(e.target.value); setParseErrors([]); }}
      />
      <Button size="sm" variant="primary" disabled={busy || !clientId || !csvText.trim()} onClick={() => void doImport()}>Import</Button>
    </div>
  </div>;
}

const FINANCE_STATUS_COLOR: Record<FinancePeriodStatus, string> = { open: "text-paper-3", reconciled: "text-pos" };

function FinancePeriodsSection({ clients }: { clients: Client[] }) {
  const [periods, setPeriods] = useState<ClientFinancePeriodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [form, setForm] = useState({ clientId: "", periodStart: "", periodEnd: "" });
  const [revenueDraft, setRevenueDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setPeriods(await fetchFinancePeriods()); } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function open() {
    if (!form.clientId || !form.periodStart || !form.periodEnd) return;
    setBusy("open"); setNotice(null);
    try {
      await openFinancePeriod({ clientId: form.clientId, periodStart: form.periodStart, periodEnd: form.periodEnd });
      setForm({ clientId: form.clientId, periodStart: "", periodEnd: "" }); await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }
  async function reconcile(period: ClientFinancePeriodRow) {
    const revenue = Number(revenueDraft[period.id]);
    if (!Number.isFinite(revenue) || revenue < 0) return;
    setBusy(period.id); setNotice(null);
    try { await reconcileFinancePeriod(period.id, revenue); await load(); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;

  return <div className="space-y-2">
    <h4 className="text-xs font-medium text-paper">Finance periods</h4>
    <p className="text-2xs text-paper-3">A real accounting period with a reconciliation step — distinct from the mutable revenue estimate above. Once reconciled, total_cost/margin are a permanent snapshot, unaffected by cost entries added afterward.</p>
    {notice && <p className={`text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}
    <div className="flex flex-wrap items-end gap-2 rounded border border-line bg-ink-200 p-3">
      <select className={field} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Start</span><input type="date" className={field} value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">End</span><input type="date" className={field} value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></label>
      <Button size="sm" variant="secondary" disabled={busy === "open" || !form.clientId || !form.periodStart || !form.periodEnd} onClick={() => void open()}>Open period</Button>
    </div>
    {loading ? <p className="text-2xs text-paper-3">Loading…</p> : periods.length === 0 ? <p className="text-2xs text-paper-3">No finance periods yet.</p> : <div className="space-y-1">
      {periods.map((p) => <div key={p.id} className="rounded border border-line bg-ink p-2 text-2xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-paper">{clientName(p.client_id)}</span>
          <span className="text-paper-3 font-mono">{p.period_start} → {p.period_end}</span>
          <span className={`font-mono uppercase ${FINANCE_STATUS_COLOR[p.status]}`}>{p.status}</span>
        </div>
        {p.status === "reconciled" ? (
          <p className="mt-1 text-paper-2 font-mono tabular-nums">Revenue €{p.actual_revenue?.toFixed(2)} · Cost €{p.total_cost?.toFixed(2)} · Margin €{p.margin?.toFixed(2)}</p>
        ) : (
          <div className="mt-1 flex flex-wrap items-end gap-2">
            <input type="number" min="0" step="0.01" className={field} placeholder="Actual revenue (EUR)" value={revenueDraft[p.id] ?? ""} onChange={(e) => setRevenueDraft({ ...revenueDraft, [p.id]: e.target.value })} />
            <Button size="sm" variant="primary" disabled={busy === p.id || !revenueDraft[p.id]} onClick={() => void reconcile(p)}>Reconcile</Button>
          </div>
        )}
      </div>)}
    </div>}
  </div>;
}
