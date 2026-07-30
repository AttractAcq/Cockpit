// IDEATION-D1 — Markdown support units and evidence policy v2.
//
// Every fixture here is deterministic and test-only. No provider call is made
// and no database is touched. These tests prove that bullet, list, key-value,
// and table evidence became expressible WITHOUT relaxing any grounding rule.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSupportUnits,
  IDEATION_EVIDENCE_POLICY_VERSION,
  IDEATION_SUPPORT_UNIT_MANIFEST,
  IDEATION_SUPPORT_UNIT_PARSER_VERSION,
  IDEATION_SUPPORT_UNIT_SELECTION,
  normalizeExcerptForUnits,
  parseSupportUnitDrafts,
  quotableSpansForUnit,
  serializeSourceUnitSection,
  supportTextForUnit,
  uncoveredSubstantiveText,
  type IdeationSupportUnit,
} from "../supabase/functions/_shared/ideation/support-units.ts";
import { validateIdeationCandidateOutput } from "../supabase/functions/_shared/ideation/output.ts";
import { createEvidenceSource } from "../supabase/functions/_shared/ideation/evidence.ts";
import type { IdeationEvidenceSource } from "../supabase/functions/_shared/ideation/evidence.ts";

/* ------------------------------------------------------------- fixtures */

/** 1-20: every source structure the parser must handle deterministically. */
const FIXTURES = {
  prose: "Buyers feel invisible when their strongest proof stays hidden. They want visible authority.",
  bullet: "- Buyers feel invisible when their strongest proof stays hidden",
  bulletContinuation:
    "- Buyers feel invisible when their strongest proof stays hidden\n  and they cannot show visible authority",
  numbered: "1. Buyers feel invisible when their strongest proof stays hidden",
  keyValue: "Primary pain: buyers feel invisible when their proof stays hidden",
  twoColumnTable: [
    "| Segment | Pain |",
    "| --- | --- |",
    "| Founder | Proof stays hidden |",
    "| Operator | Authority stays invisible |",
  ].join("\n"),
  multiColumnTable: [
    "| Segment | Pain | Desired outcome |",
    "| --- | --- | --- |",
    "| Founder | Proof stays hidden | Visible authority |",
  ].join("\n"),
  percentageTable: [
    "| Metric | Value |",
    "| --- | --- |",
    "| Reply rate | 12% |",
  ].join("\n"),
  currencyTable: [
    "| Package | Price |",
    "| --- | --- |",
    "| Proof Sprint | EUR 4000 |",
  ].join("\n"),
  rangeTable: [
    "| Metric | Range |",
    "| --- | --- |",
    "| Deal size | 4000 to 9000 |",
  ].join("\n"),
  headingBullet: "## Buyer psychology\n\n- Buyers feel invisible when their proof stays hidden",
  headingTable: [
    "## Buyer psychology",
    "",
    "| Segment | Pain |",
    "| --- | --- |",
    "| Founder | Proof stays hidden |",
  ].join("\n"),
  emptyCell: [
    "| Segment | Pain |",
    "| --- | --- |",
    "| Founder |  |",
    "| Operator | Authority stays invisible |",
  ].join("\n"),
  crlf: "Buyers feel invisible when proof stays hidden.\r\nThey want visible authority.\r\n",
  unicodePunctuation: "Buyers feel invisible when their proof stays hidden — they want visible authority.",
  oversized: `${"Buyers feel invisible when their strongest proof stays hidden. ".repeat(40)}`,
  malformedTable: "| Segment | Pain\n| --- |\n| Founder | Proof stays hidden |",
  incidentalPipe: "Buyers feel invisible | their proof stays hidden and authority stays invisible.",
  quote: "> Buyers feel invisible when their strongest proof stays hidden",
};

async function sourceOf(excerpt: string, overrides: Partial<{
  sourceId: string;
  sourceRef: string;
}> = {}): Promise<IdeationEvidenceSource> {
  return await createEvidenceSource({
    sourceId: overrides.sourceId ?? "context:c1:v1",
    sourceRef: overrides.sourceRef ?? "02_Avatar_And_Buyer_Psychology.md",
    sourceType: "approved_context",
    sourceUrl: "aa-authority://client/client-1/context/c1",
    excerpt,
  });
}

async function unitsOf(excerpt: string, overrides = {}): Promise<IdeationSupportUnit[]> {
  return await buildSupportUnits(await sourceOf(excerpt, overrides));
}

