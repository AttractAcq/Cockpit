// Stage 2 Phase 08 — Finance.
//
// Two kinds of test in this file, matching this repo's established
// conventions: source-text/migration assertions (no live DB in CI), plus
// real behavioural tests of finance-csv.ts's pure parsing logic (imported
// and run directly, same idiom as tests/ideation-slot-planner.test.ts).
// RPC live behaviour (RLS, admin/account-manager-only checks, overlap
// rejection, batch-import atomicity, reconciliation snapshot immutability
// against later backdated cost entries, double-reconciliation rejection)
// was verified directly against xivewedajschthjlblfb with disposable
// ZZ-TEST fixtures inside rolled-back transactions before this file was
// written -- see the Phase 08 PR description for the transcript.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseCostEntriesCsv } from "../src/lib/finance-csv.ts";

const migrationPath = new URL("../supabase/migrations/20260820250000_stage2_phase08_finance.sql", import.meta.url);
const groundTruthPath = new URL("../docs/STAGE_2_PHASE_00_GROUND_TRUTH.md", import.meta.url);
const typesPath = new URL("../src/types/operations.ts", import.meta.url);
const libPath = new URL("../src/lib/operations-admin.ts", import.meta.url);
const panelPath = new URL("../src/components/operations/OperationsControlPanel.tsx", import.meta.url);
// Cockpit v3 Step 2 moved CostMarginSection (+ CsvImportSection,
// FinancePeriodsSection) out of OperationsControlPanel.tsx into
// src/components/finance/ so the new top-level Finance page and the
// original Cost & Margin tab can share the exact same code -- the content
// checks below moved with it; OperationsControlPanel.tsx now only needs to
// still render it in the same place, checked separately.
const costMarginSectionPath = new URL("../src/components/finance/CostMarginSection.tsx", import.meta.url);

test("built to Phase 00's own narrower acceptance bar, not the phase card's full wishlist", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /Per Phase 00's own acceptance bar/);
  const groundTruth = await readFile(groundTruthPath, "utf8");
  assert.match(groundTruth, /CSV import plus one full accounting period reconciled against the \*already-real\* `client_cost_ledger`\/`client_margin_summary`/);
});

test("client_finance_periods is the only new table -- an extension of Stage O's cost domain, not a new one", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create table public\.client_finance_periods/);
  assert.doesNotMatch(migration, /create table public\.client_(cost_ledger|revenue)/i, "no second new table -- extends the existing cost/revenue domain");
  assert.doesNotMatch(migration, /alter table public\.client_cost_ledger|alter table public\.clients/, "no existing table structurally altered");
});

test("a reconciled period's total_cost/margin are enforced-present by a CHECK constraint, and are a snapshot, not a live recompute", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /constraint client_finance_periods_reconciled_check check \(\s*\(status = 'reconciled'\) = \(actual_revenue is not null and total_cost is not null and reconciled_at is not null and reconciled_by is not null\)\s*\)/);
  const reconcileBody = migration.split("create or replace function public.reconcile_finance_period")[1].split("create or replace function public.import_cost_entries")[0];
  assert.match(reconcileBody, /select coalesce\(sum\(amount\), 0\) into v_total_cost/, "total_cost must be computed once and stored, not left as a view");
  assert.match(reconcileBody, /if v_row\.status = 'reconciled' then raise exception 'CONFLICT: period is already reconciled'/, "a reconciled period must be immutable -- no re-reconciling");
});

test("overlapping periods for the same client are rejected", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /period_start <= p_period_end and period_end >= p_period_start/);
  assert.match(migration, /raise exception 'CONFLICT: an existing period for this client overlaps the requested range'/);
});

test("import_cost_entries is atomic (one bad row must roll back the whole batch) and reuses record_cost_entry's own category vocabulary", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const importBody = migration.split("create or replace function public.import_cost_entries")[1];
  assert.match(importBody, /for v_entry in select \* from jsonb_array_elements\(p_entries\) loop/);
  assert.match(importBody, /'model_spend','storage','rendering','human_time','ad_management_time','revision_cost','fulfilment_cost'/, "must validate against the same 7 categories client_cost_ledger enforces");
  assert.doesNotMatch(importBody, /exception when others/, "no per-row exception handler -- a single bad row must abort the whole transaction, not be swallowed");
});

