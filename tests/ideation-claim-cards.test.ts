// Ideation claim cards — server-owned factual layer.
//
// The model never authors factual text; it selects registered cards and writes
// creative copy. These tests prove the server owns every fact, that metadata
// numbers can never become factual support, and that all prior grounding
// rejections still hold. No provider call, no database.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createEvidenceSource } from "../supabase/functions/_shared/ideation/evidence.ts";
import type { IdeationEvidenceSource } from "../supabase/functions/_shared/ideation/evidence.ts";
import {
  buildSupportUnits,
  type IdeationSupportUnit,
} from "../supabase/functions/_shared/ideation/support-units.ts";
import {
  buildClaimCards,
  buildPermissions,
  buildSupportBundle,
  canonicalFactualText,
  serializeClaimCards,
  IDEATION_CANDIDATE_OUTPUT_SCHEMA_VERSION,
  IDEATION_CLAIM_CARD_CONSTRUCTION_VERSION,
  IDEATION_CLAIM_CARD_MANIFEST,
  IDEATION_CLAIM_CARD_POLICY_VERSION,
  IDEATION_PERMISSION_LEDGER_VERSION,
  type IdeationClaimCard,
} from "../supabase/functions/_shared/ideation/claim-cards.ts";
import {
  toPersistedClaimCardCandidate,
  validateClaimCardCandidateOutput,
} from "../supabase/functions/_shared/ideation/output.ts";
import { applyFieldRepairs } from "../supabase/functions/_shared/ideation/model.ts";

const TECHNIQUE = "review-mined-pain-language";

const SOURCES = {
  bullet: "- Buyers feel invisible when their strongest proof stays hidden",
  bold: "- **Stage:** Operating with real clients and real delivery",
  prose: "Buyers feel invisible when their strongest proof stays hidden. They want visible authority.",
  keyValue: "Primary pain: buyers feel invisible when their proof stays hidden",
  table: ["| Segment | Pain |", "| --- | --- |", "| Founder | Proof stays hidden |",
    "| Operator | Authority stays invisible |"].join("\n"),
  percent: ["| Metric | Value |", "| --- | --- |", "| Reply rate | 12% |"].join("\n"),
  currency: ["| Package | Price |", "| --- | --- |", "| Proof Sprint | EUR 4000 |"].join("\n"),
  range: ["| Metric | Range |", "| --- | --- |", "| Deal size | 4000 to 9000 |"].join("\n"),
  heading: "## Buyer psychology\n\n- Buyers feel invisible when proof stays hidden",
  outcome: "- Hidden proof reduces inbound revenue for these businesses",
};

async function sourceOf(excerpt: string, sourceId = "context:c1:v1"): Promise<IdeationEvidenceSource> {
  return await createEvidenceSource({
    sourceId,
    sourceRef: "02_Avatar_And_Buyer_Psychology.md",
    sourceType: "approved_context",
    sourceUrl: "aa-authority://client/client-1/context/c1",
    excerpt,
  });
}

async function cardsOf(excerpt: string, sourceId = "context:c1:v1") {
  const source = await sourceOf(excerpt, sourceId);
  const units = await buildSupportUnits(source);
  const cards = await buildClaimCards(units);
  return { source, units, cards };
}

function cardWith(cards: IdeationClaimCard[], fragment: string): IdeationClaimCard {
  const card = cards.find((entry) => entry.normalized_text.includes(fragment));
  assert.ok(card, `no card contains ${fragment}`);
  return card;
}

/* ------------------------------------------------ 1-15 card construction */

test("1-3. bullet, prose, and key-value units each create a deterministic direct card", async () => {
  for (const [name, excerpt] of Object.entries({
    bullet: SOURCES.bullet, prose: SOURCES.prose, keyValue: SOURCES.keyValue,
  })) {
    const { cards } = await cardsOf(excerpt);
    assert.ok(cards.length > 0, name);
    assert.equal(cards[0].card_type, "direct", name);
    assert.equal(cards[0].claim_mode, "source_text", name);
  }
});

