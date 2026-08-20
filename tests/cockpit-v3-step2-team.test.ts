// Cockpit v3 Step 2 -- second rehome: Team promoted to a real top-level
// page (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 2). Chosen right after
// Automations for the same reason: TeamRolesSection reads/writes across all
// clients already (an admin assignment tool, not filtered to one selected
// business), so it needed no BusinessContext bridging either -- unlike
// Marketing/Finance, still ahead.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const constantsPath = new URL("../src/lib/constants.ts", import.meta.url);
const appPath = new URL("../src/App.tsx", import.meta.url);
const teamPagePath = new URL("../src/pages/TeamPage.tsx", import.meta.url);
const operationsControlPath = new URL("../src/components/operations/OperationsControlPanel.tsx", import.meta.url);
const teamRolesSectionPath = new URL("../src/components/team/TeamRolesSection.tsx", import.meta.url);

test("routes and nav wiring: Team is a new top-level page", async () => {
  const constants = await readFile(constantsPath, "utf8");
  assert.match(constants, /team: "\/team"/);
  assert.match(constants, /label: "Team",\s*path: ROUTES\.team/);
  const app = await readFile(appPath, "utf8");
  assert.match(app, /path=\{ROUTES\.team\} element=\{<TeamPage \/>\}/);
});

test("TeamRolesSection is a shared component, not duplicated between the old and new locations", async () => {
  const operationsControl = await readFile(operationsControlPath, "utf8");
  assert.match(operationsControl, /import\s*\{\s*TeamRolesSection\s*\}\s*from\s*"@\/components\/team\/TeamRolesSection"/);
  assert.doesNotMatch(operationsControl, /function TeamRolesSection\(/, "no second copy of the JSX should exist in this file");

  const teamPage = await readFile(teamPagePath, "utf8");
  assert.match(teamPage, /import\s*\{\s*TeamRolesSection\s*\}\s*from\s*"@\/components\/team\/TeamRolesSection"/);
});

test("TeamRolesSection no longer takes a clients prop -- it fetches its own, so it works identically from either parent", async () => {
  const operationsControl = await readFile(operationsControlPath, "utf8");
  assert.match(operationsControl, /<TeamRolesSection \/>/);
  assert.doesNotMatch(operationsControl, /<TeamRolesSection clients=/);

  const teamRolesSection = await readFile(teamRolesSectionPath, "utf8");
  assert.match(teamRolesSection, /export function TeamRolesSection\(\)/);
  assert.match(teamRolesSection, /fetchClients\(\)/);
});

test("the old Operations Team & Roles tab is hidden-before-delete: still present, not retired", async () => {
  const operationsControl = await readFile(operationsControlPath, "utf8");
  assert.match(operationsControl, /"team"/);
  assert.match(operationsControl, /\{tab === "team" && <TeamRolesSection \/>\}/);
});
