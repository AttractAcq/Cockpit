// Stage 2 Phase 01 — Overview / Command Center.
//
// Source-text/architecture-boundary assertions, matching this repo's
// established convention for verifying migration and wiring shape without a
// live database. Live behaviour (RLS, admin-only RPC checks, double-resolve
// rejection) was verified directly against xivewedajschthjlblfb with
// disposable ZZ-TEST fixtures inside a rolled-back transaction before this
// file was written -- see the Phase 01 PR description for the transcript.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationPath = new URL("../supabase/migrations/20260820120000_stage2_phase01_command_center_notes.sql", import.meta.url);
const libPath = new URL("../src/lib/command-center.ts", import.meta.url);
const cockpitPagePath = new URL("../src/pages/CockpitPage.tsx", import.meta.url);
const observabilityPath = new URL("../src/lib/observability.ts", import.meta.url);
const typesPath = new URL("../src/types/operations.ts", import.meta.url);

test("command_center_notes is additive, cross-business (no client_id), and RLS-protected", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create table public\.command_center_notes/);
  assert.doesNotMatch(migration, /client_id uuid not null references public\.clients/, "notes are cross-business, not per-client");
  assert.match(migration, /alter table public\.command_center_notes enable row level security/);
  assert.match(migration, /revoke all on public\.command_center_notes from public, anon, authenticated/);
  assert.match(migration, /command_center_notes_category_check check \(category in \('bottleneck','priority'\)\)/);
  assert.match(migration, /command_center_notes_resolved_check check \(\(resolved_at is null\) = \(resolved_by is null\)\)/);
});

test("both RPCs are admin-only, search_path-pinned, and revoked from public/anon", async () => {
  const migration = await readFile(migrationPath, "utf8");
  for (const fn of ["add_command_center_note", "resolve_command_center_note"]) {
    const revokeRe = new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`);
    assert.match(migration, revokeRe, `${fn} must be revoked from public and anon`);
  }
  // Both function bodies pin an empty search_path (Stage O's convention) and
  // reject anyone who isn't role='admin' before touching the table.
  const bodies = migration.split(/create or replace function public\./).slice(1);
  const addBody = bodies.find((b) => b.startsWith("add_command_center_note"));
  const resolveBody = bodies.find((b) => b.startsWith("resolve_command_center_note"));
  assert.ok(addBody && resolveBody, "both function bodies must be present");
  for (const body of [addBody!, resolveBody!]) {
    assert.match(body, /security definer set search_path = ''/);
    assert.match(body, /coalesce\(public\.auth_role\(\), ''\) <> 'admin' then raise exception 'AUTH: admin role required'/);
  }
});

test("resolve_command_center_note fails closed on an already-resolved note", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /if v_row\.resolved_at is not null then raise exception 'CONFLICT: note already resolved'/);
});

test("both mutations are logged to activity_log with client_id null (cross-business event)", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const inserts = migration.match(/insert into public\.activity_log \(client_id, actor_id,[^;]*values \(\s*null,/gs) ?? [];
  assert.equal(inserts.length, 2, "both add and resolve should log a null-client_id activity_log row");
});

test("command-center.ts calls the RPCs by name and reads the table directly", async () => {
  const lib = await readFile(libPath, "utf8");
  assert.match(lib, /from\("command_center_notes"\)/);
  assert.match(lib, /supabase\.rpc\("add_command_center_note", \{ p_category: category, p_body: body \}\)/);
  assert.match(lib, /supabase\.rpc\("resolve_command_center_note", \{ p_note_id: noteId \}\)/);
});

test("CockpitPage reuses the existing observability functions rather than a new metric implementation", async () => {
  const page = await readFile(cockpitPagePath, "utf8");
  const observability = await readFile(observabilityPath, "utf8");
  for (const fn of ["computePublishSuccessRate", "summariseExceptions", "summariseQueueAge", "summariseApprovalDelays"]) {
    assert.match(page, new RegExp(fn), `CockpitPage should call ${fn}`);
    assert.match(observability, new RegExp(`export function ${fn}`), `${fn} should still be the shared implementation`);
  }
  // Same three tables Operations > Operational Control > Metrics reads --
  // no new schema, no duplicated aggregation logic.
  assert.match(page, /from\("client_publish_attempts"\)/);
  assert.match(page, /from\("client_exception_queue"\)/);
  assert.match(page, /from\("client_work_items"\)/);
});

test("Bottleneck/Priority note authoring is gated to the admin role in the UI, matching the RPC's own check", async () => {
  const page = await readFile(cockpitPagePath, "utf8");
  assert.match(page, /role === "admin"/);
  assert.match(page, /addCommandCenterNote/);
  assert.match(page, /resolveCommandCenterNote/);
});

test("CommandCenterNoteRow type matches the migration's columns", async () => {
  const types = await readFile(typesPath, "utf8");
  assert.match(types, /export type CommandCenterNoteCategory = "bottleneck" \| "priority"/);
  assert.match(types, /export interface CommandCenterNoteRow \{[\s\S]*?resolved_at: string \| null;[\s\S]*?\}/);
});
