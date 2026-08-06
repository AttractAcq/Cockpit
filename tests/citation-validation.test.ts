// Programme Stage C — claim-level citation validation.
//
// The load-bearing test here is adversarial: a model citing a source that does
// not exist must cause the file to be REJECTED, not written with a plausible
// but false provenance attached.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type ModelCitation,
  type SourceInventory,
  validateCitations,
} from "../supabase/functions/_shared/supply/citations.ts";

const DOC_ID = "11111111-1111-1111-1111-111111111111";
const RESEARCH_ID = "22222222-2222-2222-2222-222222222222";
const GHOST_ID = "99999999-9999-9999-9999-999999999999";

const inventory: SourceInventory = {
  inputFields: ["business_description", "offer_details"],
  documents: [{ id: DOC_ID, label: "reviews.pdf" }],
  researchSources: [{ id: RESEARCH_ID, title: "Category report" }],
};

function cite(over: Partial<ModelCitation>): ModelCitation {
  return { claim_excerpt: "a claim", source_type: "client_input", ...over } as ModelCitation;
}

// Valid cases -------------------------------------------------------------

test("each supplied origin validates", () => {
  assert.deepEqual(
    validateCitations([cite({ client_input_field: "offer_details" })], inventory),
    [],
  );
  assert.deepEqual(
    validateCitations([cite({ source_type: "source_document", source_document_id: DOC_ID })], inventory),
    [],
  );
  assert.deepEqual(
    validateCitations([cite({ source_type: "research_source", research_source_id: RESEARCH_ID })], inventory),
    [],
  );
});

test("no citations is not itself an error", () => {
  assert.deepEqual(validateCitations([], inventory), []);
});

// Adversarial — invented sources ------------------------------------------

test("a document id that does not exist is rejected", () => {
  const errors = validateCitations(
    [cite({ source_type: "source_document", source_document_id: GHOST_ID })],
    inventory,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not exist/);
});

test("a research source id that does not exist is rejected", () => {
  const errors = validateCitations(
    [cite({ source_type: "research_source", research_source_id: GHOST_ID })],
    inventory,
  );
  assert.equal(errors.length, 1);
});

test("a client input field that was not supplied is rejected", () => {
  const errors = validateCitations([cite({ client_input_field: "invented_field" })], inventory);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /was not supplied/);
});

test("an empty inventory rejects every citation", () => {
  const empty: SourceInventory = { inputFields: [], documents: [], researchSources: [] };
  const errors = validateCitations(
    [
      cite({ client_input_field: "business_description" }),
      cite({ source_type: "source_document", source_document_id: DOC_ID }),
      cite({ source_type: "research_source", research_source_id: RESEARCH_ID }),
    ],
    empty,
  );
  assert.equal(errors.length, 3);
});

// Adversarial — malformed --------------------------------------------------

test("a citation with no id at all is rejected", () => {
  assert.equal(validateCitations([cite({ source_type: "source_document" })], inventory).length, 1);
  assert.equal(validateCitations([cite({ source_type: "research_source" })], inventory).length, 1);
  assert.equal(validateCitations([cite({ source_type: "client_input" })], inventory).length, 1);
});

test("an empty or whitespace claim_excerpt is rejected", () => {
  assert.equal(validateCitations([cite({ claim_excerpt: "" })], inventory).length, 1);
  assert.equal(validateCitations([cite({ claim_excerpt: "   " })], inventory).length, 1);
});

test("the model cannot emit approved_inference", () => {
  const errors = validateCitations(
    [{ claim_excerpt: "inferred", source_type: "approved_inference" } as unknown as ModelCitation],
    inventory,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /approved_inference is never model-emitted/);
});

test("an unknown source_type is rejected", () => {
  const errors = validateCitations(
    [{ claim_excerpt: "x", source_type: "vibes" } as unknown as ModelCitation],
    inventory,
  );
  assert.equal(errors.length, 1);
});

// Mixed --------------------------------------------------------------------

test("one bad citation among good ones still fails the file", () => {
  const errors = validateCitations(
    [
      cite({ client_input_field: "offer_details" }),
      cite({ source_type: "source_document", source_document_id: GHOST_ID }),
      cite({ source_type: "research_source", research_source_id: RESEARCH_ID }),
    ],
    inventory,
  );
  assert.equal(errors.length, 1, "exactly the invented citation must fail");
  assert.match(errors[0], /citation 2/);
});

test("errors identify which citation failed", () => {
  const errors = validateCitations(
    [cite({ client_input_field: "offer_details" }), cite({ client_input_field: "ghost" })],
    inventory,
    "[C01]",
  );
  assert.match(errors[0], /\[C01\] citation 2/);
});