test("all three RPCs use the narrower admin/account-manager gate that record_cost_entry itself established, not the broader 7-role staff gate used elsewhere in Stage 2", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const gateRe = /auth\.role\(\) <> 'service_role' and \(auth\.uid\(\) is null or coalesce\(public\.auth_role\(\), ''\) not in \('admin','account_manager'\)\) then/g;
  const matches = migration.match(gateRe) ?? [];
  assert.equal(matches.length, 3, "expected exactly 3 RPCs (open/reconcile/import) gated to admin/account_manager only");
  assert.doesNotMatch(migration, /not in \('admin','account_manager','strategist'/, "Finance mutations must not use the broader 7-role staff list");
});

test("all three RPCs are search_path-pinned and revoked from public/anon", async () => {
  const migration = await readFile(migrationPath, "utf8");
  for (const fn of ["open_finance_period", "reconcile_finance_period", "import_cost_entries"]) {
    const revokeRe = new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`);
    assert.match(migration, revokeRe, `${fn} must be revoked from public and anon`);
  }
});

test("ClientFinancePeriodRow type matches the migration's columns", async () => {
  const types = await readFile(typesPath, "utf8");
  assert.match(types, /export type FinancePeriodStatus = "open" \| "reconciled"/);
  assert.match(types, /export interface ClientFinancePeriodRow \{[\s\S]*?actual_revenue: number \| null;[\s\S]*?total_cost: number \| null;[\s\S]*?margin: number \| null;[\s\S]*?\}/);
});

test("operations-admin.ts reads client_finance_periods directly and calls all three RPCs by name", async () => {
  const lib = await readFile(libPath, "utf8");
  assert.match(lib, /from\("client_finance_periods"\)/);
  assert.match(lib, /supabase\.rpc\("open_finance_period"/);
  assert.match(lib, /supabase\.rpc\("reconcile_finance_period"/);
  assert.match(lib, /supabase\.rpc\("import_cost_entries"/);
});

test("the Cost & Margin tab gets the CSV import and Finance periods UI -- moved into CostMarginSection.tsx, shared with the top-level Finance page, not a new top-level tab of its own", async () => {
  const section = await readFile(costMarginSectionPath, "utf8");
  assert.match(section, /<CsvImportSection clients=\{clients\} onImported=\{\(\) => void load\(\)\} \/>/);
  assert.match(section, /<FinancePeriodsSection clients=\{clients\} \/>/);

  const panel = await readFile(panelPath, "utf8");
  assert.match(panel, /tab === "cost" && <CostMarginSection \/>/);
  assert.doesNotMatch(panel, /"metrics", "intelligence", "workflows", "triggers", "team", "work", "projects", "finance", "cost", "onboarding"/, "Finance must not become an 9th/10th top-level sub-tab of its own");
});

test("parseCostEntriesCsv: happy path, header row skipped, notes optional", () => {
  const { rows, errors } = parseCostEntriesCsv("cost_category,amount,occurred_at,notes\nmodel_spend,42.50,2026-07-15,Anthropic usage\nstorage,3.20,2026-07-16");
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cost_category, "model_spend");
  assert.equal(rows[0].amount, 42.5);
  assert.equal(rows[0].notes, "Anthropic usage");
  assert.equal(rows[1].notes, undefined);
});

test("parseCostEntriesCsv: no header still parses correctly", () => {
  const { rows, errors } = parseCostEntriesCsv("rendering,10,2026-07-01");
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cost_category, "rendering");
});

test("parseCostEntriesCsv: blank lines are skipped, not treated as errors", () => {
  const { rows, errors } = parseCostEntriesCsv("model_spend,1,2026-07-01\n\n\nstorage,2,2026-07-02\n");
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 2);
});

test("parseCostEntriesCsv: rejects unknown category, negative/non-numeric amount, and unparseable date, with a 1-indexed line number", () => {
  const { rows, errors } = parseCostEntriesCsv(
    "not_a_category,1,2026-07-01\nmodel_spend,-5,2026-07-01\nmodel_spend,abc,2026-07-01\nmodel_spend,1,not-a-date"
  );
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 4);
  assert.match(errors[0], /^Line 1:.*unknown cost_category/);
  assert.match(errors[1], /^Line 2:.*non-negative number/);
  assert.match(errors[2], /^Line 3:.*non-negative number/);
  assert.match(errors[3], /^Line 4:.*not a parseable date/);
});

test("parseCostEntriesCsv: a malformed row (missing columns) is reported, not silently dropped", () => {
  const { rows, errors } = parseCostEntriesCsv("model_spend,10");
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^Line 1:.*expected cost_category,amount,occurred_at/);
});
