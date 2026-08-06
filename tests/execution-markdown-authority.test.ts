// Programme Stage D — deterministic extraction from approved Execution Markdown.
//
// These cover the half of Stage D reconciliation that makes it non-circular:
// the structured config is generated from the machine-readable quantity
// contract, and reconciled against these human-authored tables. If parsing
// silently returned a default instead of null when a table is missing or
// ambiguous, a contradiction could pass unnoticed — so the "absent" and
// "ambiguous" cases matter as much as the happy path.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractDeclaredAuthority,
  objectiveMixFromThemes,
  parseContentPillars,
  parsePrimaryPlatform,
  parseSlotTargets,
  parseWeeklyThemes,
  sectionBody,
} from "../supabase/functions/_shared/execution/markdown-authority.ts";

// Shaped exactly like the real approved 05_Content_Calendar.md, including the
// bold "Organic total" checksum row and the em-dash paid row that must not be
// mistaken for a format.
const CALENDAR = `# 05_Content_Calendar.md — Content Calendar

### Rule 2 — Monthly Slot Targets

| Format | Weekly Target | Monthly Total |
|---|---|---|
| Reels | 4 | ~16 |
| Carousels | 2 | ~8 |
| Statics | 2 | ~8 |
| Stories | 7 | ~30 |
| **Organic total** | **15** | **~62** |
| Paid ad stints | — | ~4 across funnel lanes |

---

### Rule 3 — Weekly Theme Sequencing

| Week | Theme | Primary Pillar Orientation |
|---|---|---|
| Week 1 | Authority Foundation | Proof-led demand infrastructure |
| Week 2 | Problem Awareness | The cost of hidden proof |
| Week 3 | System Distinction | Why structured proof differs |
| Week 4 | Demand and Action | Qualified demand requires trust |

---

### Rule 4 — Pillar Rotation Requirements

No single pillar may occupy more than 50 percent of organic slots.

| Pillar Code | Pillar Name |
|---|---|
| P1 | The Proof Problem |
| P2 | The Authority System |
| P3 | The Market Reality |

---

### Platform

- **Primary platform:** Instagram — Reels, Carousels, Static Feed Posts, Stories, Meta Ads
- **Secondary platform:** Unresolved. Facebook and LinkedIn are candidates.
`;

test("slot targets parse to the exact weekly figures, ignoring approximate monthly ones", () => {
  const { targets, organic_weekly_total } = parseSlotTargets(CALENDAR);
  assert.deepEqual(targets, [
    { asset_type: "reel", weekly_target: 4 },
    { asset_type: "carousel", weekly_target: 2 },
    { asset_type: "static", weekly_target: 2 },
    { asset_type: "story", weekly_target: 7 },
  ]);
  assert.equal(organic_weekly_total, 15);
});

test("the declared organic total is the sum of the declared per-format figures", () => {
  const { targets, organic_weekly_total } = parseSlotTargets(CALENDAR);
  const summed = (targets ?? []).reduce((total, t) => total + t.weekly_target, 0);
  assert.equal(summed, organic_weekly_total);
});

test("the paid ad stint row is not mistaken for an organic format", () => {
  const { targets } = parseSlotTargets(CALENDAR);
  assert.ok(!(targets ?? []).some((t) => String(t.asset_type).includes("paid")));
  assert.equal(targets?.length, 4);
});

test("weekly themes parse in declared week order", () => {
  assert.deepEqual(parseWeeklyThemes(CALENDAR), [
    "Authority Foundation",
    "Problem Awareness",
    "System Distinction",
    "Demand and Action",
  ]);
});

test("pillars parse from the pillar name column, not the code column", () => {
  assert.deepEqual(parseContentPillars(CALENDAR), [
    "The Proof Problem",
    "The Authority System",
    "The Market Reality",
  ]);
});