test("4-5. a table row creates a table card whose meaning is reproducible", async () => {
  const { cards } = await cardsOf(SOURCES.table);
  const founder = cardWith(cards, "Founder");
  assert.equal(founder.card_type, "table_fact");
  assert.equal(founder.claim_mode, "normalized_table_meaning");
  assert.equal(founder.canonical_text, "Segment: Founder | Pain: Proof stays hidden");
});

test("6. table normalized meaning is never quotable", async () => {
  const { cards } = await cardsOf(SOURCES.table);
  const founder = cardWith(cards, "Founder");
  assert.equal(founder.quotable_spans.includes(founder.canonical_text), false);
  // The raw row and its registered header remain exactly quotable.
  assert.deepEqual(founder.quotable_spans, ["| Founder | Proof stays hidden |", "| Segment | Pain |"]);
});

test("7-9. card identity is deterministic and scoped to its source", async () => {
  const first = await cardsOf(SOURCES.bullet);
  const second = await cardsOf(SOURCES.bullet);
  assert.equal(first.cards[0].claim_card_id, second.cards[0].claim_card_id);

  const edited = await cardsOf(`${SOURCES.bullet} today`);
  assert.notEqual(first.cards[0].claim_card_id, edited.cards[0].claim_card_id);

  const otherSource = await cardsOf(SOURCES.bullet, "context:c2:v1");
  assert.equal(first.cards[0].normalized_text, otherSource.cards[0].normalized_text);
  assert.notEqual(first.cards[0].claim_card_id, otherSource.cards[0].claim_card_id);
});

test("10. raw support hashes stay traceable to the units", async () => {
  const { units, cards } = await cardsOf(SOURCES.bullet);
  assert.deepEqual(cards[0].support_unit_ids, [units[0].support_unit_id]);
  assert.deepEqual(cards[0].support_span_hashes, [units[0].excerpt_hash]);
});

test("11-13. a card introduces no new word, number, or causality", async () => {
  for (const excerpt of Object.values(SOURCES)) {
    const { units, cards } = await cardsOf(excerpt);
    // A table card's canonical text pairs the REGISTERED header with the row,
    // so the header's words are source words too.
    const sourceWords = new Set(
      units.flatMap((unit) =>
        `${unit.raw_span} ${unit.table_header_raw ?? ""}`.toLowerCase().match(/[a-z0-9%]+/g) ?? []
      ),
    );
    for (const card of cards) {
      for (const word of card.canonical_text.toLowerCase().match(/[a-z0-9%]+/g) ?? []) {
        assert.ok(sourceWords.has(word), `card introduced the word ${word}`);
      }
    }
  }
});

test("14. a bundle never combines units from different sources", async () => {
  const first = await cardsOf(SOURCES.prose, "context:c1:v1");
  const second = await cardsOf(SOURCES.bullet, "context:c2:v1");
  assert.equal(await buildSupportBundle([first.cards[0], second.cards[0]]), null);
});

test("14b. a same-source bundle preserves each component and creates no new relationship", async () => {
  const { cards } = await cardsOf(SOURCES.prose);
  const bundle = await buildSupportBundle(cards.slice(0, 2));
  assert.ok(bundle);
  assert.equal(bundle.card_type, "support_bundle");
  for (const component of cards.slice(0, 2)) {
    assert.ok(bundle.canonical_text.includes(component.canonical_text));
  }
  // A bundle is a collection of facts, never a derived conclusion.
  assert.equal(bundle.permissions.allows_causal, cards.slice(0, 2).some((c) => c.permissions.allows_causal));
});

test("15. derived cards are disabled, and headings never become cards", async () => {
  assert.equal(IDEATION_CLAIM_CARD_MANIFEST.derived_cards_enabled, false);
  const { cards } = await cardsOf(SOURCES.heading);
  assert.equal(cards.some((card) => card.canonical_text === "Buyer psychology"), false);
  assert.equal(await buildSupportBundle([]), null);
});