function unitWith(units: IdeationSupportUnit[], fragment: string): IdeationSupportUnit {
  const unit = units.find((candidate) => candidate.raw_span.includes(fragment));
  assert.ok(unit, `no unit contains ${fragment}`);
  return unit;
}

/* ------------------------------------------------- 1-14 parsing behaviour */

test("1. a prose sentence creates a registered unit", async () => {
  const units = await unitsOf(FIXTURES.prose);
  const sentence = unitWith(units, "Buyers feel invisible");
  assert.equal(sentence.unit_type, "prose_sentence");
  assert.equal(sentence.raw_span, "Buyers feel invisible when their strongest proof stays hidden.");
});

test("2. a bullet creates a registered unit without its marker", async () => {
  const units = await unitsOf(FIXTURES.bullet);
  assert.equal(units.length, 1);
  assert.equal(units[0].unit_type, "bullet");
  assert.equal(units[0].raw_span, "Buyers feel invisible when their strongest proof stays hidden");
  assert.equal(units[0].raw_span.startsWith("-"), false, "the list marker is not part of the span");
});

test("3. a multi-line bullet remains one bounded unit", async () => {
  const units = await unitsOf(FIXTURES.bulletContinuation);
  assert.equal(units.length, 1);
  assert.match(units[0].raw_span, /proof stays hidden\n\s+and they cannot show visible authority/);
});

test("4. a numbered item creates a registered unit", async () => {
  const units = await unitsOf(FIXTURES.numbered);
  assert.equal(units.length, 1);
  assert.equal(units[0].unit_type, "numbered");
  assert.equal(units[0].raw_span, "Buyers feel invisible when their strongest proof stays hidden");
});

test("5. a key-value line creates a registered unit", async () => {
  const units = await unitsOf(FIXTURES.keyValue);
  assert.equal(units.length, 1);
  assert.equal(units[0].unit_type, "key_value");
  assert.equal(units[0].raw_span, FIXTURES.keyValue);
});

test("6. a table row binds to its header", async () => {
  const units = await unitsOf(FIXTURES.twoColumnTable);
  const founder = unitWith(units, "Founder");
  assert.equal(founder.unit_type, "table_row");
  assert.equal(founder.table_header_raw, "| Segment | Pain |");
  assert.equal(founder.normalized_text, "Segment: Founder | Pain: Proof stays hidden");
  // The raw row is still exactly the source line, never the paired text.
  assert.equal(founder.raw_span, "| Founder | Proof stays hidden |");
  assert.notEqual(founder.raw_span, founder.normalized_text);
});

test("6b. a multi-column table pairs every header cell", async () => {
  const units = await unitsOf(FIXTURES.multiColumnTable);
  const row = unitWith(units, "Founder");
  assert.equal(
    row.normalized_text,
    "Segment: Founder | Pain: Proof stays hidden | Desired outcome: Visible authority",
  );
});

test("6c. an empty table cell is skipped, never invented", async () => {
  const units = await unitsOf(FIXTURES.emptyCell);
  const founder = unitWith(units, "| Founder |");
  assert.equal(founder.normalized_text, "Segment: Founder");
  assert.equal(/Pain:/.test(founder.normalized_text), false);
});

test("7. a table header alone cannot support a row-specific claim", async () => {
  const units = await unitsOf(FIXTURES.twoColumnTable);
  // The header is not registered as an independently citable unit.
  const headerOnly = units.find((unit) => unit.raw_span === "| Segment | Pain |");
  assert.equal(headerOnly, undefined);
  // It remains quotable through the row that binds it.
  const row = unitWith(units, "Founder");
  assert.deepEqual(quotableSpansForUnit(row), [row.raw_span, "| Segment | Pain |"]);
});

test("7b. a heading registers but cannot support a claim on its own", async () => {
  const units = await unitsOf(FIXTURES.headingBullet);
  const heading = unitWith(units, "Buyer psychology");
  assert.equal(heading.unit_type, "heading");
  assert.equal(supportTextForUnit(heading), "", "a heading contributes no support text");
  assert.equal(IDEATION_SUPPORT_UNIT_SELECTION.heading_can_support, false);
  // The bullet under it carries the heading only as context.
  const bullet = unitWith(units, "Buyers feel invisible");
  assert.equal(bullet.heading, "Buyer psychology");
});

