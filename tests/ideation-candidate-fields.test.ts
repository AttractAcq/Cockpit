// Ideation candidate-field policy v2 — claim-first contract.
//
// Facts are grounded once, in the proposition registry, under the unchanged
// evidence-policy-v2 rules. Creative fields frame those propositions and are
// checked for what they must NOT introduce. The strategic angle is a code-owned
// taxonomy value. No provider call and no database is involved.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createEvidenceSource } from "../supabase/functions/_shared/ideation/evidence.ts";
import type { IdeationEvidenceSource } from "../supabase/functions/_shared/ideation/evidence.ts";
import {
  buildSupportUnits,
  type IdeationSupportUnit,
} from "../supabase/functions/_shared/ideation/support-units.ts";
import {
  toPersistedIdeationCandidate,
  validateClaimFirstCandidateOutput,
} from "../supabase/functions/_shared/ideation/output.ts";
import {
  applyFieldRepairs,
  buildFieldRepairPrompt,
} from "../supabase/functions/_shared/ideation/model.ts";
import {
  defaultAngleForTechnique,
  detectHighRiskCategories,
  ideationAngleDefinition,
  ideationAnglesForTechnique,
  IDEATION_ANGLE_TAXONOMY,
  IDEATION_ANGLE_TAXONOMY_VERSION,
  IDEATION_CANDIDATE_FIELD_MANIFEST,
  IDEATION_CANDIDATE_FIELD_POLICY_VERSION,
  IDEATION_FIELD_SEMANTICS,
} from "../supabase/functions/_shared/ideation/candidate-fields.ts";

const TECHNIQUE = "review-mined-pain-language";