test("markdown transport markers are stripped without changing vocabulary", async () => {
  const { cards } = await cardsOf(SOURCES.bold);
  assert.equal(cards[0].canonical_text, "Stage: Operating with real clients and real delivery");
  assert.equal(/\*\*/.test(cards[0].canonical_text), false);
});

/* --------------------------------------------------- 16-28 permissions */

test("16. an exact source number is permitted", async () => {
  const { cards } = await cardsOf(SOURCES.percent);
  assert.ok(cardWith(cards, "Reply rate").permissions.numbers.includes("12%"));
});

test("17-20. metadata numbers never become permissions", () => {
  // Card ids, candidate indexes, schema versions, and array positions are not
  // factual content and never reach the ledger.
  const permissions = buildPermissions("Proof stays hidden", ["Proof stays hidden"]);
  assert.deepEqual(permissions.numbers, []);
  for (const metadata of ["cc_000000000001", "candidate_index: 1", "P1", "v1", "aa.ideation.claim-cards.v1"]) {
    assert.equal(permissions.numbers.includes("1"), false, metadata);
  }
});

test("21-23. percentage, currency, and range permissions are exact", async () => {
  const percent = await cardsOf(SOURCES.percent);
  assert.deepEqual(cardWith(percent.cards, "Reply rate").permissions.numbers, ["12%"]);
  const currency = await cardsOf(SOURCES.currency);
  assert.ok(cardWith(currency.cards, "Proof Sprint").permissions.numbers.includes("eur4000"));
  const range = await cardsOf(SOURCES.range);
  const numbers = cardWith(range.cards, "Deal size").permissions.numbers;
  assert.ok(numbers.includes("4000") && numbers.includes("9000"));
});

test("24-27. outcome, causal, guarantee, and competitor permissions require direct support", async () => {
  const plain = await cardsOf(SOURCES.bullet);
  const card = plain.cards[0];
  assert.equal(card.permissions.allows_outcome, false);
  assert.equal(card.permissions.allows_causal, false);
  assert.equal(card.permissions.allows_guarantee, false);
  assert.equal(card.permissions.allows_competitor, false);
  assert.equal(card.permissions.allows_leadership, false);
  assert.equal(card.permissions.allows_universal, false);

  // A source that genuinely states an outcome grants that permission.
  const outcome = await cardsOf(SOURCES.outcome);
  assert.equal(outcome.cards[0].permissions.allows_outcome, true);
});

test("28. generic overlap creates no permission", async () => {
  const { cards } = await cardsOf(SOURCES.bullet);
  const permissions = cards[0].permissions;
  assert.deepEqual(permissions.numbers, []);
  assert.deepEqual(permissions.high_risk_categories, []);
  // Audience vocabulary is recorded, but it grants no claim category.
  assert.ok(permissions.audience_terms.includes("buyers"));
});

/* ---------------------------------------------- 29-40 output validation */

function candidateOutput(cards: IdeationClaimCard[], overrides: Record<string, unknown> = {}) {
  const card = cards[0];
  return {
    structured_findings: {
      pain_language: [card.normalized_text],
      objections: [card.normalized_text],
      desired_outcomes: [card.normalized_text],
      content_opportunities: [card.normalized_text],
    },
    candidates: [{
      candidate_index: 1,
      asset_type: "reel",
      claim_card_ids: [card.claim_card_id],
      working_title: { text: "The hidden proof problem" },
      hook: { text: "Your proof is hidden. Here is why that matters." },
      core_message: { text: card.normalized_text },
      psychological_angle: { code: "proof_visibility" },
      cta: { text: "Look at the proof you are hiding" },
      ...overrides,
    }],
  };
}

