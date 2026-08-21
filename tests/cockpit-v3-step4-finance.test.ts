// Cockpit v3 Step 4 — Finance dashboard (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md).
// Third and last piece of Step 4. summariseFinancePeriods is pure, tested
// directly. No new RPC/mutation surface, so there's nothing new to
// live-test against xivewedajschthjlblfb beyond what Phase 08 already
// verified -- this file covers the aggregation logic and the frontend
// wiring.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { summariseFinancePeriods } from "../src/lib/finance-dashboard.ts";
import type { FinancePeriodLike } from "../src/lib/finance-dashboard.ts";

test("summariseFinancePeriods only counts reconciled periods toward the revenue/cost/margin totals", () => {
  const periods: FinancePeriodLike[] = [
    { status: "reconciled", actual_revenue: 1000, total_cost: 400, margin: 600 },
    { status: "reconciled", actual_revenue: 500, total_cost: 200, margin: 300 },
    { status: "open", actual_revenue: null, total_cost: null, margin: null },
  ];
  const result = summariseFinancePeriods(periods);
  assert.equal(result.reconciledCount, 2);
  assert.equal(result.openCount, 1);
  assert.equal(result.totalRevenue, 1500);
  assert.equal(result.totalCost, 600);
  assert.equal(result.totalMargin, 900);
  assert.equal(result.averageMarginPercent, 60);
});

test("summariseFinancePeriods with no reconciled periods reports zero totals and a null percent, never a fabricated 0%", () => {
  const result = summariseFinancePeriods([{ status: "open", actual_revenue: null, total_cost: null, margin: null }]);
  assert.equal(result.reconciledCount, 0);
  assert.equal(result.totalRevenue, 0);
  assert.equal(result.averageMarginPercent, null);
});

test("summariseFinancePeriods with no periods at all reports zero, not undefined or NaN", () => {
  const result = summariseFinancePeriods([]);
  assert.deepEqual(result, { reconciledCount: 0, openCount: 0, totalRevenue: 0, totalCost: 0, totalMargin: 0, averageMarginPercent: null });
});

test("FinancePage renders the dashboard above the existing Cost & Margin tools, reusing the same fetch calls -- no new query", () => {
  const page = readFileSync(new URL("../src/pages/FinancePage.tsx", import.meta.url), "utf-8");
  assert.match(page, /<FinanceDashboardSection \/>/);
  assert.match(page, /<CostMarginSection \/>/);
  // Dashboard must render before (above) the operational tools.
  assert.ok(page.indexOf("<FinanceDashboardSection") < page.indexOf("<CostMarginSection"));

  const dashboard = readFileSync(new URL("../src/components/finance/FinanceDashboardSection.tsx", import.meta.url), "utf-8");
  assert.match(dashboard, /import\s*\{\s*fetchFinancePeriods,\s*fetchMarginSummary\s*\}\s*from\s*"@\/lib\/operations-admin"/);
  // No fabricated forecast.
  assert.doesNotMatch(dashboard, /forecast(ed)?Revenue|projectedMargin/i);
});
