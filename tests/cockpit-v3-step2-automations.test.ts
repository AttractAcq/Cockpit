// Cockpit v3 Step 2 -- first rehome: Automations promoted to a real
// top-level page (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 2). Lowest-
// risk system in the bridge table to move first: Workflows/Triggers were
// already cross-business (no client_id scoping to bridge through
// BusinessContext at all), unlike Marketing/Finance/Team.
//
// Pure recomposition per the plan's own rule: WorkflowsSection/
// TriggersSection are shared components, not duplicated JSX, so the
// original Operations > Operational Control tabs and the new top-level page
// render identically off the same code -- confirmed by source-text checks
// below rather than a live render (no React component-test infra here).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const constantsPath = new URL("../src/lib/constants.ts", import.meta.url);
const appPath = new URL("../src/App.tsx", import.meta.url);
const automationsPagePath = new URL("../src/pages/AutomationsPage.tsx", import.meta.url);
const operationsControlPath = new URL("../src/components/operations/OperationsControlPanel.tsx", import.meta.url);
const workflowsSectionPath = new URL("../src/components/automations/WorkflowsSection.tsx", import.meta.url);
const triggersSectionPath = new URL("../src/components/automations/TriggersSection.tsx", import.meta.url);

test("routes and nav wiring: Automations is a new top-level page", async () => {
  const constants = await readFile(constantsPath, "utf8");
  assert.match(constants, /automations: "\/automations"/);
  assert.match(constants, /label: "Automations",\s*path: ROUTES\.automations/);
  const app = await readFile(appPath, "utf8");
  assert.match(app, /path=\{ROUTES\.automations\} element=\{<AutomationsPage \/>\}/);
});

test("WorkflowsSection and TriggersSection are shared components, not duplicated between the old and new locations", async () => {
  const operationsControl = await readFile(operationsControlPath, "utf8");
  assert.match(operationsControl, /import\s*\{\s*WorkflowsSection\s*\}\s*from\s*"@\/components\/automations\/WorkflowsSection"/);
  assert.match(operationsControl, /import\s*\{\s*TriggersSection\s*\}\s*from\s*"@\/components\/automations\/TriggersSection"/);
  // The tab-switch render calls, not a redefinition -- confirms no second copy of the JSX exists in this file.
  assert.doesNotMatch(operationsControl, /function WorkflowsSection\(/);
  assert.doesNotMatch(operationsControl, /function TriggersSection\(/);

  const automationsPage = await readFile(automationsPagePath, "utf8");
  assert.match(automationsPage, /import\s*\{\s*WorkflowsSection\s*\}\s*from\s*"@\/components\/automations\/WorkflowsSection"/);
  assert.match(automationsPage, /import\s*\{\s*TriggersSection\s*\}\s*from\s*"@\/components\/automations\/TriggersSection"/);
});

test("the old Operations tabs are hidden-before-delete: still present, not retired, per the plan's own discipline", async () => {
  const operationsControl = await readFile(operationsControlPath, "utf8");
  assert.match(operationsControl, /"workflows"/);
  assert.match(operationsControl, /"triggers"/);
  assert.match(operationsControl, /\{tab === "workflows" && <WorkflowsSection \/>\}/);
  assert.match(operationsControl, /\{tab === "triggers" && <TriggersSection \/>\}/);
});

test("both extracted sections read from the same registry/cron data source as before -- no new backend surface", async () => {
  const workflowsSection = await readFile(workflowsSectionPath, "utf8");
  assert.match(workflowsSection, /from\s*"@\/lib\/workflows"/);
  assert.match(workflowsSection, /fetchWorkflows/);
  const triggersSection = await readFile(triggersSectionPath, "utf8");
  assert.match(triggersSection, /from\s*"@\/lib\/workflows"/);
  assert.match(triggersSection, /fetchScheduledTriggers/);
});
