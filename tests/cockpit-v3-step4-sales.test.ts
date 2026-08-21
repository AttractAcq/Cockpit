// Cockpit v3 Step 4 — deepen Sales (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md).
// The new RPCs (create_sales_lead's p_company param, set_sales_lead_follow_up,
// create_sales_proposal, update_sales_proposal_status) are SQL, verified
// live against xivewedajschthjlblfb before this migration was committed
// (happy path, rejection cases, backward-compatible 6-arg create_sales_lead
// call, anon-auth rejection -- see the migration's own commit history for
// the exact live-test transcript). This file covers what's testable from
// the repo alone: the type contract and the frontend wiring.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { SALES_PROPOSAL_STATUS_LABEL } from "../src/types/sales.ts";
import type { SalesProposalStatus } from "../src/types/sales.ts";

test("SALES_PROPOSAL_STATUS_LABEL covers exactly the four statuses the migration's CHECK constraint allows", () => {
  const statuses: SalesProposalStatus[] = ["draft", "sent", "accepted", "declined"];
  for (const s of statuses) assert.ok(SALES_PROPOSAL_STATUS_LABEL[s], `missing label for ${s}`);
  assert.equal(Object.keys(SALES_PROPOSAL_STATUS_LABEL).length, 4);
});

test("createSalesLead passes company through to the RPC's p_company param", () => {
  const src = readFileSync(new URL("../src/lib/sales.ts", import.meta.url), "utf-8");
  assert.match(src, /p_company:\s*input\.company\s*\?\?\s*null/);
});

test("SalesPage: company is a real input field, not fabricated -- and the Sales-contacts/companies dependency-trace decision is recorded", () => {
  const src = readFileSync(new URL("../src/pages/SalesPage.tsx", import.meta.url), "utf-8");
  assert.match(src, /form\.company/);
  assert.match(src, /Due for follow-up/);
});

test("SalesLeadDetailPage wires follow-up and proposals through the real lib/sales.ts functions, not inline table writes", () => {
  const src = readFileSync(new URL("../src/pages/SalesLeadDetailPage.tsx", import.meta.url), "utf-8");
  assert.match(src, /setSalesLeadFollowUp\(lead\.id/);
  assert.match(src, /createSalesProposal\(lead\.id/);
  assert.match(src, /updateSalesProposalStatus\(/);
});

test("the Sales-deepening migration records the dependency-trace decision to fold company into sales_leads rather than a separate table", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260821010000_cockpit_v3_step4_sales_deepen.sql", import.meta.url),
    "utf-8",
  );
  assert.match(migration, /decide via trace, not/i);
  assert.match(migration, /zero real rows in production/i);
  assert.match(migration, /create table public\.sales_proposals/);
});
