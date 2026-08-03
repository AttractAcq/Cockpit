// Programme Stage B — status machine and ownership contract tests.
//
// These assert the canonical transition tables directly. They are deterministic
// and require no database or network.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONTENT_ITEM_APPROVED_STATUSES,
  CONTENT_ITEM_TRANSITIONS,
  CONTENT_OPPORTUNITY_TRANSITIONS,
  canTransitionContentItem,
  canTransitionOpportunity,
  isProofUsable,
  requiresHumanApproval,
} from "../src/types/content-spine.ts";

test("content opportunity happy path follows the approved chain", () => {
  const chain = [
    "draft",
    "needs_review",
    "shortlisted",
    "selected",
    "scheduled",
    "produced",
  ] as const;
  for (let i = 0; i < chain.length - 1; i += 1) {
    assert.equal(
      canTransitionOpportunity(chain[i], chain[i + 1]),
      true,
      `${chain[i]} -> ${chain[i + 1]} must be allowed`,
    );
  }
});

test("content opportunity may be rejected or expired only from early states", () => {
  for (const early of ["draft", "needs_review", "shortlisted"] as const) {
    assert.equal(canTransitionOpportunity(early, "rejected"), true);
    assert.equal(canTransitionOpportunity(early, "expired"), true);
  }
  for (const late of ["selected", "scheduled", "produced"] as const) {
    assert.equal(canTransitionOpportunity(late, "rejected"), false);
    assert.equal(canTransitionOpportunity(late, "expired"), false);
  }
});

test("content opportunity terminal states allow no onward transition", () => {
  for (const terminal of ["produced", "rejected", "expired"] as const) {
    assert.deepEqual(CONTENT_OPPORTUNITY_TRANSITIONS[terminal], []);
  }
});

test("content opportunity cannot skip a stage or move backwards", () => {
  assert.equal(canTransitionOpportunity("draft", "selected"), false);
  assert.equal(canTransitionOpportunity("draft", "produced"), false);
  assert.equal(canTransitionOpportunity("scheduled", "draft"), false);
  assert.equal(canTransitionOpportunity("produced", "scheduled"), false);
});

test("content item happy path follows the approved chain", () => {
  const chain = [
    "planned",
    "brief_pending",
    "brief_review",
    "production_ready",
    "in_production",
    "asset_review",
    "approved",
    "scheduled",
    "published",
    "analysed",
    "iterated",
  ] as const;
  for (let i = 0; i < chain.length - 1; i += 1) {
    assert.equal(
      canTransitionContentItem(chain[i], chain[i + 1]),
      true,
      `${chain[i]} -> ${chain[i + 1]} must be allowed`,
    );
  }
});

test("content item cannot reach approved without passing asset_review", () => {
  for (const from of [
    "planned",
    "brief_pending",
    "brief_review",
    "production_ready",
    "in_production",
  ] as const) {
    assert.equal(
      canTransitionContentItem(from, "approved"),
      false,
      `${from} must not jump straight to approved`,
    );
  }
  assert.equal(canTransitionContentItem("asset_review", "approved"), true);
});

test("content item cannot publish before approval", () => {
  assert.equal(canTransitionContentItem("in_production", "published"), false);
  assert.equal(canTransitionContentItem("asset_review", "published"), false);
  assert.equal(canTransitionContentItem("approved", "published"), false);
  assert.equal(canTransitionContentItem("scheduled", "published"), true);
});

test("content item is a strictly forward machine", () => {
  const order = Object.keys(CONTENT_ITEM_TRANSITIONS) as Array<
    keyof typeof CONTENT_ITEM_TRANSITIONS
  >;
  order.forEach((from, fromIndex) => {
    for (const to of CONTENT_ITEM_TRANSITIONS[from]) {
      assert.ok(
        order.indexOf(to) > fromIndex,
        `${from} -> ${to} must move forward`,
      );
    }
  });
});

test("iterated is terminal", () => {
  assert.deepEqual(CONTENT_ITEM_TRANSITIONS.iterated, []);
});

test("approval-bearing statuses require a human approver", () => {
  for (const status of CONTENT_ITEM_APPROVED_STATUSES) {
    assert.equal(requiresHumanApproval(status), true);
  }
  for (const status of [
    "planned",
    "brief_pending",
    "brief_review",
    "production_ready",
    "in_production",
    "asset_review",
  ] as const) {
    assert.equal(requiresHumanApproval(status), false);
  }
});

test("proof fails closed until verified", () => {
  assert.equal(isProofUsable({ verification_status: "unverified" }), false);
  assert.equal(isProofUsable({ verification_status: "rejected" }), false);
  assert.equal(isProofUsable({ verification_status: "verified" }), true);
});

test("every declared status appears in its transition table", () => {
  const opportunityStatuses = [
    "draft",
    "needs_review",
    "shortlisted",
    "selected",
    "scheduled",
    "produced",
    "rejected",
    "expired",
  ] as const;
  for (const status of opportunityStatuses) {
    assert.ok(
      status in CONTENT_OPPORTUNITY_TRANSITIONS,
      `${status} missing from opportunity transition table`,
    );
  }
  assert.equal(
    Object.keys(CONTENT_OPPORTUNITY_TRANSITIONS).length,
    opportunityStatuses.length,
  );
  assert.equal(Object.keys(CONTENT_ITEM_TRANSITIONS).length, 11);
});
