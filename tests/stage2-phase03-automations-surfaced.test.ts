// Stage 2 Phase 03 — Automations, surfaced.
//
// Source-text/data assertions, matching this repo's established convention.
// Live behaviour (RLS, staff-only rejection, real pg_cron data shape) was
// verified directly against xivewedajschthjlblfb before this file was
// written -- see the Phase 03 PR description for the transcript.
//
// Cross-check step (this phase's own step 4): the audit that produced
// UNDOCUMENTED_DEPLOYMENTS found, by diffing the real deployed function
// list against this repo's registry, 3 live pg_cron jobs (publish-worker,
// insights-worker, facebook-insights-worker) and 21 deployed-but-unregistered
// functions (10 from an unmerged Facebook branch stack, one of them
// cron-triggered; 11 already-retired-but-undeleted Pipeline B/Ideation
// Phase 6 functions). This file checks that the UI's static dataset
// actually contains everything the audit found -- the audit itself is not
// re-runnable from a unit test (it required live Supabase + git remote
// access), but its result must not silently drift out of the checked-in
// source.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationPath = new URL("../supabase/migrations/20260820170000_stage2_phase03_automations_surfaced.sql", import.meta.url);
const libPath = new URL("../src/lib/workflows.ts", import.meta.url);
const panelPath = new URL("../src/components/operations/OperationsControlPanel.tsx", import.meta.url);
const registryPath = new URL("../supabase/functions/registry.json", import.meta.url);

test("list_scheduled_triggers is staff-only, revoked from public/anon, and never returns the raw command", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /security definer set search_path = ''/);
  assert.match(migration, /coalesce\(public\.auth_role\(\), ''\) = 'client' then raise exception 'AUTH: staff role required'/);
  assert.match(migration, /revoke all on function public\.list_scheduled_triggers\(\) from public, anon/);
  assert.doesNotMatch(migration, /return query\s+select\s+j\.command/i, "the raw command text (which embeds a vault secret reference) must never be selected");
  assert.match(migration, /\(regexp_match\(j\.command, 'functions\/v1\/\(\[a-z0-9-\]\+\)'\)\)\[1\] as target_function/);
});

test("the Workflows list is the real, governed registry -- not a second, driftable copy", async () => {
  const lib = await readFile(libPath, "utf8");
  const registry = JSON.parse(await readFile(registryPath, "utf8")) as { functions: unknown[] };
  assert.match(lib, /import registryJson from "\.\.\/\.\.\/supabase\/functions\/registry\.json"/);
  assert.ok(registry.functions.length > 0);
});

test("all 3 real pg_cron jobs found during the Phase 03 audit are accounted for by the UI's design", async () => {
  // The jobs themselves are fetched live via list_scheduled_triggers(), not
  // hardcoded -- this just confirms TriggersSection actually calls it and
  // flags targets that resolve to an undocumented deployment.
  const panel = await readFile(panelPath, "utf8");
  assert.match(panel, /fetchScheduledTriggers/);
  assert.match(panel, /unmergedTargets\.has\(t\.target_function\)/);
});

test("every undocumented deployment found in the audit is represented, correctly categorised", async () => {
  const lib = await readFile(libPath, "utf8");
  const auditFound = {
    unmerged_branch: [
      "collect-facebook-insights", "connect-facebook-page-destination", "create-facebook-rendition",
      "update-facebook-rendition", "review-facebook-rendition", "discover-facebook-pages",
      "publish-facebook-asset", "verify-facebook-destination-capability",
      "create-distribution-record-from-facebook-rendition", "manage-platform-experiment",
    ],
    retired_undeleted: [
      "approve-calendar-proposal", "create-calendar-proposal", "update-calendar-proposal-slot",
      "create-content-opportunity", "generate-content-opportunities", "score-content-opportunity",
      "update-content-opportunity-status", "create-distribution-record-from-content-item",
      "generate-content-brief", "review-content-brief", "route-content-brief-to-studio",
      "submit-production-review",
    ],
  };
  for (const slug of [...auditFound.unmerged_branch, ...auditFound.retired_undeleted]) {
    assert.match(lib, new RegExp(`slug: "${slug}"`), `${slug} must be present in UNDOCUMENTED_DEPLOYMENTS`);
  }
  // The one that's actually cron-triggered in production must say so.
  const collectFacebookBlock = lib.split('slug: "collect-facebook-insights"')[1]?.split("},")[0] ?? "";
  assert.match(collectFacebookBlock, /Cron-triggered hourly/);
});

test("undocumented deployments never appear in the local registry (that's what makes them undocumented)", async () => {
  const lib = await readFile(libPath, "utf8");
  const registry = JSON.parse(await readFile(registryPath, "utf8")) as { functions: Array<{ name: string }> };
  const registryNames = new Set(registry.functions.map((f) => f.name));
  const slugs = [...lib.matchAll(/slug: "([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.ok(slugs.length > 0);
  for (const slug of slugs) {
    assert.ok(!registryNames.has(slug), `${slug} is in the local registry -- it is not actually undocumented, remove it from UNDOCUMENTED_DEPLOYMENTS`);
  }
});

test("the Workflows and Triggers tabs are wired into Operational Control the same way every other tab is", async () => {
  const panel = await readFile(panelPath, "utf8");
  assert.match(panel, /"workflows", "triggers"/);
  assert.match(panel, /tab === "workflows" && <WorkflowsSection \/>/);
  assert.match(panel, /tab === "triggers" && <TriggersSection \/>/);
});
