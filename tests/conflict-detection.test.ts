// Programme Stage C — conflict detection rules.
//
// Covers the Stage C test requirement "conflicting inputs are surfaced", and
// the Stage C acceptance rule that unsupported claims fail closed.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  blockingFindings,
  detectConflicts,
} from "../supabase/functions/_shared/supply/conflicts.ts";

test("clean inputs produce no findings", () => {
  const findings = detectConflicts(
    {
      business_description: "We install commercial kitchens across Ireland.",
      target_customer: "Restaurant groups in Dublin.",
    },
    false,
  );
  assert.deepEqual(findings, []);
});

test("empty and whitespace fields are skipped", () => {
  assert.deepEqual(detectConflicts({ a: "", b: "   ", c: null }, false), []);
});

// Region and currency ------------------------------------------------------

test("ZAR pricing is surfaced as a region/currency conflict", () => {
  const findings = detectConflicts({ offer_details: "Package starts at ZAR 25 000" }, false);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].conflict_type, "region_currency");
  assert.equal(findings[0].left_source_ref, "offer_details");
});

test("South African geography is surfaced", () => {
  const findings = detectConflicts({ geography: "Clients across Cape Town" }, false);
  assert.equal(findings[0].conflict_type, "region_currency");
});

test("ZAR mixed with EUR escalates to blocking", () => {
  const warn = detectConflicts({ offer_details: "from ZAR 25 000" }, false);
  assert.equal(warn[0].severity, "warning");

  const mixed = detectConflicts({ offer_details: "ZAR 25 000 or EUR 1 200" }, false);
  assert.equal(mixed[0].severity, "blocking");
  assert.match(mixed[0].detail, /mixes/);
});

test("EUR alone is not a conflict", () => {
  assert.deepEqual(detectConflicts({ offer_details: "Priced at EUR 1 200" }, false), []);
});

// Deprecated offers --------------------------------------------------------

test("each deprecated offer is surfaced as blocking", () => {
  for (const offer of ["Proof Brand Lite", "Proof Engine Buildout", "maintenance package"]) {
    const findings = detectConflicts({ offer_details: `We sell the ${offer} tier` }, false);
    const match = findings.find((f) => f.conflict_type === "offer_superseded");
    assert.ok(match, `${offer} must be surfaced`);
    assert.equal(match.severity, "blocking");
  }
});

test("active offers are not flagged", () => {
  const findings = detectConflicts(
    { offer_details: "Proof Sprint, Proof Brand and Proof Brand Scale" },
    false,
  );
  assert.deepEqual(findings, []);
});

test("deprecated offer detection is case insensitive", () => {
  const findings = detectConflicts({ offer_details: "PROOF BRAND LITE" }, false);
  assert.equal(findings[0].conflict_type, "offer_superseded");
});

// Unsupported results ------------------------------------------------------

test("a numeric result claim without verified proof fails closed", () => {
  for (const claim of ["grew revenue 300%", "delivered 10x return", "doubled bookings"]) {
    const findings = detectConflicts({ proof_notes: claim }, false);
    const match = findings.find((f) => f.conflict_type === "unsupported_result");
    assert.ok(match, `"${claim}" must be surfaced`);
    assert.equal(match.severity, "blocking");
  }
});

test("the same claim is accepted once verified proof exists", () => {
  const findings = detectConflicts({ proof_notes: "grew revenue 300%" }, true);
  assert.deepEqual(findings, []);
});

test("prose without a measurable claim is not flagged", () => {
  assert.deepEqual(detectConflicts({ proof_notes: "clients say we are reliable" }, false), []);
});

// Aggregation --------------------------------------------------------------

test("one field can raise several distinct conflicts", () => {
  const findings = detectConflicts(
    { offer_details: "Proof Brand Lite from ZAR 25 000, grew revenue 300%" },
    false,
  );
  const types = new Set(findings.map((f) => f.conflict_type));
  assert.equal(types.has("region_currency"), true);
  assert.equal(types.has("offer_superseded"), true);
  assert.equal(types.has("unsupported_result"), true);
});

test("blocking findings are separable from warnings", () => {
  const findings = detectConflicts(
    { geography: "Cape Town", offer_details: "Proof Brand Lite" },
    false,
  );
  assert.equal(findings.length, 2);
  const blocking = blockingFindings(findings);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].conflict_type, "offer_superseded");
});

test("detection is deterministic across runs", () => {
  const input = { offer_details: "Proof Brand Lite from ZAR 25 000", geography: "Pretoria" };
  assert.deepEqual(detectConflicts(input, false), detectConflicts(input, false));
});
