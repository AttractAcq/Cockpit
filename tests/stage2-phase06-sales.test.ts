// Stage 2 Phase 06 — Sales.
//
// Source-text/migration assertions, matching this repo's established
// convention. Live behaviour (RLS, staff-only RPC checks, auto-advance on
// first logged conversation, lost_reason/closed_at fail-closed rejection
// and clearing on reopen, not-found/negative-value guards) was verified
// directly against xivewedajschthjlblfb with disposable ZZ-TEST fixtures
// inside rolled-back transactions before this file was written -- see the
// Phase 06 PR description for the transcript.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationPath = new URL("../supabase/migrations/20260820210000_stage2_phase06_sales.sql", import.meta.url);
const typesPath = new URL("../src/types/sales.ts", import.meta.url);
const libPath = new URL("../src/lib/sales.ts", import.meta.url);
const constantsPath = new URL("../src/lib/constants.ts", import.meta.url);
const appPath = new URL("../src/App.tsx", import.meta.url);
const listPagePath = new URL("../src/pages/SalesPage.tsx", import.meta.url);
const detailPagePath = new URL("../src/pages/SalesLeadDetailPage.tsx", import.meta.url);

test("sales_leads/sales_conversations are additive, cross-business (no client_id), keyed off businesses", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create table public\.sales_leads/);
  assert.match(migration, /create table public\.sales_conversations/);
  assert.match(migration, /business_id uuid not null references public\.businesses\(id\) on delete cascade/);
  const createTableBlock = migration.split("create table public.sales_leads (")[1].split(");")[0];
  assert.doesNotMatch(createTableBlock, /\bclient_id\b/, "sales_leads must not carry a client_id column -- a lead has no clients row yet");
  assert.doesNotMatch(migration, /alter table public\.(businesses|clients)/, "Phase 06 must not modify any existing table");
});

test("sales_conversations links to sales_leads, not directly to businesses", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /lead_id uuid not null references public\.sales_leads\(id\) on delete cascade/);
});

test("both tables are staff-only readable, not client-portal", async () => {
  const migration = await readFile(migrationPath, "utf8");
  for (const table of ["sales_leads", "sales_conversations"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
  }
  const policies = migration.match(/using \(coalesce\(public\.auth_role\(\), ''\) <> 'client'\)/g) ?? [];
  assert.equal(policies.length, 2, "both tables need their own staff-only select policy");
});

test("the pipeline stage is a flat 6-value check constraint", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /stage in \('lead','conversation','opportunity','follow_up','closed_won','closed_lost'\)/);
});

test("lost_reason is required exactly when closed_lost, and closed_at exactly when closed", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /constraint sales_leads_lost_reason_check check \(\(stage = 'closed_lost'\) = \(lost_reason is not null\)\)/);
  assert.match(migration, /constraint sales_leads_closed_at_check check \(\(stage in \('closed_won','closed_lost'\)\) = \(closed_at is not null\)\)/);
});

test("all four RPCs are staff-only, search_path-pinned, and revoked from public/anon", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const fns = ["create_sales_lead", "update_sales_lead_stage", "assign_sales_lead", "log_sales_conversation"];
  for (const fn of fns) {
    const revokeRe = new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`);
    assert.match(migration, revokeRe, `${fn} must be revoked from public and anon`);
  }
  const bodies = migration.split(/create or replace function public\./).slice(1, 5);
  assert.equal(bodies.length, 4, "expected exactly 4 RPCs defined in this migration");
  for (const body of bodies) {
    assert.match(body, /security definer set search_path = ''/);
    assert.match(body, /not in \('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst'\) then\s*\n\s*raise exception 'AUTH: staff role required'/);
  }
});

test("create_sales_lead validates the business exists and self-assigns the creator", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /if not exists \(select 1 from public\.businesses where id = p_business_id\) then\s*\n\s*raise exception 'NOT_FOUND: business'/);
  const body = migration.split("create or replace function public.create_sales_lead")[1].split("create or replace function public.update_sales_lead_stage")[0];
  assert.match(body, /assignee_id, created_by\)\s*\n\s*values \([\s\S]*?auth\.uid\(\), auth\.uid\(\)\)/);
});

test("update_sales_lead_stage clears lost_reason/closed_at when moving away from a closed stage (reopen)", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const body = migration.split("create or replace function public.update_sales_lead_stage")[1].split("create or replace function public.assign_sales_lead")[0];
  assert.match(body, /if p_new_stage <> 'closed_lost' then v_lost_reason := null; end if;/);
  assert.match(body, /closed_at = case when p_new_stage in \('closed_won','closed_lost'\) then now\(\) else null end/);
});

test("log_sales_conversation auto-advances a lead out of 'lead' stage on its first logged conversation only", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const body = migration.split("create or replace function public.log_sales_conversation")[1];
  assert.match(body, /if v_row\.stage = 'lead' then\s*\n\s*update public\.sales_leads set stage = 'conversation' where id = p_lead_id;/);
});

test("Communications Hub auto-logging is explicitly deferred, not silently missing", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /Communications Hub[\s\S]*?deferred to Phase 10/);
});

test("SalesLeadRow/SalesConversationRow types match the migration's columns", async () => {
  const types = await readFile(typesPath, "utf8");
  assert.match(types, /export type SalesLeadStage = "lead" \| "conversation" \| "opportunity" \| "follow_up" \| "closed_won" \| "closed_lost"/);
  assert.match(types, /export interface SalesLeadRow \{[\s\S]*?business_id: string;[\s\S]*?stage: SalesLeadStage;[\s\S]*?\}/);
  assert.match(types, /export interface SalesConversationRow \{[\s\S]*?lead_id: string;[\s\S]*?\}/);
});

test("sales.ts reads both tables directly and calls all four RPCs by name", async () => {
  const lib = await readFile(libPath, "utf8");
  assert.match(lib, /from\("sales_leads"\)/);
  assert.match(lib, /from\("sales_conversations"\)/);
  assert.match(lib, /supabase\.rpc\("create_sales_lead"/);
  assert.match(lib, /supabase\.rpc\("update_sales_lead_stage"/);
  assert.match(lib, /supabase\.rpc\("assign_sales_lead"/);
  assert.match(lib, /supabase\.rpc\("log_sales_conversation"/);
});

test("routes and nav wiring mirror the existing Businesses pattern", async () => {
  const constants = await readFile(constantsPath, "utf8");
  assert.match(constants, /sales: "\/sales"/);
  assert.match(constants, /salesLead: \(id: string\) => `\/sales\/\$\{id\}`/);
  assert.match(constants, /label: "Sales",\s*path: ROUTES\.sales/);
  const app = await readFile(appPath, "utf8");
  assert.match(app, /path=\{ROUTES\.sales\} element=\{<SalesPage \/>\}/);
  assert.match(app, /path="\/sales\/:id" element=\{<SalesLeadDetailPage \/>\}/);
});

test("the list page lets any staff member create a lead -- no admin-only gate, unlike Businesses", async () => {
  const list = await readFile(listPagePath, "utf8");
  assert.match(list, /createSalesLead/);
  assert.doesNotMatch(list, /role === "admin"/, "lead creation must not be admin-gated -- staff RPC role list is the real gate");
});

test("the detail page requires a lost reason before allowing a close-as-lost action", async () => {
  const detail = await readFile(detailPagePath, "utf8");
  assert.match(detail, /disabled=\{busy \|\| !lostReason\.trim\(\)\}/);
  assert.match(detail, /logSalesConversation/);
  assert.match(detail, /assignSalesLead/);
});
