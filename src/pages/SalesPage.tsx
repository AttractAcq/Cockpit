// Stage 2 Phase 06 — Sales. The pipeline list view: every lead, across every
// business, filterable by business + stage. Mirrors BusinessesPage's
// list-then-detail pattern. No forecasting/quota rollups yet -- those get
// designed against real pipeline usage, not guessed at here (Principle 01).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState, Panel } from "@/components/primitives";
import { fetchSalesLeads, createSalesLead } from "@/lib/sales";
import { useBusinessContext } from "@/lib/business-context";
import type { SalesLeadRow, SalesLeadStage } from "@/types/sales";
import { SALES_STAGE_LABEL } from "@/types/sales";
import { ROUTES } from "@/lib/constants";
import { fmtRelative, fmtCents } from "@/lib/format";

const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";

const STAGE_COLOR: Record<SalesLeadStage, string> = {
  lead: "text-paper-3", conversation: "text-info", opportunity: "text-teal",
  follow_up: "text-warn", closed_won: "text-pos", closed_lost: "text-neg",
};

export function SalesPage() {
  const navigate = useNavigate();
  const { businesses, selectedBusinessId, setSelectedBusinessId } = useBusinessContext();
  const [leads, setLeads] = useState<SalesLeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stageFilter, setStageFilter] = useState("");
  const [form, setForm] = useState({ businessId: "", name: "", contactEmail: "", contactPhone: "", source: "", estimatedValue: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setLeads(await fetchSalesLeads());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Sales is business-native (Cockpit v3 §3) -- the pipeline filter is the
  // shared BusinessContext selection directly, not a page-local copy of it.
  useEffect(() => {
    if (selectedBusinessId && !form.businessId) setForm((f) => ({ ...f, businessId: selectedBusinessId }));
  }, [selectedBusinessId, form.businessId]);

  const businessName = (id: string) => businesses.find((b) => b.id === id)?.name ?? id;

  const visibleLeads = useMemo(() => leads.filter((l) =>
    (!selectedBusinessId || l.business_id === selectedBusinessId) && (!stageFilter || l.stage === stageFilter)
  ), [leads, selectedBusinessId, stageFilter]);

  async function submit() {
    if (!form.businessId || !form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const cents = form.estimatedValue.trim() ? Math.round(parseFloat(form.estimatedValue) * 100) : null;
      await createSalesLead({
        businessId: form.businessId, name: form.name, contactEmail: form.contactEmail || null,
        contactPhone: form.contactPhone || null, source: form.source || null, estimatedValueCents: cents,
      });
      setForm({ businessId: form.businessId, name: "", contactEmail: "", contactPhone: "", source: "", estimatedValue: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">Loading…</div>;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium text-paper">Sales</h1>
        <span className="text-2xs text-paper-3 font-mono">{visibleLeads.length} of {leads.length}</span>
      </div>
      {error && <p className="text-2xs text-neg">{error}</p>}

      <div className="flex flex-wrap items-end gap-2 rounded-[10px] border border-line bg-ink-200 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-paper-3">Business</span>
          <select className={field} value={form.businessId} onChange={(e) => setForm({ ...form, businessId: e.target.value })}>
            <option value="">Select…</option>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-paper-3">Name</span>
          <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-paper-3">Email (optional)</span>
          <input className={field} value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-paper-3">Phone (optional)</span>
          <input className={field} value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-paper-3">Source (optional)</span>
          <input className={field} placeholder="e.g. referral" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-paper-3">Est. value (optional)</span>
          <input className={field} placeholder="0.00" value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })} />
        </label>
        <Button size="sm" variant="primary" disabled={busy || !form.businessId || !form.name.trim()} onClick={() => void submit()}>Add lead</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={field} value={selectedBusinessId ?? ""} onChange={(e) => setSelectedBusinessId(e.target.value || null)}>
          <option value="">All businesses</option>
          {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className={field} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">All stages</option>
          {(Object.keys(SALES_STAGE_LABEL) as SalesLeadStage[]).map((s) => <option key={s} value={s}>{SALES_STAGE_LABEL[s]}</option>)}
        </select>
      </div>

      <Panel title="Pipeline" meta={`${visibleLeads.length}`}>
        {visibleLeads.length === 0 ? (
          <EmptyState icon="trending-up" title="No leads yet" body="Add one above to start the pipeline." />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line">
                {["Name", "Business", "Stage", "Est. Value", "Source", "Created"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-2xs uppercase tracking-cap text-paper-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleLeads.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => navigate(ROUTES.salesLead(l.id))}
                  className="border-b border-line last:border-b-0 hover:bg-ink-100 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2.5 text-paper font-medium">{l.name}</td>
                  <td className="px-3 py-2.5 text-paper-2">{businessName(l.business_id)}</td>
                  <td className={`px-3 py-2.5 font-mono uppercase ${STAGE_COLOR[l.stage]}`}>{SALES_STAGE_LABEL[l.stage]}</td>
                  <td className="px-3 py-2.5 text-paper-2 font-mono tabular-nums">{fmtCents(l.estimated_value_cents)}</td>
                  <td className="px-3 py-2.5 text-paper-3">{l.source ?? "—"}</td>
                  <td className="px-3 py-2.5 text-paper-3 font-mono">{fmtRelative(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
