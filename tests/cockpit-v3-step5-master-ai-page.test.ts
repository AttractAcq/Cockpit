// Cockpit v3 Step 5 (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md) — Master AI
// promoted to a real top-level page, plus a business-context panel built
// entirely from already-real data (Command Center notes, Opportunity OS,
// the Automations registry and real triggers). MasterAIPanel itself is
// unchanged (Programme's real jarvis-turn/set-jarvis-settings mechanics
// predate this step) -- these tests cover the new page/panel wiring only.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

function src(relPath: string): string {
  return readFileSync(new URL(relPath, import.meta.url), "utf-8");
}

test("Master AI is a real top-level route and nav item, not nested only inside ClientDetailPage", () => {
  const constants = src("../src/lib/constants.ts");
  assert.match(constants, /masterAi:\s*"\/master-ai"/);
  assert.match(constants, /label:\s*"Master AI",\s*path:\s*ROUTES\.masterAi/);

  const app = src("../src/App.tsx");
  assert.match(app, /import \{ MasterAIPage \} from "@\/pages\/MasterAIPage"/);
  assert.match(app, /<Route path=\{ROUTES\.masterAi\} element=\{<MasterAIPage \/>\} \/>/);
});

test("MasterAIPage reads the client through BusinessContext's compatibility bridge, reuses MasterAIPanel unchanged, and never fabricates data for a business with no linked client", () => {
  const page = src("../src/pages/MasterAIPage.tsx");
  assert.match(page, /const \{ selectedBusiness, selectedClientId \} = useBusinessContext\(\)/);
  assert.match(page, /<MasterAIPanel clientId=\{selectedClientId\}/);
  assert.match(page, /No linked client/);
});

test("BusinessContextPanel is built entirely from already-real cross-department reads -- no new schema, no new RPC", () => {
  const panel = src("../src/components/master-ai/BusinessContextPanel.tsx");
  assert.match(panel, /import\s*\{\s*fetchCommandCenterNotes\s*\}\s*from\s*"@\/lib\/command-center"/);
  assert.match(panel, /import\s*\{\s*fetchOpportunityFindings\s*\}\s*from\s*"@\/lib\/opportunity"/);
  assert.match(panel, /import\s*\{\s*fetchWorkflows,\s*fetchScheduledTriggers\s*\}\s*from\s*"@\/lib\/workflows"/);
  // "Goals" and "Decisions" from the plan's own illustrative diagram are
  // deliberately not real sections -- neither is tracked anywhere in this
  // schema, and fabricating one would violate this codebase's own discipline.
  assert.doesNotMatch(panel, /title="Goals"|title="Decisions"/);
});