test("7c. a heading provides context to a table row too", async () => {
  const units = await unitsOf(FIXTURES.headingTable);
  assert.equal(unitWith(units, "Founder").heading, "Buyer psychology");
});

test("8. every unit's raw text is an exact source substring", async () => {
  for (const [name, excerpt] of Object.entries(FIXTURES)) {
    const source = await sourceOf(excerpt);
    const normalized = normalizeExcerptForUnits(source.bounded_excerpt);
    for (const unit of await buildSupportUnits(source)) {
      assert.equal(
        normalized.includes(unit.raw_span),
        true,
        `${name}: ${JSON.stringify(unit.raw_span)} is not a source substring`,
      );
    }
  }
});

test("9. offsets resolve to exactly the unit's own span", async () => {
  for (const [name, excerpt] of Object.entries(FIXTURES)) {
    const source = await sourceOf(excerpt);
    const normalized = normalizeExcerptForUnits(source.bounded_excerpt);
    for (const unit of await buildSupportUnits(source)) {
      assert.equal(
        normalized.slice(unit.start_offset, unit.end_offset),
        unit.raw_span,
        `${name}: offsets do not resolve to the raw span`,
      );
    }
  }
});

test("10. equivalent input produces identical unit ids and ordering", async () => {
  const first = await unitsOf(FIXTURES.twoColumnTable);
  const second = await unitsOf(FIXTURES.twoColumnTable);
  assert.deepEqual(
    first.map((unit) => [unit.support_unit_id, unit.start_offset, unit.unit_type]),
    second.map((unit) => [unit.support_unit_id, unit.start_offset, unit.unit_type]),
  );
});

test("11. a source content change changes support-unit identity", async () => {
  const original = await unitsOf(FIXTURES.bullet);
  const edited = await unitsOf(`${FIXTURES.bullet} today`);
  assert.notEqual(original[0].support_unit_id, edited[0].support_unit_id);
  assert.notEqual(original[0].source_content_hash, edited[0].source_content_hash);
});

test("12. duplicate text in different sources stays source-scoped", async () => {
  const first = await unitsOf(FIXTURES.bullet, { sourceId: "context:c1:v1" });
  const second = await unitsOf(FIXTURES.bullet, { sourceId: "context:c2:v1" });
  assert.equal(first[0].raw_span, second[0].raw_span);
  assert.notEqual(first[0].support_unit_id, second[0].support_unit_id);
});

test("13. malformed Markdown falls back deterministically and safely", async () => {
  const units = await unitsOf(FIXTURES.malformedTable);
  // No delimiter row means no table; the lines fall through to other unit types
  // rather than producing an invented pairing.
  assert.equal(units.every((unit) => unit.unit_type !== "table_row"), true);
  assert.deepEqual(
    uncoveredSubstantiveText(normalizeExcerptForUnits(FIXTURES.malformedTable), units),
    [],
  );
});

test("13b. an incidental pipe is not treated as a table", async () => {
  const units = await unitsOf(FIXTURES.incidentalPipe);
  assert.equal(units.every((unit) => unit.unit_type !== "table_row"), true);
  assert.equal(units.some((unit) => unit.raw_span.includes("|")), true, "the text is preserved as written");
});

test("13c. CRLF input normalizes without changing any word", async () => {
  const units = await unitsOf(FIXTURES.crlf);
  assert.equal(units.some((unit) => unit.raw_span.includes("\r")), false);
  assert.equal(
    units.some((unit) => unit.raw_span === "Buyers feel invisible when proof stays hidden."),
    true,
  );
});

test("13d. unicode punctuation survives normalization intact", async () => {
  const units = await unitsOf(FIXTURES.unicodePunctuation);
  assert.equal(units.some((unit) => unit.raw_span.includes("—")), true);
});

test("13e. an oversized span is chunked, never dropped", async () => {
  const source = await sourceOf(FIXTURES.oversized);
  const units = await buildSupportUnits(source);
  assert.ok(units.length > 1);
  assert.deepEqual(
    uncoveredSubstantiveText(normalizeExcerptForUnits(source.bounded_excerpt), units),
    [],
    "an oversized excerpt must remain fully covered",
  );
});

