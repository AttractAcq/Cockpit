// Programme Stage D — required Phase 2 executable contract tests.
//
//   1. quantities reconcile to slot counts
//   2. required formats reconcile to Execution files
//   3. no duplicate slot identity
//   4. changed Execution version creates a new requirement set
//   5. old requirements remain historically readable
//   6. approval is required before slots become operational
//   7. invalid or contradictory configuration fails closed

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type ExecutionConfig,
  canApproveConfig,
  deriveContentRequirements,
  duplicateSlotIdentities,
  generateCalendarSlots,
  hasBlockingFailure,
  monthBounds,
  quantitiesReconcileToSlots,
  reconcileWithExecutionFiles,
  reconciliationOutcome,
  requirementKey,
  validateExecutionConfig,
} from "../src/types/execution-config.ts";

function baseConfig(): ExecutionConfig {
  return {
    execution_month: "2026-08",
    content_pillars: ["authority", "proof"],
    offers: ["proof-sprint"],
    requirements: [
      {
        platform: "instagram",
        asset_format: "reel",
        channel: "organic",
        quantity: 12,
        cadence: "weekly",
        objective_mix: { authority: 4, objection_handling: 3, proof: 3, offer: 2 },
        preferred_origins: { research: 4, proof: 4, manual: 2, performance: 2 },
        content_pillar: "authority",
        funnel_stage: "awareness",
        offer_ref: "proof-sprint",
        required_proof_strength: "verified",
      },
      {
        platform: "instagram",
        asset_format: "carousel",
        channel: "organic",
        quantity: 4,
        cadence: "weekly",
        objective_mix: { proof: 4 },
      },
    ],
  };
}

// Period arithmetic ---------------------------------------------------------

test("month bounds are correct including leap years", () => {
  assert.deepEqual(monthBounds("2026-08"), {
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    days: 31,
  });
  assert.equal(monthBounds("2026-02").days, 28);
  assert.equal(monthBounds("2028-02").days, 29);
  assert.throws(() => monthBounds("2026-13"));
  assert.throws(() => monthBounds("August"));
});

// 7. Invalid or contradictory configuration fails closed --------------------

test("a consistent configuration validates clean", () => {
  const checks = validateExecutionConfig(baseConfig());
  assert.equal(hasBlockingFailure(checks), false);
  assert.equal(reconciliationOutcome(checks), "passed");
});

test("an objective mix that does not sum to quantity fails closed", () => {
  const config = baseConfig();
  config.requirements[0].objective_mix = { authority: 4, proof: 3 };
  const checks = validateExecutionConfig(config);
  assert.equal(hasBlockingFailure(checks), true);
  assert.equal(reconciliationOutcome(checks), "failed");
});

test("preferred origins that do not sum to quantity fail closed", () => {
  const config = baseConfig();
  config.requirements[0].preferred_origins = { research: 1 };
  assert.equal(hasBlockingFailure(validateExecutionConfig(config)), true);
});

test("an undeclared content pillar or offer fails closed", () => {
  const pillar = baseConfig();
  pillar.requirements[0].content_pillar = "not-a-pillar";
  assert.equal(hasBlockingFailure(validateExecutionConfig(pillar)), true);

  const offer = baseConfig();
  offer.requirements[0].offer_ref = "not-an-offer";
  assert.equal(hasBlockingFailure(validateExecutionConfig(offer)), true);
});

test("duplicate requirement identity fails closed", () => {
  const config = baseConfig();
  config.requirements.push({ ...config.requirements[0] });
  assert.equal(hasBlockingFailure(validateExecutionConfig(config)), true);
});

test("exceeding declared production capacity fails closed", () => {
  const config = baseConfig();
  config.production_capacity = { max_per_month: 10 };
  assert.equal(hasBlockingFailure(validateExecutionConfig(config)), true);
});

test("an organic/paid mix that contradicts total quantity fails closed", () => {
  const config = baseConfig();
  config.organic_paid_mix = { organic: 5, paid: 5 };
  assert.equal(hasBlockingFailure(validateExecutionConfig(config)), true);
});

test("a configuration declaring no output fails closed", () => {
  const config = baseConfig();
  config.requirements = [];
  assert.equal(hasBlockingFailure(validateExecutionConfig(config)), true);
});

// 2. Required formats reconcile to Execution files --------------------------

test("formats matching the Execution files reconcile", () => {
  const checks = reconcileWithExecutionFiles(baseConfig(), {
    formats: ["reel", "carousel"],
    total_quantity: 16,
  });
  assert.equal(hasBlockingFailure(checks), false);
});

test("a format present in Markdown but missing from config fails closed", () => {
  const checks = reconcileWithExecutionFiles(baseConfig(), {
    formats: ["reel", "carousel", "story"],
  });
  assert.equal(hasBlockingFailure(checks), true);
});

test("a format in config but absent from Markdown fails closed", () => {
  const checks = reconcileWithExecutionFiles(baseConfig(), { formats: ["reel"] });
  assert.equal(hasBlockingFailure(checks), true);
});