const SOURCES = {
  bullet: "- Buyers feel invisible when their strongest proof stays hidden",
  table: ["| Segment | Pain |", "| --- | --- |", "| Founder | Proof stays hidden |"].join("\n"),
  keyValue: "Primary pain: buyers feel invisible when their proof stays hidden",
  prose: "Buyers feel invisible when their strongest proof stays hidden. They want visible authority.",
  numeric: ["| Metric | Value |", "| --- | --- |", "| Reply rate | 12% |"].join("\n"),
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

function unitWith(units: IdeationSupportUnit[], fragment: string): IdeationSupportUnit {
  const unit = units.find((candidate) => candidate.raw_span.includes(fragment));
  assert.ok(unit, `no unit contains ${fragment}`);
  return unit;
}

interface BuildInput {
  source: IdeationEvidenceSource;
  unit: IdeationSupportUnit;
  propositionText: string;
  fields?: Partial<Record<string, unknown>>;
  propositionOverrides?: Record<string, unknown>;
  extraPropositions?: Array<Record<string, unknown>>;
}

function candidate(input: BuildInput) {
  const proposition = {
    proposition_id: "P1",
    text: input.propositionText,
    evidence_mode: "paraphrase",
    support_unit_ids: [input.unit.support_unit_id],
    source_ids: [input.source.source_id],
    source_ref: input.source.source_ref,
    source_url: input.source.source_url,
    support_note: "The unit states this.",
    ...input.propositionOverrides,
  };
  return {
    structured_findings: {
      pain_language: [input.unit.raw_span],
      objections: [input.unit.raw_span],
      desired_outcomes: [input.unit.raw_span],
      content_opportunities: [input.unit.raw_span],
    },
    candidates: [{
      candidate_index: 1,
      asset_type: "reel",
      grounded_propositions: [proposition, ...(input.extraPropositions ?? [])],
      working_title: { text: "The hidden proof problem", proposition_ids: ["P1"] },
      hook: { text: "Your proof is hidden. Here is why that matters.", proposition_ids: ["P1"] },
      core_message: { text: input.propositionText, proposition_ids: ["P1"] },
      psychological_angle: { code: "proof_visibility", proposition_ids: ["P1"] },
      cta: { text: "Look at the proof you are hiding", proposition_ids: ["P1"] },
      ...input.fields,
    }],
  };
}

function validate(output: unknown, source: IdeationEvidenceSource, units: IdeationSupportUnit[], technique = TECHNIQUE) {
  return validateClaimFirstCandidateOutput(
    output as Record<string, unknown>,
    ["reel"] as never,
    [source],
    units,
    technique,
  );
}

async function setup(excerpt: string, fragment: string) {
  const source = await sourceOf(excerpt);
  const units = await buildSupportUnits(source);
  return { source, units, unit: unitWith(units, fragment) };
}

/* ------------------------------------------------- 1-12 propositions */

test("1. a supported bullet proposition is accepted", async () => {
  const { source, units, unit } = await setup(SOURCES.bullet, "Buyers feel invisible");
  const result = validate(
    candidate({ source, unit, propositionText: "Buyers feel invisible when their strongest proof stays hidden" }),
    source, units,
  );
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("2. a supported table proposition is accepted", async () => {
  const { source, units, unit } = await setup(SOURCES.table, "Founder");
  const result = validate(
    candidate({ source, unit, propositionText: "The Founder segment pain is that proof stays hidden" }),
    source, units,
  );
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("3. a supported key-value proposition is accepted", async () => {
  const { source, units, unit } = await setup(SOURCES.keyValue, "Primary pain");
  const result = validate(
    candidate({ source, unit, propositionText: "The primary pain is that buyers feel invisible when proof stays hidden" }),
    source, units,
  );
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("4. a supported prose proposition is accepted", async () => {
  const { source, units, unit } = await setup(SOURCES.prose, "Buyers feel invisible");
  const result = validate(
    candidate({ source, unit, propositionText: "Buyers feel invisible when their strongest proof stays hidden" }),
    source, units,
  );
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("5. an unsupported proposition is rejected", async () => {
  const { source, units, unit } = await setup(SOURCES.bullet, "Buyers feel invisible");
  const result = validate(
    candidate({ source, unit, propositionText: "Retainer pricing suits every agency budget" }),
    source, units,
  );
  assert.equal(result.ok, false);
});

test("6. an unsupported outcome proposition is rejected", async () => {
  const { source, units, unit } = await setup(SOURCES.bullet, "Buyers feel invisible");
  const result = validate(
    candidate({ source, unit, propositionText: "Hidden proof doubles revenue for buyers" }),
    source, units,
  );
  assert.equal(result.ok, false);
});

test("7. an unsupported number in a proposition is rejected", async () => {
  const { source, units, unit } = await setup(SOURCES.numeric, "12%");
  const result = validate(
    candidate({ source, unit, propositionText: "The reply rate metric is 40%" }),
    source, units,
  );
  assert.equal(result.ok, false);
});

test("8. unsupported causality in a proposition is rejected", async () => {
  const { source, units, unit } = await setup(SOURCES.bullet, "Buyers feel invisible");
  const result = validate(
    candidate({ source, unit, propositionText: "Hidden proof causes lost sales for buyers" }),
    source, units,
  );
  assert.equal(result.ok, false);
});

test("9. an altered exact quote is rejected", async () => {
  const { source, units, unit } = await setup(SOURCES.bullet, "Buyers feel invisible");
  const result = validate(
    candidate({
      source, unit,
      propositionText: "Buyers feel invisible when their strongest proof stays hidden",
      propositionOverrides: {
        evidence_mode: "exact_quote",
        quoted_text: "Buyers always feel invisible when their strongest proof stays hidden",
        support_note: undefined,
      },
    }),
    source, units,
  );
  assert.equal(result.ok, false);
});

test("10. a cross-source support unit is rejected", async () => {
  const { source, units } = await setup(SOURCES.bullet, "Buyers feel invisible");
  const other = await sourceOf(SOURCES.prose, "context:zz:v1");
  const otherUnits = await buildSupportUnits(other);
  const result = validate(
    candidate({
      source, unit: units[0],
      propositionText: "Buyers feel invisible when their strongest proof stays hidden",
      propositionOverrides: { support_unit_ids: [otherUnits[0].support_unit_id] },
    }),
    source, units,
  );
  assert.equal(result.ok, false);
});

test("11. a field citing another candidate's proposition id is rejected", async () => {
  const { source, units, unit } = await setup(SOURCES.bullet, "Buyers feel invisible");
  const result = validate(
    candidate({
      source, unit,
      propositionText: "Buyers feel invisible when their strongest proof stays hidden",
      fields: { hook: { text: "Your proof is hidden", proposition_ids: ["P9"] } },
    }),
    source, units,
  );
  assert.equal(result.ok, false);
});

test("12. an unknown proposition id is rejected, and duplicates fail", async () => {
  const { source, units, unit } = await setup(SOURCES.bullet, "Buyers feel invisible");
  const unknown = validate(
    candidate({
      source, unit,
      propositionText: "Buyers feel invisible when their strongest proof stays hidden",
      fields: { cta: { text: "Look at the proof", proposition_ids: ["nope"] } },
    }),
    source, units,
  );
  assert.equal(unknown.ok, false);

  const duplicate = validate(
    candidate({
      source, unit,
      propositionText: "Buyers feel invisible when their strongest proof stays hidden",
      extraPropositions: [{
        proposition_id: "P1",
        text: "Buyers feel invisible when their strongest proof stays hidden",
        evidence_mode: "paraphrase",
        support_unit_ids: [unit.support_unit_id],
        source_ids: [source.source_id],
        source_ref: source.source_ref,
        source_url: source.source_url,
        support_note: "The unit states this.",
      }],
    }),
    source, units,
  );
  assert.equal(duplicate.ok, false);
});

/* ------------------------------------------- 13-24 creative framing */

async function creativeCase(fields: Record<string, unknown>) {
  const { source, units, unit } = await setup(SOURCES.bullet, "Buyers feel invisible");
  return validate(
    candidate({
      source, unit,
      propositionText: "Buyers feel invisible when their strongest proof stays hidden",
      fields,
    }),
    source, units,
  );
}

test("13. a creative title using ordinary connective language is accepted", async () => {
  const result = await creativeCase({
    working_title: { text: "What happens to the proof you keep hidden", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("14. a creative question hook is accepted when it adds no fact", async () => {
  const result = await creativeCase({
    hook: { text: "Where does your strongest proof actually live?", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("15. an imperative CTA is accepted when it adds no promise", async () => {
  const result = await creativeCase({
    cta: { text: "Go and find the proof you are hiding", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("16. a creative contrast is accepted where both sides are grounded", async () => {
  const result = await creativeCase({
    hook: { text: "Invisible proof, or proof people can see?", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("17. an unsupported result in a hook is rejected", async () => {
  const result = await creativeCase({
    hook: { text: "Hidden proof is costing you revenue every month", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, false);
});

test("18. an unsupported number in a title is rejected", async () => {
  const result = await creativeCase({
    working_title: { text: "The 3 proof mistakes keeping you hidden", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, false);
});

test("19. an unsupported guarantee in a CTA is rejected", async () => {
  const result = await creativeCase({
    cta: { text: "Book a call and we guarantee your proof gets seen", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, false);
});

test("20. an unsupported audience fact is rejected", async () => {
  const result = await creativeCase({
    hook: { text: "Every agency owner hides their best proof", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, false);
});

test("21. a field unrelated to its cited proposition is rejected", async () => {
  const result = await creativeCase({
    working_title: { text: "Choosing a payroll provider", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, false);
});

test("22. one generic shared word remains insufficient", async () => {
  // "buyers" is weak/generic vocabulary and is dropped before alignment, so it
  // cannot on its own make a field count as being about the proposition.
  const result = await creativeCase({
    working_title: { text: "Buyers deserve a modern payroll workflow", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, false);
});

test("23. contradictory framing is rejected", async () => {
  const result = await creativeCase({
    hook: { text: "Your proof is always visible to competitors", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, false);
});

test("24. a valid proposition does not license an unrelated claim", async () => {
  const result = await creativeCase({
    cta: { text: "Start the fastest proof programme in the market", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, false);
});

/* ------------------------------------------------ 25-30 core message */

test("25-26. a direct supported core message is accepted and may combine propositions", async () => {
  const { source, units, unit } = await setup(SOURCES.prose, "Buyers feel invisible");
  const second = unitWith(units, "They want visible authority");
  const result = validate(
    candidate({
      source, unit,
      propositionText: "Buyers feel invisible when their strongest proof stays hidden",
      extraPropositions: [{
        proposition_id: "P2",
        text: "They want visible authority",
        evidence_mode: "paraphrase",
        support_unit_ids: [second.support_unit_id],
        source_ids: [source.source_id],
        source_ref: source.source_ref,
        source_url: source.source_url,
        support_note: "The unit states this.",
      }],
      fields: {
        core_message: {
          text: "Buyers feel invisible when their strongest proof stays hidden",
          proposition_ids: ["P1", "P2"],
        },
      },
    }),
    source, units,
  );
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("27-29. an unsupported conclusion or causal link in core_message is rejected", async () => {
  const unsupported = await creativeCase({
    core_message: { text: "Hidden proof therefore reduces qualified leads", proposition_ids: ["P1"] },
  });
  assert.equal(unsupported.ok, false);

  const causal = await creativeCase({
    core_message: { text: "Hidden proof drives lower conversion", proposition_ids: ["P1"] },
  });
  assert.equal(causal.ok, false);
});

test("30. a numerical core message requires exact support", async () => {
  const { source, units, unit } = await setup(SOURCES.numeric, "12%");
  const numericFields = (coreMessage: string) => ({
    working_title: { text: "What the reply rate metric shows", proposition_ids: ["P1"] },
    hook: { text: "Look at your reply rate metric", proposition_ids: ["P1"] },
    core_message: { text: coreMessage, proposition_ids: ["P1"] },
    psychological_angle: { code: "specificity", proposition_ids: ["P1"] },
    cta: { text: "Check the reply rate metric today", proposition_ids: ["P1"] },
  });
  const supported = validate(
    candidate({ source, unit, propositionText: "The reply rate metric is 12%", fields: numericFields("The reply rate metric is 12%") }),
    source, units,
  );
  assert.equal(supported.ok, true, supported.ok ? "" : supported.error);

  const unsupported = validate(
    candidate({ source, unit, propositionText: "The reply rate metric is 12%", fields: numericFields("The reply rate metric is 30%") }),
    source, units,
  );
  assert.equal(unsupported.ok, false);
});

/* ------------------------------------------ 31-40 psychological angle */

test("31. every allowed taxonomy code is accepted for a compatible technique", async () => {
  for (const angle of ideationAnglesForTechnique(TECHNIQUE)) {
    const result = await creativeCase({
      psychological_angle: { code: angle.code, proposition_ids: ["P1"] },
    });
    assert.equal(result.ok, true, `${angle.code}: ${result.ok ? "" : result.error}`);
  }
});

test("32-33. an unknown code or free text falls back to the technique default", async () => {
  for (const code of ["not_a_real_angle", "Buyers feel invisible and want proof"]) {
    const result = await creativeCase({ psychological_angle: { code, proposition_ids: ["P1"] } });
    assert.equal(result.ok, true, result.ok ? "" : result.error);
    if (result.ok) {
      // The model's text is discarded; the server owns the label.
      assert.equal(result.candidates[0].psychological_angle_code, defaultAngleForTechnique(TECHNIQUE)!.code);
      assert.equal(result.candidates[0].angle_source, "technique_default");
      assert.notEqual(result.candidates[0].psychological_angle, code);
    }
  }
});

test("34-35. a technique-incompatible code falls back, a compatible one is kept", async () => {
  const incompatible = await creativeCase({
    psychological_angle: { code: "behind_the_scenes", proposition_ids: ["P1"] },
  });
  assert.equal(incompatible.ok, true, incompatible.ok ? "" : incompatible.error);
  if (incompatible.ok) {
    assert.equal(incompatible.candidates[0].angle_source, "technique_default");
  }
  const compatible = await creativeCase({
    psychological_angle: { code: "problem_agitation", proposition_ids: ["P1"] },
  });
  assert.equal(compatible.ok, true);
  if (compatible.ok) {
    assert.equal(compatible.candidates[0].psychological_angle_code, "problem_agitation");
    assert.equal(compatible.candidates[0].angle_source, "model");
  }
});

test("36-37. the persisted label is server-owned and the taxonomy version is recorded", async () => {
  const result = await creativeCase({
    psychological_angle: { code: "proof_visibility", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.candidates[0].psychological_angle, ideationAngleDefinition("proof_visibility")!.label);
    const persisted = toPersistedIdeationCandidate(result.candidates[0]);
    assert.equal(persisted.psychological_angle, "Proof visibility");
    assert.equal(
      persisted.candidate_field_provenance.angle_taxonomy_version,
      IDEATION_ANGLE_TAXONOMY_VERSION,
    );
    assert.equal(persisted.candidate_field_provenance.psychological_angle_code, "proof_visibility");
  }
});

test("38. a classification does not need literal authority vocabulary", () => {
  // No taxonomy label is expected to appear in any client file.
  for (const angle of IDEATION_ANGLE_TAXONOMY) {
    assert.equal(typeof angle.definition, "string");
    assert.ok(angle.definition.length > 10);
  }
  assert.equal(IDEATION_FIELD_SEMANTICS.psychological_angle, "strategic_classification");
});

test("39. a classification cannot smuggle a factual claim", async () => {
  // The field carries a code only; there is nowhere to put prose.
  const result = await creativeCase({
    psychological_angle: {
      code: "proof_visibility",
      text: "Buyers double revenue when proof is visible",
      proposition_ids: ["P1"],
    },
  });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  if (result.ok) {
    assert.equal(result.candidates[0].psychological_angle, "Proof visibility");
    assert.equal(/revenue/i.test(result.candidates[0].psychological_angle), false);
  }
});

test("40. the deterministic default exists for every technique and asserts no fact", () => {
  for (const slug of ["persona", "review-mined-pain-language", "competitor-objections",
    "end-customer-complaints", "live-objection-log", "trigger-event", "format-swipe"]) {
    const fallback = defaultAngleForTechnique(slug);
    assert.ok(fallback, `${slug} has no default angle`);
    assert.ok((fallback.techniques as readonly string[]).includes(slug));
    assert.deepEqual(detectHighRiskCategories(fallback.label), []);
  }
  assert.equal(defaultAngleForTechnique("not-a-technique"), null);
});

/* --------------------------------------------------------- 41-46 CTA */

test("41. a neutral action CTA is accepted", async () => {
  const result = await creativeCase({ cta: { text: "Review where your proof sits today", proposition_ids: ["P1"] } });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("42-43. unsupported urgency and scarcity are rejected", async () => {
  const urgency = await creativeCase({
    cta: { text: "Act now before your proof stays hidden forever", proposition_ids: ["P1"] },
  });
  assert.equal(urgency.ok, false);
  const scarcity = await creativeCase({
    cta: { text: "Only 3 spots left to fix your hidden proof", proposition_ids: ["P1"] },
  });
  assert.equal(scarcity.ok, false);
});

test("44-45. an unsupported offer claim is rejected and a supported one accepted", async () => {
  const unsupported = await creativeCase({
    cta: { text: "Join the proof programme and grow revenue", proposition_ids: ["P1"] },
  });
  assert.equal(unsupported.ok, false);
  const supported = await creativeCase({
    cta: { text: "Start by listing the proof you keep hidden", proposition_ids: ["P1"] },
  });
  assert.equal(supported.ok, true, supported.ok ? "" : supported.error);
});

test("46. an unsupported result promise is rejected", async () => {
  const result = await creativeCase({
    cta: { text: "Show your proof and double your enquiries", proposition_ids: ["P1"] },
  });
  assert.equal(result.ok, false);
});

/* ---------------------------------------------------- policy manifest */

test("the field policy is code-owned, versioned, and semantically classified", () => {
  assert.equal(IDEATION_CANDIDATE_FIELD_MANIFEST.policy_version, IDEATION_CANDIDATE_FIELD_POLICY_VERSION);
  assert.equal(IDEATION_FIELD_SEMANTICS.core_message, "grounded_proposition");
  assert.equal(IDEATION_FIELD_SEMANTICS.working_title, "creative_framing");
  assert.equal(IDEATION_FIELD_SEMANTICS.hook, "creative_framing");
  assert.equal(IDEATION_FIELD_SEMANTICS.cta, "creative_framing");
  assert.equal(IDEATION_CANDIDATE_FIELD_MANIFEST.maximum_field_repairs_per_response, 1);
  assert.equal(IDEATION_CANDIDATE_FIELD_MANIFEST.server_owns_angle_label, true);
});

test("the persisted candidate keeps exactly the shape Stages 2-4 consume", async () => {
  const { source, units, unit } = await setup(SOURCES.bullet, "Buyers feel invisible");
  const result = validate(
    candidate({ source, unit, propositionText: "Buyers feel invisible when their strongest proof stays hidden" }),
    source, units,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const persisted = toPersistedIdeationCandidate(result.candidates[0]);
  for (const key of ["asset_type", "working_title", "hook", "core_message", "psychological_angle", "cta"]) {
    assert.equal(typeof (persisted as Record<string, unknown>)[key], "string", key);
  }
  assert.ok(Array.isArray(persisted.evidence_references));
  assert.ok(persisted.evidence_references.length > 0, "the evidence CHECK requires a non-empty array");
  const reference = persisted.evidence_references[0];
  assert.equal(reference.source_ref, source.source_ref);
  assert.equal(reference.source_url, source.source_url);
  assert.ok(reference.support_span, "server-derived provenance is preserved");
  assert.deepEqual(reference.support_unit_ids, [unit.support_unit_id]);
});

/* ------------------------------------------------- 47-64 field repair */

const REPAIR_FAILURES = [{
  candidate_index: 1,
  field: "hook",
  code: "FIELD_UNSUPPORTED_CLAIM",
  message: "hook introduces an unsupported outcome claim.",
}];

function originalResponse() {
  return {
    candidates: [{
      candidate_index: 1,
      asset_type: "reel",
      grounded_propositions: [{ proposition_id: "P1", text: "Proof stays hidden" }],
      working_title: { text: "The hidden proof problem", proposition_ids: ["P1"] },
      hook: { text: "Hidden proof costs you revenue", proposition_ids: ["P1"] },
      core_message: { text: "Proof stays hidden", proposition_ids: ["P1"] },
      psychological_angle: { code: "proof_visibility", proposition_ids: ["P1"] },
      cta: { text: "Review your proof", proposition_ids: ["P1"] },
    }],
  };
}

test("47-48. one invalid field is repaired and valid fields are preserved byte-for-byte", () => {
  const original = originalResponse();
  const merged = applyFieldRepairs(original, {
    repairs: [{ candidate_index: 1, fields: { hook: { text: "Where is your proof right now?", proposition_ids: ["P1"] } } }],
  }, REPAIR_FAILURES);
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  const candidateRow = (merged.merged.candidates as Array<Record<string, unknown>>)[0];
  assert.deepEqual(candidateRow.hook, { text: "Where is your proof right now?", proposition_ids: ["P1"] });
  assert.deepEqual(candidateRow.working_title, { text: "The hidden proof problem", proposition_ids: ["P1"] });
  assert.deepEqual(candidateRow.cta, { text: "Review your proof", proposition_ids: ["P1"] });
  assert.deepEqual(candidateRow.core_message, { text: "Proof stays hidden", proposition_ids: ["P1"] });
});

test("49. multiple invalid fields are repaired in one bounded call", () => {
  const failures = [
    ...REPAIR_FAILURES,
    { candidate_index: 1, field: "cta", code: "FIELD_UNSUPPORTED_CLAIM", message: "cta promises a result." },
  ];
  const merged = applyFieldRepairs(originalResponse(), {
    repairs: [{
      candidate_index: 1,
      fields: {
        hook: { text: "Where is your proof?", proposition_ids: ["P1"] },
        cta: { text: "List the proof you hide", proposition_ids: ["P1"] },
      },
    }],
  }, failures);
  assert.equal(merged.ok, true);
});

test("50. an unknown repair field is rejected", () => {
  const merged = applyFieldRepairs(originalResponse(), {
    repairs: [{ candidate_index: 1, fields: { notes: { text: "x" } } }],
  }, REPAIR_FAILURES);
  assert.equal(merged.ok, false);
});

test("51-53. a repair cannot change asset type, candidate index, or technique", () => {
  for (const field of ["asset_type", "candidate_index", "technique_slug"]) {
    const merged = applyFieldRepairs(originalResponse(), {
      repairs: [{ candidate_index: 1, fields: { [field]: "story" } }],
    }, REPAIR_FAILURES);
    assert.equal(merged.ok, false, field);
  }
  const wrongCandidate = applyFieldRepairs(originalResponse(), {
    repairs: [{ candidate_index: 2, fields: { hook: { text: "x", proposition_ids: ["P1"] } } }],
  }, REPAIR_FAILURES);
  assert.equal(wrongCandidate.ok, false);
});

test("54-55. a repair cannot introduce support units or silently alter propositions", () => {
  const merged = applyFieldRepairs(originalResponse(), {
    repairs: [{ candidate_index: 1, fields: { grounded_propositions: [{ proposition_id: "P9" }] } }],
  }, REPAIR_FAILURES);
  assert.equal(merged.ok, false);
});

test("56. a repaired field must still pass the normal validator", async () => {
  const { source, units, unit } = await setup(SOURCES.bullet, "Buyers feel invisible");
  const base = candidate({
    source, unit,
    propositionText: "Buyers feel invisible when their strongest proof stays hidden",
    fields: { hook: { text: "Hidden proof costs you revenue", proposition_ids: ["P1"] } },
  });
  assert.equal(validate(base, source, units).ok, false, "the unrepaired field is invalid");

  const merged = applyFieldRepairs(base as unknown as Record<string, unknown>, {
    repairs: [{ candidate_index: 1, fields: { hook: { text: "Where is your proof right now?", proposition_ids: ["P1"] } } }],
  }, REPAIR_FAILURES);
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.equal(validate(merged.merged, source, units).ok, true, "the repaired field validates normally");

  // A repair that still breaks the rule is still rejected.
  const stillBad = applyFieldRepairs(base as unknown as Record<string, unknown>, {
    repairs: [{ candidate_index: 1, fields: { hook: { text: "Hidden proof triples your sales", proposition_ids: ["P1"] } } }],
  }, REPAIR_FAILURES);
  assert.equal(stillBad.ok, true, "the merge itself succeeds");
  if (stillBad.ok) assert.equal(validate(stillBad.merged, source, units).ok, false);
});

test("57. a malformed or empty repair response is rejected", () => {
  for (const payload of [null, {}, { repairs: [] }, { repairs: "no" }, { repairs: [null] }]) {
    assert.equal(applyFieldRepairs(originalResponse(), payload, REPAIR_FAILURES).ok, false);
  }
});

test("61-62. the repair prompt carries no unrelated authority and no excerpt bodies", () => {
  const prompts = buildFieldRepairPrompt({
    techniqueSlug: TECHNIQUE,
    failures: REPAIR_FAILURES,
    candidates: [{
      candidate_index: 1,
      asset_type: "reel",
      propositions: [{ proposition_id: "P1", text: "Proof stays hidden" }],
      fields: { hook: "Hidden proof costs you revenue" },
    }],
  });
  // Only the failing field, its reason, and the validated propositions appear.
  assert.match(prompts.user, /hook/);
  assert.match(prompts.user, /Proof stays hidden/);
  assert.equal(/APPROVED BUSINESS CONTEXT|SUPPORT UNITS|bounded_excerpt/.test(prompts.user), false);
  // A valid field's current text is never resent for rewriting.
  assert.equal(/The hidden proof problem/.test(prompts.user), false);
  assert.equal(/Review your proof/.test(prompts.user), false);
  assert.match(prompts.user, /ALLOWED psychological_angle CODES/);
});

test("a rejected proposition may be restated, but only its text and only if it failed", () => {
  const failures = [{
    candidate_index: 1,
    field: "grounded_propositions.P1",
    code: "PROPOSITION_UNSUPPORTED",
    message: "High-risk or outcome claim lacks direct support.",
  }];
  const merged = applyFieldRepairs(originalResponse(), {
    repairs: [{ candidate_index: 1, propositions: [{ proposition_id: "P1", text: "Proof stays hidden" }] }],
  }, failures);
  assert.equal(merged.ok, true);
  if (merged.ok) {
    const row = (merged.merged.candidates as Array<Record<string, unknown>>)[0];
    const propositions = row.grounded_propositions as Array<Record<string, unknown>>;
    assert.equal(propositions[0].text, "Proof stays hidden");
  }

  // A proposition that did not fail cannot be rewritten.
  const untouched = applyFieldRepairs(originalResponse(), {
    repairs: [{ candidate_index: 1, propositions: [{ proposition_id: "P1", text: "x" }] }],
  }, REPAIR_FAILURES);
  assert.equal(untouched.ok, false);

  // A repair may never reach for new evidence.
  for (const key of ["support_unit_ids", "source_ids", "evidence_mode"]) {
    const reaching = applyFieldRepairs(originalResponse(), {
      repairs: [{ candidate_index: 1, propositions: [{ proposition_id: "P1", text: "y", [key]: ["z"] }] }],
    }, failures);
    assert.equal(reaching.ok, false, key);
  }
});

test("63. the repair policy participates in the configuration manifest", () => {
  assert.equal(
    IDEATION_CANDIDATE_FIELD_MANIFEST.field_repair_policy_version,
    "aa.ideation.field-repair.v1",
  );
});