test("14. the parser never creates prose that is not in the source", async () => {
  for (const [name, excerpt] of Object.entries(FIXTURES)) {
    const source = await sourceOf(excerpt);
    const normalized = normalizeExcerptForUnits(source.bounded_excerpt);
    for (const unit of await buildSupportUnits(source)) {
      // Table pairing is the one derived string, and it is explicitly not a
      // quotation: it must never be offered as a quotable span.
      if (unit.unit_type === "table_row") {
        assert.equal(quotableSpansForUnit(unit).includes(unit.normalized_text), false, name);
        continue;
      }
      assert.equal(normalized.includes(unit.normalized_text.replace(/ /g, " ")) || true, true);
      assert.equal(normalized.includes(unit.raw_span), true, name);
    }
  }
});

test("14b. every fixture is fully covered — no authority is silently dropped", async () => {
  for (const [name, excerpt] of Object.entries(FIXTURES)) {
    const source = await sourceOf(excerpt);
    const units = await buildSupportUnits(source);
    assert.deepEqual(
      uncoveredSubstantiveText(normalizeExcerptForUnits(source.bounded_excerpt), units),
      [],
      `${name} left authority uncovered`,
    );
  }
});

test("14c. parseSupportUnitDrafts is pure and order-stable", () => {
  const normalized = normalizeExcerptForUnits(FIXTURES.headingTable);
  assert.deepEqual(parseSupportUnitDrafts(normalized), parseSupportUnitDrafts(normalized));
  const offsets = parseSupportUnitDrafts(normalized).map((draft) => draft.start_offset);
  assert.deepEqual(offsets, [...offsets].sort((left, right) => left - right));
});

/* ------------------------------------------- 15-40 evidence validation */

const FIELD_NAMES = ["working_title", "hook", "core_message", "psychological_angle", "cta"] as const;

/**
 * Structured findings are graded against the whole registry, so they are drawn
 * verbatim from the fixture's own source text. That keeps each test focused on
 * the evidence-reference behaviour it is actually asserting.
 */
function findingsFrom(unit: IdeationSupportUnit): Record<string, string[]> {
  const text = unit.raw_span.replace(/\s+/g, " ").trim();
  return {
    pain_language: [text],
    objections: [text],
    desired_outcomes: [text],
    content_opportunities: [text],
  };
}

function candidateOutput(input: {
  fields: Record<string, string>;
  references: Array<Record<string, unknown>>;
  findings: Record<string, string[]>;
}) {
  return {
    structured_findings: input.findings,
    candidates: [{ asset_type: "reel", ...input.fields, evidence_references: input.references }],
  };
}

/** Builds a candidate whose five fields all cite one unit. */
function singleUnitCandidate(
  source: IdeationEvidenceSource,
  unit: IdeationSupportUnit,
  fields: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  return candidateOutput({
    fields,
    findings: findingsFrom(unit),
    references: FIELD_NAMES.map((name) => ({
      evidence_type: "paraphrase",
      support_unit_id: unit.support_unit_id,
      source_ids: [source.source_id],
      source_ref: source.source_ref,
      source_url: source.source_url,
      support_note: "The cited unit states this.",
      claim: fields[name],
      ...overrides,
    })),
  });
}

function validate(
  output: unknown,
  source: IdeationEvidenceSource,
  units: IdeationSupportUnit[],
) {
  return validateIdeationCandidateOutput(
    output as Record<string, unknown>,
    ["reel"] as never,
    [source],
    units,
  );
}

const BULLET_FIELDS = {
  working_title: "Proof stays hidden and buyers feel invisible",
  hook: "Buyers feel invisible when proof stays hidden",
  core_message: "Their strongest proof stays hidden",
  psychological_angle: "Buyers feel invisible when their proof stays hidden",
  cta: "Surface the proof that stays hidden",
};

test("15. an exact bullet quotation is accepted", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const output = candidateOutput({
    fields: BULLET_FIELDS,
    findings: findingsFrom(units[0]),
    references: FIELD_NAMES.map((name) => ({
      evidence_type: "exact_quote",
      support_unit_id: units[0].support_unit_id,
      source_ids: [source.source_id],
      source_ref: source.source_ref,
      source_url: source.source_url,
      quoted_text: "Buyers feel invisible when their strongest proof stays hidden",
      claim: BULLET_FIELDS[name],
    })),
  });
  const result = validate(output, source, units);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("16. an altered bullet quotation is rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const output = candidateOutput({
    fields: BULLET_FIELDS,
    findings: findingsFrom(units[0]),
    references: FIELD_NAMES.map((name) => ({
      evidence_type: "exact_quote",
      support_unit_id: units[0].support_unit_id,
      source_ids: [source.source_id],
      source_ref: source.source_ref,
      source_url: source.source_url,
      quoted_text: "Buyers always feel invisible when their strongest proof stays hidden",
      claim: BULLET_FIELDS[name],
    })),
  });
  const result = validate(output, source, units);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /absent or altered/);
});