test("a missing table yields null rather than a fabricated default", () => {
  const withoutPillars = CALENDAR.slice(0, CALENDAR.indexOf("### Rule 4"));
  assert.equal(parseContentPillars(withoutPillars), null);
  const declared = extractDeclaredAuthority(withoutPillars);
  assert.equal(declared.content_pillars, null);
  assert.notEqual(declared.slot_targets, null);
});

test("a duplicated heading is treated as ambiguous, not silently resolved", () => {
  const duplicated = `${CALENDAR}\n### Rule 2 — Monthly Slot Targets\n\n| Format | Weekly Target |\n|---|---|\n| Reels | 99 |\n`;
  assert.equal(sectionBody(duplicated, /^#{2,4}[ \t]+Rule 2[^\n]*$/gim), null);
  assert.equal(parseSlotTargets(duplicated).targets, null);
});

test("a table without a weekly column does not guess a different column", () => {
  const monthlyOnly = `### Rule 2 — Monthly Slot Targets

| Format | Monthly Total |
|---|---|
| Reels | 16 |
`;
  assert.equal(parseSlotTargets(monthlyOnly).targets, null);
});

test("extraction over the real-shaped document returns every declared dimension", () => {
  const declared = extractDeclaredAuthority(CALENDAR);
  assert.equal(declared.slot_targets?.length, 4);
  assert.equal(declared.declared_organic_weekly_total, 15);
  assert.equal(declared.weekly_themes?.length, 4);
  assert.equal(declared.content_pillars?.length, 3);
});

test("objective mix always sums to the quantity it distributes", () => {
  const themes = ["A", "B", "C", "D"];
  for (const quantity of [0, 1, 3, 4, 7, 16, 30, 31]) {
    const mix = objectiveMixFromThemes(quantity, themes);
    const summed = Object.values(mix).reduce((total, n) => total + n, 0);
    assert.equal(summed, quantity, `quantity ${quantity} did not reconcile`);
  }
});

test("objective mix spreads evenly and sends the remainder to earlier weeks", () => {
  assert.deepEqual(objectiveMixFromThemes(6, ["A", "B", "C", "D"]), { A: 2, B: 2, C: 1, D: 1 });
  assert.deepEqual(objectiveMixFromThemes(8, ["A", "B", "C", "D"]), { A: 2, B: 2, C: 2, D: 2 });
});

test("objective mix refuses to invent a theme when none are declared", () => {
  assert.throws(() => objectiveMixFromThemes(4, []), /at least one declared theme/);
});

// --- declared platform -------------------------------------------------------

test("primary platform parses, dropping the format qualifier after the em dash", () => {
  assert.equal(parsePrimaryPlatform(CALENDAR), "instagram");
});

test("the secondary platform line is never mistaken for the primary", () => {
  assert.equal(parsePrimaryPlatform(CALENDAR), "instagram");
  assert.ok(!String(parsePrimaryPlatform(CALENDAR)).includes("facebook"));
});

test("an explicit non-answer yields null rather than a platform named Unresolved", () => {
  for (const value of ["Unresolved", "TBC", "TBD", "None", "Pending"]) {
    const md = `### Platform\n\n- **Primary platform:** ${value}\n`;
    assert.equal(parsePrimaryPlatform(md), null, `${value} must not become a platform`);
  }
});

test("a missing platform section yields null rather than a guess from formats", () => {
  const withoutPlatform = CALENDAR.slice(0, CALENDAR.indexOf("### Platform"));
  assert.equal(parsePrimaryPlatform(withoutPlatform), null);
  assert.equal(extractDeclaredAuthority(withoutPlatform).primary_platform, null);
});

test("platform variants normalise to a comparable lowercase value", () => {
  assert.equal(parsePrimaryPlatform("### Platform\n\n- **Primary platform:** LinkedIn\n"), "linkedin");
  assert.equal(parsePrimaryPlatform("### Platform\n\n- **Primary platform:** Instagram, Reels only\n"), "instagram");
  assert.equal(parsePrimaryPlatform("### Platform\n\n* **Primary platform:** TikTok - short form\n"), "tiktok");
});
