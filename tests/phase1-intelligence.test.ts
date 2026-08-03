// Programme Stage C — required Phase 1 intelligence tests.
//
// Covers each test named in the Stage C prompt:
//   1. uploaded-file content reaches generation
//   2. unsupported claims fail or require review
//   3. changed playbook version changes the generation identity
//   4. stale playbook cannot silently replace locked authority
//   5. source citations remain traceable
//   6. conflicting inputs are surfaced
//   7. missing required information is not invented

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  areAllClaimsTraceable,
  blockingConflicts,
  isCitationTraceable,
  isDocumentRecoverable,
  isDocumentUsableForGeneration,
  isPlaybookAuthorityCurrent,
  isResearchSourcePublishable,
  missingRequiredFields,
  playbookGenerationIdentity,
} from "../src/types/phase1-intelligence.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

// 1. Uploaded-file content reaches generation ------------------------------

test("only extracted documents with text reach generation", () => {
  assert.equal(
    isDocumentUsableForGeneration({
      processing_status: "extracted",
      extracted_text: "real client copy",
    }),
    true,
  );
  for (const status of ["pending", "extracting", "failed", "skipped"] as const) {
    assert.equal(
      isDocumentUsableForGeneration({ processing_status: status, extracted_text: "text" }),
      false,
      `${status} must not feed generation`,
    );
  }
  assert.equal(
    isDocumentUsableForGeneration({ processing_status: "extracted", extracted_text: "" }),
    false,
  );
  assert.equal(
    isDocumentUsableForGeneration({ processing_status: "extracted", extracted_text: null }),
    false,
  );
});

test("failed documents are recoverable until the attempt cap", () => {
  assert.equal(
    isDocumentRecoverable({ processing_status: "failed", attempt_count: 1, maximum_attempts: 3 }),
    true,
  );
  assert.equal(
    isDocumentRecoverable({ processing_status: "failed", attempt_count: 3, maximum_attempts: 3 }),
    false,
  );
  assert.equal(
    isDocumentRecoverable({ processing_status: "extracted", attempt_count: 0, maximum_attempts: 3 }),
    false,
  );
});

// 2 & 5. Unsupported claims fail closed; citations stay traceable -----------

const baseCitation = {
  source_type: "client_input" as const,
  client_input_field: null,
  source_document_id: null,
  research_source_id: null,
  inference_rationale: null,
  inference_approved_by: null,
  inference_approved_at: null,
};

test("a claim with no origin is not traceable", () => {
  assert.equal(isCitationTraceable(baseCitation), false);
});

test("each single-origin citation form is traceable", () => {
  assert.equal(
    isCitationTraceable({ ...baseCitation, client_input_field: "offer_details" }),
    true,
  );
  assert.equal(
    isCitationTraceable({
      ...baseCitation,
      source_type: "source_document",
      source_document_id: "doc-1",
    }),
    true,
  );
  assert.equal(
    isCitationTraceable({
      ...baseCitation,
      source_type: "research_source",
      research_source_id: "res-1",
    }),
    true,
  );
});

test("a citation may not claim two origins at once", () => {
  assert.equal(
    isCitationTraceable({
      ...baseCitation,
      source_type: "source_document",
      source_document_id: "doc-1",
      research_source_id: "res-1",
    }),
    false,
  );
  assert.equal(
    isCitationTraceable({
      ...baseCitation,
      source_type: "client_input",
      client_input_field: "offer_details",
      source_document_id: "doc-1",
    }),
    false,
  );
});

test("an inference is unusable until a human approves it", () => {
  const unapproved = {
    ...baseCitation,
    source_type: "approved_inference" as const,
    inference_rationale: "derived from stated positioning",
  };
  assert.equal(isCitationTraceable(unapproved), false);
  assert.equal(
    isCitationTraceable({ ...unapproved, inference_approved_by: "user-1" }),
    false,
    "approver without timestamp must still fail",
  );
  assert.equal(
    isCitationTraceable({
      ...unapproved,
      inference_approved_by: "user-1",
      inference_approved_at: "2026-08-03T00:00:00Z",
    }),
    true,
  );
});

test("an inference with no rationale is never traceable", () => {
  assert.equal(
    isCitationTraceable({
      ...baseCitation,
      source_type: "approved_inference",
      inference_approved_by: "user-1",
      inference_approved_at: "2026-08-03T00:00:00Z",
    }),
    false,
  );
});