test("a quantity contradicting the Execution files fails closed", () => {
  const checks = reconcileWithExecutionFiles(baseConfig(), { total_quantity: 20 });
  assert.equal(hasBlockingFailure(checks), true);
  const failed = checks.find((c) => c.check_code === "quantity_reconcile");
  assert.equal(failed?.expected_value, "20");
  assert.equal(failed?.actual_value, "16");
});

// 1. Quantities reconcile to slot counts ------------------------------------

test("generated slots match every requirement quantity", () => {
  const config = baseConfig();
  const requirements = deriveContentRequirements(config, 1);
  const slots = generateCalendarSlots(config, true);
  assert.equal(slots.length, 16);
  assert.equal(quantitiesReconcileToSlots(requirements, slots), true);
});

test("a shortfall in slots is detected", () => {
  const config = baseConfig();
  const requirements = deriveContentRequirements(config, 1);
  const slots = generateCalendarSlots(config, true).slice(0, -1);
  assert.equal(quantitiesReconcileToSlots(requirements, slots), false);
});

// 3. No duplicate slot identity ---------------------------------------------

test("slot identity is unique across requirement, date and index", () => {
  const slots = generateCalendarSlots(baseConfig(), true);
  assert.deepEqual(duplicateSlotIdentities(slots), []);
});

test("slots colliding on a date receive distinct indexes", () => {
  const config = baseConfig();
  config.requirements = [
    {
      platform: "instagram",
      asset_format: "reel",
      channel: "organic",
      quantity: 60,
      cadence: "daily",
      objective_mix: { authority: 60 },
    },
  ];
  const slots = generateCalendarSlots(config, true);
  assert.equal(slots.length, 60);
  assert.deepEqual(duplicateSlotIdentities(slots), []);
  assert.ok(slots.some((s) => s.slot_index > 0), "collisions must occur to prove indexing");
});

test("slot generation is deterministic", () => {
  const a = generateCalendarSlots(baseConfig(), true);
  const b = generateCalendarSlots(baseConfig(), true);
  assert.deepEqual(a, b);
});

test("a single-quantity requirement lands on the first day", () => {
  const config = baseConfig();
  config.requirements = [
    {
      platform: "instagram",
      asset_format: "reel",
      channel: "organic",
      quantity: 1,
      cadence: "monthly",
      objective_mix: { authority: 1 },
    },
  ];
  const slots = generateCalendarSlots(config, true);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].scheduled_for, "2026-08-01");
});

test("every generated slot falls inside its period", () => {
  const config = baseConfig();
  const { period_start, period_end } = monthBounds(config.execution_month);
  for (const slot of generateCalendarSlots(config, true)) {
    assert.ok(slot.scheduled_for >= period_start && slot.scheduled_for <= period_end);
  }
});

// 6. Approval required before slots become operational ----------------------

test("slots are not operational while the config is unapproved", () => {
  const slots = generateCalendarSlots(baseConfig(), false);
  assert.ok(slots.length > 0);
  assert.equal(slots.every((s) => s.is_operational === false), true);
});

test("slots become operational only once the config is approved", () => {
  assert.equal(generateCalendarSlots(baseConfig(), true).every((s) => s.is_operational), true);
});

test("slots default to requiring human approval", () => {
  const slots = generateCalendarSlots(baseConfig(), true);
  assert.equal(slots.every((s) => s.approval_policy === "human_required"), true);
});

test("a config cannot be approved until reconciliation passes", () => {
  assert.equal(canApproveConfig({ reconciliation_status: "pending" }, "user-1"), false);
  assert.equal(canApproveConfig({ reconciliation_status: "failed" }, "user-1"), false);
  assert.equal(canApproveConfig({ reconciliation_status: "passed" }, null), false);
  assert.equal(canApproveConfig({ reconciliation_status: "passed" }, "user-1"), true);
});

// 4 & 5. Versioning and historical readability ------------------------------

test("a changed Execution version produces a new requirement set", () => {
  const v1 = deriveContentRequirements(baseConfig(), 1);
  const changed = baseConfig();
  changed.requirements[0].quantity = 8;
  changed.requirements[0].objective_mix = { authority: 4, proof: 4 };
  changed.requirements[0].preferred_origins = { research: 4, proof: 4 };
  const v2 = deriveContentRequirements(changed, 2);

  assert.equal(v1.every((r) => r.requirement_set_version === 1), true);
  assert.equal(v2.every((r) => r.requirement_set_version === 2), true);
  assert.notDeepEqual(v1, v2);
});

test("deriving a new set does not mutate the previous one", () => {
  const config = baseConfig();
  const v1 = deriveContentRequirements(config, 1);
  const snapshot = structuredClone(v1);
  config.requirements[0].quantity = 99;
  deriveContentRequirements(config, 2);
  assert.deepEqual(v1, snapshot, "historical requirement set must remain readable and unchanged");
});

test("derived requirements are ordered deterministically", () => {
  const forward = deriveContentRequirements(baseConfig(), 1);
  const reversed = baseConfig();
  reversed.requirements.reverse();
  assert.deepEqual(forward, deriveContentRequirements(reversed, 1));
  assert.deepEqual(forward.map(requirementKey), [
    "instagram/organic/carousel",
    "instagram/organic/reel",
  ]);
});