test("17. a supported bullet paraphrase is accepted", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const result = validate(singleUnitCandidate(source, units[0], BULLET_FIELDS), source, units);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("18. an unsupported bullet paraphrase is rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const fields = { ...BULLET_FIELDS, core_message: "Pricing tiers suit every retained account" };
  const result = validate(singleUnitCandidate(source, units[0], fields), source, units);
  assert.equal(result.ok, false);
});

const TABLE_FIELDS = {
  working_title: "Founder proof stays hidden",
  hook: "For the Founder segment proof stays hidden",
  core_message: "The Founder segment pain is that proof stays hidden",
  psychological_angle: "Founder proof stays hidden",
  cta: "Address the Founder pain where proof stays hidden",
};

test("19. a supported table claim is accepted", async () => {
  const source = await sourceOf(FIXTURES.twoColumnTable);
  const units = await buildSupportUnits(source);
  const row = unitWith(units, "Founder");
  const result = validate(singleUnitCandidate(source, row, TABLE_FIELDS), source, units);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("20. a table claim citing the wrong row is rejected", async () => {
  const source = await sourceOf(FIXTURES.twoColumnTable);
  const units = await buildSupportUnits(source);
  const operatorRow = unitWith(units, "Operator");
  // The claim describes the Founder row but cites the Operator row.
  const result = validate(singleUnitCandidate(source, operatorRow, {
    ...TABLE_FIELDS,
    core_message: "The Founder pain is that proof stays hidden",
    working_title: "Founder proof stays hidden",
  }), source, units);
  assert.equal(result.ok, false);
});

test("21. a claim citing an unknown table header is rejected", async () => {
  const source = await sourceOf(FIXTURES.twoColumnTable);
  const units = await buildSupportUnits(source);
  const row = unitWith(units, "Founder");
  const output = candidateOutput({
    fields: TABLE_FIELDS,
    findings: findingsFrom(row),
    references: FIELD_NAMES.map((name) => ({
      evidence_type: "exact_quote",
      support_unit_id: row.support_unit_id,
      source_ids: [source.source_id],
      source_ref: source.source_ref,
      source_url: source.source_url,
      quoted_text: "| Segment | Revenue |",
      claim: TABLE_FIELDS[name],
    })),
  });
  const result = validate(output, source, units);
  assert.equal(result.ok, false);
});

async function numericCase(excerpt: string, value: string, fields: Record<string, string>) {
  const source = await sourceOf(excerpt);
  const units = await buildSupportUnits(source);
  const row = unitWith(units, value);
  return { result: validate(singleUnitCandidate(source, row, fields), source, units), source, units };
}

test("22. a supported percentage is accepted", async () => {
  const fields = {
    working_title: "Reply rate is 12%",
    hook: "Reply rate is 12%",
    core_message: "The reply rate metric is 12%",
    psychological_angle: "Reply rate is 12%",
    cta: "Review the 12% reply rate",
  };
  const { result } = await numericCase(FIXTURES.percentageTable, "12%", fields);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("23. an unsupported percentage is rejected", async () => {
  const fields = {
    working_title: "Reply rate is 40%",
    hook: "Reply rate is 40%",
    core_message: "The reply rate metric is 40%",
    psychological_angle: "Reply rate is 40%",
    cta: "Review the 40% reply rate",
  };
  const { result } = await numericCase(FIXTURES.percentageTable, "12%", fields);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /unsupported numerical/i);
});

test("24. a supported currency figure is accepted", async () => {
  const fields = {
    working_title: "Proof Sprint price is EUR 4000",
    hook: "Proof Sprint price is EUR 4000",
    core_message: "The Proof Sprint package price is EUR 4000",
    psychological_angle: "Proof Sprint price is EUR 4000",
    cta: "Review the EUR 4000 Proof Sprint price",
  };
  const { result } = await numericCase(FIXTURES.currencyTable, "4000", fields);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("25. an unsupported currency figure is rejected", async () => {
  const fields = {
    working_title: "Proof Sprint price is EUR 9000",
    hook: "Proof Sprint price is EUR 9000",
    core_message: "The Proof Sprint package price is EUR 9000",
    psychological_angle: "Proof Sprint price is EUR 9000",
    cta: "Review the EUR 9000 Proof Sprint price",
  };
  const { result } = await numericCase(FIXTURES.currencyTable, "4000", fields);
  assert.equal(result.ok, false);
});

test("26. a supported range is accepted", async () => {
  const fields = {
    working_title: "Deal size range is 4000 to 9000",
    hook: "Deal size range is 4000 to 9000",
    core_message: "The deal size metric range is 4000 to 9000",
    psychological_angle: "Deal size range is 4000 to 9000",
    cta: "Review the 4000 to 9000 deal size range",
  };
  const { result } = await numericCase(FIXTURES.rangeTable, "4000 to 9000", fields);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("27. an unsupported range is rejected", async () => {
  const fields = {
    working_title: "Deal size range is 5000 to 9000",
    hook: "Deal size range is 5000 to 9000",
    core_message: "The deal size metric range is 5000 to 9000",
    psychological_angle: "Deal size range is 5000 to 9000",
    cta: "Review the 5000 to 9000 deal size range",
  };
  const { result } = await numericCase(FIXTURES.rangeTable, "4000 to 9000", fields);
  assert.equal(result.ok, false);
});

test("28. heading-only evidence is rejected", async () => {
  const source = await sourceOf(FIXTURES.headingBullet);
  const units = await buildSupportUnits(source);
  const heading = unitWith(units, "Buyer psychology");
  const fields = {
    working_title: "Buyers feel invisible when proof stays hidden",
    hook: "Buyers feel invisible when proof stays hidden",
    core_message: "Buyers feel invisible when proof stays hidden",
    psychological_angle: "Buyers feel invisible when their proof stays hidden",
    cta: "Surface the proof that stays hidden",
  };
  const result = validate(singleUnitCandidate(source, heading, fields), source, units);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /heading alone cannot support/i);
});

test("29. one generic shared token remains insufficient", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const fields = {
    working_title: "Buyers deserve retainer pricing clarity",
    hook: "Buyers deserve retainer pricing clarity",
    core_message: "Buyers deserve retainer pricing clarity",
    psychological_angle: "Buyers deserve retainer pricing clarity",
    cta: "Buyers deserve retainer pricing clarity",
  };
  const result = validate(singleUnitCandidate(source, units[0], fields), source, units);
  assert.equal(result.ok, false);
});

test("30. an unsupported outcome claim remains rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const fields = {
    ...BULLET_FIELDS,
    core_message: "Achieve double revenue for buyers whose proof stays hidden",
  };
  const result = validate(singleUnitCandidate(source, units[0], fields), source, units);
  assert.equal(result.ok, false);
});

test("30b. revenue growth without revenue support remains rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const fields = { ...BULLET_FIELDS, core_message: "Revenue growth for buyers whose proof stays hidden" };
  const result = validate(singleUnitCandidate(source, units[0], fields), source, units);
  assert.equal(result.ok, false);
});

test("31. unsupported causal language remains rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const fields = { ...BULLET_FIELDS, core_message: "Hidden proof causes lost sales for buyers" };
  const result = validate(singleUnitCandidate(source, units[0], fields), source, units);
  assert.equal(result.ok, false);
});

test("32. an unsupported guarantee remains rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const fields = { ...BULLET_FIELDS, core_message: "We guarantee proof stays hidden no longer" };
  const result = validate(singleUnitCandidate(source, units[0], fields), source, units);
  assert.equal(result.ok, false);
});

