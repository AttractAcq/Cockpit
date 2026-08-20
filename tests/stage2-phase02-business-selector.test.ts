// Stage 2 Phase 02 — Business Selector.
//
// Source-text/architecture-boundary assertions, matching this repo's
// established convention for verifying migration and wiring shape without a
// live database. Live behaviour (RLS, admin-only RPC checks, seed row,
// duplicate-slug/unknown-client/invalid-slug rejection) was verified
// directly against xivewedajschthjlblfb with disposable ZZ-TEST fixtures
// inside rolled-back transactions before this file was written -- see the
// Phase 02 PR description for the transcript. A real browser click-through
// was not possible in this session (no disposable test login could be
// created -- flagged to and accepted by the user) so this phase leans more
// heavily than usual on this file plus the live SQL verification.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationPath = new URL("../supabase/migrations/20260820150000_stage2_phase02_businesses.sql", import.meta.url);
const libPath = new URL("../src/lib/business.ts", import.meta.url);
const typesPath = new URL("../src/types/business.ts", import.meta.url);
const constantsPath = new URL("../src/lib/constants.ts", import.meta.url);
const appPath = new URL("../src/App.tsx", import.meta.url);
const listPagePath = new URL("../src/pages/BusinessesPage.tsx", import.meta.url);
const detailPagePath = new URL("../src/pages/BusinessDetailPage.tsx", import.meta.url);

test("businesses is additive and does not touch clients", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create table public\.businesses/);
  assert.doesNotMatch(migration, /alter table public\.clients/, "Phase 02 must not modify the existing clients table");
  assert.match(migration, /client_id uuid references public\.clients\(id\) on delete set null/, "the link to clients must be nullable");
});

test("businesses is staff-only readable, not client-portal", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /alter table public\.businesses enable row level security/);
  assert.match(migration, /revoke all on public\.businesses from public, anon, authenticated/);
  assert.match(migration, /using \(coalesce\(public\.auth_role\(\), ''\) <> 'client'\)/);
});

test("create_business is admin-only, search_path-pinned, and revoked from public/anon", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /revoke all on function public\.create_business\([^)]*\) from public, anon/);
  const body = migration.split("create or replace function public.create_business")[1];
  assert.ok(body, "create_business function body must be present");
  assert.match(body, /security definer set search_path = ''/);
  assert.match(body, /coalesce\(public\.auth_role\(\), ''\) <> 'admin' then raise exception 'AUTH: admin role required'/);
});

test("create_business validates the linked client exists before inserting", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /if p_client_id is not null and not exists \(select 1 from public\.clients where id = p_client_id\) then/);
  assert.match(migration, /raise exception 'NOT_FOUND: client'/);
});

test("the seed makes AA business row #1, linked to its existing internal clients row", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /insert into public\.businesses \(name, slug, client_id\)/);
  assert.match(migration, /select 'Attract Acquisition', 'attract-acquisition', c\.id/);
  assert.match(migration, /from public\.clients c\s*\nwhere c\.slug = 'attract-acquisition'/);
  assert.match(migration, /on conflict \(slug\) do nothing/);
});

test("business.ts reads the table directly and calls create_business by name", async () => {
  const lib = await readFile(libPath, "utf8");
  assert.match(lib, /from\("businesses"\)/);
  assert.match(lib, /supabase\.rpc\("create_business", \{ p_name: name, p_slug: slug, p_client_id: clientId \}\)/);
});

test("BusinessRow type matches the migration's columns", async () => {
  const types = await readFile(typesPath, "utf8");
  assert.match(types, /export interface BusinessRow \{[\s\S]*?client_id: string \| null;[\s\S]*?\}/);
});

test("routes mirror the existing client route pattern rather than reinventing one", async () => {
  const constants = await readFile(constantsPath, "utf8");
  assert.match(constants, /businesses: "\/businesses"/);
  assert.match(constants, /business: \(id: string\) => `\/businesses\/\$\{id\}`/);
});

test("the two new routes are wired into the app the same way client routes are", async () => {
  const app = await readFile(appPath, "utf8");
  assert.match(app, /path=\{ROUTES\.businesses\} element=\{<BusinessesPage \/>\}/);
  assert.match(app, /path="\/businesses\/:id" element=\{<BusinessDetailPage \/>\}/);
});

test("business creation is gated to the admin role in the UI, matching the RPC's own check", async () => {
  const list = await readFile(listPagePath, "utf8");
  assert.match(list, /role === "admin"/);
  assert.match(list, /createBusiness/);
});

test("the detail page offers a switcher between businesses -- the exit gate's actual interaction", async () => {
  const detail = await readFile(detailPagePath, "utf8");
  assert.match(detail, /Switch business/);
  assert.match(detail, /navigate\(ROUTES\.business\(e\.target\.value\)\)/);
});
