// Ideation slot planner — date enumeration, quantity allocation, execution
// scheduling authority, and deterministic fallback spread.
//
// Split out of the retired Ideation Stage 3 (Proposal) suite when Ideation
// Phase 6 removed the Proposal stage: slot-planner.ts itself survived that
// retirement (distribute-content-items-to-calendar still uses it to schedule
// Content Items), so its coverage survives here rather than being deleted
// along with the rest of Stage 3's now-dead eligibility/conflicts/output/
// configuration/model/reference modules and the Proposal review UI helpers.
//
// No test performs a real provider call. Fixtures are deterministic and
// test-only; nothing here touches a live database.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eachDateInclusive,
  IDEATION_ASSET_TYPE_TO_CALENDAR_ROW,
  IDEATION_DEFAULT_WEEKDAYS,
  IDEATION_SLOT_PLANNER_MANIFEST,
  IDEATION_SLOT_PLANNER_VERSION,
  parseScheduleContract,
  planIdeationProposalSlots,
  type IdeationAssetType,
} from "../supabase/functions/_shared/ideation/proposal/slot-planner.ts";

function totals(slots: Array<{ required_asset_type: IdeationAssetType }>) {
  const counts = { reel: 0, carousel: 0, static: 0, story: 0 } as Record<IdeationAssetType, number>;
  for (const slot of slots) counts[slot.required_asset_type] += 1;
  return counts;
}

test("inclusive date enumeration is UTC-safe and rejects an inverted period", () => {
  assert.deepEqual(eachDateInclusive("2026-07-01", "2026-07-03"), ["2026-07-01", "2026-07-02", "2026-07-03"]);
  assert.equal(eachDateInclusive("2026-07-05", "2026-07-05").length, 1, "a one-day period is inclusive");
  assert.equal(eachDateInclusive("2026-07-01", "2026-07-31").length, 31);
  // A month boundary and a leap day must not shift.
  assert.deepEqual(eachDateInclusive("2026-02-28", "2026-03-01"), ["2026-02-28", "2026-03-01"]);
  assert.deepEqual(eachDateInclusive("2028-02-28", "2028-03-01"), ["2028-02-28", "2028-02-29", "2028-03-01"]);
  assert.throws(() => eachDateInclusive("2026-07-05", "2026-07-01"));
  assert.throws(() => eachDateInclusive("not-a-date", "2026-07-01"));
});

test("the slot manifest reconciles exactly with the quantity allocation", () => {
  const required = { reel: 4, carousel: 2, static: 2, story: 7 } as Record<IdeationAssetType, number>;
  const slots = planIdeationProposalSlots({
    periodStart: "2026-07-01",
    periodEnd: "2026-07-07",
    requiredByAssetType: required,
    weekdays: IDEATION_DEFAULT_WEEKDAYS,
  });
  assert.equal(slots.length, 15, "slot count equals the total quantity allocation");
  assert.deepEqual(totals(slots), required, "per-asset-type totals reconcile exactly");
  for (const slot of slots) {
    assert.ok(slot.proposed_date >= "2026-07-01" && slot.proposed_date <= "2026-07-07", slot.proposal_slot_key);
    assert.equal(slot.calendar_row_type, IDEATION_ASSET_TYPE_TO_CALENDAR_ROW[slot.required_asset_type]);
    assert.equal(slot.execution_month, "2026-07");
    assert.ok(slot.date_slot_ordinal >= 1);
  }
  assert.equal(new Set(slots.map((slot) => slot.proposal_slot_key)).size, slots.length, "slot keys are unique");
  // Sorted chronologically then by key.
  const keys = slots.map((slot) => `${slot.proposed_date}|${slot.proposal_slot_key}`);
  assert.deepEqual(keys, [...keys].sort());
});

test("slot planning is deterministic across identical inputs", () => {
  const input = {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    requiredByAssetType: { reel: 16, carousel: 8, static: 8, story: 28 } as Record<IdeationAssetType, number>,
    weekdays: IDEATION_DEFAULT_WEEKDAYS,
  };
  const first = planIdeationProposalSlots(input);
  const second = planIdeationProposalSlots(input);
  assert.deepEqual(first, second, "identical inputs produce an identical manifest");
  assert.equal(first.length, 60);
  assert.deepEqual(totals(first), input.requiredByAssetType);
});

test("one-day, one-week, custom-range, and full-month periods all reconcile", () => {
  const cases: Array<[string, string, Record<IdeationAssetType, number>]> = [
    ["2026-07-27", "2026-07-27", { reel: 1, carousel: 0, static: 0, story: 1 }],
    ["2026-07-01", "2026-07-07", { reel: 4, carousel: 2, static: 2, story: 7 }],
    ["2026-07-10", "2026-07-24", { reel: 8, carousel: 4, static: 4, story: 15 }],
    ["2026-07-01", "2026-07-31", { reel: 16, carousel: 8, static: 8, story: 28 }],
  ];
  for (const [start, end, required] of cases) {
    const slots = planIdeationProposalSlots({
      periodStart: start,
      periodEnd: end,
      requiredByAssetType: required,
      weekdays: IDEATION_DEFAULT_WEEKDAYS,
    });
    const expected = Object.values(required).reduce((total, value) => total + value, 0);
    assert.equal(slots.length, expected, `${start}..${end} slot count`);
    assert.deepEqual(totals(slots), required, `${start}..${end} totals`);
    for (const slot of slots) {
      assert.ok(slot.proposed_date >= start && slot.proposed_date <= end, `${start}..${end} in period`);
    }
    assert.equal(new Set(slots.map((slot) => slot.proposal_slot_key)).size, slots.length);
  }
});

