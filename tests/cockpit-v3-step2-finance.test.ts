// Cockpit v3 Step 2 -- Finance promoted to a real top-level page
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 2), following the same
// pattern already proven by the Automations and Team rehomes: extract the
// existing Operations > Operational Control > Cost & Margin tab's
// component into a shared file, render it from both the old tab and the
// new top-level page, hide-before-delete the old tab. Pure recomposition --
// same RPCs, same tables (Stage 2 Phase 08), confirmed by source-text
// checks below rather than a live render (no React component-test infra
// here).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const constantsPath = new URL("../src/lib/constants.ts", import.meta.url);
const appPath = new URL("../src/App.tsx", import.meta.url);
const financePagePath = new URL("../src/pages/FinancePage.tsx", import.meta.url);
const operationsControlPath = new URL("../src/components/operations/OperationsControlPanel.tsx", import.meta.url);
const costMarginSectionPath = new URL("../src/components/finance/CostMarginSection.tsx", import.meta.url);

test("routes and nav wiring: Finance is a new top-level page", async () => {
  const constants = await readFile(constantsPath, "utf8");
  assert.match(constants, /finance: "\/finance"/);
  assert.match(constants, /label: "Finance",\s*path: ROUTES\.finance/);
  const app = await readFile(appPath, "utf8");
  assert.match(app, /path=\{ROUTES\.finance\} element=\{<FinancePage \/>\}/);
});

test("CostMarginSection is a shared component, not duplicated between the old and new locations", async () => {
  const operationsControl = await readFile(operationsControlPath, "utf8");
  assert.match(operationsControl, /import\s*\{\s*CostMarginSection\s*\}\s*from\s*"@\/components\/finance\/CostMarginSection"/);
  // The tab-switch render call, not a redefinition -- confirms no second copy of the JSX exists in this file.
  assert.doesNotMatch(operationsControl, /^function CostMarginSection\(/m);

  const financePage = await readFile(financePagePath, "utf8");
  assert.match(financePage, /import\s*\{\s*CostMarginSection\s*\}\s*from\s*"@\/components\/finance\/CostMarginSection"/);
});

test("the old Operations Cost & Margin tab is hidden-before-delete: still present, not retired, per the plan's own discipline", async () => {
  const operationsControl = await readFile(operationsControlPath, "utf8");
  assert.match(operationsControl, /"cost"/);
  assert.match(operationsControl, /\{tab === "cost" && <CostMarginSection \/>\}/);
});

test("CostMarginSection is self-contained (fetches its own clients), matching the Workflows/Triggers/TeamRoles precedent of taking no clients prop", async () => {
  const section = await readFile(costMarginSectionPath, "utf8");
  assert.match(section, /export function CostMarginSection\(\)/);
  assert.match(section, /fetchClients\(\)/);
});

test("CostMarginSection reads the same finance RPCs/tables as before -- no new backend surface introduced by the rehome", async () => {
  const section = await readFile(costMarginSectionPath, "utf8");
  assert.match(section, /fetchMarginSummary/);
  assert.match(section, /openFinancePeriod/);
  assert.match(section, /reconcileFinancePeriod/);
  assert.match(section, /importCostEntries/);
  assert.match(section, /parseCostEntriesCsv/);
});
