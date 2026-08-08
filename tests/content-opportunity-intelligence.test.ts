// Programme Stage F — Content Opportunity Intelligence, deterministic unit
// coverage. No provider call and no database is touched: every function
// under test here is pure, matching the "server always computes the
// authoritative value" contract (overall score, eligibility, dedup,
// transition validity all fail closed on bad input rather than guessing).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractJsonArray,
  validateGeneratedCandidate,
  checkEligibility,
  checkDuplicate,
  findTransitionPath,
  computeOverallScore as denoComputeOverallScore,
  OPPORTUNITY_SCORE_DIMENSIONS as denoScoreDimensions,
  CONTENT_OPPORTUNITY_TRANSITIONS as denoTransitions,
  type GeneratedOpportunityCandidate,
} from "../supabase/functions/_shared/opportunity-intelligence.ts";
import {
  computeOverallScore,
  OPPORTUNITY_SCORE_DIMENSIONS,
  type OpportunityDimensionScores,
} from "../src/types/content-opportunity-scoring.ts";
import { CONTENT_OPPORTUNITY_TRANSITIONS } from "../src/types/content-spine.ts";

/* --------------------------------------------------------- Deno/frontend parity
 * The Edge Function runtime cannot cross-import src/types/ (see the comment in
 * opportunity-intelligence.ts), so the rubric and transition table are
 * deliberately duplicated. These tests are the regression guard against the
 * two copies drifting apart. */

test("parity: Deno and frontend score dimensions are identical", () => {
  assert.deepEqual(denoScoreDimensions, OPPORTUNITY_SCORE_DIMENSIONS);
});

test("parity: Deno and frontend transition tables are identical", () => {
  assert.deepEqual(denoTransitions, CONTENT_OPPORTUNITY_TRANSITIONS);
});

test("parity: Deno and frontend computeOverallScore agree on the same input", () => {
  const dims = Object.fromEntries(
    OPPORTUNITY_SCORE_DIMENSIONS.map((d) => [d.key, 73]),
  ) as OpportunityDimensionScores;
  assert.equal(denoComputeOverallScore(dims), computeOverallScore(dims));
});

/* --------------------------------------------------------- computeOverallScore */

test("computeOverallScore: all-100 dimensions yield 100", () => {
  const dims = Object.fromEntries(
    OPPORTUNITY_SCORE_DIMENSIONS.map((d) => [d.key, 100]),
  ) as OpportunityDimensionScores;
  assert.equal(computeOverallScore(dims), 100);
});

test("computeOverallScore: all-zero dimensions yield 0", () => {
  const dims = Object.fromEntries(
    OPPORTUNITY_SCORE_DIMENSIONS.map((d) => [d.key, 0]),
  ) as OpportunityDimensionScores;
  assert.equal(computeOverallScore(dims), 0);
});

test("computeOverallScore: weights the dimensions, not a flat average", () => {
  // strategic_fit (weight 20) at 100, everything else at 0 — weight is 20/100.
  const dims = Object.fromEntries(
    OPPORTUNITY_SCORE_DIMENSIONS.map((d) => [d.key, 0]),
  ) as OpportunityDimensionScores;
  dims.strategic_fit = 100;
  assert.equal(computeOverallScore(dims), 20);
});

test("computeOverallScore: rejects an out-of-range dimension rather than clamping", () => {
  const dims = Object.fromEntries(
    OPPORTUNITY_SCORE_DIMENSIONS.map((d) => [d.key, 50]),
  ) as OpportunityDimensionScores;
  dims.novelty = 150;
  assert.throws(() => computeOverallScore(dims), /Invalid novelty score/);
});

test("computeOverallScore: rejects a missing dimension", () => {
  const dims = { strategic_fit: 50 } as unknown as OpportunityDimensionScores;
  assert.throws(() => computeOverallScore(dims));
});

/* --------------------------------------------------------- extractJsonArray */

test("extractJsonArray: parses raw JSON array", () => {
  assert.deepEqual(extractJsonArray('[{"a":1}]'), [{ a: 1 }]);
});

test("extractJsonArray: parses a ```json fenced block", () => {
  const text = "Here is the result:\n```json\n[{\"a\":1}]\n```\nDone.";
  assert.deepEqual(extractJsonArray(text), [{ a: 1 }]);
});

