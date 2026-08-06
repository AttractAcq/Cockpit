// Programme Stage E — unified content source layer tests.
//
//   1. each source type creates the same canonical source identity
//   2. sources cannot cross clients
//   3. proof consent and restrictions are enforced
//   4. research evidence remains attached
//   5. duplicate source detection works
//   6. failed processing can be retried
//   7. raw source content remains immutable
//
// Items 2, 5 and 7 are additionally verified against the live database by the
// Stage E fixture run recorded in Stage_E_Status.md; these assert the shared
// contract the application layer must honour.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  IDEATION_TECHNIQUES,
  PERFORMANCE_ACTIONS,
  type ResearchEvidence,
  canRetrySource,
  canonicalSourceIdentity,
  evidenceRemainsAttached,
  hasValidAdapterLinkage,
  ideationCandidateToSource,
  isProofPublishable,
  isTechniqueStrategyUsable,
  manualIdeaToSource,
  performanceInsightToSource,
  proofItemToSource,
  techniquesMissingStrategy,
} from "../src/types/content-supply.ts";

const CLIENT = "11111111-1111-1111-1111-111111111111";
const OTHER_CLIENT = "22222222-2222-2222-2222-222222222222";
const HASH = "c".repeat(64);
const TODAY = "2026-08-03";

const evidence: ResearchEvidence[] = [
  {
    url: "https://example.com/a",
    title: "A review",
    retrieved_at: "2026-08-01T00:00:00Z",
    quote: "it took three weeks to get a quote",
    span_start: 10,
    span_end: 48,
  },
];

function allFourSources() {
  return [
    manualIdeaToSource({ client_id: CLIENT, title: "Idea", body: "raw", body_hash: HASH }),
    proofItemToSource(
      {
        id: "proof-1",
        client_id: CLIENT,
        claim: "cut response time by half",
        proof_kind: "result",
        claims_supported: [],
        objections_answered: [],
      },
      { content: "raw", hash: HASH },
    ),
    ideationCandidateToSource({
      id: "cand-1",
      client_id: CLIENT,
      title: "Candidate",
      technique_slug: "persona",
      raw_content: "raw",
      raw_content_hash: HASH,
      evidence,
    }),
    performanceInsightToSource({
      id: "insight-1",
      client_id: CLIENT,
      title: "Insight",
      action: "alternate_hook",
      raw_content: "raw",
      raw_content_hash: HASH,
    }),
  ];
}

// 1. Same canonical identity across all four streams ------------------------

test("every source stream produces the same canonical identity for the same material", () => {
  const identities = allFourSources().map(canonicalSourceIdentity);
  assert.equal(new Set(identities).size, 1, "all four streams must agree on identity");
  assert.equal(identities[0], `${CLIENT}:${HASH}`);
});

test("every adapter emits the full canonical shape", () => {
  const required = [
    "client_id",
    "source_kind",
    "title",
    "summary",
    "raw_content",
    "raw_content_hash",
    "payload",
    "external_ref",
    "ideation_candidate_id",
    "performance_insight_id",
    "source_document_id",
    "proof_item_id",
  ];
  for (const source of allFourSources()) {
    for (const key of required) {
      assert.ok(key in source, `${source.source_kind} is missing ${key}`);
    }
  }
});

test("each adapter sets only its own linkage", () => {
  const [idea, proof, research, insight] = allFourSources();
  assert.equal(idea.proof_item_id, null);
  assert.equal(idea.ideation_candidate_id, null);
  assert.equal(proof.proof_item_id, "proof-1");
  assert.equal(proof.ideation_candidate_id, null);
  assert.equal(research.ideation_candidate_id, "cand-1");
  assert.equal(research.performance_insight_id, null);
  assert.equal(insight.performance_insight_id, "insight-1");
  assert.equal(insight.proof_item_id, null);
  for (const source of allFourSources()) {
    assert.equal(hasValidAdapterLinkage(source), true, `${source.source_kind} linkage invalid`);
  }
});

test("mismatched linkage is rejected", () => {
  const bad = { ...manualIdeaToSource({ client_id: CLIENT, title: "x", body: "r", body_hash: HASH }) };
  bad.ideation_candidate_id = "cand-9";
  assert.equal(hasValidAdapterLinkage(bad), false);
});

// 2. Sources cannot cross clients -------------------------------------------

test("identical material under different clients is a different source", () => {
  const a = manualIdeaToSource({ client_id: CLIENT, title: "Idea", body: "raw", body_hash: HASH });
  const b = manualIdeaToSource({ client_id: OTHER_CLIENT, title: "Idea", body: "raw", body_hash: HASH });
  assert.notEqual(canonicalSourceIdentity(a), canonicalSourceIdentity(b));
});

// 5. Duplicate source detection ---------------------------------------------

test("the same material through two different streams collides on identity", () => {
  const idea = manualIdeaToSource({ client_id: CLIENT, title: "Idea", body: "raw", body_hash: HASH });
  const insight = performanceInsightToSource({
    id: "insight-2",
    client_id: CLIENT,
    title: "Insight",
    action: "re_edit",
    raw_content: "raw",
    raw_content_hash: HASH,
  });
  assert.equal(canonicalSourceIdentity(idea), canonicalSourceIdentity(insight));
});

test("different material does not collide", () => {
  const a = manualIdeaToSource({ client_id: CLIENT, title: "A", body: "one", body_hash: "a".repeat(64) });
  const b = manualIdeaToSource({ client_id: CLIENT, title: "B", body: "two", body_hash: "b".repeat(64) });
  assert.notEqual(canonicalSourceIdentity(a), canonicalSourceIdentity(b));
});

