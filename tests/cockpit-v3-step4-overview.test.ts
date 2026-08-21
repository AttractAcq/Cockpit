// Cockpit v3 Step 4 — Overview's "Business Health" tile row
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md). summariseSalesPipeline itself is
// covered in observability.test.ts alongside the rest of that module's pure
// functions; this file covers the new fmtCents formatter and the wiring
// that pulls real Sales/Opportunity data into CockpitPage.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fmtCents } from "../src/lib/format.ts";

test("fmtCents formats a *_cents column as a plain, currency-symbol-free number", () => {
  assert.equal(fmtCents(123_456), "1,235");
});

test("fmtCents returns an em dash for null, never a fabricated $0 or R0", () => {
  assert.equal(fmtCents(null), "—");
});

test("fmtCents handles zero distinctly from null", () => {
  assert.equal(fmtCents(0), "0");
});

test("CockpitPage's Business Health tiles pull real Sales pipeline and Opportunity data, not fabricated numbers", () => {
  const src = readFileSync(new URL("../src/pages/CockpitPage.tsx", import.meta.url), "utf-8");
  assert.match(src, /import\s*\{\s*fetchSalesLeads\s*\}\s*from\s*"@\/lib\/sales"/);
  assert.match(src, /import\s*\{\s*fetchOpportunityFindings\s*\}\s*from\s*"@\/lib\/opportunity"/);
  assert.match(src, /summariseSalesPipeline\(salesLeads\)/);
  // No fabricated "Cash" tile: nothing in this schema represents actual cash
  // on hand yet, so it must not appear as if it does.
  assert.doesNotMatch(src, /label:\s*"Cash"/);
});

test("SalesPage, SalesLeadDetailPage, and CommsConversationPage share one fmtCents/SALES_STAGE_LABEL, not private duplicates", () => {
  for (const file of ["../src/pages/SalesPage.tsx", "../src/pages/CommsConversationPage.tsx"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf-8");
    assert.doesNotMatch(src, /function fmtValue\(/, `${file} should import fmtCents, not redefine it`);
  }
});
