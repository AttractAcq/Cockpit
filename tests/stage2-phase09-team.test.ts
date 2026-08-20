// Stage 2 Phase 09 — Team.
//
// Source-text assertions, matching this repo's established convention.
// Zero new migration, zero new RPC, zero new edge function this phase --
// there is no live-DB behaviour to verify beyond what fetchStaffUsers/
// fetchTeamMembers/fetchWorkflows already carry from Phases 00/03, which
// were verified live on their own phases. This is the thinnest phase yet:
// a read-only directory composed entirely from already-real data.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const panelPath = new URL("../src/components/operations/OperationsControlPanel.tsx", import.meta.url);
const groundTruthPath = new URL("../docs/STAGE_2_PHASE_00_GROUND_TRUTH.md", import.meta.url);

test("Phase 09 introduces zero new migrations -- every building block was already real per Phase 00's audit", async () => {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(new URL("../supabase/migrations", import.meta.url));
  const phase09 = files.filter((f) => /phase0?9/i.test(f));
  assert.equal(phase09.length, 0, "Phase 09 must not add a migration -- team_members/users/the workflow registry are all already real");
});

test("the Team Directory is composed from fetchStaffUsers, fetchTeamMembers (already real, Phase 00) and fetchWorkflows (already real, Phase 03) -- no new data source invented", async () => {
  const panel = await readFile(panelPath, "utf8");
  const section = panel.split("function TeamRolesSection")[1].split("\nfunction ")[0];
  assert.match(section, /fetchTeamMembers\(\), fetchStaffUsers\(\)/);
  assert.match(section, /fetchWorkflows\(\)\.filter\(\(w\) => w\.profile !== "retired"\)/, "agent roles must exclude retired functions -- the exit gate is every *current* role");
});

test("the directory tags every row Human or Agent -- no unlabeled, ambiguous entries", async () => {
  const panel = await readFile(panelPath, "utf8");
  const section = panel.split("function TeamRolesSection")[1].split("\nfunction ")[0];
  assert.match(section, />Human</);
  assert.match(section, />Agent</);
});

test("capacity is stated as honestly not tracked yet, not fabricated -- matching the Phase 05 Campaigns disclosure precedent", async () => {
  const panel = await readFile(panelPath, "utf8");
  const section = panel.split("function TeamRolesSection")[1].split("\nfunction ")[0];
  assert.doesNotMatch(section, /capacity_hours|capacityHours|\.capacity\b/i, "no capacity field or binding may exist -- it isn't tracked");
  assert.match(section, /Capacity is not tracked yet/);
});

test("Team Directory extends the existing Team & Roles sub-tab -- no new top-level tab or section added", async () => {
  const panel = await readFile(panelPath, "utf8");
  assert.match(panel, /"metrics", "intelligence", "workflows", "triggers", "team", "work", "projects", "cost", "onboarding"/, "the TABS list must be unchanged from Phase 08 -- Team Directory lives inside the existing team tab");
});

test("the ground-truth audit's own finding motivates this phase's scope -- capacity/performance data confirmed not real, cited rather than re-derived", async () => {
  const groundTruth = await readFile(groundTruthPath, "utf8");
  assert.match(groundTruth, /capacity\/performance data and fine-grained write permissions are not/);
});