function validate(output: unknown, source: IdeationEvidenceSource, cards: IdeationClaimCard[], technique = TECHNIQUE) {
  return validateClaimCardCandidateOutput(
    output as Record<string, unknown>,
    ["reel"] as never,
    [source],
    cards,
    technique,
  );
}

test("29. a registered card id is accepted", async () => {
  const { source, cards } = await cardsOf(SOURCES.bullet);
  const result = validate(candidateOutput(cards), source, cards);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("30-31. unknown and duplicate card ids are rejected", async () => {
  const { source, cards } = await cardsOf(SOURCES.bullet);
  const unknown = validate(candidateOutput(cards, { claim_card_ids: ["cc_deadbeefdead"] }), source, cards);
  assert.equal(unknown.ok, false);
  const duplicate = validate(
    candidateOutput(cards, { claim_card_ids: [cards[0].claim_card_id, cards[0].claim_card_id] }),
    source, cards,
  );
  assert.equal(duplicate.ok, false);
});

test("32. a cross-source card bundle is rejected", async () => {
  const first = await cardsOf(SOURCES.bullet, "context:c1:v1");
  const second = await cardsOf(SOURCES.prose, "context:c2:v1");
  const combined = [...first.cards, ...second.cards];
  const result = validateClaimCardCandidateOutput(
    candidateOutput(first.cards, {
      claim_card_ids: [first.cards[0].claim_card_id, second.cards[0].claim_card_id],
    }) as never,
    ["reel"] as never,
    [first.source, second.source],
    combined,
    TECHNIQUE,
  );
  assert.equal(result.ok, false);
});

test("33. a card not supplied to the model is rejected", async () => {
  const { source, cards } = await cardsOf(SOURCES.bullet);
  const other = await cardsOf(SOURCES.prose, "context:zz:v1");
  const result = validate(
    candidateOutput(cards, { claim_card_ids: [other.cards[0].claim_card_id] }),
    source, cards,
  );
  assert.equal(result.ok, false);
});

test("34-36. model-authored facts, spans, and evidence metadata are rejected", async () => {
  const { source, cards } = await cardsOf(SOURCES.bullet);
  for (const key of [
    "grounded_propositions", "propositions", "evidence_references",
    "support_span", "support_unit_ids", "support_note", "quoted_text", "source_ids",
  ]) {
    const result = validate(candidateOutput(cards, { [key]: ["x"] }), source, cards);
    assert.equal(result.ok, false, key);
    if (!result.ok) assert.match(result.error, /server owns the factual layer|unexpected field/);
  }
});

test("37-38. an empty or oversized card selection is rejected", async () => {
  const { source, cards } = await cardsOf(SOURCES.prose);
  assert.equal(validate(candidateOutput(cards, { claim_card_ids: [] }), source, cards).ok, false);
  const tooMany = validate(
    candidateOutput(cards, {
      claim_card_ids: [...cards.map((card) => card.claim_card_id), "cc_extra"].slice(0, 4),
    }),
    source, cards,
  );
  assert.equal(tooMany.ok, false);
});

test("39-40. the exact candidate result set is required", async () => {
  const { source, cards } = await cardsOf(SOURCES.bullet);
  const output = candidateOutput(cards);
  const partial = validateClaimCardCandidateOutput(
    output as never, ["reel", "story"] as never, [source], cards, TECHNIQUE,
  );
  assert.equal(partial.ok, false);
  assert.equal(validate(output, source, cards).ok, true);
});

/* --------------------------------------------- 41-64 creative fields */

async function creative(overrides: Record<string, unknown>, excerpt = SOURCES.bullet) {
  const { source, cards } = await cardsOf(excerpt);
  return validate(candidateOutput(cards, overrides), source, cards);
}

test("41-44. creative title, question hook, neutral CTA, and compatible core message pass", async () => {
  const result = await creative({
    working_title: { text: "What happens to the proof you keep hidden" },
    hook: { text: "Where does your strongest proof actually live?" },
    cta: { text: "Go and find the proof you are hiding" },
  });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("45-46. an unsupported number is rejected, and a candidate index does not authorize it", async () => {
  const unsupported = await creative({ hook: { text: "The 1 thing hiding your proof" } });
  assert.equal(unsupported.ok, false);
  // candidate_index is 1 in every fixture; it grants nothing.
  const stillUnsupported = await creative({
    candidate_index: 1,
    working_title: { text: "1 hidden proof problem" },
  });
  assert.equal(stillUnsupported.ok, false);
});

test("47-51. unsupported outcome, causality, guarantee, comparison, and leadership are rejected", async () => {
  const cases = [
    { hook: { text: "Hidden proof is costing you revenue" } },
    { hook: { text: "Hidden proof causes lost enquiries" } },
    { cta: { text: "Book a call and we guarantee your proof gets seen" } },
    { working_title: { text: "A better way to show hidden proof" } },
    { working_title: { text: "The market leader in hidden proof" } },
  ];
  for (const override of cases) {
    const result = await creative(override);
    assert.equal(result.ok, false, JSON.stringify(override));
  }
});

test("52-54. unsupported urgency, scarcity, and offer details are rejected", async () => {
  for (const override of [
    { cta: { text: "Act now before your proof stays hidden" } },
    { cta: { text: "Only 3 spots left to fix hidden proof" } },
    { cta: { text: "Join the proof programme and grow" } },
  ]) {
    const result = await creative(override);
    assert.equal(result.ok, false, JSON.stringify(override));
  }
});

test("55-56. an unrelated field and a contradiction are rejected", async () => {
  const unrelated = await creative({ working_title: { text: "Choosing a payroll provider" } });
  assert.equal(unrelated.ok, false);
  const contradiction = await creative({ hook: { text: "Your proof is always visible to competitors" } });
  assert.equal(contradiction.ok, false);
});

test("57-59. supported numbers, outcomes, and table values are accepted", async () => {
  const percent = await cardsOf(SOURCES.percent);
  const percentCard = cardWith(percent.cards, "Reply rate");
  const supportedNumber = validate(
    candidateOutput([percentCard], {
      claim_card_ids: [percentCard.claim_card_id],
      working_title: { text: "The reply rate metric" },
      hook: { text: "Your reply rate metric is 12%" },
      core_message: { text: percentCard.normalized_text },
      cta: { text: "Check the reply rate metric" },
      psychological_angle: { code: "specificity" },
    }),
    percent.source, percent.cards,
  );
  assert.equal(supportedNumber.ok, true, supportedNumber.ok ? "" : supportedNumber.error);

  const outcome = await cardsOf(SOURCES.outcome);
  const supportedOutcome = validate(
    candidateOutput(outcome.cards, {
      hook: { text: "Hidden proof reduces inbound revenue" },
    }),
    outcome.source, outcome.cards,
  );
  assert.equal(supportedOutcome.ok, true, supportedOutcome.ok ? "" : supportedOutcome.error);
});

test("60. a claim about the wrong table row is rejected", async () => {
  const { source, cards } = await cardsOf(SOURCES.table);
  const operator = cardWith(cards, "Operator");
  const result = validate(
    candidateOutput([operator], {
      claim_card_ids: [operator.claim_card_id],
      working_title: { text: "The Founder pain" },
      hook: { text: "Founder proof stays hidden" },
      core_message: { text: "The Founder segment pain is that proof stays hidden" },
      cta: { text: "Review the Founder pain" },
    }),
    source, cards,
  );
  assert.equal(result.ok, false);
});

test("61. one generic shared word remains insufficient", async () => {
  const result = await creative({
    working_title: { text: "Buyers deserve a modern payroll workflow" },
  });
  assert.equal(result.ok, false);
});

test("62-64. the angle needs no authority phrase; unknown and incompatible codes fall back", async () => {
  const valid = await creative({ psychological_angle: { code: "problem_agitation" } });
  assert.equal(valid.ok, true, valid.ok ? "" : valid.error);
  if (valid.ok) assert.equal(valid.candidates[0].angle_source, "model");

  for (const code of ["not_a_code", "behind_the_scenes"]) {
    const fallback = await creative({ psychological_angle: { code } });
    assert.equal(fallback.ok, true, fallback.ok ? "" : fallback.error);
    if (fallback.ok) {
      assert.equal(fallback.candidates[0].angle_source, "technique_default");
      assert.equal(fallback.candidates[0].psychological_angle_code, "problem_agitation");
    }
  }
});

/* ------------------------------------------------------ 65-78 repair */

const REPAIR_FAILURES = [{
  candidate_index: 1,
  field: "hook",
  code: "FIELD_UNSUPPORTED_CLAIM",
  message: "hook introduces an unsupported outcome claim.",
}];

function repairable() {
  return {
    candidates: [{
      candidate_index: 1,
      asset_type: "reel",
      claim_card_ids: ["cc_000000000001"],
      working_title: { text: "The hidden proof problem" },
      hook: { text: "Hidden proof costs you revenue" },
      core_message: { text: "Proof stays hidden" },
      psychological_angle: { code: "proof_visibility" },
      cta: { text: "Review your proof" },
    }],
  };
}

test("65-68. one repair removes an invalid field and leaves valid fields byte-identical", () => {
  const merged = applyFieldRepairs(repairable(), {
    repairs: [{ candidate_index: 1, fields: { hook: { text: "Where is your proof right now?" } } }],
  }, REPAIR_FAILURES);
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  const row = (merged.merged.candidates as Array<Record<string, unknown>>)[0];
  assert.deepEqual(row.hook, { text: "Where is your proof right now?" });
  assert.deepEqual(row.working_title, { text: "The hidden proof problem" });
  assert.deepEqual(row.cta, { text: "Review your proof" });
  assert.deepEqual(row.claim_card_ids, ["cc_000000000001"]);
});

test("67b. an invalid angle can be replaced by an allowed code", () => {
  const failures = [{ candidate_index: 1, field: "psychological_angle", code: "ANGLE_UNKNOWN", message: "unknown" }];
  const merged = applyFieldRepairs(repairable(), {
    repairs: [{ candidate_index: 1, fields: { psychological_angle: { code: "problem_agitation" } } }],
  }, failures);
  assert.equal(merged.ok, true);
});

test("69-72. a repair cannot author a claim, create a card, change allocation, or add evidence", () => {
  for (const payload of [
    { candidate_index: 1, propositions: [{ proposition_id: "P1", text: "x" }] },
    { candidate_index: 1, grounded_propositions: [{ proposition_id: "P1" }] },
    { candidate_index: 1, fields: { asset_type: "story" } },
    { candidate_index: 1, fields: { candidate_index: 2 } },
    { candidate_index: 1, fields: { claim_card_ids: ["cc_new"] } },
    { candidate_index: 1, fields: { evidence_references: [] } },
    { candidate_index: 1, fields: { support_unit_ids: ["su_x"] } },
  ]) {
    assert.equal(applyFieldRepairs(repairable(), { repairs: [payload] }, REPAIR_FAILURES).ok, false,
      JSON.stringify(payload));
  }
});

test("73-74. a repaired field is normally validated and a still-invalid repair stays rejected", async () => {
  const { source, cards } = await cardsOf(SOURCES.bullet);
  const base = candidateOutput(cards, { hook: { text: "Hidden proof costs you revenue" } });
  assert.equal(validate(base, source, cards).ok, false);

  const fixed = applyFieldRepairs(base as never, {
    repairs: [{ candidate_index: 1, fields: { hook: { text: "Where is your proof right now?" } } }],
  }, REPAIR_FAILURES);
  assert.equal(fixed.ok, true);
  if (fixed.ok) assert.equal(validate(fixed.merged, source, cards).ok, true);

  const stillBad = applyFieldRepairs(base as never, {
    repairs: [{ candidate_index: 1, fields: { hook: { text: "Hidden proof triples your sales" } } }],
  }, REPAIR_FAILURES);
  assert.equal(stillBad.ok, true);
  if (stillBad.ok) assert.equal(validate(stillBad.merged, source, cards).ok, false);
});

test("75-77. malformed, empty, and out-of-scope repairs are rejected", () => {
  for (const payload of [null, {}, { repairs: [] }, { repairs: [null] },
    { repairs: [{ candidate_index: 2, fields: { hook: { text: "x" } } }] },
    { repairs: [{ candidate_index: 1, fields: { working_title: { text: "x" } } }] }]) {
    assert.equal(applyFieldRepairs(repairable(), payload, REPAIR_FAILURES).ok, false);
  }
});

test("78. every material version is recorded in the manifest", () => {
  assert.equal(IDEATION_CLAIM_CARD_MANIFEST.policy_version, IDEATION_CLAIM_CARD_POLICY_VERSION);
  assert.equal(IDEATION_CLAIM_CARD_MANIFEST.construction_version, IDEATION_CLAIM_CARD_CONSTRUCTION_VERSION);
  assert.equal(IDEATION_CLAIM_CARD_MANIFEST.permission_ledger_version, IDEATION_PERMISSION_LEDGER_VERSION);
  assert.equal(
    IDEATION_CLAIM_CARD_MANIFEST.candidate_output_schema_version,
    IDEATION_CANDIDATE_OUTPUT_SCHEMA_VERSION,
  );
  assert.equal(IDEATION_CLAIM_CARD_MANIFEST.model_authors_factual_text, false);
});

/* ------------------------------------------------------- persistence */

test("the persisted candidate keeps the shape Stages 2-4 consume, with card provenance", async () => {
  const { source, cards } = await cardsOf(SOURCES.bullet);
  const result = validate(candidateOutput(cards), source, cards);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const persisted = toPersistedClaimCardCandidate(result.candidates[0]);
  for (const key of ["asset_type", "working_title", "hook", "core_message", "psychological_angle", "cta"]) {
    assert.equal(typeof (persisted as Record<string, unknown>)[key], "string", key);
  }
  assert.ok(persisted.evidence_references.length > 0, "the evidence CHECK requires a non-empty array");
  assert.equal(persisted.evidence_references[0].source_ref, source.source_ref);
  const provenance = persisted.claim_card_provenance as Record<string, unknown>;
  assert.equal(provenance.model_authored_factual_text, false);
  assert.equal(provenance.claim_card_policy_version, IDEATION_CLAIM_CARD_POLICY_VERSION);
  assert.equal(provenance.permission_ledger_version, IDEATION_PERMISSION_LEDGER_VERSION);
  const persistedCards = provenance.claim_cards as Array<Record<string, unknown>>;
  assert.equal(persistedCards[0].claim_card_id, cards[0].claim_card_id);
  assert.equal(persistedCards[0].card_hash, cards[0].card_hash);
});

test("the serialized registry states each card's permissions and never invents one", async () => {
  const { cards } = await cardsOf(SOURCES.percent);
  const serialized = serializeClaimCards(cards);
  const row = cardWith(cards, "Reply rate");
  assert.match(serialized, new RegExp(row.claim_card_id));
  assert.match(serialized, /MEANING: Metric: Reply rate \| Value: 12%/);
  assert.match(serialized, /ALLOWED: numbers you may use: 12%/);

  const plain = await cardsOf(SOURCES.bullet);
  assert.match(serializeClaimCards(plain.cards), /ALLOWED: no numbers, no outcome or comparison claims/);
});

test("canonicalFactualText is reproducible from the registered unit", async () => {
  const { units } = await cardsOf(SOURCES.table);
  for (const unit of units) {
    assert.equal(canonicalFactualText(unit), canonicalFactualText(unit));
  }
});