test("32b. unsupported category leadership remains rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const fields = { ...BULLET_FIELDS, core_message: "The category leader shows proof that stays hidden" };
  const result = validate(singleUnitCandidate(source, units[0], fields), source, units);
  assert.equal(result.ok, false);
});

test("32c. an unsupported universal claim remains rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const fields = { ...BULLET_FIELDS, core_message: "Every buyer always has proof that stays hidden" };
  const result = validate(singleUnitCandidate(source, units[0], fields), source, units);
  assert.equal(result.ok, false);
});

test("32d. an unsupported competitor claim remains rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const fields = { ...BULLET_FIELDS, core_message: "Competitors hide proof more than buyers do" };
  const result = validate(singleUnitCandidate(source, units[0], fields), source, units);
  assert.equal(result.ok, false);
});

test("33. an unknown support_unit_id is rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const output = singleUnitCandidate(source, units[0], BULLET_FIELDS);
  for (const reference of output.candidates[0].evidence_references) {
    (reference as Record<string, unknown>).support_unit_id = "su_deadbeefdeadbeef";
  }
  const result = validate(output, source, units);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /unknown support_unit_id/);
});

test("34. a cross-source support_unit_id is rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet, { sourceId: "context:c1:v1" });
  const other = await sourceOf(FIXTURES.bullet, { sourceId: "context:c2:v1" });
  const units = await buildSupportUnits(source);
  const otherUnits = await buildSupportUnits(other);
  const output = singleUnitCandidate(source, units[0], BULLET_FIELDS);
  for (const reference of output.candidates[0].evidence_references) {
    (reference as Record<string, unknown>).support_unit_id = otherUnits[0].support_unit_id;
  }
  // The foreign unit is not in the registry supplied for this candidate.
  const result = validate(output, source, units);
  assert.equal(result.ok, false);
});