test("extractJsonArray: recovers a bracket-sliced array from surrounding prose", () => {
  const text = 'Sure, here you go: [{"a":1}] — let me know if you need more.';
  assert.deepEqual(extractJsonArray(text), [{ a: 1 }]);
});

test("extractJsonArray: returns null for a JSON object, not an array", () => {
  assert.equal(extractJsonArray('{"a":1}'), null);
});

test("extractJsonArray: returns null for unparseable text", () => {
  assert.equal(extractJsonArray("not json at all"), null);
});

/* --------------------------------------------------------- validateGeneratedCandidate */

const VALID_RAW = {
  title: "How a single testimonial closed a $40k deal",
  angle: "Proof-led close",
  rationale: null,
  core_claim: "One verified testimonial closed a $40k deal",
  hook_direction: null, audience: null, pain_or_objection: null,
  belief_before: null, belief_after: null, objective: null,
  offer_relationship: null, funnel_stage: null,
  candidate_formats: ["reel"], candidate_channels: ["instagram"],
  cta_direction: null, visual_potential: 4, production_requirements: null,
  claim_unsupported: false,
};

test("validateGeneratedCandidate: accepts a well-formed candidate", () => {
  const result = validateGeneratedCandidate(VALID_RAW);
  assert.ok(result);
  assert.equal(result?.title, VALID_RAW.title);
  assert.equal(result?.visual_potential, 4);
});

test("validateGeneratedCandidate: rejects a missing title", () => {
  assert.equal(validateGeneratedCandidate({ ...VALID_RAW, title: "" }), null);
});

test("validateGeneratedCandidate: rejects visual_potential out of 1-5", () => {
  assert.equal(validateGeneratedCandidate({ ...VALID_RAW, visual_potential: 9 }), null);
});

test("validateGeneratedCandidate: rejects candidate_formats that isn't a string array", () => {
  assert.equal(validateGeneratedCandidate({ ...VALID_RAW, candidate_formats: "reel" }), null);
});

test("validateGeneratedCandidate: rejects a non-object", () => {
  assert.equal(validateGeneratedCandidate("not an object"), null);
  assert.equal(validateGeneratedCandidate(null), null);
});

test("validateGeneratedCandidate: defaults missing optional arrays to empty, not null", () => {
  const { candidate_formats, candidate_channels, ...rest } = VALID_RAW;
  void candidate_formats; void candidate_channels;
  const result = validateGeneratedCandidate(rest);
  assert.deepEqual(result?.candidate_formats, []);
  assert.deepEqual(result?.candidate_channels, []);
});

/* --------------------------------------------------------- checkEligibility */

function candidate(overrides: Partial<GeneratedOpportunityCandidate> = {}): GeneratedOpportunityCandidate {
  return { ...(validateGeneratedCandidate(VALID_RAW) as GeneratedOpportunityCandidate), ...overrides };
}

test("checkEligibility: eligible when every signal is clear", () => {
  const result = checkEligibility(candidate(), {
    clientStatus: "active",
    requiresConsent: false, consentStatus: null,
    requiresVerifiedProof: false, proofVerificationStatus: null,
    hasUnresolvedBlockingConflict: false,
  });
  assert.deepEqual(result, { status: "eligible", reason: null });
});

test("checkEligibility: model-flagged unsupported claim is ineligible regardless of other signals", () => {
  const result = checkEligibility(candidate({ claim_unsupported: true }), {
    clientStatus: "active",
    requiresConsent: false, consentStatus: null,
    requiresVerifiedProof: false, proofVerificationStatus: null,
    hasUnresolvedBlockingConflict: false,
  });
  assert.deepEqual(result, { status: "ineligible", reason: "unsupported_claim" });
});

test("checkEligibility: missing consent blocks a proof-sourced candidate", () => {
  const result = checkEligibility(candidate(), {
    clientStatus: "active",
    requiresConsent: true, consentStatus: "not_obtained",
    requiresVerifiedProof: true, proofVerificationStatus: "verified",
    hasUnresolvedBlockingConflict: false,
  });
  assert.deepEqual(result, { status: "ineligible", reason: "missing_consent" });
});

