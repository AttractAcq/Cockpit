// Programme Stage G — Calendar Planning, deterministic unit coverage.
// The commit_calendar_proposal RPC itself was live-verified directly against
// the real database with disposable fixtures during implementation (happy
// path, double-commit rejection, slot-collision rejection, and a no-partial-
// state check after a rejected commit) — see the Stage G implementation
// report for that evidence. These tests cover the pure matching and
// proposal-edit logic that has no live-DB dependency.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeMatch,
  pickBestMatch,
  applyProposalEdit,
  MIN_MATCH_SCORE,
  type MatchableOpportunity,
  type MatchableSlot,
  type MatchableRequirement,
  type ProposalSlotState,
} from "../supabase/functions/_shared/calendar-planning.ts";

function opportunity(overrides: Partial<MatchableOpportunity> = {}): MatchableOpportunity {
  return {
    id: "opp-1",
    origin: "manual",
    audience: "second-crew owners",
    funnel_stage: "awareness",
    candidate_formats: ["reel"],
    candidate_channels: ["instagram"],
    visual_potential: 4,
    production_requirements: null,
    expires_at: null,
    duplicate_of_opportunity_id: null,
    proof_strength: 60,
    ...overrides,
  };
}

function slot(overrides: Partial<MatchableSlot> = {}): MatchableSlot {
  return {
    platform: "instagram",
    objective: "awareness",
    funnel_stage: "awareness",
    audience_stage: "second-crew owners",
    preferred_source_type: "manual",
    required_proof_strength: "none",
    scheduled_for: "2026-09-15",
    ...overrides,
  };
}

const requirement: MatchableRequirement = { asset_format: "reel", channel: "instagram" };

/* --------------------------------------------------------- computeMatch */

test("computeMatch: a well-aligned Opportunity scores highly", () => {
  const result = computeMatch(opportunity(), slot(), requirement);
  assert.ok(result.eligible);
  assert.ok(result.overallScore > 80, `expected >80, got ${result.overallScore}`);
});

test("computeMatch: a duplicate Opportunity is hard-excluded, never soft-penalised", () => {
  const result = computeMatch(opportunity({ duplicate_of_opportunity_id: "other-opp" }), slot(), requirement);
  assert.equal(result.eligible, false);
  assert.equal(result.ineligibleReason, "duplicate_recent_content");
  assert.equal(result.overallScore, 0);
});

test("computeMatch: wrong format and channel scores format_suitability at 0", () => {
  const result = computeMatch(
    opportunity({ candidate_formats: ["carousel"], candidate_channels: ["facebook"] }),
    slot(), requirement,
  );
  assert.equal(result.dimensions.format_suitability, 0);
});

test("computeMatch: empty candidate_formats/channels does not penalise (not yet classified)", () => {
  const result = computeMatch(opportunity({ candidate_formats: [], candidate_channels: [] }), slot(), requirement);
  assert.equal(result.dimensions.format_suitability, 100);
});

test("computeMatch: origin mismatched against slot preference scores low", () => {
  const result = computeMatch(opportunity({ origin: "research" }), slot({ preferred_source_type: "manual" }), requirement);
  assert.equal(result.dimensions.origin_preference, 30);
});

test("computeMatch: no slot origin preference is neutral, not a penalty", () => {
  const result = computeMatch(opportunity({ origin: "research" }), slot({ preferred_source_type: null }), requirement);
  assert.equal(result.dimensions.origin_preference, 60);
});

test("computeMatch: verified proof requirement fails a weakly-scored Opportunity", () => {
  const result = computeMatch(
    opportunity({ proof_strength: 30 }),
    slot({ required_proof_strength: "verified" }),
    requirement,
  );
  assert.equal(result.dimensions.proof_requirement, 0);
});

test("computeMatch: verified proof requirement passes a strongly-scored Opportunity", () => {
  const result = computeMatch(
    opportunity({ proof_strength: 85 }),
    slot({ required_proof_strength: "verified" }),
    requirement,
  );
  assert.equal(result.dimensions.proof_requirement, 100);
});

test("computeMatch: an Opportunity expiring before the slot date scores zero timeliness", () => {
  const result = computeMatch(
    opportunity({ expires_at: "2026-09-01T00:00:00Z" }),
    slot({ scheduled_for: "2026-09-15" }),
    requirement,
  );
  assert.equal(result.dimensions.timeliness, 0);
});

/* --------------------------------------------------------- pickBestMatch */

test("pickBestMatch: picks the highest-scoring eligible candidate", () => {
  const weak = opportunity({ id: "weak", candidate_formats: ["carousel"], candidate_channels: ["facebook"] });
  const strong = opportunity({ id: "strong" });
  const best = pickBestMatch(slot(), requirement, [weak, strong], new Set());
  assert.ok(best);
  assert.equal(best?.opportunity.id, "strong");
});