test("a file is traceable only when every claim is cited", () => {
  const good = { ...baseCitation, client_input_field: "offer_details" };
  assert.equal(areAllClaimsTraceable([good, good]), true);
  assert.equal(areAllClaimsTraceable([good, baseCitation]), false);
  assert.equal(areAllClaimsTraceable([]), false, "no citations is not traceable");
});

test("research marked do_not_publish never reaches output", () => {
  assert.equal(isResearchSourcePublishable({ use_restriction: "unrestricted" }), true);
  assert.equal(isResearchSourcePublishable({ use_restriction: "attribution_required" }), true);
  assert.equal(isResearchSourcePublishable({ use_restriction: "review_required" }), false);
  assert.equal(isResearchSourcePublishable({ use_restriction: "do_not_publish" }), false);
});

// 3. Changed playbook version changes generation identity -------------------

test("generation identity changes when a playbook version changes", () => {
  const v1 = [{ playbook_id: "pb-1", playbook_version: 1, playbook_content_hash: HASH_A }];
  const v2 = [{ playbook_id: "pb-1", playbook_version: 2, playbook_content_hash: HASH_A }];
  assert.notEqual(playbookGenerationIdentity(v1), playbookGenerationIdentity(v2));
});

test("generation identity changes when only the content hash changes", () => {
  const a = [{ playbook_id: "pb-1", playbook_version: 1, playbook_content_hash: HASH_A }];
  const b = [{ playbook_id: "pb-1", playbook_version: 1, playbook_content_hash: HASH_B }];
  assert.notEqual(playbookGenerationIdentity(a), playbookGenerationIdentity(b));
});

test("generation identity is stable regardless of playbook ordering", () => {
  const one = [
    { playbook_id: "pb-1", playbook_version: 1, playbook_content_hash: HASH_A },
    { playbook_id: "pb-2", playbook_version: 3, playbook_content_hash: HASH_B },
  ];
  const other = [one[1], one[0]];
  assert.equal(playbookGenerationIdentity(one), playbookGenerationIdentity(other));
});

// 4. Stale playbook cannot silently replace locked authority ----------------

test("recorded playbook authority is current only on an exact match", () => {
  const recorded = { playbook_version: 2, playbook_content_hash: HASH_A };
  assert.equal(
    isPlaybookAuthorityCurrent(recorded, { version: 2, content_hash: HASH_A, status: "active" }),
    true,
  );
  assert.equal(
    isPlaybookAuthorityCurrent(recorded, { version: 3, content_hash: HASH_A, status: "active" }),
    false,
    "a newer version is not the locked authority",
  );
  assert.equal(
    isPlaybookAuthorityCurrent(recorded, { version: 2, content_hash: HASH_B, status: "active" }),
    false,
    "same version number with edited content must not pass",
  );
  for (const status of ["draft", "superseded"] as const) {
    assert.equal(
      isPlaybookAuthorityCurrent(recorded, { version: 2, content_hash: HASH_A, status }),
      false,
      `a ${status} version is not active authority`,
    );
  }
});

// 6. Conflicting inputs are surfaced ---------------------------------------

test("open and acknowledged blocking conflicts halt approval", () => {
  const conflicts = [
    { severity: "blocking" as const, status: "open" as const },
    { severity: "blocking" as const, status: "acknowledged" as const },
    { severity: "blocking" as const, status: "resolved" as const },
    { severity: "warning" as const, status: "open" as const },
    { severity: "info" as const, status: "open" as const },
  ];
  assert.equal(blockingConflicts(conflicts), 2);
  assert.equal(blockingConflicts([]), 0);
});

test("resolved and dismissed blocking conflicts no longer halt approval", () => {
  assert.equal(
    blockingConflicts([
      { severity: "blocking", status: "resolved" },
      { severity: "blocking", status: "dismissed" },
    ]),
    0,
  );
});

// 7. Missing required information is not invented --------------------------

test("missing required fields are reported as gaps", () => {
  const required = ["business_description", "offer_details", "target_customer"];
  assert.deepEqual(
    missingRequiredFields(required, {
      business_description: "a real description",
      offer_details: "",
      target_customer: null,
    }),
    ["offer_details", "target_customer"],
  );
});

test("a fully provided input set reports no gaps", () => {
  assert.deepEqual(
    missingRequiredFields(["a", "b"], { a: "one", b: "two" }),
    [],
  );
});

test("whitespace-only input counts as missing, not as content", () => {
  assert.deepEqual(missingRequiredFields(["a"], { a: "   " }), ["a"]);
});
