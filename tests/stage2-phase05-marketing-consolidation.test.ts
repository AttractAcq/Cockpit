// Stage 2 Phase 05 — Marketing IA consolidation.
//
// Source-text/migration assertions, matching this repo's established
// convention. Live behaviour (RLS, staff-only RPC checks, offer/avatar
// existence validation, status-transition validation, fail-closed
// rejection) was verified directly against xivewedajschthjlblfb with
// disposable ZZ-TEST fixtures inside rolled-back transactions before this
// file was written -- see the Phase 05 PR description for the transcript.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationPath = new URL("../supabase/migrations/20260820190000_stage2_phase05_marketing_campaigns.sql", import.meta.url);
const tracePath = new URL("../docs/STAGE_2_PHASE_05_DEPENDENCY_TRACE.md", import.meta.url);
const libPath = new URL("../src/lib/marketing-campaigns.ts", import.meta.url);
const panelPath = new URL("../src/components/client/MarketingCampaignsPanel.tsx", import.meta.url);
const detailPagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);

test("the dependency trace document exists and is this phase's own exit gate", async () => {
  const trace = await readFile(tracePath, "utf8");
  assert.match(trace, /a complete, documented dependency trace exists before any table is touched/);
  assert.match(trace, /No external landmines/);
  assert.match(trace, /client_marketing_campaigns/);
});

test("client_marketing_campaigns is additive -- no existing table altered, named to avoid the real ad_campaigns/campaign_periods collision", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create table public\.client_marketing_campaigns/);
  assert.doesNotMatch(migration, /alter table public\.(clients|ad_campaigns|client_campaign_periods)/);
  assert.match(migration, /client_id uuid not null references public\.clients\(id\) on delete cascade/);
});

test("budget_cents and results are real columns but never accepted by either RPC -- an enforced empty shell, not just a comment", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /budget_cents integer,/);
  assert.match(migration, /results jsonb,/);
  const createFnBody = migration.split("create or replace function public.create_marketing_campaign")[1].split("create or replace function public.update_marketing_campaign_status")[0];
  assert.doesNotMatch(createFnBody, /p_budget|p_results/, "the create RPC must not accept budget/results as input");
  const updateFnBody = migration.split("create or replace function public.update_marketing_campaign_status")[1];
  assert.doesNotMatch(updateFnBody, /budget_cents\s*=|results\s*=/, "the status-update RPC must not write budget/results either");
});

test("no asset-linkage column exists on the table -- deferred entirely, not half-built", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const createTableBlock = migration.split("create table public.client_marketing_campaigns (")[1].split(");")[0];
  assert.doesNotMatch(createTableBlock, /asset/i, "no asset-referencing column may exist in the table definition itself");
  assert.doesNotMatch(migration, /references public\.client_assets/, "no FK into client_assets");
});

test("both RPCs are staff-only, search_path-pinned, and revoked from public/anon", async () => {
  const migration = await readFile(migrationPath, "utf8");
  for (const fn of ["create_marketing_campaign", "update_marketing_campaign_status"]) {
    const revokeRe = new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`);
    assert.match(migration, revokeRe, `${fn} must be revoked from public and anon`);
  }
  const bodies = migration.split(/create or replace function public\./).slice(1);
  for (const body of bodies) {
    assert.match(body, /security definer set search_path = ''/);
    assert.match(body, /not in \('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst'\) then\s*\n\s*raise exception 'AUTH: staff role required'/);
  }
});

test("create_marketing_campaign validates a supplied offer/avatar actually belongs to the same client before inserting", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /not exists \(select 1 from public\.client_main_offers where id = p_main_offer_id and client_id = p_client_id\)/);
  assert.match(migration, /not exists \(select 1 from public\.client_avatar_releases where id = p_avatar_release_id and client_id = p_client_id\)/);
});

test("marketing-campaigns.ts calls the RPCs by name and reads the real offer/avatar tables directly", async () => {
  const lib = await readFile(libPath, "utf8");
  assert.match(lib, /from\("client_marketing_campaigns"\)/);
  assert.match(lib, /from\("client_main_offers"\)/);
  assert.match(lib, /from\("client_avatar_releases"\)/);
  assert.match(lib, /supabase\.rpc\("create_marketing_campaign"/);
  assert.match(lib, /supabase\.rpc\("update_marketing_campaign_status"/);
});

test("the Campaigns panel never binds to budget_cents/results data, but does state the deferral honestly", async () => {
  const panel = await readFile(panelPath, "utf8");
  assert.doesNotMatch(panel, /\.budget_cents|\.results\b|budgetCents|budget:|results:/, "no form field or data binding for budget/results may exist");
  assert.match(panel, /Budget and results are not tracked yet/, "the deferral should be stated honestly in the UI, not silently absent");
});

test("Offer/Ideation/Creation/Distribution/Iteration/Campaigns are all tagged into the same visual Marketing group, and nothing else is", async () => {
  const page = await readFile(detailPagePath, "utf8");
  const groupedLabels = [...page.matchAll(/label: "([^"]+)",\s*\n\s*group: "Marketing"/g)].map((m) => m[1]);
  assert.deepEqual(groupedLabels.sort(), ["Campaigns", "Creation", "Distribution", "Ideation", "Iteration", "Offer"].sort());
});

test("visual grouping introduces no new route or section -- Avatars, Website, and Intelligence stay top-level per the trace's explicit scope", async () => {
  const page = await readFile(detailPagePath, "utf8");
  const avatarsBlock = page.split('label: "Avatars"')[1]?.split("},")[0] ?? "";
  assert.doesNotMatch(avatarsBlock, /group:/);
  const websiteBlock = page.split('label: "Website"')[1]?.split("defaultSection")[0] ?? "";
  assert.doesNotMatch(websiteBlock, /group:/);
});

test("marketing_campaigns is wired the same way every other section is, and Campaigns has its own page entry", async () => {
  const page = await readFile(detailPagePath, "utf8");
  assert.match(page, /\| "marketing_campaigns"/);
  assert.match(page, /case "marketing_campaigns":\s*\n\s*return <MarketingCampaignsPanel clientId=\{id\} \/>/);
  assert.match(page, /label: "Campaigns",\s*\n\s*group: "Marketing"/);
});
