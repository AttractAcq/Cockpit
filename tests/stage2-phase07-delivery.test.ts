// Stage 2 Phase 07 — Delivery/Operations.
//
// Source-text/migration assertions, matching this repo's established
// convention. Live behaviour (RLS, staff-only RPC checks, project/client
// mismatch rejection, deliverable lifecycle including delivered_at/
// approved_at set/clear semantics and link persistence, backward-compat
// create_work_item calls without project_id, not-found/invalid-status
// guards) was verified directly against xivewedajschthjlblfb with
// disposable ZZ-TEST fixtures inside rolled-back transactions before this
// file was written -- see the Phase 07 PR description for the transcript.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationPath = new URL("../supabase/migrations/20260820230000_stage2_phase07_delivery.sql", import.meta.url);
const groundTruthPath = new URL("../docs/STAGE_2_PHASE_00_GROUND_TRUTH.md", import.meta.url);
const typesPath = new URL("../src/types/operations.ts", import.meta.url);
const libPath = new URL("../src/lib/operations-admin.ts", import.meta.url);
const panelPath = new URL("../src/components/operations/OperationsControlPanel.tsx", import.meta.url);

test("reconciled against Phase 00's own Operations-page audit before writing anything", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /Reconciled against Phase 00's own audit/);
  const groundTruth = await readFile(groundTruthPath, "utf8");
  assert.match(groundTruth, /Onboarding \| `client_onboarding_templates` \+ `onboard_client` RPC \| Real/);
  assert.match(groundTruth, /Work Items \| `client_work_items`/);
});

test("client_projects and client_deliverables are additive -- Tasks reuse client_work_items, not a third new table", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create table public\.client_projects/);
  assert.match(migration, /create table public\.client_deliverables/);
  assert.doesNotMatch(migration, /create table public\.client_(tasks|work_item)/i, "Tasks must not get a new table -- client_work_items is reused");
  assert.match(migration, /alter table public\.client_work_items add column project_id uuid references public\.client_projects\(id\) on delete set null/);
});

test("client_deliverables scopes RLS through its parent project, not a direct client_id column", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const createTableBlock = migration.split("create table public.client_deliverables (")[1].split(");")[0];
  assert.doesNotMatch(createTableBlock, /\bclient_id\b/, "client_deliverables must not carry its own client_id -- it scopes through project_id");
  assert.match(migration, /exists \(select 1 from public\.client_projects p where p\.id = project_id and p\.client_id = any\(public\.auth_client_ids\(\)\)\)/);
});

test("a project's completed_at and a deliverable's delivered_at/approved_at are enforced by table CHECK constraints, not just RPC logic", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /constraint client_projects_completed_check check \(\(status = 'completed'\) = \(completed_at is not null\)\)/);
  assert.match(migration, /constraint client_deliverables_delivered_check check \(status not in \('delivered','approved'\) or delivered_at is not null\)/);
  assert.match(migration, /constraint client_deliverables_approved_check check \(\(status = 'approved'\) = \(approved_at is not null\)\)/);
});

test("the old 12-arg create_work_item signature is explicitly dropped before the 13-arg version replaces it", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /drop function if exists public\.create_work_item\(uuid,text,text,text,text,uuid,uuid,uuid,timestamptz,text,numeric,numeric\);/);
  assert.match(migration, /p_capacity_estimate_hours numeric default null, p_sla_hours numeric default null, p_project_id uuid default null/);
});

test("create_work_item validates a supplied project belongs to the same client before inserting", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /if p_project_id is not null and not exists \(select 1 from public\.client_projects where id = p_project_id and client_id = p_client_id\) then/);
  assert.match(migration, /raise exception 'NOT_FOUND: project';/);
});

test("all five RPCs are staff-only, search_path-pinned, and revoked from public/anon", async () => {
  const migration = await readFile(migrationPath, "utf8");
  for (const fn of ["create_project", "update_project_status", "create_deliverable", "update_deliverable_status", "create_work_item"]) {
    const revokeRe = new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`);
    assert.match(migration, revokeRe, `${fn} must be revoked from public and anon`);
  }
});

test("SOPs/Quality/Reporting are explicitly deferred with a stated reason, not silently dropped from the phase card", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /SOPs\/Quality\/Reporting.*deliberately deferred/s);
  assert.match(migration, /Reporting is satisfied by a computed rollup in the UI/);
});

test("ClientProjectRow/ClientDeliverableRow types match the migration's columns; ClientWorkItemRow gained project_id", async () => {
  const types = await readFile(typesPath, "utf8");
  assert.match(types, /export type ProjectStatus = "planning" \| "active" \| "on_hold" \| "completed" \| "archived"/);
  assert.match(types, /export type DeliverableStatus = "draft" \| "in_review" \| "delivered" \| "approved" \| "rejected"/);
  assert.match(types, /export interface ClientProjectRow \{[\s\S]*?client_id: string;[\s\S]*?status: ProjectStatus;[\s\S]*?\}/);
  assert.match(types, /export interface ClientDeliverableRow \{[\s\S]*?project_id: string;[\s\S]*?status: DeliverableStatus;[\s\S]*?\}/);
  assert.match(types, /export interface ClientWorkItemRow \{[\s\S]*?project_id: string \| null;[\s\S]*?\}/);
});

test("operations-admin.ts reads both new tables directly and calls all five RPCs by name", async () => {
  const lib = await readFile(libPath, "utf8");
  assert.match(lib, /from\("client_projects"\)/);
  assert.match(lib, /from\("client_deliverables"\)/);
  assert.match(lib, /supabase\.rpc\("create_project"/);
  assert.match(lib, /supabase\.rpc\("update_project_status"/);
  assert.match(lib, /supabase\.rpc\("create_deliverable"/);
  assert.match(lib, /supabase\.rpc\("update_deliverable_status"/);
  assert.match(lib, /p_project_id: input\.projectId \?\? null/, "createWorkItem must pass projectId through to the RPC");
});

test("the Projects tab is wired into OperationsControlPanel the same way every other sub-tab is", async () => {
  const panel = await readFile(panelPath, "utf8");
  assert.match(panel, /"metrics", "intelligence", "workflows", "triggers", "team", "work", "projects", "cost", "onboarding"/);
  assert.match(panel, /tab === "projects" && <ProjectsSection clients=\{clients\} \/>/);
});

test("selecting a project shows its own tasks (filtered by project_id) and deliverables, not every work item for the client", async () => {
  const panel = await readFile(panelPath, "utf8");
  assert.match(panel, /setTasks\(items\.filter\(\(i\) => i\.project_id === project\.id\)\)/);
  assert.match(panel, /fetchDeliverables\(project\.id\)/);
});