test("checkEligibility: not_required consent status is treated as clear", () => {
  const result = checkEligibility(candidate(), {
    clientStatus: "active",
    requiresConsent: true, consentStatus: "not_required",
    requiresVerifiedProof: false, proofVerificationStatus: null,
    hasUnresolvedBlockingConflict: false,
  });
  assert.equal(result.status, "eligible");
});

test("checkEligibility: unverified proof blocks a proof-sourced candidate", () => {
  const result = checkEligibility(candidate(), {
    clientStatus: "active",
    requiresConsent: false, consentStatus: null,
    requiresVerifiedProof: true, proofVerificationStatus: "unverified",
    hasUnresolvedBlockingConflict: false,
  });
  assert.deepEqual(result, { status: "ineligible", reason: "missing_mandatory_proof" });
});

test("checkEligibility: an unresolved blocking conflict fails closed", () => {
  const result = checkEligibility(candidate(), {
    clientStatus: "active",
    requiresConsent: false, consentStatus: null,
    requiresVerifiedProof: false, proofVerificationStatus: null,
    hasUnresolvedBlockingConflict: true,
  });
  assert.deepEqual(result, { status: "ineligible", reason: "conflicting_authority" });
});

test("checkEligibility: a paused or churned client is ineligible (inactive_offer proxy)", () => {
  for (const status of ["paused", "churned"]) {
    const result = checkEligibility(candidate(), {
      clientStatus: status,
      requiresConsent: false, consentStatus: null,
      requiresVerifiedProof: false, proofVerificationStatus: null,
      hasUnresolvedBlockingConflict: false,
    });
    assert.deepEqual(result, { status: "ineligible", reason: "inactive_offer" });
  }
});

/* --------------------------------------------------------- checkDuplicate */

test("checkDuplicate: flags a normalised exact title match", () => {
  const result = checkDuplicate(candidate({ title: "How A Testimonial Closed The Deal!" }), [
    { id: "existing-1", title: "how a testimonial closed the deal", core_claim: null },
  ]);
  assert.deepEqual(result, { duplicateOfId: "existing-1", reason: "same_title" });
});

test("checkDuplicate: flags a normalised exact core_claim match", () => {
  const result = checkDuplicate(candidate({ title: "A totally different title", core_claim: "Same claim, different words?" }), [
    { id: "existing-2", title: "Unrelated title", core_claim: "same claim different words" },
  ]);
  assert.deepEqual(result, { duplicateOfId: "existing-2", reason: "same_core_claim" });
});

test("checkDuplicate: no match returns null duplicate", () => {
  const result = checkDuplicate(candidate({ title: "Something brand new", core_claim: "A fresh claim" }), [
    { id: "existing-3", title: "Completely unrelated", core_claim: "Also unrelated" },
  ]);
  assert.deepEqual(result, { duplicateOfId: null, reason: null });
});

/* --------------------------------------------------------- findTransitionPath */

test("findTransitionPath: draft to shortlisted walks two valid hops", () => {
  const path = findTransitionPath(CONTENT_OPPORTUNITY_TRANSITIONS, "draft", "shortlisted");
  assert.deepEqual(path, ["draft", "needs_review", "shortlisted"]);
});

test("findTransitionPath: needs_review to selected walks two valid hops", () => {
  const path = findTransitionPath(CONTENT_OPPORTUNITY_TRANSITIONS, "needs_review", "selected");
  assert.deepEqual(path, ["needs_review", "shortlisted", "selected"]);
});

test("findTransitionPath: single valid hop", () => {
  const path = findTransitionPath(CONTENT_OPPORTUNITY_TRANSITIONS, "shortlisted", "selected");
  assert.deepEqual(path, ["shortlisted", "selected"]);
});

test("findTransitionPath: same status is a trivial one-element path", () => {
  const path = findTransitionPath(CONTENT_OPPORTUNITY_TRANSITIONS, "draft", "draft");
  assert.deepEqual(path, ["draft"]);
});

test("findTransitionPath: no path from a terminal status", () => {
  const path = findTransitionPath(CONTENT_OPPORTUNITY_TRANSITIONS, "rejected", "selected");
  assert.equal(path, null);
});

test("findTransitionPath: cannot walk backwards", () => {
  const path = findTransitionPath(CONTENT_OPPORTUNITY_TRANSITIONS, "shortlisted", "draft");
  assert.equal(path, null);
});