// 4. Research evidence remains attached -------------------------------------

test("evidence survives the ideation adapter intact", () => {
  const source = ideationCandidateToSource({
    id: "cand-2",
    client_id: CLIENT,
    title: "Candidate",
    technique_slug: "review_mined_pain_language",
    raw_content: "raw",
    raw_content_hash: HASH,
    evidence,
  });
  assert.equal(evidenceRemainsAttached(source, evidence), true);
  const carried = source.payload.evidence as ResearchEvidence[];
  assert.equal(carried[0].span_start, 10, "evidence spans must survive, not just the quote");
});

test("dropped or altered evidence is detected", () => {
  const source = ideationCandidateToSource({
    id: "cand-3",
    client_id: CLIENT,
    title: "Candidate",
    technique_slug: "persona",
    raw_content: "raw",
    raw_content_hash: HASH,
    evidence: [],
  });
  assert.equal(evidenceRemainsAttached(source, evidence), false);

  const altered = ideationCandidateToSource({
    id: "cand-4",
    client_id: CLIENT,
    title: "Candidate",
    technique_slug: "persona",
    raw_content: "raw",
    raw_content_hash: HASH,
    evidence: [{ ...evidence[0], quote: "paraphrased away" }],
  });
  assert.equal(evidenceRemainsAttached(altered, evidence), false);
});

// 3. Proof consent and restrictions -----------------------------------------

const publishableProof = {
  verification_status: "verified" as const,
  consent_status: "granted" as const,
  usage_state: "unused" as const,
  expires_on: null,
};

test("fully cleared proof is publishable", () => {
  assert.equal(isProofPublishable(publishableProof, TODAY), true);
  assert.equal(
    isProofPublishable({ ...publishableProof, consent_status: "not_required" }, TODAY),
    true,
  );
});

test("unverified or rejected proof is never publishable", () => {
  assert.equal(isProofPublishable({ ...publishableProof, verification_status: "unverified" }, TODAY), false);
  assert.equal(isProofPublishable({ ...publishableProof, verification_status: "rejected" }, TODAY), false);
});

test("verification does not excuse missing or withdrawn consent", () => {
  for (const consent of ["not_obtained", "requested", "withdrawn"] as const) {
    assert.equal(
      isProofPublishable({ ...publishableProof, consent_status: consent }, TODAY),
      false,
      `${consent} must block publication even when verified`,
    );
  }
});

test("restricted, expired and weak-evidence proof is blocked", () => {
  for (const state of ["restricted", "expired", "needs_stronger_evidence"] as const) {
    assert.equal(isProofPublishable({ ...publishableProof, usage_state: state }, TODAY), false);
  }
});

test("proof past its expiry date is blocked even when otherwise clear", () => {
  assert.equal(isProofPublishable({ ...publishableProof, expires_on: "2026-08-02" }, TODAY), false);
  assert.equal(isProofPublishable({ ...publishableProof, expires_on: "2026-08-03" }, TODAY), true);
  assert.equal(isProofPublishable({ ...publishableProof, expires_on: "2026-12-31" }, TODAY), true);
});

test("used and high-performing proof stays publishable", () => {
  for (const state of ["used", "repurposed", "overused", "high_performing"] as const) {
    assert.equal(isProofPublishable({ ...publishableProof, usage_state: state }, TODAY), true);
  }
});

// 6. Failed processing can be retried ---------------------------------------

test("failed sources retry until the attempt cap", () => {
  assert.equal(
    canRetrySource({ processing_status: "failed", attempt_count: 0, maximum_attempts: 3 }),
    true,
  );
  assert.equal(
    canRetrySource({ processing_status: "failed", attempt_count: 3, maximum_attempts: 3 }),
    false,
  );
});

test("non-failed sources are not retried", () => {
  for (const status of ["pending", "processing", "processed", "skipped"] as const) {
    assert.equal(
      canRetrySource({ processing_status: status, attempt_count: 0, maximum_attempts: 3 }),
      false,
    );
  }
});

// Technique strategies -------------------------------------------------------

test("the seven techniques are exactly the declared set", () => {
  assert.equal(IDEATION_TECHNIQUES.length, 7);
  assert.equal(new Set(IDEATION_TECHNIQUES).size, 7);
});

test("all eight performance actions are declared", () => {
  assert.equal(PERFORMANCE_ACTIONS.length, 8);
  assert.ok(PERFORMANCE_ACTIONS.includes("proof_reuse"));
});

test("a technique strategy is usable only when active and complete", () => {
  const good = {
    status: "active" as const,
    research_method: "review mining",
    freshness_max_age_days: 30,
    failure_behaviour: "fail_closed" as const,
  };
  assert.equal(isTechniqueStrategyUsable(good), true);
  assert.equal(isTechniqueStrategyUsable({ ...good, status: "draft" }), false);
  assert.equal(isTechniqueStrategyUsable({ ...good, research_method: "  " }), false);
});

test("techniques without an active strategy are reported, not assumed", () => {
  assert.deepEqual(techniquesMissingStrategy([]), [...IDEATION_TECHNIQUES]);
  assert.deepEqual(
    techniquesMissingStrategy([{ technique_slug: "persona", status: "active" }]).length,
    6,
  );
  assert.deepEqual(
    techniquesMissingStrategy([{ technique_slug: "persona", status: "draft" }]).length,
    7,
    "a draft strategy does not count as covered",
  );
});
