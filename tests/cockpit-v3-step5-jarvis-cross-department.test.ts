// Cockpit v3 Step 5 (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md) — extending
// jarvis-turn's tool surface to read across departments (Sales, Finance,
// Opportunity OS), not just Marketing's sub-systems. All three are 'free'
// (read-only) tools -- this step's own text defers gated execution until
// read/recommend has real usage, so no new toggle/floor tool is added here.
//
// Deno edge-function code, imported directly the same way
// tests/ad-studio.test.ts already imports from _shared/ -- no live call
// against a deployed jarvis-turn was made this session (this remote
// session cannot reach deployed edge functions at all, a known,
// previously-documented constraint), so this file verifies the tool
// definitions and dispatcher wiring directly instead.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { JARVIS_TOOLS, JARVIS_TOOL_GATES } from "../supabase/functions/_shared/jarvis/tools.ts";

const NEW_TOOLS = ["list_sales_pipeline", "list_finance_periods", "list_opportunity_findings"];

test("every JARVIS_TOOL_GATES key has a matching JARVIS_TOOLS schema, and vice versa -- no drift", () => {
  const gateNames = new Set(Object.keys(JARVIS_TOOL_GATES));
  const schemaNames = new Set(JARVIS_TOOLS.map((t) => t.name));
  assert.deepEqual(gateNames, schemaNames);
});

test("the three new cross-department tools are registered as read-only ('free')", () => {
  for (const name of NEW_TOOLS) {
    assert.equal(JARVIS_TOOL_GATES[name], "free", `${name} should be free (read-only)`);
  }
});

test("no write/execution tool was added for Sales, Finance, or Opportunity OS -- gated execution is deliberately deferred", () => {
  // Deliberately not a bare /opportunity/i match: create_ad_opportunity is a
  // real, pre-existing Ad Studio tool (ad_opportunities table) unrelated to
  // Opportunity OS -- this checks for the new departments specifically.
  const toggleOrFloor = Object.entries(JARVIS_TOOL_GATES).filter(([, gate]) => gate !== "free").map(([name]) => name);
  for (const name of toggleOrFloor) {
    assert.ok(
      !/^sales_|_sales_|^finance_|_finance_|opportunity_os|opportunity_finding/i.test(name),
      `${name} looks like a Sales/Finance/Opportunity-OS write tool -- Step 5's own text defers gated execution until read/recommend has real usage`,
    );
  }
});

test("the dispatcher resolves Sales through the business linked to the client, since sales_leads is business-scoped not client-scoped", () => {
  const dispatcher = readFileSync(new URL("../supabase/functions/_shared/jarvis/dispatcher.ts", import.meta.url), "utf-8");
  assert.match(dispatcher, /case "list_sales_pipeline":/);
  assert.match(dispatcher, /from\("businesses"\)\.select\("id"\)\.eq\("client_id", clientId\)/);
  assert.match(dispatcher, /case "list_finance_periods":/);
  assert.match(dispatcher, /case "list_opportunity_findings":/);
});