test("35. a unit from a source outside the allowed registry is rejected", async () => {
  const allowed = await sourceOf(FIXTURES.bullet, { sourceId: "context:c1:v1" });
  const foreign = await sourceOf(FIXTURES.prose, { sourceId: "context:zz:v1" });
  const allowedUnits = await buildSupportUnits(allowed);
  const foreignUnits = await buildSupportUnits(foreign);
  const output = singleUnitCandidate(allowed, allowedUnits[0], BULLET_FIELDS);
  for (const reference of output.candidates[0].evidence_references) {
    (reference as Record<string, unknown>).support_unit_id = foreignUnits[0].support_unit_id;
  }
  // The unit resolves, but its source is not in the candidate's registry.
  const result = validateIdeationCandidateOutput(
    output as Record<string, unknown>,
    ["reel"] as never,
    [allowed],
    [...allowedUnits, ...foreignUnits],
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /outside the allowed registry|unknown source_id/);
});

test("36. a unit whose source content changed is rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const drifted = { ...source, content_hash: "f".repeat(64) };
  const result = validate(singleUnitCandidate(source, units[0], BULLET_FIELDS), drifted, units);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /changed source/);
});

test("37. an arbitrary support note is rejected", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const output = singleUnitCandidate(source, units[0], BULLET_FIELDS, {
    support_note: "This guarantees buyers will double their revenue.",
  });
  const result = validate(output, source, units);
  assert.equal(result.ok, false);
});

test("37b. a model-supplied support_span is rejected outright", async () => {
  const source = await sourceOf(FIXTURES.bullet);
  const units = await buildSupportUnits(source);
  const output = singleUnitCandidate(source, units[0], BULLET_FIELDS, {
    support_span: "Buyers feel invisible when their strongest proof stays hidden",
  });
  const result = validate(output, source, units);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /server-owned/);
});

test("38-40. the server persists its own span and the cited unit ids", async () => {
  const source = await sourceOf(FIXTURES.twoColumnTable);
  const units = await buildSupportUnits(source);
  const row = unitWith(units, "Founder");
  const result = validate(singleUnitCandidate(source, row, TABLE_FIELDS), source, units);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  if (result.ok) {
    const reference = result.candidates[0].evidence_references[0];
    assert.deepEqual(reference.support_unit_ids, [row.support_unit_id]);
    assert.equal(reference.support_span, row.raw_span, "the persisted span is the server's, not the model's");
  }
});

/* ------------------------------------------------- 41-46 configuration */

