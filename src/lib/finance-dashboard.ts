// Cockpit v3 Step 4 — Finance dashboard. Pure aggregation over already-real
// Phase 08 data (client_finance_periods), matching the observability.ts /
// finance-csv.ts precedent of pure logic kept out of the component so it's
// directly unit-testable. No new RPC, no new query, no new mutation surface
// -- this step's own text asks for exactly that ("no new mutation surface
// beyond what Phase 08 already shipped"): fetchFinancePeriods() and
// fetchMarginSummary() already exist and already return everything this
// needs.
//
// Deliberately no forecasting figure: real forecasting needs a real trend
// across multiple reconciled periods, and as of this module there are zero
// reconciled periods in production -- fabricating one would be exactly the
// premature/invented-number mistake this codebase's discipline forbids.

export interface FinancePeriodLike {
  status: "open" | "reconciled";
  actual_revenue: number | null;
  total_cost: number | null;
  margin: number | null;
}

export interface FinanceDashboardSummary {
  reconciledCount: number;
  openCount: number;
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  /** null when there's no reconciled revenue to compute a percentage from -- never a fabricated 0%. */
  averageMarginPercent: number | null;
}

export function summariseFinancePeriods(periods: readonly FinancePeriodLike[]): FinanceDashboardSummary {
  const reconciled = periods.filter((p) => p.status === "reconciled");
  const open = periods.filter((p) => p.status === "open");
  const totalRevenue = reconciled.reduce((sum, p) => sum + (p.actual_revenue ?? 0), 0);
  const totalCost = reconciled.reduce((sum, p) => sum + (p.total_cost ?? 0), 0);
  const totalMargin = reconciled.reduce((sum, p) => sum + (p.margin ?? 0), 0);
  return {
    reconciledCount: reconciled.length,
    openCount: open.length,
    totalRevenue,
    totalCost,
    totalMargin,
    averageMarginPercent: totalRevenue > 0 ? Math.round((totalMargin / totalRevenue) * 1000) / 10 : null,
  };
}