test("explicit Execution scheduling authority takes precedence over the default", () => {
  const contract = parseScheduleContract([{
    file_name: "05_Content_Calendar.md",
    content_md: `# Plan\n\n## Ideation Schedule Contract\nreel_weekdays: 1,3\ncarousel_weekdays: 2\nstatic_weekdays: 4\nstory_weekdays: 5\n`,
  }]);
  assert.equal(contract.source, "approved_execution");
  assert.equal(contract.source_file, "05_Content_Calendar.md");
  assert.deepEqual(contract.weekdays.reel, [1, 3]);

  const slots = planIdeationProposalSlots({
    periodStart: "2026-07-06",
    periodEnd: "2026-07-12",
    requiredByAssetType: { reel: 2, carousel: 1, static: 1, story: 1 },
    weekdays: contract.weekdays,
  });
  // 2026-07-06 is a Monday, so reels must land on Monday and Wednesday only.
  const reels = slots.filter((slot) => slot.required_asset_type === "reel");
  for (const reel of reels) {
    const weekday = new Date(`${reel.proposed_date}T00:00:00Z`).getUTCDay();
    assert.ok([1, 3].includes(weekday), `reel placed on weekday ${weekday}`);
    assert.equal(reel.placement_basis, "execution_cadence");
  }

  // No contract present falls back to the documented system default.
  const fallback = parseScheduleContract([{ file_name: "02_Organic.md", content_md: "no contract here" }]);
  assert.equal(fallback.source, "system_default");
  assert.equal(fallback.source_file, null);
  assert.deepEqual(fallback.weekdays, IDEATION_DEFAULT_WEEKDAYS);

  // More than one contract is ambiguous and fails closed.
  const duplicate = `## Ideation Schedule Contract\nreel_weekdays: 1\ncarousel_weekdays: 2\nstatic_weekdays: 3\nstory_weekdays: 4\n`;
  assert.throws(() => parseScheduleContract([
    { file_name: "a.md", content_md: duplicate },
    { file_name: "b.md", content_md: duplicate },
  ]));
});

test("the deterministic fallback spreads placements and never leaves the period", () => {
  // Two reels but only one cadence weekday in the window: the shortfall must be
  // spread across the remaining dates rather than stacked on one date.
  const slots = planIdeationProposalSlots({
    periodStart: "2026-07-06",
    periodEnd: "2026-07-08",
    requiredByAssetType: { reel: 3, carousel: 0, static: 0, story: 0 },
    weekdays: { ...IDEATION_DEFAULT_WEEKDAYS, reel: [1] },
  });
  assert.equal(slots.length, 3);
  assert.equal(new Set(slots.map((slot) => slot.proposed_date)).size, 3, "placements spread across distinct dates");
  assert.ok(slots.some((slot) => slot.placement_basis === "execution_cadence"));
  assert.ok(slots.some((slot) => slot.placement_basis === "deterministic_spread"));

  // More placements than dates forces ordinals, still deterministic and bounded.
  const dense = planIdeationProposalSlots({
    periodStart: "2026-07-06",
    periodEnd: "2026-07-07",
    requiredByAssetType: { reel: 4, carousel: 0, static: 0, story: 0 },
    weekdays: { ...IDEATION_DEFAULT_WEEKDAYS, reel: [1] },
  });
  assert.equal(dense.length, 4);
  assert.equal(new Set(dense.map((slot) => slot.proposal_slot_key)).size, 4);
  assert.ok(dense.every((slot) => slot.proposed_date >= "2026-07-06" && slot.proposed_date <= "2026-07-07"));
  assert.deepEqual(dense, planIdeationProposalSlots({
    periodStart: "2026-07-06",
    periodEnd: "2026-07-07",
    requiredByAssetType: { reel: 4, carousel: 0, static: 0, story: 0 },
    weekdays: { ...IDEATION_DEFAULT_WEEKDAYS, reel: [1] },
  }));
});

test("the slot planner manifest records its precedence and determinism", () => {
  assert.equal(IDEATION_SLOT_PLANNER_MANIFEST.version, IDEATION_SLOT_PLANNER_VERSION);
  assert.equal(IDEATION_SLOT_PLANNER_MANIFEST.asset_type_totals_are_exact, true);
  assert.deepEqual(IDEATION_SLOT_PLANNER_MANIFEST.precedence, [
    "approved_execution_schedule_contract",
    "immutable_quantity_allocation",
    "deterministic_spread_across_inclusive_period",
  ]);
  assert.equal(IDEATION_SLOT_PLANNER_MANIFEST.date_handling, "inclusive_utc_no_local_timezone_shift");
});