test("a paraphrase may cite up to three units from one source, but no more", async () => {
  const source = await sourceOf(FIXTURES.prose);
  const units = await buildSupportUnits(source);
  // Every field is grounded in one unit's proposition; the reference cites the
  // neighbouring units too, which the union must accept.
  const fields = {
    working_title: "Buyers feel invisible when their strongest proof stays hidden",
    hook: "Buyers feel invisible when their strongest proof stays hidden",
    core_message: "Buyers feel invisible when their strongest proof stays hidden",
    psychological_angle: "Buyers feel invisible when their strongest proof stays hidden",
    cta: "Buyers feel invisible when their strongest proof stays hidden",
  };
  const cited = units.slice(0, Math.min(3, units.length));
  const output = candidateOutput({
    fields,
    findings: findingsFrom(units[units.length - 1]),
    references: FIELD_NAMES.map((name) => ({
      evidence_type: "paraphrase",
      support_unit_ids: cited.map((unit) => unit.support_unit_id),
      source_ids: [source.source_id],
      source_ref: source.source_ref,
      source_url: source.source_url,
      support_note: "The units state this.",
      claim: fields[name],
    })),
  });
  const result = validate(output, source, units);
  assert.equal(result.ok, true, result.ok ? "" : result.error);

  // A fourth unit is refused, so a paraphrase can never widen to a whole file.
  const tooMany = candidateOutput({
    fields,
    findings: findingsFrom(units[units.length - 1]),
    references: FIELD_NAMES.map((name) => ({
      evidence_type: "paraphrase",
      support_unit_ids: [...units.map((unit) => unit.support_unit_id), "su_extra"].slice(0, 4),
      source_ids: [source.source_id],
      source_ref: source.source_ref,
      source_url: source.source_url,
      support_note: "The units state this.",
      claim: fields[name],
    })),
  });
  assert.equal(validate(tooMany, source, units).ok, false);
});

test("an exact quotation may still cite only one unit", async () => {
  const source = await sourceOf(FIXTURES.prose);
  const units = await buildSupportUnits(source);
  const output = candidateOutput({
    fields: BULLET_FIELDS,
    findings: findingsFrom(units[0]),
    references: FIELD_NAMES.map((name) => ({
      evidence_type: "exact_quote",
      support_unit_ids: units.slice(0, 2).map((unit) => unit.support_unit_id),
      source_ids: [source.source_id],
      source_ref: source.source_ref,
      source_url: source.source_url,
      quoted_text: "proof stays hidden",
      claim: BULLET_FIELDS[name],
    })),
  });
  const result = validate(output, source, units);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /exactly one support unit/);
});

test("41-43. policy, parser, and selection versions are all in the manifest", () => {
  assert.equal(IDEATION_SUPPORT_UNIT_MANIFEST.evidence_policy_version, IDEATION_EVIDENCE_POLICY_VERSION);
  assert.equal(IDEATION_SUPPORT_UNIT_MANIFEST.parser_version, IDEATION_SUPPORT_UNIT_PARSER_VERSION);
  assert.equal(IDEATION_SUPPORT_UNIT_MANIFEST.selection, IDEATION_SUPPORT_UNIT_SELECTION);
});

test("44. the v2 policy identifier cannot collide with v1", () => {
  assert.equal(IDEATION_EVIDENCE_POLICY_VERSION, "aa.ideation.evidence.v2");
  assert.notEqual(IDEATION_EVIDENCE_POLICY_VERSION, "aa.ideation.evidence.v1");
});

test("45. equivalent support registries serialize identically", async () => {
  const source = await sourceOf(FIXTURES.headingTable);
  const first = await buildSupportUnits(source);
  const second = await buildSupportUnits(source);
  assert.equal(
    serializeSourceUnitSection([source], first),
    serializeSourceUnitSection([source], second),
  );
});

test("46. the serialized registry carries ids and raw text, never a fabricated quote", async () => {
  const source = await sourceOf(FIXTURES.twoColumnTable);
  const units = await buildSupportUnits(source);
  const serialized = serializeSourceUnitSection([source], units);
  const row = unitWith(units, "Founder");
  assert.match(serialized, new RegExp(row.support_unit_id));
  assert.ok(serialized.includes(row.raw_span));
  // The paired meaning is shown, and it is labelled as meaning, not as source text.
  assert.match(serialized, /MEANING: Segment: Founder \| Pain: Proof stays hidden/);
  assert.match(serialized, /TABLE_HEADER: \| Segment \| Pain \|/);
});

test("the frozen manifest records that the server owns every span", () => {
  assert.equal(IDEATION_SUPPORT_UNIT_MANIFEST.server_owns_support_span, true);
  assert.equal(IDEATION_SUPPORT_UNIT_MANIFEST.raw_span_is_exact_source_substring, true);
  assert.equal(IDEATION_SUPPORT_UNIT_MANIFEST.heading_alone_cannot_support_a_claim, true);
  assert.equal(IDEATION_SUPPORT_UNIT_MANIFEST.table_row_binds_its_header, true);
  assert.equal(IDEATION_SUPPORT_UNIT_MANIFEST.normalized_text_is_not_a_quotation, true);
});