test("pickBestMatch: skips an already-claimed candidate", () => {
  const only = opportunity({ id: "only" });
  const best = pickBestMatch(slot(), requirement, [only], new Set(["only"]));
  assert.equal(best, null);
});

test("pickBestMatch: returns null when nothing clears MIN_MATCH_SCORE", () => {
  const poor = opportunity({
    id: "poor",
    candidate_formats: ["carousel"], candidate_channels: ["facebook"],
    origin: "research", funnel_stage: "decision", audience: "totally unrelated segment",
    proof_strength: 0,
  });
  const best = pickBestMatch(slot({ required_proof_strength: "verified" }), requirement, [poor], new Set());
  assert.equal(best, null);
  // sanity: confirm the fixture really is below threshold, not a false negative
  assert.ok(computeMatch(poor, slot({ required_proof_strength: "verified" }), requirement).overallScore < MIN_MATCH_SCORE);
});

/* --------------------------------------------------------- applyProposalEdit */

function slotState(overrides: Partial<ProposalSlotState> = {}): ProposalSlotState {
  return {
    id: "slot-a", calendar_slot_id: "cal-a",
    content_opportunity_id: "opp-a", original_content_opportunity_id: "opp-a",
    ...overrides,
  };
}

test("applyProposalEdit move: relocates an assignment, clears the source", () => {
  const slots = [slotState(), slotState({ id: "slot-b", calendar_slot_id: "cal-b", content_opportunity_id: null, original_content_opportunity_id: null })];
  const result = applyProposalEdit("move", slots, { fromSlotId: "slot-a", toSlotId: "slot-b" });
  assert.ok(result.ok);
  assert.deepEqual(result.updates, [
    { slotId: "slot-a", content_opportunity_id: null, placement_source: null, manually_edited: true },
    { slotId: "slot-b", content_opportunity_id: "opp-a", placement_source: "manual", manually_edited: true },
  ]);
});

test("applyProposalEdit move: rejects moving into an occupied target", () => {
  const slots = [slotState(), slotState({ id: "slot-b", calendar_slot_id: "cal-b", content_opportunity_id: "opp-b" })];
  const result = applyProposalEdit("move", slots, { fromSlotId: "slot-a", toSlotId: "slot-b" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TARGET_SLOT_OCCUPIED");
});

test("applyProposalEdit swap: exchanges two assignments", () => {
  const slots = [slotState(), slotState({ id: "slot-b", calendar_slot_id: "cal-b", content_opportunity_id: "opp-b", original_content_opportunity_id: "opp-b" })];
  const result = applyProposalEdit("swap", slots, { fromSlotId: "slot-a", toSlotId: "slot-b" });
  assert.ok(result.ok);
  assert.deepEqual(result.updates, [
    { slotId: "slot-a", content_opportunity_id: "opp-b", placement_source: "manual", manually_edited: true },
    { slotId: "slot-b", content_opportunity_id: "opp-a", placement_source: "manual", manually_edited: true },
  ]);
});

test("applyProposalEdit remove: clears an assignment", () => {
  const result = applyProposalEdit("remove", [slotState()], { slotId: "slot-a" });
  assert.ok(result.ok);
  assert.deepEqual(result.updates, [{ slotId: "slot-a", content_opportunity_id: null, placement_source: null, manually_edited: true }]);
});

test("applyProposalEdit remove: rejects an already-empty slot", () => {
  const result = applyProposalEdit("remove", [slotState({ content_opportunity_id: null })], { slotId: "slot-a" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SLOT_ALREADY_EMPTY");
});

test("applyProposalEdit restore: reverts a manual edit back to the model's original", () => {
  const slots = [slotState({ content_opportunity_id: "opp-manual", original_content_opportunity_id: "opp-model" })];
  const result = applyProposalEdit("restore", slots, { slotId: "slot-a" });
  assert.ok(result.ok);
  assert.deepEqual(result.updates, [{ slotId: "slot-a", content_opportunity_id: "opp-model", placement_source: "restored", manually_edited: false }]);
});

test("applyProposalEdit restore: rejects when already at the original assignment", () => {
  const result = applyProposalEdit("restore", [slotState()], { slotId: "slot-a" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ALREADY_AT_ORIGINAL");
});

test("applyProposalEdit restore: rejects a slot that was never model-proposed", () => {
  const slots = [slotState({ original_content_opportunity_id: null })];
  const result = applyProposalEdit("restore", slots, { slotId: "slot-a" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_ORIGINAL_ASSIGNMENT");
});
