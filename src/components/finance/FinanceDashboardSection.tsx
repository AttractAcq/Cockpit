// Cockpit v3 Step 4 — Finance dashboard: a real-numbers summary sitting
// above the existing Cost & Margin operational tools (Phase 08). Reads
// exactly the data those tools already fetch (fetchFinancePeriods,
// fetchMarginSummary) -- no new RPC, no new query, no new mutation surface,
// matching this step's own text. Aggregation is the pure
// summariseFinancePeriods() in src/lib/finance-dashboard.ts.

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/primitives";
import { fetchClients } from "@/lib/api";
import { fetchFinancePeriods, fetchMarginSummary } from "@/lib/operations-admin";
import { summariseFinancePeriods } from "@/lib/finance-dashboard";
import type { Client } from "@/types/client";
import type { ClientFinancePeriodRow, ClientMarginSummaryRow } from "@/types/operations";

function fmtEUR(amount: number): string {
  return `€${amount.toFixed(2)}`;
}

export function FinanceDashboardSection() {
  const [clients, setClients] = useState<Client[]>([]);
  const [periods, setPeriods] = useState<ClientFinancePeriodRow[]>([]);
  const [marginSummary, setMarginSummary] = useState<ClientMarginSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [c, p, m] = await Promise.all([fetchClients(), fetchFinancePeriods(), fetchMarginSummary()]);
      setClients(c); setPeriods(p); setMarginSummary(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="text-2xs text-paper-3">Loading…</p>;
  if (error) return <p className="text-2xs text-neg">{error}</p>;

  const summary = summariseFinancePeriods(periods);
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Reconciled Revenue", value: fmtEUR(summary.totalRevenue), sub: `${summary.reconciledCount} reconciled period${summary.reconciledCount === 1 ? "" : "s"}` },
          { label: "Reconciled Cost", value: fmtEUR(summary.totalCost), sub: "same reconciled periods" },
          { label: "Reconciled Margin", value: fmtEUR(summary.totalMargin), sub: summary.averageMarginPercent != null ? `${summary.averageMarginPercent}% average` : "no reconciled revenue yet" },
          { label: "Open Periods", value: summary.openCount, sub: "awaiting reconciliation" },
        ].map((tile) => (
          <div key={tile.label} className="rounded-[10px] border border-line bg-ink-200 p-3.5 flex flex-col gap-1">
            <span className="text-2xs uppercase tracking-cap text-paper-3">{tile.label}</span>
            <span className="text-2xl font-mono text-paper">{tile.value}</span>
            <span className="text-2xs text-paper-3">{tile.sub}</span>
          </div>
        ))}
      </div>

      <Panel title="Margin by client" meta={`${marginSummary.length}`}>
        {marginSummary.filter((row) => row.total_cost > 0 || row.monthly_revenue_estimate != null).length === 0 ? (
          <p className="p-4 text-2xs text-paper-3">No cost entries or revenue estimates recorded yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line">
                {["Client", "Est. Monthly Revenue", "Total Cost", "Est. Margin"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-2xs uppercase tracking-cap text-paper-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {marginSummary
                .filter((row) => row.total_cost > 0 || row.monthly_revenue_estimate != null)
                .map((row) => (
                  <tr key={row.client_id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2.5 text-paper font-medium">{row.client_name}</td>
                    <td className="px-3 py-2.5 text-paper-2 font-mono tabular-nums">{row.monthly_revenue_estimate != null ? fmtEUR(row.monthly_revenue_estimate) : "—"}</td>
                    <td className="px-3 py-2.5 text-paper-2 font-mono tabular-nums">{fmtEUR(row.total_cost)}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums">{row.estimated_margin != null ? fmtEUR(row.estimated_margin) : "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Panel>

      {periods.length > 0 && (
        <Panel title="Reconciled periods" meta={`${summary.reconciledCount}`}>
          {summary.reconciledCount === 0 ? (
            <p className="p-4 text-2xs text-paper-3">No period has been reconciled yet — the dashboard above will fill in once one is.</p>
          ) : (
            <div className="space-y-1 p-2">
              {periods.filter((p) => p.status === "reconciled").map((p) => (
                <div key={p.id} className="rounded border border-line bg-ink p-2 text-2xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-paper">{clientName(p.client_id)}</span>
                    <span className="text-paper-3 font-mono">{p.period_start} → {p.period_end}</span>
                    <span className="ml-auto font-mono tabular-nums text-paper-2">
                      Revenue {fmtEUR(p.actual_revenue ?? 0)} · Cost {fmtEUR(p.total_cost ?? 0)} · Margin {fmtEUR(p.margin ?? 0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      <p className="text-2xs text-paper-3">
        Forecasting is deliberately not shown: it needs a real trend across multiple reconciled periods, and none exist yet — a projection built on zero real history would be a fabricated number, not a forecast.
      </p>
    </div>
  );
}
